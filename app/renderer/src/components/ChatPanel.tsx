export function ChatPanel(): JSX.Element {
  return (
    <div className="flex items-center justify-center h-full text-text-secondary">
      <div className="text-center">
        <div className="text-4xl mb-4">💭</div>
        <p>Chat 对话</p>
        <p className="text-sm mt-1">与 Claude 自由对话，讨论需求和方案</p>
      </div>
    </div>
  );
}
