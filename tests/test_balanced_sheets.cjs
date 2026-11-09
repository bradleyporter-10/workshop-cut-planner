const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync(`${__dirname}/../cut-planner.html`,'utf8');
const context={fmt:String};vm.createContext(context);
vm.runInContext(html.slice(html.indexOf('function leaf('),html.indexOf('function layoutPartsRows(')),context);
const stock={id:'sheet',name:'Plywood',width:48,length:96,thickness:.75};
const parts=dims=>dims.map(([width,length],i)=>({name:'Part '+i,width,length,thickness:.75,material:'sheet'}));
function verify(layouts,items,kerf,margin){
    assert.equal(layouts.reduce((sum,b)=>sum+b.count,0),items.length);
    const ids=[];
    for(const b of layouts){
        for(const [i,z] of b.placements.entries()){
            ids.push(z.p.name);
            assert.ok(z.x>=margin-1e-7&&z.y>=margin-1e-7);
            assert.ok(z.x+z.w<=stock.width-margin+1e-7&&z.y+z.h<=stock.length-margin+1e-7);
            const original=items.find(item=>item.name===z.p.name);
            assert.ok((z.w===original.width&&z.h===original.length)||(z.w===original.length&&z.h===original.width));
            for(const other of b.placements.slice(i+1))assert.ok(z.x+z.w+kerf<=other.x+1e-7||other.x+other.w+kerf<=z.x+1e-7||z.y+z.h+kerf<=other.y+1e-7||other.y+other.h+kerf<=z.y+1e-7,'no overlap or lost kerf');
        }
    }
    assert.deepEqual(ids.sort(),items.map(p=>p.name).sort());
}
const items=parts([[13,36],[22,60],[7,24],[10,28],[25,16],[10,16],[13,44],[22,20],[13,60],[10,52],[25,40],[19,24],[4,36],[4,36]]);
const minimum=context.sheetPlan(stock,items,.125,0,'better','material');
const balanced=context.sheetPlan(stock,items,.125,0,'better','balanced');
assert.equal(JSON.stringify(context.sheetPlan(stock,items,.125,0,'better')),JSON.stringify(balanced),'default uses balanced mode');
assert.deepEqual(JSON.parse(JSON.stringify(context.sheetPlanEffort(minimum))),{sheets:2,cuts:27,sideways:6});
assert.deepEqual(JSON.parse(JSON.stringify(context.sheetPlanEffort(balanced))),{sheets:2,cuts:24,sideways:1});
for(const quality of ['fast','better','best'])for(const margin of [0,.25]){
    const a=context.sheetPlan(stock,items,.125,margin,quality,'material'),b=context.sheetPlan(stock,items,.125,margin,quality,'balanced');
    verify(a,items,.125,margin);verify(b,items,.125,margin);
    assert.ok(context.balancedSheetScore(b)<=context.balancedSheetScore(a)+1e-9);
    assert.ok(b.length<=a.length+Math.max(1,Math.floor(a.length*.15)));
}
const extra=parts([[8,28],[2,40],[10,28],[8,28],[10,28],[6,48],[2,12],[6,48],[8,28],[2,12],[10,28],[2,12],[6,48],[2,40],[8,28],[6,48],[8,28],[2,12],[6,48],[10,28],[10,28],[8,28],[8,28],[6,48],[2,12],[8,28],[2,40],[8,28],[6,48],[8,28],[10,28],[8,28],[2,12],[2,12],[8,28],[2,12],[10,28],[6,48],[2,40],[10,28],[2,40],[2,12],[2,12],[2,12],[2,40],[8,28],[6,48],[10,28],[8,28],[2,12],[8,28],[8,28],[10,28],[2,40],[2,12],[2,40],[6,48],[2,40],[2,40],[2,40],[2,12],[8,28],[8,28],[8,28],[10,28],[2,12],[2,40],[2,12],[6,48],[2,12],[6,48],[8,28],[2,12],[8,28],[8,28],[6,48],[8,28],[2,40],[10,28],[2,12],[2,40],[8,28],[2,12],[10,28],[2,40],[10,28],[2,40],[6,48],[2,40],[6,48]]);
const a=context.sheetPlan(stock,extra,.125,0,'fast','material'),b=context.sheetPlan(stock,extra,.125,0,'fast','balanced');
assert.equal(a.length,4);assert.equal(b.length,5,'balanced may use an extra sheet for simpler cutting');
assert.ok(context.sheetPlanEffort(b).cuts<context.sheetPlanEffort(a).cuts);
assert.ok(context.sheetPlanEffort(b).sideways<context.sheetPlanEffort(a).sideways);
verify(b,extra,.125,0);
// A part that requires rotation to fit must remain allowed.
verify(context.sheetPlan(stock,parts([[60,40]]),.125,0,'better','balanced'),parts([[60,40]]),.125,0);
assert.throws(()=>context.sheetPlan(stock,parts([[100,100]]),.125,0,'better','balanced'),/does not fit/);
console.log('Balanced sheets reduce cuts/sideways parts, allow a justified extra sheet, and preserve fits, kerf, margins, and default mode.');
