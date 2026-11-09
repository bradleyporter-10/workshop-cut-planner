// Real Chrome + temporary localhost host, using built-in Node APIs only (Node 22+).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const {spawn} = require('node:child_process');
const root = path.resolve(__dirname,'..');
const chromePath = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const prefix = '/workshop-cut-planner/';
const mime = {'.html':'text/html','.js':'text/javascript','.webmanifest':'application/manifest+json','.png':'image/png'};
let deploymentRevision = 0, htmlRevision = 0;
const server = http.createServer((req,res)=>{
    const pathname = new URL(req.url,'http://localhost').pathname;
    if (!pathname.startsWith(prefix)) {res.writeHead(404).end();return;}
    const file = path.resolve(root,'docs',pathname.slice(prefix.length)||'index.html');
    if (!file.startsWith(path.join(root,'docs')+path.sep) || !fs.existsSync(file)) {res.writeHead(404).end();return;}
    res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'text/plain','Cache-Control':'no-store'});
    let data=fs.readFileSync(file);
    if(path.basename(file)==='sw.js'&&deploymentRevision){
        data=Buffer.from(data.toString().replace(/const CACHE_NAME = CACHE_PREFIX \+ '[^']+';/, `const CACHE_NAME = CACHE_PREFIX + 'smoke-revision-${deploymentRevision}';`));
    }
    if(path.basename(file)==='index.html'&&htmlRevision)data=Buffer.from(data.toString().replace('<body>','<body data-smoke-release="'+htmlRevision+'">'));
    res.end(data);
});
let chrome, socket, profile, deadline;
const pending = new Map();
let serial = 0;
function command(method, params={}, sessionId) {
    return new Promise((resolve,reject)=>{
        const id=++serial;
        pending.set(id,{resolve,reject});
        socket.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));
    });
}
(async()=>{
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const url = `http://127.0.0.1:${server.address().port}${prefix}`;
    profile = fs.mkdtempSync(path.join(os.tmpdir(),'cut-planner-pwa-'));
    chrome = spawn(chromePath,['--headless','--disable-gpu','--no-first-run','--no-default-browser-check',
        '--disable-background-networking','--disable-sync','--disable-extensions',
        '--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{stdio:['ignore','ignore','pipe']});
    const endpoint = await new Promise((resolve,reject)=>{
        let output='';
        deadline=setTimeout(()=>reject(Error('Chrome startup timed out')),15000);
        chrome.once('error',reject);
        chrome.stderr.on('data',bytes=>{
            output+=bytes;
            const found=output.match(/DevTools listening on (ws:\/\/[^\s]+)/);
            if(found){clearTimeout(deadline);resolve(found[1]);}
        });
    });
    socket = new WebSocket(endpoint);
    await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
    socket.onmessage=event=>{
        const message=JSON.parse(event.data), task=pending.get(message.id);
        if(task){pending.delete(message.id);message.error?task.reject(Error(message.error.message)):task.resolve(message.result);}
    };
    const {targetId}=await command('Target.createTarget',{url:'about:blank'});
    const {sessionId}=await command('Target.attachToTarget',{targetId,flatten:true});
    const evaluate = async expression=>{
        const result=await command('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true},sessionId);
        if(result.exceptionDetails)throw Error(result.exceptionDetails.text+': '+result.result.description);
        return result.result.value;
    };
    await command('Page.enable',{},sessionId);
    await command('Network.enable',{},sessionId);
    await command('Page.navigate',{url},sessionId);
    async function waitFor(expression) {
        for(let i=0;i<100;i++){
            if(await evaluate(expression))return;
            await new Promise(resolve=>setTimeout(resolve,100));
        }
        throw Error('Timed out waiting for '+expression);
    }
    await waitFor('document.readyState === "complete" && typeof loadSkpIntoParts === "function"');
    await evaluate('navigator.serviceWorker.ready.then(()=>true)');
    await waitFor('!!navigator.serviceWorker.controller');
    await evaluate(`(()=>{const event=new Event('beforeinstallprompt');event.prompt=()=>Promise.resolve();event.userChoice=Promise.resolve({outcome:'accepted'});window.dispatchEvent(event);document.getElementById('pwa-install').click();return true;})()`);
    await waitFor("document.getElementById('pwa-install').hidden");
    assert.equal(await evaluate("getComputedStyle(document.getElementById('pwa-install')).display"),'none','hidden install is not overridden by toolbar CSS');
    const registration=await evaluate('navigator.serviceWorker.ready.then(r=>r.scope)');
    assert.equal(registration,url);
    const manifest=await command('Page.getAppManifest',{},sessionId);
    assert.equal(manifest.errors.length,0,JSON.stringify(manifest.errors));
    await command('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0},sessionId);
    await command('Page.reload',{},sessionId);
    await waitFor('document.readyState === "complete" && typeof loadSkpIntoParts === "function" && !navigator.onLine');
    const fixture=fs.readFileSync(path.join(root,'sketchup-examples/playroom cabinets.skp')).toString('base64');
    const count=await evaluate(`(async()=>{const bytes=Uint8Array.from(atob(${JSON.stringify(fixture)}),c=>c.charCodeAt(0));await loadSkpIntoParts(new File([bytes],'fixture.skp'));return parts.length;})()`);
    assert.ok(count>0);
    await evaluate(`demo(); $('optimize').click(); parts[0].name='A long descriptive cabinet component name that should fit on a small phone'; materials[0].name='A long descriptive plywood material name for testing'; renderAll(); renderResults(); true`);
    const consolidation=await evaluate(`(()=>{
        const original=last,checks=[];
        for(const kind of ['sheet','lumber']){
            const b=original.layouts.find(layout=>layout.kind===kind);
            if(!b)throw Error('Example must include '+kind);
            last={...original,layouts:[b,{...b},{...b}]};
            renderResults();
            preparePrintRoot();
            checks.push({kind,cards:document.querySelectorAll('#layouts>.sheet-card').length,
                repeat:document.querySelector('#layouts>.sheet-card').dataset.repeatCount,
                heading:document.querySelector('#layouts h3').textContent,
                pages:document.querySelectorAll('#print-root .sheet-card:not(.print-cover)').length,
                parts:+document.querySelector('#summary .stat strong').textContent,expected:b.count*3});
            cleanupPrintRoot();
        }
        last=original;renderResults();
        return JSON.stringify(checks);
    })()`);
    for(const check of JSON.parse(consolidation)){
        assert.equal(check.cards,1);
        assert.equal(check.pages,1,'identical layouts print once');
        assert.equal(check.repeat,'3');
        assert.ok(check.heading.includes('1–3 · Repeat 3 times'));
        assert.equal(check.parts,check.expected,'totals still count all physical pieces');
    }
    for(const width of [320,375,390,600,768,1366]) {
        await command('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<800},sessionId);
        await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))');
        const layout=await evaluate(`JSON.stringify({
            viewport:document.documentElement.clientWidth,
            page:document.documentElement.scrollWidth,
            overflows:Array.from(document.querySelectorAll('main .tablewrap')).filter(el=>el.scrollWidth>el.clientWidth+1).length,
            tableDisplay:getComputedStyle(document.querySelector('#materials tr')).display,
            labeled:!!document.querySelector('#parts td[data-label="Part label"]')
        })`);
        const optimizeFields=JSON.parse(await evaluate("JSON.stringify(['kerf','margin','quality','layoutgoal','diagramscale'].map(id=>{const field=document.getElementById(id),label=field.closest('label'),caption=label.querySelector('.labelcap');return {top:field.getBoundingClientRect().top,row:label.getBoundingClientRect().top,gap:field.getBoundingClientRect().top-caption.getBoundingClientRect().bottom};}))"));
        for(const field of optimizeFields){
            assert.ok(field.gap>=5&&field.gap<=7,`caption stays directly above control at ${width}px`);
            for(const other of optimizeFields)if(Math.abs(field.row-other.row)<1)assert.ok(Math.abs(field.top-other.top)<1,`Optimize controls align at ${width}px`);
        }
        const metrics=JSON.parse(layout);
        assert.ok(metrics.page<=metrics.viewport+1,`Page overflows at ${width}px: ${layout}`);
        if(width<=800){
            const toolbar=JSON.parse(await evaluate("JSON.stringify({header:Array.from(document.querySelectorAll('header .controls>.btn,header .controls>.units-control')).filter(el=>!el.hidden).map(el=>el.getBoundingClientRect().height),parts:Array.from(document.querySelectorAll('.parts-toolbar>.btn')).map(el=>({width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height}))})"));
            assert.ok(await evaluate("Math.abs(document.getElementById('pwa-refresh').getBoundingClientRect().top-document.getElementById('saveproject').getBoundingClientRect().top)<1"),'refresh stays on the same mobile toolbar line');
            assert.ok(toolbar.header.every(height=>height===36),'header actions have consistent compact height');
            assert.ok(toolbar.parts.every(item=>item.height===36),'parts actions have consistent compact height');
            assert.ok(toolbar.parts.every(item=>Math.abs(item.width-toolbar.parts[0].width)<1),'parts actions use equal widths');
            const fields=JSON.parse(await evaluate("JSON.stringify(['kerf','margin','quality','layoutgoal','diagramscale'].map(id=>{const r=document.getElementById(id).getBoundingClientRect();return {x:r.x,y:r.y};}))"));
            for(let i=0;i+1<fields.length;i+=2){
                if(fields[i].x!==fields[i+1].x)assert.ok(Math.abs(fields[i].y-fields[i+1].y)<1,'Optimize fields align despite wrapped labels');
            }
            assert.ok(await evaluate("Array.from(document.querySelectorAll('.mobile-section-content')).every(el=>getComputedStyle(el).display==='none')"),'mobile result sections start collapsed');
            await evaluate("document.querySelector('#layoutparts .mobile-section-toggle').click();true");
            assert.notEqual(await evaluate("getComputedStyle(document.querySelector('#layoutparts .mobile-section-content')).display"),'none');
            await evaluate("document.querySelector('#layoutparts .mobile-section-toggle').click();true");
            if(width===320){
                const counts=await evaluate('JSON.stringify({parts:parts.length,materials:materials.length})');
                await evaluate("document.querySelector('#parts tr:last-child .mobile-row-remove').click();document.querySelector('#materials tr:last-child .mobile-row-remove').click();true");
                const before=JSON.parse(counts);
                assert.equal(await evaluate('parts.length'),before.parts-1,'collapsed part removed directly');
                assert.equal(await evaluate('materials.length'),before.materials-1,'collapsed material removed directly');
                assert.equal(await evaluate("document.querySelectorAll('#parts .mobile-editing,#materials .mobile-editing').length"),0,'removal does not open editor');
            }
            assert.equal(metrics.overflows,0,`Tables overflow at ${width}px`);
            assert.equal(metrics.tableDisplay,'block');
            assert.ok(await evaluate("document.querySelector('#parts tr').getBoundingClientRect().height < 70"),'collapsed rows stay compact');
            await evaluate("document.querySelector('#parts .mobile-row-toggle').click();true");
            assert.equal(await evaluate("document.querySelectorAll('#parts .mobile-editing,#materials .mobile-editing').length"),1);
            assert.equal(await evaluate("getComputedStyle(document.querySelector('#parts tr')).display"),'grid');
            await evaluate("{const field=document.querySelector('#parts tr input[data-field=name]');field.value='Edited mobile part';field.dispatchEvent(new Event('input',{bubbles:true}));}true");
            assert.equal(await evaluate("parts[0].name"),'Edited mobile part');
            assert.equal(await evaluate("document.querySelector('#parts .mobile-row-name').textContent"),'Edited mobile part');
            await evaluate("document.querySelector('#materials .mobile-row-toggle').click();true");
            assert.equal(await evaluate("document.querySelectorAll('#parts .mobile-editing,#materials .mobile-editing').length"),1,'only one editor stays open');
            await evaluate("document.querySelector('#materials .mobile-row-toggle').click();true");
            assert.ok(metrics.labeled);
        }
        if(width===1366){
            assert.equal(metrics.tableDisplay,'table-row','desktop table layout retained');
            assert.ok(await evaluate("Array.from(document.querySelectorAll('.mobile-section-content')).every(el=>getComputedStyle(el).display!=='none')"),'desktop result sections remain visible');
        }
    }
    await command('Emulation.setDeviceMetricsOverride',{width:390,height:900,deviceScaleFactor:1,mobile:true},sessionId);
    await command('Emulation.setEmulatedMedia',{media:'print'},sessionId);
    assert.equal(await evaluate("getComputedStyle(document.querySelector('.cut-sequence-table tbody tr')).display"),'table-row','printed cut list remains a table');
    assert.ok(await evaluate("Array.from(document.querySelectorAll('.mobile-section-content')).every(el=>getComputedStyle(el).display!=='none')"),'collapsed mobile sections stay visible in print');
    await command('Emulation.setEmulatedMedia',{media:''},sessionId);
    const lumber=JSON.parse(await evaluate(`(()=>{
        const m={id:'wide-board',name:'6-inch lumber',type:'lumber',width:6,length:96,thickness:.75};
        const p={name:'Rail',width:2.5,length:80,thickness:.75,material:m.id};
        const plans=boardPlan(m,[{...p},{...p}],.125,0);
        last={layouts:plans,kerf:.125,margin:0};renderResults();
        return JSON.stringify({boards:plans.length,lanes:plans[0].placements.map(z=>z.y),
            cuts:plans[0].cuts.length,rows:document.querySelectorAll('.cut-sequence-table tbody tr').length,
            text:document.querySelector('.cut-sequence-table').textContent});
    })()`));
    assert.equal(lumber.boards,1,'two narrow rails share one wide board in the actual app');
    assert.notEqual(lumber.lanes[0],lumber.lanes[1]);
    assert.equal(lumber.rows,lumber.cuts);
    assert.ok(lumber.text.includes('rip')&&lumber.text.includes('crosscut'));
    console.log('PASS: Two 2.5-inch rails share one 6-inch board, with rip cuts and crosscuts in the output.');
    const balancedUI=JSON.parse(await evaluate(`(()=>{
        materials=[{id:'balanced-ui',name:'Plywood',type:'sheet',width:48,length:96,thickness:.75}];
        parts=[[13,36],[22,60],[7,24],[10,28],[25,16],[10,16],[13,44],[22,20],[13,60],[10,52],[25,40],[19,24],[4,36],[4,36]].map(([width,length],i)=>({id:uid(),name:'Part '+i,width,length,thickness:.75,quantity:1,material:'balanced-ui'}));
        renderAll();$('quality').value='better';$('layoutgoal').value='balanced';$('optimize').click();
        return JSON.stringify({goal:last.layoutGoal,effort:sheetPlanEffort(last.layouts),info:$('runinfo').textContent});
    })()`));
    assert.equal(balancedUI.goal,'balanced');
    assert.equal(balancedUI.effort.sheets,2);
    assert.equal(balancedUI.effort.cuts,24);
    assert.ok(balancedUI.info.includes('Balanced'));
    console.log('PASS: Balanced UI generates a lower-cut plan and records the selected goal.');
    const preference=await evaluate(`(async()=>{
        $('layoutgoal').value='balanced';
        let savedJSON;
        const originalDownload=download;
        download=(name,content)=>savedJSON=content;
        $('saveproject').click();
        download=originalDownload;
        if(JSON.parse(savedJSON).layoutGoal!=='balanced')throw Error('Goal was not saved');
        $('layoutgoal').value='material';
        await $('projectfile').onchange({target:{files:[{text:async()=>savedJSON}]}});
        if($('layoutgoal').value!=='balanced')throw Error('Goal was not restored');
        const legacy=JSON.parse(savedJSON);delete legacy.layoutGoal;
        await $('projectfile').onchange({target:{files:[{text:async()=>JSON.stringify(legacy)}]}});
        if($('layoutgoal').value!=='material')throw Error('Legacy project did not use the default');
        return true;
    })()`);
    assert.ok(preference,'planning preference saves/restores with backwards-compatible defaults');
    htmlRevision=1;
    await command('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1},sessionId);
    await command('Page.reload',{},sessionId);
    await waitFor("document.readyState==='complete' && document.body.dataset.smokeRelease==='1' && !!document.getElementById('pwa-refresh')");
    assert.equal(await evaluate('document.body.dataset.smokeRelease'),'1','ordinary reload shows changed HTML without a worker update or cache bypass');
    await command('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0},sessionId);
    await command('Page.reload',{},sessionId);
    await waitFor("document.readyState==='complete' && document.body.dataset.smokeRelease==='1' && !navigator.onLine");
    console.log('PASS: Normal online reload fetches changed server HTML; the same latest page then reloads offline.');
    deploymentRevision=1;
    await command('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1},sessionId);
    await evaluate('navigator.serviceWorker.getRegistration().then(r=>r.update()).then(()=>true)');
    await waitFor('navigator.serviceWorker.getRegistration().then(r=>!!r.waiting)');
    await waitFor("document.querySelector('header #pwa-refresh')?.dataset.updateReady==='true'");
    assert.ok(await evaluate("!document.getElementById('pwa-update-banner').hidden && document.body.firstElementChild.id==='pwa-update-banner'"),'update banner is visible across the top');
    assert.ok(await evaluate("document.getElementById('pwa-refresh').title.includes('Save your project')"));
    assert.equal(await evaluate("getComputedStyle(document.getElementById('pwa-refresh'),'::after').backgroundColor"),'rgb(34, 197, 94)','update badge is green');

    await evaluate("window.__beforePwaRefresh=true;window.confirm=()=>true;document.getElementById('pwa-refresh').click();true");
    await waitFor("document.readyState==='complete' && typeof window.__beforePwaRefresh==='undefined' && !!document.getElementById('pwa-refresh') && caches.keys().then(keys=>keys.some(key=>key.endsWith('smoke-revision-1')))");
    console.log('PASS: Install control hides correctly; a simulated deployment is detected and activated through Refresh app.');
    console.log('PASS: Mobile page widths 320–768px fit the viewport; phone tables use labeled cards; desktop tables remain intact.');
    console.log(`PASS: Chrome validated the manifest, controlled the repository subpath, reloaded offline, and imported ${count} grouped SKP parts.`);
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{
    clearTimeout(deadline);
    if(socket){try{await command('Browser.close');}catch{}socket.close();}
    if(chrome&&chrome.exitCode===null){chrome.kill();await new Promise(resolve=>{chrome.once('exit',resolve);setTimeout(resolve,3000);});}
    server.closeAllConnections();
    await new Promise(resolve=>server.close(resolve));
    if(profile)fs.rmSync(profile,{recursive:true,force:true,maxRetries:5,retryDelay:100});
});
