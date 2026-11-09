import { appText, uiText, useUiLocale } from "../../lib/i18n";
import { useCallback, useEffect, useState } from "react";
import { Modal } from "../ui/Modal";

type Pending = Awaited<ReturnType<typeof window.electronAPI.mobileTerminal.listPending>>[number];

/**
 * 手机配对请求：窗口正中的确认弹窗。
 *
 * 为什么不是面板里的内联卡片：手机扫码那一刻，用户的眼睛在**手机上**，回到电脑只为点一下。
 * 请求内联在「连接手机」面板里，就意味着要先找到面板、再滚到那一块；配对请求只有 90 秒寿命，
 * 面板被关掉或滚出视口时它等于不存在。弹窗是窗口级的，哪怕面板关着也能直接确认。
 *
 * 6 位验证码保留：二维码里只有 10 位短码，公钥是手机再去 `GET /pair/<code>.json` 取的，
 * 这趟 HTTP 明文响应可被同网段替换（ARP 欺骗）。两边各自用 ECDH 密钥算出的这串数字对不上，
 * 就是唯一能被人眼发现的信号。
 *
 * 弹窗不响应遮罩点击（overlayClose=false）：配对是安全动作，误触关闭应等价于拒绝，
 * 而不是「什么都没发生」让人以为还能再点一次——真拒绝要按「拒绝」。
 */
export function MobilePairRequestModal(): JSX.Element | null {
  useUiLocale();
  const [pending, setPending] = useState<Pending[]>([]);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async (): Promise<void> => {
    try {
      setPending(await window.electronAPI.mobileTerminal.listPending());
    } catch {
      // 主进程暂时不可用：保留上一次结果，不要把用户已经在看的验证码抹掉
    }
  }, []);

  useEffect(() => {
    void load();
    const offChanged = window.electronAPI.mobileTerminal.onChanged(() => void load());
    const offRequest = window.electronAPI.mobileTerminal.onPairRequest(() => void load());
    return () => { offChanged(); offRequest(); };
  }, [load]);

  // 只有存在请求时才走秒：既显示剩余时间，也能在主进程尚未回收时把过期项从视图里摘掉
  useEffect(() => {
    if (pending.length === 0) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [pending.length]);

  const live = pending.filter((item) => item.expiresAt > now);
  if (live.length === 0) return null;
  const current = live[0]!;
  const secondsLeft = Math.max(0, Math.ceil((current.expiresAt - now) / 1000));

  const finish = async (accept: boolean): Promise<void> => {
    setBusy(true);
    setError("");
    try {
      const result = accept
        ? await window.electronAPI.mobileTerminal.acceptPair(current.requestId)
        : await window.electronAPI.mobileTerminal.rejectPair(current.requestId);
      if (!result.ok) setError(uiText("ui.MobileWebTab.expired"));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e ?? ""));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal tier="dialog" overlayClassName="bg-black/40 modal-overlay" overlayClose={false}
      onClose={() => void finish(false)}>
      <div className="bg-[var(--modal-fill)] rounded-[var(--radius-lg)] shadow-2xl modal-card overflow-hidden" style={{ width: 380 }}>
        <div className="px-6 pt-5 pb-2 bg-[var(--color-surface-alt)]">
          <h2 className="text-base font-semibold text-text-primary">{uiText("ui.MobileWebTab.pairRequestTitle")}</h2>
        </div>

        <div className="px-6 py-4">
          <div className="flex items-center gap-3">
            <span className="w-10 h-10 rounded-[var(--radius-lg)] bg-accent-soft text-accent flex items-center justify-center shrink-0">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
                strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="6" y="2" width="12" height="20" rx="2.5" />
                <line x1="10.5" y1="18.5" x2="13.5" y2="18.5" />
              </svg>
            </span>
            <div className="min-w-0">
              <div className="text-sm font-medium text-text-primary truncate">{current.deviceName}</div>
              <div className="text-xs text-text-secondary mt-0.5">{uiText("ui.MobileWebTab.wantsToConnect")}</div>
            </div>
          </div>

          {/* 验证码是这条弹窗的主角：字号、字距都拉到能隔一屏读出来 */}
          <div className="font-mono text-2xl tracking-[0.3em] text-accent text-center mt-5 mb-2 select-text">
            {current.verificationCode}
          </div>
          <div className="text-xs text-text-secondary text-center leading-relaxed">{uiText("ui.MobileWebTab.pendingHint")}</div>
          <div className="text-[length:var(--text-2xs)] text-text-muted text-center mt-1.5">
            {uiText("ui.MobileWebTab.pendingExpires", { v0: secondsLeft })}
          </div>
          {live.length > 1 && (
            <div className="text-[length:var(--text-2xs)] text-text-muted text-center mt-1">
              {uiText("ui.MobileWebTab.pairRequestMore", { v0: live.length - 1 })}
            </div>
          )}
          {error && <div className="text-[length:var(--text-11)] text-danger text-center mt-2">{appText(error)}</div>}
        </div>

        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-border">
          <button type="button" disabled={busy}
            className="px-4 py-1.5 rounded-[var(--radius-lg)] text-text-secondary hover:bg-surface-hover transition-colors text-sm"
            onClick={() => void finish(false)}>
            {uiText("ui.MobileWebTab.reject")}
          </button>
          <button type="button" disabled={busy}
            className="px-5 py-1.5 rounded-[var(--radius-lg)] btn-accent text-sm font-medium"
            onClick={() => void finish(true)}>
            {uiText("ui.MobileWebTab.confirm")}
          </button>
        </div>
      </div>
    </Modal>
  );
}
