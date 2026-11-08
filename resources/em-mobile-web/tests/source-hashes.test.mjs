// 防漂移：复制进 src/core 与 src/protocol 的逻辑来自手机 App 仓库。
//
// 清单里固化了两套哈希，职责分开：
//  - localSha256：本项目内 `src/<target>` 复制文件的**内容哈希**。这是主校验的依据，
//    固化在本仓库，不依赖任何外部路径——只 clone 桌面端发布仓库时照常执行。
//  - sha256：手机 App 源仓库 `<source>` 文件的哈希。仅在源仓库可达时额外比对，
//    用来发现「手机端逻辑改了而这里没同步」；源仓库不存在时明确跳过，npm test 不因此失败。
//
// 早期版本只固化了源哈希、且唯一的比对测试在源仓库不可达时直接 skip，
// 结果独立发布仓库里对本仓库复制文件零校验（恒绿）。这里拆成「无条件主校验 + 可选漂移检测」。
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const mobileSrc = process.env.EASYMINT_MOBILE_SRC || path.resolve(root, '../../../EasyMintMobile/src');
const manifest = JSON.parse(readFileSync(path.join(root, 'src/core/SOURCE_HASHES.json'), 'utf8'));

const sha256Of = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

test('清单覆盖所有复制的逻辑文件，且每项都固化了本仓库文件哈希', () => {
  assert.ok(Object.keys(manifest).length >= 25, '至少覆盖 25 个源文件');
  for (const [target, entry] of Object.entries(manifest)) {
    assert.equal(typeof entry.source, 'string', `${target} 缺 source`);
    assert.match(entry.sha256, /^[0-9a-f]{64}$/, `${target} 缺源仓库 sha256`);
    assert.match(entry.localSha256, /^[0-9a-f]{64}$/, `${target} 缺 localSha256（本仓库文件哈希）`);
  }
});

// 主校验：恒执行，不依赖源仓库。改坏/漏改本仓库任一复制文件都会在这里失败。
test('本仓库复制文件内容与固化清单一致（独立发布仓库也必须校验）', () => {
  const drifted = [];
  for (const [target, entry] of Object.entries(manifest)) {
    const file = path.join(root, 'src', target);
    if (!existsSync(file)) { drifted.push(`${target}: 文件不存在 src/${target}`); continue; }
    if (sha256Of(file) !== entry.localSha256) drifted.push(`${target} <- src/${target}`);
  }
  assert.deepEqual(drifted, [],
    `以下本项目内复制文件已偏离固化清单，确认改动后请更新 SOURCE_HASHES.json 的 localSha256：\n${drifted.join('\n')}`);
});

// 附加校验：源仓库可达时比对源文件，检测手机端逻辑的无声漂移。
// 源仓库不可达（例如独立发布的桌面端仓库）时明确跳过，不影响 npm test。
const sourceAvailable = existsSync(mobileSrc);
test('手机 App 源逻辑未发生无声漂移（仅源仓库可达时）', {
  skip: !sourceAvailable && `手机 App 源仓库不可达（${mobileSrc}），跳过漂移校验`,
}, () => {
  const changed = [];
  for (const [target, entry] of Object.entries(manifest)) {
    const source = path.join(mobileSrc, entry.source);
    if (!existsSync(source)) { changed.push(`${target}: 源文件不存在 ${entry.source}`); continue; }
    if (sha256Of(source) !== entry.sha256) changed.push(`${target} <- ${entry.source}`);
  }
  assert.deepEqual(changed, [],
    `以下移动端逻辑已变更，请重新同步并更新 SOURCE_HASHES.json：\n${changed.join('\n')}`);
});
