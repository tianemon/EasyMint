import { useRef } from 'react';
import type { PermissionMode } from '../../protocol/types';
import type { ModelCapabilities } from '../../protocol/types';
import type { AttachmentKind, DraftAttachment } from '../../core/attachments';
import type { ComposerControl } from '../../core/types';
import { THINKING_LABELS } from '../../core/thinking';
import { Glass } from './Glass';
import { Icon } from './icons';
import { t } from '../i18n';

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

/** 输入卡：全站唯一 liquid 玻璃（backdrop-filter 只此一处）。运行中且有内容=发送(steer)，仅运行中且空输入=打断。 */
export function Composer(props: ComposerProps): React.ReactElement {
  const {
    draft, attachments, running, compacting, hasSession, permission, permissionLabel, thinking,
    thinkingOptions, model, provider, contextPercent, control,
    onDraftChange, onControlChange, onSend, onStop, onSelectModel, onSelectPermission,
    onSelectThinking, onPickAttachments, onRemoveAttachment,
  } = props;
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const disabled = compacting;
  const hasText = draft.trim().length > 0;
  const isStop = running && !hasText;

  const toggle = (next: ComposerControl): void => onControlChange(control === next ? null : next);

  const submit = (): void => {
    if (disabled) return;
    if (isStop) onStop();
    else if (hasText || attachments.length) onSend();
  };

  return (
    <div className="composer-wrap">
      {control && (
        <div className="composer-menu">
          {control === 'attachment' && (
            <>
              <button type="button" onClick={() => { onPickAttachments('image'); onControlChange(null); }}>
                <Icon name="image" size={14} /> 图片
              </button>
              <button type="button" onClick={() => { onPickAttachments('doc'); onControlChange(null); }}>
                <Icon name="doc" size={14} /> 文档
              </button>
            </>
          )}
          {control === 'permission' && (['readonly', 'standard', 'full'] as PermissionMode[]).map((mode) => (
            <button key={mode} type="button" className={permission === mode ? 'is-selected' : ''}
              onClick={() => { onSelectPermission(mode); onControlChange(null); }}>
              {mode === 'readonly' ? '只读' : mode === 'full' ? '完全访问' : '标准'}
            </button>
          ))}
          {control === 'thinking' && thinkingOptions.map((level) => (
            <button key={level} type="button" className={thinking === level ? 'is-selected' : ''}
              onClick={() => { onSelectThinking(level); onControlChange(null); }}>
              {THINKING_LABELS[level] ?? level}
            </button>
          ))}
          {control === 'model' && (provider?.models ?? []).map((item) => (
            <button key={item.id} type="button" className={(model || provider?.currentModel) === item.id ? 'is-selected' : ''}
              onClick={() => { onSelectModel(item.id); onControlChange(null); }}>
              {item.name}
            </button>
          ))}
          {control === 'model' && !provider && <div className="composer-menu-empty">暂无可用模型</div>}
        </div>
      )}

      <Glass variant="liquid" className="composer">
        {attachments.length > 0 && (
          <div className="composer-attachments">
            {attachments.map((item) => (
              <div key={item.id} className="composer-attachment">
                {item.kind === 'image' && item.previewUrl
                  ? <img src={item.previewUrl} alt={item.name} />
                  : <Icon name="doc" size={14} />}
                <span className="composer-attachment-name">{item.name}</span>
                <button type="button" onClick={() => onRemoveAttachment(item.id)} aria-label="移除附件">
                  <Icon name="close" size={11} />
                </button>
              </div>
            ))}
          </div>
        )}
        <textarea
          ref={textareaRef}
          className="composer-input"
          value={draft}
          rows={1}
          placeholder={disabled ? t('ui.ChatPanel.compactingSession') : t('app.composerPlaceholder')}
          disabled={disabled}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              submit();
            }
          }}
        />
        <div className="composer-toolbar">
          <button type="button" className="composer-tool" onClick={() => toggle('attachment')} aria-label="添加附件">
            <Icon name="clip" size={19} />
          </button>
          <button type="button" className={`composer-tool${permission === 'full' ? ' is-danger' : ''}`}
            onClick={() => toggle('permission')} aria-label="权限">
            <Icon name="shield" size={18} />
          </button>
          <button type="button" className="composer-tool" onClick={() => toggle('model')} aria-label="模型">
            <Icon name="model" size={18} />
          </button>
          <button type="button" className="composer-tool" onClick={() => toggle('thinking')} aria-label="思考等级">
            <Icon name="think" size={18} />
          </button>
          <span className="composer-spacer" />
          {contextPercent !== null && <span className="composer-context">{Math.round(contextPercent)}%</span>}
          <button
            type="button"
            className={`composer-send${isStop ? ' is-stop' : ''}${(hasText || attachments.length || isStop) ? ' is-active' : ''}`}
            onClick={submit}
            disabled={disabled || (!hasText && attachments.length === 0 && !isStop)}
            aria-label={isStop ? '打断' : '发送'}
          >
            <Icon name={isStop ? 'stop' : 'send'} size={18} />
          </button>
        </div>
        {hasSession && (
          <div className="composer-meta">
            <span>{permissionLabel}</span>
            <span>·</span>
            <span>{THINKING_LABELS[thinking] ?? thinking}</span>
            {model && <><span>·</span><span className="composer-model">{model}</span></>}
          </div>
        )}
      </Glass>
    </div>
  );
}
