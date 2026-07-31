import { useState, useEffect, useRef } from "react";
import Editor, { loader, type OnMount } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import type { editor } from "monaco-editor";
import { useTabStore } from "../stores/tab-store";
import { conf as mdConf, language as mdLanguage } from "../lib/markdown-monarch";

// Load Monaco from local bundle, not CDN.
// Worker loading handled by @dvaji/vite-plugin-monaco-editor
loader.config({ monaco });

interface EditorPanelProps {
  filePath?: string;
  fileName?: string;
}

function readCSS(name: string): string {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  // Monaco 不接受 3 位 hex（如 #ccc），自动展开为 6 位
  const m = /^#([0-9a-fA-F])([0-9a-fA-F])([0-9a-fA-F])$/.exec(raw);
  return m ? `#${m[1]}${m[1]}${m[2]}${m[2]}${m[3]}${m[3]}` : raw;
}

function buildMonacoTheme(): editor.IStandaloneThemeData {
  const isDark = document.documentElement.getAttribute("data-theme") === "dark";
  return {
    base: isDark ? "vs-dark" : "vs",
    inherit: true,
    // 语法高亮走 --color-code-* 语义变量（亮暗两套自动适配，与代码块统一）
    rules: [
      { token: "comment", foreground: readCSS("--color-code-cm"), fontStyle: "italic" },
      { token: "keyword", foreground: readCSS("--color-code-kw") },
      { token: "string", foreground: readCSS("--color-code-str") },
      { token: "number", foreground: readCSS("--color-code-num") },
      { token: "type", foreground: readCSS("--color-code-type") },
      { token: "function", foreground: readCSS("--color-code-fn") },
      // markdown 标题：正文色（GitHub 风格），不继承 keyword
      { token: "markup.heading", foreground: readCSS("--color-text-primary") },
    ],
    colors: {
      "editor.background": readCSS("--color-monaco-bg"),
      "editor.foreground": readCSS("--color-monaco-fg"),
      "editor.lineHighlightBackground": readCSS("--color-monaco-line-highlight"),
      "editor.selectionBackground": readCSS("--color-monaco-selection"),
      "editor.inactiveSelectionBackground": readCSS("--color-monaco-inactive-selection"),
      "editorCursor.foreground": readCSS("--color-monaco-cursor"),
      "editorLineNumber.foreground": readCSS("--color-monaco-line-number"),
      "editorLineNumber.activeForeground": readCSS("--color-monaco-line-number-active"),
      "editorGutter.background": readCSS("--color-monaco-gutter-bg"),
      "editorWidget.background": readCSS("--color-monaco-widget-bg"),
      "editorWidget.border": readCSS("--color-monaco-widget-border"),
      "input.background": readCSS("--color-monaco-widget-bg"),
      "input.border": readCSS("--color-monaco-widget-border"),
      "focusBorder": readCSS("--color-monaco-focus"),
    },
  };
}

function langForFile(name: string | undefined): string {
  if (!name) return "plaintext";
  const ext = name.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "json": return "json";
    case "js":
    case "jsx":
    case "mjs":
    case "cjs": return "javascript";
    case "ts":
    case "tsx": return "typescript";
    case "css":
    case "scss":
    case "less": return "css";
    case "html":
    case "htm": return "html";
    case "md":
    case "mdx": return "markdown";
    default: return "plaintext";
  }
}

export function EditorPanel({ filePath, fileName }: EditorPanelProps): JSX.Element {
  const [content, setContent] = useState<string>("");
  const [_loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const dirtyRef = useRef(false);

  // 主题是全局的（monaco.setTheme），多个文件 tab 的 EditorPanel 实例共存时
  // 会互相覆盖——只有当前激活的实例才设置主题（切 tab 激活变化触发）。
  // data-theme 变化时同样重建（亮暗自适应）。
  const tabs = useTabStore((s) => s.tabs);
  const activeTabId = useTabStore((s) => s.activeTabId);
  const myTabId = tabs.find((t) => t.type === "file" && t.filePath === filePath)?.id;
  const isActive = myTabId !== undefined && myTabId === activeTabId;

  useEffect(() => {
    const root = document.documentElement;
    const rebuild = () => {
      monaco.editor.defineTheme("easymint", buildMonacoTheme());
      monaco.editor.setTheme("easymint");
    };
    const observer = new MutationObserver(rebuild);
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    if (isActive) rebuild();
    return () => observer.disconnect();
  }, [isActive, myTabId]);

  // Load file content
  useEffect(() => {
    if (!filePath) { setContent(""); setError(null); dirtyRef.current = false; return; }
    setLoading(true);
    setError(null);
    dirtyRef.current = false;
    window.electronAPI.file.readContent(filePath)
      .then((c) => { setContent(typeof c === "string" ? c : String(c)); setLoading(false); })
      .catch((e: unknown) => { setError(e instanceof Error ? e.message : "加载文件失败"); setLoading(false); });
  }, [filePath]);

  const handleMount: OnMount = (editor) => {
    editorRef.current = editor;
    editor.addCommand(2097 /* KeyMod.CtrlCmd | KeyCode.KeyS */, () => {
      if (!filePath) return;
      const text = editor.getValue();
      window.electronAPI.file.writeContent(filePath, text).then(() => {
        const tabs = useTabStore.getState().tabs;
        const tab = tabs.find((t) => t.filePath === filePath);
        if (tab) useTabStore.getState().setDirty(tab.id, false);
        dirtyRef.current = false;
        setSaved(true);
        setTimeout(() => setSaved(false), 1500);
      });
    });
  };

  const handleChange = () => {
    if (fileName && !dirtyRef.current) {
      dirtyRef.current = true;
      const tabs = useTabStore.getState().tabs;
      const tab = tabs.find((t) => t.filePath === filePath);
      if (tab) useTabStore.getState().setDirty(tab.id, true);
    }
  };

  // Welcome page
  if (!filePath) {
    return (
      <div className="flex items-center justify-center h-full text-text-secondary">
        <div className="text-center">
          <p className="text-sm font-medium text-text-primary mb-1">欢迎使用 EasyMint</p>
          <p className="text-xs">点击按钮或者与 Mint 聊天开始创建项目</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <p className="text-danger text-sm mb-3">{error}</p>
          <button className="px-3 py-1 text-xs bg-accent text-text-inverse rounded hover:bg-accent-hover transition-colors"
            onClick={() => { setError(null); setLoading(true); window.electronAPI.file.readContent(filePath).then((c) => { setContent(typeof c === "string" ? c : String(c)); setLoading(false); }).catch(() => { setError("重新加载失败"); setLoading(false); }); }}>
            重试</button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full overflow-hidden">
      <div className="flex-1 flex flex-col min-w-0">
        <Editor
          key={filePath}
          height="100%"
          language={langForFile(fileName)}
          value={content}
          loading={<div className="flex items-center justify-center h-full text-text-secondary text-sm">加载中…</div>}
          beforeMount={(monaco) => {
            // 使用本地修正版 markdown 定义（标题 token = markup.heading）
            monaco.languages.setMonarchTokensProvider("markdown", mdLanguage);
            monaco.languages.setLanguageConfiguration("markdown", mdConf);
            monaco.editor.defineTheme("easymint", buildMonacoTheme());
          }}
          onMount={handleMount}
          onChange={handleChange}
          theme="easymint"
          options={{
            fontSize: 13,
            fontFamily: "'SF Mono', 'Cascadia Code', 'JetBrains Mono', Menlo, Consolas, monospace",
            lineHeight: 22,
            lineNumbersMinChars: 4,
            // 行号与代码间距 = lineDecorationsWidth(默认10) + folding(16) = 26px
            // 收紧：装饰区 0（折叠箭头保留，间距 16px）
            lineDecorationsWidth: 10,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            wordWrap: "on",
            tabSize: 2,
            renderWhitespace: "selection",
            bracketPairColorization: { enabled: true },
            guides: { bracketPairs: true },
            padding: { top: 8 },
            smoothScrolling: false,
            cursorBlinking: "blink",
            cursorSmoothCaretAnimation: "off",
          }}
        />
        {saved && (
          <div className="absolute bottom-2 right-2 px-2 py-0.5 rounded bg-accent-bg text-accent text-xs">
            已保存
          </div>
        )}
      </div>
    </div>
  );
}
