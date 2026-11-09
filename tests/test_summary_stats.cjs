const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync(`${__dirname}/../cut-planner.html`,'utf8');
const source=html.slice(html.indexOf('function renderResults('),html.indexOf('function preparePrintRoot('));
const elements={};
const ctx={
    $:id=>elements[id]||(elements[id]={innerHTML:'',textContent:''}),
    last:{kerf:.125,margin:0,layouts:[]},materials:[],
    displayCutsForLayout:b=>b.cuts,buildPartLabelMap:()=>new Map(),renderLayoutGroups:()=>'',
    fmt:value=>String(Math.round(value*1000)/1000),fmtLayout:String,unitMark:()=>'"',esc:String,
    partKey:p=>JSON.stringify(p),partLabelForKey:()=> 'A',partColorFor:()=> '#fff',
    applyContextHelp(){},printMode:false,requestAnimationFrame(){},syncLumberDiagramHeight(){}
};
vm.createContext(ctx);vm.runInContext(source,ctx);
const sheet={kind:'sheet',m:{id:'sheet',name:'Sheet',width:10,length:10},count:1,used:25,
    cuts:[{axis:'v',at:5,from:0,to:10}],placements:[{w:5,h:5,p:{name:'Panel',width:5,length:5,thickness:.75,material:'sheet'}}]};
const board={kind:'lumber',m:{id:'board',name:'Board',width:2,length:10},count:1,used:8,
    cuts:[{axis:'h',at:1,from:0,to:10},{axis:'v',at:8,from:0,to:1}],placements:[{w:8,h:1,p:{name:'Rail',width:1,length:8,thickness:.75,material:'board'}}]};
ctx.last.layouts=[sheet,{...sheet},board];ctx.renderResults();
assert.match(elements.summary.innerHTML,/<strong>4<\/strong><span>Number of Cuts<\/span>/,'all repeated physical cuts counted');
assert.match(elements.summary.innerHTML,/<strong>73.636%<\/strong><span>Total Waste %<\/span>/,'58 square inches of parts in 220 square inches of stock');
ctx.last.layouts=[sheet];ctx.renderResults();
assert.match(elements.summary.innerHTML,/<strong>75%<\/strong><span>Total Waste %<\/span>/);
ctx.last.layouts=[board];ctx.renderResults();
assert.match(elements.summary.innerHTML,/<strong>60%<\/strong><span>Total Waste %<\/span>/);
ctx.last.layouts=[];ctx.renderResults();
assert.match(elements.summary.innerHTML,/<strong>0%<\/strong><span>Total Waste %<\/span>/);
assert.match(elements.summary.innerHTML,/<strong>0<\/strong><span>Number of Cuts<\/span>/);
console.log('Summary cuts count all repeats; waste is area-weighted for mixed stock, sheet-only, board-only, and empty results.');
