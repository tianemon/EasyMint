/**
 * todo_write 工具 — Mint 执行追踪（会话待办）全量替换写入。
 * 对齐 Claude Code TodoWrite：一次调用 = 完整清单（原子、免 id/增量歧义）。
 * 使用规范全在 description/promptGuidelines（宪法零增量）。
 */
import type { ToolDefinition } from "../pi-sdk";
import { getDefineToolFn } from "../pi-sdk";
import { broadcast } from "../ipc-broadcast";
import { readSessionTodos, replaceSessionTodos, compareSessionTodos, type SessionTodo } from "../session-todos";

function text(t: string): { content: Array<{ type: "text"; text: string }> } {
  return { content: [{ type: "text" as const, text: t }] };
}

const STATUS_LABEL: Record<string, string> = { pending: "待办", in_progress: "进行中", completed: "完成" };

/** 规范化清单文本（自证写入结果——设计文档 §2） */
function summarize(todos: SessionTodo[]): string {
  const inProgress = todos.filter((t) => t.status === "in_progress").length;
  const completed = todos.filter((t) => t.status === "completed").length;
  const lines = todos.map((t) => `- [${STATUS_LABEL[t.status] ?? t.status}] ${t.content}`).join("\n");
  return `已更新步骤（共 ${todos.length} 项，${inProgress} 进行中，${completed} 完成）：\n${lines}`;
}

export async function createTodoWriteTool(
  projectPath: string,
  sessionId: string,
): Promise<ToolDefinition> {
  const defineTool = await getDefineToolFn();
  return defineTool({
    name: "todo_write",
    label: "更新步骤",
    description:
      "全量替换本会话的步骤清单（Mint 执行追踪——给用户看的当前进度承诺）。"
      + "传完整清单（含已完成项，用 status 标记），不是增量 patch。"
      + "校验：1-20 项、content ≤200 字符、至多 1 项 in_progress（当前焦点唯一）；waiting 只能标在 in_progress 项上。"
      + "调用后前端即时展示：条上显示当前项耗时与等待状态。"
      + "清单按有目标的执行阶段展示：开始、切换/完成阶段、阻塞或等待用户、整体结束时同步更新，同一阶段内的工具操作不反复回填。"
      + "清单不能停在已完成阶段；确实在等用户时，把当前项标 waiting: true，content 写明等什么，恢复执行时清除 waiting。"
      + "这是当前任务的会话进度，不复制 task.json 的正式任务清单，也不替代其任务状态或委派结果自动回写。",
    promptSnippet: "更新步骤清单（全量替换：本次进度的展示）",
    promptGuidelines: [
      "建单与 task.json 分工按主会话的任务执行规则判定，不机械计数读文件、编辑、测试、提交等工具操作",
      "清单是给用户看的阶段进度：一次只推进一项（改 in_progress），阶段完成即标 completed，与实际执行同步",
      "阶段切换/完成、阻塞等待和整体结束时及时回填，不攒到最后；同一阶段内每次工具调用不更新，等待时说明等什么",
      "界面显示：输入区上沿的「步骤 x/y」进度条(TodoStrip)即本工具内容——显示当前项耗时与「等待你」标记，聊天工具块标题显示「更新步骤」",
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
              waiting: { type: "boolean" as const, description: "该项正在等用户输入（仅 in_progress 项可标，条上显示「等待你」）" },
            },
            required: ["content", "status"],
          },
        },
      },
      required: ["todos"],
    },
    async execute(_toolCallId: string, params: Record<string, unknown>, _signal: AbortSignal | undefined, _onUpdate: unknown, ctx: any) {
      const raw = params.todos;
      if (!Array.isArray(raw) || raw.length === 0) {
        return text("todo_write 参数错误：todos 必须是非空数组（传完整清单，含已完成项）");
      }
      const todos: SessionTodo[] = raw.map((t) => {
        const item = t as Record<string, unknown>;
        const todo: SessionTodo = {
          content: String(item.content ?? "").trim(),
          status: String(item.status ?? "") as SessionTodo["status"],
        };
        if (item.waiting === true) todo.waiting = true;
        return todo;
      });
      // 真实会话 id：优先 SDK（工具闭包 sessionId 在新建会话是临时 UUID，前端按真实 sid 过滤）
      let realSid = sessionId;
      try {
        realSid = ctx?.sessionManager?.getSessionId?.() ?? sessionId;
      } catch { /* 保持闭包 sid */ }

      // 写入前先与上一轮比对：清单退化（已完成被改回／丢项）只作提醒、照旧写入。
      // 不做硬阻断的理由：阻断会让模型卡在「上一轮写错了、这一轮改不回来」；清单是全量替换，用户看到的始终是当前状态，提醒足以纠偏。
      const prev = readSessionTodos(projectPath, realSid);
      const warnings = compareSessionTodos(prev, todos);
      const r = replaceSessionTodos(projectPath, realSid, todos);
      if (!r.ok) return text(`todo_write 校验失败：${r.error}`);
      broadcast("agent:todos", { sessionId: realSid, todos: readSessionTodos(projectPath, realSid) });
      if (warnings.length === 0) return text(summarize(todos));
      return text(`${summarize(todos)}\n\n⚠️ 清单比对提醒（写入已生效，正常调整可忽略）：\n${warnings.map((w) => `- ${w}`).join("\n")}`);
    },
  } as any) as ToolDefinition;
}
