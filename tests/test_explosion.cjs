const assert = require('node:assert/strict');
(async () => {
    const { Matrix4, Box3, Vector3 } = await import('three');
    const { planExplosion, explosionOffsets, subtreeBounds } = await import('../assembly/explosion.mjs');
    const rows = matrix => [0, 1, 2, 3].map(r => [0, 1, 2, 3].map(c => matrix.elements[c * 4 + r]));
    const model = { rootId: 'cabinet', definitions: new Map(), nodes: new Map() };
    function add(id, size, position, parentId = 'cabinet', transform) {
        const local = transform || new Matrix4().makeTranslation(...position);
        const parent = model.nodes.get(parentId);
        const world = parent ? new Matrix4().set(...parent.worldMatrix.flat()).multiply(local) : local;
        const definitionId = size ? 'def-' + size.join('-') : 'empty';
        model.definitions.set(definitionId, { bounds: size ? { min: [0,0,0], max: size.slice() } : null });
        model.nodes.set(id, { id, parentId: parent?.id ?? null, definitionId, name: 'Identical name', children: [], localMatrix: rows(local), worldMatrix: rows(world) });
        parent?.children.push(id);
    }
    add('cabinet', null, [0,0,0], null);
    add('left', [.75,12,30], [0,0,0]);
    add('right', [.75,12,30], [29.25,0,0]);
    add('top', [28.5,12,.75], [.75,0,29.25]);
    add('bottom', [28.5,12,.75], [.75,0,0]);
    add('shelf1', [28.5,11,.75], [.75,0,10]);
    add('shelf2', [28.5,11,.75], [.75,0,20]);
    add('back', [30,.25,30], [0,12,0]);
    add('door', null, [0,-.75,0]);
    add('door-panel', [30,.75,30], [0,0,0], 'door');
    add('empty', null, [0,0,0]);
    const snapshot = JSON.stringify({ nodes: [...model.nodes], definitions: [...model.definitions] });
    function separated(plan) {
        const boxes = [...plan.offsets].map(([id, offset]) => {
            const b = plan.bounds.get(id);
            return { id, box: new Box3(new Vector3(...b.min), new Vector3(...b.max)).translate(new Vector3(...offset)) };
        });
        for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
            assert.equal(boxes[i].box.intersectsBox(boxes[j].box), false, `${boxes[i].id} clears ${boxes[j].id}`);
        }
    }
    const plan = planExplosion(model, 'cabinet');
    assert.ok(plan.offsets.get('left')[0] < 0, 'left panel goes left');
    assert.ok(plan.offsets.get('right')[0] > 0, 'right panel goes right');
    assert.ok(plan.offsets.get('top')[2] > 0, 'top goes up');
    assert.ok(plan.offsets.get('bottom')[2] < 0, 'bottom goes down');
    assert.ok(plan.offsets.get('door')[1] < 0, 'nested door moves forward as a unit');
    assert.ok(!plan.offsets.has('door-panel'), 'one level only');
    assert.equal(plan.skipped, 1, 'empty children handled');
    assert.equal(model.nodes.get('shelf1').definitionId, model.nodes.get('shelf2').definitionId);
    assert.ok(plan.offsets.has('shelf1') && plan.offsets.has('shelf2'), 'instances offset independently');
    separated(plan);
    assert.deepEqual(plan, planExplosion(model, 'cabinet'), 'deterministic layout');
    for (const offset of explosionOffsets(plan, 0).values()) assert.deepEqual(offset, [0,0,0], 'exact zero without negative zero');
    for (const [id, offset] of explosionOffsets(plan, 50)) assert.deepEqual(offset, plan.offsets.get(id).map(v => v * .75), '50% matches the former 75% separation');
    for(const [id,offset] of explosionOffsets(plan,100))assert.deepEqual(offset,plan.offsets.get(id).map(v=>v*1.5),'full pull apart uses the calibrated range');
    for(const [id,offset] of explosionOffsets(plan,50))assert.deepEqual(offset,explosionOffsets(plan,100).get(id).map(v=>v/2),'slider stays linear');
    assert.deepEqual(explosionOffsets(null, 100), new Map(), 'reset has no offsets');
    assert.throws(() => explosionOffsets(plan, NaN));
    for (const spacing of [.5, 1, 2]) for (const direction of ['auto','-x','+x','-y','+y','-z','+z']) {
        const alternative = planExplosion(model, 'cabinet', { spacing, direction });
        separated(alternative);
        if (direction !== 'auto') {
            const axis = 'xyz'.indexOf(direction[1]);
            for (const offset of alternative.offsets.values()) {
                assert.ok(offset[axis] * (direction[0] === '+' ? 1 : -1) > 0);
                assert.equal(offset.filter(v => v !== 0).length, 1);
            }
        }
    }
    assert.ok(plan.offsets.get('shelf1')[1]<0&&plan.offsets.get('shelf2')[1]<0,'interior shelves consistently pull forward');
    for(const spread of [[.5,1,2],[2,2,2],[1,1,1]]){
        const even=planExplosion(model,'cabinet',{layout:'even',spread});
        separated(even);
        assert.deepEqual(even,planExplosion(model,'cabinet',{layout:'even',spread}));
        assert.ok([...even.offsets.values()].some(offset=>offset.filter(v=>v!==0).length>1),'XYZ layout spreads in more than one plane');
        assert.deepEqual(even.spread,spread);
        for(const offset of explosionOffsets(even,0).values())assert.deepEqual(offset,[0,0,0]);
    }
    assert.throws(()=>planExplosion(model,'cabinet',{spread:[0,1,1]}),/spread/);
    assert.throws(()=>planExplosion(model,'cabinet',{layout:'invalid'}),/layout/);
    assert.equal(snapshot, JSON.stringify({ nodes: [...model.nodes], definitions: [...model.definitions] }), 'planning never changes source geometry or matrices');
    assert.throws(() => planExplosion(model, 'shelf1'), /Select an assembly/);
    assert.throws(() => planExplosion(model, 'cabinet', { spacing: Infinity }));
    assert.throws(() => planExplosion(model, 'cabinet', { direction: 'unknown' }));

    // Rotate/reflect/nonuniformly scale an entire assembly: planning uses its
    // local axes and must not change just because it is placed differently.
    const placed = new Matrix4().makeRotationZ(Math.PI / 3).scale(new Vector3(-2,3,.5));
    placed.setPosition(400,-200,40);
    model.nodes.get('cabinet').localMatrix = rows(placed);
    model.nodes.get('cabinet').worldMatrix = rows(placed);
    assert.deepEqual(plan, planExplosion(model, 'cabinet'));
    // Rotated descendants are bounded in assembly coordinates, including a
    // translated subassembly and a differently oriented child of that group.
    const nested = planExplosion(model, 'door');
    assert.equal(nested.offsets.size, 1);
    model.nodes.get('door-panel').localMatrix = rows(new Matrix4().makeRotationZ(Math.PI / 2));
    const bounds = subtreeBounds(model, 'door');
    assert.ok(Math.abs(bounds.min.x + .75) < 1e-10);
    assert.ok(Math.abs(bounds.max.y - 30) < 1e-10);
    separated(planExplosion(model, 'cabinet'));
    // Coincident boxes cannot derive a spatial direction; stable tie breaks
    // and the user-directed fallback must still produce separated boxes.
    model.nodes.get('right').localMatrix = model.nodes.get('left').localMatrix.map(row => row.slice());
    separated(planExplosion(model, 'cabinet'));
    model.definitions.set('body', { bounds: { min: [0,0,0], max: [30,12,30] } });
    model.nodes.get('cabinet').definitionId = 'body';
    const withBody = planExplosion(model, 'cabinet');
    const body = new Box3(new Vector3(0,0,0), new Vector3(30,12,30));
    for (const [id, offset] of withBody.offsets) {
        const bounds = withBody.bounds.get(id);
        const moved = new Box3(new Vector3(...bounds.min), new Vector3(...bounds.max)).translate(new Vector3(...offset));
        assert.ok(!moved.intersectsBox(body), 'children clear parent-owned geometry');
    }
    model.nodes.get('cabinet').children = ['empty'];
    assert.throws(() => planExplosion(model, 'cabinet'), /no child geometry/);
    model.nodes.get('cabinet').children = Array(1001).fill('left');
    assert.throws(() => planExplosion(model, 'cabinet'), /smaller assembly/);
    const flat={rootId:'frame',nodes:new Map(),definitions:new Map([['empty',{bounds:null}]])};
    flat.nodes.set('frame',{id:'frame',definitionId:'empty',parentId:null,name:'Unrelated assembly',children:[],localMatrix:rows(new Matrix4()),worldMatrix:rows(new Matrix4())});
    function flatPart(id,size,position){
        flat.definitions.set(id,{bounds:{min:[0,0,0],max:size}});
        const matrix=new Matrix4().makeTranslation(...position);
        flat.nodes.set(id,{id,parentId:'frame',name:'Unnamed',definitionId:id,children:[],localMatrix:rows(matrix),worldMatrix:rows(matrix)});
        flat.nodes.get('frame').children.push(id);
    }
    flatPart('top',[80,3.5,.75],[0,17.5,0]);flatPart('bottom',[80,3.5,.75],[0,0,0]);
    flatPart('left',[3.5,14,.75],[0,3.5,0]);flatPart('right',[3.5,14,.75],[76.5,3.5,0]);flatPart('middle',[3.5,14,.75],[38.25,3.5,0]);
    const flatSource=JSON.stringify([...flat.nodes]);
    for(const layout of ['logical','even'])for(const spacing of [.5,1,2]){
        const result=planExplosion(flat,'frame',{layout,spacing,spread:[1.4,.8,2]});
        assert.equal(result.planeAxis,2);assert.equal(result.plane,'XY');
        for(const offset of result.offsets.values())assert.equal(offset[2],0,'automatic flat layout has no normal displacement');
        assert.deepEqual(result.offsets.get('middle'),[0,0,0],'center support remains on its mating centerline');
        separated(result);
        assert.ok(Math.max(...[...result.offsets.values()].flat().map(Math.abs))<result.gap*3,'no support is thrown past the neighboring long rail');
        assert.deepEqual(result,planExplosion(flat,'frame',{layout,spacing,spread:[1.4,.8,2]}));
    }
    flat.nodes.get('frame').worldMatrix=rows(new Matrix4().makeRotationY(Math.PI/3));
    assert.equal(planExplosion(flat,'frame').plane,'XY','rotated assembly stays planar in assembly coordinates');
    assert.equal(planExplosion(flat,'frame',{direction:'+z'}).plane,undefined,'explicit user direction may override planar layout');
    assert.equal(flatSource,JSON.stringify([...flat.nodes].map(([id,node])=>[id,id==='frame'?{...node,worldMatrix:rows(new Matrix4())}:node])));
    console.log('Explosion planning passed: panel directions, nested units, independent instances, rotations/reflections/scales, exact 0%, interpolation, deterministic separation, all spacing/direction fallbacks, empty parts, and immutable models.');
})().catch(error => { console.error(error); process.exitCode = 1; });
