import { BrowserWindow } from "electron";
import { spawn, ChildProcess } from "child_process";
import { JsonlParser, JsonlEvent } from "../utils/jsonl-parser";

interface ActiveEval {
  evalId: string;
  process: ChildProcess;
}

export class EvaluatorService {
  private activeEvals: Map<string, ActiveEval> = new Map();
  private evalCounter = 0;
  private running = false;

  get isRunning(): boolean {
    return this.running;
  }

  /** 启动评估 Agent 子进程，通过 agent:stream 推送结果（source: "evaluator"） */
  runEvaluator(projectPath: string, mainWindow: BrowserWindow): { evalId: string } {
    const evalId = `eval-${++this.evalCounter}`;
    this.running = true;

    const prompt = "按 EVALUATOR.md 流程评估一个任务";

    const child = spawn("claude", [
      "-p", prompt,
      "--output-format", "stream-json",
      "--permission-mode", "bypassPermissions",
    ], {
      cwd: projectPath,
      stdio: ["ignore", "pipe", "pipe"],
    });

    this.activeEvals.set(evalId, { evalId, process: child });

    const parser = new JsonlParser();
    parser.on("event", (event: JsonlEvent) => {
      mainWindow.webContents.send("agent:stream", this.toEvalStreamEvent(event, evalId));
    });
    parser.start(child.stdout!);

    child.stderr?.on("data", (data: Buffer) => {
      mainWindow.webContents.send("agent:stderr", {
        runId: evalId,
        data: data.toString("utf-8"),
        timestamp: Date.now(),
      });
    });

    child.on("exit", (code) => {
      parser.flush();
      parser.stop();
      this.activeEvals.delete(evalId);
      this.running = false;
      mainWindow.webContents.send("agent:exit", { runId: evalId, code: code ?? -1 });
    });

    child.on("error", (err) => {
      parser.stop();
      this.activeEvals.delete(evalId);
      this.running = false;
      mainWindow.webContents.send("agent:stderr", {
        runId: evalId,
        data: `评估启动失败: ${err.message}`,
        timestamp: Date.now(),
      });
      mainWindow.webContents.send("agent:exit", { runId: evalId, code: -1 });
    });

    return { evalId };
  }

  /** 终止正在运行的评估子进程 */
  abort(evalId: string): void {
    const evalRun = this.activeEvals.get(evalId);
    if (evalRun) {
      evalRun.process.kill();
      this.activeEvals.delete(evalId);
      this.running = false;
    }
  }

  private toEvalStreamEvent(event: JsonlEvent, evalId: string): {
    runId: string;
    type: string;
    data: Record<string, unknown>;
    timestamp: number;
    source: string;
  } {
    const { type, ...rest } = event;
    const streamType = type === "result" ? "system" : type === "raw" ? "error" : type;
    return {
      runId: evalId,
      type: streamType,
      data: rest as Record<string, unknown>,
      timestamp: Date.now(),
      source: "evaluator",
    };
  }
}
