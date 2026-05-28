import { BrowserWindow } from "electron";
import { spawn, ChildProcess } from "child_process";
import { JsonlParser, JsonlEvent } from "../utils/jsonl-parser";

interface TerminalSession {
  terminalId: string;
  pty: unknown; // node-pty IPty
  cwd: string;
}

interface ActiveRun {
  runId: string;
  process: ChildProcess;
}

interface ActiveChat {
  chatId: string;
  process: ChildProcess;
  parser: JsonlParser;
  projectPath: string;
  mainWindow: BrowserWindow;
}

export class AgentService {
  private terminals: Map<string, TerminalSession> = new Map();
  private activeRuns: Map<string, ActiveRun> = new Map();
  private activeChats: Map<string, ActiveChat> = new Map();
  private terminalCounter = 0;
  private runCounter = 0;
  private chatCounter = 0;
  /** worker 成功完成时触发（code=0），供 evaluator-service 监听 */
  onWorkerComplete: ((projectPath: string) => void) | null = null;

  /** 启动 worker 子进程（自动化模式），spawn Claude + JSONL 流式输出 */
  runWorker(projectPath: string, prompt: string, mainWindow: BrowserWindow): { runId: string } {
    const runId = `run-${++this.runCounter}`;

    const child = spawn("claude", [
      "-p", prompt,
      "--output-format", "stream-json",
      "--permission-mode", "bypassPermissions",
    ], {
      cwd: projectPath,
      stdio: ["ignore", "pipe", "pipe"],
    });

    this.activeRuns.set(runId, { runId, process: child });

    const parser = new JsonlParser();
    parser.on("event", (event: JsonlEvent) => {
      mainWindow.webContents.send("agent:stream", this.toStreamEvent(event, runId, "worker"));
    });
    parser.start(child.stdout!);

    child.stderr?.on("data", (data: Buffer) => {
      mainWindow.webContents.send("agent:stderr", {
        runId,
        data: data.toString("utf-8"),
        timestamp: Date.now(),
      });
    });

    child.on("exit", (code) => {
      parser.flush();
      parser.stop();
      this.activeRuns.delete(runId);
      mainWindow.webContents.send("agent:exit", { runId, code: code ?? -1 });
      if (code === 0 && this.onWorkerComplete) {
        this.onWorkerComplete(projectPath);
      }
    });

    child.on("error", (err) => {
      parser.stop();
      this.activeRuns.delete(runId);
      mainWindow.webContents.send("agent:stderr", {
        runId,
        data: `Failed to spawn Claude: ${err.message}`,
        timestamp: Date.now(),
      });
      mainWindow.webContents.send("agent:exit", { runId, code: -1 });
    });

    return { runId };
  }

  /** 终止正在运行的 worker 子进程 */
  abort(runId: string): void {
    const run = this.activeRuns.get(runId);
    if (run) {
      run.process.kill();
      this.activeRuns.delete(runId);
    }
  }

  /** 启动 Chat 子进程（长会话模式），spawn Claude + 双向 JSONL */
  startChat(projectPath: string, mainWindow: BrowserWindow): { chatId: string } {
    const chatId = `chat-${++this.chatCounter}`;
    this.spawnChatProcess(chatId, projectPath, mainWindow, false);
    return { chatId };
  }

  /** 向 Chat 子进程 stdin 写入用户消息 */
  sendMessage(chatId: string, message: string): void {
    const chat = this.activeChats.get(chatId);
    if (!chat?.process.stdin || chat.process.killed) return;

    const userMsg = {
      type: "user",
      message: {
        role: "user",
        content: [{ type: "text", text: message }],
      },
    };

    chat.process.stdin.write(JSON.stringify(userMsg) + "\n");

    // 推送用户消息到 renderer 用于气泡展示
    chat.mainWindow.webContents.send("agent:stream", {
      runId: chatId,
      type: "user_message",
      data: { text: message },
      timestamp: Date.now(),
      source: "chat",
    });
  }

  /** 关闭 Chat 子进程（发送 EOF，等待自然退出） */
  stopChat(chatId: string): void {
    const chat = this.activeChats.get(chatId);
    if (!chat) return;
    // 标记为主动关闭，crash 时不自动重连
    this.activeChats.delete(chatId);
    chat.process.stdin?.end();
  }

  private spawnChatProcess(
    chatId: string,
    projectPath: string,
    mainWindow: BrowserWindow,
    resume: boolean,
  ): void {
    const args = [
      "--input-format", "stream-json",
      "--output-format", "stream-json",
      "--permission-mode", "bypassPermissions",
      "--verbose",
    ];
    if (resume) args.push("--continue");

    const child = spawn("claude", args, {
      cwd: projectPath,
      stdio: ["pipe", "pipe", "pipe"],
    });

    const parser = new JsonlParser();
    const toStreamEvent = this.toStreamEvent.bind(this);

    parser.on("event", (event: JsonlEvent) => {
      mainWindow.webContents.send("agent:stream", toStreamEvent(event, chatId, "chat"));
    });
    parser.start(child.stdout!);

    child.stderr?.on("data", (data: Buffer) => {
      mainWindow.webContents.send("agent:stderr", {
        runId: chatId,
        data: data.toString("utf-8"),
        timestamp: Date.now(),
      });
    });

    child.on("exit", (code) => {
      parser.flush();
      parser.stop();

      if (code !== 0 && this.activeChats.has(chatId)) {
        // 非正常退出且未被主动关闭 → 自动重连
        mainWindow.webContents.send("agent:stderr", {
          runId: chatId,
          data: `Chat 进程异常退出 (code ${code})，尝试重连...`,
          timestamp: Date.now(),
        });
        setTimeout(() => {
          if (this.activeChats.has(chatId)) {
            this.spawnChatProcess(chatId, projectPath, mainWindow, true);
          }
        }, 2000);
        return;
      }

      this.activeChats.delete(chatId);
      mainWindow.webContents.send("agent:exit", { runId: chatId, code: code ?? -1 });
    });

    child.on("error", (err) => {
      parser.stop();
      mainWindow.webContents.send("agent:stderr", {
        runId: chatId,
        data: `Chat 启动失败: ${err.message}`,
        timestamp: Date.now(),
      });

      if (this.activeChats.has(chatId)) {
        setTimeout(() => {
          if (this.activeChats.has(chatId)) {
            mainWindow.webContents.send("agent:stderr", {
              runId: chatId,
              data: "正在重新连接 Chat...",
              timestamp: Date.now(),
            });
            this.spawnChatProcess(chatId, projectPath, mainWindow, true);
          }
        }, 3000);
        return;
      }
      mainWindow.webContents.send("agent:exit", { runId: chatId, code: -1 });
    });

    this.activeChats.set(chatId, {
      chatId, process: child, parser, projectPath, mainWindow,
    });
  }

  private toStreamEvent(event: JsonlEvent, runId: string, source: "worker" | "chat"): {
    runId: string;
    type: string;
    data: Record<string, unknown>;
    timestamp: number;
    source: string;
  } {
    const { type, ...rest } = event;
    const streamType = type === "result" ? "system" : type === "raw" ? "error" : type;
    return {
      runId,
      type: streamType,
      data: rest as Record<string, unknown>,
      timestamp: Date.now(),
      source,
    };
  }

  // --- terminal (保留现有 PTY stub 方法，供 terminal:* IPC 通道使用) ---

  createTerminal(cwd: string, _mainWindow: BrowserWindow): { terminalId: string } {
    const terminalId = `term-${++this.terminalCounter}`;
    this.terminals.set(terminalId, { terminalId, pty: null as unknown as TerminalSession["pty"], cwd });
    return { terminalId };
  }

  write(terminalId: string, _data: string): void {
    const session = this.terminals.get(terminalId);
    if (session?.pty) {
      // (session.pty as any).write(data);
    }
  }

  resize(terminalId: string, _cols: number, _rows: number): void {
    const session = this.terminals.get(terminalId);
    if (session?.pty) {
      // (session.pty as any).resize(cols, rows);
    }
  }

  destroyTerminal(terminalId: string): void {
    const session = this.terminals.get(terminalId);
    if (session?.pty) {
      // (session.pty as any).kill();
    }
    this.terminals.delete(terminalId);
  }

  resumeSession(_sessionId: string, _mainWindow: BrowserWindow): void {
    // Will create terminal and write `claude --resume <sessionId>`
  }
}
