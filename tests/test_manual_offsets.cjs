const assert = require('node:assert/strict');
(async () => {
    const { Matrix4, Vector3 } = await import('three');
    const { correctionToWorld, correctionInAxes, isManualTarget, presentationOffsets } = await import('../assembly/manual-offsets.mjs');
    const { explosionOffsets } = await import('../assembly/explosion.mjs');
    const rows = m => [0,1,2,3].map(r => [0,1,2,3].map(c => m.elements[c*4+r]));
    const nodes = new Map();
    function add(id, parentId, local) {
        const parent = nodes.get(parentId);
        const world = parent ? new Matrix4().set(...parent.worldMatrix.flat()).multiply(local) : local;
        nodes.set(id, { id, parentId, localMatrix: rows(local), worldMatrix: rows(world) });
    }
    add('root', null, new Matrix4());
    add('assembly', 'root', new Matrix4().makeRotationZ(Math.PI/2).scale(new Vector3(-2,3,4)).setPosition(10,20,30));
    add('nested', 'assembly', new Matrix4().makeRotationX(Math.PI/2).scale(new Vector3(2,1,.5)).setPosition(3,4,5));
    add('part', 'nested', new Matrix4().makeRotationY(Math.PI/2).scale(new Vector3(.5,2,1)).setPosition(1,2,3));
    add('repeat', 'assembly', new Matrix4().makeTranslation(20,0,0));
    add('other', 'root', new Matrix4());
    const model = { nodes }, plan = { assemblyId:'assembly', offsets:new Map([['nested',[2,3,4]],['repeat',[-5,0,0]]]) };
    const snapshot = JSON.stringify([...nodes]);
    const close = (a,b) => { assert.equal(a.length,b.length);a.forEach((v,i)=>assert.ok(Math.abs(v-b[i])<1e-9,`${a} matches ${b}`)); };
    assert.ok(isManualTarget(model,'assembly','part'));
    assert.ok(isManualTarget(model,'assembly','nested'));
    assert.ok(!isManualTarget(model,'assembly','assembly'));
    assert.ok(!isManualTarget(model,'assembly','other'));
    close(correctionToWorld(model,'assembly','part','assembly',[1,0,0]),[0,-1,0]);
    for (const space of ['assembly','local']) {
        const inch = correctionToWorld(model,'assembly','part',space,[1,0,0]);
        close([Math.hypot(...inch)],[1]);
        const world = correctionToWorld(model,'assembly','part',space,[3,-2,1]);
        close(correctionInAxes(model,'assembly','part',space,world),[3,-2,1]);
        const alternate = correctionInAxes(model,'assembly','part',space === 'local' ? 'assembly':'local',world);
        close(correctionToWorld(model,'assembly','part',space === 'local' ? 'assembly':'local',alternate),world);
    }
    const corrections = new Map([
        ['nested',correctionToWorld(model,'assembly','nested','assembly',[4,0,0])],
        ['part',correctionToWorld(model,'assembly','part','local',[1,2,3])]
    ]);
    const correctionSnapshot=JSON.stringify([...corrections]);
    function worldMatrices(offsets) {
        const result=new Map();
        for(const [id,node] of nodes){
            const parent=result.get(node.parentId)||new Matrix4();
            const local=new Matrix4().makeTranslation(...(offsets.get(id)||[0,0,0])).multiply(new Matrix4().set(...node.localMatrix.flat()));
            result.set(id,parent.clone().multiply(local));
        }
        return result;
    }
    for(const percent of [0,25,50,100]) {
        const automatic=worldMatrices(explosionOffsets(plan,percent));
        const adjusted=worldMatrices(presentationOffsets(model,plan,percent,corrections));
        const delta=new Vector3().setFromMatrixPosition(adjusted.get('part')).sub(new Vector3().setFromMatrixPosition(automatic.get('part'))).toArray();
        close(delta,corrections.get('nested').map((v,i)=>(v+corrections.get('part')[i])*percent/100));
        close(adjusted.get('repeat').toArray(),automatic.get('repeat').toArray());
    }
    for(const value of presentationOffsets(model,plan,0,corrections).values())assert.deepEqual(value,[0,0,0]);
    const combined=presentationOffsets(model,plan,100,corrections);
    assert.ok(combined.has('part'),'nested descendants can be adjusted independently');
    corrections.delete('part');
    assert.ok(!presentationOffsets(model,plan,100,corrections).has('part'),'individual reset removes the correction');
    corrections.clear();
    assert.deepEqual(presentationOffsets(model,plan,100,corrections),explosionOffsets(plan,100),'assembly reset retains automatic layout');
    assert.deepEqual(presentationOffsets(model,null,100,new Map()),new Map());
    assert.equal(snapshot,JSON.stringify([...nodes]),'imported transforms are immutable');
    assert.ok(correctionSnapshot.includes('part'));
    assert.throws(()=>correctionToWorld(model,'assembly','part','assembly',[NaN,0,0]),/finite/);
    assert.throws(()=>correctionToWorld(model,'assembly','other','assembly',[1,0,0]),/inside/);
    assert.throws(()=>correctionToWorld(model,'assembly','part','unknown',[1,0,0]),/axes/);
    assert.throws(()=>presentationOffsets(model,plan,NaN),/finite/);
    assert.throws(()=>presentationOffsets(model,plan,100,new Map([['other',[1,2,3]]])),/outside/);
    // A sheared frame remains usable; a collapsed parent must fail rather than
    // silently produce NaNs or move along an unrelated axis.
    const sheared=new Matrix4().set(1,.4,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1);
    nodes.get('part').worldMatrix=rows(sheared);
    const shearWorld=correctionToWorld(model,'assembly','part','local',[1,2,3]);
    close(correctionInAxes(model,'assembly','part','local',shearWorld),[1,2,3]);
    nodes.get('nested').worldMatrix=rows(new Matrix4().makeScale(1,0,1));
    assert.throws(()=>correctionToWorld(model,'assembly','part','local',[1,0,0]),/collapsed|parallel/);
    console.log('Manual offsets passed: physical-inch local/assembly axes, rotated/reflected/scaled/sheared placements, nested inheritance, independent instances, slider interpolation, exact zero, resets, invalid/singular input, and immutable transforms.');
})().catch(error=>{console.error(error);process.exitCode=1;});
