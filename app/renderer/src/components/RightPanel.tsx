import { useState, useEffect } from "react";

interface TaskStep {
  label: string;
  status: "done" | "running" | "pending" | "failed";
}

interface TaskItem {
  id: number;
  title: string;
  status: "done" | "running" | "pending" | "failed";
  steps: TaskStep[];
}

interface RightPanelProps {
  onCollapse: () => void;
}

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
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());

  useEffect(() => {
    window.electronAPI.project.list().then((projects) => {
      if (projects.length > 0) {
        window.electronAPI.file.readTree(projects[0]!.path).then(() => {
          window.electronAPI.file.readContent("").catch(() => {});
        });
      }
    });

    // Read real task data: for now, fetch via electronAPI or use mock fallback
    const mockTasks: TaskItem[] = [
      {
        id: 1, title: "全局主题：纯亮色 Mint 绿", status: "done",
        steps: [{ label: "CSS 变量替换为亮色 Mint", status: "done" }, { label: "移除 darkMode 切换", status: "done" }, { label: "App 外壳 + 投影", status: "done" }],
      },
      {
        id: 2, title: "工作台四栏布局 + 面板拖拽", status: "done",
        steps: [{ label: "CSS Grid 六列布局", status: "done" }, { label: "拖拽 handle", status: "done" }, { label: "面板折叠/展开", status: "done" }],
      },
      {
        id: 3, title: "侧边图标栏 + 下拉菜单 + Tooltip", status: "done",
        steps: [{ label: "44px 侧边栏 + 按钮样式", status: "done" }, { label: "新建下拉菜单", status: "done" }, { label: "CSS tooltip", status: "done" }, { label: "终端按钮禁用态", status: "done" }],
      },
      {
        id: 4, title: "左面板 — 文件树 + 会话列表", status: "done",
        steps: [{ label: "文件树递归渲染", status: "done" }, { label: "会话列表模式切换", status: "done" }, { label: "新建会话按钮", status: "done" }],
      },
      {
        id: 5, title: "中间编辑区 — Tab 栏 + Chat 面板", status: "done",
        steps: [{ label: "Tab 栏管理", status: "done" }, { label: "Chat 欢迎页", status: "done" }, { label: "消息气泡样式", status: "done" }, { label: "Token 状态栏", status: "done" }],
      },
      {
        id: 6, title: "代码编辑器面板", status: "done",
        steps: [{ label: "gutter + 代码区", status: "done" }, { label: "语法高亮", status: "done" }],
      },
      {
        id: 7, title: "任务列表面板", status: "done",
        steps: [{ label: "状态圆点样式", status: "done" }, { label: "展开/折叠", status: "done" }],
      },
      {
        id: 8, title: "5步自适应表单", status: "done",
        steps: [{ label: "modal overlay", status: "done" }, { label: "Step 指标器", status: "done" }, { label: "表单字段", status: "done" }],
      },
      {
        id: 9, title: "设置弹窗", status: "done",
        steps: [{ label: "外观/Claude状态", status: "done" }, { label: "开发选项开关", status: "done" }, { label: "Token 消耗表", status: "done" }],
      },
      {
        id: 10, title: "Onboarding 设置页", status: "done",
        steps: [{ label: "3步流程", status: "done" }, { label: "扫描动画", status: "done" }, { label: "localStorage 持久化", status: "done" }],
      },
      {
        id: 11, title: "Mock 数据完善", status: "done",
        steps: [{ label: "项目/文件树/会话数据", status: "done" }, { label: "Chat 模拟回复", status: "done" }],
      },
      {
        id: 12, title: "整体 UI 打磨与交互", status: "done",
        steps: [{ label: "统一动画曲线", status: "done" }, { label: "空/异常状态", status: "done" }, { label: "暗色残留清理", status: "done" }],
      },
    ];
    setTasks(mockTasks);
  }, []);

  const toggleExpand = (id: number) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const doneCount = tasks.filter((t) => t.status === "done").length;
  const totalCount = tasks.length;

  return (
    <div className="flex flex-col min-w-0 bg-surface-alt border-l border-border">
      <div className="h-9 flex items-center justify-between px-3 border-b border-border shrink-0">
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-semibold tracking-[0.04em] uppercase text-text-secondary">任务列表</span>
          <span className="text-2xs text-text-secondary">{doneCount}/{totalCount} 完成</span>
        </div>
        <button
          className="w-5 h-5 flex items-center justify-center rounded text-text-secondary hover:text-text-primary hover:bg-surface-hover transition-colors text-xs"
          onClick={onCollapse}
          title="收起面板"
        >
          ▶
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {tasks.map((task) => {
          const isExpanded = expandedIds.has(task.id);
          return (
            <div key={task.id} className="border-b border-border/50 last:border-b-0">
              <button
                className="w-full flex items-center gap-2 px-3 py-2 hover:bg-surface-hover transition-colors text-left"
                onClick={() => toggleExpand(task.id)}
              >
                {statusDot(task.status, true)}
                <span className="text-xs text-text-primary truncate flex-1">{task.title}</span>
                <svg
                  className={`w-3 h-3 text-text-secondary shrink-0 transition-transform ${isExpanded ? "rotate-90" : ""}`}
                  viewBox="0 0 12 12" fill="none"
                >
                  <path d="M4.5 3l3 3-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              {isExpanded && (
                <div className="pb-2">
                  {task.steps.map((step, idx) => (
                    <div key={idx} className="flex items-center gap-2 pl-8 pr-3 py-0.5">
                      {statusDot(step.status)}
                      <span className={`text-2xs ${step.status === "done" ? "text-text-secondary line-through" : step.status === "running" ? "text-amber-600" : "text-text-secondary"}`}>
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
