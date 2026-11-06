const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync(`${__dirname}/../cut-planner.html`, 'utf8');
const source = html.slice(html.indexOf('function fmtLayout('), html.indexOf('\nfunction ', html.indexOf('function fmtLayout(')+1));
const context = {currentUnit:'in',fmtDisplay:value=>String(Math.round(value*1000)/1000)};
vm.createContext(context);
vm.runInContext(source,context);
for(const [value,expected] of [[0,'0'],[14,'14'],[14.125,'14 1/8'],[3.5,'3 1/2'],[.03125,'1/32'],[23.96875,'23 31/32'],[-.75,'-3/4'],[14.12500000001,'14 1/8'],[3.484375,'3.484'],[14.126,'14.126']]) {
    assert.equal(context.fmtLayout(value),expected);
}
// Every exact 1/32 increment round-trips without rounding to a coarser fraction.
for(let ticks=0;ticks<3200;ticks++) {
    const value=context.fmtLayout(ticks/32);
    const [whole,fraction]=value.includes(' ')?value.split(' '):value.includes('/')?['0',value]:[value,null];
    const [numerator,denominator]=fraction?fraction.split('/').map(Number):[0,1];
    assert.equal(+whole+numerator/denominator,ticks/32);
}
context.currentUnit='mm';
assert.equal(context.fmtLayout(3.5),'3.5','metric delegates to existing decimal formatter');
for(const name of ['renderMaterials','renderParts','setDisplayedControlValues']) {
    const start=html.indexOf(`function ${name}(`);
    const end=html.indexOf('\n',start);
    assert.ok(!html.slice(start,end).includes('fmtLayout('),`${name} retains decimal formatting`);
}
console.log('Layout fractions passed, including decimal fallbacks and input-section isolation.');
