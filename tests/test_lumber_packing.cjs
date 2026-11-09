const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync(`${__dirname}/../cut-planner.html`,'utf8');
const source=html.slice(html.indexOf('function leaf('),html.indexOf('function layoutPartsRows('))+
    html.slice(html.indexOf('function cutPositionsForLayout('),html.indexOf('function layoutCardBody('));
const context={fmt:String,fmtLayout:String,unitMark:()=>'"',esc:String,cutResultLabels:()=>[]};
vm.createContext(context);vm.runInContext(source,context);
const stock=(width=6)=>({id:'board',name:'Lumber',type:'lumber',width,length:96,thickness:.75});
const part=(length=80,width=2.5,name='Rail')=>({name,length,width,thickness:.75,material:'board'});
function verify(plans,expectedCount,kerf=.125,margin=0){
    assert.equal(plans.reduce((sum,b)=>sum+b.count,0),expectedCount);
    for(const b of plans){
        assert.equal(b.count,b.placements.length);
        assert.equal(b.used,b.placements.reduce((sum,z)=>sum+z.w*z.h,0));
        for(const [i,z] of b.placements.entries()){
            assert.ok(z.x>=margin-1e-7&&z.y>=margin-1e-7);
            assert.ok(z.x+z.w<=b.m.length-margin+1e-7&&z.y+z.h<=b.m.width-margin+1e-7,'part stays within usable board');
            for(const other of b.placements.slice(i+1)){
                assert.ok(z.x+z.w+kerf<=other.x+1e-7||other.x+other.w+kerf<=z.x+1e-7||z.y+z.h+kerf<=other.y+1e-7||other.y+other.h+kerf<=z.y+1e-7,'parts are separated by blade kerf');
            }
        }
        // Each cut must split a remaining physical piece before its children are cut.
        const pieces=[{x:margin,y:margin,right:b.m.length-margin,bottom:b.m.width-margin}];
        for(const cut of b.cuts){
            const vertical=cut.axis==='v';
            const index=pieces.findIndex(r=>Math.abs(cut.from-(vertical?r.y:r.x))<1e-6&&Math.abs(cut.to-(vertical?r.bottom:r.right))<1e-6&&cut.at>=(vertical?r.x:r.y)-1e-6&&cut.at<=(vertical?r.right:r.bottom)+1e-6);
            assert.ok(index>=0,'cut follows a feasible guillotine sequence');
            const near={...pieces[index]},far={...pieces[index]};
            if(vertical){near.right=cut.at;far.x=cut.at+kerf;}else{near.bottom=cut.at;far.y=cut.at+kerf;}
            pieces.splice(index,1,near,far);
        }
        assert.equal(context.displayCutsForLayout(b).length,b.cuts.length,'rip cuts are included in numbered operations');
        assert.ok(context.cutPositionsForLayout(b,b.cuts).every(position=>position.distance>=-1e-7));
    }
}
for(const quality of ['fast','better','best']){
    const plans=context.boardPlan(stock(),[part(),part()],.125,0,quality);
    assert.equal(plans.length,1,'two 2.5-inch rails share a 6-inch board');
    assert.ok(plans[0].placements[0].y!==plans[0].placements[1].y);
    verify(plans,2);
    const table=context.layoutCutRows(plans[0]);
    assert.ok(table.includes('rip')&&table.includes('crosscut'));
    assert.ok(table.includes('board side edge'));
    const four=context.boardPlan(stock(),Array.from({length:4},()=>part(40)),.125,0,quality);
    assert.equal(four.length,1,'two parts across and two down use one board');verify(four,4);
}
assert.equal(context.boardPlan(stock(5),[part(),part()],.125,0).length,2,'kerf prevents a false across-width fit');
const exact=context.boardPlan(stock(5.125),[part(),part()],.125,0);assert.equal(exact.length,1);verify(exact,2);
const trimmed=context.boardPlan(stock(),[part(),part()],.125,.5);assert.equal(trimmed.length,2);verify(trimmed,2,.125,.5);
const narrow=context.boardPlan(stock(2.5),[part(40),part(40)],.125,0);assert.equal(narrow.length,1);verify(narrow,2);
const rotated=context.boardPlan(stock(),[part(2.5,80)],.125,0);verify(rotated,1);
assert.equal(rotated[0].placements[0].p.width,80,'retain original part dimensions for parts list');
assert.equal(rotated[0].placements[0].p.length,2.5);
assert.throws(()=>context.boardPlan(stock(),[part(120,7)],.125,0),/cannot fit/);
const mixed=context.boardPlan(stock(),[part(50,3),part(40,2.5),part(20,2.5),part(15,1.5)],.125,.25);verify(mixed,4,.125,.25);
console.log('Lumber side-by-side packing, kerf/margins, cut feasibility, rip numbering, and preserved dimensions passed.');
