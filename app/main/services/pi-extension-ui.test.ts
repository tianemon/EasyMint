import { describe, expect, it, vi } from "vitest";
import { answerPiExtensionPrompt, bindPiExtensionWindow, createPiExtensionUi } from "./pi-extension-ui";

const sent: Array<{ senderId: number; id: string; kind: string; title: string }> = [];
vi.mock("electron", () => ({
  BrowserWindow: {
    getFocusedWindow: () => ({ isDestroyed: () => false, webContents: { id: 99, isDestroyed: () => false } }),
    getAllWindows: () => [42, 99].map((senderId) => ({
      isDestroyed: () => false,
      webContents: { id: senderId, isDestroyed: () => false, send: (_channel: string, request: { id: string; kind: string; title: string }) => sent.push({ senderId, ...request }) },
    })),
  },
}));

describe("Pi extension UI bridge", () => {
  it("accepts a prompt answer only from the target window", async () => {
    bindPiExtensionWindow("/tmp/pi-project-a", 42);
    const ui = createPiExtensionUi("/tmp/pi-project-a");
    const pending = ui.confirm("Approve?", "run action");
    expect(sent.at(-1)).toMatchObject({ senderId: 42, kind: "confirm", title: "Approve?" });
    const id = sent.at(-1)!.id;
    answerPiExtensionPrompt(99, id, true);
    answerPiExtensionPrompt(42, id, true);
    await expect(pending).resolves.toBe(true);
    const count = sent.length;
    await expect(createPiExtensionUi("/tmp/unbound-project").confirm("Other", "message")).resolves.toBe(false);
    expect(sent).toHaveLength(count);
  });
});
