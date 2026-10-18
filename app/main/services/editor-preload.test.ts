import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

describe("restricted HTML editor preload", () => {
  it("exposes no workspace API and cannot forward a renderer-supplied file path", () => {
    const invoke = vi.fn(), on = vi.fn(), removeListener = vi.fn();
    const exposed: Record<string, any> = {};
    vm.runInNewContext(fs.readFileSync(path.resolve('resources/em-html-editor/preload.cjs'), 'utf8'), {
      require: () => ({ contextBridge: { exposeInMainWorld: (key: string, api: unknown) => { exposed[key] = api; } },
        ipcRenderer: { invoke, on, removeListener } }),
    });
    expect(Object.keys(exposed)).toEqual(['editorAPI']);
    expect(Object.keys(exposed.editorAPI)).toEqual(['openInBrowser', 'onUiLanguageChanged']);
    exposed.editorAPI.openInBrowser('/tmp/arbitrary.exe');
    expect(invoke).toHaveBeenCalledWith('editor:open-current');
    const callback = vi.fn(), off = exposed.editorAPI.onUiLanguageChanged(callback);
    const handler = on.mock.calls[0][1];
    handler({ secretEvent: true }, { locale: 'en' });
    expect(callback).toHaveBeenCalledWith({ locale: 'en' });
    off(); expect(removeListener).toHaveBeenCalledWith('settings:uiLanguageChanged', handler);
  });
});
