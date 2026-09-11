import { useCallback, useEffect, useRef, useState } from "react";
import { Modal } from "../ui/Modal";
import { toast } from "../ui/Toast";
import type { ProviderAuthPromptOption, ProviderAuthUiEvent } from "@shared/provider-auth";

/**
 * 供应商账号登录（OAuth）授权弹窗。
 *
 * SDK 的 AuthEvent 带英文原文，主进程只转发结构化事件、界面按 kind 自写中文文案；
 * 因此这里不展示 SDK 的任何 message/instructions。
 */

type PromptKind = "text" | "secret" | "select" | "manual_code";

interface PendingStep {
  promptType: PromptKind;
  placeholder?: string;
  options?: ProviderAuthPromptOption[];
}

type Phase =
  | { kind: "starting" }
  | { kind: "browser"; url: string }
  | { kind: "device"; userCode: string; verificationUri: string; intervalSeconds?: number; expiresInSeconds?: number }
  | { kind: "success" }
  | { kind: "error"; reason: string; detail?: string };

interface OAuthLoginDialogProps {
  providerId: string;
  providerLabel: string;
  /** 卸载弹窗（取消 / 关闭 / 成功后自动关）；宿主在这里重查账号状态 */
  onClose: () => void;
}

function newRequestId(): string {
  // 渲染层生成：主进程按它把事件与输入配对，弹窗一打开就能收事件（不用等握手往返）
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function promptTitle(kind: PromptKind): string {
  switch (kind) {
    case "manual_code": return "粘贴授权码";
    case "select": return "请选择";
    case "secret": return "请填写密钥";
    default: return "请填写";
  }
}

/** 失败原因：常见情形给中文结论，其余保留原文作细节（排查用） */
function failureReason(raw: string | undefined): { reason: string; detail?: string } {
  const msg = raw ?? "";
  if (/abort|cancel/i.test(msg)) return { reason: "登录已取消" };
  if (/timeout|timed out|expire/i.test(msg)) return { reason: "授权已超时，请重试" };
  if (/fetch failed|ENOTFOUND|ECONN|EAI_AGAIN|network/i.test(msg)) return { reason: "网络连接失败，请检查网络后重试" };
  if (/invalid_grant|\b401\b|\b403\b/.test(msg)) return { reason: "授权被拒绝，请重新登录" };
  return { reason: "登录失败", detail: msg };
}

function Spinner(): JSX.Element {
  return (
    <svg className="w-3.5 h-3.5 shrink-0 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 12a9 9 0 11-6.219-8.56" />
    </svg>
  );
}

export function OAuthLoginDialog({ providerId, providerLabel, onClose }: OAuthLoginDialogProps): JSX.Element {
  const [requestId, setRequestId] = useState(newRequestId);
  const [phase, setPhase] = useState<Phase>({ kind: "starting" });
  const [step, setStep] = useState<PendingStep | null>(null);
  const [input, setInput] = useState("");
  const [waiting, setWaiting] = useState(false);
  // 流程是否在途：卸载时据此决定要不要中止主进程侧登录
  const runningRef = useRef(false);
  // effect 轮次：区分「StrictMode 挂载期重跑」与真正的卸载（见下面的延迟中止）
  const effectRoundRef = useRef(0);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const applyEvent = useCallback((ev: ProviderAuthUiEvent) => {
    switch (ev.kind) {
      case "browser":
        setPhase({ kind: "browser", url: ev.url });
        break;
      case "device_code":
        setPhase({
          kind: "device",
          userCode: ev.userCode,
          verificationUri: ev.verificationUri,
          intervalSeconds: ev.intervalSeconds,
          expiresInSeconds: ev.expiresInSeconds,
        });
        setWaiting(true);
        break;
      case "prompt":
        setStep({ promptType: ev.promptType, placeholder: ev.placeholder, options: ev.options });
        setInput("");
        break;
      case "progress":
        setWaiting(true);
        break;
    }
  }, []);

  useEffect(() => {
    return window.electronAPI.provider.onAuthEvent((msg) => {
      if (msg.requestId !== requestId) return;
      applyEvent(msg.event);
    });
  }, [requestId, applyEvent]);

  useEffect(() => {
    const round = ++effectRoundRef.current;
    let alive = true;
    let closeTimer: number | undefined;
    setPhase({ kind: "starting" });
    setStep(null);
    setInput("");
    setWaiting(false);
    runningRef.current = true;

    window.electronAPI.provider
      .authLogin(providerId, requestId)
      .then((r) => {
        if (!alive) return;
        runningRef.current = false;
        if (r.ok) {
          setPhase({ kind: "success" });
          closeTimer = window.setTimeout(() => onCloseRef.current(), 1000);
          return;
        }
        // 取消是用户主动动作，界面已在卸载，不切失败态
        if (r.canceled) return;
        const { reason, detail } = failureReason(r.error);
        setPhase({ kind: "error", reason, detail });
      })
      .catch((e: unknown) => {
        if (!alive) return;
        runningRef.current = false;
        setPhase({ kind: "error", reason: "登录失败", detail: e instanceof Error ? e.message : String(e) });
      });

    return () => {
      alive = false;
      if (closeTimer) window.clearTimeout(closeTimer);
      // 中止延后一拍：StrictMode 挂载期会跑 setup → cleanup → setup，立刻中止会把刚发起
      // 的登录掐掉（第二次 setup 只剩失败路径）；effect 真的重跑了就跳过本次中止。
      // 真卸载时这一拍不影响体验，关弹窗后中停止于下一个宏任务。
      window.setTimeout(() => {
        if (effectRoundRef.current !== round) return;
        // 留着不中止会在后台继续轮询、占着回调端口
        if (runningRef.current) void window.electronAPI.provider.authCancel(requestId);
      }, 0);
    };
  }, [providerId, requestId]);

  // 关弹窗只负责卸载，中止统一交给 effect 的清理（避免两处各自取消）
  const dismiss = useCallback(() => onCloseRef.current(), []);

  const submit = useCallback(
    (value: string) => {
      const v = value.trim();
      if (!v) {
        toast("请先填写内容");
        return;
      }
      void window.electronAPI.provider.authInput(requestId, v).then((accepted) => {
        // 没被接受说明该步骤已结束（回调服务抢先拿到授权码）——收起输入框等流程结算
        if (!accepted) console.warn("[OAuthLoginDialog] 该输入步骤已结束，忽略本次提交");
        setStep(null);
      }).catch((e: unknown) => {
        console.error("[OAuthLoginDialog] 提交输入失败:", e);
      });
    },
    [requestId],
  );

  const openUrl = useCallback((url: string) => {
    void window.electronAPI.provider.openAuthUrl(url).then((ok) => {
      if (!ok) toast("无法打开浏览器，请复制链接手动访问");
    }).catch((e: unknown) => {
      console.error("[OAuthLoginDialog] 打开授权页失败:", e);
      toast("无法打开浏览器，请复制链接手动访问");
    });
  }, []);

  const copyUrl = useCallback((url: string) => {
    void navigator.clipboard.writeText(url).then(
      () => toast("已复制授权链接"),
      (e: unknown) => {
        console.error("[OAuthLoginDialog] 复制授权链接失败:", e);
        toast("复制失败，请手动选中链接复制");
      },
    );
  }, []);

  const stepForm = step && (
    <div className="mt-3">
      <label className="text-xs text-text-secondary block mb-1.5">{promptTitle(step.promptType)}</label>
      {step.promptType === "select" && step.options && step.options.length > 0 ? (
        <div className="space-y-1.5">
          {step.options.map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => submit(o.id)}
              className="w-full text-left px-3 py-2 rounded-[var(--radius-lg)] bg-surface-alt em-hover-control text-xs text-text-primary transition-colors"
            >
              <span className="block">{o.label}</span>
              {o.description && <span className="block text-[length:var(--text-2xs)] text-text-secondary mt-0.5">{o.description}</span>}
            </button>
          ))}
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <input
            autoFocus
            type={step.promptType === "secret" ? "password" : "text"}
            className="em-input em-input-compact flex-1 min-w-0 h-8 px-2.5 text-xs text-text-primary"
            placeholder={step.placeholder ?? ""}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submit(input); }}
          />
          <button type="button" onClick={() => submit(input)} className="shrink-0 h-8 px-4 rounded-[var(--radius-lg)] btn-accent text-xs font-medium">完成</button>
        </div>
      )}
      {step.promptType === "manual_code" && (
        <p className="text-[length:var(--text-2xs)] text-text-secondary mt-1.5">授权后浏览器地址栏的内容整段粘贴即可。</p>
      )}
    </div>
  );

  return (
    <Modal tier="modal" overlayClassName="bg-black/40 backdrop-blur-sm" onClose={dismiss}>
      <div className="bg-[var(--modal-fill)] rounded-[var(--radius-lg)] shadow-2xl flex flex-col overflow-hidden" style={{ width: 420 }}>
        <div className="px-5 pt-4 pb-3">
          <div className="text-sm font-medium text-text-primary">登录 {providerLabel}</div>
        </div>

        <div className="px-5 pb-4">
          {phase.kind === "starting" && (
            <div className="flex items-center gap-2 text-xs text-text-secondary">
              <Spinner />
              正在发起授权…
            </div>
          )}

          {phase.kind === "browser" && (
            <div className="bg-surface-alt rounded-[var(--radius-lg)] p-3">
              <p className="text-xs text-text-primary">已在浏览器打开授权页</p>
              <p className="text-[length:var(--text-2xs)] text-text-secondary mt-1">未打开可点「重新打开」，或复制链接手动访问。</p>
              <div className="flex gap-2 mt-2">
                <button type="button" onClick={() => openUrl(phase.url)}
                  className="h-7 px-3 rounded-[var(--radius-lg)] bg-surface text-text-primary text-xs em-hover-control transition-colors">重新打开</button>
                <button type="button" onClick={() => copyUrl(phase.url)}
                  className="h-7 px-3 rounded-[var(--radius-lg)] bg-surface text-text-secondary text-xs em-hover-control transition-colors">复制链接</button>
              </div>
            </div>
          )}

          {phase.kind === "device" && (
            <div className="bg-surface-alt rounded-[var(--radius-lg)] p-3">
              <p className="text-xs text-text-primary">在浏览器中打开授权页并输入设备码</p>
              <div className="mt-2 font-mono text-lg tracking-[0.2em] text-text-primary select-all">{phase.userCode}</div>
              <div className="flex items-center gap-2 mt-2">
                <button type="button" onClick={() => openUrl(phase.verificationUri)}
                  className="h-7 px-3 rounded-[var(--radius-lg)] bg-surface text-text-primary text-xs em-hover-control transition-colors">打开授权页</button>
                <button type="button" onClick={() => copyUrl(phase.userCode)}
                  className="h-7 px-3 rounded-[var(--radius-lg)] bg-surface text-text-secondary text-xs em-hover-control transition-colors">复制设备码</button>
              </div>
              {phase.expiresInSeconds !== undefined && (
                <p className="text-[length:var(--text-2xs)] text-text-secondary mt-1.5">设备码 {Math.max(1, Math.round(phase.expiresInSeconds / 60))} 分钟内有效</p>
              )}
            </div>
          )}

          {phase.kind === "success" && <p className="text-xs text-success">登录成功</p>}

          {phase.kind === "error" && (
            <div>
              <p className="text-xs text-danger">{phase.reason}</p>
              {phase.detail && <p className="text-[length:var(--text-2xs)] text-text-muted mt-1 break-all">{phase.detail}</p>}
            </div>
          )}

          {stepForm}

          {(phase.kind === "browser" || phase.kind === "device") && waiting && (
            <div className="flex items-center gap-2 text-[length:var(--text-2xs)] text-text-secondary mt-3">
              <Spinner />
              等待授权完成…
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 pb-3">
          {phase.kind === "error" ? (
            <>
              <button type="button" onClick={dismiss}
                className="h-8 px-4 rounded-[var(--radius-lg)] text-text-secondary text-xs hover:bg-surface-hover transition-colors">取消</button>
              <button type="button" onClick={() => setRequestId(newRequestId())}
                className="h-8 px-4 rounded-[var(--radius-lg)] btn-accent text-xs font-medium">重试</button>
            </>
          ) : (
            <button type="button" onClick={dismiss} disabled={phase.kind === "success"}
              className="h-8 px-4 rounded-[var(--radius-lg)] text-text-secondary text-xs hover:bg-surface-hover transition-colors disabled:opacity-40">取消</button>
          )}
        </div>
      </div>
    </Modal>
  );
}
