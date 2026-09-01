import { useEffect, useState } from "react";
import { useSettingsStore } from "../../stores/settings-store";
import { ProvidersManager } from "./ProviderSettings";
import { Select } from "../Select";

// ── Chat Thinking Level Section ───────────────────────────────────────────────

const CHAT_THINKING_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "off", label: "关闭" },
  { value: "minimal", label: "极低" },
  { value: "low", label: "轻度" },
  { value: "medium", label: "中" },
  { value: "high", label: "高" },
  { value: "xhigh", label: "极高" },
  { value: "max", label: "最高" },
];

/** 全局聊天思考等级:仅作为新聊天会话的初始默认,不控制 agent/task 委派 */
function ChatThinkingLevelSection(): JSX.Element {
  const chatThinkingLevel = useSettingsStore((s) => s.chatThinkingLevel);
  const setChatThinkingLevel = useSettingsStore((s) => s.setChatThinkingLevel);

  return (
    <section>
      <h3 className="text-sm font-medium text-text-primary mb-2">全局思考等级(聊天)</h3>
      <div className="bg-surface-alt rounded-lg border border-border px-4 py-3">
        <Select
          block
          value={chatThinkingLevel}
          onChange={setChatThinkingLevel}
          options={CHAT_THINKING_OPTIONS}
          title="全局思考等级"
        />
        <p className="text-[length:var(--text-2xs)] text-text-secondary mt-1.5">仅作为新聊天会话的初始默认值，也是标准委派子 Agent 的参考；Agent 模板以模板配置为准；模型不支持所选等级时自动适配到该模型最接近的支持档位，已打开的聊天可在输入栏临时切换。</p>
      </div>
    </section>
  );
}

// ── Built-in Tools Section ────────────────────────────────────────────────────

function BuiltinToolsSection(): JSX.Element {
  const [builtinTools, setBuiltinTools] = useState<Record<string, boolean>>({ vision: false, webFetch: false });
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({});
  const [showKey, setShowKey] = useState(false);

  useEffect(() => {
    (async () => {
      const s = await window.electronAPI.settings.get();
      setBuiltinTools(s.builtinTools ?? { vision: false, webFetch: false });
      setApiKeys(s.apiKeys ?? {});
    })();
  }, []);

  const handleToggle = async (name: string, on: boolean) => {
    const next = { ...builtinTools, [name]: on };
    setBuiltinTools(next);
    await window.electronAPI.settings.set("builtinTools", next);
  };

  const saveKey = async (key: string, value: string) => {
    const next = { ...apiKeys, [key]: value };
    setApiKeys(next);
    await window.electronAPI.settings.set("apiKeys", next);
  };

  return (
    <section>
      <h3 className="text-sm font-medium text-text-primary mb-2">模型能力增强</h3>
      <p className="text-[length:var(--text-11)] text-text-secondary mb-3">
        提供视觉识别与网页抓取能力（对非多模态模型），自动注入到每次会话
      </p>
      <div className="space-y-2">
        {([
          { key: "vision", label: "图片识别", desc: "用视觉模型描述图片内容", keyId: "VISION_API_KEY", keyUrl: "https://bailian.console.aliyun.com/cn-beijing?tab=model#/api-key" },
          { key: "webFetch", label: "网页抓取", desc: "读取网页实际内容", keyId: "TAVILY_API_KEY", keyUrl: "https://docs.tavily.com/documentation/mcp" },
        ] as const).map(({ key, label, desc, keyId, keyUrl }) => {
          const on = builtinTools[key];
          return (
          <div key={key} className="bg-surface-alt rounded-lg px-4 py-3">
            <div className="flex items-center justify-between">
              <div className="flex-1 min-w-0 mr-3">
                <div className="text-xs font-medium text-text-primary">{label}</div>
                <div className="text-[length:var(--text-2xs)] text-text-muted mt-0.5">{desc}</div>
              </div>
              <button type="button" onClick={() => handleToggle(key, !on)}
                className={`w-9 h-5 rounded-full transition-colors relative shrink-0 ${on ? "bg-accent" : "bg-border"}`}>
                <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${on ? "left-4" : "left-0.5"}`} />
              </button>
            </div>
            {on && (
              <div className="mt-2">
                {key === "vision" && (() => {
                  const isAnthropic = apiKeys["VISION_MODE"] === "anthropic";
                  return (
                  <div className="mb-2">
                    <label className="text-[length:var(--text-2xs)] text-text-secondary block mb-1">API 模式</label>
                    <div className="flex gap-4 text-xs text-text-primary">
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input type="radio" name="vision-mode" className="accent-[var(--color-accent)]"
                          checked={!isAnthropic}
                          onChange={() => saveKey("VISION_MODE", "openai")} />
                        OpenAI 兼容
                      </label>
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input type="radio" name="vision-mode" className="accent-[var(--color-accent)]"
                          checked={isAnthropic}
                          onChange={() => saveKey("VISION_MODE", "anthropic")} />
                        Anthropic 兼容
                      </label>
                    </div>
                    <label className="text-[length:var(--text-2xs)] text-text-secondary block mb-1 mt-2">
                      {isAnthropic
                        ? "API 地址（Anthropic 兼容，默认阿里公共DashScope，可填写带有业务空间ID的专属API）"
                        : "API 地址（OpenAI 兼容，默认阿里公共DashScope，可填写带有业务空间ID的专属API）"}
                    </label>
                    <input type="text"
                      className="em-input w-full px-2 py-1.5 text-text-primary text-xs"
                      defaultValue={apiKeys["VISION_BASE_URL"] || ""}
                      placeholder={isAnthropic ? "https://dashscope.aliyuncs.com/apps/anthropic" : "https://dashscope.aliyuncs.com/compatible-mode/v1"}
                      onBlur={(e) => { const v = e.target.value.trim(); if (v !== (apiKeys["VISION_BASE_URL"] || "")) saveKey("VISION_BASE_URL", v); }}
                      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                    />
                  </div>
                  );
                })()}
                <label className="text-[length:var(--text-2xs)] text-text-secondary block mb-1">{keyId}</label>
                <div className="relative">
                  <input type={showKey ? "text" : "password"}
                    className="em-input w-full px-2 py-1.5 pr-7 text-text-primary text-xs"
                    defaultValue={apiKeys[keyId] || ""} placeholder="未设置"
                    onBlur={(e) => { const v = e.target.value.trim(); if (v !== (apiKeys[keyId] || "")) saveKey(keyId, v); }}
                    onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                  />
                  <button type="button" className="absolute right-1.5 top-1/2 -translate-y-1/2 text-text-secondary hover:text-text-primary transition-colors"
                    onClick={() => setShowKey(!showKey)}>
                    {showKey ? (
                      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                    ) : (
                      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                    )}
                  </button>
                </div>
                {key === "vision" && (
                  <div className="mt-2">
                    <label className="text-[length:var(--text-2xs)] text-text-secondary block mb-1">模型（默认 qwen3.7-flash）</label>
                    <input type="text"
                      className="em-input w-full px-2 py-1.5 text-text-primary text-xs"
                      defaultValue={apiKeys["VISION_MODEL"] || ""} placeholder="qwen3.7-flash"
                      onBlur={(e) => { const v = e.target.value.trim(); if (v !== (apiKeys["VISION_MODEL"] || "")) saveKey("VISION_MODEL", v); }}
                      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                    />
                  </div>
                )}
                <div className="text-[length:var(--text-2xs)] text-text-muted mt-1">
                  获取 Key：<a href={keyUrl} target="_blank" rel="noreferrer" className="text-accent hover:underline break-all">{keyUrl}</a>
                </div>
              </div>
            )}
          </div>
          );
        })}
      </div>
    </section>
  );
}

/** 模型设置:供应商管理 + 全局思考等级 + 模型能力增强 */
export function ProvidersTab(): JSX.Element {
  return (
    <div className="space-y-5">
      <ProvidersManager />
      <hr className="border-border" />
      <ChatThinkingLevelSection />
      <hr className="border-border" />
      <BuiltinToolsSection />
    </div>
  );
}
