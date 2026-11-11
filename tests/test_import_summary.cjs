const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync(`${__dirname}/../cut-planner.html`,'utf8');
const elements=new Map();
let nextId=0,importedThicknesses=[.75];
const context={
    materials:[{id:'existing',name:'Plywood',type:'sheet',thickness:.75}],parts:[],
    openskpModule:{parseSkp:()=>({})},window:{},resultTabs:null,assemblyViewer:null,
    skpPartLinks:new Map(),skpImportSummary:'',skpImportIssues:[],skpOverrideCandidates:[],
    $:id=>{if(!elements.has(id))elements.set(id,{hidden:false,checked:false,open:true,textContent:''});return elements.get(id);},
    uid:()=>`part-${++nextId}`,number:Number,fmt:String,
    extractFromSkpModel:()=>({counts:new Map(importedThicknesses.map((t,i)=>[`Panel ${i}|24|12|${t}`,2])),issues:[],instanceKeys:new Map()}),
    renderAll:()=>context.updatePartsSummary(),renderSkpImportReport:()=>context.updatePartsSummary()
};
vm.createContext(context);
for(const name of ['updatePartsSummary','ensureMaterialByThickness','loadSkpIntoParts']){
    const start=html.indexOf(`function ${name}(`),end=html.indexOf('\n',start);
    vm.runInContext((name==='loadSkpIntoParts'?'async ':'')+html.slice(start,end),context);
}
const file={name:'summary.skp',arrayBuffer:async()=>new ArrayBuffer(0)};
const notice='Auto-created thickness-matched stock rows where needed.';
(async()=>{
    await context.loadSkpIntoParts(file);
    assert.equal(context.materials.length,1);
    assert.ok(!context.skpImportSummary.includes(notice),'reuse of matching stock must not claim auto-created rows');
    importedThicknesses=[.5];
    await context.loadSkpIntoParts(file);
    assert.equal(context.materials.length,2);
    assert.ok(context.skpImportSummary.includes(notice),'creation of a missing thickness reports new stock');
    await context.loadSkpIntoParts(file);
    assert.equal(context.materials.length,2);
    assert.ok(!context.skpImportSummary.includes(notice),'repeat import removes the previous creation notice');
    importedThicknesses=[.7505,.25];
    await context.loadSkpIntoParts(file);
    assert.equal(context.materials.length,3,'stock matching uses the existing thickness tolerance');
    assert.ok(context.skpImportSummary.includes(notice),'mixed reused/new stock reports creation');
    assert.equal(elements.get('parts-list-summary').textContent,context.skpImportSummary);
    assert.equal(elements.get('parts-list-details').open,false);
    console.log('Import summaries passed: reused/new/mixed stock, repeated imports, thickness tolerance, and displayed summary.');
})().catch(error=>{console.error(error);process.exitCode=1;});
