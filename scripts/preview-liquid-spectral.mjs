import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
const root = path.resolve(import.meta.dirname,'..');
const source = path.join(root,'design-assets/labs/liquid-glass-spectral');
const out = path.join(root,'private_docs/design/liquid-glass-spectral');
const bundle = await build({entryPoints:[path.join(source,'lab.js')],bundle:true,format:'iife',platform:'browser',write:false,legalComments:'eof'});
const html = fs.readFileSync(path.join(source,'index.html'),'utf8')
  .replace('<link rel="stylesheet" href="lab.css">', '<style>'+fs.readFileSync(path.join(source,'lab.css'),'utf8')+'</style>')
  .replace('<script type="module" src="lab.js"></script>', '<script>'+bundle.outputFiles[0].text.replaceAll('</script','<\\/script')+'</script>');
fs.mkdirSync(out,{recursive:true});
for(const name of ['index.html','liquid-glass-spectral.html']) fs.writeFileSync(path.join(out,name),html);
console.log(path.join(out,'liquid-glass-spectral.html'));
