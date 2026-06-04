import { useState, useEffect, useRef } from "react";
import Editor, { loader, type OnMount } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import type { editor } from "monaco-editor";
import { useTabStore } from "../stores/tab-store";

// Load Monaco from local bundle, not CDN
loader.config({ monaco });

// Configure web workers for Vite (loader.config alone doesn't do this)
(self as unknown as Record<string, unknown>).MonacoEnvironment = {
  getWorker(_workerId: string, label: string) {
    const workers: Record<string, () => Worker> = {
      json: () => new Worker(new URL("monaco-editor/esm/vs/language/json/json.worker.js", import.meta.url), { type: "module" }),
      css: () => new Worker(new URL("monaco-editor/esm/vs/language/css/css.worker.js", import.meta.url), { type: "module" }),
      html: () => new Worker(new URL("monaco-editor/esm/vs/language/html/html.worker.js", import.meta.url), { type: "module" }),
      typescript: () => new Worker(new URL("monaco-editor/esm/vs/language/typescript/ts.worker.js", import.meta.url), { type: "module" }),
      javascript: () => new Worker(new URL("monaco-editor/esm/vs/language/typescript/ts.worker.js", import.meta.url), { type: "module" }),
      handlebars: () => new Worker(new URL("monaco-editor/esm/vs/language/typescript/ts.worker.js", import.meta.url), { type: "module" }),
      editorWorkerService: () => new Worker(new URL("monaco-editor/esm/vs/editor/editor.worker.js", import.meta.url), { type: "module" }),
    };
    return (workers[label] || workers.editorWorkerService)!();
  },
};

interface EditorPanelProps {
  filePath?: string;
  fileName?: string;
}

const MONACO_THEME: editor.IStandaloneThemeData = {
  base: "vs",
  inherit: true,
  rules: [
    { token: "comment", foreground: "6B7280", fontStyle: "italic" },
    { token: "keyword", foreground: "7C3AED" },
    { token: "string", foreground: "059669" },
    { token: "number", foreground: "D97706" },
    { token: "type", foreground: "2563EB" },
    { token: "function", foreground: "DC2626" },
  ],
  colors: {
    "editor.background": "#ecf5f0",
    "editor.foreground": "#374151",
    "editor.lineHighlightBackground": "#dcfce7",
    "editor.selectionBackground": "#bbf7d0",
    "editor.inactiveSelectionBackground": "#dcfce7",
    "editorCursor.foreground": "#16a34a",
    "editorLineNumber.foreground": "#9CA3AF",
    "editorLineNumber.activeForeground": "#16a34a",
    "editorGutter.background": "#e6f0ea",
    "editorWidget.background": "#ffffff",
    "editorWidget.border": "#d1d5db",
    "input.background": "#ffffff",
    "input.border": "#d1d5db",
    "focusBorder": "#16a34a",
  },
};

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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const dirtyRef = useRef(false);

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
            monaco.editor.defineTheme("easymint", MONACO_THEME);
          }}
          onMount={handleMount}
          onChange={handleChange}
          theme="easymint"
          options={{
            fontSize: 13,
            fontFamily: "'SF Mono', 'Cascadia Code', 'JetBrains Mono', Menlo, Consolas, monospace",
            lineHeight: 22,
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
          <div className="absolute bottom-2 right-2 px-2 py-0.5 rounded bg-accent/10 text-accent text-xs">
            已保存
          </div>
        )}
      </div>
    </div>
  );
}
