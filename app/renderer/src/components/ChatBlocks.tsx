import { useState, useMemo, useEffect, useRef, useCallback, memo } from "react";
import type { StreamEntry } from "./StreamPanel";
import { inferLang, tokenizeLines } from "../lib/diff-highlight";
import { MARKDOWN_PROSE_CLASS, renderMarkdownToHtml } from "../lib/markdown";
import { useTabStore } from "../stores/tab-store";
import { useViewerStore } from "../stores/viewer-store";
import { isImagePath } from "@shared/image-files";

/** 从文件路径取文件名(tab 标题/标题行显示用) */
function baseName(p: string): string {
  const seg = p.split(/[\\/]/).pop();
  return seg || p;
}

// ── 工具标题元数据:中文动作词 + Lucide 图标(按工具名归类) ──────────────
// 基础工具:bash→命令/终端, edit→编辑/方笔, read→查看/眼, write→编写/笔
// 自定义工具按类别配图标:agent=bot, 知识技能=wrench, MCP=plug, 项目=folder-kanban,
// issue=bug, 网络=globe, 待办=list-clock, ask=message-question, 图片=scan-search
const TOOL_LABELS: Record<string, string> = {
  bash: "命令", edit: "编辑", read: "查看", write: "编写", grep: "搜索文件",
  find: "查找文件", ls: "列出目录", powershell: "PowerShell",
  task: "派遣 Agent", create_agent_template: "创建模板", list_agents: "查看 Agent",
  read_agent_log: "读取日志", stop_agent: "停止 Agent",
  use_skill: "加载技能", manage_skill: "管理技能", learn: "沉淀经验",
  search_experiences: "搜索经验", retire_experiences: "退役经验", import_skill: "导入", import_mcp_server: "导入",
  show_confirm_dev: "确认开发", show_new_project: "新建项目", refresh_tasks: "刷新任务",
  set_task_status: "更新任务", rename_project: "重命名项目", show_prototype: "预览原型",
  list_issues: "查看 Issue", set_issue_status: "更新 Issue",
  web_fetch: "抓取网页", web_search: "搜索网页",
  todo_write: "更新步骤", todo_user: "用户待办",
  ask_user: "提问", describe_image: "查看图片",
};

/** 工具图标:按 name 归类的 Lucide SVG path(不含外层 svg——ToolIcon 统一包) */
function toolIconPaths(name: string): JSX.Element | null {
  let n = name.toLowerCase();
  if (n.startsWith("mcp__")) n = "mcp"; // MCP 工具统一扳手
  switch (n) {
    // 光标那笔带 icon-cursor 类：供终端类胶囊做光标闪烁，样式按祖先作用域限定（如 .shell-pill-icon），
    // 其他地方用到同一图标不受影响
    case "bash": case "powershell": return (<><path d="m7 11 2-2-2-2"/><path className="icon-cursor" d="M11 13h4"/><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/></>);
    case "edit": return (<><path d="M12.659 22H18a2 2 0 0 0 2-2V8a2.4 2.4 0 0 0-.706-1.706l-3.588-3.588A2.4 2.4 0 0 0 14 2H6a2 2 0 0 0-2 2v9.34"/><path d="M14 2v5a1 1 0 0 0 1 1h5"/><path d="M10.378 12.622a1 1 0 0 1 3 3.003L8.36 20.637a2 2 0 0 1-.854.506l-2.867.837a.5.5 0 0 1-.62-.62l.836-2.869a2 2 0 0 1 .506-.853z"/></>);
    case "read": return (<><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/></>);
    case "write": return (<><path d="M13 21h8"/><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/></>);
    // 搜索文件(file-search-corner)
    case "grep": return (<><path d="M11.1 22H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.706.706l3.589 3.588A2.4 2.4 0 0 1 20 8v3.25"/><path d="M14 2v5a1 1 0 0 0 1 1h5"/><path d="m21 22-2.88-2.88"/><circle cx="16" cy="17" r="3"/></>);
    // 目录类(find 展开态 / ls 收起态)——路径数据与 FileTreePanel 的 folder-open / folder 同源(Lucide)
    case "find": return (<path d="m6 14 1.5-2.9A2 2 0 019.24 10H20a2 2 0 011.94 2.5l-1.54 6a2 2 0 01-1.95 1.5H4a2 2 0 01-2-2V7c0-1.1.9-2 2-2h2"/>);
    case "ls": return (<path d="M20 20a2 2 0 002-2V8a2 2 0 00-2-2h-7.9a2 2 0 01-1.69-.9L9.6 3.9A2 2 0 007.93 3H4a2 2 0 00-2 2v13a2 2 0 002 2z"/>);
    // agent 类(bot)
    case "task": case "create_agent_template": case "list_agents": case "read_agent_log": case "stop_agent":
      return (<><path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/></>);
    // 知识/技能(wrench)
    case "use_skill": case "manage_skill": case "learn": case "search_experiences":
    case "import_skill": case "import_mcp_server":
      return (<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.106-3.105c.32-.322.863-.22.983.218a6 6 0 0 1-8.259 7.057l-7.91 7.91a1 1 0 0 1-2.999-3l7.91-7.91a6 6 0 0 1 7.057-8.259c.438.12.54.662.219.984z"/>);
    // MCP 工具调用(plug 插头)
    case "mcp":
      return (<><path d="M12 22v-5"/><path d="M15 8V2"/><path d="M17 8a1 1 0 0 1 1 1v4a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1z"/><path d="M9 8V2"/></>);
    // 项目类(folder-kanban)
    case "show_confirm_dev": case "show_new_project": case "refresh_tasks": case "set_task_status":
    case "rename_project": case "show_prototype":
      return (<><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/><path d="M8 10v4"/><path d="M12 10v2"/><path d="M16 10v6"/></>);
    // issue(bug)
    case "list_issues": case "set_issue_status":
      return (<><path d="M12 20v-9"/><path d="M14 7a4 4 0 0 1 4 4v3a6 6 0 0 1-12 0v-3a4 4 0 0 1 4-4z"/><path d="M14.12 3.88 16 2"/><path d="M21 21a4 4 0 0 0-3.81-4"/><path d="M21 5a4 4 0 0 1-3.55 3.97"/><path d="M22 13h-4"/><path d="M3 21a4 4 0 0 1 3.81-4"/><path d="M3 5a4 4 0 0 0 3.55 3.97"/><path d="M6 13H2"/><path d="m8 2 1.88 1.88"/><path d="M9 7.13V6a3 3 0 1 1 6 0v1.13"/></>);
    // 网络搜索(magnifier)
    case "web_fetch": case "web_search":
      return (<><path d="m21 21-4.34-4.34"/><circle cx="11" cy="11" r="8"/></>);
    // 待办(list-clock)
    case "todo_write": case "todo_user":
      return (<><path d="M16 13v2.2l1.6 1"/><path d="M3 12h3.458"/><path d="M3 19h3.832"/><path d="M3 5h18"/><circle cx="16" cy="15" r="6"/></>);
    // ask(message-circle-question-mark)
    case "ask_user":
      return (<><path d="M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/></>);
    // 图片(photo-ai)
    case "describe_image":
      return (<><path d="M15 8h.01"/><path d="M10 21h-4a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v5"/><path d="M3 16l5-5c.928-.893 2.072-.893 3 0l1 1"/><path d="M14 21v-4a2 2 0 1 1 4 0v4"/><path d="M14 19h4"/><path d="M21 15v6"/></>);
    default: return null;
  }
}

// ── Block types ──────────────────────────────────────

interface TextBlock {
  kind: "text";
  text: string;
  keyPrefix?: string;
}

interface ThinkingBlock {
  kind: "thinking";
  text: string;
}

interface ToolItem {
  name: string;
  input: unknown;
  id?: string;
  /** 工具执行结果(由 tool_result 事件按 toolUseId 关联;edit 的返回含 diff) */
  result?: string;
  /** 结果是否错误(tool_result 的 is_error) */
  resultError?: boolean;
  /** 执行中标记:本批 entries 内尚无匹配 tool_result(与 streaming 结合显示转圈;回合结束的残留不转) */
  pending?: boolean;
  /** bash 执行中的累积输出(tool_progress 增量拼接;结束后保留,展开区显示) */
  liveOutput?: string;
}

interface ToolGroupBlock {
  kind: "tool-group";
  items: ToolItem[];
}

interface SystemBlock {
  kind: "system";
  message: string;
}

/** 工具结果独立块(工具调用被隐藏/未显示时的结果,如 edit diff) */
interface ToolResultOnlyBlock {
  kind: "tool-result-only";
  content: string;
  isError?: boolean;
  /** 工具名(edit → "编辑" 标签,其他 → 工具名) */
  name?: string;
  /** 关联工具调用的文件路径(语言推断用) */
  filePath?: string;
  /** 关联工具调用的 input(工具调用被过滤时,取 path/command 做精简显示) */
  input?: Record<string, unknown>;
}

type Block = TextBlock | ThinkingBlock | ToolGroupBlock | SystemBlock | ToolResultOnlyBlock;

// ── buildBlocks: merge consecutive events of the same type ──

export function buildBlocks(
  entries: StreamEntry[],
  keyPrefix = "",
  toolInputs?: Map<string, Record<string, unknown>>,
): Block[] {
  const blocks: Block[] = [];
  let textBuf = "";
  let thinkBuf = "";
  let toolBuf: ToolItem[] = [];
  let sysBuf = "";
  // 预扫描:本批 entries 中已到达的 tool_result id 集合——tool_use 的 result 可能因文本分隔
  // 被拆到独立 tool-result-only 块(组内关联不到),但执行已完成,不得显示转圈
  const resultIds = new Set<string>();
  for (const e of entries) {
    if (e.kind === "tool_result" && e.toolUseId) resultIds.add(e.toolUseId);
  }

  const flushText = () => { if (textBuf) { blocks.push({ kind: "text", text: textBuf.trim(), keyPrefix }); textBuf = ""; } };
  const flushThink = () => { if (thinkBuf) { blocks.push({ kind: "thinking", text: thinkBuf.trim() }); thinkBuf = ""; } };
  const flushTool = () => { if (toolBuf.length) { blocks.push({ kind: "tool-group", items: [...toolBuf] }); toolBuf = []; } };
  const flushSys = () => { if (sysBuf) { blocks.push({ kind: "system", message: sysBuf.trim() }); sysBuf = ""; } };

  for (const e of entries) {
    if (e.kind === "text") { flushThink(); flushTool(); flushSys(); textBuf += (textBuf ? "\n" : "") + e.text; }
    else if (e.kind === "thinking") { flushText(); flushTool(); flushSys(); thinkBuf += (thinkBuf ? "\n" : "") + e.text; }
    else if (e.kind === "system") { flushText(); flushThink(); flushTool(); sysBuf += (sysBuf ? "\n" : "") + e.message; }
    else if (e.kind === "tool_use") { flushText(); flushThink(); flushSys(); toolBuf.push({ name: e.name, input: e.input, id: e.id, pending: !(e.id && resultIds.has(e.id)) }); }
    else if (e.kind === "tool_result") {
      // 按 toolUseId 关联结果到对应工具调用块;无匹配(工具调用被过滤/未显示)时单独渲染
      const target = [...toolBuf].reverse().find((t) => t.id === e.toolUseId);
      if (target) {
        target.result = e.content;
        target.resultError = e.isError;
      } else {
        flushText(); flushThink(); flushTool();
        // 工具调用被过滤:从完整 input 查找表取 file_path(语言推断)
        const inp = toolInputs?.get(e.toolUseId);
        const fp = inp ? (inp.file_path ?? inp.path) : undefined;
        blocks.push({
          kind: "tool-result-only",
          content: e.content,
          isError: e.isError,
          name: e.name,
          filePath: typeof fp === "string" ? fp : undefined,
          input: inp,
        });
      }
    }
    else if (e.kind === "tool_output") {
      // 命令执行中的累积输出:关联到同组工具项。不 flush——输出到达不应打断工具分组
      const target = [...toolBuf].reverse().find((t) => t.id === e.toolUseId);
      if (target) target.liveOutput = e.text;
    }
    else if (e.kind === "error") { flushText(); flushThink(); flushTool(); blocks.push({ kind: "system", message: e.data }); }
    else if (e.kind === "exit") { flushAll(); /* suppress — user doesn't need to see process exit code */ }
    else { flushAll(); }
  }
  flushAll();

  function flushAll() { flushText(); flushThink(); flushTool(); flushSys(); }

  return blocks;
}

// ── Tool family grouping ─────────────────────────────

function toolFamily(name: string): string {
  if (/^(Edit|Write|Read)$/i.test(name)) return "file";
  if (/^Bash$/i.test(name)) return "bash";
  if (/^(Glob|Grep)$/i.test(name)) return "search";
  if (/^(WebSearch|WebFetch)$/i.test(name)) return "web";
  return "other";
}

const FAMILY_LABELS: Record<string, string> = { file: "文件操作", bash: "命令执行", search: "搜索", web: "网络", other: "工具" };

/** 代码块语言 → 准确显示名;不在表内/无法准确识别 → TEXT */
const LANG_LABELS: Record<string, string> = {
  js: "JavaScript", javascript: "JavaScript", jsx: "JSX",
  ts: "TypeScript", typescript: "TypeScript", tsx: "TSX",
  py: "Python", python: "Python",
  sh: "Shell", shell: "Shell", bash: "Bash", zsh: "Zsh",
  dart: "Dart",
  html: "HTML", htm: "HTML", css: "CSS", scss: "SCSS", sass: "Sass", less: "Less",
  json: "JSON", yaml: "YAML", yml: "YAML", toml: "TOML", xml: "XML", ini: "INI",
  c: "C", cpp: "C++", "c++": "C++", "c#": "C#", cs: "C#", "objective-c": "Objective-C",
  go: "Go", golang: "Go",
  java: "Java",
  kotlin: "Kotlin", kt: "Kotlin",
  swift: "Swift",
  rust: "Rust", rs: "Rust",
  ruby: "Ruby", rb: "Ruby",
  php: "PHP",
  sql: "SQL",
  markdown: "Markdown", md: "Markdown",
  vue: "Vue", svelte: "Svelte",
  dockerfile: "Dockerfile", makefile: "Makefile",
  plaintext: "Plain Text", text: "Text",
};

// ── Block rendering ──────────────────────────────────

// 3.7 流式性能:文本块渲染拆成「静态段」与「流式段」。
//  - 静态段(完整内容/非尾块):parse 结果按 content 缓存,重渲染同内容不重跑 marked/DOMPurify
//  - 流式尾块:rAF 帧合并 + 已渲染前缀冻结,每帧只 parse 新增的开放尾部(不再每帧全文重 parse)
//    完成态输出与静态全文 parse 一致(冻结边界=段落边界/闭合围栏,不切断跨段 markdown 结构)

/** markdown 单段 HTML 渲染(parse 按 content 字符串缓存);管线与编辑器预览共用(见 lib/markdown) */
const MarkdownHtml = memo(function MarkdownHtml({ content }: { content: string }): JSX.Element {
  const html = useMemo(() => renderMarkdownToHtml(content), [content]);
  // 对象必须 memo：React 判定 dangerouslySetInnerHTML 变没变比的是对象身份，不是 __html 字符串
  // （react-dom 的 props diff 用 !== 比对象），字面量每次渲染都是新对象 → 每次都重写 innerHTML
  // → 内部 DOM 整体重建。内容没变时重建纯属浪费，还会打断内部状态（选中、动画、图片加载结果）。
  const inner = useMemo(() => ({ __html: html }), [html]);
  return <div dangerouslySetInnerHTML={inner} />;
});

type MdRawPart = { type: "html" | "code"; content: string; lang?: string };

/** 代码块(memo:同内容重渲染不重建——流式中已完成代码块不再变化) */
const CodeBlock = memo(function CodeBlock({ language, children }: { language?: string; children: string }): JSX.Element {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(children).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  };
  return (
    <div className="not-prose mt-1.5 mb-1 rounded-[var(--radius-lg)] border border-border overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1 border-b border-border" style={{ background: 'var(--color-code-block-header)' }}>
        <span className="text-text-muted tracking-wider" style={{ fontSize: "var(--text-caption)" }}>{language || "TEXT"}</span>
        <button onClick={handleCopy} className="text-text-secondary hover:text-text-primary transition-colors" style={{ fontSize: "var(--text-caption)" }}>
          {copied ? "已复制" : "复制"}
        </button>
      </div>
      <pre className="m-0 px-3 py-2 overflow-x-auto x-thin-scroll leading-relaxed font-mono text-text-primary whitespace-pre" style={{ background: 'var(--color-code-block-bg)', fontSize: "var(--text-detail)" }}>
        <code>{children}</code>
      </pre>
    </div>
  );
});

/** 围栏代码提取 + 分段(原 TextBlockView html useMemo 逻辑抽出,静态/流式共用)。
 *  流式下未闭合围栏(```lang\n 已出现但无闭合)提前按代码块渲染——
 *  避免闭合瞬间整段跳变(用户感知的"闪一下") */
function splitMarkdownParts(text: string, streaming: boolean): MdRawPart[] {
  const parts: MdRawPart[] = [];
  const codeRegex = /```([\w+#-]*)\n([\s\S]*?)```/g;
  let lastIdx = 0;
  let match: RegExpExecArray | null;
  while ((match = codeRegex.exec(text)) !== null) {
    if (match.index > lastIdx) parts.push({ type: "html", content: text.slice(lastIdx, match.index) });
    // 语言:映射表能准确识别 → 标准名称;未知/无法识别 → TEXT;代码块内容 trim 首尾换行(避免 pre 顶部/底部空行空隙)
    parts.push({
      type: "code",
      lang: match[1] ? (LANG_LABELS[match[1]] || "TEXT") : "TEXT",
      content: match[2]!.replace(/^\n+/, "").replace(/\n+$/, ""),
    });
    lastIdx = match.index + match[0].length;
  }
  if (streaming && lastIdx < text.length) {
    const tail = text.slice(lastIdx);
    const openAt = tail.indexOf("```");
    if (openAt !== -1) {
      const open = tail.slice(openAt).match(/^```([\w+#-]*)\n([\s\S]*)$/);
      if (open) {
        if (openAt > 0) parts.push({ type: "html", content: tail.slice(0, openAt) });
        parts.push({
          type: "code",
          lang: open[1] ? (LANG_LABELS[open[1]] || "TEXT") : "TEXT",
          content: open[2]!.replace(/^\n+/, ""),
        });
        return parts;
      }
    }
  }
  if (lastIdx < text.length) parts.push({ type: "html", content: text.slice(lastIdx) });
  return parts;
}

/** 单段渲染成元素(key 由调用方保证稳定唯一) */
function renderMdPart(p: MdRawPart, key: string): JSX.Element {
  return p.type === "code"
    ? <CodeBlock key={key} language={p.lang}>{p.content}</CodeBlock>
    : <MarkdownHtml key={key} content={p.content} />;
}

/** 在 [from, text.length) 里找最靠后的「可安全冻结」前缀终点。
 *  安全 = 段落边界(空行后)且未切断未闭合围栏;两侧同属一个列表(松列表可跨空行
 *  延续,空行后跟列表项/缩进续行会合并进前一块)时不冻结——只有已确定的块才固化。
 *  返回 from 表示尚无已稳定前缀(整个尾部仍是开放内容)。 */
function findStableEnd(text: string, from: number): number {
  const len = text.length;
  let end = from;
  let inFence = false;
  // 自上一个冻结边界以来当前块是否为列表(列表跨空行继续时边界必须后延)
  let curList = false;
  let candidate = -1; // 最近空行后下一个内容行的起点(=冻结候选)
  let pos = from;
  while (pos < len) {
    const nl = text.indexOf("\n", pos);
    if (nl === -1) break; // 末行尚无换行(内容未完):不分类/不置冻结,等它写完再定
    const raw = text.slice(pos, nl);
    const isBlank = raw.trim() === "";
    if (isBlank) {
      if (!inFence) candidate = nl + 1;
    } else {
      const isMarker = /^\s{0,3}(?:[-+*]|\d{1,9}[.)])\s/.test(raw);
      const indented = /^\s{2,}/.test(raw);
      if (candidate >= 0 && !inFence) {
        // 空行前的块已完结;若它是列表且新块以列表项/缩进续行开头 → 同属一个松列表,暂不冻结
        const merges = curList && (isMarker || indented);
        if (!merges) { end = Math.max(end, candidate); curList = false; }
        candidate = -1;
      }
      if (!inFence && /^\s*```/.test(raw)) { inFence = true; candidate = -1; }
      else if (inFence && raw.includes("```")) inFence = false;
      // 块级列表跟踪:列表标记行使本块成为列表;普通非缩进行结束列表
      if (isMarker) curList = true;
      else if (!indented) curList = false;
    }
    pos = nl + 1;
  }
  // 尾随空行:末段已结束可冻结——但末块若是列表(可能继续)则留作开放尾部,等下个非列表块
  if (candidate >= 0 && !inFence && !curList) end = Math.max(end, candidate);
  return end;
}

/** 流式增量构建:冻结已稳定前缀(只 parse 一次),开放尾部每帧重 parse。
 *  cache 持有 frozen 元素(跨帧复用),disp 为当前展示内容。 */
interface StreamCache { covered: number; coveredText: string; els: JSX.Element[]; }
interface StreamDisp { text: string; els: JSX.Element[]; }

function buildStreamDisp(text: string, cache: StreamCache | null, prefix: string): { disp: StreamDisp; cache: StreamCache } {
  // 内容帧快照原则上只增(累计全文);若回退/改写(非纯追加)→ 前缀缓存失效,整体重建
  const reset = !cache || !text.startsWith(cache.coveredText);
  const covered0 = reset ? 0 : cache.covered;
  const end = findStableEnd(text, covered0);
  const els = reset ? [] : [...cache.els];
  if (end > covered0) {
    // 冻结区段:边界在段落/闭合围栏之后,按静态规则分段并固化为元素(此后不再变化)
    const parts = splitMarkdownParts(text.slice(covered0, end), false);
    for (const p of parts) els.push(renderMdPart(p, `${prefix}-f${els.length}`));
  }
  const covered = Math.max(covered0, end);
  // 开放尾部:每帧只 parse 这段(通常 1 个未完段落/未闭合围栏)。
  // 尾部元素**不进 cache**——它每帧都要重建,若随 cache 复用会在下一帧被当成已冻结
  // 内容保留,与新建的尾部叠加,表现为同一句话逐帧累积(逐字重复)。
  const dispEls = [...els];
  const tailParts = splitMarkdownParts(text.slice(covered), true);
  tailParts.forEach((p, idx) => dispEls.push(renderMdPart(p, `${prefix}-t${idx}`)));
  return { disp: { text, els: dispEls }, cache: { covered, coveredText: text.slice(0, covered), els } };
}

/** 流式尾块:rAF 帧合并(高频内容帧只在下一帧提交一次渲染)+ 已渲染前缀冻结 */
function StreamingMarkdown({ text, prefix }: { text: string; prefix: string }): JSX.Element {
  const cacheRef = useRef<StreamCache | null>(null);
  const [disp, setDisp] = useState<StreamDisp>(() => {
    const built = buildStreamDisp(text, null, prefix);
    cacheRef.current = built.cache;
    return built.disp;
  });
  const dispRef = useRef(disp);
  const latestRef = useRef(text);
  latestRef.current = text;
  const rafRef = useRef(0);
  const pendingRef = useRef(false);

  // 内容增长 → 合并到下一帧统一提交(同帧内多次增长只 parse 一次;rAF 延迟 ≤1 帧不可感知)
  useEffect(() => {
    if (pendingRef.current) return;
    if (dispRef.current.text === latestRef.current) return;
    pendingRef.current = true;
    rafRef.current = requestAnimationFrame(() => {
      pendingRef.current = false;
      const target = latestRef.current;
      if (target === dispRef.current.text) return;
      const built = buildStreamDisp(target, cacheRef.current, prefix);
      cacheRef.current = built.cache;
      dispRef.current = built.disp;
      setDisp(built.disp);
    });
  }, [text, prefix]);
  // 卸载清理:虚拟列表行回收/流式结束时取消挂起 rAF(防泄漏/卸载后 setState)
  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  return <>{disp.els}</>;
}

/** 静态文本块:完整 markdown 一次 parse(内容不变时 memo 跳过,不重跑 parse) */
const StaticMarkdown = memo(function StaticMarkdown({ text, prefix }: { text: string; prefix: string }): JSX.Element {
  const parts = useMemo(() => splitMarkdownParts(text, false), [text]);
  return <>{parts.map((p, i) => renderMdPart(p, `${prefix}-${i}`))}</>;
});

export function TextBlockView({ block, streaming }: { block: TextBlock; streaming?: boolean }): JSX.Element {
  const prefix = block.keyPrefix || "md";
  return (
    <div className={MARKDOWN_PROSE_CLASS}>
      {streaming
        ? <StreamingMarkdown text={block.text} prefix={prefix} />
        : <StaticMarkdown text={block.text} prefix={prefix} />}
    </div>
  );
}

function ThinkingBlockView({ block, active }: { block: ThinkingBlock; active?: boolean }): JSX.Element {
  // active = 流式中且本块是消息尾块(思考正在增长):自动展开;思考结束(不再是尾块)自动收起。
  const [open, setOpen] = useState(false);
  // 展开区内容是否渲染:收起动画结束后卸载 body——折叠时思考内容不参与气泡宽度计算
  // (仅 0fr 藏高度时,思考内不可断行长行/URL 仍把气泡撑到展开宽度)
  const [bodyMounted, setBodyMounted] = useState(false);
  // 用户是否手动展开过:手动干预后不再随思考结束自动收起(保留用户意图,想看历史就留着)
  const userCtrlRef = useRef(false);
  const prevActiveRef = useRef(false);
  const boxRef = useRef<HTMLDivElement>(null);
  // 自动贴底跟随:用户滚离底部(dist>8)暂停,回底恢复(对齐 OutputWindow 交互)
  const autoScrollRef = useRef(true);

  // body 挂载与 open 同步:展开立即挂载;收起等 0fr 过渡(200ms)播完再卸载(宽度随动画收窄)。
  // 手动展开需先挂载(0fr)下一帧再置 open——同帧置 1fr 无过渡,展开动画消失(见 toggle)
  useEffect(() => {
    if (open) { setBodyMounted(true); return; }
    const t = setTimeout(() => setBodyMounted(false), 230);
    return () => clearTimeout(t);
  }, [open]);
  // 手动展开的 rAF 延迟(自动展开 active 路径直接 setOpen,不走此)
  const rafRef = useRef<number>(0);
  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  // active true(思考开始/思考中持续):自动展开;标记非用户手动(供结束自动收起判定)
  useEffect(() => {
    if (active) {
      userCtrlRef.current = false;
      autoScrollRef.current = true; // 思考自动展开 → 贴底跟随最新
      setOpen(true);
    }
  }, [active]);

  // active true→false(思考结束,正文/工具开始):用户没手动干预过才自动收起
  useEffect(() => {
    const act = !!active;
    if (!act && prevActiveRef.current && !userCtrlRef.current) setOpen(false);
    prevActiveRef.current = act;
  }, [active]);

  // 内容增长自动贴底;手动展开(查看历史)从顶部看——开头是新思考,底部跟随无意义
  useEffect(() => {
    const el = boxRef.current;
    if (!el || !open) return;
    if (autoScrollRef.current) el.scrollTop = el.scrollHeight;
  }, [block.text, open]);

  const onScroll = (): void => {
    const el = boxRef.current;
    if (!el) return;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    autoScrollRef.current = dist < 8;
  };

  const toggle = (): void => {
    userCtrlRef.current = true;
    if (!open) {
      // 手动展开:先挂载(0fr 隐藏),下一帧置 open 播 0fr→1fr 动画
      setBodyMounted(true);
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => setOpen(true));
      autoScrollRef.current = false; // 手动展开:从顶部看历史
    } else {
      setOpen(false);
    }
  };

  return (
    // 融入气泡式(非独立卡片):无外框——标题行中性灰文字,内容区左竖线 + 比气泡深一档底色
    <div className="mt-1.5 mb-1">
      <button
        onClick={toggle}
        className="inline-flex items-center gap-1.5 py-0.5 text-left rounded-[var(--radius-lg)] transition-colors group"
      >
        {/* 大脑图标(Lucide brain)——思考块标识,与输入卡片思考等级图标统一 */}
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-[var(--color-tool-title)] group-hover:text-text-primary transition-colors">
          <path d="M12 18V5"/>
          <path d="M15 13a4.17 4.17 0 0 1-3-4 4.17 4.17 0 0 1-3 4"/>
          <path d="M17.598 6.5A3 3 0 1 0 12 5a3 3 0 1 0-5.598 1.5"/>
          <path d="M17.997 5.125a4 4 0 0 1 2.526 5.77"/>
          <path d="M18 18a4 4 0 0 0 2-7.464"/>
          <path d="M19.967 17.483A4 4 0 1 1 12 18a4 4 0 1 1-7.967-.517"/>
          <path d="M6 18a4 4 0 0 1-2-7.464"/>
          <path d="M6.003 5.125a4 4 0 0 0-2.526 5.77"/>
        </svg>
        <span
          className="text-[var(--color-tool-title)] group-hover:text-text-primary uppercase tracking-wider font-semibold transition-colors"
          style={{ fontSize: "var(--text-caption)" }}
        >思考</span>
        {/* 思考中指示:active(流式尾块)时转圈——原「…」三点换更明确的活动反馈 */}
        {active && (
          <svg className="animate-spin text-accent" width="12" height="12" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" opacity="0.25" />
            <path d="M14 8a6 6 0 00-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        )}
        {/* 折叠箭头在文字右侧:展开时常显 ▼(向下),折叠态 hover 才出现 >(提示可展开) */}
        <svg viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={`w-2.5 h-2.5 shrink-0 text-[var(--color-tool-title)] group-hover:text-text-primary transition-all duration-150 ${open ? "rotate-90 opacity-100" : "opacity-0 group-hover:opacity-100"}`}>
          <path d="M3.5 2l3 3-3 3"/>
        </svg>
      </button>
      {/* 展开动画:grid-rows 0fr↔1fr 平滑展开/收起。折叠时 body 不渲染(bodyMounted)——
          思考内容不参与气泡宽度计算;收起时 0fr 过渡播放完才卸载,宽度随动画收窄 */}
      {bodyMounted && (
      <div className={`grid transition-[grid-template-rows] duration-200 ease-out ${open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
        <div className="overflow-hidden">
          {/* 展开区:纯色块(无左竖线),底色比气泡深一档;封顶 6 行超出滚动(溢出时外层 1fr 轨匹配内层 maxHeight) */}
          <div
            ref={boxRef}
            onScroll={onScroll}
            className="overflow-y-auto overscroll-contain rounded-[var(--radius-lg)] mt-[5px] mb-[3px]"
            style={{
              background: "var(--thinking-body)",
              maxHeight: "calc(var(--text-detail) * 9.75 + 12px)", // 6 行文字 + pre 上下 padding 12px
            }}
          >
            <pre className="px-3 py-1.5 text-text-secondary font-mono whitespace-pre-wrap leading-[1.625]" style={{ fontSize: "var(--text-detail)" }}>{block.text}</pre>
          </div>
        </div>
      </div>
      )}
    </div>
  );
}

/** 折叠展开区内容挂载控制(通用,供工具块等手动折叠用):
 *  折叠(bodyMounted=false)时内容不渲染——不参与气泡宽度计算(0fr 只藏高度,不可断行长行仍撑宽);
 *  展开:先挂载(0fr 隐藏),下一帧切 open 播 grid-rows 0fr→1fr 动画;
 *  收起:先播 1fr→0fr 动画,结束后卸载 body(宽度随即收回,不遮挡收起过程)。
 *  返回 { bodyMounted, contentReady, toggle }——contentReady=动画态(用于箭头/网格类) */
function useFoldBody(open: boolean, setOpen: (v: boolean) => void): {
  bodyMounted: boolean;
  contentReady: boolean;
  toggle: () => void;
} {
  // 内容是否挂载(渲染于 grid 内;未挂载 = 零宽度贡献)
  // 初值跟随 open:默认展开的块(提问卡)首帧就得有内容——只由 toggle 挂载会让它「展开却空白」
  const [bodyMounted, setBodyMounted] = useState(open);
  // 首帧挂载后动画才就绪:挂载同一帧切 1fr 无过渡(从 0fr 起步才播动画),用 rAF 延迟一帧
  const rafRef = useRef<number>(0);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // toggle:折叠中→先挂载再置 open(播动画);展开中→先收起,过渡完再卸载
  const toggle = useCallback(() => {
    if (hideTimerRef.current) { clearTimeout(hideTimerRef.current); hideTimerRef.current = null; }
    if (!open) {
      // 展开:先挂载(0fr 隐藏) → 下一帧切 1fr 播高度动画
      setBodyMounted(true);
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => setOpen(true));
    } else {
      // 收起:先播 0fr 动画 → 结束后卸载 body(宽度收回)
      setOpen(false);
      hideTimerRef.current = setTimeout(() => setBodyMounted(false), 230); // 200ms 过渡 + 余量
    }
  }, [open, setOpen]);
  // 组件卸载清理:取消挂起的 rAF/卸载 timer(虚拟列表行回收时防泄漏/卸载后 setState)
  useEffect(() => () => {
    cancelAnimationFrame(rafRef.current);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
  }, []);

  return { bodyMounted, contentReady: open, toggle };
}

function ToolGroupView({ block, streaming }: { block: ToolGroupBlock; streaming?: boolean }): JSX.Element {
  const items = block.items;
  // 默认折叠(含 diff 组——用户要求不自动展开,点击才展开)
  const [open, setOpen] = useState(false);
  // 展开区内容挂载控制:折叠时 body 不渲染,宽度不被隐藏内容撑开(见 useFoldBody)
  const fold = useFoldBody(open, setOpen);
  if (items.length === 1) {
    return <SingleToolCard item={items[0]!} streaming={streaming} />;
  }
  // Group by family for summary
  const families = new Map<string, number>();
  for (const item of items) { const f = toolFamily(item.name); families.set(f, (families.get(f) || 0) + 1); }
  const summary = Array.from(families.entries()).map(([f, c]) => `${FAMILY_LABELS[f] || f} ×${c}`).join(", ");

  return (
    // 融入气泡式(非独立卡片):标题行无边框,展开区左竖线 + 深一档底(对齐思考块/单工具卡)
    <div className="mt-1.5 mb-1">
      <div
        role="button"
        tabIndex={0}
        onClick={fold.toggle}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fold.toggle(); } }}
        className="flex w-fit items-center gap-1.5 py-0.5 cursor-pointer select-none group"
      >
        <span className="text-[var(--color-tool-title)] group-hover:text-text-primary transition-colors" style={{ fontSize: "var(--text-caption)" }}>{summary}</span>
        {/* 执行中指示(组内任一项 pending 且本行正在增长):折叠时子卡转圈不可见,标题行给反馈 */}
        {streaming && items.some((i) => i.pending) && (
          <svg className="animate-spin text-accent" width="12" height="12" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" opacity="0.25" />
            <path d="M14 8a6 6 0 00-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        )}
        {/* 折叠箭头在文字右侧(对齐思考块):展开常显 ▼(旋转朝下),折叠态 hover 才出现 > */}
        <svg viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={`w-2.5 h-2.5 shrink-0 text-[var(--color-tool-title)] group-hover:text-text-primary transition-all duration-150 ${open ? "rotate-90 opacity-100" : "opacity-0 group-hover:opacity-100"}`}>
          <path d="M3.5 2l3 3-3 3"/>
        </svg>
      </div>
      {/* 展开动画:grid rows 0fr↔1fr 高度过渡;宽度块级自适应——气泡内其他内容更宽则铺满,
          组内容更宽则撑开气泡;折叠时 body 不渲染(bodyMounted)宽度零贡献 */}
      {fold.bodyMounted && (
      <div className={`grid transition-[grid-template-rows] duration-200 ease-out ${open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
        <div className="overflow-hidden min-w-0">
          {/* 组展开容器:深色块 padding 左右 8px + 上下 1px(用户确认:上下边距主要由工具行自身 mt/mb 贡献,
              容器 padding 只做微调,2px→1px 后视觉仍均匀);折叠时高度 0 背景自然不可见 */}
          <div className="mt-[2px] rounded-[var(--radius-lg)] space-y-0.5" style={{ background: "var(--thinking-body)", padding: "1px 8px" }}>
            {items.map((item, i) => (
              <SingleToolCard key={i} item={item} streaming={streaming} />
            ))}
          </div>
        </div>
      </div>
      )}
    </div>
  );
}

/** diff 行渲染:以 - 开头的行红、+ 开头绿、@@/上下文中性;红绿只做背景+加减号,文字保持语法高亮色(对齐 cc) */
function DiffLine({ line, lang, segments, lineNoWidth }: { line: string; lang?: string; segments?: Array<{ text: string; color?: string }> | null; lineNoWidth?: number }): JSX.Element {
  if (line.startsWith("+")) {
    return (
      <div className="bg-[var(--color-diff-add)] px-2 -mx-2">
        <HighlightedCode code={line.slice(1)} lang={lang} segments={segments} prefix="+" prefixClass="text-success" lineNoWidth={lineNoWidth} />
      </div>
    );
  }
  if (line.startsWith("-")) {
    return (
      <div className="bg-[var(--color-diff-del)] px-2 -mx-2">
        <HighlightedCode code={line.slice(1)} lang={lang} segments={segments} prefix="-" prefixClass="text-danger" lineNoWidth={lineNoWidth} />
      </div>
    );
  }
  if (line.startsWith("@@")) {
    return <div className="text-text-muted px-2 -mx-2">{line}</div>;
  }
  // 上下文行:行号右对齐 + 中性色(不做语言高亮,对齐 cc)
  const ctxM = /^(\s*)(\d+)\s+(.*)$/.exec(line);
  if (ctxM && lineNoWidth) {
    const lineNo = ctxM[2]!.padStart(lineNoWidth);
    return <div className="px-2 -mx-2">{lineNo} <span className="text-text-muted">{ctxM[3]}</span></div>;
  }
  return <div className="px-2 -mx-2">{line}</div>;
}

/**
 * 变更行的 token 级高亮。
 * segments 已由 DiffView 批量 tokenize 传入;未传时(无语言)回退纯文本。
 * Pi 格式行首带行号(可含前导空格,"25 code" 或 " 6 code"),高亮时剥离;行号右对齐显示在加减号前。
 * 显示格式对齐 cc:"行号 + code"(行号灰色,加减号后跟空格)。
 */
function HighlightedCode({ code, lang, segments, prefix, prefixClass, lineNoWidth }: { code: string; lang?: string; segments?: Array<{ text: string; color?: string }> | null; prefix: string; prefixClass?: string; lineNoWidth?: number }): JSX.Element {
  // Pi 行号剥离:形如 "25 code" / " 6 code"(可含前导空格)
  const m = /^\s*(\d+)\s+(.*)$/.exec(code);
  const lineNo = m?.[1] ?? "";
  const bodyCode = m?.[2] ?? code;
  const lineNoPad = lineNoWidth && lineNo ? lineNo.padStart(lineNoWidth) : lineNo;
  const prefixEl = <span className={prefixClass}>{prefix}</span>;
  if (!lang || !segments) return <>{lineNoPad && <span className="text-text-muted">{lineNoPad}</span>} {prefixEl} {bodyCode}</>;
  return (
    <>
      {lineNoPad && <span className="text-text-muted">{lineNoPad}</span>} {prefixEl}{" "}
      {segments.map((s, i) => s.color
        ? <span key={i} style={{ color: s.color }}>{s.text}</span>
        : <span key={i}>{s.text}</span>)}
    </>
  );
}

// ── cc 风格 diff 渲染:标题行 + 变更统计 + hunk(多 hunk 每块 3 行上下文 + 省略号) ──

const DIFF_CONTEXT_LINES = 3;

interface DiffHunk {
  lines: string[];
}

/** 解析 diff 文本为 hunk 列表;Pi 格式的 ... 行保留为内容行(不参与分段);返回 null 表示非标准(回退完整渲染) */
function parseDiff(text: string): DiffHunk[] | null {
  const lines = text.split("\n");
  const hunks: DiffHunk[] = [];
  let current: DiffHunk | null = null;
  for (const line of lines) {
    if (line.startsWith("@@")) {
      if (current) hunks.push(current);
      current = { lines: [line] };
    } else {
      if (!current) current = { lines: [] };
      current.lines.push(line);
    }
  }
  if (current) hunks.push(current);
  // 过滤纯空 hunk(整个 diff 无 @@ 且内容为空)
  return hunks.length > 0 ? hunks : null;
}

/** 统计 hunk 中新增/删除行数 */
function diffStats(hunks: DiffHunk[]): { added: number; removed: number } {
  let added = 0, removed = 0;
  for (const h of hunks) {
    for (const l of h.lines) {
      if (l.startsWith("+") && !l.startsWith("+++")) added++;
      else if (l.startsWith("-") && !l.startsWith("---")) removed++;
    }
  }
  return { added, removed };
}

/** 可见区间:全局最靠前的改动 -3 行 → 最后的改动 +3 行。
 *  区间内全量显示(hunk 之间的未改动行也保留),区间之外才省略——用户要「一段连续区间」,
 *  而非按 hunk 各自裁剪、hunk 之间插 ...。无改动行(纯上下文)返回 null → 全量。 */
function visibleDiffRange(lines: string[]): { from: number; to: number } | null {
  const changed: number[] = [];
  lines.forEach((l, i) => { if (l.startsWith("+") || l.startsWith("-")) changed.push(i); });
  if (changed.length === 0) return null;
  return {
    from: Math.max(0, changed[0]! - DIFF_CONTEXT_LINES),
    to: Math.min(lines.length - 1, changed[changed.length - 1]! + DIFF_CONTEXT_LINES),
  };
}

/** diff 视图(SubagentProcessView 弹层复用):统计可导出,hunk 直接渲染 */
export function DiffView({ text, filePath: fp }: { text: string; filePath?: string }): JSX.Element {
  // 提取 "变更内容:" 后的 diff 体
  const body = text.includes("变更内容:") ? text.split("变更内容:")[1] ?? "" : text;
  const hunks = parseDiff(body);
  // 语言推断:优先用工具 input 的 file_path(可靠),其次从 diff 文本的 ---/+++ 行
  let filePath = fp || "";
  if (!filePath) {
    for (const l of body.split("\n")) {
      if (l.startsWith("+++ b/") || l.startsWith("--- a/")) {
        filePath = l.replace(/^(--- a\/|\+\+\+ b\/)/, "").trim();
        break;
      }
    }
  }
  const lang = filePath ? inferLang(filePath) : undefined;

  // 渲染行 = 一段连续区间(首个改动 -3 → 末个改动 +3),区间内不再按 hunk 断开
  const allLines = hunks ? hunks.flatMap((h) => h.lines) : body.split("\n");
  const range = visibleDiffRange(allLines);
  const visibleLines = range ? allLines.slice(range.from, range.to + 1) : allLines;
  const headOmitted = !!range && range.from > 0;
  const tailOmitted = !!range && range.to < allLines.length - 1;

  // 行号列宽:所有行行号的最大位数,右对齐(对齐 cc gutter)
  const lineNoWidth = visibleLines.reduce((w, l) => {
    if (l.startsWith("+") || l.startsWith("-")) {
      const m = /^[+-]\s*(\d+)/.exec(l);
      if (m?.[1]) w = Math.max(w, m[1].length);
    } else {
      const m = /^\s*(\d+)/.exec(l);
      if (m?.[1]) w = Math.max(w, m[1].length);
    }
    return w;
  }, 0);

  // 批量 tokenize 全部变更行(一次 warmup,消除逐行闪烁);剥离行号(Pi 格式可含前导空格)
  const [segmentsByLine, setSegmentsByLine] = useState<Array<Array<{ text: string; color?: string }> | null> | null>(null);
  const allCodes = visibleLines.map((l) => (l.startsWith("+") || l.startsWith("-") ? l.slice(1).replace(/^\s*\d+\s+/, "") : ""));
  const hasHighlight = !!lang && allCodes.some((c) => c);
  const codesKey = allCodes.join("|");
  useEffect(() => {
    if (!hasHighlight) { setSegmentsByLine(null); return; }
    let cancelled = false;
    tokenizeLines(allCodes, lang!).then((res) => {
      if (!cancelled) setSegmentsByLine(res);
    });
    return () => { cancelled = true; };
  }, [codesKey, lang, hasHighlight]);

  return (
    // 封顶 12 行(行高 1.625)超出滚动;px-2 与 DiffLine 的 -mx-2 抵消,保持原缩进
    <div
      className="font-mono leading-relaxed overflow-y-auto overscroll-contain px-2"
      style={{ fontSize: "var(--text-code)", maxHeight: "calc(var(--text-code) * 19.5)" }}
    >
      {headOmitted && <div className="text-text-muted">...</div>}
      {visibleLines.map((l, idx) => (
        <DiffLine
          key={idx}
          line={l}
          lang={lang}
          segments={segmentsByLine?.[idx]}
          lineNoWidth={lineNoWidth}
        />
      ))}
      {tailOmitted && <div className="text-text-muted">...</div>}
    </div>
  );
}

/** diff 变更统计(add/remove 行数) */
export function diffCount(text: string): { added: number; removed: number } {
  const body = text.includes("变更内容:") ? text.split("变更内容:")[1] ?? "" : text;
  const hunks = parseDiff(body);
  if (!hunks) return { added: 0, removed: 0 };
  return diffStats(hunks);
}

/** 从工具 input 提取文件路径(Pi edit 参数是 path,兼容 file_path) */
function editFilePath(item: ToolItem): string | undefined {
  const input = item.input;
  if (typeof input === "object" && input !== null) {
    const rec = input as Record<string, unknown>;
    const fp = rec.file_path ?? rec.path;
    if (typeof fp === "string") return fp;
  }
  return undefined;
}

/** 技术日志结果截断:超过 maxLines 只显示尾部 keep 行(完整输出见日志)——读文件等长输出是噪音,不铺给用户 */
function truncateResult(text: string, maxLines = 30, keep = 20): string {
  const lines = text.split("\n");
  if (lines.length <= maxLines) return text;
  return lines.slice(-keep).join("\n") + `\n\n[输出过长，仅显示尾部 ${keep} 行。完整输出见日志]`;
}

/** 带行号格式化(等宽对齐):write 内容预览用,参照 cc 的显示方式 */
function numberLines(text: string): string {
  return text.split("\n").map((l, i) => `${String(i + 1).padStart(4)}  ${l}`).join("\n");
}

/** 提取 bash 命令文本(input 可能是纯字符串命令或 { command } 对象) */
function getBashCommand(input: unknown): string | undefined {
  if (typeof input === "string") return input;
  if (input && typeof input === "object") {
    const c = (input as Record<string, unknown>).command;
    if (typeof c === "string") return c;
  }
  return undefined;
}

/** 提取 bash 动作标题(Mint 调用时填的 description)——缺失返回 undefined,标题行不显示 */
function getBashTitle(input: unknown): string | undefined {
  if (input && typeof input === "object") {
    const d = (input as Record<string, unknown>).description;
    if (typeof d === "string" && d.trim()) return d.trim();
  }
  return undefined;
}

/**
 * 工具标题图标(Lucide)——按工具名归类取图标(见 toolIconPaths 映射表)
 */
export function ToolIcon({ name }: { name: string }): JSX.Element | null {
  const paths = toolIconPaths(name);
  if (!paths) return null;
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
      {paths}
    </svg>
  );
}

/** MCP/技能类工具的展开区名称文本(标题行只显类别,具体名进展开区):
 *  - mcp__tavily__search → "tavily / search"(server / tool)
 *  - use_skill → "技能: xxx"；manage_skill → "技能: xxx"(create/update/delete 前缀)
 *  其他工具返回 null(展开区照常显示结果) */
function toolDetailLabel(item: ToolItem): string | null {
  const n = item.name.toLowerCase();
  const inp = (item.input ?? {}) as Record<string, unknown>;
  if (n.startsWith("mcp__")) {
    return item.name.replace(/^mcp__/, "").split("__").filter(Boolean).join(" / ");
  }
  if (n === "use_skill" || n === "import_skill") {
    const name = typeof inp.name === "string" ? inp.name : undefined;
    return name ? `技能：${name}` : "技能";
  }
  if (n === "manage_skill") {
    const action = typeof inp.action === "string" ? inp.action : undefined;
    const name = typeof inp.name === "string" ? inp.name : undefined;
    if (name) return `技能：${name}${action ? `（${action}）` : ""}`;
    if (action) return `技能管理（${action}）`;
    return "技能管理";
  }
  if (n === "learn") {
    const skill = (typeof inp.skill === "object" && inp.skill !== null ? inp.skill : undefined) as Record<string, unknown> | undefined;
    const name = skill && typeof skill.name === "string" ? skill.name : undefined;
    return name ? `沉淀技能：${name}` : null; // 纯 memory 沉淀无技能名,仍显示结果
  }
  return null;
}

function SingleToolCard({ item, streaming }: { item: ToolItem; streaming?: boolean }): JSX.Element {
  const isDiffResult = !!item.result && item.result.includes("变更内容:");
  // 默认折叠(含 diff——用户要求不自动展开,点击才展开);例外:提问卡默认展开(问题内容需要可见)
  const [showInput, setShowInput] = useState(item.name === "ask_user");
  // 展开区内容是否渲染:收起动画结束后卸载 body——折叠时隐藏内容不再撑开气泡宽度(仅高度隐藏时
  // 不可断行长行/diff 仍把宽度撑到展开态);展开时先挂载下一帧再播 grid 动画(见 useFoldBody)
  const fold = useFoldBody(showInput, setShowInput);

  const isPathTool = item.name === "edit" || item.name === "write" || item.name === "read";
  const diffStats_ = isDiffResult ? diffCount(item.result!) : null;
  // bash 命令文本(展开区分段展示用)
  const bashCmd = item.name === "bash" ? getBashCommand(item.input) : undefined;
  // bash 动作标题(标题行展示,由 Mint 调用时填;老会话无此字段则不显示)
  const bashTitle = item.name === "bash" ? getBashTitle(item.input) : undefined;
  // 输出优先用实时累积;增量未到达时回退到工具结果(内容即输出,可带退出码)——
  // 保证任何情况下展开都能看到命令输出,而不是只有命令本身
  const bashOutput = item.liveOutput || (item.name === "bash" ? item.result : undefined);
  // 文件工具 → 绝对路径 + 文件名(标题行只显文件名,链接点击在 tab 打开;悬停 title 提示完整路径)
  const filePath = isPathTool ? editFilePath(item) : undefined;
  // 动作词:查 TOOL_LABELS 映射表(自定义工具各配中文名),MCP 标题只显「MCP」(不带工具二字),skill 类显示动作词
  const label = TOOL_LABELS[item.name.toLowerCase()]
    ?? (item.name.toLowerCase().startsWith("mcp__") ? "MCP" : "工具");
  // MCP/技能类:展开区显示具体名(标题行保持类别;其余工具展开区照常显示结果)
  const detailLabel = toolDetailLabel(item);

  // 打开文件：图片交给内置查看器（Monaco 打开二进制只会显示乱码），其余仍开编辑器 tab
  const openFile = (e: React.MouseEvent): void => {
    e.stopPropagation();
    if (!filePath) return;
    if (isImagePath(filePath)) {
      void useViewerStore.getState().openImageFile(filePath);
      return;
    }
    useTabStore.getState().openTab({ id: "", type: "file", title: baseName(filePath), filePath });
  };

  const contentErr = item.resultError;
  // 展开区有可显示内容:bash 命令来自 input(工具调用即带)——执行阶段/失败都可就展开看命令
  // (命令是输入,失败更需看到它排查;输出本来就不展示);其他工具(diff/write 内容等)内容来自 result,仍等结果到达
  const hasExpandable = item.name === "bash"
    ? (!!bashCmd || !!bashOutput)
    : !!item.result && !contentErr;

  // read(查看)特例:文件内容已在链接中(点击文件名在 tab 打开即可看),结果不再展示、无需展开——
  // 只渲染「查看 + 文件链接」标题行(无折叠箭头/无展开区)
  if (item.name === "read") {
    return (
      <div className="mt-1.5 mb-1 flex items-center gap-1.5 group">
        <span className="shrink-0 flex items-center gap-1.5 min-w-0 text-[var(--color-tool-title)] group-hover:text-text-primary transition-colors">
          <ToolIcon name="read" />
          <span className="whitespace-nowrap" style={{ fontSize: "var(--text-caption)" }}>{TOOL_LABELS.read ?? "查看"}</span>
          {/* 执行状态:转圈(执行中)/ ✓ 成功 / ✗ 报错——与主工具卡一致 */}
          {streaming && item.pending ? (
            <svg className="animate-spin text-accent" width="12" height="12" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" opacity="0.25" />
              <path d="M14 8a6 6 0 00-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          ) : !item.pending && contentErr ? (
            <svg className="shrink-0 text-danger" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
          ) : !item.pending && item.result !== undefined ? (
            <svg className="shrink-0 state-ok" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
          ) : null}
        </span>
        {filePath ? (
          <button
            type="button"
            onClick={openFile}
            title={filePath}
            className="shrink-0 max-w-[260px] truncate font-mono text-[var(--color-link)] hover:underline transition-colors cursor-pointer"
            style={{ fontSize: "var(--text-detail)" }}
          >{baseName(filePath)}</button>
        ) : (
          <span className="text-text-muted font-mono" style={{ fontSize: "var(--text-detail)" }}>(未知文件)</span>
        )}
      </div>
    );
  }

  return (
    // 融入气泡式(非独立卡片):无外框——标题行中性灰,展开区左竖线 + 深一档底(对齐思考块)
    <div className="mt-1.5 mb-1">
      {/* 标题行:点击区收窄到内容(w-fit,对齐思考块——不整行可点);文件名链接为独立按钮(点击开文件,不触发展开) */}
      <div
        role="button"
        tabIndex={0}
        onClick={fold.toggle}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fold.toggle(); } }}
        className="flex w-fit items-center gap-1.5 cursor-pointer select-none group py-0.5"
      >
        {/* 动作词(编辑/查看/编写/命令)——前加对应 Lucide 图标(bash=终端/edit=方笔/read=眼/write=笔) */}
        <span className="shrink-0 flex items-center gap-1.5 min-w-0 text-[var(--color-tool-title)] group-hover:text-text-primary transition-colors">
          <ToolIcon name={item.name} />
          <span className="whitespace-nowrap" style={{ fontSize: "var(--text-caption)" }}>{label}</span>
          {bashTitle && (
            <span className="truncate max-w-[200px] text-text-muted" style={{ fontSize: "var(--text-caption)" }}>· {bashTitle}</span>
          )}
          {/* 执行中指示:tool_use 已到、result 未到且本行正在增长→ 转圈;回合结束的残留(中断无 result)不转 */}
          {streaming && item.pending && (
            <svg className="animate-spin text-accent" width="12" height="12" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" opacity="0.25" />
              <path d="M14 8a6 6 0 00-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          )}
          {/* 执行完状态:成功 ✓ / 报错 ✗——与转圈互斥(pending=false 即完成,立即显示,不等回合结束) */}
          {!item.pending && contentErr ? (
            <svg className="shrink-0 text-danger" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
          ) : !item.pending && item.result !== undefined ? (
            <svg className="shrink-0 state-ok" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
          ) : null}
        </span>
        {/* 文件名链接:独立按钮,点击在 tab 打开文件;不触发展开 toggle */}
        {filePath && (
          <button
            type="button"
            onClick={openFile}
            title={filePath}
            className="shrink-0 max-w-[260px] truncate font-mono text-[var(--color-link)] hover:underline transition-colors cursor-pointer"
            style={{ fontSize: "var(--text-detail)" }}
          >{baseName(filePath)}</button>
        )}
        {/* 变更统计(+N -M)紧跟文件名后——编辑类有 diff;执行成败不展示状态文案。
            收进工具组的行同样显示:统计挂在展开区体内,组默认折叠,只有标题行可见 */}
        {item.result && diffStats_ && (diffStats_.added > 0 || diffStats_.removed > 0) && (
          <span className="shrink-0 normal-case tracking-normal text-text-muted" style={{ fontSize: "var(--text-caption)" }}>
            {diffStats_.added > 0 && <span className="text-success">+{diffStats_.added}</span>}
            {diffStats_.added > 0 && diffStats_.removed > 0 && " • "}
            {diffStats_.removed > 0 && <span className="text-danger">-{diffStats_.removed}</span>}
          </span>
        )}
        {/* 折叠箭头在文字右侧(对齐思考块):展开常显 ▼(旋转朝下),折叠态 hover 才出现 > */}
        <svg viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={`w-2.5 h-2.5 shrink-0 text-[var(--color-tool-title)] group-hover:text-text-primary transition-all duration-150 ${showInput ? "rotate-90 opacity-100" : "opacity-0 group-hover:opacity-100"}`}>
          <path d="M3.5 2l3 3-3 3"/>
        </svg>
      </div>
      {/* 展开动画:grid rows 0fr↔1fr 高度过渡;宽度不设 w-fit/grid-cols——块级自适应:
          气泡内其他内容(文本等)更宽则展开区铺满气泡,展开内容更宽则撑开气泡(max-w 75% 内)。
          折叠时 body 不渲染(bodyMounted)——隐藏内容不再撑开气泡宽度 */}
      {fold.bodyMounted && (
      <div className={`grid transition-[grid-template-rows] duration-200 ease-out ${showInput && hasExpandable ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
        <div className="overflow-hidden min-w-0">
          {hasExpandable && (
            // 展开区:纯色块,底色比气泡深一档;内容随工具类型
            // 失败(contentErr)时不渲染任何正文——标题已标红即失败提示(报错/状态文案都不展示)
            isDiffResult ? (
              <div className="mt-[2px] rounded-[var(--radius-lg)]" style={{ background: "var(--thinking-body)" }}>
                <div className="px-3 py-2"><DiffView text={item.result!} filePath={filePath} /></div>
              </div>
            ) : item.name === "bash" ? (
              <div className="mt-[2px] rounded-[var(--radius-lg)]" style={{ background: "var(--thinking-body)" }}>
                {/* bash:命令在深色容器内,输出裸文本跟在下方;命令+输出整体一个滚动(封顶 6 行,对齐思考块) */}
                <div
                  className="px-2 py-2 overflow-y-auto overscroll-contain"
                  style={{ maxHeight: "calc(var(--text-detail) * 9.75 + 28px)" }}
                >
                  <div className="rounded-[var(--radius-lg)] bg-[var(--color-cmd-box)] px-2 py-1.5">
                    <pre className="text-text-secondary font-mono whitespace-pre-wrap break-all" style={{ fontSize: "var(--text-detail)" }}>{bashCmd ?? ""}</pre>
                  </div>
                  {bashOutput ? (
                    <pre className="mt-1.5 text-text-secondary font-mono whitespace-pre-wrap break-all leading-[1.625]" style={{ fontSize: "var(--text-detail)" }}>{bashOutput}</pre>
                  ) : null}
                </div>
              </div>
            ) : detailLabel ? (
              // MCP/技能类:展开区显示具体工具/技能名(不铺结果——名称即本次调用的对象)
              <div className="mt-[2px] rounded-[var(--radius-lg)]" style={{ background: "var(--thinking-body)" }}>
                <div className="px-3 py-2">
                  <span className="font-mono text-text-secondary" style={{ fontSize: "var(--text-detail)" }}>{detailLabel}</span>
                </div>
              </div>
            ) : (
              <div className="mt-[2px] rounded-[var(--radius-lg)]" style={{ background: "var(--thinking-body)" }}>
                <div className="px-3 py-2">
                  <pre className="text-text-secondary font-mono overflow-x-auto x-thin-scroll whitespace-pre-wrap min-h-[1.625em]" style={{ fontSize: "var(--text-detail)" }}>
                    {truncateResult(item.result!)}
                  </pre>
                </div>
              </div>
            )
          )}
        </div>
      </div>
      )}
    </div>
  );
}

// ── Exported render function ──────────────────────────

export function ChatBlockView({ block, streaming, isStreamingTail }: { block: Block; streaming?: boolean; isStreamingTail?: boolean }): JSX.Element | null {
  switch (block.kind) {
    case "text": return <TextBlockView block={block} streaming={streaming} />;
    case "thinking": return <ThinkingBlockView block={block} active={isStreamingTail} />;
    case "tool-group": return <ToolGroupView block={block} streaming={streaming} />;
    case "system": return null;
    case "tool-result-only": return <ToolResultOnlyView block={block} />;
  }
}

/** 工具结果独立显示(工具调用隐藏时):edit 显示 diff;write 显示内容预览(参照 cc);
 *  read/bash 路径/命令显示在标题行;其他显示结果 */
function ToolResultOnlyView({ block }: { block: ToolResultOnlyBlock }): JSX.Element | null {
  const isDiff = block.content.includes("变更内容:");
  // 标签:工具原名(与工具卡片一致);缺省"工具结果"
  const label = block.name || "工具结果";
  const stats = isDiff ? diffCount(block.content) : null;
  // 精简显示:read/write → 路径;bash → 命令(显示在标题行,不占内容区)
  const inp = block.input;
  // Pi 工具参数兼容 file_path 与 path 两种写法
  const filePath = typeof inp?.path === "string" ? inp.path : typeof inp?.file_path === "string" ? inp.file_path : undefined;
  const summary =
    (block.name === "read" || block.name === "write") && filePath ? filePath
    : block.name === "bash" && typeof inp?.command === "string" ? inp.command
    : undefined;
  // write:从工具调用参数取写入内容渲染带行号预览——新建/整体重写无旧内容可对比,显示内容而非 diff
  const writeContent = block.name === "write" && typeof inp?.content === "string" ? inp.content : undefined;
  const writeLines = writeContent ? writeContent.split("\n").length : 0;
  return (
    <div className={`mt-1.5 mb-1 rounded-[var(--radius-lg)] border overflow-hidden ${block.isError ? "border-danger-border" : "border-border"}`}>
      <div className="flex items-center justify-between gap-2 px-3 py-1.5 bg-surface-alt text-text-muted uppercase tracking-wider font-semibold border-b border-border" style={{ fontSize: "var(--text-caption)" }}>
        <span className="shrink-0">{label}</span>
        {summary && (
          <span className="normal-case tracking-normal font-normal text-text-secondary font-mono truncate">{summary}</span>
        )}
        {writeLines > 0 && (
          <span className="normal-case tracking-normal font-normal shrink-0 text-text-secondary">{writeLines} 行</span>
        )}
        {stats && (stats.added > 0 || stats.removed > 0) && (
          <span className="normal-case tracking-normal font-normal shrink-0">
            {stats.added > 0 && <span className="text-success">+{stats.added}</span>}
            {stats.added > 0 && stats.removed > 0 && " • "}
            {stats.removed > 0 && <span className="text-danger">-{stats.removed}</span>}
          </span>
        )}
      </div>
      {isDiff && (
        <div className="bg-surface px-3 py-2">
          <DiffView text={block.content} filePath={block.filePath} />
        </div>
      )}
      {writeContent !== undefined && (
        <div className="bg-surface px-3 py-2 overflow-x-auto x-thin-scroll">
          <pre className="text-text-secondary font-mono leading-relaxed" style={{ fontSize: "var(--text-detail)" }}>{numberLines(writeContent)}</pre>
        </div>
      )}
      {!isDiff && !summary && writeContent === undefined && (
        <div className="bg-surface px-3 py-2">
          <pre className={`text-text-secondary font-mono whitespace-pre-wrap ${block.isError ? "text-danger" : ""}`} style={{ fontSize: "var(--text-detail)" }}>{truncateResult(block.content)}</pre>
        </div>
      )}
    </div>
  );
}
