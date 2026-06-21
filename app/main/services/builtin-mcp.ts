/**
 * Built-in MCP tools — registered via SDK's createSdkMcpServer, no config files,
 * no external processes. Keys come from em-settings.json.apiKeys.
 *
 * Tools:
 *   describe_image — call Qwen vision model, return text description
 *   web_fetch     — fetch URL content via Tavily Extract or direct HTTP
 */

import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync, cpSync } from "node:fs";
import { basename, extname, join, dirname } from "node:path";
import { homedir } from "node:os";
import { resolveHome, IMAGE_MIME } from "../utils/paths";
import { BrowserWindow, app } from "electron";

// ── Config ──────────────────────────────────────────

const VISION_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1";
const VISION_MODEL = "qwen3.6-flash";

// ── Helpers ─────────────────────────────────────────

function readEmSettings(): Record<string, unknown> {
  const p = `${homedir()}/.easymint/em-settings.json`;
  try {
    if (!existsSync(p)) return {};
    return JSON.parse(readFileSync(p, "utf-8"));
  } catch {
    return {};
  }
}

function readApiKeys(): Record<string, string> {
  return (readEmSettings().apiKeys as Record<string, string>) || {};
}

/** Check if a built-in tool is explicitly enabled AND its API key is set */
function isToolEnabled(name: "vision" | "webFetch"): boolean {
  const settings = readEmSettings();
  const builtin = (settings.builtinTools as Record<string, boolean>) || {};
  const keys = readApiKeys();
  if (name === "vision") return builtin.vision === true && !!keys.VISION_API_KEY;
  return builtin.webFetch === true && !!keys.TAVILY_API_KEY;
}

// ── Vision ──────────────────────────────────────────

async function describeImage(args: { path: string; prompt?: string }): Promise<string> {
  const keys = readApiKeys();
  const key = keys.VISION_API_KEY;
  if (!key) return "VISION_API_KEY 未配置，请在设置中填写 DashScope API Key。";

  const src = resolveHome(args.path);
  let imageContent: Record<string, unknown>;

  if (src.startsWith("http://") || src.startsWith("https://")) {
    imageContent = { type: "image_url", image_url: { url: src } };
  } else {
    if (!existsSync(src)) return `文件不存在: ${src}`;
    const ext = extname(basename(src)).toLowerCase();
    const mime = IMAGE_MIME[ext] || "image/png";
    const data = readFileSync(src).toString("base64");
    imageContent = { type: "image_url", image_url: { url: `data:${mime};base64,${data}` } };
  }

  const body = {
    model: VISION_MODEL,
    messages: [{
      role: "user",
      content: [
        { type: "text", text: args.prompt || "Describe this image in detail." },
        imageContent,
      ],
    }],
    max_tokens: 1024,
  };

  const resp = await fetch(`${VISION_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const err = await resp.text().catch(() => "");
    return `视觉 API 请求失败 (${resp.status}): ${err.slice(0, 300)}`;
  }

  const data = await resp.json() as { choices?: Array<{ message?: { content?: string } }> };
  return data.choices?.[0]?.message?.content || "(无描述)";
}

// ── Web Fetch ───────────────────────────────────────

async function webFetch(args: { url: string; prompt?: string }): Promise<string> {
  const keys = readApiKeys();
  const tavilyKey = keys.TAVILY_API_KEY;

  // Try Tavily Extract first (handles JS-rendered pages, has SSRF protection)
  if (tavilyKey) {
    try {
      const resp = await fetch("https://api.tavily.com/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: tavilyKey,
          urls: [args.url],
          extract_depth: "basic",
          format: "markdown",
        }),
      });
      if (resp.ok) {
        const data = await resp.json() as {
          results?: Array<{ raw_content?: string; url?: string }>;
        };
        const content = data.results?.[0]?.raw_content;
        if (content) {
          let result = `[Web Fetch: ${args.url}]\n${content}`;
          if (args.prompt) result += `\n\n---\n${args.prompt}`;
          return result.slice(0, 50000); // cap at ~50k chars
        }
      }
    } catch { /* fall through to direct fetch */ }
  }

  // Fallback: direct HTTP fetch
  try {
    const url = args.url;
    // SSRF guard: only http/https
    if (!/^https?:\/\//i.test(url)) return "只支持 http/https URL";

    const resp = await fetch(url, {
      headers: { "User-Agent": "EasyMint/1.0" },
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) return `抓取失败 (${resp.status})`;

    const ct = resp.headers.get("content-type") || "";
    if (!ct.includes("text/") && !ct.includes("application/json")) {
      return `不支持的内容类型: ${ct}`;
    }

    const text = await resp.text();
    // Strip HTML tags for non-HTML responses
    const result = ct.includes("text/html")
      ? text.replace(/<script[\s\S]*?<\/script>/gi, "")
            .replace(/<style[\s\S]*?<\/style>/gi, "")
            .replace(/<[^>]+>/g, " ")
            .replace(/\s{2,}/g, "\n")
            .trim()
      : text;
    return `[Web Fetch: ${args.url}]\n${result.slice(0, 50000)}`;
  } catch (e) {
    return `抓取失败: ${(e as Error).message}`;
  }
}

// ── MCP Server ──────────────────────────────────────

/** Build built-in MCP servers. Creates a fresh server per session —
 *  transport disconnects when the session ends, so never reuse. */
export function buildBuiltinMcpServers(projectPath?: string): Record<string, unknown> {
  const visionOn = isToolEnabled("vision");
  const fetchOn = isToolEnabled("webFetch");

  const servers: Record<string, any> = {};

  // UI control tools — always registered regardless of vision/fetch state
  servers["easymint-ui"] = createSdkMcpServer({
    name: "easymint-ui",
    version: "1.0.0",
    alwaysLoad: true,
    tools: [
      tool(
        "show_confirm_dev",
        "通知前端显示「确认开发」按钮。项目初始化完成、准备开始执行 task.json 时调用，无需在回复文本中再提。",
        {},
        async () => ({ content: [{ type: "text", text: "ok" }] }),
      ),
      tool(
        "show_new_project",
        "通知前端显示「新建项目」按钮。检测到用户想创建新项目时调用。",
        {},
        async () => ({ content: [{ type: "text", text: "ok" }] }),
      ),
      tool(
        "set_task_status",
        "更新 task.json 中某任务的状态并实时刷新 UI 任务列表。状态取值：building(开始编码)/evaluating(交 Evaluator 验收)/done(验收通过)/failed(验收失败)/pending(重置为待办)。在调度任务前后调用此工具，让 UI 实时反映进度。",
        {
          taskId: z.string().describe("task.json 中的任务 id（字符串）"),
          status: z.enum(["pending", "building", "evaluating", "done", "failed"]).describe("任务新状态"),
        },
        async (args) => {
          if (!projectPath) {
            return { content: [{ type: "text", text: "当前无项目路径，无法更新任务状态" }] };
          }
          const filePath = join(projectPath, "task.json");
          if (!existsSync(filePath)) {
            return { content: [{ type: "text", text: "task.json 不存在，无法更新任务状态" }] };
          }
          try {
            const data = JSON.parse(readFileSync(filePath, "utf-8"));
            const task = (data.tasks || []).find((t: { id: number | string }) => String(t.id) === String(args.taskId));
            if (!task) {
              return { content: [{ type: "text", text: `未找到 id=${args.taskId} 的任务` }] };
            }
            // 更新 status
            task.status = args.status;
            // 原子写回：先写 .tmp 再 rename
            const tmpPath = filePath + ".tmp";
            writeFileSync(tmpPath, JSON.stringify(data, null, 2), "utf-8");
            renameSync(tmpPath, filePath);
            // 广播事件到前端
            BrowserWindow.getAllWindows().forEach((win) => {
              if (!win.isDestroyed()) {
                win.webContents.send("agent:task-status", { taskId: String(args.taskId), status: args.status, projectPath });
              }
            });
            return { content: [{ type: "text", text: `任务 ${args.taskId} 状态已更新为 ${args.status}` }] };
          } catch (e) {
            return { content: [{ type: "text", text: `更新失败: ${(e as Error).message}` }] };
          }
        },
      ),
      tool(
        "rename_project",
        "（仅打包版本可用）重命名当前项目。传入新名称，EasyMint 将关闭、复制项目到新位置、验证通过后删除旧数据、自动重启。"
        + "调用此工具后，告知用户：EM 即将关闭以完成重命名，请确认已保存工作。",
        {
          newName: z.string().describe("新项目名称（仅名称，不含路径）"),
        },
        async (args) => {
          if (!projectPath) {
            return { content: [{ type: "text", text: "当前无项目，无法重命名" }] };
          }
          if (!app.isPackaged) {
            return { content: [{ type: "text", text: "重命名功能仅在打包版本中可用" }] };
          }
          const oldDir = projectPath;
          const parentDir = dirname(oldDir);
          const newDir = join(parentDir, args.newName);
          if (basename(oldDir) === args.newName) {
            return { content: [{ type: "text", text: "新名称与当前名称相同" }] };
          }
          if (existsSync(newDir)) {
            return { content: [{ type: "text", text: `目标目录已存在: ${newDir}` }] };
          }

          // 复制项目目录（排除 node_modules .git）
          cpSync(oldDir, newDir, { recursive: true });

          // 复制 SDK session 数据
          const sdkProjectsDir = join(homedir(), ".easymint", "projects");
          const oldEncoded = oldDir.replace(/[:\\/]/g, "-");
          const newEncoded = newDir.replace(/[:\\/]/g, "-");
          const oldSessionDir = join(sdkProjectsDir, oldEncoded);
          const newSessionDir = join(sdkProjectsDir, newEncoded);
          if (existsSync(oldSessionDir)) {
            cpSync(oldSessionDir, newSessionDir, { recursive: true });
          }

          // 更新 projects.json
          const projectsPath = join(homedir(), ".easymint", "projects.json");
          if (existsSync(projectsPath)) {
            const data = JSON.parse(readFileSync(projectsPath, "utf-8"));
            const found = (data.projects as Array<Record<string, unknown>>).find((prj: Record<string, unknown>) => {
              const p1 = String(prj.path || "").replace(/\/+$/, "");
              const p2 = oldDir.replace(/\/+$/, "");
              return p1 === p2 || p1 === oldDir;
            });
            if (found) {
              found.name = args.newName;
              found.path = newDir;
              found.lastOpenedAt = new Date().toISOString();
              writeFileSync(projectsPath, JSON.stringify(data, null, 2));
            }
          }

          // 写入清理任务
          const cleanFile = join(homedir(), ".easymint", ".cleanup-pending.json");
          const cleanTask = { oldDir, oldSessionDir, timestamp: Date.now() };
          let cleanTasks: Array<typeof cleanTask> = [];
          if (existsSync(cleanFile)) {
            try { cleanTasks = JSON.parse(readFileSync(cleanFile, "utf-8")); } catch { /* overwrite */ }
          }
          cleanTasks.push(cleanTask);
          writeFileSync(cleanFile, JSON.stringify(cleanTasks, null, 2));

          // 重启
          app.relaunch();
          app.quit();

          return {
            content: [{
              type: "text",
              text: `项目「${basename(oldDir)}」已复制为新项目「${args.newName}」。EasyMint 即将退出，清理旧数据后自动重启并打开新项目。`,
            }],
          };
        },
      ),
      tool(
        "set_project_stage",
        "设置项目进度节点，实时刷新 UI 的 Fishbone 进度条。取值：requirements(需求采集)/tech-selection(技术选型)/init(环境初始化)/planning(任务规划)/developing(开发中)/done(开发完成)。项目每进入一个新阶段时调用。",
        {
          stage: z.enum(["requirements", "tech-selection", "init", "planning", "developing", "done"]).describe("当前项目阶段"),
        },
        async (args) => {
          if (!projectPath) {
            return { content: [{ type: "text", text: "当前无项目路径，无法设置进度" }] };
          }
          try {
            // 合并写入 state.json（保留已有字段）
            const stateDir = join(projectPath, ".easymint");
            const statePath = join(stateDir, "state.json");
            let existing: Record<string, unknown> = {};
            if (existsSync(statePath)) {
              try { existing = JSON.parse(readFileSync(statePath, "utf-8")); } catch { /* overwrite */ }
            } else if (!existsSync(stateDir)) {
              mkdirSync(stateDir, { recursive: true });
            }
            writeFileSync(statePath, JSON.stringify({ ...existing, stage: args.stage }, null, 2), "utf-8");
            // 广播事件到前端
            BrowserWindow.getAllWindows().forEach((win) => {
              if (!win.isDestroyed()) {
                win.webContents.send("agent:project-stage", { stage: args.stage, projectPath });
              }
            });
            return { content: [{ type: "text", text: `项目进度已更新为 ${args.stage}` }] };
          } catch (e) {
            return { content: [{ type: "text", text: `设置进度失败: ${(e as Error).message}` }] };
          }
        },
      ),
    ],
  });

  if (!visionOn && !fetchOn) return servers as unknown as Record<string, unknown>;

  const tools: any[] = [];

  if (visionOn) {
    tools.push(tool(
      "describe_image",
      "描述图片内容。支持本地路径或 URL。当用户发送图片、或消息中有 [Image] 标记、或需要理解图片内容时调用。",
      {
        path: z.string().describe("图片的本地绝对路径或 URL"),
        prompt: z.string().optional().describe("可选的提示词，如'描述UI界面的色彩搭配'"),
      },
      async (args) => {
        try {
          const text = await describeImage(args);
          return { content: [{ type: "text", text }] };
        } catch (e) {
          return { content: [{ type: "text", text: `describe_image 失败: ${(e as Error).message}` }] };
        }
      },
    ));
  }

  if (visionOn && tools.length > 0) {
    servers["easymint-vision"] = createSdkMcpServer({
      name: "easymint-vision",
      version: "1.0.0",
      alwaysLoad: true,
      tools: [...tools],
    });
  }

  if (fetchOn) {
    servers["easymint-web-fetch"] = createSdkMcpServer({
      name: "easymint-web-fetch",
      version: "1.0.0",
      alwaysLoad: true,
      tools: [
        tool(
          "web_fetch",
          "抓取网页内容。当需要读取某个 URL 的实际内容时调用。支持各类网页，返回提取后的文本。",
          {
            url: z.string().describe("要抓取的网页 URL"),
            prompt: z.string().optional().describe("对抓取内容的分析要求"),
          },
          async (args) => {
            try {
              const text = await webFetch(args);
              return { content: [{ type: "text", text }] };
            } catch (e) {
              return { content: [{ type: "text", text: `web_fetch 失败: ${(e as Error).message}` }] };
            }
          },
        ),
      ],
    });
  }

  return servers as unknown as Record<string, unknown>;
}
