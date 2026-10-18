// Build-time normalization only; runtime never guesses CSS from prose.
const fs = require('node:fs'), path = require('node:path'), YAML = require('yaml');
const root = path.resolve(__dirname, '..'), dir = path.join(root, 'resources/skills/brand-tokens/brands');
const curated = new Set(['apple','linear.app','notion','stripe','figma','airbnb']);
const color = value => typeof value === 'string' && /^#(?:[\da-f]{3}|[\da-f]{6}|[\da-f]{8})$/i.test(value.trim()) ? value.trim() : undefined;
const rows = fs.readdirSync(dir).sort().filter(id => fs.existsSync(path.join(dir,id,'DESIGN.md'))).map(id => {
 const text=fs.readFileSync(path.join(dir,id,'DESIGN.md'),'utf8'), fm=text.match(/^---\r?\n([\s\S]*?)\r?\n---/);let data={};
 try {if(fm)data=YAML.parse(fm[1],{uniqueKeys:false})||{};}catch{}
 const textStyles=Object.entries(data.typography||{}).filter(([,value])=>value&&typeof value==='object');
 const body=textStyles.find(([key])=>/^body(?:-|$)/.test(key))?.[1]||{},display=textStyles.find(([key])=>/display|hero|heading/.test(key))?.[1]||{};
 const size=value=>typeof value==='string'&&/^\d+(?:\.\d+)?px$/.test(value)?parseFloat(value):undefined;
 const typography={bodySize:size(body.fontSize),displaySize:size(display.fontSize),fontFamily:typeof body.fontFamily==='string'?body.fontFamily:undefined};
 const rounded=Object.fromEntries(Object.entries(data.rounded||{}).filter(([,value])=>size(value)!==undefined));
 const colors=data.colors||{}, accent=color(colors.primary), ink=color(colors.ink||colors.body), background=color(colors.canvas||colors['canvas-soft']);
 return {id,typography,rounded,name:id.replace(/(^|-)([a-z])/g,(_m,p,c)=>(p?' ':'')+c.toUpperCase()),quality:accent&&ink?'derived':'reference',curated:curated.has(id)&&!!accent&&!!ink,...(accent?{accent}:{}),...(ink?{ink}:{}),...(background?{background}:{}),source:`brand-tokens/brands/${id}/DESIGN.md`};
});
const target=path.join(root,'app/shared/visual-design/brands.json'), output=JSON.stringify(rows,null,2)+'\n';
if(process.argv.includes('--check')){if(fs.readFileSync(target,'utf8')!==output)throw Error('Visual brand registry is stale');}else fs.writeFileSync(target,output);
console.log(`Visual references: ${rows.length}, curated: ${rows.filter(x=>x.curated).length}`);
