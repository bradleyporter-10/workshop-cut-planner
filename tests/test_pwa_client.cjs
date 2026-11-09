const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(`${__dirname}/../pwa/client.js`,'utf8').replace('__APP_VERSION__','1.2.3');
class Element {
    constructor(){this.hidden=false;this.disabled=false;this.events={};this.children=[];}
    append(...nodes){this.children.push(...nodes);}
    prepend(...nodes){this.children.unshift(...nodes);}
    setAttribute(name,value){this[name]=value;}
    addEventListener(name,fn){this.events[name]=fn;}
}
async function setup({ios=false,standalone=false,waiting=false,published='1.2.3'}={}) {
    const buttons=[],events={},serviceEvents={},mediaEvents={},messages=[];
    const root=new Element(),body=new Element();
    let reloads=0,updates=0,confirmations=0;
    const media={matches:standalone,addEventListener:(name,fn)=>mediaEvents[name]=fn};
    const registration={active:{},waiting:waiting?{postMessage:msg=>messages.push(msg)}:null,addEventListener(){},update:async()=>{updates++;}};
    const context={
        location:{protocol:'https:',href:'https://planner.test/project/index.html',reload:()=>reloads++,replace:url=>{reloads++;messages.push(url);}},
        URL,AbortController,fetch:async(url,options)=>{messages.push({checkURL:url,cache:options.cache});return {ok:true,json:async()=>({version:published})};},
        window:{isSecureContext:true,matchMedia:()=>media,addEventListener:(name,fn)=>events[name]=fn},
        navigator:{userAgent:ios?'iPhone':'Chrome',onLine:true,serviceWorker:{controller:{},register:async()=>registration,ready:Promise.resolve(registration),addEventListener:(name,fn)=>{const previous=serviceEvents[name];serviceEvents[name]=()=>{previous?.();fn();};}}},
        document:{readyState:'complete',hidden:false,body,createElement:tag=>{const el=new Element();if(tag==='button')buttons.push(el);return el;},querySelector:()=>root,addEventListener(){}},
        confirm:()=>{confirmations++;return true;},alert:message=>messages.push(message),console,
        setInterval(){},setTimeout:()=>1,clearTimeout(){}
    };
    vm.runInNewContext(source,context);
    await new Promise(resolve=>setImmediate(resolve));
    return {root,body,buttons,events,serviceEvents,media,mediaEvents,messages,context,registration,
        counts:()=>({reloads,updates,confirmations})};
}
(async()=>{
    const normal=await setup();
    const install=normal.buttons[0],refresh=normal.buttons[1];
    assert.ok(install.hidden,'no unusable install button without a browser prompt');
    let prompts=0;
    normal.events.beforeinstallprompt({preventDefault(){},prompt:async()=>{prompts++;},userChoice:Promise.resolve({outcome:'accepted'})});
    assert.ok(!install.hidden);
    await install.events.click();
    assert.equal(prompts,1);
    assert.ok(install.hidden,'accepted install hides button');
    const installed=await setup({standalone:true,ios:true});
    assert.ok(installed.buttons[0].hidden,'installed-mode iOS app hides install');
    const ios=await setup({ios:true});
    assert.ok(!ios.buttons[0].hidden);
    await ios.buttons[0].events.click();
    assert.ok(ios.messages.some(message=>typeof message==='string'&&message.includes('Add to Home Screen')),'iOS receives actionable instructions');
    const before=normal.counts().reloads;
    normal.context.confirm=()=>false;
    await refresh.events.click();
    assert.equal(normal.counts().reloads,before,'cancel never reloads');
    const update=await setup({waiting:true});
    assert.ok(update.root.children.includes(update.buttons[1]),'refresh control lives in the top banner');
    assert.equal(update.buttons[1]['data-update-ready'],'true');
    assert.equal(update.body.children[0].id,'pwa-update-banner');
    assert.equal(update.body.children[0].hidden,false,'update banner appears at top');
    assert.equal(normal.body.children[0].hidden,true,'banner hidden with no pending update');
    assert.ok(update.buttons[1].title.includes('Update available'));
    assert.ok(update.buttons[1].title.includes('Save your project JSON files'));
    await update.buttons[1].events.click();
    assert.equal(update.counts().confirmations,1);
    assert.ok(update.messages.some(message=>message.type==='SKIP_WAITING'));
    assert.equal(update.counts().reloads,0,'wait for activation before reload');
    update.serviceEvents.controllerchange();
    assert.equal(update.counts().reloads,1,'explicitly approved update reloads after activation');
    const other=await setup();
    other.serviceEvents.controllerchange();
    assert.equal(other.counts().reloads,0,'another window updating must not reload unsaved work');
    const release=await setup({published:'1.2.4'});
    assert.equal(release.buttons[1]['data-update-ready'],'true','version endpoint detects release independently of waiting workers');
    assert.ok(release.body.children[0].textContent.includes('1.2.4'));
    assert.equal(release.counts().reloads,0,'release detection preserves unsaved work');
    assert.ok(release.messages.some(message=>message.cache==='no-store'&&message.checkURL.includes('version.json?__check=')));
    await release.buttons[1].events.click();
    assert.ok(release.messages.some(message=>typeof message==='string'&&message.includes('__app_version=1.2.4')),'refresh requests the new version explicitly');
    const stale=await setup({published:'1.2.2'});
    assert.equal(stale.buttons[1]['data-update-ready'],'false','older CDN metadata must not advertise an update');
    const same=await setup();
    await same.buttons[1].events.click();
    assert.equal(same.counts().reloads,1,'manual refresh works with no new build');
    console.log('PWA install prompt, installed-mode detection, iOS guidance, cancellation, and user-approved refresh checks passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
