import { z } from "zod";

export const REMOTE_PROTOCOL_VERSION = 1 as const;

export const remotePermissionModeSchema = z.enum(["readonly", "standard", "full"]);

export const remoteCommandNameSchema = z.enum([
  "project.listOpen",
  "session.list",
  "session.create",
  "session.snapshot",
  "session.send",
  "session.steer",
  "session.abort",
  "session.setModel",
  "session.setThinking",
  "session.setPermission",
  "session.answerAsk",
  "session.rename",
  "session.pin",
  "session.archive",
  "shell.stop",
  "shell.readLog",
  "delegation.stop",
  "capability.models",
]);

export type RemoteCommandName = z.infer<typeof remoteCommandNameSchema>;

const idSchema = z.string().min(1).max(128);

export const remoteEnvelopeSchema = z.object({
  version: z.literal(REMOTE_PROTOCOL_VERSION),
  connectionId: idSchema,
  sequence: z.number().int().nonnegative(),
  sentAt: z.number().int().nonnegative(),
  kind: z.enum(["command", "result", "event", "snapshot"]),
  requestId: idSchema.optional(),
  projectId: idSchema.optional(),
  sessionId: idSchema.optional(),
  payload: z.unknown(),
}).strict();

export type RemoteEnvelope = z.infer<typeof remoteEnvelopeSchema>;

export const remoteCommandEnvelopeSchema = remoteEnvelopeSchema.extend({
  kind: z.literal("command"),
  requestId: idSchema,
  payload: z.object({
    command: remoteCommandNameSchema,
    data: z.unknown().optional(),
  }).strict(),
});

export type RemoteCommandEnvelope = z.infer<typeof remoteCommandEnvelopeSchema>;

export interface RemoteOpenProject {
  id: string;
  name: string;
  status: "setup" | "development" | "completed";
}

export interface RemotePendingAsk {
  requestId: string;
  sessionId: string;
  questions: Array<{
    id: string;
    question: string;
    options?: Array<{ value: string; label: string }>;
  }>;
  allowCustom: boolean;
  createdAt: number;
}

/** 会话思考等级（快照与 agent:thinking-level-changed 事件同一形状）。
 *  生效值字段名是 `level`——两端曾各写一套（一端 level、一端 current），字段名对不上时
 *  编译期发现不了，只能靠线上表现为「取不到、回落到默认等级」。 */
export interface RemoteThinkingInfo {
  level?: string;
  available?: string[];
}

export function parseRemoteEnvelope(input: unknown): RemoteEnvelope {
  return remoteEnvelopeSchema.parse(input);
}

