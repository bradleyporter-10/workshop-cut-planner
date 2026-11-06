const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync(`${__dirname}/../cut-planner.html`, 'utf8');
const source = html.slice(html.indexOf('function layoutSignature('),html.indexOf('function syncLumberDiagramHeight('));
const context = {esc:String,fmtLayout:String,fmt:String,unitMark:()=>'"',layoutCardBody:()=>'<div>Diagram</div>'};
vm.createContext(context);
vm.runInContext(source, context);
const clone = value=>JSON.parse(JSON.stringify(value));
function layout(kind='sheet') {
    return {kind,m:{id:'ply',name:'Plywood',type:kind,width:48,length:96,thickness:.75},kerf:.125,margin:0,count:2,used:200,
        placements:[{x:0,y:0,w:10,h:10,p:{id:'instance-1',name:'Panel',width:10,length:10,thickness:.75,material:'ply'}},
            {x:10.125,y:0,w:10,h:10,p:{id:'instance-2',name:'Panel',width:10,length:10,thickness:.75,material:'ply'}}],
        cuts:[{axis:'h',at:10,from:0,to:48},{axis:'v',at:10,from:0,to:10}]};
}
for (const kind of ['sheet','lumber']) {
    const a=layout(kind),b=clone(a),c=clone(a);
    b.placements.reverse();
    b.placements[0].p.id='other-instance';
    assert.equal(context.groupIdenticalLayouts([a,b,c]).length,1,'order and instance IDs do not change the physical layout');
    const groups=context.groupIdenticalLayouts([a,b,c]);
    assert.deepEqual(Array.from(groups[0].numbers),[1,2,3]);
    const rendered=context.renderLayoutGroups([a,b,c]);
    assert.equal((rendered.match(/<article/g)||[]).length,1);
    assert.ok(rendered.includes(`${kind==='sheet'?'Sheets':'Boards'} 1–3 · Repeat 3 times`));
    assert.ok(rendered.includes(`per ${kind==='sheet'?'sheet':'board'}`));
    for(const change of [
        x=>x.m.id='different-material', x=>x.m.width+=1, x=>x.m.thickness+=.01,
        x=>x.placements[0].x+=.00001, x=>x.placements[0].p.width+=.00001,
        x=>x.placements[0].p.name='Different part', x=>x.placements[0].p.rotate=true,
        x=>x.cuts.reverse(), x=>x.cuts[0].at+=.00001, x=>x.kerf=.25, x=>x.margin=1
    ]) {
        const other=clone(a);change(other);
        assert.equal(context.groupIdenticalLayouts([a,other]).length,2,'distinct plans must not merge');
    }
    const distinct=clone(a);distinct.cuts[0].at+=1;
    const nonconsecutive=context.renderLayoutGroups([a,distinct,b]);
    assert.ok(nonconsecutive.includes(`${kind==='sheet'?'Sheets':'Boards'} 1, 3`));
    assert.ok(!nonconsecutive.includes('1–3'));
    assert.equal(a.count,2,'grouping does not change physical counts');
}
assert.equal(context.groupIdenticalLayouts([layout(),layout('lumber')]).length,2);
assert.equal(context.layoutNumberRanges([1,2,3,5,7,8]),'1–3, 5, 7–8');
assert.equal(context.groupIdenticalLayouts([]).length,0);
console.log('Exact sheet/board consolidation, repeat headings, nonconsecutive numbering, and distinct-layout checks passed.');
