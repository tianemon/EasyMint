import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { expect, it, vi } from "vitest";
import type { EnvItem, EnvReport, InstallEvent } from "../../../shared/environment";
import { createEnvironmentController } from "./controller";

// Check the actual IPC wiring without loading unrelated Electron singletons.
const source = ts.createSourceFile("ipc-handlers.ts", fs.readFileSync(path.join(process.cwd(), "app/main/ipc-handlers.ts"), "utf8"), ts.ScriptTarget.Latest, true);
function wiredController(resetRuntime: () => void, resetSandbox: () => Promise<void>, probe: () => Promise<EnvReport>) {
  let call: ts.CallExpression | undefined;
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node) && node.expression.getText(source) === "createEnvironmentController") call = node;
    ts.forEachChild(node, visit);
  }
  visit(source);
  if (!call) throw new Error("Missing environment IPC controller");
  const code = ts.transpileModule(`return ${call.getText(source)};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  return new Function("createEnvironmentController", "resetWindowsRuntimeProbe", "resetSandboxState", "probeEnvironment", "process", "broadcast", code)(
    createEnvironmentController, resetRuntime, resetSandbox, probe, { platform: "win32" }, () => {},
  ) as ReturnType<typeof createEnvironmentController>;
}

function report(items: Array<[EnvItem["id"], EnvItem["status"]]>): EnvReport {
  return {
    items: items.map(([id, status]) => ({ id, label: id, required: true, status, fix: {} })),
    distro: { id: "test", autoInstallable: true }, probedAt: Date.now(),
  };
}

it.each([true, false])("Windows repair preserves the readiness cache on success=%s", async ok => {
  const resetRuntime = vi.fn(), resetSandbox = vi.fn(async () => {});
  const checked = report([["windowsRuntime", ok ? "ok" : "missing"]]);
  const controller = wiredController(resetRuntime, resetSandbox, async () => checked);
  const state = await controller.repair(["windowsRuntime"], true, async () => ({ ok, report: checked }));
  expect(state.report).toEqual(checked);
  expect(state.operation).toBeNull();
  expect(resetRuntime).toHaveBeenCalledTimes(ok ? 0 : 1);
  expect(resetSandbox).toHaveBeenCalledOnce();
});

it("an explicit Windows recheck invalidates cached failures before probing", async () => {
  const order: string[] = [];
  const checked = report([["windowsRuntime", "ok"]]);
  const controller = wiredController(
    () => order.push("runtime"),
    async () => { order.push("sandbox"); },
    async () => { order.push("probe"); return checked; },
  );
  expect((await controller.probe(true)).report).toEqual(checked);
  expect(order).toEqual(["runtime", "sandbox", "probe"]);
});

it("keeps the install and verified result authoritative over an older probe", async () => {
  let finishProbe!: (value: EnvReport) => void;
  const controller = createEnvironmentController({
    probe: () => new Promise(resolve => { finishProbe = resolve; }),
    resetBeforeCheck: async () => {}, settleRepair: async () => {}, publish: () => {},
  });
  const pending = controller.probe();
  const checked = report([["windowsRuntime", "ok"]]);
  await controller.repair(["windowsRuntime"], true, async () => ({ ok: true, report: checked }));
  finishProbe(report([["windowsRuntime", "missing"]]));
  await pending;
  expect(controller.state().report).toEqual(checked);
  const unnecessaryRepair = vi.fn();
  await controller.repair(["windowsRuntime"], true, unnecessaryRepair);
  expect(unnecessaryRepair).not.toHaveBeenCalled();
});

it("keeps row ownership through cancellation and reports only unresolved batch components", async () => {
  const controller = createEnvironmentController({
    probe: async () => report([]),
    resetBeforeCheck: async () => {}, settleRepair: async () => {}, publish: () => {},
  });
  let finish!: (value: { ok: boolean; reason: string; report: EnvReport }) => void;
  let send!: (value: InstallEvent) => void;
  let signal!: AbortSignal;
  const job = controller.repair(["bwrap", "socat"], true, (progress, active) => {
    send = progress; signal = active;
    return new Promise(resolve => { finish = resolve; });
  });
  send({ phase: "installing", index: 1, total: 2 });
  expect(controller.state().operation).toMatchObject({ ids: ["bwrap", "socat"], phase: "installing" });
  const ignored = vi.fn();
  await controller.repair(["userns"], true, ignored);
  expect(ignored).not.toHaveBeenCalled();
  controller.cancel();
  expect(signal.aborted).toBe(true);
  expect(controller.state().operation?.cancelling).toBe(true);
  finish({ ok: false, reason: "Cancelled", report: report([["bwrap", "ok"], ["socat", "missing"]]) });
  await job;
  expect(controller.state().failures.map(failure => failure.ids)).toEqual([["socat"]]);
  expect(controller.state().operation).toBeNull();
});

it("keeps unrelated failures through repairs and checks until their component is verified ready", async () => {
  let checked = report([["windowsRuntime", "missing"], ["winSandbox", "missing"]]);
  const controller = createEnvironmentController({
    probe: async () => checked,
    resetBeforeCheck: async () => {}, settleRepair: async () => {}, publish: () => {},
  });
  await controller.probe();
  await controller.repair(["windowsRuntime"], true, async () => ({ ok: false, report: checked, reason: "Archive damaged" }));
  const runtimeFailure = { ids: ["windowsRuntime"], reason: "Archive damaged" };
  await controller.repair(["winSandbox"], false, async () => ({ ok: false, report: checked, reason: "Authorization cancelled" }));
  expect(controller.state().failures).toEqual([runtimeFailure, { ids: ["winSandbox"], reason: "Authorization cancelled" }]);

  checked = report([["windowsRuntime", "missing"], ["winSandbox", "ok"]]);
  await controller.repair(["winSandbox"], false, async () => {
    expect(controller.state().failures).toEqual([runtimeFailure]);
    return { ok: true, report: checked };
  });
  expect((await controller.probe(true)).failures).toEqual([runtimeFailure]);

  checked = report([["windowsRuntime", "ok"], ["winSandbox", "ok"]]);
  expect((await controller.probe()).failures).toEqual([]);
});
