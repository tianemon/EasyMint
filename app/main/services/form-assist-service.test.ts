import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import type { Model, Api, AssistantMessage, Context, TranscriptContext, ModelsSimpleStreamOptions } from "@earendil-works/pi-ai";
import { FORM_ASSIST_SYSTEM_PROMPT, FormAssistService } from "./form-assist-service";
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
const model = { id: "configured-model" } as Model<Api>;
const request = { requestId: "request", kind: "directory-name" as const, prompt: "translate this name" };
const reply = (text: string) => fauxAssistantMessage(text);
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; };

describe("tool-free form assistance", () => {
  it("uses the configured model with one bounded request and no tools or conversation state", async () => {
    const completeSimple = vi.fn(async () => reply("  folder-name  ")), report = vi.fn();
    const service = new FormAssistService(async () => ({ model, runtime: { completeSimple } }), report);
    expect(await service.run(1, request)).toBe("folder-name");
    const [usedModel, context, options] = completeSimple.mock.calls[0]! as unknown as [Model<Api>, Context, ModelsSimpleStreamOptions];
    expect(usedModel).toBe(model); expect(context.systemPrompt).toBe(FORM_ASSIST_SYSTEM_PROMPT);
    expect(context.messages).toHaveLength(1); expect(context.tools).toBeUndefined();
    expect(options.maxTokens).toBe(256); expect(FORM_ASSIST_SYSTEM_PROMPT.length).toBeLessThan(300);
    expect(report).toHaveBeenCalledWith(expect.objectContaining({ kind: "directory-name", activeToolCount: 0 }));
  });

  it("isolates cancellation by window even when request ids match, and settles before a late provider reply", async () => {
    const responses = [deferred<AssistantMessage>(), deferred<AssistantMessage>()];
    const signals: AbortSignal[] = [];
    const completeSimple = vi.fn((_model: Model<Api>, _context: Context, options?: ModelsSimpleStreamOptions) => {
      signals.push(options!.signal!); return responses[signals.length - 1]!.promise;
    });
    const service = new FormAssistService(async () => ({ model, runtime: { completeSimple } }), vi.fn());
    const one = service.run(1, request), two = service.run(2, request);
    await vi.waitFor(() => expect(completeSimple).toHaveBeenCalledTimes(2));
    service.cancel(1, request.requestId);
    expect(await one).toBe(""); expect(signals[0]!.aborted).toBe(true); expect(signals[1]!.aborted).toBe(false);
    responses[1]!.resolve(reply("second")); expect(await two).toBe("second");
    responses[0]!.resolve(reply("late"));
  });

  it("does not start a model request after cancellation during backend initialization", async () => {
    const backend = deferred<{ model: Model<Api>; runtime: { completeSimple: (model: Model<Api>, context: Context, options?: ModelsSimpleStreamOptions) => Promise<AssistantMessage> } }>();
    const completeSimple = vi.fn();
    const service = new FormAssistService(() => backend.promise, vi.fn());
    const work = service.run(1, request); service.cancelOwner(1);
    expect(await work).toBe(""); backend.resolve({ model, runtime: { completeSimple } });
    await Promise.resolve(); await Promise.resolve(); expect(completeSimple).not.toHaveBeenCalled();
  });

  it("rejects duplicates, preserves real failures and cleans up the request identity", async () => {
    const first = deferred<AssistantMessage>();
    const completeSimple = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(reply("retry"));
    const service = new FormAssistService(async () => ({ model, runtime: { completeSimple } }), vi.fn());
    const initial = service.run(1, request).catch(error => error);
    await expect(service.run(1, request)).rejects.toThrow("already in progress");
    first.resolve(fauxAssistantMessage("", { stopReason: "error", errorMessage: "provider failure" }));
    expect((await initial).message).toBe("provider failure");
    expect(await service.run(1, request)).toBe("retry");
  });

  it("rejects truncated responses instead of accepting partial feature lists", async () => {
    const completeSimple = vi.fn(async () => fauxAssistantMessage("partial", { stopReason: "length" }));
    const service = new FormAssistService(async () => ({ model, runtime: { completeSimple } }), vi.fn());
    await expect(service.run(1, { ...request, kind: "features" })).rejects.toThrow("length");
  });

  it("supports the real native model runtime without loading an AgentSession", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "em-form-assist-")); roots.push(root);
    const runtime = await ModelRuntime.create({ modelsPath: null, authPath: path.join(root, "auth.json"), allowModelNetwork: false });
    const faux = fauxProvider({ provider: "form-fixture", models: [{ id: "fast" }], tokensPerSecond: 0 });
    runtime.registerNativeProvider(faux.provider); await runtime.refresh({ allowNetwork: false });
    let observed: TranscriptContext | undefined;
    faux.setResponses([(context) => { observed = context; return reply("native-result"); }]);
    const service = new FormAssistService(async () => ({ model: runtime.getModel("form-fixture", "fast")!, runtime }), vi.fn());
    expect(await service.run(1, request)).toBe("native-result");
    expect(faux.state.callCount).toBe(1);
    expect(observed!.messages.every(message => message.role !== "system" || !message.toolsAdded?.length)).toBe(true);
    expect(observed!.messages).toHaveLength(2);
    expect(observed!.messages[0]).toEqual(expect.objectContaining({ role: "system", content: FORM_ASSIST_SYSTEM_PROMPT }));
    expect(observed!.messages[1]).toEqual(expect.objectContaining({ role: "user", content: request.prompt }));
    expect(fs.readdirSync(root)).not.toContain("sessions");
  });
});
