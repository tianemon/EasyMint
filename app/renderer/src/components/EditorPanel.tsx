export function EditorPanel(): JSX.Element {
  return (
    <div className="flex items-center justify-center h-full text-text-secondary">
      <div className="text-center">
        <div className="text-4xl mb-4">📝</div>
        <p>编辑区 — 文档和代码查看</p>
        <p className="text-sm mt-1">点击左侧工具栏浏览项目结构或对话历史</p>
      </div>
    </div>
  );
}
