const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
(async () => {
    const { normalizeAssembly, triangulateDefinition } = await import('../assembly/model.mjs');
    const html = fs.readFileSync('cut-planner.html', 'utf8');
    const context = vm.createContext({ console, TextDecoder, TextEncoder });
    vm.runInContext(html.slice(html.indexOf('function normalizeMatrix('), html.indexOf('function extractFromSkpModel(')), context);
    const adapters = Object.fromEntries(['getDefs', 'getVertices', 'getInstances', 'defRef', 'getHiddenLayerSet', 'normalizeMatrix', 'mm', 'basisNorm', 'isSheared'].map(key => [key, context[key]]));
    // Construct data inside the adapter realm, just like the actual browser parser.
    vm.runInContext(`fixture={units:'Millimeters',root:{instances:[
        {refIdx:1,name:'Assembly',matrix:[0,-1,0,1,0,0,0,0,1,10,20,30,1]},
        {refIdx:2,name:'Same',matrix:[1,0,0,0,1,0,0,0,1,50,0,0,1]},
        {refIdx:2,name:'Same',hidden:true}
    ]},definitions:new Map([
        [1,{name:'Assembly',instances:[{refIdx:2,name:'Same',matrix:[2,0,0,0,3,0,0,0,4,5,0,0,1]}]}],
        [2,{name:'Panel',vertices:[{id:1,x:0,y:0,z:0},{id:2,x:4,y:2,z:1}],edges:[],faces:[],instances:[]}]
    ])}`, context);
    const before = JSON.stringify(context.fixture, (_, value) => value instanceof Map ? [...value] : value);
    const model = normalizeAssembly(context.fixture, adapters);
    const child = model.nodes.get('model/0/0'), repeated = model.nodes.get('model/1');
    assert.equal(child.parentId, 'model/0');
    assert.equal(child.definitionId, repeated.definitionId);
    assert.notEqual(child.id, repeated.id);
    assert.equal(model.nodes.size, 4, 'hidden subtree excluded');
    assert.equal(normalizeAssembly(context.fixture, adapters, { includeHidden: true }).nodes.size, 5);
    assert.deepEqual(Array.from(child.worldMatrix, row => Array.from(row)), [[0,-3,0,10],[2,0,0,25],[0,0,4,30],[0,0,0,1]]);
    assert.deepEqual(child.dimensions, { length: 8, width: 6, thickness: 4 });
    assert.equal(model.units, 'in', 'display units do not rescale inch geometry');
    assert.equal(model.definitions.get('2').representation, 'bounding-box');
    assert.equal(before, JSON.stringify(context.fixture, (_, value) => value instanceof Map ? [...value] : value), 'source stays unchanged');
    assert.deepEqual([...model.nodes.keys()], [...normalizeAssembly(context.fixture, adapters).nodes.keys()], 'stable hierarchy IDs');
    context.fixture.definitions.get(1).instances.push({ refIdx: 1 });
    context.fixture.root.instances.push({ refIdx: 99 }, { refIdx: 2, matrix: [NaN] });
    assert.ok(normalizeAssembly(context.fixture, adapters).issues.length >= 3, 'cycles, missing definitions, and malformed transforms are reported');

    // A nonrectangular face with a hole: area 16 - 4 = 12, not its box area.
    const points = [[0,0,0],[4,0,0],[4,4,0],[0,4,0],[1,1,0],[1,3,0],[3,3,0],[3,1,0]];
    const source = { edges: points.map((_, i) => ({ id: i, v1Id: i, v2Id: i < 4 ? (i + 1) % 4 : 4 + (i - 3) % 4 })),
        faces: [{ id: 1, loops: [[0,1,2,3],[4,5,6,7]].map(loop => loop.map(edgeId => ({ edgeId, orientation: 1 }))) }] };
    const issues = [];
    const geometry = triangulateDefinition(source, new Map(points.map((p, i) => [i, p])), issues, 'test');
    let area = 0;
    for (let i = 0; i < geometry.length; i += 9) {
        const [ax,ay,,bx,by,,cx,cy] = geometry.slice(i,i+9);
        area += Math.abs((bx-ax)*(cy-ay)-(by-ay)*(cx-ax))/2;
    }
    assert.equal(area, 12);
    assert.equal(issues.length, 0);

    vm.runInContext(fs.readFileSync('vendor/openskp/browser-bundle.js', 'utf8'), context);
    context.bytes = fs.readFileSync('sketchup-examples/playroom cabinets.skp');
    vm.runInContext('real=WorkshopSkp.parseSkp(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength))', context);
    const real = normalizeAssembly(context.real, adapters);
    assert.ok(real.nodes.size > 100, 'real cabinet hierarchy extracted');
    assert.ok([...real.nodes.values()].some(node => node.children.length && node.parentId !== null), 'real nested assemblies');
    assert.ok([...real.definitions.values()].some(def => def.geometry.length > 100));
    const refs = new Set([...real.nodes.values()].map(n => n.definitionId));
    assert.ok(refs.size < real.nodes.size, 'real repeated definition instances preserved');
    let compared = 0;
    for (const node of real.nodes.values()) {
        const source = context.real.definitions.get(Number(node.definitionId));
        if (!source?.vertices.length) continue;
        const spans = ['x','y','z'].map((axis, i) => {
            const coords = source.vertices.map(v => v[axis]);
            return (Math.max(...coords)-Math.min(...coords))*Math.hypot(node.worldMatrix[0][i],node.worldMatrix[1][i],node.worldMatrix[2][i]);
        }).sort((a,b)=>b-a);
        Object.values(node.dimensions).forEach((value, i) => assert.ok(Math.abs(value - spans[i]) < 1e-8));
        compared++;
    }
    console.log(`Assembly normalization passed: hierarchy, instances, rotation/scale, local dimensions, units, immutability, malformed input, face holes; ${real.nodes.size-1} real instances, ${compared} real measurements, ${real.issues.length} review notes.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
