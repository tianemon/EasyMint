import {
  DEFAULT_ENVIRONMENT_STATE,
  type EnvReport,
  type EnvironmentState,
  type InstallEvent,
  type InstallResult,
} from "../../../shared/environment";

type RunRepair = (progress: (event: InstallEvent) => void, signal: AbortSignal) => Promise<InstallResult>;

export function createEnvironmentController(deps: {
  probe: () => Promise<EnvReport>;
  resetBeforeCheck: () => Promise<void>;
  settleRepair: (result: InstallResult) => Promise<void>;
  publish: (value: EnvironmentState) => void;
}) {
  let state = DEFAULT_ENVIRONMENT_STATE;
  let generation = 0;
  let check: Promise<EnvironmentState> | undefined;
  let controller: AbortController | undefined;

  function update(patch: Partial<EnvironmentState>) {
    state = { ...state, ...patch, revision: state.revision + 1 };
    deps.publish(state);
  }

  function probe(reset = false): Promise<EnvironmentState> {
    if (controller) return Promise.resolve(state);
    if (check && !reset) return check;
    const request = ++generation;
    update({ checking: true });
    check = (async () => {
      try {
        if (reset) await deps.resetBeforeCheck();
        const report = await deps.probe();
        if (request === generation) {
          const failure = state.failure;
          const ids = failure?.ids.filter(id => report.items.some(item => item.id === id && item.status !== "ok"));
          update({ report, checking: false, probeFailed: false, failure: !reset && failure && ids?.length ? { ...failure, ids } : null });
        }
      } catch {
        if (request === generation) update({ checking: false, probeFailed: true });
      } finally {
        if (request === generation) check = undefined;
      }
      return state;
    })();
    return check;
  }

  async function repair(ids: string[], cancellable: boolean, run: RunRepair): Promise<EnvironmentState> {
    if (controller || ids.length === 0) return state;
    if (ids.every(id => state.report?.items.some(item => item.id === id && item.status === "ok"))) return state;
    const active = new AbortController();
    controller = active;
    generation++;
    check = undefined;
    update({ checking: false, failure: null, operation: { ids, phase: "preparing", cancellable, cancelling: false } });
    let result: InstallResult;
    try {
      result = await run(event => {
        // "done" is emitted before the final result arrives. Keep showing verification until it does.
        if (controller !== active || event.phase === "done" || event.phase === "failed" || !state.operation) return;
        update({ operation: { ...state.operation, phase: event.phase, message: event.message } });
      }, active.signal);
      await deps.settleRepair(result);
    } catch (error) {
      result = { ok: false, reason: error instanceof Error ? error.message : String(error) };
    }
    let report = result.report;
    let probeFailed = false;
    if (!report) {
      if (state.operation) update({ operation: { ...state.operation, phase: "verifying", message: undefined } });
      try { report = await deps.probe(); }
      catch { probeFailed = true; }
    }
    const unresolved = ids.filter(id => report?.items.find(item => item.id === id)?.status !== "ok");
    const failure = result.ok || unresolved.length === 0 ? null : { ids: unresolved, reason: result.reason, manualCommand: result.manualCommand };
    controller = undefined;
    update({ operation: null, report: report ?? state.report, failure, probeFailed });
    return state;
  }

  function cancel() {
    if (!controller || !state.operation?.cancellable || state.operation.cancelling) return;
    update({ operation: { ...state.operation, cancelling: true } });
    controller.abort();
  }

  return { state: () => state, probe, repair, cancel };
}
