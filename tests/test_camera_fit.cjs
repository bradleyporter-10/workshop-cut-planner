const assert=require('node:assert/strict');
(async()=>{
    const {PerspectiveCamera,OrthographicCamera,Vector3}=await import('three');
    const {fitCameraToPoints}=await import('../assembly/camera-fit.mjs');
    const points=Array.from({length:8},(_,i)=>new Vector3((i&1)?80:-80,(i&2)?6:-6,(i&4)?15:-15));
    const source=JSON.stringify(points);
    for(const camera of [new PerspectiveCamera(40,1,.01,10000),new OrthographicCamera(-1,1,1,-1,.01,10000)]){
        for(const [width,height,padding]of [[770,560,67],[338,480,56],[435,300,10]]){
            camera.position.set(100,-200,130);camera.up.set(0,0,1);camera.lookAt(0,0,0);
            const fit=fitCameraToPoints(camera,points,width,height,padding);
            assert.ok(fit);
            const projected=points.map(p=>p.clone().project(camera));
            const usableX=1-2*padding/width,usableY=1-2*padding/height;
            for(const p of projected){
                assert.ok(Math.abs(p.x)<=usableX+1e-8&&Math.abs(p.y)<=usableY+1e-8,'all geometry stays inside reserved bubble margins');
                assert.ok(p.z>=-1&&p.z<=1,'all geometry stays inside depth frustum');
            }
            const utilization=Math.max(...projected.flatMap(p=>[Math.abs(p.x)/usableX,Math.abs(p.y)/usableY]));
            assert.ok(utilization>.96,'the limiting axis fills available pixels instead of using a loose sphere');
        }
    }
    const front=new OrthographicCamera(-1,1,1,-1,.01,10000);front.position.set(0,-200,0);front.up.set(0,0,1);front.lookAt(0,0,0);
    fitCameraToPoints(front,points,435,300,10);
    const xs=points.map(p=>(p.clone().project(front).x+1)*435/2);
    assert.ok(Math.max(...xs)-Math.min(...xs)>410,'wide front reference fills almost the entire available width');
    assert.equal(JSON.stringify(points),source,'fitting never changes source geometry');
    assert.equal(fitCameraToPoints(front,[],435,300),null);
    console.log('Camera fitting passed: tight perspective/orthographic framing, explicit bubble margins, phone/desktop sizes, maximized front preview, depth clipping, and source immutability.');
})().catch(error=>{console.error(error);process.exitCode=1;});
