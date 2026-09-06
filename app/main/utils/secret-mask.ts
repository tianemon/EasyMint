/**
 * 输出凭据脱敏 — agent 若违规把密码/凭据内联进命令，输出会明文进入聊天流与日志。
 * 键值白名单只打「敏感键 = 值」形态与 URL 连接串凭据，普通输出（pwd 目录、计数 token: 5 等）不受影响。
 * 应用点：bash 工具输出（前台返回 + 后台落盘）——用户自己跑的进程日志（RunPanel）不打码。
 */

const KEY_VALUE_RE =
  /(\b(?:password|passwd|secret|api[_-]?key|access[_-]?key|private[_-]?key|client[_-]?secret|auth[_-]?token|session[_-]?token|bearer)\b\s*[:=]\s*)(["']?)([^\s"',;{}]{4,})/gi;

const URL_CRED_RE = /([a-z][a-z0-9+.-]*:\/\/)([^/\s:@]+):([^/\s@]+)@/gi;

/** 对文本做凭据脱敏（幂等：打码结果不会再命中规则）。按行处理保持结构。 */
export function maskSecrets(text: string): string {
  return text
    .split("\n")
    .map((line) => line.replace(KEY_VALUE_RE, "$1$2***").replace(URL_CRED_RE, "$1$2:***@"))
    .join("\n");
}
