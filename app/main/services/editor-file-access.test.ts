import { describe, expect, it } from "vitest";
import { EditorFileAccess } from "./editor-file-access";

describe("editor original-file capability", () => {
  it("accepts only the registered editor's main frame and original HTML", () => {
    const access = new EditorFileAccess(), editor = {}, other = {};
    access.register(editor, '/tmp/project/prototype/index.html');
    expect(access.target(editor, true)).toBe('/tmp/project/prototype/index.html');
    expect(() => access.target(editor, false)).toThrow();
    expect(() => access.target(other, true)).toThrow();
    access.remove(editor);
    expect(() => access.target(editor, true)).toThrow();
  });
  it("does not allow toolbox windows or executable source files to launch native applications", () => {
    const access = new EditorFileAccess();
    for (const file of [undefined, '/tmp/tool.exe', '/tmp/script.command', '/tmp/index.html.exe']) {
      const editor = {}; access.register(editor, file);
      expect(() => access.target(editor, true)).toThrow();
    }
  });
});
