const assert = require('node:assert/strict');
(async()=>{
    const {Matrix4}=await import('three');
    const {assemblyViews,hasFrontObstruction,presetDirection,partShade,referenceContext}=await import('../assembly/view-presets.mjs');
    const identity=[[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]];
    const definition=(min,max)=>({bounds:{min,max}});
    const model={rootId:'root',nodes:new Map(),definitions:new Map([
        ['body',definition([0,0,0],[30,12,30])],['door',definition([0,-1,0],[14.9,0,30])],['empty',{bounds:null}]
    ])};
    model.nodes.set('root',{id:'root',name:'Model',parentId:null,definitionId:'empty',children:['cab1','cab2'],localMatrix:identity,worldMatrix:identity});
    for(const id of ['cab1','cab2'])model.nodes.set(id,{id,name:'Cabinet',parentId:'root',definitionId:'body',children:[],localMatrix:identity,worldMatrix:identity});
    function addDoor(id,parent,x){
        const matrix=identity.map(row=>row.slice());matrix[0][3]=x;
        model.nodes.set(id,{id,name:'Unrelated name',parentId:parent,definitionId:'door',children:[],localMatrix:matrix,worldMatrix:matrix});
        model.nodes.get(parent).children.push(id);
    }
    addDoor('left','cab1',0);addDoor('right','cab1',15.1);
    assert.ok(hasFrontObstruction(model,'cab1'),'paired front panels detected geometrically');
    assert.ok(!hasFrontObstruction(model,'cab2'));
    assert.ok(presetDirection(model,'cab1').rear);
    assert.ok(presetDirection(model,'cab1').direction.y>0);
    assert.ok(presetDirection(model,'cab2').direction.y<0);
    assert.ok(presetDirection(model,'cab1','front').direction.y<0);
    assert.ok(presetDirection(model,'cab1','top').direction.z>.99);
    model.nodes.get('cab2').children=['left'];
    const views=assemblyViews(model);
    assert.deepEqual(views.map(v=>v.label),['Overview','Cabinet · Build ×1','Cabinet · variant 2 · Build ×1']);
    assert.equal(new Set(views.map(v=>v.id)).size,3,'instance keys remain unique across duplicate names');
    assert.deepEqual(assemblyViews(null),[]);
    const rotated=identity.map(row=>row.slice());rotated[0][0]=0;rotated[0][1]=-1;rotated[1][0]=1;rotated[1][1]=0;rotated[0][3]=80;
    model.nodes.set('cab3',{...model.nodes.get('cab1'),id:'cab3',children:['left3','right3'],localMatrix:rotated,worldMatrix:rotated});
    for(const [id,source] of [['left3','left'],['right3','right']])model.nodes.set(id,{...model.nodes.get(source),id,parentId:'cab3'});
    const grouped=assemblyViews(model),cabinet=grouped.find(view=>view.id==='cab1');
    assert.deepEqual(cabinet.memberIds,['cab1','cab3'],'translated/rotated copies share one build view');
    assert.equal(cabinet.count,2);assert.ok(cabinet.label.includes('Build ×2'));
    assert.equal(referenceContext(model,cabinet.memberIds),'root');
    assert.equal(referenceContext(model,['left','left3']),'root','nested duplicates reference their common ancestor');
    assert.equal(referenceContext(model,['left']),'cab1');
    model.nodes.get('cab3').materialId='different wood';
    assert.equal(assemblyViews(model).find(view=>view.id==='cab1').count,1,'different materials do not merge');
    delete model.nodes.get('cab3').materialId;
    const scaled=identity.map(row=>row.slice());scaled[0][0]=2;model.nodes.get('cab3').worldMatrix=scaled;
    assert.equal(assemblyViews(model).find(view=>view.id==='cab1').count,1,'scaled copies stay distinct');
    scaled[0][0]=-1;
    assert.equal(assemblyViews(model).find(view=>view.id==='cab1').count,1,'opposite handedness stays distinct');

    assert.equal(partShade('root/2/3'),partShade('root/2/3'));
    assert.ok(new Set(Array.from({length:10},(_,i)=>partShade('root/'+i))).size>1,'adjacent instances have distinct palette shades');
    const part={instanceId:'one',definitionId:'rail',materialId:'wood',dimensions:[80,3.5,.75]};
    assert.equal(partShade(part),partShade({...part,instanceId:'two'}),'repeated geometry shares its color');
    assert.equal(partShade({...part,optimizationLabel:'Z'}),partShade({...part,instanceId:'other',definitionId:'copy',optimizationLabel:'Z'}),'same optimizer part shares its color across definitions');
    assert.ok(new Set(Array.from({length:10},(_,i)=>partShade({...part,optimizationLabel:String.fromCharCode(65+i)}))).size>1,'different optimizer parts retain distinct shades');
    const hierarchy={rootId:'root',definitions:model.definitions,nodes:new Map()};
    for(const [id,parentId,children,definitionId] of [
        ['root',null,['box','support'],'empty'],['box','root',['door'],'body'],['door','box',['frame'],'door'],['frame','door',['panel'],'body'],['panel','frame',[],'door'],['support','root',['rail'],'door'],['rail','support',[],'body']
    ])hierarchy.nodes.set(id,{id,name:id,parentId,children,definitionId,localMatrix:identity,worldMatrix:identity});
    const buildOrder=assemblyViews(hierarchy);
    assert.deepEqual(buildOrder.map(view=>view.id),['root','frame','support','door','box'],'build smaller nested assemblies before their parents, preserving same-level order');
    assert.deepEqual(assemblyViews(hierarchy),buildOrder,'build order is deterministic');
    const before=JSON.stringify([...model.nodes]);
    presetDirection(model,'cab1');assemblyViews(model);
    assert.equal(before,JSON.stringify([...model.nodes]));
    console.log('View presets passed: hierarchy/duplicate names, geometric front obstruction including paired doors, automatic rear view, explicit presets, stable distinct shades, and immutable source.');
})().catch(error=>{console.error(error);process.exitCode=1;});
