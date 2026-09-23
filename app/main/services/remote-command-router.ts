import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { BrowserWindow } from "electron";
import { z } from "zod";
import type { RemoteCommandEnvelope } from "../../shared/remote-protocol";
import type { AgentService } from "./agent-service";
import { getPendingAskSnapshots, respondAsk } from "./agent-service";
import { backgroundShellRegistry } from "./background-shell/registry";
import { getOwnedSessionIds, getRunningSummary } from "./task/registry";
import { broadcast } from "./ipc-broadcast";
import { isPermissionModeTightening, normalizePermissionMode } from "./permission/execution-context";
import {
  archiveSession,
  getSessionInfo,
  renameSession,
  togglePin,
  unarchiveSession,
} from "./session-service";
import { readCache, writeCache } from "./session-cache";
import { readShellLogTail } from "./shell-log";
import type { Store } from "./store";
import type { SessionCoordinator } from "./session-coordinator";
import { trackUpload } from "./upload-cache";
import { emHome } from "../utils/paths";

const textSchema = z.string().trim().max(100_000).default("");
const permissionSchema = z.enum(["readonly", "standard", "full"]);
const attachmentSchema = z.object({
  name: z.string().min(1).max(255),
  kind: z.enum(["image", "doc"]),
  mimeType: z.string().min(1).max(120),
  data: z.string().max(21_000_000),
}).strict();

type RemoteAttachment = z.infer<typeof attachmentSchema>;
type PiImage = { type: "image"; data: string; mimeType: string };

function saveRemoteAttachments(raw: unknown): { markers: string[]; images: PiImage[]; details: Array<{ name: string; path: string; kind: "image" | "doc" }> } {
  const attachments = z.array(attachmentSchema).max(10).default([]).parse(raw);
  const uploadDir = path.join(emHome(), "uploads");
  if (attachments.length) fs.mkdirSync(uploadDir, { recursive: true });
  const markers: string[] = [];
  const images: PiImage[] = [];
  const details: Array<{ name: string; path: string; kind: "image" | "doc" }> = [];
  let totalBytes = 0;
  attachments.forEach((attachment: RemoteAttachment, index) => {
    const buffer = Buffer.from(attachment.data, "base64");
    if (buffer.length > 15 * 1024 * 1024) throw Object.assign(new Error(`${attachment.name} 超过 15 MB`), { code: "ATTACHMENT_TOO_LARGE" });
    totalBytes += buffer.length;
    if (totalBytes > 15 * 1024 * 1024) throw Object.assign(new Error("单次发送的附件总量不能超过 15 MB"), { code: "ATTACHMENT_TOO_LARGE" });
    const safeBase = attachment.name.replace(/[^a-zA-Z0-9._-]/g, "_") || "attachment";
    const storedName = `${Date.now()}-${randomUUID().slice(0, 8)}-${safeBase}`;
    const filePath = path.join(uploadDir, storedName);
    fs.writeFileSync(filePath, buffer);
    trackUpload(storedName, buffer.length);
    markers.push(`[${attachment.kind === "image" ? "Image" : "File"} #${index + 1}: ${filePath}]`);
    details.push({ name: attachment.name, path: filePath, kind: attachment.kind });
    if (attachment.kind === "image") images.push({ type: "image", data: attachment.data, mimeType: attachment.mimeType });
  });
  return { markers, images, details };
}

function dataObject(command: RemoteCommandEnvelope): Record<string, unknown> {
  const data = command.payload.data;
  return typeof data === "object" && data !== null ? data as Record<string, unknown> : {};
}

function requireProjectId(command: RemoteCommandEnvelope): string {
  if (!command.projectId) throw Object.assign(new Error("缺少项目 ID"), { code: "INVALID_COMMAND" });
  return command.projectId;
}

function requireSessionId(command: RemoteCommandEnvelope): string {
  if (!command.sessionId) throw Object.assign(new Error("缺少会话 ID"), { code: "INVALID_COMMAND" });
  return command.sessionId;
}

export class RemoteCommandRouter {
  constructor(
    private readonly coordinator: SessionCoordinator,
    private readonly agentService: AgentService,
    private readonly store: Store,
    private readonly mainWindow: BrowserWindow,
  ) {}

  async handle(deviceId: string, command: RemoteCommandEnvelope): Promise<unknown> {
    const name = command.payload.command;
    if (name === "project.listOpen") return this.coordinator.listOpenProjects();
    if (name === "session.list") return this.coordinator.listProjectSessions(requireProjectId(command));
    if (name === "session.snapshot") {
      return this.coordinator.getSessionSnapshot(requireProjectId(command), requireSessionId(command));
    }
    if (name === "session.create") {
      this.coordinator.getOpenProject(requireProjectId(command));
      const settings = this.store.getSettings();
      return {
        draftId: `draft-${randomUUID()}`,
        permissionMode: normalizePermissionMode(settings.chatPermissionMode),
        thinkingLevel: settings.chatThinkingLevel ?? "medium",
        model: settings.model,
      };
    }
    if (name === "session.send") return this.send(command, deviceId);
    if (name === "session.steer") return this.steer(command, deviceId);
    if (name === "session.abort") return this.abort(command);
    if (name === "session.setModel") return this.setModel(command);
    if (name === "session.setThinking") return this.setThinking(command);
    if (name === "session.setPermission") return this.setPermission(command);
    if (name === "session.answerAsk") return this.answerAsk(command);
    if (name === "session.rename") return this.rename(command);
    if (name === "session.pin") return this.pin(command);
    if (name === "session.archive") return this.archive(command);
    if (name === "shell.stop") return this.stopShell(command);
    if (name === "shell.readLog") return this.readShellLog(command);
    if (name === "delegation.stop") return this.stopDelegation(command);
    if (name === "capability.models") return this.models();
    throw Object.assign(new Error(`不支持的命令：${name}`), { code: "UNSUPPORTED_COMMAND" });
  }

  private async send(command: RemoteCommandEnvelope, deviceId: string): Promise<unknown> {
    const projectId = requireProjectId(command);
    const data = dataObject(command);
    const text = textSchema.parse(data.text);
    const project = this.coordinator.getOpenProject(projectId);
    if (command.sessionId) await this.coordinator.requireSession(projectId, command.sessionId);
    const attached = saveRemoteAttachments(data.attachments);
    if (!text && attached.markers.length === 0) throw Object.assign(new Error("消息或附件不能为空"), { code: "INVALID_COMMAND" });
    const agentText = [...attached.markers, ...(text ? [text] : [])].join("\n");
    const permission = permissionSchema.optional().parse(data.permissionMode) ?? "standard";
    const result = await this.agentService.sendMessage(
      project.path,
      agentText,
      command.sessionId ?? null,
      permission,
      this.mainWindow,
      typeof data.model === "string" ? data.model : undefined,
      false,
      attached.images.length ? attached.images : undefined,
      typeof data.thinkingLevel === "string" ? data.thinkingLevel : undefined,
      undefined,
      typeof data.provider === "string" ? data.provider : undefined,
      undefined,
    );
    broadcast("agent:stream", {
      type: "user_message",
      sessionId: result.sessionId,
      chatId: result.chatId,
      text: text || attached.details.map((item) => item.name).join("、"),
      timestamp: Date.now(),
      details: { source: "mobile", sourceDeviceId: deviceId, messageId: randomUUID(), attachments: attached.details },
    });
    return result;
  }

  private async steer(command: RemoteCommandEnvelope, deviceId: string): Promise<{ ok: true }> {
    const projectId = requireProjectId(command);
    const sessionId = requireSessionId(command);
    await this.coordinator.requireSession(projectId, sessionId);
    const data = dataObject(command);
    const text = textSchema.parse(data.text);
    const attached = saveRemoteAttachments(data.attachments);
    if (!text && attached.markers.length === 0) throw Object.assign(new Error("消息或附件不能为空"), { code: "INVALID_COMMAND" });
    const agentText = [...attached.markers, ...(text ? [text] : [])].join("\n");
    await this.agentService.steer(sessionId, agentText, attached.images.length ? attached.images : undefined);
    broadcast("agent:stream", {
      type: "user_message",
      sessionId,
      text: text || attached.details.map((item) => item.name).join("、"),
      timestamp: Date.now(),
      details: { source: "mobile", sourceDeviceId: deviceId, messageId: randomUUID(), attachments: attached.details },
    });
    return { ok: true };
  }

  private async abort(command: RemoteCommandEnvelope): Promise<{ ok: true }> {
    const projectId = requireProjectId(command);
    const sessionId = requireSessionId(command);
    await this.coordinator.requireSession(projectId, sessionId);
    const result = await this.agentService.abort(sessionId, { clearQueue: true, rewind: true });
    if (result?.stopTimedOut) throw Object.assign(new Error("停止未确认完成，请稍后重试"), { code: "ABORT_TIMEOUT" });
    return { ok: true };
  }

  private async setModel(command: RemoteCommandEnvelope): Promise<{ ok: true }> {
    const projectId = requireProjectId(command);
    const sessionId = requireSessionId(command);
    const { project } = await this.coordinator.requireSession(projectId, sessionId);
    const data = dataObject(command);
    const model = z.string().min(1).max(200).parse(data.model);
    const provider = typeof data.provider === "string" ? data.provider : undefined;
    await this.agentService.activateSession(sessionId, project.path);
    await this.agentService.setModel(sessionId, model, provider);
    writeCache(sessionId, { model, provider });
    broadcast("agent:remote-settings-changed", { sessionId, model, provider, revision: readCache(sessionId)?.updatedAt });
    return { ok: true };
  }

  private async setThinking(command: RemoteCommandEnvelope): Promise<{ ok: true }> {
    const projectId = requireProjectId(command);
    const sessionId = requireSessionId(command);
    const { project } = await this.coordinator.requireSession(projectId, sessionId);
    const level = z.string().min(1).max(32).parse(dataObject(command).level);
    await this.agentService.activateSession(sessionId, project.path);
    const supported = this.agentService.getThinkingInfo(sessionId)?.available;
    if (supported?.length && !supported.includes(level)) {
      throw Object.assign(new Error("当前模型不支持该思考等级"), { code: "UNSUPPORTED_THINKING_LEVEL" });
    }
    this.agentService.setThinkingLevel(sessionId, level);
    writeCache(sessionId, { thinkingLevel: level });
    // 桌面端订阅该事件以实时刷新输入卡片；远程修改也应走同一条更新路径。
    broadcast("agent:thinking-level-changed", { sessionId, level, available: supported });
    broadcast("agent:remote-settings-changed", { sessionId, thinkingLevel: level, revision: readCache(sessionId)?.updatedAt });
    return { ok: true };
  }

  private async setPermission(command: RemoteCommandEnvelope): Promise<{ ok: true }> {
    const projectId = requireProjectId(command);
    const sessionId = requireSessionId(command);
    await this.coordinator.requireSession(projectId, sessionId);
    const mode = permissionSchema.parse(dataObject(command).mode);
    const previous = readCache(sessionId)?.permissionMode;
    writeCache(sessionId, { permissionMode: mode });
    if (isPermissionModeTightening(previous, mode)) await this.agentService.revokeElevatedExecution(sessionId);
    if (previous !== undefined && normalizePermissionMode(previous) === "readonly" && mode !== "readonly") {
      this.agentService.schedulePermissionToolRebuild(sessionId);
    }
    broadcast("agent:permission-mode-changed", { sessionId, mode });
    broadcast("agent:remote-settings-changed", { sessionId, permissionMode: mode, revision: readCache(sessionId)?.updatedAt });
    return { ok: true };
  }

  private async answerAsk(command: RemoteCommandEnvelope): Promise<{ ok: true }> {
    const projectId = requireProjectId(command);
    const sessionId = requireSessionId(command);
    await this.coordinator.requireSession(projectId, sessionId);
    const data = dataObject(command);
    const requestId = z.string().uuid().parse(data.requestId);
    if (!getPendingAskSnapshots(sessionId).some((ask) => ask.requestId === requestId)) {
      throw Object.assign(new Error("问题已关闭或不属于该会话"), { code: "ASK_CLOSED" });
    }
    const answers = z.array(z.object({
      questionId: z.string().min(1).max(128),
      values: z.array(z.string().max(5_000)).max(20),
    })).nullable().parse(data.answers);
    respondAsk(requestId, answers);
    return { ok: true };
  }

  /** 停止后台命令——与桌面端 ShellBar 的停止按钮同一条底层（registry.stop）。
   *  破坏性操作，先按会话归属校验：只有该会话（或其名下子会话）拥有的后台命令能被停。 */
  private async stopShell(command: RemoteCommandEnvelope): Promise<{ ok: true }> {
    const sessionId = await this.requireOwnedSession(command);
    const shellId = z.string().min(1).max(128).parse(dataObject(command).shellId);
    const owned = getOwnedSessionIds(sessionId);
    const target = backgroundShellRegistry.list().find((shell) => shell.id === shellId);
    if (!target || !target.sessionId || !owned.has(target.sessionId)) {
      throw Object.assign(new Error("后台命令不存在或不属于该会话"), { code: "SHELL_NOT_FOUND" });
    }
    // source=user：停止来自用户操作（手机上的停止按钮），中止通知显示「已由用户中止」
    backgroundShellRegistry.stop(shellId, "user");
    return { ok: true };
  }

  /**
   * 读后台命令输出的尾部（手机端的「查看完整输出」弹层）。
   * 归属校验与 shell.stop 完全同一条：只能读本会话（含其子会话）发起过的命令。
   * **只接受 shellId，不回传本机日志路径**——手机不需要它，多暴露一份本机路径没有收益。
   */
  private async readShellLog(command: RemoteCommandEnvelope): Promise<{ content: string; truncated: boolean }> {
    const sessionId = await this.requireOwnedSession(command);
    const shellId = z.string().min(1).max(128).parse(dataObject(command).shellId);
    const owned = getOwnedSessionIds(sessionId);
    const target = backgroundShellRegistry.list().find((shell) => shell.id === shellId);
    if (!target || !target.sessionId || !owned.has(target.sessionId)) {
      throw Object.assign(new Error("后台命令不存在或不属于该会话"), { code: "SHELL_NOT_FOUND" });
    }
    return readShellLogTail(target.logPath);
  }

  /** 停止委派中的单个任务——与桌面端 AgentBar 的停止按钮同一条底层（stopDelegationTask）。 */
  private async stopDelegation(command: RemoteCommandEnvelope): Promise<{ ok: true }> {
    const sessionId = await this.requireOwnedSession(command);
    const data = dataObject(command);
    const delegationId = z.string().uuid().parse(data.delegationId);
    const taskIndex = z.number().int().min(0).parse(data.taskIndex);
    const owned = getOwnedSessionIds(sessionId);
    const target = getRunningSummary().tasks.find((task) =>
      task.delegationId === delegationId && task.index === taskIndex);
    if (!target || !target.sessionId || !owned.has(target.sessionId)) {
      throw Object.assign(new Error("委派任务不存在或不属于该会话"), { code: "DELEGATION_NOT_FOUND" });
    }
    await this.agentService.stopDelegationTask(delegationId, taskIndex);
    return { ok: true };
  }

  /** 破坏性命令的前置校验：项目打开 + 该会话确实属于该项目，返回会话 ID（归属比对基准）。
   *  用 getOwnedSessionIds 而不是直接 `===`：停子会话里的后台命令/委派也应被允许
   *  （与停命令工具、权限收紧「谁拥有谁」同一口径），同时子会话控制不了父会话。 */
  private async requireOwnedSession(command: RemoteCommandEnvelope): Promise<string> {
    const projectId = requireProjectId(command);
    const sessionId = requireSessionId(command);
    await this.coordinator.requireSession(projectId, sessionId);
    return sessionId;
  }

  private async rename(command: RemoteCommandEnvelope): Promise<{ ok: true }> {
    const projectId = requireProjectId(command);
    const sessionId = requireSessionId(command);
    const { project } = await this.coordinator.requireSession(projectId, sessionId);
    const title = z.string().trim().min(1).max(200).parse(dataObject(command).title);
    await renameSession(sessionId, title, project.path);
    broadcast("session:list-changed", { projectId, sessionId, action: "renamed" });
    return { ok: true };
  }

  private async pin(command: RemoteCommandEnvelope): Promise<{ ok: true }> {
    const projectId = requireProjectId(command);
    const sessionId = requireSessionId(command);
    const { project } = await this.coordinator.requireSession(projectId, sessionId);
    const desired = z.boolean().parse(dataObject(command).pinned);
    const current = await getSessionInfo(sessionId, project.path);
    if (!!current?.pinnedAt !== desired) togglePin(sessionId);
    broadcast("session:list-changed", { projectId, sessionId, action: desired ? "pinned" : "unpinned" });
    return { ok: true };
  }

  private async archive(command: RemoteCommandEnvelope): Promise<{ ok: true }> {
    const projectId = requireProjectId(command);
    const sessionId = requireSessionId(command);
    await this.coordinator.requireSession(projectId, sessionId);
    const archived = z.boolean().parse(dataObject(command).archived);
    if (archived) archiveSession(sessionId); else unarchiveSession(sessionId);
    broadcast("session:list-changed", { projectId, sessionId, action: archived ? "archived" : "unarchived" });
    return { ok: true };
  }

  private async models(): Promise<unknown> {
    const providers = this.store.getSettings().apiProviders;
    const currentProvider = providers?.current;
    const config = currentProvider ? providers?.configs?.[currentProvider] : undefined;
    return {
      // 手机端与桌面聊天输入栏一致：模型选择只暴露当前生效供应商的配置，
      // 不让远程端切到未选中的供应商或看到无关模型。
      currentProvider: currentProvider ?? null,
      providers: config && currentProvider ? [{
        id: currentProvider,
        name: config.name,
        currentModel: config.model,
        models: await Promise.all((config.models ?? []).map(async (model) => ({
          id: model,
          name: model,
          thinkingLevels: await this.agentService.getModelThinkingSupport(model),
        }))),
      }] : [],
    };
  }
}
