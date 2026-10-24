import { describe, expect, it, vi } from "vitest";
import { createFormAssistClient } from "./form-assist-client";
const deferred = <T>() => { let resolve!: (value: T) => void, reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function fixture() {
  const first = deferred<string>(), second = deferred<string>();
  const api = { formAssist: vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise), cancelFormAssist: vi.fn(async () => {}), sendMessage: vi.fn(), killChat: vi.fn() };
  let counter = 0;
  return { first, second, api, client: createFormAssistClient(api, () => `request-${++counter}`) };
}

describe("form assistance lifecycle", () => {
  it("sends task kinds through the text endpoint and serializes requests", async () => {
    const { client, api, first, second } = fixture();
    const name = client.ask("directory-name", "name"), features = client.ask("features", "features");
    await vi.waitFor(() => expect(api.formAssist).toHaveBeenCalledTimes(1));
    expect(api.formAssist).toHaveBeenLastCalledWith({ requestId: "request-1", kind: "directory-name", prompt: "name" });
    first.resolve("english-name"); expect(await name).toBe("english-name");
    await vi.waitFor(() => expect(api.formAssist).toHaveBeenCalledTimes(2));
    second.resolve("- feature"); expect(await features).toBe("- feature");
    expect(api.sendMessage).not.toHaveBeenCalled(); expect(api.killChat).not.toHaveBeenCalled();
  });

  it("drops work canceled before dispatch", async () => {
    const { client, api } = fixture();
    const pending = client.ask("features", "queued"); client.dispose();
    expect(await pending).toBe("");
    expect(api.formAssist).not.toHaveBeenCalled(); expect(api.cancelFormAssist).not.toHaveBeenCalled();
  });

  it("cancels in-flight work, drops late replies and queued requests", async () => {
    const { client, api, first } = fixture();
    const active = client.ask("directory-name", "name"), queued = client.ask("features", "features");
    await vi.waitFor(() => expect(api.formAssist).toHaveBeenCalledOnce());
    client.dispose();
    expect(api.cancelFormAssist).toHaveBeenCalledWith("request-1");
    first.resolve("late"); expect(await active).toBe(""); expect(await queued).toBe("");
    expect(api.formAssist).toHaveBeenCalledOnce();
  });

  it("recovers from a failed request without blocking subsequent work", async () => {
    const { client, api, first, second } = fixture();
    const failed = client.ask("directory-name", "bad").catch(error => error);
    const next = client.ask("features", "good");
    first.reject(new Error("provider failed")); expect((await failed).message).toBe("provider failed");
    await vi.waitFor(() => expect(api.formAssist).toHaveBeenCalledTimes(2));
    second.resolve("ok"); expect(await next).toBe("ok");
  });

  it("keeps a new generation independent of a late old failure", async () => {
    const { client, api, first, second } = fixture();
    const old = client.ask("features", "old");
    await vi.waitFor(() => expect(api.formAssist).toHaveBeenCalledOnce());
    client.dispose(); const current = client.ask("features", "new");
    await vi.waitFor(() => expect(api.formAssist).toHaveBeenCalledTimes(2));
    first.reject(new Error("cancelled old request")); expect(await old).toBe("");
    second.resolve("current"); expect(await current).toBe("current");
  });
});
