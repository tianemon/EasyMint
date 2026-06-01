import { useState, useEffect, useRef, useCallback } from "react";
import { useTabStore } from "../stores/tab-store";
import { EditorView, basicSetup } from "codemirror";
import { keymap } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { json } from "@codemirror/lang-json";
import { javascript } from "@codemirror/lang-javascript";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { markdown } from "@codemirror/lang-markdown";
import { syntaxHighlighting, defaultHighlightStyle } from "@codemirror/language";

interface EditorPanelProps {
  filePath?: string;
  fileName?: string;
}

function langForFile(name: string) {
  const ext = name.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "json": return json();
    case "js":
    case "jsx":
    case "ts":
    case "tsx":
    case "mjs":
    case "cjs": return javascript({ jsx: true, typescript: ext === "ts" || ext === "tsx" });
    case "css":
    case "scss":
    case "less": return css();
    case "html":
    case "htm": return html();
    case "md":
    case "mdx": return markdown();
    default: return null;
  }
}

// Clean light theme matching EasyMint's design
const easyMintTheme = EditorView.theme({
  "&": {
    backgroundColor: "#fafbfc",
    color: "#2d3748",
    fontSize: "13px",
    lineHeight: "1.65",
  },
  ".cm-gutters": {
    backgroundColor: "#f1f3f5",
    color: "#a0aec0",
    border: "none",
    borderRight: "1px solid #e2e8f0",
    paddingRight: "8px",
  },
  ".cm-gutterElement": {
    padding: "0 4px",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "#e2e8f0",
    color: "#4a5568",
  },
  ".cm-activeLine": {
    backgroundColor: "rgba(8,145,178,0.06)",
  },
  ".cm-cursor": {
    borderLeftColor: "#0891b2",
  },
  ".cm-selectionBackground, ::selection": {
    backgroundColor: "rgba(8,145,178,0.15)",
  },
  ".cm-selectionMatch": {
    backgroundColor: "rgba(8,145,178,0.08)",
  },
  ".cm-matchingBracket": {
    backgroundColor: "rgba(8,145,178,0.12)",
    outline: "1px solid rgba(8,145,178,0.3)",
  },
  ".cm-tooltip": {
    backgroundColor: "#fff",
    border: "1px solid #e2e8f0",
    borderRadius: "8px",
    boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
  },
  "&.cm-focused .cm-cursor": {
    borderLeftColor: "#0891b2",
  },
  "&.cm-focused": {
    outline: "none",
  },
}, { dark: false });

export function EditorPanel({ filePath, fileName }: EditorPanelProps): JSX.Element {
  const [content, setContent] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lineCount, setLineCount] = useState(0);
  const [saved, setSaved] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

  // Load file content
  useEffect(() => {
    if (!filePath) {
      setContent("");
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    window.electronAPI.file
      .readContent(filePath)
      .then((c) => {
        const text = typeof c === "string" ? c : String(c);
        setContent(text);
        setLineCount(text.split("\n").length);
        setLoading(false);
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : "加载文件失败");
        setLoading(false);
      });
  }, [filePath]);

  // Create / update CodeMirror editor
  useEffect(() => {
    if (!containerRef.current || !content) {
      viewRef.current?.destroy();
      viewRef.current = null;
      return;
    }

    const lang = fileName ? langForFile(fileName) : null;
    const extensions = [
      basicSetup,
      syntaxHighlighting(defaultHighlightStyle),
      easyMintTheme,
      EditorView.updateListener.of((update) => {
        if (update.docChanged && fileName) {
          // Mark tab as dirty when content changes
          const tabs = useTabStore.getState().tabs;
          const tab = tabs.find((t) => t.filePath === filePath);
          if (tab) useTabStore.getState().setDirty(tab.id, true);
        }
      }),
      keymap.of([{
        key: "Mod-s",
        run: () => {
          if (!filePath || !viewRef.current) return false;
          const text = viewRef.current.state.doc.toString();
          window.electronAPI.file.writeContent(filePath, text).then(() => {
            // Mark tab as clean
            const tabs = useTabStore.getState().tabs;
            const tab = tabs.find((t) => t.filePath === filePath);
            if (tab) useTabStore.getState().setDirty(tab.id, false);
            setSaved(true);
            setTimeout(() => setSaved(false), 1500);
          });
          return true;
        },
        preventDefault: true,
      }]),
    ];
    if (lang) extensions.push(lang);

    if (viewRef.current) {
      // Update existing editor
      viewRef.current.dispatch({
        changes: {
          from: 0,
          to: viewRef.current.state.doc.length,
          insert: content,
        },
      });
    } else {
      // Create new editor
      const state = EditorState.create({ doc: content, extensions });
      viewRef.current = new EditorView({ state, parent: containerRef.current });
    }

    return () => {
      viewRef.current?.destroy();
      viewRef.current = null;
    };
  }, [content, fileName]);

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

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-text-secondary">
        <p className="text-sm">加载中…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <p className="text-red-400 text-sm mb-3">{error}</p>
          <button
            className="px-3 py-1 text-xs bg-accent text-white rounded hover:bg-accent-hover transition-colors"
            onClick={() => {
              setError(null);
              setLoading(true);
              window.electronAPI.file.readContent(filePath)
                .then((c) => { setContent(typeof c === "string" ? c : String(c)); setLoading(false); })
                .catch(() => { setError("重新加载失败"); setLoading(false); });
            }}
          >重试</button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full overflow-hidden">
      <div className="flex-1 flex flex-col min-w-0">
        <div className="h-7 flex items-center px-3 border-b border-border bg-surface-alt shrink-0">
          <span className="text-[11px] text-text-secondary">{fileName || filePath}</span>
        </div>
        <div ref={containerRef} className="flex-1 overflow-auto" />
        <div className="h-5 border-t border-border bg-surface-alt flex items-center px-3 shrink-0 gap-3">
          <span className="text-[10px] text-text-secondary">{lineCount} 行</span>
          <span className={`text-[10px] transition-opacity duration-200 ${saved ? "text-accent opacity-100" : "opacity-0"}`}>已保存</span>
          <span className="text-[10px] text-text-secondary ml-auto">Cmd+S 保存</span>
        </div>
      </div>
    </div>
  );
}
