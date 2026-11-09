import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../../..',import.meta.url));
const read=p=>readFileSync(path.join(root,p),'utf8');
const web=read('resources/em-mobile-web/src/ui/components/icons.tsx');
const desktop=read('app/renderer/src/components/ChatBlocks.tsx');
const brain=read('app/renderer/src/components/ThinkingIcon.tsx');
const section=(text,start,end)=>{const a=text.indexOf(start),b=text.indexOf(end,a);assert.ok(a>=0&&b>a,`missing ${start}`);return text.slice(a,b)};
const paths=s=>[...s.matchAll(/<path\s+d="([^"]+)"/gi)].map(m=>m[1]);
test('thinking icon keeps every desktop brain path in the same order',()=>{
 const expected=paths(brain),actual=paths(section(web,'{brain ? <>','</> : <path d={d} />'));
 assert.equal(expected.length,8);assert.deepEqual(actual,expected);
});
test('web tool geometry and all tool cases match the desktop source',()=>{
 const webBody=section(web,'function toolIconPaths','/** 工具图标与桌面端');
 const pcBody=section(desktop,'function toolIconPaths','// ── Block types');
 const normalized=s=>s.replace(/: (?:React\.ReactElement|JSX\.Element) \| null/,'').replace(/\s+/g,'');
 assert.equal(normalized(webBody),normalized(pcBody));
});
test('all explicit web Icon names have a defined shape',()=>{
 const entries=section(web,'const PATHS:','/** 图标尺寸');const defined=new Set([...entries.matchAll(/^\s+(\w+):\s*'/gm)].map(m=>m[1]));
 const walk=dir=>readdirSync(dir,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?walk(path.join(dir,entry.name)):(entry.name.endsWith('.tsx')?[path.join(dir,entry.name)]:[]));
 for(const file of walk(path.join(root,'resources/em-mobile-web/src'))){
  for(const match of readFileSync(file,'utf8').matchAll(/<Icon\s+name="([^"]+)"/g))assert.ok(defined.has(match[1]),`${file}: ${match[1]}`);
 }
});
test('native and desktop tool icon sets and brain paths stay aligned when native checkout is present',t=>{
 const native=path.join(root,'../EasyMintMobile/src/components/icons.tsx');if(!existsSync(native))return t.skip('原生仓库未在旁边');
 const s=readFileSync(native,'utf8');const nativeBrain=section(s,'const BRAIN:', '/** 机器人');assert.deepEqual(paths(nativeBrain),paths(brain));
 const cases=text=>new Set([...text.matchAll(/case ["']([^"']+)["']/g)].map(m=>m[1]));
 assert.deepEqual([...cases(section(s,'function toolIconShape','/** 工具标题图标'))].sort(),[...cases(section(desktop,'function toolIconPaths','// ── Block types'))].sort());
});
