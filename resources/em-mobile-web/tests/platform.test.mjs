// 平台判定回归：UA 串取自真机 / 厂商文档，不靠猜。
// 每条断言都写明「破坏后应失败」——这些串里最容易踩的是鸿蒙：
//  - 鸿蒙 4 及以前是安卓底座，UA 里 Android 和 HarmonyOS 同时出现，顺序错了就归到 android；
//  - 鸿蒙 5（NEXT）换成 ArkWeb，UA 里根本没有 Android，漏了 OpenHarmony/ArkWeb 就掉进 desktop。
import assert from 'node:assert/strict';
import test from 'node:test';

import { detectPlatform, isMobileShell } from '../src/core/platform.ts';

const UA = {
  iosSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
  iosChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/124.0.6367.88 Mobile/15E148 Safari/604.1',
  ipadDesktop: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  androidChrome: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
  miui: 'Mozilla/5.0 (Linux; U; Android 13; zh-cn; 2211133C Build/TKQ1.221114.001) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/100.0.4896.58 Mobile Safari/537.36 XiaoMi/MiuiBrowser/17.3.9',
  harmony4: 'Mozilla/5.0 (Linux; Android 12; HarmonyOS; NOH-AN00; HMSCore 6.13.0.302) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/99.0.4844.88 HuaweiBrowser/14.0.3.312 Mobile Safari/537.36',
  harmonyNext: 'Mozilla/5.0 (Phone; OpenHarmony 5.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36 ArkWeb/4.1.6.1 Mobile',
  macSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
};

test('detectPlatform：iOS 走 100vh + 分层折射', () => {
  assert.equal(detectPlatform(UA.iosSafari), 'ios', '破坏后应失败：iPhone Safari 认成桌面端（高度会退回 dvh）');
  assert.equal(detectPlatform(UA.iosChrome), 'ios', '破坏后应失败：iOS Chrome（CriOS）漏判');
  // iPadOS 13+ 默认桌面 UA，只能靠触点数区分
  assert.equal(detectPlatform(UA.ipadDesktop, 5), 'ios', '破坏后应失败：iPad 桌面 UA + 触点漏判');
  assert.equal(detectPlatform(UA.ipadDesktop, 0), 'desktop', '破坏后应失败：没有触点的 Mac 被当成 iPad');
});

test('detectPlatform：安卓 / 鸿蒙各自归位，鸿蒙优先于安卓', () => {
  assert.equal(detectPlatform(UA.androidChrome), 'android', '破坏后应失败：Pixel 认不出');
  assert.equal(detectPlatform(UA.miui), 'android', '破坏后应失败：小米自带浏览器认不出');
  // 鸿蒙 4 的 UA 同时含 Android 与 HarmonyOS：必须先判鸿蒙
  assert.equal(detectPlatform(UA.harmony4), 'harmony', '破坏后应失败：鸿蒙 4 被归到 android（判定顺序错）');
  // 鸿蒙 NEXT 没有 Android 字样，只有 ArkWeb / OpenHarmony
  assert.equal(detectPlatform(UA.harmonyNext), 'harmony', '破坏后应失败：鸿蒙 NEXT 掉进 desktop');
  assert.equal(detectPlatform(UA.macSafari), 'desktop', '破坏后应失败：Mac Safari 被当成移动端');
  assert.equal(detectPlatform(UA.windows), 'desktop', '破坏后应失败：Windows 被当成移动端');
});

test('材质口径：所有平台都允许使用统一渲染器', () => {
  assert.equal(isMobileShell('android'), true, '破坏后应失败：安卓不再吃移动壳补丁');
  assert.equal(isMobileShell('harmony'), true, '破坏后应失败：鸿蒙不再吃移动壳补丁（输入卡会只剩染色）');
  assert.equal(isMobileShell('ios'), false, '破坏后应失败：iOS 被算进移动壳补丁');
  assert.equal(isMobileShell('desktop'), false, '破坏后应失败：桌面端被算进移动壳补丁');
});
