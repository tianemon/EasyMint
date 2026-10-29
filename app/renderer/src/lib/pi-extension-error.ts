/**
 * 扩展错误该不该弹 toast。
 *
 * 为什么需要分流：pi 的 ExtensionError 有两种来路——**初始化阶段**（每次建立会话都会重跑：
 * 加载扩展、注册 provider / 虚拟模型 / MCP server）与**运行期钩子**（工具结果、消息、上下文等，
 * 由用户这一次对话触发）。初始化阶段的失败是后台状态：每开一个会话就弹一次顶部提示，用户在聊天
 * 里既处理不了也记不住（MCP 那条提醒已因同一原因静默），排查它的地方是「设置 → 插件 → 扩展」
 * 列表里的红字。运行期失败才是当下这次对话的即时反馈，仍要弹。
 *
 * 判据是 event 名而不是文案：pi 的 event 取值是其公开契约（`ExtensionError.event`），
 * 新增的未知 event 一律按「要弹」处理——宁可多一条提示，也不要静默掉真正的运行期错误。
 */
const INIT_EVENTS = new Set(["load", "register_provider", "register_virtual_model", "register_mcp_server"]);

export function shouldToastExtensionError(event: string | undefined): boolean {
  if (!event) return true;
  return !INIT_EVENTS.has(event);
}
