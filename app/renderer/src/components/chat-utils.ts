import type { StreamEntry, TextEntry } from "./StreamPanel";

/** 附件项（图片或文档） */
export interface AttachItem {
  name: string;
  path: string;
  dataUrl?: string;
  kind: "image" | "doc";
}

export interface ChatMessage {
  id: number;
  role: "user" | "ai";
  text?: string;
  attaches?: AttachItem[];
  entries?: StreamEntry[];
  timestamp: number;
  /** 系统消息类型(customType: system_message)——按 details.kind 分支渲染 */
  customType?: string;
  details?: Record<string, unknown>;
  /** Pi 落盘时间戳(系统消息去重用:多 ChatPanel 实例重复 append 时幂等) */
  sysTs?: number;
  /** Pi 落盘时间戳——实时渲染按此有序插入,保证 UI 顺序 = jsonl 落盘顺序(广播顺序 ≠ 落盘顺序) */
  piTs?: number;
  /** 流式标记:实时渲染临时消息(重载/加载磁盘时被替代或合并) */
  streaming?: boolean;
  /** 群聊消息的 Agent 角色(群聊视图标注来源;无 = 普通会话) */
  agentRole?: string;
  /** 群聊转发消息标记(该回合由其他 Agent 转发触发,显示来源标签) */
  forwarded?: boolean;
  /** 群聊转发来源 Agent 角色(转发标记下显示 [A → B]) */
  forwardedFrom?: string;
}

/** Pi 事件中的 blocks → StreamEntry 格式（兼容现有渲染） */
export function piBlocksToEntries(blocks: Array<{ type: string; text?: string; name?: string; id?: string; input?: Record<string, unknown>; content?: unknown; thinking?: string }>): StreamEntry[] {
  const ts = Date.now();
  const result: StreamEntry[] = [];
  for (const b of blocks) {
    if (b.type === "text" && b.text) {
      result.push({ kind: "text", text: b.text, timestamp: ts });
    } else if (b.type === "thinking" && (b.thinking || b.text)) {
      result.push({ kind: "thinking", text: (b.thinking || b.text)!, timestamp: ts });
    } else if (b.type === "tool_use") {
      result.push({ kind: "tool_use", id: b.id || "", name: b.name || "?", input: b.input || {}, timestamp: ts, collapsed: false, source: "chat" });
    } else if (b.type === "tool_result") {
      result.push({ kind: "tool_result", toolUseId: b.id || "", content: String(b.content ?? ""), isError: false, timestamp: ts, source: "chat" });
    }
  }
  return result;
}

/** 合并连续 text entry（Pi 偶发拆成多 block） */
export function mergeConsecutiveText(entries: StreamEntry[]): StreamEntry[] {
  const result: StreamEntry[] = [];
  for (const e of entries) {
    if (e.kind === "text" && result.length > 0 && result[result.length - 1]!.kind === "text") {
      const last = result[result.length - 1] as TextEntry;
      last.text = (last.text || "") + (e.text || "");
    } else {
      result.push({ ...e });
    }
  }
  return result;
}

/** PiChatEvent → StreamEntry[] */
export function piEventToEntries(ev: { type: string; blocks?: Array<{ type: string; text?: string; name?: string; id?: string; input?: Record<string, unknown> }> }): StreamEntry[] {
  if (ev.type === "message" && Array.isArray(ev.blocks)) {
    return piBlocksToEntries(ev.blocks);
  }
  return [];
}

/** 工具名 → 中文标签 */
export function displayToolLabel(name: string, args?: Record<string, unknown>): string {
  const n = name.toLowerCase();
  const ctx = (args?.file_path || args?.path || args?.filePath || args?.query || args?.pattern || args?.target_file) as string | undefined;
  const fname = (ctx && typeof ctx === "string") ? ctx.split("/").pop() || "" : "";
  const ext = fname.split(".").pop()?.toLowerCase() || "";

  // Skill / MCP 特殊处理
  const skillInInput = args?.skill as string | undefined;
  if (skillInInput) return `调用 Skill: ${skillInInput}`;
  if (n.startsWith("skill__")) return `调用 Skill: ${name.slice(7)}`;
  if (n.startsWith("mcp__")) return `调用 MCP: ${name.split("__")[1] || "工具"}`;

  if (n === "read" || n === "glob") {
    const isConfig = /json|toml|yaml|yml|env|ini|config|cfg|rc$/i.test(ext) || /package\.json|tsconfig|eslint|prettier/i.test(fname);
    const isDoc = /md|markdown|rst|txt|readme/i.test(ext) || /README|CLAUDE|CHANGELOG|LICENSE/i.test(fname);
    const isSource = /tsx?|jsx?|py|rs|go|java|c|h|cpp|swift|kt|rb|php|vue|svelte|css|scss|html$/i.test(ext);
    const isTest = /test|spec|__test__/i.test(fname);
    if (isConfig) return fname ? `加载配置: ${fname}` : "读取项目配置";
    if (isTest) return fname ? `查看测试: ${fname}` : "查看测试文件";
    if (isDoc) return fname ? `阅读文档: ${fname}` : "查阅文档";
    if (isSource) return fname ? `检查代码: ${fname}` : "分析源代码";
    if (n === "glob") return fname ? `搜索文件: ${fname}` : "查找文件";
    return fname ? `读取: ${fname}` : "读取文件";
  }

  if (n === "write") {
    if (ext === "json" || /package\.json|tsconfig/i.test(fname)) return fname ? `更新配置: ${fname}` : "写入配置文件";
    if (ext === "md" || /README|CLAUDE|CHANGELOG/i.test(fname)) return fname ? `撰写文档: ${fname}` : "输出文档";
    if (/tsx?|jsx?|py|rs|go|css/.test(ext)) return fname ? `编写代码: ${fname}` : "创建源文件";
    return fname ? `写入: ${fname}` : "写入文件";
  }

  if (n === "edit") return fname ? `修改: ${fname}` : "编辑文件";

  if (n === "grep") return ctx ? "搜索内容" : "查找代码";

  if (n === "bash") {
    const cmd = (args?.command as string) || "";
    const short = cmd.length > 40 ? cmd.slice(0, 40) + "…" : cmd;
    return short ? `执行: ${short}` : "执行命令";
  }

  if (n === "task") {
    const agent = args?.subagent_type as string | undefined;
    if (agent === "builder") return "委托 Builder 编码";
    if (agent === "evaluator") return "委托 Evaluator 验收";
    return agent ? `调度 Agent: ${agent}` : "调度 Agent";
  }

  if (n === "webfetch") {
    const url = ctx || "";
    const domain = url ? (() => { try { return new URL(url).hostname; } catch { return url.slice(0, 40); } })() : "";
    return domain ? `获取网页: ${domain}` : "抓取网页内容";
  }

  if (n === "websearch") {
    const query = (args?.query as string) || ctx || "";
    return query ? `搜索: ${query.slice(0, 30)}` : "联网搜索";
  }

  return name;
}

/** 解析消息文本中的附件标记 [Image #1: path] / [File #1: path] */
export function parseAttachMarkers(text: string): { attaches: AttachItem[]; cleanText: string } {
  const attaches: AttachItem[] = [];
  const re = /\[(Image|File)\s+#(\d+):\s*([^\]]+)\]/g;
  let clean = text;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const kind = m[1] === "Image" ? "image" : "doc";
    const p = m[3]!;
    attaches.push({ kind, name: p.split("/").pop() || p, path: p, dataUrl: kind === "image" ? "" : undefined });
    clean = clean.replace(m[0], "");
  }
  return { attaches, cleanText: clean.trim() };
}

/** 历史会话消息（conv.messages）→ ChatMessage[] */
export function mapSessionMessages(msgs: Array<{ type: string; message: unknown }>): ChatMessage[] {
  let nextId = 0;
  const mapped: ChatMessage[] = [];
  for (const m of msgs) {
    // 磁盘消息对象时间字段是 timestamp(毫秒),无 created_at(磁盘实证)
    const ts = (m.message as { timestamp?: number })?.timestamp ?? Date.now();
    if (m.type === "user") {
      const content = (m.message as { content?: string | unknown[] })?.content;
      const text = typeof content === "string" ? content : Array.isArray(content)
        ? content.map((b: unknown) => (b as { text?: string })?.text ?? "").join("")
        : "";
      if (text) {
        const { attaches, cleanText } = parseAttachMarkers(text);
        const msgObj = m.message as { customType?: string; details?: Record<string, unknown> };
        mapped.push({
          id: ++nextId, role: "user", text: cleanText,
          attaches: attaches.length > 0 ? attaches : undefined, timestamp: ts,
          // 系统消息结构身份(custom_message 条目):前端按 customType/kind 渲染
          customType: msgObj.customType, details: msgObj.details,
        });
      }
    } else if (m.type === "assistant") {
      const content = (m.message as { content?: unknown[] })?.content;
      if (Array.isArray(content)) {
        const entries: StreamEntry[] = [];
        for (const block of content) {
          const b = block as { type?: string; text?: string; thinking?: string; name?: string; input?: unknown; tool_use_id?: string; content?: unknown; is_error?: boolean };
          if (b.type === "text" && b.text) {
            entries.push({ kind: "text", text: b.text, timestamp: ts });
          } else if (b.type === "thinking" && b.thinking) {
            entries.push({ kind: "thinking", text: b.thinking, timestamp: ts });
          } else if (b.type === "tool_use" || b.type === "toolCall") {
            // 磁盘消息的 tool 块是 Pi 原生格式 toolCall（字段 arguments）；
            // 流式路径经 event-bridge 转成 tool_use（字段 input）——两种都兼容
            const args = b.input ?? (b as { arguments?: unknown }).arguments;
            entries.push({ kind: "tool_use", id: (b as { id?: string }).id || "", name: b.name || "?", input: args || {}, timestamp: ts, collapsed: false, source: "chat" });
          } else if (b.type === "tool_result") {
            entries.push({ kind: "tool_result", toolUseId: b.tool_use_id || "", content: String(b.content ?? ""), isError: !!b.is_error, timestamp: ts, source: "chat" });
          }
        }
        if (entries.length === 0) continue;
        // 相邻 AI 消息合并到同一条（Pi 落盘的消息逐条独立，此处仅用于磁盘→UI 映射）
        const last = mapped[mapped.length - 1];
        if (last && last.role === "ai") {
          last.entries!.push(...entries);
        } else {
          mapped.push({ id: ++nextId, role: "ai", entries, timestamp: ts });
        }
      }
    }
  }
  return mapped;
}

/** 消息可复制全文：user 取 text，ai 取全部 text entries 合并 */
export function getMsgCopyText(msg: ChatMessage): string {
  if (msg.role === "user") return msg.text || "";
  if (!msg.entries) return "";
  return msg.entries.filter((e) => e.kind === "text").map((e) => e.text).join("\n");
}
