import { useEffect, useRef, useState } from 'react';
import type { PermissionMode } from '../../protocol/types';
import type { ModelCapabilities } from '../../protocol/types';
import type { AttachmentKind, DraftAttachment } from '../../core/attachments';
import type { ComposerControl } from '../../core/types';
import { THINKING_LABELS } from '../../core/thinking';
import { Glass } from './Glass';
import { detectPlatform } from '../../core/platform';
import { shouldSendOnEnter } from '../composer-keyboard';
import { AttachmentKindIcon, ComposerIcon, Icon, SendIcon, SpinIcon, iconSize } from './icons';

export type ComposerProps = {
  draft: string;
  attachments: DraftAttachment[];
  running: boolean;
  compacting: boolean;
  hasSession: boolean;
  permission: PermissionMode;
  permissionLabel: string;
  thinking: string;
  thinkingOptions: string[];
  model: string;
  provider: ModelCapabilities['providers'][number] | null;
  contextPercent: number | null;
  contextWindow: number | null;
  control: ComposerControl;
  onDraftChange: (value: string) => void;
  onControlChange: (control: ComposerControl) => void;
  onSend: () => void;
  onStop: () => void;
  onSelectModel: (modelId: string) => void;
  onSelectPermission: (mode: PermissionMode) => void;
  onSelectThinking: (level: string) => void;
  onPickAttachments: (kind: AttachmentKind) => void;
  onRemoveAttachment: (id: string) => void;
};

const PERMISSION_OPTIONS = [['readonly', '只读'], ['standard', '标准'], ['full', '完全访问']] as const;
const ATTACHMENT_OPTIONS = [['image', '图片'], ['doc', '文档']] as const;

// 上下文使用率环：与 App Composer 同一几何（20×20 / r=8 / stroke 2.5 / 12 点起画）
const RING_SIZE = 20;
const RING_R = 8;
const RING_STROKE = 2.5;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_R;

function formatTokenWindow(tokens: number): string {
  if (tokens >= 1_000_000) return `${Number((tokens / 1_000_000).toFixed(2))}M`;
  if (tokens % 1000 === 0) return `${tokens / 1000}K`;
  if (tokens % 1024 === 0) return `${tokens / 1024}K`;
  return `${Math.floor(tokens / 1000)}K`;
}

function contextTip(percent: number | null, windowTokens: number | null): string {
  if (windowTokens === null) return percent === null ? '上下文用量暂未上报' : `上下文使用率 ${Math.round(percent)}%`;
  const windowLabel = formatTokenWindow(windowTokens);
  return percent === null ? `上下文窗口 ${windowLabel} · 用量暂未上报` : `上下文窗口 ${windowLabel} · 已用 ${Math.round(percent)}%`;
}

/** 输入卡：多行输入 + 工具栏（权限/模型/思考/上下文圆环/发送）+ 卡内工具菜单。 */
export function Composer(props: ComposerProps): React.ReactElement {
  const {
    draft, attachments, running, compacting, hasSession, permission, thinking,
    thinkingOptions, model, provider, contextPercent, contextWindow, control,
    onDraftChange, onControlChange, onSend, onStop, onSelectModel, onSelectPermission,
    onSelectThinking, onPickAttachments, onRemoveAttachment,
  } = props;
  const [showContextTip, setShowContextTip] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const hasContent = draft.trim().length > 0 || attachments.length > 0;
  const showStop = !compacting && running && hasSession && !hasContent;
  const sendDisabled = compacting || (!showStop && !hasContent);
  const tipText = contextTip(contextPercent, contextWindow);
  const toggle = (next: ComposerControl): void => onControlChange(control === next ? null : next);

  // 自动增高：52 起步、130 封顶；草稿被清空（发送后）也能缩回去。
  useEffect(() => {
    const node = inputRef.current;
    if (!node) return;
    node.style.height = 'auto';
    node.style.height = `${Math.min(130, Math.max(52, node.scrollHeight))}px`;
  }, [draft]);

  const submit = (): void => {
    if (compacting) return;
    if (showStop) onStop();
    else if (hasContent) onSend();
  };

  return (
    <div className="composer-wrap">
      <div className="composer-card">
        <Glass variant="frosted" contour contourDark={0.38} contourLight={0.38} blur radius={24} elevated={false} className="composer-glass" />

        {attachments.length > 0 && (
          <div className="composer-attachments">
            {attachments.map((item) => (
              <div key={item.id} className="composer-attachment">
                {item.kind === 'image' && (item.previewUrl || item.data)
                  ? <img src={item.previewUrl ?? `data:${item.mimeType};base64,${item.data}`} alt={item.name} />
                  : <span className="composer-attachment-name">{item.name}</span>}
                <button type="button" className="composer-attachment-remove"
                  aria-label={`移除 ${item.name}`} onClick={() => onRemoveAttachment(item.id)}>
                  <Icon name="close" size={10} />
                </button>
              </div>
            ))}
          </div>
        )}

        <textarea
          ref={inputRef}
          className="composer-input"
          value={draft}
          rows={1}
          enterKeyHint="enter"
          placeholder={compacting ? '正在整理上下文，请稍候' : running ? '输入以引导当前任务…' : '给 EasyMint 发送消息…'}
          disabled={compacting}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={(event) => {
            if (shouldSendOnEnter({ key: event.key, shiftKey: event.shiftKey, isComposing: event.nativeEvent.isComposing, keyCode: event.nativeEvent.keyCode }, detectPlatform(navigator.userAgent, navigator.maxTouchPoints ?? 0))) {
              event.preventDefault();
              submit();
            }
          }}
        />

        <div className="composer-toolbar">
          <button type="button" className={`composer-tool${control === 'attachment' ? ' is-active' : ''}`}
            aria-label="添加附件" onClick={() => toggle('attachment')}>
            <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21.44 11.05 12.25 20.24a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
            </svg>
          </button>
          <span className="composer-spacer" />
          <button type="button"
            className={`composer-tool composer-tool-control${permission === 'full' ? ' is-danger' : ''}${control === 'permission' ? ' is-active' : ''}`}
            aria-label={`选择权限，当前 ${props.permissionLabel}`} onClick={() => toggle('permission')}>
            <ComposerIcon kind="permission" permission={permission} />
          </button>
          <button type="button"
            className={`composer-tool composer-tool-control${control === 'model' ? ' is-active' : ''}`}
            aria-label={`选择模型，当前 ${model || provider?.currentModel || '默认'}`} onClick={() => toggle('model')}>
            <ComposerIcon kind="model" />
          </button>
          <button type="button"
            className={`composer-tool composer-tool-control${control === 'thinking' ? ' is-active' : ''}`}
            aria-label={`选择思考等级，当前 ${THINKING_LABELS[thinking] ?? thinking}`} onClick={() => toggle('thinking')}>
            <ComposerIcon kind="thinking" />
          </button>
          <button type="button" className="composer-context" aria-label={tipText}
            onClick={() => setShowContextTip((value) => !value)}>
            <svg width={RING_SIZE} height={RING_SIZE} viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`} className="composer-context-ring">
              <circle cx={RING_SIZE / 2} cy={RING_SIZE / 2} r={RING_R} fill="none"
                stroke="rgba(185, 193, 191, .62)" strokeWidth={RING_STROKE} />
              <circle cx={RING_SIZE / 2} cy={RING_SIZE / 2} r={RING_R} fill="none"
                stroke="#16a34a" strokeWidth={RING_STROKE} strokeLinecap="round"
                strokeDasharray={RING_CIRCUMFERENCE}
                strokeDashoffset={contextPercent === null ? RING_CIRCUMFERENCE : RING_CIRCUMFERENCE * (1 - contextPercent / 100)} />
            </svg>
          </button>
          <button type="button" className={`composer-send${showStop ? ' is-stop' : ''}`}
            disabled={sendDisabled} aria-label={showStop ? '打断' : '发送'}
            onClick={() => (showStop ? onStop() : onSend())}>
            <SendIcon stop={showStop} />
          </button>
        </div>

        {showContextTip && <div className="context-tip"><span>{tipText}</span></div>}

        {control === 'attachment' && (
          <div className="composer-attachment-menu">
            {ATTACHMENT_OPTIONS.map(([kind, label]) => (
              <button key={kind} type="button" className="composer-attachment-option"
                onClick={() => { onControlChange(null); onPickAttachments(kind); }}>
                <AttachmentKindIcon kind={kind} />
                <span>{label}</span>
              </button>
            ))}
          </div>
        )}

        {control === 'model' && (
          <div className="composer-menu">
            <div className="composer-menu-title">{provider?.name ?? '当前供应商'}</div>
            {(provider?.models ?? []).map((item) => (
              <button key={item.id} type="button" className="composer-option"
                onClick={() => { onSelectModel(item.id); onControlChange(null); }}>
                <span>{item.name}</span>
                {model === item.id && <Icon name="check" size={iconSize.nav} className="composer-check" />}
              </button>
            ))}
          </div>
        )}

        {control === 'permission' && (
          <div className="composer-menu">
            {PERMISSION_OPTIONS.map(([value, label]) => (
              <button key={value} type="button" className="composer-option"
                onClick={() => { onSelectPermission(value); onControlChange(null); }}>
                <span>{label}</span>
                {permission === value && <Icon name="check" size={iconSize.nav} className="composer-check" />}
              </button>
            ))}
          </div>
        )}

        {control === 'thinking' && (
          <div className="composer-menu">
            {thinkingOptions.map((level) => (
              <button key={level} type="button" className="composer-option"
                onClick={() => { onSelectThinking(level); onControlChange(null); }}>
                <span>{THINKING_LABELS[level] ?? level}</span>
                {thinking === level && <Icon name="check" size={iconSize.nav} className="composer-check" />}
              </button>
            ))}
          </div>
        )}

        {compacting && (
          <div className="composer-compact-mask">
            <SpinIcon size={iconSize.card} className="composer-compact-spin" />
            <span>正在整理上下文，请稍候…</span>
          </div>
        )}
      </div>
    </div>
  );
}
