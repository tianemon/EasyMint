import fs from "node:fs";
import os from "node:os";
import { getDefineToolFn } from "../pi-sdk";
import type { ToolDefinition } from "../pi-sdk";
import {
  describeToolSessions,
  listToolSessions,
  readSessionTail,
  type ToolName,
} from "../memory/tool-sessions";

/**
 * 其他 AI 工具会话的按需入口。
 *
 * 默认只给清单（哪个工具、什么时候、文件路径）；用户明确要求看内容时才 read，
 * 且只取"最后一段助手结论"，不把整场对话搬进上下文。
 */
export async function createOtherSessionsTool(cwd: string): Promise<ToolDefinition> {
  const define = await getDefineToolFn(true);
  return define({
    name: "other_sessions",
    label: "其他工具会话",
    executionMode: "parallel",
    description:
      "查看同一项目在 codex / claude 等其他 AI 工具里最近的会话。默认只列清单（工具、时间、文件）；用户明确问\"那边做了什么\"时才用 read 读最后一段结论。不要用它替代本会话的历史。",
    promptGuidelines: [
      "先 list 再决定是否 read；用户没有明确要看内容时不要 read。",
      "read 只返回最后一段助手结论，不足以回答时如实说明，不要编造。",
      "路径来自 list 的返回，不要自己拼。",
    ],
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["list", "read"] },
        projectPath: { type: "string", description: "项目绝对路径；默认当前项目" },
        file: { type: "string", description: "read 时使用 list 返回的文件路径" },
        tool: { type: "string", enum: ["codex", "claude"], description: "read 时的工具类型，用于解析格式" },
        days: { type: "number", description: "list 时回看天数，默认 14" },
      },
      required: ["action"],
    },
    async execute(_id: string, params: Record<string, unknown>, signal?: AbortSignal) {
      signal?.throwIfAborted();
      const action = String(params.action);
      if (action === "read") {
        const file = typeof params.file === "string" ? params.file : "";
        if (!file) throw new Error("缺少 file：先用 action=list 取回文件路径");
        const raw = fs.readFileSync(file, "utf8");
        const tail = readSessionTail(raw);
        const payload = tail
          ? { tool: (params.tool as ToolName | undefined) ?? "codex", file, ...tail }
          : { file, text: "该会话没有可读的助手结论" };
        return { content: [{ type: "text" as const, text: JSON.stringify(payload) }], details: payload as unknown as Record<string, unknown> };
      }
      const projectPath = typeof params.projectPath === "string" ? params.projectPath : cwd;
      const days = typeof params.days === "number" ? params.days : 14;
      const hits = listToolSessions(
        { home: os.homedir(), projectPath, days },
        {
          listDir: (dir) => {
            try {
              return fs
                .readdirSync(dir, { withFileTypes: true })
                .map((entry) => ({ name: entry.name, isDir: entry.isDirectory() }));
            } catch {
              return null;
            }
          },
          mtime: (file) => {
            try {
              return fs.statSync(file).mtimeMs;
            } catch {
              return null;
            }
          },
        },
      );
      const payload = {
        summary: describeToolSessions(hits) ?? "该项目在其他工具里没有近期会话",
        sessions: hits.map((hit) => ({
          tool: hit.tool,
          file: hit.file,
          at: new Date(hit.mtime).toISOString(),
        })),
      };
      return { content: [{ type: "text" as const, text: JSON.stringify(payload) }], details: payload as unknown as Record<string, unknown> };
    },
  });
}
