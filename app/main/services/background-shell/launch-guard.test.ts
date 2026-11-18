import { EventEmitter } from "node:events";
import { afterEach, expect, it, vi } from "vitest";
import { createEnhancedBashTool, executeForeground } from "./tool";
import { EXECUTION_START_CHECK } from "../permission/wrap-tool";

const mocks = vi.hoisted(() => ({
  start: vi.fn(() => ({id:"fixture",logPath:"fixture.log"})),
  wrap: vi.fn(),
  spawn: vi.fn(),
}));
vi.mock("node:child_process", () => ({spawn: mocks.spawn}));
vi.mock("./registry", () => ({
  backgroundShellRegistry:{start:mocks.start},
  resolveSpawn: () => ({file:"fixture",args:[],opts:{}}),
}));
vi.mock("../pi-sdk", () => ({
  getCreateBashToolDefinition: async () => () => ({promptGuidelines:[]}),
}));
vi.mock("../sandbox/manager", () => ({
  ensureSandbox: async () => ({ok:true}),
  isSandboxBypassedForMode: () => false,
  wrapForSandbox: mocks.wrap,
  annotateSandboxFailures: (_key:string, value:string) => value,
}));
vi.mock("../permission/execution-context", () => ({
  createExecutionContext: () => ({workspaceRealPath:"/fixture",mode:"standard"}),
}));
vi.mock("../permission/wrap-tool", () => ({EXECUTION_POLICY:Symbol(), EXECUTION_START_CHECK:Symbol()}));

afterEach(() => vi.clearAllMocks());

it.each(["cancel", "permission"] as const)("does not start a background command after %s during preparation", async kind => {
  let prepared!: (value:unknown)=>void;
  mocks.wrap.mockReturnValue(new Promise(resolve => {prepared=resolve;}));
  const tool = await createEnhancedBashTool("/fixture");
  const controller = new AbortController();
  let allowed = true;
  const result = tool.execute("id", { command:"mock-only", background:true,
    [EXECUTION_START_CHECK]: () => { if (!allowed) throw new Error("permission changed"); },
  }, controller.signal, undefined, {} as never);
  await vi.waitFor(() => expect(mocks.wrap).toHaveBeenCalledTimes(1));
  if (kind === "cancel") controller.abort(new Error("cancelled"));
  else allowed = false;
  const release = vi.fn(async () => {});
  prepared({kind:"argv",argv:["mock-only"],env:{},release,violationKey:"fixture"});
  await expect(result).rejects.toThrow(kind === "cancel" ? "cancelled" : "permission changed");
  expect(release).toHaveBeenCalledOnce();
  expect(mocks.start).not.toHaveBeenCalled();
  expect(mocks.spawn).not.toHaveBeenCalled();
});

it("does not spawn an already cancelled foreground command", async () => {
  const release = vi.fn(async () => {});
  await expect(executeForeground({argv:["mock-only"],env:{},release},"/fixture",AbortSignal.abort())).rejects.toMatchObject({name:"AbortError"});
  expect(mocks.spawn).not.toHaveBeenCalled();
  expect(release).toHaveBeenCalledOnce();
});

it("preserves the failed status and exit code when truncating foreground output", async () => {
  const child = new EventEmitter() as EventEmitter & {stdout:EventEmitter;stderr:EventEmitter};
  child.stdout=new EventEmitter();child.stderr=new EventEmitter();
  mocks.spawn.mockReturnValueOnce(child);
  const result=executeForeground({argv:["mock-only"],env:{}},"/fixture",undefined);
  child.stdout.emit("data", Buffer.from("L".repeat(9000)));
  child.emit("close",9);
  const output=await result;
  expect(output.content[0].text).toContain("输出过长");
  expect(output.content[0].text).toContain("退出码: 9");
  expect(output).toHaveProperty("isError",true);
});
