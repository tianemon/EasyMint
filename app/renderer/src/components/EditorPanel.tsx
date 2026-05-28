export function EditorPanel(): JSX.Element {
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
