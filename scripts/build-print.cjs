const esbuild=require('esbuild');
const fs=require('node:fs');
const result=esbuild.buildSync({entryPoints:['printing/pdf.mjs'],outfile:'vendor/printing/browser-bundle.js',bundle:true,platform:'browser',format:'iife',globalName:'WorkshopPrint',target:['es2020'],minify:true,legalComments:'eof',metafile:true});
for(const output of Object.values(result.metafile.outputs))if(output.imports.length)throw Error('PDF export must be fully offline');
fs.writeFileSync('vendor/printing/browser-bundle.js',fs.readFileSync('vendor/printing/browser-bundle.js','utf8').replace(/[ \t]+$/gm,''));
console.log('Built offline PDF exporter');
