import { useState, useEffect } from "react";

interface EditorPanelProps {
  filePath?: string;
  fileName?: string;
}

function highlightSyntax(code: string): string {
  let result = code
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Line comments
  result = result.replace(/(\/\/.*)/g, '<span class="cm">$1</span>');
  // Block comments
  result = result.replace(/(\/\*[\s\S]*?\*\/)/g, '<span class="cm">$1</span>');
  // Strings
  result = result.replace(/("(?:[^"\\]|\\.)*")/g, '<span class="str">$1</span>');
  result = result.replace(/('(?:[^'\\]|\\.)*')/g, '<span class="str">$1</span>');
  result = result.replace(/(`(?:[^`\\]|\\.)*`)/g, '<span class="str">$1</span>');

  // Keywords
  const keywords = [
    "const", "let", "var", "function", "import", "export", "from", "return",
    "if", "else", "class", "interface", "type", "extends", "implements", "new", "this",
    "async", "await", "try", "catch", "throw", "default", "as", "of", "in", "for", "while",
    "switch", "case", "break", "continue", "true", "false", "null", "undefined",
    "number", "string", "boolean", "void", "any", "never",
  ];
  const kwPattern = new RegExp(`\\b(${keywords.join("|")})\\b`, "g");
  result = result.replace(kwPattern, '<span class="kw">$1</span>');

  // Function calls: word followed by (
  result = result.replace(/\b([a-zA-Z_$][\w$]*)(\s*\()/g, (_, name, paren) => {
    if (keywords.includes(name)) return `${name}${paren}`;
    return `<span class="fn">${name}</span>${paren}`;
  });

  return result;
}

export function EditorPanel({ filePath, fileName }: EditorPanelProps): JSX.Element {
  const [content, setContent] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        setContent(typeof c === "string" ? c : String(c));
        setLoading(false);
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : "加载文件失败");
        setLoading(false);
      });
  }, [filePath]);

  // Welcome page when no file is open
  if (!filePath) {
    return (
      <div className="flex items-center justify-center h-full text-text-secondary">
        <div className="text-center max-w-sm">
          <div className="text-5xl mb-5 opacity-40">📝</div>
          <p className="text-sm font-medium text-text-primary mb-2">欢迎使用 EasyMint</p>
          <p className="text-sm mb-4 leading-relaxed">
            点击左侧工具栏浏览项目结构、查看对话历史，或与 Claude Chat 自由对话。
          </p>
          <div className="grid grid-cols-2 gap-2 text-xs text-text-secondary">
            <div className="p-3 rounded-lg border border-border bg-surface-alt">
              <div className="text-lg mb-1">🌳</div>
              <div>浏览项目结构</div>
            </div>
            <div className="p-3 rounded-lg border border-border bg-surface-alt">
              <div className="text-lg mb-1">💬</div>
              <div>查看对话历史</div>
            </div>
            <div className="p-3 rounded-lg border border-border bg-surface-alt">
              <div className="text-lg mb-1">💭</div>
              <div>Chat 自由对话</div>
            </div>
            <div className="p-3 rounded-lg border border-border bg-surface-alt">
              <div className="text-lg mb-1">🚀</div>
              <div>启动自动化开发</div>
            </div>
          </div>
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
              window.electronAPI.file
                .readContent(filePath)
                .then((c) => {
                  setContent(typeof c === "string" ? c : String(c));
                  setLoading(false);
                })
                .catch(() => {
                  setError("重新加载失败");
                  setLoading(false);
                });
            }}
          >
            重试
          </button>
        </div>
      </div>
    );
  }

  const lines = content.split("\n");
  const lineCount = lines.length;

  return (
    <div className="flex h-full overflow-hidden">
      {/* Title bar: file name */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="h-7 flex items-center px-3 border-b border-border bg-surface-alt shrink-0">
          <span className="text-[11px] text-text-secondary">{fileName || filePath}</span>
        </div>

        {/* Editor body: gutter + code */}
        <div className="flex-1 overflow-auto flex">
          {/* Line number gutter — 44px */}
          <div className="w-[44px] bg-surface border-r border-border shrink-0 select-none pt-1 pb-4">
            {lines.map((_, i) => (
              <div
                key={i}
                className="text-right pr-2 text-xs leading-5 text-text-secondary"
              >
                {i + 1}
              </div>
            ))}
          </div>

          {/* Code content area */}
          <div className="flex-1 min-w-0 pt-1 pb-4">
            <pre
              className="text-xs font-mono leading-5 whitespace-pre-wrap m-0 px-3 text-text-primary outline-none"
              contentEditable
              suppressContentEditableWarning
              spellCheck={false}
              dangerouslySetInnerHTML={{ __html: highlightSyntax(content) || "&#8203;" }}
            />
          </div>
        </div>

        {/* Status bar */}
        <div className="h-5 border-t border-border bg-surface-alt flex items-center px-3 shrink-0">
          <span className="text-[10px] text-text-secondary">
            {lineCount} 行
          </span>
        </div>
      </div>
    </div>
  );
}
