import type { ExecutionContext } from "../permission/execution-context";
import type { SandboxRuntimeConfig } from "@anthropic-ai/sandbox-runtime";

export type WindowsSandboxWorkerRequest =
  | { type: "initialize"; requestId: string; context: ExecutionContext; policy: SandboxRuntimeConfig }
  | { type: "wrap"; requestId: string; command: string; shell: "bash" | "powershell"; gitBashPath?: string; commandId: string }
  | { type: "release"; requestId: string; leaseId: string }
  | { type: "shutdown"; requestId: string; force?: boolean };

export type WindowsSandboxWorkerResponse =
  | { type: "ready"; requestId: string }
  | { type: "wrapped"; requestId: string; argv: string[]; env: NodeJS.ProcessEnv }
  | { type: "released"; requestId: string }
  | { type: "stopped"; requestId: string }
  | { type: "error"; requestId: string; message: string };
