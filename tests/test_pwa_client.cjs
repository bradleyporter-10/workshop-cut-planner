const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(`${__dirname}/../pwa/client.js`,'utf8');
class Element {
    constructor(){this.hidden=false;this.disabled=false;this.events={};this.children=[];}
    append(...nodes){this.children.push(...nodes);}
    setAttribute(name,value){this[name]=value;}
    addEventListener(name,fn){this.events[name]=fn;}
}
async function setup({ios=false,standalone=false,waiting=false}={}) {
    const buttons=[],events={},serviceEvents={},mediaEvents={},messages=[];
    const root=new Element(),body=new Element();
    let reloads=0,updates=0,confirmations=0;
    const media={matches:standalone,addEventListener:(name,fn)=>mediaEvents[name]=fn};
    const registration={active:{},waiting:waiting?{postMessage:msg=>messages.push(msg)}:null,addEventListener(){},update:async()=>{updates++;}};
    const context={
        location:{protocol:'https:',reload:()=>reloads++},
        window:{isSecureContext:true,matchMedia:()=>media,addEventListener:(name,fn)=>events[name]=fn},
        navigator:{userAgent:ios?'iPhone':'Chrome',onLine:true,serviceWorker:{controller:{},register:async()=>registration,ready:Promise.resolve(registration),addEventListener:(name,fn)=>{const previous=serviceEvents[name];serviceEvents[name]=()=>{previous?.();fn();};}}},
        document:{readyState:'complete',hidden:false,body,createElement:tag=>{const el=new Element();if(tag==='button')buttons.push(el);return el;},querySelector:()=>root,addEventListener(){}},
        confirm:()=>{confirmations++;return true;},alert:message=>messages.push(message),console,
        setInterval(){},setTimeout:()=>1,clearTimeout(){}
    };
    vm.runInNewContext(source,context);
    await new Promise(resolve=>setImmediate(resolve));
    return {buttons,events,serviceEvents,media,mediaEvents,messages,context,registration,
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
    assert.ok(ios.messages[0].includes('Add to Home Screen'),'iOS receives actionable instructions');
    const before=normal.counts().reloads;
    normal.context.confirm=()=>false;
    await refresh.events.click();
    assert.equal(normal.counts().reloads,before,'cancel never reloads');
    const update=await setup({waiting:true});
    await update.buttons[1].events.click();
    assert.equal(update.counts().confirmations,1);
    assert.equal(update.messages[0].type,'SKIP_WAITING');
    assert.equal(update.counts().reloads,0,'wait for activation before reload');
    update.serviceEvents.controllerchange();
    assert.equal(update.counts().reloads,1,'explicitly approved update reloads after activation');
    const other=await setup();
    other.serviceEvents.controllerchange();
    assert.equal(other.counts().reloads,0,'another window updating must not reload unsaved work');
    const same=await setup();
    await same.buttons[1].events.click();
    assert.equal(same.counts().reloads,1,'manual refresh works with no new build');
    console.log('PWA install prompt, installed-mode detection, iOS guidance, cancellation, and user-approved refresh checks passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
