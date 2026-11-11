const esbuild = require('esbuild');
const result = esbuild.buildSync({
    entryPoints: ['assembly/viewer.mjs'],
    outfile: 'vendor/assembly/browser-bundle.js',
    bundle: true,
    platform: 'browser',
    format: 'iife',
    globalName: 'WorkshopAssembly',
    target: ['es2020'],
    minify: true,
    legalComments: 'eof',
    metafile: true
});
for (const output of Object.values(result.metafile.outputs)) {
    if (output.imports.length) throw Error('Assembly bundle must be fully offline');
}
// Three.js shader template literals contain trailing indentation; normalize it for distribution diffs.
const fs = require('node:fs');
const output = 'vendor/assembly/browser-bundle.js';
fs.writeFileSync(output, fs.readFileSync(output, 'utf8').replace(/[ \t]+$/gm, ''));
console.log('Built offline assembly viewer');
