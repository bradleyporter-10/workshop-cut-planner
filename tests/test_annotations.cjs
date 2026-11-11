const assert = require('node:assert/strict');
(async () => {
    const { Matrix4, Vector3 } = await import('three');
    const { formatMeasurement, dimensionAxes, buildPartCatalog, componentLabel, optimizationLetters, summarizeParts, dimensionCandidateGroups, placeLabels, rectanglesOverlap } = await import('../assembly/annotations.mjs');
    for (const [value, expected] of [[0,'0″'], [.75,'3/4″'], [28.5,'28 1/2″'], [1.9999,'2″'], [-2.25,'−2 1/4″'], [.01,'< 1/16″'], [NaN,'—']]) assert.equal(formatMeasurement(value), expected);
    assert.equal(formatMeasurement(1.03125, 32), '1 1/32″');
    assert.equal(formatMeasurement(1.03125, 16), '1 1/16″');
    assert.equal(formatMeasurement(1.01, 64), '1 1/64″');
    assert.equal(formatMeasurement(1.25, 8), '1 1/4″');
    assert.throws(() => formatMeasurement(2, 3));
    const bounds = { min: [2,-1,3], max: [12,3,3.75] };
    const transform = new Matrix4().makeRotationZ(Math.PI/3).scale(new Vector3(-2,3,4));
    transform.setPosition(1000,-400,80);
    const dimensions = dimensionAxes(bounds, transform);
    assert.deepEqual(dimensions.map(d => d.label), ['L','W','T']);
    dimensions.forEach((d, i) => assert.ok(Math.abs(d.value - [20,12,3][i]) < 1e-9));
    for (const dimension of dimensions) for (const [a, b] of dimension.edges) assert.ok(Math.abs(a.distanceTo(b) - dimension.value) < 1e-9, 'dimension endpoints follow scaled local axes');
    transform.setPosition(-1,2,3);
    assert.deepEqual(dimensionAxes(bounds, transform).map(d => d.value), dimensions.map(d => d.value), 'translation cannot change dimensions');
    assert.deepEqual(dimensionAxes(null, transform), []);
    const rows = matrix => [0,1,2,3].map(r => [0,1,2,3].map(c => matrix.elements[c*4+r]));
    const identity = rows(new Matrix4());
    const model = { rootId: 'model', definitions: new Map([['empty', { bounds: null }], ['panel', { bounds }], ['other', { bounds: { min: [0,0,0], max: [20,4,.75] } }]]),
        nodes: new Map([
            ['model', { id:'model', definitionId:'empty', name:'Assembly', worldMatrix:identity, children:['a','group'] }],
            ['a', { id:'a', definitionId:'panel', name:'Same name', worldMatrix:identity, children:[] }],
            ['group', { id:'group', definitionId:'empty', name:'Nested', worldMatrix:identity, children:['b','c','d'] }],
            ['b', { id:'b', definitionId:'panel', name:'Same name', worldMatrix:identity, children:[] }],
            ['c', { id:'c', definitionId:'other', name:'Same name', worldMatrix:identity, children:[] }],
            ['d', { id:'d', definitionId:'panel', name:'Same name', worldMatrix:rows(transform), children:[] }]
        ]) };
    const before = JSON.stringify({ nodes:[...model.nodes], definitions:[...model.definitions] });
    const parts = buildPartCatalog(model);
    assert.deepEqual([...parts.values()].map(p => p.number), ['P01','P02','P03','P04']);
    assert.ok([...parts.values()].every(p => p.quantity === 1), 'distinct instances do not claim manufacturing equivalence');
    assert.notEqual(parts.get('a').number, parts.get('b').number, 'repeated definitions identified individually');
    assert.notEqual(parts.get('a').number, parts.get('c').number, 'same names never imply matching parts');
    assert.deepEqual(parts, buildPartCatalog(model));
    assert.equal(componentLabel(parts.get('a'), 'name'), 'Same name');
    assert.equal(componentLabel(parts.get('a'), 'number'), 'P01');
    assert.equal(componentLabel(parts.get('a'), 'both'), 'P01 · Same name');
    assert.equal(componentLabel(parts.get('a'), 'none'), '');
    const links = new Map([['a','row1'],['b','row1'],['c','row2'],['d','deleted-row']]);
    const layouts = [{placements:[{p:{sourcePartId:'row1',key:'edited-name-size-and-material'}},{p:{sourcePartId:'row2',key:'same-name-different-material'}},{p:{sourcePartId:'unlinked',key:'manual-row'}}]}];
    const assigned = new Map([['edited-name-size-and-material','AA'],['same-name-different-material','B'],['manual-row','C']]);
    const letters = optimizationLetters(links, layouts, assigned, part=>part.key);
    assert.deepEqual([...letters], [['a','AA'],['b','AA'],['c','B']], 'repeated instances share the actual row letter, unrelated names/materials stay distinct, deleted rows are unassigned');
    assert.equal(componentLabel({...parts.get('a'),optimizationLabel:letters.get('a')}, 'optimization'), 'AA');
    assert.equal(componentLabel(parts.get('d'), 'optimization'), '—');
    assert.deepEqual(optimizationLetters(links, [], assigned, part=>part.key), new Map(), 'replacement/empty plans clear labels');

    assert.equal(before, JSON.stringify({ nodes:[...model.nodes], definitions:[...model.definitions] }));
    const summaryInput = [
        {...parts.get('a'), optimizationLabel:'A'}, {...parts.get('b'), optimizationLabel:'A'},
        {...parts.get('c'), optimizationLabel:'A'}, // same letter/name, different modeled size
        {...parts.get('d'), optimizationLabel:'B'},
        {...parts.get('a'), instanceId:'unassigned1'}, {...parts.get('b'), instanceId:'unassigned2'},
        {...parts.get('a'), instanceId:'different-name', name:'Different name', optimizationLabel:'A'},
        {...parts.get('a'), instanceId:'multi-letter', optimizationLabel:'AA'}
    ];
    const inputSnapshot=JSON.stringify(summaryInput),summary=summarizeParts(summaryInput);
    assert.equal(summary.reduce((sum,row)=>sum+row.quantity,0),summaryInput.length);
    assert.equal(summary.find(row=>row.instanceIds.includes('a')).quantity,2,'same optimization letter, component name, and size are summarized');
    assert.equal(summary.find(row=>row.instanceIds.includes('c')).quantity,1,'different modeled sizes stay distinct');
    assert.equal(summary.filter(row=>!row.letter).length,2,'unassigned geometry does not merge');
    assert.equal(summary.find(row=>row.instanceIds.includes('different-name')).quantity,1,'different component names stay distinct');
    assert.deepEqual(summary.filter(row=>row.letter).map(row=>row.letter),['A','A','A','B','AA']);
    assert.equal(JSON.stringify(summaryInput),inputSnapshot,'summary never mutates source parts');
    const dimensionCandidates=summaryInput.map(part=>({part}));
    const dimensionGroups=dimensionCandidateGroups(dimensionCandidates);
    assert.equal(dimensionGroups.find(group=>group.candidates.some(item=>item.part.instanceId==='a')).candidates.length,2,'repeated assigned part has one dimension group');
    assert.equal(dimensionGroups.find(group=>group.candidates.some(item=>item.part.instanceId==='c')).candidates.length,1,'different modeled dimensions remain independently dimensioned');
    const selectedFirst=[dimensionCandidates[1],dimensionCandidates[0]];
    assert.equal(dimensionCandidateGroups(selectedFirst)[0].candidates[0].part.instanceId,'b','selected/on-screen preference determines the representative');
    assert.equal(dimensionCandidateGroups([dimensionCandidates[1]])[0].candidates[0].part.instanceId,'b','hidden/offscreen alternatives cannot suppress remaining instances');
    const geometryOnly=[{part:{...parts.get('a'),instanceId:'u1'}},{part:{...parts.get('a'),instanceId:'u2'}}];
    assert.equal(dimensionCandidateGroups(geometryOnly).length,1,'repeated unassigned definitions share dimension annotations');
    assert.equal(JSON.stringify(summaryInput),inputSnapshot,'dimension grouping does not alter identities, quantities, or geometry');
    const items = Array.from({length:50}, (_, i) => ({ id:i, anchor:{x:160,y:160}, width:120, height:22 }));
    const occupied = [{x:120,y:130,width:100,height:20}];
    const placed = placeLabels(items, 320, 320, occupied, 12);
    assert.ok(placed.length > 0 && placed.length <= 12);
    assert.equal(placed[0].id, 0, 'caller priority preserved');
    assert.deepEqual(placed, placeLabels(items, 320, 320, occupied, 12));
    for (let i=0; i<placed.length; i++) {
        const r=placed[i].rect;
        assert.ok(r.x>=6&&r.y>=6&&r.x+r.width<=314&&r.y+r.height<=314,'text stays inside viewport');
        assert.ok(!rectanglesOverlap(r, occupied[0]));
        for(let j=i+1;j<placed.length;j++) assert.ok(!rectanglesOverlap(r, placed[j].rect));
    }
    assert.deepEqual(placeLabels(items, 5, 5), []);
    assert.deepEqual(buildPartCatalog(null), new Map());
    console.log('Annotations passed: fractional precision/carry, scaled local-axis dimension endpoints, hierarchy numbering, conservative instance identity, immutability, label modes, and deterministic unclipped/nonoverlapping label placement.');
})().catch(error => { console.error(error); process.exitCode = 1; });
