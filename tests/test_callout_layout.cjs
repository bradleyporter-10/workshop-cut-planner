const assert=require('node:assert/strict');
(async()=>{
    const {projectedObstacle,clearCallout,clearDimensionLine,placeExternalCallouts}=await import('../assembly/callout-layout.mjs');
    const geometry=[{x:100,y:80,width:200,height:200},{x:320,y:130,width:80,height:140}];
    const items=Array.from({length:16},(_,id)=>({id,anchor:{x:180+id*5,y:170},width:36,height:36}));
    const result=placeExternalCallouts(items,520,440,geometry,[],30);
    assert.ok(result.length>10,'perimeter search finds room for circular callouts');
    for(let i=0;i<result.length;i++)assert.ok(clearCallout(result[i].rect,520,440,geometry,result.slice(0,i).map(item=>item.rect)),'callouts are outside every geometry bound and each other');
    assert.deepEqual(result,placeExternalCallouts(items,520,440,geometry,[],30));
    assert.deepEqual(placeExternalCallouts(items,200,200,[{x:0,y:0,width:200,height:200}]),[],'omit rather than cover geometry');
    assert.ok(!clearDimensionLine({x:0,y:100},{x:500,y:100},geometry));
    assert.ok(clearDimensionLine({x:0,y:40},{x:500,y:40},geometry));
    assert.ok(!clearDimensionLine({x:120,y:0},{x:120,y:400},geometry));
    assert.deepEqual(projectedObstacle([{x:30,y:40,z:0},{x:60,y:100,z:0}],200,200),{x:22,y:32,width:46,height:76});
    assert.equal(projectedObstacle([{x:300,y:30,z:0},{x:400,y:100,z:0}],200,200),null);
    assert.deepEqual(projectedObstacle([{x:30,y:40,z:-2},{x:60,y:100,z:0}],200,200),{x:0,y:0,width:200,height:200});
    console.log('External callouts passed: deterministic perimeter placement, all-part geometry exclusion, annotation separation, dimension-line clearance, clipping, and safe omission.');
})().catch(error=>{console.error(error);process.exitCode=1;});
