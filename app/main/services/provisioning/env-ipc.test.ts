import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { expect, it, vi } from "vitest";

// Execute the registered callback in isolation; importing every IPC service would start unrelated singletons.
const source = ts.createSourceFile("ipc-handlers.ts", fs.readFileSync(path.join(process.cwd(), "app/main/ipc-handlers.ts"), "utf8"), ts.ScriptTarget.Latest, true);
function handlerSource(channel: string): string {
  let callback: ts.Expression | undefined;
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && node.expression.getText(source) === "ipcMain.handle"
      && node.arguments[0] && ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text === channel) callback = node.arguments[1];
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (!callback) throw new Error(`Missing IPC handler ${channel}`);
  return ts.transpileModule(`let envInstallAbort = null; return (${callback.getText(source)});`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
}

it.each([true, false])("Windows install keeps verified runtime readiness on success=%s", async ok => {
  const install = vi.fn(async () => ({ ok }));
  const resetRuntime = vi.fn(), resetSandbox = vi.fn(async () => {});
  const callback = new Function("installDependencies", "resetWindowsRuntimeProbe", "resetSandboxState", "process", handlerSource("env:install"))(
    install, resetRuntime, resetSandbox, { platform: "win32" },
  ) as (event: { sender: { send: () => void } }, payload: { ids: string[] }) => Promise<{ ok: boolean }>;
  expect(await callback({ sender: { send: () => {} } }, { ids: ["windowsRuntime"] })).toEqual({ ok });
  expect(resetRuntime).toHaveBeenCalledTimes(ok ? 0 : 1);
  expect(resetSandbox).toHaveBeenCalledOnce();
});

it("explicit Windows recheck clears cached failure before probing", async () => {
  const order: string[] = [];
  const callback = new Function("resetWindowsRuntimeProbe", "resetSandboxState", "probeEnvironment", "process", handlerSource("env:retest"))(
    () => order.push("runtime"), async () => { order.push("sandbox"); }, async () => { order.push("probe"); return "report"; }, { platform: "win32" },
  ) as () => Promise<string>;
  expect(await callback()).toBe("report");
  expect(order).toEqual(["runtime", "sandbox", "probe"]);
});
