const assert=require('node:assert/strict');
(async()=>{
    const {Group,Matrix4}=await import('three');
    const {buildOriginGuides}=await import('../assembly/origin-guides.mjs');
    const identity=[[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]];
    const model={nodes:new Map([['p',{id:'p',definitionId:'d',children:[],worldMatrix:identity}]]),definitions:new Map([['d',{bounds:{min:[0,0,0],max:[4,2,.75]}}]])};
    const object=new Group();object.matrixWorld=new Matrix4().makeTranslation(3,-2,0);
    const objects=new Map([['p',object]]),offsets=new Map([['p',[3,-2,0]]]);
    assert.deepEqual(buildOriginGuides(model,offsets,objects),[{id:'p',from:[0,1,.375],to:[3,-1,.375]}]);
    assert.deepEqual(buildOriginGuides(model,new Map([['p',[0,0,0]]]),objects),[],'no lines at assembled 0%');
    object.visible=false;assert.deepEqual(buildOriginGuides(model,offsets,objects),[],'hidden parts have no guides');object.visible=true;
    const parent=new Group();parent.visible=false;parent.add(object);
    assert.deepEqual(buildOriginGuides(model,offsets,objects),[],'hidden ancestors suppress guides');
    assert.deepEqual(buildOriginGuides(null,offsets,objects),[]);
    assert.deepEqual(model.nodes.get('p').worldMatrix,identity,'source transforms are untouched');
    console.log('Origin guides passed: correct source/current endpoints, hidden-part filtering, no guides at zero, and immutable transforms.');
})().catch(error=>{console.error(error);process.exitCode=1;});
