/**
 * 联网能力配置体（**引导页与设置页共用同一份**）。
 *
 * 三个决定，都是踩过坑后收下来的：
 * 1. **一个 Key**：搜索与抓取用的是同一个 Tavily Key（能力判据见 `api-clients.ts`）。曾拆成两行，
 *    结果同一个 key 出现两个输入框（写同一处存储），用户不知道该填哪个。
 * 2. **没有开关**：用户 2026-09-15 拍板「填写了 key 就默认开启」。此前是"开关 on + key 非空"两个条件，
 *    于是存在"填了 key 却没开开关"的**静默失效**——界面上看不出差别，模型那边工具就是不出现。
 *    现在判据只剩 key 本身：**填写即启用，清空即关闭**。
 * 3. **两处同源**：引导页与设置页渲染同一个组件，不再出现"换个地方就换套字段"。
 */
import { useEffect, useRef, useState } from "react";

export const TAVILY_KEY_URL = "https://app.tavily.com/home";

/**
 * 免费额度的四项（`是什么 → 多少`），最后一条是"够用多少"——那才是用户真正会算的。
 *
 * 排版：四项并排、**共用一块底色**（2026-09-22 用户：别各自一个胶囊，看着零碎），
 * 数字给强调色，一眼扫完且不压高度——引导页那一列很窄，写成句子会把表单顶下去。
 *
 * 数字来源：Tavily 官方 Credits & Pricing（Free 1000 credits/月、basic search 1 credit/次、
 * basic extract 每 5 次成功抓取 1 credit），本应用两处调用都走 basic 档（见 api-clients.ts 的
 * search_depth / extract_depth）。**改动调用档位或 Tavily 改价时，这几条要同步改。**
 */
export const TAVILY_QUOTA: ReadonlyArray<{ label: string; value: string; highlight?: boolean }> = [
  { label: "每月免费", value: "1000 积分" },
  { label: "搜索", value: "1 积分/次" },
  { label: "抓取", value: "每 5 次 1 积分" },
  // 最后一条是"够用多少"——用户真正会算的那个数，用强调色单独挑出来（不再单独铺底；色阶同 GlowGroupManager 的选中态）
  { label: "够用", value: "约 1000 次搜索/月", highlight: true },
];

/** 与最后一次成功持久化的值比较，不能与输入框的实时 state 比较。 */
export function shouldPersistTavilyKey(raw: string, loaded: boolean, persisted: string): boolean {
  return loaded && raw.trim() !== persisted;
}

export interface WebCapabilityConfigProps {
  /** 未填写 key 时是否展示免费额度提示块（引导页展示；设置页已有完整说明，不重复占高） */
  showQuotaHints?: boolean;
}

/**
 * 联网能力的全部配置项：**一个 Tavily Key**。填了就能用，清了就停用。
 * 存储与合并约定见文件头。
 */
export function WebCapabilityConfig({ showQuotaHints = false }: WebCapabilityConfigProps): JSX.Element {
  const [value, setValue] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [show, setShow] = useState(false);
  const persistedValue = useRef("");

  useEffect(() => {
    void (async () => {
      const s = await window.electronAPI.settings.get();
      const saved = s.apiKeys?.TAVILY_API_KEY ?? "";
      persistedValue.current = saved;
      setValue(saved);
      setLoaded(true);
    })();
  }, []);

  const save = async (raw: string): Promise<void> => {
    const v = raw.trim();
    if (!shouldPersistTavilyKey(v, loaded, persistedValue.current)) return;
    // 以主进程配置为基底（组件态可能是空的，整体覆盖会清掉其他 key）
    const s = await window.electronAPI.settings.get();
    setValue(v);
    await window.electronAPI.settings.set("apiKeys", { ...(s.apiKeys ?? {}), TAVILY_API_KEY: v });
    persistedValue.current = v;
  };

  // 获取说明：压到一行（此前那句把 URL 整串印出来、还带一句设置路径，在窄栏里要占两行）。
  // 抽成一份共用片段——与额度数字共块时并进块内，设置页里仍作为独立一行纯文字。
  const hintLine = (
    <p className="text-[length:var(--text-2xs)] text-text-muted">
      在{" "}
      <a href={TAVILY_KEY_URL} target="_blank" rel="noreferrer" className="text-accent hover:underline">
        app.tavily.com
      </a>{" "}
      的「API Keys」创建一个，粘贴到上方即启用
    </p>
  );

  return (
    <div className="space-y-2">
      <div>
        <label className="text-[length:var(--text-2xs)] text-text-secondary block mb-1">Tavily API Key</label>
        <div className="relative">
          <input
            type={show ? "text" : "password"}
            className="em-input w-full px-2 py-1.5 pr-7 text-text-primary text-xs"
            placeholder="tvly-..."
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onBlur={(e) => void save(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
          />
          <button
            type="button"
            className="absolute right-1.5 top-1/2 -translate-y-1/2 text-text-secondary hover:text-text-primary transition-colors"
            onClick={() => setShow(!show)}
            aria-label={show ? "隐藏 Key" : "显示 Key"}
          >
            {show ? (
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
            ) : (
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
            )}
          </button>
        </div>
      </div>

      {value.trim() ? (
        <p className="text-[length:var(--text-2xs)] text-text-muted">已启用联网搜索与网页抓取；清空此处即停用</p>
      ) : showQuotaHints ? (
        /* 说明行与额度数字**同处一块底色**（2026-09-22 用户：说明书那行也并进来）。
           容器给底色、内边距与行距，块内只留文字——不让说明行单独浮在块外。
           设置页不展示额度（showQuotaHints=false），那里走下面那个分支：仍是纯文字、不额外铺底。 */
        <div className="rounded-[var(--radius-lg)] bg-surface-hover px-2.5 py-1.5 space-y-1.5">
          {hintLine}
          {/* 额度数字的来源与同步约定见 TAVILY_QUOTA 上方注释。
              「够用」那条仍用强调色——它是用户真正会算的结论，但不再单独铺底。 */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {TAVILY_QUOTA.map((q) => (
              <span key={q.label} className="inline-flex items-baseline gap-1 whitespace-nowrap">
                <span className={`text-[length:var(--text-2xs)] ${q.highlight ? "text-accent" : "text-text-muted"}`}>
                  {q.label}
                </span>
                <span
                  className={`text-[length:var(--text-2xs)] font-medium ${
                    q.highlight ? "text-accent" : "text-text-primary"
                  }`}
                >
                  {q.value}
                </span>
              </span>
            ))}
          </div>
        </div>
      ) : (
        hintLine
      )}
    </div>
  );
}
