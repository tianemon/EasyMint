import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url));
test('home-screen icon builds from a source inside the checkout',()=>{
 const source=readFileSync(new URL('../tools/brand-icons.mjs',import.meta.url),'utf8');
 assert.match(source,/path\.join\(root, 'assets', 'appicon\.png'\)/);
 assert.doesNotMatch(source,/EasyMintMobile/);
 assert.ok(existsSync(`${root}/assets/appicon.png`));
});
