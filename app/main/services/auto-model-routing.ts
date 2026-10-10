import type { AgentSession, ModelRuntime, ModelRouteRequest, ModelRoute } from "@earendil-works/pi-coding-agent";
import { AUTO_MODEL_ID, type NativeAiSettings, type ModelReference } from "../../shared/native-ai";

const registered = new WeakMap<ModelRuntime, { provider: string; signature: string }>();
const runtimeSessions = new WeakMap<ModelRuntime, Set<Pick<AgentSession, "model" | "isIdle">>>();

/** Includes worker/child sessions; ordinary disposal removes the exact session instance. */
export function trackRoutingSession(runtime: ModelRuntime, session: Pick<AgentSession, "model" | "isIdle">): () => void {
  let sessions = runtimeSessions.get(runtime);
  if (!sessions) { sessions = new Set(); runtimeSessions.set(runtime, sessions); }
  sessions.add(session);
  return () => { sessions.delete(session); };
}

export function hasBusyRoutingSession(runtime: ModelRuntime): boolean {
  return [...(runtimeSessions.get(runtime) ?? [])].some(session => session.model?.api === "pi-virtual" && session.model.id === AUTO_MODEL_ID && !session.isIdle);
}

/** One deliberate model switch after the first successful edit; Pi owns branch state and costs. */
export function autoModelRoute(runtime: ModelRuntime, config: NonNullable<NativeAiSettings["autoRouting"]>, request: ModelRouteRequest): ModelRoute {
  request.signal?.throwIfAborted();
  const physical = (ref: ModelReference) => {
    const model = runtime.getPhysicalModel(ref.provider, ref.model);
    if (!model) throw new Error(`Auto routing model is unavailable: ${ref.provider}/${ref.model}`);
    return model;
  };
  const images = request.messages.some(message => Array.isArray(message.content) && message.content.some(block => block.type === "image"));
  if (request.reason === "retry" && request.failed) return { model: request.failed.model, thinkingLevel: request.failed.thinkingLevel ?? request.thinkingLevel };
  const previousConfigured = request.previous && [config.planning, config.execution].some(ref => ref.provider === request.previous!.model.provider && ref.model === request.previous!.model.id);
  if (request.reason === "direct" && request.previous && previousConfigured && (!images || request.previous.model.input.includes("image"))) return { model: request.previous.model, thinkingLevel: request.previous.thinkingLevel ?? request.thinkingLevel };
  const prior = request.state as { phase?: string } | undefined;
  let lastUser = -1;
  request.messages.forEach((message, index) => { if (message.role === "user") lastUser = index; });
  const edited = request.messages.slice(lastUser + 1).some(message => message.role === "toolResult" && (
    !message.isError && (message.toolName === "edit" || message.toolName === "write") ||
    message.nestedCalls?.calls.some(call => call.status === "ok" && (call.name === "edit" || call.name === "write"))));
  const execution = (request.reason === "continuation" || request.reason === "retry") && (prior?.phase === "execution" || edited);
  let model = physical(execution ? config.execution : config.planning);
  if (images && !model.input.includes("image")) {
    const planning = physical(config.planning);
    const candidate = planning.input.includes("image") ? planning : physical(config.execution);
    if (!candidate.input.includes("image")) throw new Error("Auto routing models cannot process images");
    model = candidate;
  }
  const phase = execution ? "execution" : "planning";
  return { model, thinkingLevel: request.thinkingLevel,
    state: prior?.phase === phase ? request.state : { phase } };
}

export function configureAutoModelRouting(runtime: ModelRuntime, settings: NativeAiSettings): void {
  const prior = registered.get(runtime);
  const config = settings.autoRouting;
  const model = config && runtime.getPhysicalModel(config.planning.provider, config.planning.model);
  const executionModel = config && runtime.getPhysicalModel(config.execution.provider, config.execution.model);
  const valid = config && model && executionModel && !runtime.getPhysicalModel(config.planning.provider, AUTO_MODEL_ID);
  const input = model && executionModel ? [...new Set([...model.input, ...executionModel.input])] : [];
  const signature = valid && JSON.stringify([config, model.contextWindow, model.maxTokens, input]);
  if (signature && prior?.signature === signature && runtime.getModel(prior.provider, AUTO_MODEL_ID)?.api === "pi-virtual") return;
  if (prior) runtime.unregisterVirtualModel(prior.provider, AUTO_MODEL_ID);
  registered.delete(runtime);
  if (!valid || !config || !model || !signature) return;
  runtime.registerVirtualModel({ provider: config.planning.provider, id: AUTO_MODEL_ID, name: "Auto · Planning → Execution",
    thinkingLevels: ["off", "minimal", "low", "medium", "high", "xhigh", "max"],
    contextWindow: model.contextWindow, maxTokens: model.maxTokens, input,
    route: request => autoModelRoute(runtime, config, request),
  });
  registered.set(runtime, { provider: config.planning.provider, signature });
}
