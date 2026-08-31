import { useState } from "react";
import { useLearnStore, type LearnRequest } from "../stores/learn-store";

interface Props {
  request: LearnRequest;
}

/**
 * learn 沉淀审阅卡片（聊天区内嵌，毛玻璃，视觉对齐 AskUserCard）：
 * - memory / skill body / skill 名称与描述均可编辑（确认时随响应回传）；context 只读
 * - 「确认入库」携带编辑后内容回传；「取消」放弃（approved: false）
 */
export function LearnCard({ request }: Props): JSX.Element {
  const [memory, setMemory] = useState(request.memory);
  const [skillBody, setSkillBody] = useState(request.skill?.body ?? "");
  // skill 元信息可编辑（撞名/修正场景，确认时随响应回传）
  const [skillName, setSkillName] = useState(request.skill?.name ?? "");
  const [skillDescription, setSkillDescription] = useState(request.skill?.description ?? "");
  const [submitting, setSubmitting] = useState(false);

  const respond = (approved: boolean): void => {
    if (submitting) return;
    setSubmitting(true);
    window.electronAPI.agent.respondLearn(request.requestId, {
      approved,
      memory: approved ? memory : undefined,
      skillBody: approved && request.skill ? skillBody : undefined,
      skillName: approved && request.skill ? skillName : undefined,
      skillDescription: approved && request.skill ? skillDescription : undefined,
    });
    // 主进程 respondLearn 会广播 learn-closed 兜底清除；本地立即移除防广播延迟闪烁
    useLearnStore.getState().clearLearn(request.requestId);
  };

  const memoryValid = memory.trim().length > 0;
  // skill 正文为空会被后端拒绝（整体失败）——前端同步禁用确认
  const skillBodyValid = !request.skill || skillBody.trim().length > 0;

  return (
    <div
      className="rounded-[var(--radius-md)] shadow-lg animate-[card-in_160ms_ease-out] overflow-hidden"
      style={{
        background: "color-mix(in oklab, var(--color-surface-elevated) 65%, transparent)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
      }}
    >
      {/* 标题行 + ✕ 取消 */}
      <div className="flex items-center justify-between px-3.5 pt-2.5">
        <span className="text-[length:var(--text-2xs)] text-text-secondary font-medium">项目经验</span>
        <button
          type="button"
          onClick={() => respond(false)}
          title="取消（不入库）"
          className="w-5 h-5 flex items-center justify-center rounded-md text-text-secondary hover:text-danger hover:bg-surface-hover transition-colors"
        >
          <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
        </button>
      </div>

      {/* memory（可编辑） */}
      <div className="px-3.5 pt-1.5">
        <label className="text-[length:var(--text-2xs)] text-text-muted block mb-1">经验内容</label>
        <textarea
          className="em-input w-full px-2.5 py-1.5 text-xs bg-surface/50 resize-y min-h-36 leading-relaxed"
          value={memory}
          onChange={(e) => setMemory(e.target.value)}
        />
      </div>

      {/* context 区块已移除（UI 精简：不留说明文字） */}

      {/* skill 草稿（create：name/description/body 均可编辑——撞名可就地改名；update：按名定位，禁改） */}
      {request.skill && (
        <div className="px-3.5 pt-2">
          <span className="text-[length:var(--text-2xs)] text-text-muted">Skill</span>
          <label className="text-[length:var(--text-2xs)] text-text-muted block mb-1 mt-1">名称</label>
          <input
            className="em-input w-full px-2.5 py-1.5 text-xs bg-surface/50 font-mono"
            value={skillName}
            disabled={request.skill.action === "update"}
            placeholder="小写字母/数字/连字符"
            onChange={(e) => setSkillName(e.target.value)}
          />
          <label className="text-[length:var(--text-2xs)] text-text-muted block mb-1 mt-1.5">描述</label>
          <input
            className="em-input w-full px-2.5 py-1.5 text-xs bg-surface/50"
            value={skillDescription}
            placeholder="何时使用"
            onChange={(e) => setSkillDescription(e.target.value)}
          />
          <label className="text-[length:var(--text-2xs)] text-text-muted block mb-1 mt-1.5">正文</label>
          <textarea
            className="em-input w-full px-2.5 py-1.5 text-xs bg-surface/50 resize-y min-h-36 leading-relaxed"
            value={skillBody}
            onChange={(e) => setSkillBody(e.target.value)}
          />
        </div>
      )}

      {/* 底部操作 */}
      <div className="flex justify-end items-center gap-2 px-3.5 py-2.5">
        <button
          type="button"
          onClick={() => respond(false)}
          className="px-3 py-1 rounded-[8px] text-[length:var(--text-2xs)] font-medium text-text-secondary hover:text-text-primary hover:bg-surface-hover transition-colors"
        >
          取消
        </button>
        <button
          type="button"
          onClick={() => respond(true)}
          disabled={!memoryValid || !skillBodyValid}
          className={`px-3.5 py-1 rounded-[8px] text-[length:var(--text-2xs)] font-medium transition-all duration-150 ${
            memoryValid && skillBodyValid
              ? "btn-accent"
              : "bg-surface-hover text-text-muted cursor-not-allowed"
          }`}
        >
          {request.skill ? "确认入库" : "确认入库"}
        </button>
      </div>
    </div>
  );
}
