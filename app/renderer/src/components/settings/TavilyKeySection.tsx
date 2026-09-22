/**
 * 联网能力区块（引导流程「选择 AI 供应商」页用）。
 *
 * **字段与设置页完全同源**：两者都渲染 `WebCapabilityConfig`（一个 Tavily Key，共用一份存储）。
 * 这里只多一层卡片外壳与「可选」标识、并在未填写时多给一组免费额度胶囊。
 * 之所以独立成组件而不是塞进设置页那块：引导页的容器、间距与设置页列表行不是一套样式。
 *
 * ⚠️ 能力判据只看 key：`!!apiKeys.TAVILY_API_KEY`（见 api-clients.ts）。**没有开关**，
 * 填了即启用、清空即停用——这正是为了根除"填了 key 却没打开开关"的静默失效。
 */
import { WebCapabilityConfig } from "./WebCapabilityConfig";

export function TavilyKeySection(): JSX.Element {
  return (
    // em-flat-fields：本卡片是「无边框拼色」字段区（见 index.css），
    // 卡片里的输入框与设置页同语言——去描边、靠底色深浅分层。
    <div className="em-flat-fields mt-4 bg-surface-alt rounded-[var(--radius-lg)] p-4">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-text-primary">联网能力</span>
        <span className="text-[length:var(--text-2xs)] px-1.5 py-0.5 rounded-[var(--radius-lg)] bg-surface-hover text-text-muted">
          可选
        </span>
      </div>
      <p className="text-[length:var(--text-11)] text-text-secondary mt-0.5 mb-3">
        让 Mint 能联网搜索资料、读取网页内容；<span className="text-text-muted">不填写则两项都不可用</span>
      </p>
      <WebCapabilityConfig showQuotaHints />
    </div>
  );
}
