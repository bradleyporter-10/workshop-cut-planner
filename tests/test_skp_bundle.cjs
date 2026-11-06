const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'vendor/openskp/browser-bundle.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'cut-planner.html'), 'utf8');
const context = vm.createContext({
    TextDecoder, TextEncoder, console,
    fetch() { throw new Error('Network access is forbidden in offline import'); },
    XMLHttpRequest() { throw new Error('Network access is forbidden in offline import'); }
});
vm.runInContext(source, context, {timeout: 10000});
assert.equal(typeof context.WorkshopSkp.parseSkp, 'function');
assert.match(html, /<script src="vendor\/openskp\/browser-bundle.js"><\/script>/);
assert.ok(!html.includes("import('./vendor/openskp/"), 'no dynamic module loading');
const fixture = fs.readFileSync(path.join(root, 'sketchup-examples/playroom cabinets.skp'));
// Construct the input in the browser-like realm; no Node require or networking is provided.
context.bytes = [...fixture];
vm.runInContext('model = WorkshopSkp.parseSkp(new Uint8Array(bytes).buffer)', context, {timeout: 30000});
assert.ok(context.model.root, 'real SKP model has a root');
assert.ok(context.model.definitions, 'real SKP model has component definitions');
console.log('Offline classic-script bundle parsed the real SketchUp fixture with network access forbidden.');
