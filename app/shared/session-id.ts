/** ID 同时用作缓存文件名与子会话目录名；允许自定义 ID，但不能带路径语法。 */
export function isSafeSessionId(id: string): boolean {
  return /^[A-Za-z0-9_.-]{1,256}$/.test(id) && id !== "." && id !== "..";
}
