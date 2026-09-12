/**
 * todo_write 工具 — Mint 执行追踪（会话待办）全量替换写入。
 * 对齐 Claude Code TodoWrite：一次调用 = 完整清单（原子、免 id/增量歧义）。
 * 使用规范全在 description/promptGuidelines（宪法零增量）。
 */
import type { ToolDefinition } from "../pi-sdk";
import { getDefineToolFn } from "../pi-sdk";
import { broadcast } from "../ipc-broadcast";
import { readSessionTodos, replaceSessionTodos, type SessionTodo } from "../session-todos";

function text(t: string): { content: Array<{ type: "text"; text: string }> } {
  return { content: [{ type: "text" as const, text: t }] };
}

const STATUS_LABEL: Record<string, string> = { pending: "待办", in_progress: "进行中", completed: "完成" };

/** 规范化清单文本（自证写入结果——设计文档 §2） */
function summarize(todos: SessionTodo[]): string {
  const inProgress = todos.filter((t) => t.status === "in_progress").length;
  const completed = todos.filter((t) => t.status === "completed").length;
  const lines = todos.map((t) => `- [${STATUS_LABEL[t.status] ?? t.status}] ${t.content}`).join("\n");
  return `已更新待办（共 ${todos.length} 项，${inProgress} 进行中，${completed} 完成）：\n${lines}`;
}

export async function createTodoWriteTool(
  projectPath: string,
  sessionId: string,
): Promise<ToolDefinition> {
  const defineTool = await getDefineToolFn();
  return defineTool({
    name: "todo_write",
    label: "更新待办",
    description:
      "全量替换本会话的待办清单（Mint 执行追踪——给用户看的当前步骤进度承诺）。"
      + "传完整清单（含已完成项，用 status 标记），不是增量 patch。"
      + "校验：1-20 项、content ≤200 字符、至多 1 项 in_progress（当前焦点唯一）。"
      + "调用后前端即时展示。"
      + "务必及时更新待办进度：每完成一步立即把该项标 completed，并把你正在做的那一项标 in_progress。"
      + "条停在已完成的项上，用户会读成「卡住了」；确实在等用户时，把当前项写成「等待你的决定：XXX」。",
    promptSnippet: "更新待办清单（全量替换：本次待办的进度展示）",
    promptGuidelines: [
      "何时用：≥3 步的多步任务、task.json 执行循环（核实进度→building→委派→evaluating→记录）、多阶段流程——建单让用户看到当前在做什么、下一步是什么",
      "何时不用：单步/L0 直接做的任务不建单；修 bug 目标明确的不建单",
      "清单是给用户看的进度承诺：一次只推进一项（改 in_progress），完成即标 completed，与实际执行同步",
      "**务必及时更新进度**：完成一步立刻回填（含验证、提交、写记录这类收尾步骤），不要攒到整轮结束再补——条停在已完成的项上会被读成「卡住了」；确实在等用户时，把当前项写成「等待你的决定：XXX」而非含义模糊的进行中",
      "界面显示：输入区上沿的「待办 x/y」进度条(TodoStrip)即本工具内容，聊天工具块标题也显示「待办」",
      "口语辨析：用户说「关闭待办」→ 把当前清单全部标 completed（收尾——全部完成后条 5s 自动消失）；「收起/隐藏/关掉待办条」→ 用户自己点 UI 上的 ×,不是清空清单——不要调用本工具删除/置空；只有用户明确说重置/结束当前任务进度时才清",
      "口语辨析：「待办」单独出现(如「记个待办」)多指用户个人清单(todo_user);本工具内容是执行中步骤,用户一般说「进度/步骤/做到哪了」——指代不明时先问",
      "与用户待办（.easymint/todos.json，UI 待办面板）的边界：本工具管「本次执行中的步骤」；新想法/后续事项落用户待办；正式任务进 task.json",
    ],
    parameters: {
      type: "object" as const,
      properties: {
        todos: {
          type: "array" as const,
          description: "完整清单：{ content: 一句可验证的祈使句步骤描述, status: pending|in_progress|completed }",
          items: {
            type: "object" as const,
            properties: {
              content: { type: "string" as const, description: "步骤描述（祈使句，≤200 字符）" },
              status: { type: "string" as const, description: "pending / in_progress / completed（至多一项 in_progress）" },
            },
            required: ["content", "status"],
          },
        },
      },
      required: ["todos"],
    },
    async execute(toolCallId: string, params: Record<string, unknown>, _signal: AbortSignal | undefined, _onUpdate: unknown, ctx: any) {
      const raw = params.todos;
      if (!Array.isArray(raw) || raw.length === 0) {
        return text("todo_write 参数错误：todos 必须是非空数组（传完整清单，含已完成项）");
      }
      const todos = raw.map((t) => ({
        content: String((t as Record<string, unknown>).content ?? "").trim(),
        status: String((t as Record<string, unknown>).status ?? "") as SessionTodo["status"],
      }));
      // 真实会话 id：优先 SDK（工具闭包 sessionId 在新建会话是临时 UUID，前端按真实 sid 过滤）
      let realSid = sessionId;
      try {
        realSid = ctx?.sessionManager?.getSessionId?.() ?? sessionId;
      } catch { /* 保持闭包 sid */ }

      const r = replaceSessionTodos(projectPath, realSid, todos);
      if (!r.ok) return text(`todo_write 校验失败：${r.error}`);
      broadcast("agent:todos", { sessionId: realSid, todos: readSessionTodos(projectPath, realSid) });
      return text(summarize(todos));
    },
  } as any) as ToolDefinition;
}
