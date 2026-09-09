import { useEffect, useState } from "react";
import type { ProviderTestResult } from "@shared/provider-test";
import { toast } from "../ui/Toast";
import { Checkbox } from "../ui/Checkbox";

/**
 * 供应商「测试接口」自检面板 —— 供应商表单里的连通自检块。
 *
 * 探测语义与文案的唯一来源是主进程 services/provider-test.ts：
 * 地址可达（连通，0 token）→ 可选 Key 校验（约 10 token）。
 * 2026-09-09 起不做模型列表测试（各家模型列表接口不同），也不推断「支持协议」。
 * 401/403 一律表述为「认证被拒绝」，不断言 Key 无效（第三方网关/WAF 也会返回 401/403）。
 */

interface Props {
  baseUrl: string;
  apiKey: string;
  model: string;
  apiType: string;
}

export function ProviderTester({ baseUrl, apiKey, model, apiType }: Props): JSX.Element {
  const [verifyKey, setVerifyKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<ProviderTestResult | null>(null);
  const [error, setError] = useState("");
  // 入参变了就丢弃旧结果：否则改完 Base URL 还挂着上一次的 ✓，会误导
  useEffect(() => { setResult(null); setError(""); }, [baseUrl, apiKey, model, apiType, verifyKey]);

  const run = async () => {
    if (!baseUrl.trim()) { toast("请先填写 Base URL"); return; }
    // 不拦空 Key：地址可达与模型列表不需要 Key（空 Bearer → 401 → 显示「认证被拒绝」）
    setTesting(true);
    setError("");
    setResult(null);
    try {
      setResult(await window.electronAPI.settings.testProvider({
        baseUrl: baseUrl.trim(),
        apiKey,
        model: model.trim() || undefined,
        apiType,
        verifyKey,
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="rounded-lg border border-border bg-surface-alt px-3 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <label className="flex items-center gap-1.5 text-xs text-text-secondary cursor-pointer"
          onClick={() => setVerifyKey(!verifyKey)}>
          <Checkbox checked={verifyKey} onChange={setVerifyKey} />
          验证密钥（发送最小请求，约消耗 10 个 token）
        </label>
        <button type="button" onClick={run} disabled={testing || (verifyKey && !model.trim())}
          className="h-8 px-3 shrink-0 rounded-lg border border-border text-text-secondary text-xs hover:bg-surface-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
          {testing ? "测试中…" : "测试接口"}
        </button>
      </div>

      {verifyKey && !model.trim() && (
        <p className="text-[length:var(--text-2xs)] text-warning mt-1.5">需先填写模型 id 才能校验密钥</p>
      )}
      {error && <p className="text-[length:var(--text-2xs)] text-danger mt-1.5">{error}</p>}
      {result && <Checklist result={result} />}
    </div>
  );
}

function Checklist({ result }: { result: ProviderTestResult }): JSX.Element {
  return (
    <div className="mt-2.5 space-y-1">
      <Row status={result.reachability.ok ? "ok" : "fail"} label="连通" detail={result.reachability.detail} />
      {result.keyCheck && (
        <Row status={result.keyCheck.ok ? "ok" : "fail"} label="Key 校验" detail={result.keyCheck.detail} />
      )}
    </div>
  );
}

const ICONS = {
  ok: <svg className="w-3.5 h-3.5 text-success" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>,
  fail: <svg className="w-3.5 h-3.5 text-danger" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>,
  info: <svg className="w-3.5 h-3.5 text-text-muted" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4" fill="currentColor" /></svg>,
} as const;

function Row({ status, label, detail }: { status: keyof typeof ICONS; label: string; detail: string }): JSX.Element {
  return (
    <div className="flex items-start gap-2">
      <span className="shrink-0 pt-[1px]">{ICONS[status]}</span>
      <span className="w-14 shrink-0 text-[length:var(--text-2xs)] text-text-secondary">{label}</span>
      <span className="flex-1 min-w-0 text-[length:var(--text-2xs)] text-text-primary break-words">{detail}</span>
    </div>
  );
}
