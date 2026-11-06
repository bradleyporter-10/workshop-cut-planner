const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync(`${__dirname}/../cut-planner.html`, 'utf8');
const source = html.slice(html.indexOf('function cutPositionsForLayout('), html.indexOf('function layoutCardBody('));
for (const metric of [false, true]) {
    const context = {
        displayCutsForLayout: b => b.cuts,
        cutResultLabels: () => [],
        fmtLayout: value => String(metric ? Math.round(value * 25.4 * 100) / 100 : value),
        unitMark: () => metric ? 'mm' : '"',
        esc: String
    };
    vm.createContext(context);
    vm.runInContext(source, context);
    const vertical = { axis: 'v', at: 10, from: 5, to: 25 };
    const horizontal = { axis: 'h', at: 20, from: 10, to: 40 };
    const sheet = context.layoutCutRows({ kind: 'sheet', m: {width:48,length:96}, cuts: [vertical, horizontal] });
    assert.ok(sheet.includes(`${metric ? 254 : 10}${context.unitMark()} from left edge`));
    assert.ok(sheet.includes(`${metric ? 508 : 20}${context.unitMark()} from top edge`));
    const board = context.layoutCutRows({ kind: 'lumber', m: {width:48,length:96}, cuts: [vertical] });
    assert.ok(board.includes(`${metric ? 254 : 10}${context.unitMark()} from board start`));
    assert.match(context.layoutCutRows({ cuts: [] }), /colspan="6"/);
    const cuts = [
        {axis:'v',at:33.75,from:0,to:96},
        {axis:'h',at:80,from:33.875,to:48},
        {axis:'v',at:47.875,from:80.125,to:96}
    ];
    const stock = {kind:'sheet',m:{width:48,length:96},kerf:.125,cuts};
    const positions = context.cutPositionsForLayout(stock,cuts);
    assert.equal(positions[2].distance,14);
    assert.equal(positions[2].cut,1,'reference survives a perpendicular cut');
    assert.ok(context.layoutCutRows(stock).includes(`${metric ? 355.6 : 14}${context.unitMark()} from cut 1 edge`));
    const boardCuts = [
        {axis:'v',at:30,from:0,to:4},
        {axis:'v',at:50.125,from:0,to:4}
    ];
    const boardPositions = context.cutPositionsForLayout({kind:'lumber',m:{width:4,length:96},kerf:.125},boardCuts);
    assert.equal(boardPositions[1].distance,20);
    assert.equal(boardPositions[1].cut,1);

}
assert.match(html, /<th[^>]*>POSITION<\/th>/);
console.log('Cut positions passed for sheets, lumber, inches, and millimeters.');
