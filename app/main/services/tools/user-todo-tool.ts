/**
 * todo_user 工具 — 用户待办（.easymint/todos.json）增量管理。
 * 与 todo_write（会话执行追踪）相对：本工具管「用户的跨会话想法/计划清单」——
 * 清单属用户（UI「待办」面板同源共编辑），只允许单条增量操作（add/toggle/update/remove），
 * 禁止全量替换（会抹掉用户手动编辑的内容）。
 */
import type { ToolDefinition } from "../pi-sdk";
import { getDefineToolFn } from "../pi-sdk";
import { broadcast } from "../ipc-broadcast";
import { addTodo, listTodos, removeTodo, toggleTodo, updateTodo } from "../todo-service";

function text(t: string): { content: Array<{ type: "text"; text: string }> } {
  return { content: [{ type: "text" as const, text: t }] };
}

/** 操作后统计摘要（含未完成列表——自证结果，用户可直接核对） */
function summarize(projectPath: string, lead: string): string {
  const r = listTodos(projectPath);
  const todos = r.data?.todos ?? [];
  const open = todos.filter((t) => t.status === "open");
  const lines = open.map((t) => `- #${t.id} ${t.title}`).join("\n");
  const tail = todos.length === 0 ? "（清单已空）" : `（未完成 ${open.length}/${todos.length}）`;
  return `${lead} ${tail}\n${lines}`;
}

export async function createUserTodoTool(projectPath: string): Promise<ToolDefinition> {
  const defineTool = await getDefineToolFn();
  return defineTool({
    name: "todo_user",
    label: "管理用户待办",
    description:
      "操作项目的用户待办清单（.easymint/todos.json——UI「待办」面板同源，用户跨会话的想法/计划）。"
      + "动作：list（查看）/ add（记录新想法或计划，title 必填、note 补详情）/ toggle（按 id 勾选完成或取消）"
      + "/ remove（按 id 删除）/ update（按 id 改 title/note）。"
      + "一次调用一个动作，单条增量修改——这是用户的清单，禁止全量替换或批量删除。"
      + "校验：title ≤200 字符、note ≤5000 字符。调用后前端面板即时同步。",
    promptSnippet: "操作用户待办清单（add/toggle/remove 单条增量）",
    promptGuidelines: [
      "何时用：用户明确说「记一下/记个待办/先记着 xx」「把这个想法记下来」→ add；「xx 做完了/这项可以勾掉/划掉」→ 先 list 找到 id 再 toggle；「删掉那条待办」→ remove",
      "何时主动记：会话中用户提及「以后/有空/之后要做 xx」的后续事项、未落在本次任务的零散想法 → 记入用户待办并告知（对应主提示词「新想法先落用户待办」规则）",
      "界面显示：输入卡片的「用户待办」按钮/面板即本工具内容(面板标题也写「用户待办」);聊天工具块标题显示「用户待办」",
      "口语辨析：「待办」单独出现(如「记个待办」「打开待办」)默认指本工具管理的用户个人清单;会话执行进度条(todo_write)叫「进度/步骤/待办条」——指代不明时先问",
      "口语辨析：用户说「关掉待办/关闭面板」指 UI 展示(点输入卡片的按钮收起),不是删除清单——不要 remove;只有明确点名单条内容时才删",
      "边界：本工具管用户清单（增量、谨慎、只动用户点名的项）；正在执行的多步任务进度用 todo_write（会话级、全量替换）；正式任务进 task.json——三者不互相代写",
      "add 前可先 list 查重：清单已有同类未完成项时不重复添加（用户清单宁缺毋滥）",
    ],
    parameters: {
      type: "object" as const,
      properties: {
        action: {
          type: "string" as const,
          description: "list：查看全部（含 id，toggle/remove 前先查）；add：新增（title 必填，note 可选）；toggle：按 id 切换完成状态；remove：按 id 删除；update：按 id 修改 title/note",
        },
        title: { type: "string" as const, description: "add/update 用：待办内容（≤200 字符）" },
        note: { type: "string" as const, description: "add/update 用：补充说明（≤5000 字符，可空）" },
        id: { type: "number" as const, description: "toggle/remove/update 用：清单条目的 id（list 返回）" },
      },
      required: ["action"],
    },
    async execute(_toolCallId: string, params: Record<string, unknown>, _signal: AbortSignal | undefined, _onUpdate: unknown) {
      const action = String(params.action ?? "");
      const id = params.id === undefined ? NaN : Number(params.id);

      if (action === "list") {
        const r = listTodos(projectPath);
        const todos = r.data?.todos ?? [];
        const open = todos.filter((t) => t.status === "open");
        const done = todos.length - open.length;
        const lines = todos.map((t) => `- #${t.id} [${t.status === "done" ? "完成" : "未完成"}] ${t.title}${t.note ? `（备注：${t.note.slice(0, 80)}${t.note.length > 80 ? "…" : ""}）` : ""}`).join("\n");
        return text(todos.length === 0 ? "用户待办为空（未完成 0/0）" : `用户待办（未完成 ${open.length}/${todos.length}，完成 ${done}）：\n${lines}`);
      }

      if (action === "add") {
        const title = String(params.title ?? "").trim();
        if (!title) return text("todo_user add 参数错误：title 必填（≤200 字符）");
        const r = addTodo(projectPath, { title, note: params.note === undefined ? undefined : String(params.note).trim() });
        if (!r.ok) return text(`todo_user 操作失败：${r.error}`);
        broadcast("todos:changed", { projectPath });
        return text(summarize(projectPath, `已添加待办 #${r.data?.id}：${title}`));
      }

      if (!Number.isInteger(id) || id <= 0) {
        return text(`todo_user ${action} 参数错误：id 必须是正整数（先 list 查看现有待办的 id）`);
      }

      if (action === "toggle") {
        const before = listTodos(projectPath).data?.todos.find((t) => t.id === id);
        const r = toggleTodo(projectPath, id);
        if (!r.ok) return text(`todo_user 操作失败：${r.error}`);
        const nowDone = r.data?.status === "done";
        broadcast("todos:changed", { projectPath });
        return text(summarize(projectPath, `已${nowDone ? "标记完成" : "重新打开"}待办 #${id}：${before?.title ?? ""}`));
      }

      if (action === "remove") {
        const before = listTodos(projectPath).data?.todos.find((t) => t.id === id);
        const r = removeTodo(projectPath, id);
        if (!r.ok) return text(`todo_user 操作失败：${r.error}`);
        broadcast("todos:changed", { projectPath });
        return text(summarize(projectPath, `已删除待办 #${id}：${before?.title ?? ""}`));
      }

      if (action === "update") {
        const title = params.title === undefined ? undefined : String(params.title).trim();
        const note = params.note === undefined ? undefined : String(params.note).trim();
        if (title === undefined && note === undefined) return text("todo_user update 参数错误：需提供 title 或 note");
        const r = updateTodo(projectPath, { id, title, note });
        if (!r.ok) return text(`todo_user 操作失败：${r.error}`);
        broadcast("todos:changed", { projectPath });
        return text(summarize(projectPath, `已更新待办 #${id}：${r.data?.title ?? ""}`));
      }

      return text(`todo_user 参数错误：action 必须是 list/add/toggle/remove/update（收到 ${action}）`);
    },
  } as any) as ToolDefinition;
}
