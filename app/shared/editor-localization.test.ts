import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";

const read = (name: string) => fs.readFileSync(path.join(process.cwd(), "resources/em-html-editor", name), "utf8");

function loadLocale() {
  const window = { location: { search: "?uiLocale=en" } } as Record<string, any>;
  const context = vm.createContext({ window, URLSearchParams, Map });
  vm.runInContext(read("i18n.js"), context);
  return { window, context, locale: window.EMEditorLocale };
}

function label(source: string, text: string) {
  return { textContent: text, getAttribute: () => source };
}

describe("standalone prototype editor localization", () => {
  it("loads bundled resources and switches only explicitly annotated controls", () => {
    const { locale } = loadLocale();
    const control = label("editor.openHtml", "打开 HTML");
    const userContent = label("editor.export", "用户原型内容");
    const root = { querySelectorAll: (selector: string) => selector === "[data-em-i18n]" ? [control] : [] };
    locale.apply(root);
    expect(control.textContent).toBe("Open HTML");
    locale.setLanguage("zh-CN");
    locale.apply(root);
    expect(control.textContent).toBe("打开 HTML");
    expect(userContent.textContent).toBe("用户原型内容");
    expect(locale.value("unknown custom filename.html")).toBe("unknown custom filename.html");
  });

  it("scopes runtime updates to editor-owned nodes even if prototype content uses the same attributes", () => {
    const { window, context, locale } = loadLocale();
    const control = label("editor.export", "导出");
    const userContent = label("editor.export", "用户原型内容");
    const owned = { querySelectorAll: (selector: string) => selector === "[data-em-i18n]" ? [control] : [] };
    const document = { querySelectorAll: (selector: string) => selector === "[data-em-editor]" ? [owned] : selector === "[data-em-i18n]" ? [control, userContent] : [] };
    const source = ts.createSourceFile("runtime.js", read("runtime.js"), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    let update = "";
    function find(node: ts.Node): void {
      if (ts.isPropertyAssignment(node) && node.name.getText(source) === "setUiLanguage") update = node.initializer.getText(source);
      ts.forEachChild(node, find);
    }
    find(source);
    expect(update).toContain("function");
    Object.assign(context, { document });
    window.EMEditorLocale = locale;
    vm.runInContext(`(${update})()`, context);
    expect(control.textContent).toBe("Export");
    expect(userContent.textContent).toBe("用户原型内容");
  });

  it("updates an open editor without restarting it or losing selection", () => {
    const { window, context, locale } = loadLocale();
    const raw = read("index.html");
    const inline = raw.slice(raw.indexOf("<script>") + 8, raw.lastIndexOf("</script>"));
    const source = ts.createSourceFile("editor.js", inline, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    let setter = "";
    ts.forEachChild(source, (node) => {
      if (ts.isFunctionDeclaration(node) && node.name?.text === "setEditorLanguage") setter = node.getText(source);
    });
    const selection = { id: "user-element", text: "未保存内容" };
    const editor = { selection, start: vi.fn(), stop: vi.fn(), setUiLanguage: vi.fn() };
    const document = { documentElement: { lang: "zh-CN" }, querySelectorAll: () => [] };
    Object.assign(context, { document, em: () => editor });
    window.EMEditorLocale = locale;
    vm.runInContext(`${setter}; setEditorLanguage("en");`, context);
    expect(document.documentElement.lang).toBe("en");
    expect(editor.setUiLanguage).toHaveBeenCalledOnce();
    expect(editor.start).not.toHaveBeenCalled();
    expect(editor.stop).not.toHaveBeenCalled();
    expect(editor.selection).toBe(selection);
    expect(editor.selection.text).toBe("未保存内容");
  });

  it("preserves filenames even when they begin with an application error prefix", () => {
    const { context, locale } = loadLocale();
    const raw = read("index.html");
    const source = ts.createSourceFile("editor.js", raw.slice(raw.indexOf("<script>") + 8, raw.lastIndexOf("</script>")), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    let setter = "";
    ts.forEachChild(source, node => {
      if (ts.isFunctionDeclaration(node) && node.name?.text === "setEditorText") setter = node.getText(source);
    });
    const attributes = new Map<string, string>();
    const element = { textContent: "", setAttribute: (key: string, value: string) => attributes.set(key, value), removeAttribute: (key: string) => attributes.delete(key) };
    Object.assign(context, { editorText: (value: string) => locale.value(value), element });
    vm.runInContext(`${setter}; setEditorText(element, "错误: report.html · 2 KB", false);`, context);
    expect(element.textContent).toBe("错误: report.html · 2 KB");
    expect(attributes.has("data-em-i18n")).toBe(false);
  });

  it("keeps all inline and runtime scripts syntactically valid", () => {
    for (const match of read("index.html").matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)) {
      expect(() => new vm.Script(match[1]!)).not.toThrow();
    }
    expect(() => new vm.Script(read("runtime.js"))).not.toThrow();
  });
});
