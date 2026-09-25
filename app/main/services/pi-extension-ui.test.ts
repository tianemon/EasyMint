import { describe, expect, it, vi } from "vitest";
import { answerPiExtensionPrompt, createPiExtensionUi } from "./pi-extension-ui";

const sent: Array<{ id: string; kind: string; title: string }> = [];
vi.mock("electron", () => ({
  BrowserWindow: {
    getFocusedWindow: () => ({
      isDestroyed: () => false,
      webContents: { id: 42, isDestroyed: () => false, send: (_channel: string, request: { id: string; kind: string; title: string }) => sent.push(request) },
    }),
    getAllWindows: () => [],
  },
}));

describe("Pi extension UI bridge", () => {
  it("accepts a prompt answer only from the target window", async () => {
    const ui = createPiExtensionUi();
    const pending = ui.confirm("Approve?", "run action");
    expect(sent.at(-1)).toMatchObject({ kind: "confirm", title: "Approve?" });
    const id = sent.at(-1)!.id;
    answerPiExtensionPrompt(99, id, true);
    answerPiExtensionPrompt(42, id, true);
    await expect(pending).resolves.toBe(true);
  });
});
