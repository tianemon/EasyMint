import { useState } from "react";

interface RightPanelProps {
  onCollapse: () => void;
}

const MOCK_TASKS: TaskItem[] = [
  {
    id: 1,
    title: "全局主题：纯亮色 Mint 绿",
    status: "done",
    steps: [
      { label: "CSS 变量替换为亮色 Mint", status: "done" },
      { label: "移除 darkMode class 切换", status: "done" },
      { label: "组件移除 toggleTheme 逻辑", status: "done" },
      { label: "App 外壳白色容器 + 投影", status: "done" },
    ],
  },
  {
    id: 2,
    title: "工作台四栏布局 + 面板拖拽",
    status: "done",
    steps: [
      { label: "CSS Grid 六列布局", status: "done" },
      { label: "拖拽 handle 实现", status: "done" },
      { label: "面板折叠/展开", status: "done" },
      { label: "macOS 标题栏", status: "done" },
    ],
  },
  {
    id: 3,
    title: "侧边图标栏 + 下拉菜单 + Tooltip",
    status: "running",
    steps: [
      { label: "44px 侧边栏 + 按钮样式", status: "done" },
      { label: "新建下拉菜单", status: "done" },
      { label: "CSS tooltip 实现", status: "done" },
      { label: "终端按钮禁用态", status: "running" },
    ],
  },
  {
    id: 4,
    title: "左面板 — 文件树 + 会话列表",
    status: "pending",
    steps: [
      { label: "文件树递归渲染", status: "pending" },
      { label: "会话列表模式切换", status: "pending" },
      { label: "新建会话按钮", status: "pending" },
    ],
  },
  {
    id: 5,
    title: "中间编辑区 — Tab 栏 + Chat 面板",
    status: "pending",
    steps: [
      { label: "Tab 栏管理", status: "pending" },
      { label: "Chat 欢迎页", status: "pending" },
      { label: "消息气泡样式", status: "pending" },
      { label: "Token 状态栏", status: "pending" },
    ],
  },
];

function statusDot(status: TaskItem["status"], large = false): JSX.Element {
  const size = large ? "w-2.5 h-2.5" : "w-1.5 h-1.5";

  switch (status) {
    case "done":
      return (
        <span className={`${size} rounded-full bg-accent inline-block shrink-0`}>
          {large && (
            <svg className="w-full h-full text-white p-0.5" viewBox="0 0 10 10" fill="none">
              <path d="M2 5l2 2 4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </span>
      );
    case "running":
      return (
        <span className={`${size} rounded-full bg-amber-400 inline-block shrink-0 task-pulse`}>
          {large && <span className="block w-full h-full rounded-full bg-amber-400" />}
        </span>
      );
    case "failed":
      return (
        <span className={`${size} rounded-full bg-red-500 inline-block shrink-0`}>
          {large && (
            <svg className="w-full h-full text-white p-0.5" viewBox="0 0 10 10" fill="none">
              <path d="M3 3l4 4M7 3l-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          )}
        </span>
      );
    case "pending":
    default:
      return <span className={`${size} rounded-full border border-text-secondary/40 inline-block shrink-0`} />;
  }
}

export function RightPanel({ onCollapse }: RightPanelProps): JSX.Element {
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());

  const toggleExpand = (id: number) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const doneCount = MOCK_TASKS.filter((t) => t.status === "done").length;
  const totalCount = MOCK_TASKS.length;

  return (
    <div className="flex flex-col min-w-0 bg-surface border-l border-border">
      {/* Panel header */}
      <div className="h-9 flex items-center justify-between px-3 border-b border-border shrink-0">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-medium text-text-primary">任务列表</span>
          <span className="text-2xs text-text-secondary">
            {doneCount}/{totalCount} 完成
          </span>
        </div>
        <button
          className="w-5 h-5 flex items-center justify-center rounded text-text-secondary hover:text-text-primary hover:bg-surface-hover transition-colors text-xs"
          onClick={onCollapse}
          title="收起面板"
        >
          ▶
        </button>
      </div>

      {/* Task list */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {MOCK_TASKS.map((task) => {
          const isExpanded = expandedIds.has(task.id);

          return (
            <div key={task.id} className="border-b border-border/50 last:border-b-0">
              {/* Task item header */}
              <button
                className="w-full flex items-center gap-2 px-3 py-2 hover:bg-surface-hover transition-colors text-left"
                onClick={() => toggleExpand(task.id)}
              >
                {statusDot(task.status, true)}
                <span className="text-xs text-text-primary truncate flex-1">{task.title}</span>
                <svg
                  className={`w-3 h-3 text-text-secondary shrink-0 transition-transform ${isExpanded ? "rotate-90" : ""}`}
                  viewBox="0 0 12 12"
                  fill="none"
                >
                  <path d="M4.5 3l3 3-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>

              {/* Expanded sub-steps */}
              {isExpanded && (
                <div className="pb-2">
                  {task.steps.map((step, idx) => (
                    <div key={idx} className="flex items-center gap-2 pl-8 pr-3 py-0.5">
                      {statusDot(step.status)}
                      <span
                        className={`text-2xs ${
                          step.status === "done"
                            ? "text-text-secondary line-through"
                            : step.status === "running"
                              ? "text-amber-600"
                              : "text-text-secondary"
                        }`}
                      >
                        {step.label}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
