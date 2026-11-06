const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const docs = path.resolve(__dirname, '../docs');
const manifest = JSON.parse(fs.readFileSync(path.join(docs, 'manifest.webmanifest')));
assert.equal(manifest.scope, './');
assert.equal(manifest.start_url, './index.html');
assert.equal(manifest.display, 'standalone');
for (const icon of manifest.icons) {
    const png = fs.readFileSync(path.join(docs, icon.src));
    assert.equal(png.subarray(1, 4).toString(), 'PNG');
    assert.equal(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`, icon.sizes);
}
const html = fs.readFileSync(path.join(docs, 'index.html'), 'utf8');
assert.match(html, /rel="manifest" href="\.\/manifest.webmanifest"/);
assert.ok(!/<script\b[^>]*\bsrc=/.test(html), 'direct file mode remains self-contained');
const worker = fs.readFileSync(path.join(docs, 'sw.js'), 'utf8');
assert.ok(!worker.includes('__BUILD_VERSION__'));
const handlers = {}, stores = new Map();
const scope = 'https://example.test/workshop-cut-planner/';
const prefix = 'workshop-cut-planner:' + scope + ':';
stores.set(prefix + 'old', new Map());
stores.set('another-app-cache', new Map());
let networkCalls = 0;
const context = {
    URL, Request,
    self: {registration:{scope}, location:{origin:'https://example.test'}, clients:{claim:async()=>{}},
        addEventListener:(type, fn)=>handlers[type]=fn},
    caches: {
        keys:async()=>[...stores.keys()],
        delete:async key=>stores.delete(key),
        open:async key=>{
            if (!stores.has(key)) stores.set(key,new Map());
            const items = stores.get(key);
            return {addAll:async requests=>requests.forEach(r=>items.set(r.url,{url:r.url})), match:async url=>items.get(url)};
        }
    },
    fetch:async()=>{networkCalls++;throw Error('Offline');}
};
vm.runInNewContext(worker, context);
async function lifecycle(type) {let task;handlers[type]({waitUntil:p=>task=p});await task;}
async function request(url, mode='navigate', method='GET') {
    let result;
    handlers.fetch({request:{url,mode,method}, respondWith:p=>result=p});
    return result ? await result : undefined;
}
(async()=>{
    await lifecycle('install');
    await lifecycle('activate');
    assert.ok(stores.has('another-app-cache'), 'unrelated caches retained');
    assert.ok(!stores.has(prefix+'old'), 'obsolete app cache removed');
    const index = scope+'index.html';
    assert.equal((await request(scope)).url,index);
    assert.equal((await request(index+'?launch=home')).url,index);
    assert.equal((await request(scope+'icons/icon-192.png','cors')).url,scope+'icons/icon-192.png');
    assert.equal(await request('https://elsewhere.test/'),undefined);
    assert.equal(await request(scope+'model.skp','cors'),undefined);
    assert.equal(await request(index,'navigate','POST'),undefined);
    assert.equal(networkCalls,0,'pre-cached app opens with no network');
    console.log('PWA manifest/icons, subdirectory offline navigation, scoped cache cleanup, and file mode passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
