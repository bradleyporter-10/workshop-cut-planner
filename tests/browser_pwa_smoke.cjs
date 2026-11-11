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
const mime = {'.html':'text/html','.js':'text/javascript','.webmanifest':'application/manifest+json','.png':'image/png','.json':'application/json'};
let deploymentRevision = 0, htmlRevision = 0, releaseRevision = 0;
const originalVersion=JSON.parse(fs.readFileSync(path.join(root,'package.json'))).version;
const versionParts=originalVersion.split('.').map(Number);versionParts[2]++;
const nextVersion=versionParts.join('.');
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
    if(releaseRevision&&path.basename(file)==='version.json')data=Buffer.from(JSON.stringify({version:nextVersion}));
    if(deploymentRevision&&['index.html','sw.js'].includes(path.basename(file)))data=Buffer.from(data.toString().replaceAll(originalVersion,nextVersion));
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
    chrome = spawn(chromePath,['--headless','--disable-gpu','--enable-unsafe-swiftshader','--no-first-run','--no-default-browser-check',
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
    await evaluate(`(async()=>{
        const details=$('parts-list-details');
        if(!$('print').hidden)throw Error('Print visible before optimization');
        if(details.open)throw Error('Parts list should start collapsed');
        $('addpart').click();
        if(!details.open||!$('parts-list-summary').textContent.includes('1 piece'))throw Error('Add part did not expand or summarize list');
        const quantity=$('parts').querySelector('[data-field=quantity]');quantity.value='3';quantity.dispatchEvent(new Event('input',{bubbles:true}));
        if(!$('parts-list-summary').textContent.includes('3 pieces'))throw Error('Summary did not follow quantity edits');
        const csv='name,width,length,thickness,quantity,material\\nCSV part,12,24,0.75,2,3/4 Plywood';
        const originalAlert=window.alert;window.alert=()=>{};
        try{await $('csvfile').onchange({target:{files:[new File([csv],'parts.csv')],value:''}});}finally{window.alert=originalAlert;}
        if(details.open||parts.length!==2||!$('parts-list-summary').textContent.includes('5 pieces'))throw Error('CSV import did not collapse or summarize list');
        $('addpart').click();if(!details.open)throw Error('Manual addition after import did not expand list');
        return true;
    })()`);
    const fixture=fs.readFileSync(path.join(root,'sketchup-examples/playroom cabinets.skp')).toString('base64');
    const count=await evaluate(`(async()=>{const bytes=Uint8Array.from(atob(${JSON.stringify(fixture)}),c=>c.charCodeAt(0));await loadSkpIntoParts(new File([bytes],'fixture.skp'));return parts.length;})()`);
    assert.ok(count>0);
    assert.ok(await evaluate("$('print').hidden"),'import hides print until successful optimization');
    assert.ok(await evaluate("!$('parts-list-details').open&&$('parts-list-summary').textContent.includes('Loaded '+parts.length+' grouped parts')&&!$('errors').textContent.includes('Loaded '+parts.length+' grouped parts')"),'SketchUp import collapses and summarizes the parts table');
    assert.ok(await evaluate("document.getElementById('result-tabs').hidden&&document.getElementById('assembly-viewer').hidden&&!document.querySelector('[data-assembly=viewport] canvas')"),'SKP import alone does not expose results tabs or initialize WebGL');
    assert.equal(await evaluate("[...document.querySelectorAll('button,label')].filter(el=>el.textContent.trim()==='Import SketchUp (SKP)').length"),1,'Parts list owns the single SketchUp import action');
    await evaluate(`(()=>{
        for(const material of materials){const assigned=parts.filter(part=>part.material===material.id);material.width=Math.max(+material.width,...assigned.map(part=>+part.width))+2;material.length=Math.max(+material.length,...assigned.map(part=>+part.length))+2;}
        $('quality').value='fast';$('kerf').value='invalid';$('optimize').click();return true;
    })()`);
    assert.ok(await evaluate("document.getElementById('result-tabs').hidden"),'failed optimization does not expose tabs');
    assert.ok(await evaluate("$('print').hidden"),'failed optimization keeps print hidden');
    await evaluate("$('kerf').value='0.125';$('optimize').click();true");
    assert.ok(await evaluate("!$('print').hidden"),'successful optimization shows print');
    assert.ok(await evaluate("!document.getElementById('result-tabs').hidden&&!document.getElementById('results').hidden&&document.getElementById('assembly-viewer').hidden&&document.getElementById('cutting-layouts-tab').getAttribute('aria-selected')==='true'"),'successful SKP optimization defaults to cutting layouts');

    await evaluate("document.getElementById('exploded-views-tab').click();true");
    await waitFor("!!document.querySelector('[data-assembly=viewport] canvas')");
    const optimizedLabels=await evaluate(`(()=>{
        const find=role=>document.querySelector('[data-assembly="'+role+'"]');
        if(find('labels').value!=='optimization')throw Error('Optimization letters are not the default');
        if(find('dimensions')||document.querySelector('[data-dimension-instance],.assembly-reference-dimensions'))throw Error('Dimensions must appear only in the summary table');
        const catalog=assemblyViewer.getPresentationState().parts;
        const rows=new Map(last.layouts.flatMap(layout=>layout.placements.map(z=>[z.p.sourcePartId,activePartLabels.get(partKey(z.p))])));
        let matched=0;
        for(const part of catalog){const id=skpPartLinks.get(part.instanceId);if(!id)continue;if(part.optimizationLabel!==rows.get(id))throw Error('Viewer letter differs from cut layout');matched++;}
        if(document.querySelector('[data-label-instance]'))throw Error('Overview should have no callouts');
        const viewTabs=find('views').querySelectorAll('[role=tab]');viewTabs[1].click();
        const labels=[...document.querySelectorAll('[data-label-instance]')];
        if(!labels.length)throw Error('Default optimization labels did not render');
        for(const label of labels){const part=catalog.find(p=>p.instanceId===label.dataset.labelInstance);if(label.querySelector('title').textContent!==(part.optimizationLabel||'—'))throw Error('Default label is not optimization-letter only');}
        viewTabs[0].click();
        return matched;
    })()`);
    assert.ok(optimizedLabels>100,'real imported instances use cutting-layout letters');
    const assemblyState = JSON.parse(await evaluate(`(()=>{
        const model=assemblyViewer.getModel();
        const before=JSON.stringify(parts);
        const snapshot=JSON.stringify([...model.nodes.values()]);
        const tree=document.querySelector('[data-assembly=tree]');
        const buttons=tree.querySelectorAll('button');
        buttons[1].click();
        const selected=tree.querySelectorAll('button[aria-pressed=true]').length;
        const checkbox=tree.querySelector('input');checkbox.click();checkbox.click();
        const projection=document.querySelector('[data-assembly=projection]');
        projection.value='orthographic';projection.dispatchEvent(new Event('change'));
        document.querySelector('[data-assembly=isometric]').click();
        document.querySelector('[data-assembly=fit]').click();
        document.querySelector('[data-assembly=reset]').click();
        const result={nodes:model.nodes.size,buttons:buttons.length,selected,
            unchanged:before===JSON.stringify(parts)&&snapshot===JSON.stringify([...model.nodes.values()]),
            canvasWidth:document.querySelector('[data-assembly=viewport] canvas').width,
            status:document.querySelector('[data-assembly=status]').textContent};
        document.getElementById('cutting-layouts-tab').click();
        return JSON.stringify(result);
    })()`));
    assert.equal(assemblyState.buttons,assemblyState.nodes,'all instance IDs have tree entries');
    assert.equal(assemblyState.selected,1);
    assert.ok(assemblyState.canvasWidth>100&&assemblyState.unchanged);
    assert.equal(assemblyState.status,'','clean imports need no technical status text');
    await evaluate("document.getElementById('exploded-views-tab').click();true");
    const explosionCheck = JSON.parse(await evaluate(`(()=>{
        const find=role=>document.querySelector('[data-assembly="'+role+'"]');
        const model=assemblyViewer.getModel();
        const source=JSON.stringify([...model.nodes.values()]), cutList=JSON.stringify(parts);
        const assembled=JSON.stringify(assemblyViewer.getPresentationState().worldMatrices);
        const target=[...model.nodes.values()].find(n=>n.parentId&&n.children.length>1);
        const pick=id=>[...find('tree').querySelectorAll('button')].find(b=>b.dataset.instanceId===id).click();
        pick(target.id);find('explode').click();
        if(assemblyViewer.getPresentationState().amount!==50)throw Error('Explode button did not default to 50%');find('amount').value='100';find('amount').dispatchEvent(new Event('input'));
        const full=assemblyViewer.getPresentationState();
        if(!full.isolated||full.assemblyId!==target.id||full.amount!==100||!full.offsets.length)throw Error('Selected assembly was not exploded');
        if(full.positions.filter(([,v])=>v.some(x=>x!==0)).length!==full.offsets.length)throw Error('Presentation wrappers did not move');
        find('amount').value='50';find('amount').dispatchEvent(new Event('input'));
        find('isolate').click();if(assemblyViewer.getPresentationState().isolated)throw Error('Isolation toggle failed');find('isolate').click();
        const half=assemblyViewer.getPresentationState();
        if(JSON.stringify(half.offsets)!==JSON.stringify(full.offsets.map(([id,v])=>[id,v.map(x=>x/2)])))throw Error('Slider did not interpolate');
        find('spacing').value='2';find('spacing').dispatchEvent(new Event('change'));
        if(assemblyViewer.getPresentationState().amount!==50)throw Error('Spacing changed percentage');
        find('direction').value='+x';find('direction').dispatchEvent(new Event('change'));
        if(!assemblyViewer.getPresentationState().offsets.every(([,v])=>v[0]>0&&v[1]===0&&v[2]===0))throw Error('Direction override failed');
        find('amount').value='0';find('amount').dispatchEvent(new Event('input'));
        if(JSON.stringify(assemblyViewer.getPresentationState().worldMatrices)!==assembled)throw Error('0% did not exactly restore all world matrices');
        find('amount').value='100';find('amount').dispatchEvent(new Event('input'));
        const leaf=[...model.nodes.values()].find(n=>!n.children.length);
        pick(leaf.id);
        if(!find('explode').disabled||assemblyViewer.getPresentationState().assemblyId!==target.id)throw Error('Leaf selection changed active assembly');
        find('restore').click();
        if(assemblyViewer.getPresentationState().assemblyId!==null||JSON.stringify(assemblyViewer.getPresentationState().worldMatrices)!==assembled)throw Error('Reset did not restore all instances');
        const second=[...model.nodes.values()].find(n=>n.parentId&&n.children.length>1&&n.id!==target.id);
        pick(target.id);find('explode').click();pick(second.id);find('explode').click();
        if(assemblyViewer.getPresentationState().positions.some(([id,v])=>v.some(x=>x!==0)&&!second.children.includes(id)))throw Error('Switching assemblies left stale offsets');
        find('restore').click();pick(target.id);find('direction').value='auto';find('direction').dispatchEvent(new Event('change'));find('spacing').value='1';find('spacing').dispatchEvent(new Event('change'));find('explode').click();
        find('viewport').scrollIntoView({block:'center'});
        return JSON.stringify({children:full.offsets.length,unchanged:source===JSON.stringify([...model.nodes.values()])&&cutList===JSON.stringify(parts)});
    })()`));
    assert.ok(explosionCheck.children>1&&explosionCheck.unchanged,'explosion keeps imported geometry and cut list intact');
    const manualCheck=await evaluate(`(()=>{
        const find=role=>document.querySelector('[data-assembly="'+role+'"]');
        const model=assemblyViewer.getModel(), scope=assemblyViewer.getPresentationState().assemblyId;
        const source=JSON.stringify([...model.nodes.values()]),cutList=JSON.stringify(parts);
        const pick=id=>[...find('tree').querySelectorAll('button')].find(button=>button.dataset.instanceId===id).click();
        const change=(role,value)=>{find(role).value=value;find(role).dispatchEvent(new Event('change'));};
        const amount=value=>{find('amount').value=value;find('amount').dispatchEvent(new Event('input'));};
        const state=()=>assemblyViewer.getPresentationState();
        const position=(s,id)=>s.worldMatrices.find(([key])=>key===id)[1].slice(12,15);
        const close=(a,b)=>{if(a.some((v,i)=>Math.abs(v-b[i])>1e-7))throw Error('Manual position mismatch: '+a+' vs '+b);};
        const leaves=state().parts.filter(part=>part.instanceId.startsWith(scope+'/')&&!model.nodes.get(part.instanceId).children.length);
        const leaf=leaves[0],other=leaves[1];
        amount('0');const zero=JSON.stringify(state().worldMatrices);
        amount('50');const automaticHalf=state();amount('100');const automatic=state();
        find('manual-apply').closest('details').open=true;pick(leaf.instanceId);
        if(find('manual-apply').disabled)throw Error('Manual controls did not enable for nested part');
        const apply=values=>{['x','y','z'].forEach((axis,i)=>{find('manual-'+axis).value=values[i];});find('manual-apply').click();};
        apply([4,-2,1]);
        const adjusted=state(),matrix=model.nodes.get(scope).worldMatrix;
        const expected=[0,1,2].map(row=>[4,-2,1].reduce((sum,v,col)=>sum+v*matrix[row][col]/Math.hypot(matrix[0][col],matrix[1][col],matrix[2][col]),0));
        if(adjusted.customOffsets.length!==1)throw Error('Correction not stored');
        close(position(adjusted,leaf.instanceId).map((v,i)=>v-position(automatic,leaf.instanceId)[i]),expected);
        const stored=JSON.stringify(adjusted.customOffsets);
        amount('50');close(position(state(),leaf.instanceId).map((v,i)=>v-position(automaticHalf,leaf.instanceId)[i]),expected.map(v=>v/2));
        amount('0');if(JSON.stringify(state().worldMatrices)!==zero||JSON.stringify(state().customOffsets)!==stored)throw Error('0% failed to restore exact assembly or preserve corrections');amount('100');
        const beforeAxes=JSON.stringify(state().worldMatrices);change('manual-axes','local');
        if(beforeAxes!==JSON.stringify(state().worldMatrices))throw Error('Axes toggle moved geometry');
        find('manual-step').value='.25';const beforeJog=state().customOffsets[0][1];
        document.querySelector('[data-manual-jog="0:1"]').click();
        const afterJog=state().customOffsets[0][1];
        close([Math.hypot(...afterJog.map((v,i)=>v-beforeJog[i]))],[.25]);
        const valid=JSON.stringify(state().customOffsets);find('manual-step').value='0';document.querySelector('[data-manual-jog="0:1"]').click();
        if(JSON.stringify(state().customOffsets)!==valid)throw Error('Invalid jog changed correction');
        find('manual-x').value='';find('manual-apply').click();if(JSON.stringify(state().customOffsets)!==valid)throw Error('Invalid input changed correction');
        find('manual-reset-part').click();if(state().customOffsets.length||JSON.stringify(state().worldMatrices)!==JSON.stringify(automatic.worldMatrices))throw Error('Selected correction reset failed');
        change('manual-axes','assembly');apply([4,-2,1]);
        const beforeLayout=JSON.stringify(state().customOffsets);change('spacing','2');change('direction','+x');
        if(JSON.stringify(state().customOffsets)!==beforeLayout)throw Error('Replanning lost corrections');
        pick(other.instanceId);apply([1,0,0]);if(state().customOffsets.length!==2)throw Error('Instances do not move independently');
        find('manual-reset-part').click();if(state().customOffsets.length!==1||state().customOffsets[0][0]!==leaf.instanceId)throw Error('Part reset changed another instance');
        const second=[...model.nodes.values()].find(n=>n.parentId&&n.children.length>1&&n.id!==scope);
        pick(second.id);find('explode').click();if(state().customOffsets.length)throw Error('Another assembly inherited corrections');
        pick(scope);find('explode').click();if(JSON.stringify(state().customOffsets)!==beforeLayout)throw Error('Returning to an assembly lost its corrections');
        find('manual-reset-assembly').click();if(state().customOffsets.length||!state().assemblyId)throw Error('Assembly correction reset lost automatic plan');
        pick(leaf.instanceId);apply([2,0,0]);find('restore').click();
        if(state().assemblyId||state().customOffsets.length||JSON.stringify(state().worldMatrices)!==zero)throw Error('Full reset failed');
        pick(scope);change('spacing','1');change('direction','auto');find('explode').click();
        if(state().customOffsets.length)throw Error('Full reset retained stored corrections');
        find('manual-apply').closest('details').open=false;
        return source===JSON.stringify([...model.nodes.values()])&&cutList===JSON.stringify(parts);
    })()`);
    assert.ok(manualCheck,'manual corrections preserve source geometry, dimensions, and cut list');
    console.log('PASS: Manual numeric offsets, physical-inch local-axis jogs, invalid input, exact 0%, interpolation, scoped retention, independent instances, and part/assembly/full reset.');
    const tabRoundTrip=await evaluate(`(()=>{
        const before=JSON.stringify(assemblyViewer.getPresentationState());
        const canvas=document.querySelector('[data-assembly=viewport] canvas');
        const cutting=document.getElementById('cutting-layouts-tab'),exploded=document.getElementById('exploded-views-tab');
        cutting.click();const hidden=document.getElementById('assembly-viewer').hidden&&!document.getElementById('results').hidden;
        cutting.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));
        return hidden&&!document.getElementById('assembly-viewer').hidden&&document.getElementById('results').hidden&&document.activeElement===exploded&&canvas===document.querySelector('[data-assembly=viewport] canvas')&&before===JSON.stringify(assemblyViewer.getPresentationState());
    })()`);
    assert.ok(tabRoundTrip,'tabs support keyboard navigation and preserve renderer/explosion state');
    await command('Emulation.setEmulatedMedia',{media:'print'},sessionId);
    assert.equal(await evaluate("getComputedStyle(document.getElementById('results')).display"),'block','cutting layouts remain printable while exploded tab is selected');
    assert.equal(await evaluate("getComputedStyle(document.getElementById('assembly-viewer')).display"),'none');
    await command('Emulation.setEmulatedMedia',{media:''},sessionId);

    const annotationCheck = JSON.parse(await evaluate(`(()=>{
        const find=role=>document.querySelector('[data-assembly="'+role+'"]');
        const change=(role,value)=>{find(role).value=value;find(role).dispatchEvent(new Event('change'));};
        const model=assemblyViewer.getModel(), state=assemblyViewer.getPresentationState();
        const before=JSON.stringify([...model.nodes.values()]), cutList=JSON.stringify(parts), numbers=JSON.stringify(state.parts);
        const scope=state.assemblyId;
        const leaf=state.parts.find(part=>part.instanceId.startsWith(scope+'/')&&!model.nodes.get(part.instanceId).children.length);
        const button=[...find('tree').querySelectorAll('button')].find(b=>b.dataset.instanceId===leaf.instanceId);
        button.click();change('labels','both');
        if(document.querySelector('[data-dimension-instance]'))throw Error('Selecting a part added drawing dimensions');
        if(!find('info').textContent.includes(leaf.number))throw Error('Selection info lacks part number');
        change('labels','none');if(document.querySelector('[data-label-instance]'))throw Error('No-label mode failed');
        change('labels','number');if(![...document.querySelectorAll('[data-label-instance] text')].every(el=>/^P[0-9]+$/.test(el.textContent)))throw Error('Number labels failed');
        change('labels','name');if(!document.querySelector('[data-label-instance]'))throw Error('Name labels failed');
        change('labels','both');
        find('leaders').checked=false;find('leaders').dispatchEvent(new Event('change'));
        if(document.querySelector('[data-label-instance] line'))throw Error('Leader toggle failed');
        find('leaders').checked=true;find('leaders').dispatchEvent(new Event('change'));
        if(!document.querySelector('[data-label-instance] line'))throw Error('Leaders missing');
        change('precision','64');
        change('precision','16');
        const checkbox=button.parentElement.querySelector('input');checkbox.click();
        if([...document.querySelectorAll('[data-label-instance],[data-dimension-instance]')].some(el=>(el.dataset.labelInstance||el.dataset.dimensionInstance)===leaf.instanceId))throw Error('Hidden part annotations remain');
        if([...find('parts-list').children].some(el=>JSON.parse(el.dataset.partInstances).includes(leaf.instanceId)))throw Error('Hidden part remains in visible legend');
        checkbox.click();
        find('amount').value='0';find('amount').dispatchEvent(new Event('input'));
        find('amount').value='100';find('amount').dispatchEvent(new Event('input'));
        if(document.querySelector('[data-dimension-instance],.assembly-reference-dimensions'))throw Error('Slider added drawing dimensions');
        if(!find('annotation-status').textContent.includes('labels shown'))throw Error('Annotation coverage missing');
        const visibleIds=[...find('parts-list').children].flatMap(el=>JSON.parse(el.dataset.partInstances));
        if(!visibleIds.length||visibleIds.some(id=>id!==scope&&!id.startsWith(scope+'/')))throw Error('Legend ignored assembly isolation');
        const rows=[...find('parts-list').children];
        const qtyHeader=find('parts-list').closest('table').querySelector('th:nth-child(2)'),qtyCell=rows[0].children[1];
        if(getComputedStyle(qtyHeader).textAlign!==getComputedStyle(qtyCell).textAlign)throw Error('Assembly quantities do not align with header');
        if(rows.reduce((sum,row)=>sum+Number(row.dataset.quantity),0)!==visibleIds.length)throw Error('Summary quantities do not match visible instances');
        for(const row of rows){
            const ids=JSON.parse(row.dataset.partInstances),members=state.parts.filter(part=>ids.includes(part.instanceId));
            if(members.length!==Number(row.dataset.quantity)||!members.every(part=>part.name===members[0].name&&part.optimizationLabel===members[0].optimizationLabel))throw Error('Summary merges different components or letters');
            if(row.cells[0].textContent!==(members[0].optimizationLabel||'—')+' · '+members[0].name)throw Error('Summary lacks letter and component name');
            if(row.cells.length!==5||![...row.cells].slice(2).every(cell=>cell.textContent.includes('″')))throw Error('Summary dimensions missing');
        }
        change('labels','optimization');
        if(![...document.querySelectorAll('[data-label-instance] text')].every(el=>/^([A-Z]+|—)$/.test(el.textContent)))throw Error('Optimization labels contain component names');
        if(numbers!==JSON.stringify(assemblyViewer.getPresentationState().parts)||before!==JSON.stringify([...model.nodes.values()])||cutList!==JSON.stringify(parts))throw Error('Annotations mutated numbers, source model, or optimizer');
        return JSON.stringify({parts:state.parts.length,visible:visibleIds.length,tableMeasurements:rows.length});
    })()`));
    assert.ok(annotationCheck.parts>100&&annotationCheck.visible>0&&annotationCheck.tableMeasurements>0);
    console.log('PASS: Part numbering, label modes/leaders, table-only measurements/fractional precision, hidden-part filtering, isolated legend, and immutable modeled measurements.');
    await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))');
    const explodedScreenshot=await command('Page.captureScreenshot',{format:'png'},sessionId);
    fs.writeFileSync(path.join(os.tmpdir(),'cut-planner-exploded-smoke.png'),Buffer.from(explodedScreenshot.data,'base64'));
    console.log('PASS: Selected-assembly explosion, 50% interpolation, spacing/direction changes, exact 0% world matrices, leaf selection, target switching, and reset preserve imported and optimizer data.');
    await command('Emulation.setDeviceMetricsOverride',{width:1366,height:1100,deviceScaleFactor:1,mobile:false},sessionId);
    const workspaceCheck=await evaluate(`(()=>{
        const find=role=>document.querySelector('[data-assembly="'+role+'"]');
        const change=(role,value)=>{find(role).value=value;find(role).dispatchEvent(new Event('change'));};
        const amount=value=>{find('amount').value=value;find('amount').dispatchEvent(new Event('input'));};
        const state=()=>assemblyViewer.getPresentationState();
        const model=assemblyViewer.getModel(),snapshot=JSON.stringify([...model.nodes.values()]);
        const tabs=[...find('views').querySelectorAll('[role=tab]')];
        const primary=tabs.find(tab=>model.nodes.get(tab.dataset.assemblyView).name==='Adjustable Shelf'),secondary=tabs.find(tab=>model.nodes.get(tab.dataset.assemblyView).name==='Counter Base Support (middle)');
        if(tabs.length!==11||tabs[0].textContent!=='Overview')throw Error('Preconfigured assembly views missing');
        const order=new Map(tabs.map((tab,index)=>[model.nodes.get(tab.dataset.assemblyView).name,index]));
        if(order.get('Cabinet Door (Left)')>=order.get('Cabinet Box (large)')||order.get('Drawer Front')>=order.get('Cabinet Box (small)'))throw Error('Child assemblies do not precede their parents');
        if(document.getElementById('cutting-layouts-tab').textContent!=='Cutting Plan'||document.getElementById('exploded-views-tab').textContent!=='Assembly Plan')throw Error('Plan labels not updated');
        tabs[0].click();primary.click();
        const id=primary.dataset.assemblyView;
        const large=[...model.nodes.values()].filter(node=>node.children.length&&node.name==='Cabinet Box (large)');
        const largeTabs=tabs.filter(tab=>large.some(node=>node.id===tab.dataset.assemblyView));
        if(largeTabs.length!==1||!largeTabs[0].textContent.includes('Build ×4'))throw Error('Repeated large cabinets have duplicate tabs or wrong build count');

        if(state().assemblyId!==id||state().amount!==50||find('projection').value!=='orthographic')throw Error('Subassembly preset not applied');
        if(!find('reference').querySelector('canvas')||state().referenceSelection!==id||+find('reference').dataset.referenceHighlightCount===0)throw Error('Assembled parent reference or highlight missing');
        if(JSON.parse(find('reference').dataset.referenceInstances).length!==state().buildQuantity)throw Error('Reference does not highlight all equivalent assemblies');
        const reference=find('reference').textContent;
        amount('0');amount('100');if(find('reference').textContent!==reference)throw Error('Pull-apart changed reference dimensions');
        if(state().renderStyle.colors.length<2||state().renderStyle.outlinedParts<1)throw Error('Distinct shading or outlines missing');
        const originalMatrices=JSON.stringify(state().worldMatrices);
        find('shading').click();find('edges').click();
        if(state().renderStyle.outlinedParts!==0)throw Error('Outline toggle failed');
        find('shading').click();find('edges').click();
        const camera=state().camera;find('rotate-view').click();const rotated=state().camera;
        const a=camera.position.map((v,i)=>v-camera.target[i]),b=rotated.position.map((v,i)=>v-rotated.target[i]),up=camera.up;
        const dot=v=>v.reduce((sum,x,i)=>sum+x*up[i],0);
        if(a.some((v,i)=>Math.abs((v-dot(a)*up[i])+(b[i]-dot(b)*up[i]))>1e-6)||JSON.stringify(state().worldMatrices)!==originalMatrices)throw Error('180-degree view rotation changed source/presentation geometry or failed');
        change('layout','even');change('spread-x','1.7');change('spread-y','.8');change('spread-z','1.3');change('view-preset','rear-iso');amount('41');
        const leaf=state().parts.find(part=>part.instanceId.startsWith(id+'/')&&!model.nodes.get(part.instanceId).children.length);
        [...find('tree').querySelectorAll('button')].find(button=>button.dataset.instanceId===leaf.instanceId).click();
        ['x','y','z'].forEach((axis,i)=>{find('manual-'+axis).value=i===0?'1':'0';});find('manual-apply').click();
        const configured=state();secondary.click();primary.click();
        if(state().amount!==41||state().layout!=='even'||JSON.stringify(state().spread)!==JSON.stringify([1.7,.8,1.3])||state().viewPreset!=='rear-iso'||state().customOffsets.length!==1)throw Error('Per-view configuration was not restored');
        if(state().camera.position.some((v,i)=>Math.abs(v-configured.camera.position[i])>1e-6))throw Error('Per-view camera was not restored');
        tabs[0].click();if(state().assemblyId||state().amount!==0)throw Error('Overview is not assembled');
        if(document.querySelector('[data-label-instance]'))throw Error('Overview contains callouts');
        if(!find('reference').hidden||find('subassemblies').hidden||find('subassemblies').children.length!==tabs.length-1)throw Error('Overview subassembly list missing');
        if(!document.querySelector('.assembly-settings').hidden||!document.querySelector('.assembly-hierarchy').hidden)throw Error('Advanced controls or hierarchy remain visible');

        primary.click();find('manual-reset-assembly').click();largeTabs[0].click();change('layout','logical');
        if(find('reference-title').textContent!==model.nodes.get(state().referenceParent)?.name && state().referenceParent!==model.rootId)throw Error('Parent component heading missing');
        if(/\.skp/i.test(find('reference-caption').textContent))throw Error('Filename remains in reference caption');
        if(state().buildQuantity!==4||state().assemblyInstances.length!==4||JSON.parse(find('reference').dataset.referenceInstances).length!==4)throw Error('Large-cabinet group did not highlight all four builds');
        const originalPrimary=state().assemblyId,duplicate=state().assemblyInstances[1];
        [...find('tree').querySelectorAll('button')].find(button=>button.dataset.instanceId===duplicate).click();find('explode').click();
        if(state().assemblyId!==originalPrimary||find('views').querySelectorAll('[role=tab]').length!==11)throw Error('Duplicate selection created a separate build view');

        for(const axis of ['x','y','z'])change('spread-'+axis,'1.4');
        amount('50');change('view-preset','auto');change('labels','optimization');
        document.querySelector('.assembly-settings').open=false;
        find('views').scrollIntoView({block:'start'});
        return snapshot===JSON.stringify([...model.nodes.values()]);
    })()`);
    assert.ok(workspaceCheck,'view presets/reference/shading preserve imported geometry');
    await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))');
    const workspaceScreenshot=await command('Page.captureScreenshot',{format:'png'},sessionId);
    fs.writeFileSync(path.join(os.tmpdir(),'cut-planner-assembly-workspace.png'),Buffer.from(workspaceScreenshot.data,'base64'));
    console.log('PASS: Assembly view banner, per-view settings/camera/manual corrections, logical/XYZ layout, independent front reference, distinct shading/outlines, and 180-degree view turn.');
    const planarCheck=await evaluate(`(()=>{
        const find=role=>document.querySelector('[data-assembly="'+role+'"]');
        const state=()=>assemblyViewer.getPresentationState(),model=assemblyViewer.getModel();
        const source=JSON.stringify([...model.nodes.values()]);
        const pick=name=>{const tab=[...find('views').querySelectorAll('[role=tab]')].find(t=>model.nodes.get(t.dataset.assemblyView).name===name);if(!tab)throw Error('Missing planar fixture view '+name);tab.click();find('direction').value='auto';find('direction').dispatchEvent(new Event('change'));find('layout').value='logical';find('layout').dispatchEvent(new Event('change'));};
        const amount=value=>{find('amount').value=value;find('amount').dispatchEvent(new Event('input'));};
        pick('Counter Base Support (side)');
        if(state().plane!=='XY'||state().offsets.some(([,offset])=>offset[2]!==0))throw Error('Counter support no longer lies in its original plane');
        const parent=model.nodes.get(state().assemblyId);
        const middle=parent.children.find(id=>{
            const child=model.nodes.get(id),bounds=model.definitions.get(child.definitionId).bounds;if(!bounds)return false;
            const c=bounds.min.map((v,i)=>(v+bounds.max[i])/2);
            const p=child.localMatrix.slice(0,3).map(row=>row[3]+c.reduce((sum,v,i)=>sum+v*row[i],0));
            return Math.abs(p[0]-40)<.01&&Math.abs(p[1]-10.5)<.01;
        });
        if(!middle||state().offsets.find(([id])=>id===middle)[1].some(v=>v!==0))throw Error('Center support moved away from its mating face');
        if(!document.querySelector('[data-origin-guide]'))throw Error('Origin guides missing');
        for(const guide of document.querySelectorAll('[data-origin-guide]')){
            if(guide.dataset.originGuide===middle)throw Error('Stationary center has a movement guide');
            if(guide.querySelector('line').getAttribute('stroke-dasharray')!=='2 5')throw Error('Origin guides are not dotted');
            const start=JSON.parse(guide.dataset.originWorld),end=JSON.parse(guide.dataset.presentedWorld);
            if(Math.hypot(...end.map((v,i)=>v-start[i]))<1e-7)throw Error('Guide does not connect assembled and moved locations');
        }
        const reference=find('reference').textContent;
        amount('0');if(document.querySelector('[data-origin-guide]'))throw Error('Origin guides remain at 0%');
        amount('50');if(find('reference').textContent!==reference)throw Error('Guides or planar offsets changed assembled reference');
        find('origin-guides').click();if(document.querySelector('[data-origin-guide]'))throw Error('Origin guide toggle failed');find('origin-guides').click();
        pick('Cabinet Door (Left)');
        if(state().plane!=='XZ'||state().offsets.some(([,offset])=>offset[1]!==0))throw Error('Door frame does not expand within its original plane');
        pick('Drawer Front');
        if(state().plane!=='XZ'||state().offsets.some(([,offset])=>offset[1]!==0))throw Error('Drawer front does not expand within its original plane');
        pick('Counter Base Support (side)');
        find('views').scrollIntoView({block:'start'});
        return source===JSON.stringify([...model.nodes.values()]);
    })()`);
    assert.ok(planarCheck,'planar views and origin guides preserve imported geometry');
    await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))');
    const planarScreenshot=await command('Page.captureScreenshot',{format:'png'},sessionId);
    fs.writeFileSync(path.join(os.tmpdir(),'cut-planner-planar-support.png'),Buffer.from(planarScreenshot.data,'base64'));
    console.log('PASS: Counter support center stays aligned, doors/drawer fronts stay planar, dotted origin guides track actual displacement, toggle, and vanish at 0%.');
    await command('Emulation.setDeviceMetricsOverride',{width:390,height:900,deviceScaleFactor:1,mobile:true},sessionId);
    await evaluate("document.getElementById('exploded-views-tab').click();document.querySelector('.assembly-settings').open=true;document.querySelector('.assembly-manual-controls').open=true;document.getElementById('assembly-viewer').scrollIntoView();true");
    await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))');
    assert.ok(await evaluate("document.documentElement.scrollWidth<=document.documentElement.clientWidth+1"),'open viewer fits a phone');
    const annotationLayout=JSON.parse(await evaluate(`JSON.stringify([...document.querySelectorAll('.assembly-annotations [data-callout-box]')].map(el=>JSON.parse(el.dataset.calloutBox)))`));
    assert.ok(await evaluate(`Array.from(document.querySelectorAll('.assembly-annotations g')).every(group=>{
        const text=group.querySelector('text'),rect=group.querySelector('rect,[data-callout-circle]');if(!text||!rect)return true;
        const t=text.getBBox(),r=rect.getBBox();return t.x>=r.x-1&&t.y>=r.y-1&&t.x+t.width<=r.x+r.width+1&&t.y+t.height<=r.y+r.height+1;
    })`),'actual font measurements fit annotation text inside its box');
    const geometryBounds=JSON.parse(await evaluate("document.querySelector('.assembly-annotations').dataset.geometryBounds"));
    assert.ok(await evaluate("[...document.querySelectorAll('[data-label-instance] [data-callout-circle]')].every(circle=>+circle.getAttribute('r')>=18)"),'letter callouts use large circular markers');
    for(const annotation of annotationLayout)for(const geometry of geometryBounds){
        assert.ok(annotation.x+annotation.width<=geometry.x||geometry.x+geometry.width<=annotation.x||annotation.y+annotation.height<=geometry.y||geometry.y+geometry.height<=annotation.y,'callout bodies never cover projected part geometry');
    }
    const viewportSize=JSON.parse(await evaluate(`JSON.stringify({width:document.querySelector('[data-assembly=viewport]').clientWidth,height:document.querySelector('[data-assembly=viewport]').clientHeight})`));
    for(let i=0;i<annotationLayout.length;i++){
        const a=annotationLayout[i];assert.ok(a.x>=0&&a.y>=0&&a.x+a.width<=viewportSize.width&&a.y+a.height<=viewportSize.height,'mobile annotation text stays unclipped');
        for(let j=i+1;j<annotationLayout.length;j++){const b=annotationLayout[j];assert.ok(a.x+a.width<=b.x||b.x+b.width<=a.x||a.y+a.height<=b.y||b.y+b.height<=a.y,'annotation text boxes do not overlap');}
    }
    const screenshot=await command('Page.captureScreenshot',{format:'png'},sessionId);
    fs.writeFileSync(path.join(os.tmpdir(),'cut-planner-assembly-smoke.png'),Buffer.from(screenshot.data,'base64'));
    await evaluate("document.getElementById('cutting-layouts-tab').click();true");
    await command('Emulation.clearDeviceMetricsOverride',{},sessionId);
    console.log('PASS: Offline assembly viewer renders the real model, selects, changes projection, fits, resets, and preserves cut-list/model data.');
    const relabeled=await evaluate(`(()=>{
        const linked=parts.find(part=>[...skpPartLinks.values()].includes(part.id));
        const instances=assemblyViewer.getPresentationState().parts.filter(part=>skpPartLinks.get(part.instanceId)===linked.id);
        const originalNames=instances.map(part=>part.name);
        linked.name='ZZZ changed manufacturing row';linked.length=+linked.length+1;
        $('optimize').click();
        const placement=last.layouts.flatMap(layout=>layout.placements).find(z=>z.p.sourcePartId===linked.id);
        if(!placement)throw Error('Edited row missing from optimized layout');
        const letter=activePartLabels.get(partKey(placement.p));
        const updated=assemblyViewer.getPresentationState().parts.filter(part=>instances.some(p=>p.instanceId===part.instanceId));
        if(!updated.every((part,i)=>part.optimizationLabel===letter&&part.name===originalNames[i]))throw Error('Reoptimization lost source links or changed component names');
        parts=parts.filter(part=>part.id!==linked.id);$('optimize').click();
        if(assemblyViewer.getPresentationState().parts.some(part=>instances.some(p=>p.instanceId===part.instanceId)&&part.optimizationLabel))throw Error('Deleted row kept stale letters');
        return true;
    })()`);
    assert.ok(relabeled,'row edits and removal refresh letters through source IDs');
    console.log('PASS: Default optimizer-letter labels match actual cut layouts, survive manufacturing row edits, preserve component names, and clear deleted assignments.');
    const printCheck=await evaluate(`(async()=>{
        const before=assemblyViewer.getPresentationState(),source=JSON.stringify([...assemblyViewer.getModel().nodes.values()]),partsBefore=JSON.stringify(parts);
        const originalPrint=window.print;let printed=0;window.print=()=>printed++;
        try{
            $('print').click();if(!$('print-options').open||$('print-assembly').disabled)throw Error('Print choices not available');
            if($('print').parentElement!==$('result-tabs').parentElement)throw Error('Print button is not beside plan tabs');
            if(getComputedStyle($('print')).backgroundColor!==getComputedStyle(document.querySelector('.parts-toolbar .sketchup-import')).backgroundColor)throw Error('Print button does not match import color');
            $('print-cutting').checked=false;$('print-assembly').checked=false;updatePrintChoice();
            if(!$('print-confirm').disabled)throw Error('Empty print selection enabled');
            $('print-cancel').click();if(printed||$('print-options').open)throw Error('Cancel printed a document');
            $('print').click();$('print-assembly').checked=false;
            await $('print-confirm').onclick();
            if(!printed||!document.querySelector('#print-root .print-cover')||document.querySelector('#print-root .print-assembly'))throw Error('Cutting-only selection incorrect');
            window.dispatchEvent(new Event('afterprint'));
            $('print').click();await $('print-confirm').onclick();
            const root=$('print-root'),pages=[...root.querySelectorAll('.print-assembly')];
            if(pages.length!==document.querySelectorAll('[data-assembly=views] [role=tab]').length||!root.querySelector('.print-cover'))throw Error('Combined document lacks assembly pages or cutting plan');
            if(pages.some(page=>!page.querySelector('img')||page.querySelector('img').src.length<1000))throw Error('Assembly drawings are empty');
            const tabTitles=[...document.querySelectorAll('[data-assembly=views] [role=tab]')].map(tab=>tab.textContent.replace(/^↳ /,''));
            if(pages.some((page,index)=>page.querySelector('h3').textContent!=='Assembly Plan · '+tabTitles[index]))throw Error('Printed assemblies do not follow tab build order');
            if(!pages[1].querySelector('.assembly-print-reference table')||!pages[1].querySelector('.assembly-print-reference img'))throw Error('Assembly table or parent reference missing from sidebar');
            const front=pages[1].querySelector('.assembly-print-reference img');
            if(front.naturalHeight/front.naturalWidth>=.5)throw Error('Wide parent preview still reserves blank vertical space');
            const count=pages.length;window.dispatchEvent(new Event('beforeprint'));if(root.querySelectorAll('.print-assembly').length!==count)throw Error('Beforeprint overwrote selection');
            cleanupPrintRoot();const assemblyPages=await assemblyViewer.createPrintPages();
            for(const page of assemblyPages){
                const svg=new DOMParser().parseFromString(decodeURIComponent(page.callouts.split(',')[1]),'image/svg+xml').documentElement;
                const size=svg.getAttribute('viewBox').split(' ').map(Number),bounds=JSON.parse(svg.getAttribute('data-geometry-bounds'));
                if(bounds.some(box=>box.x<=0||box.y<=0||box.x+box.width>=size[2]||box.y+box.height>=size[3]))throw Error('Exported geometry clips: '+page.title);
            }
            preparePrintRoot({cutting:false,assemblyPages});
            if(document.querySelector('#print-root .print-cover')||document.querySelectorAll('#print-root .print-assembly').length!==count)throw Error('Assembly-only selection incorrect');
            await Promise.all([...root.querySelectorAll('img')].map(img=>img.decode()));
            const after=assemblyViewer.getPresentationState();
            if(before.assemblyId!==after.assemblyId||before.amount!==after.amount||JSON.stringify(before.worldMatrices)!==JSON.stringify(after.worldMatrices)||before.camera.position.some((value,i)=>Math.abs(value-after.camera.position[i])>1e-6))throw Error('Printing changed current assembly view');
            return source===JSON.stringify([...assemblyViewer.getModel().nodes.values()])&&partsBefore===JSON.stringify(parts);
        }finally{window.print=originalPrint;$('print-options').close();}
    })()`);
    assert.ok(printCheck,'print selections preserve model and cut list');
    await command('Emulation.setEmulatedMedia',{media:'print'},sessionId);
    const printMetrics=await evaluate(`(()=>{const root=$('print-root');root.style.width='calc(8.5in - 18mm)';const metrics=[...root.querySelectorAll('.print-assembly')].map(card=>({title:card.querySelector('h3').textContent,height:Math.round(card.getBoundingClientRect().height),gap:getComputedStyle(card).marginBottom,drawing:Math.round(card.querySelector('.assembly-print-layout').getBoundingClientRect().height),parts:Math.round(card.querySelector('.assembly-print-parts')?.getBoundingClientRect().height||0)}));root.style.removeProperty('width');return metrics})()`);
    const usablePageHeight=11*96-18*96/25.4;
    for(let i=0;i<printMetrics.length;i+=2){const pair=printMetrics.slice(i,i+2);assert.ok(pair.reduce((sum,view)=>sum+view.height+parseFloat(view.gap),0)<=usablePageHeight,'paired assembly views fit the printable page without splitting tables');}
    await command('Emulation.setEmulatedMedia',{media:''},sessionId);
    const assemblyPdf=await command('Page.printToPDF',{printBackground:true,preferCSSPageSize:true},sessionId);
    const assemblyPdfBytes=Buffer.from(assemblyPdf.data,'base64');
    fs.writeFileSync(path.join(os.tmpdir(),'cut-planner-assembly-plan.pdf'),assemblyPdfBytes);
    const assemblyPageCount=(assemblyPdfBytes.toString('latin1').match(/\/Type\s*\/Page\b/g)||[]).length;
    assert.equal(assemblyPageCount,Math.ceil(printMetrics.length/2),'two assembly views per page without unnecessary breaks');
    await evaluate('cleanupPrintRoot();true');

    console.log('PASS: Print dialog cancel/empty selection, cutting-only, assembly-only, combined pages, images, tables, references, and restored viewer state.');
    await evaluate(`demo(); $('optimize').click(); parts[0].name='A long descriptive cabinet component name that should fit on a small phone'; materials[0].name='A long descriptive plywood material name for testing'; renderAll(); renderResults(); true`);
    assert.equal(await evaluate('assemblyViewer.getPresentationState().assemblyId'),null,'example clears explosion state');
    assert.ok(await evaluate("document.getElementById('result-tabs').hidden&&document.getElementById('assembly-viewer').hidden&&!document.getElementById('results').hidden"),'example optimization uses only cutting layouts');
    assert.ok(await evaluate("$('print').click();const available=$('print-assembly').disabled&&!$('print-assembly').checked;$('print-cancel').click();available"),'non-SketchUp projects offer cutting-only printing');

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
    await evaluate("$('parts-list-details').open=true;true");
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
        const optimizeFields=JSON.parse(await evaluate("JSON.stringify(['kerf','margin','lumbermargin','layoutgoal'].map(id=>{const field=document.getElementById(id),label=field.closest('label'),caption=label.querySelector('.labelcap');return {top:field.getBoundingClientRect().top,row:label.getBoundingClientRect().top,gap:field.getBoundingClientRect().top-caption.getBoundingClientRect().bottom};}))"));
        for(const field of optimizeFields){
            assert.ok(field.gap>=5&&field.gap<=7,`caption stays directly above control at ${width}px`);
            for(const other of optimizeFields)if(Math.abs(field.row-other.row)<1)assert.ok(Math.abs(field.top-other.top)<1,`Optimize controls align at ${width}px`);
        }
        const helpState=await evaluate(`(()=>{
            const saved=JSON.stringify({materials,parts,last});
            document.getElementById('user-help-open').click();
            const dialog=document.getElementById('user-help'),body=dialog.querySelector('.user-help-body');
            const result={open:dialog.open,dialogWidth:dialog.getBoundingClientRect().width,
                viewport:document.documentElement.clientWidth,contentOverflow:body.scrollWidth>body.clientWidth+1,
                guide:dialog.textContent.includes('Workflow overview')&&dialog.textContent.includes('Balanced')};
            dialog.querySelector('a[href="#guide-results"]').click();
            document.getElementById('user-help-close').click();
            result.closed=!dialog.open;result.unchanged=saved===JSON.stringify({materials,parts,last});
            return JSON.stringify(result);
        })()`);
        const help=JSON.parse(helpState);
        assert.ok(help.open&&help.closed&&help.guide&&help.unchanged,'guide works without changing project');
        assert.ok(help.dialogWidth<=help.viewport&& !help.contentOverflow,`guide fits ${width}px viewport`);
        const metrics=JSON.parse(layout);
        assert.ok(metrics.page<=metrics.viewport+1,`Page overflows at ${width}px: ${layout}`);
        if(width<=800){
            const toolbar=JSON.parse(await evaluate("JSON.stringify({header:Array.from(document.querySelectorAll('header .controls>.btn,header .controls>.units-control')).filter(el=>!el.hidden).map(el=>el.getBoundingClientRect().height),parts:Array.from(document.querySelectorAll('.parts-toolbar>.btn')).map(el=>({width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height}))})"));
            assert.ok(await evaluate("Math.abs(document.getElementById('pwa-refresh').getBoundingClientRect().top-document.getElementById('saveproject').getBoundingClientRect().top)<1"),'refresh stays on the same mobile toolbar line');
            assert.ok(toolbar.header.every(height=>height===36),'header actions have consistent compact height');
            assert.ok(toolbar.parts.every(item=>item.height===36),'parts actions have consistent compact height');
            assert.ok(toolbar.parts.every(item=>Math.abs(item.width-toolbar.parts[0].width)<1),'parts actions use equal widths');
            const fields=JSON.parse(await evaluate("JSON.stringify(['kerf','margin','lumbermargin','layoutgoal'].map(id=>{const r=document.getElementById(id).getBoundingClientRect();return {x:r.x,y:r.y};}))"));
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
    const separateTrim=await evaluate(`(async()=>{
        const original={materials,parts,last,unit:currentUnit,kerf:parseDisplay($('kerf').value),sheet:parseDisplay($('margin').value),lumber:parseDisplay($('lumbermargin').value),printHidden:$('print').hidden};
        const originalDownload=download;
        try{
            currentUnit='in';$('unitmode').value='in';setUnitLabels();setDisplayedControlValues(.125,.5,.25);
            materials=[{id:'trim-sheet',name:'Sheet',type:'sheet',width:12,length:24,thickness:.75},{id:'trim-lumber',name:'Board',type:'lumber',width:6,length:48,thickness:.75}];
            parts=[{id:'panel',name:'Panel',width:10,length:20,thickness:.75,quantity:1,material:'trim-sheet'},{id:'rail',name:'Rail',width:2,length:40,thickness:.75,quantity:2,material:'trim-lumber'}];
            renderAll();$('optimize').click();
            if(last.sheetMargin!==.5||last.lumberMargin!==.25||!last.layouts.some(b=>b.kind==='sheet')||!last.layouts.some(b=>b.kind==='lumber'))throw Error('Separate trims not applied');
            for(const b of last.layouts){
                const margin=b.kind==='sheet'?.5:.25,width=b.kind==='sheet'?b.m.width:b.m.length,length=b.kind==='sheet'?b.m.length:b.m.width;
                if(b.margin!==margin||b.placements.some(z=>z.x<margin-1e-7||z.y<margin-1e-7||z.x+z.w>width-margin+1e-7||z.y+z.h>length-margin+1e-7))throw Error('Placement violates type-specific trim');
            }
            const sheet=JSON.stringify(last.layouts.filter(b=>b.kind==='sheet'));
            $('lumbermargin').value='.5';$('optimize').click();
            if(sheet!==JSON.stringify(last.layouts.filter(b=>b.kind==='sheet')))throw Error('Lumber trim changed sheet plan');
            const board=JSON.stringify(last.layouts.filter(b=>b.kind==='lumber'));
            $('margin').value='.75';$('optimize').click();
            if(board!==JSON.stringify(last.layouts.filter(b=>b.kind==='lumber')))throw Error('Sheet trim changed lumber plan');
            const valid=last;$('lumbermargin').value='-1';$('optimize').click();
            if(last!==valid||!$('errors').textContent.includes('Lumber edge trim'))throw Error('Invalid lumber trim accepted');
            $('lumbermargin').value='.25';$('margin').value='invalid';$('optimize').click();
            if(last!==valid||!$('errors').textContent.includes('Sheet edge trim'))throw Error('Invalid sheet trim accepted');
            setDisplayedControlValues(.125,.5,.25);$('unitmode').value='mm';$('unitmode').onchange();
            if($('margin').value!=='12.7'||$('lumbermargin').value!=='6.35')throw Error('Trim unit conversion failed');
            let saved;download=(name,text)=>{saved=JSON.parse(text)};$('saveproject').click();
            if(saved.sheetMargin!==.5||saved.lumberMargin!==.25||saved.margin!==.5)throw Error('Project did not save separate inch values');
            setDisplayedControlValues(0,0,0);await $('projectfile').onchange({target:{files:[new File([JSON.stringify(saved)],'trim.json')]}});
            if($('margin').value!=='12.7'||$('lumbermargin').value!=='6.35')throw Error('Project did not restore separate trims');
            delete saved.sheetMargin;delete saved.lumberMargin;saved.margin=.375;saved.unitMode='in';
            await $('projectfile').onchange({target:{files:[new File([JSON.stringify(saved)],'legacy.json')]}});
            if($('margin').value!=='0.375'||$('lumbermargin').value!=='0.375')throw Error('Legacy project margin not applied to both stock types');
            clearProject();if($('margin').value!=='0'||$('lumbermargin').value!=='0')throw Error('Clear did not reset both trims');
            return true;
        }finally{
            download=originalDownload;materials=original.materials;parts=original.parts;last=original.last;currentUnit=original.unit;$('unitmode').value=currentUnit;setUnitLabels();setDisplayedControlValues(original.kerf,original.sheet,original.lumber);renderAll();if(last)renderResults();$('print').hidden=original.printHidden;
        }
    })()`);
    assert.ok(separateTrim,'separate trims preserve fitting, unit conversion, project round trips, and legacy projects');
    console.log('PASS: Independent sheet/lumber trims, placement bounds, validation, metric conversion, project save/load, legacy margins, and reset defaults.');
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
        if($('layoutgoal').value!=='balanced')throw Error('Legacy project did not use the default');
        const minimum=JSON.parse(savedJSON);minimum.layoutGoal='material';
        await $('projectfile').onchange({target:{files:[{text:async()=>JSON.stringify(minimum)}]}});
        if($('layoutgoal').value!=='material')throw Error('Explicit minimum-material selection was not restored');
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
    releaseRevision=1;
    await command('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1},sessionId);
    await evaluate("window.__keepPlan='still open';window.dispatchEvent(new Event('focus'));true");
    await waitFor("document.querySelector('header #pwa-refresh')?.dataset.updateReady==='true'");
    assert.equal(await evaluate('window.__keepPlan'),'still open','release checks never reload the current plan');
    assert.ok(await evaluate(`document.getElementById('pwa-update-banner').textContent.includes(${JSON.stringify(nextVersion)})`),'independent version endpoint advertises release');
    // Now publish the worker and HTML: activation must not be held up by this open tab.
    deploymentRevision=1;
    await evaluate('navigator.serviceWorker.getRegistration().then(r=>r.update()).then(()=>true)');
    await waitFor("caches.keys().then(keys=>keys.some(key=>key.endsWith('smoke-revision-1')))");
    await waitFor("navigator.serviceWorker.getRegistration().then(r=>!r.waiting && !!r.active)");
    assert.equal(await evaluate('window.__keepPlan'),'still open','automatic worker activation preserves the open plan');
    assert.ok(await evaluate("!document.getElementById('pwa-update-banner').hidden && document.body.firstElementChild.id==='pwa-update-banner'"),'update banner is visible across the top');
    assert.ok(await evaluate("document.getElementById('pwa-refresh').title.includes('Save your project')"));
    assert.equal(await evaluate("getComputedStyle(document.getElementById('pwa-refresh'),'::after').backgroundColor"),'rgb(34, 197, 94)','update badge is green');
    await evaluate("window.__beforePwaRefresh=true;window.confirm=()=>true;document.getElementById('pwa-refresh').click();true");
    await waitFor("document.readyState==='complete' && typeof window.__beforePwaRefresh==='undefined' && !!document.getElementById('pwa-refresh') && caches.keys().then(keys=>keys.some(key=>key.endsWith('smoke-revision-1')))");
    await waitFor(`document.getElementById('app-version')?.textContent==='v${nextVersion}' && !document.getElementById('pwa-refresh').disabled`);
    assert.equal(await evaluate("document.getElementById('pwa-update-banner').hidden"),true,'new page stops advertising the already-applied update');
    console.log('PASS: Uncached version checks detect a release without a waiting worker; activation preserves the plan; Refresh loads the new version.');
    console.log('PASS: Mobile page widths 320–768px fit the viewport; phone tables use labeled cards; desktop tables remain intact.');
    await command('Page.navigate',{url:require('node:url').pathToFileURL(path.join(root,'docs/index.html')).href},sessionId);
    await waitFor('document.readyState === "complete" && typeof loadSkpIntoParts === "function"');
    await evaluate(`(async()=>{const bytes=Uint8Array.from(atob(${JSON.stringify(fixture)}),c=>c.charCodeAt(0));await loadSkpIntoParts(new File([bytes],'direct-file.skp'));for(const material of materials){const assigned=parts.filter(part=>part.material===material.id);material.width=Math.max(+material.width,...assigned.map(part=>+part.width))+2;material.length=Math.max(+material.length,...assigned.map(part=>+part.length))+2;}$('quality').value='fast';$('optimize').click();document.getElementById('exploded-views-tab').click();return true;})()`);
    await waitFor("!!document.querySelector('[data-assembly=viewport] canvas')");
    assert.equal(await evaluate('assemblyViewer.getModel().nodes.size'),assemblyState.nodes,'single HTML opens/imports/renders directly from disk');
    console.log('PASS: Standalone file:// HTML imports and renders without a server.');
    const replacedImport=await evaluate(`(async()=>{
        const bytes=Uint8Array.from(atob(${JSON.stringify(fixture)}),c=>c.charCodeAt(0));
        await loadSkpIntoParts(new File([bytes],'replacement.skp'));
        const gated=document.getElementById('result-tabs').hidden&&document.getElementById('assembly-viewer').hidden&&!document.getElementById('results').hidden;
        clearProject();
        return gated&&assemblyViewer.getModel()===null&&document.getElementById('result-tabs').hidden;
    })()`);
    assert.ok(replacedImport,'replacement imports require a new optimization and clearing removes exploded results');
    console.log('PASS: Shared Parts-list SKP import gates result tabs after successful optimization; defaults, keyboard switching, preserved state, print, and resets validated.');

    console.log(`PASS: Chrome validated the manifest, controlled the repository subpath, reloaded offline, and imported ${count} grouped SKP parts.`);
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{
    clearTimeout(deadline);
    if(socket){try{await command('Browser.close');}catch{}socket.close();}
    if(chrome&&chrome.exitCode===null){chrome.kill();await new Promise(resolve=>{chrome.once('exit',resolve);setTimeout(resolve,3000);});}
    server.closeAllConnections();
    await new Promise(resolve=>server.close(resolve));
    if(profile)fs.rmSync(profile,{recursive:true,force:true,maxRetries:5,retryDelay:100});
});
