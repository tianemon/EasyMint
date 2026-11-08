/**
 * 10 位配对短码的显示格式：5-5 分组。
 *
 * 手机端可能得照着屏幕手输（相机扫不出、已经装到主屏、或用的是另一台设备），
 * 连成 10 位容易看串行；分组后一眼能对齐。解析时一律把非字母数字去掉，
 * 所以用户带不带横杠都能用。
 */
export function formatPairCode(code: string): string {
  const clean = code.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  if (clean.length !== 10) return clean;
  return `${clean.slice(0, 5)}-${clean.slice(5)}`;
}
