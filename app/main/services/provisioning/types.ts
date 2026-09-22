/**
 * 环境自检与依赖安装：类型定义。
 *
 * 设计约束：
 * - 探测必须**三态**（ok / missing / unknown），绝不把「探测失败」报成「未安装」——
 *   这条来自 codegraph-detector 的教训（同一误报潜伏 v0.6.6→v0.23.1）。
 * - 安装只走**白名单**：渲染层只能传 EnvItemId，命令由 plan.ts 按发行版生成。
 */

/** 环境条目标识。新增项必须同时更新 plan.ts 的白名单（否则自动安装会拒绝） */
export type EnvItemId = "bwrap" | "socat" | "rg" | "userns" | "winSandbox" | "gitBash";

export type EnvItemStatus = "ok" | "missing" | "blocked" | "unknown";

/** 自动安装的执行策略：
 *  - pkg：包管理器 + pkexec（Linux）
 *  - usernsProfile：加载 AppArmor profile 放行 bwrap 建 userns（Ubuntu 24.04+；pkexec，只给 bwrap 放行）
 *  - winInstall：srt 自带的 Windows 一次性装配（隔离账户 + WFP，弹一次 UAC） */
export type EnvAutoFix =
  | { strategy: "pkg"; packages: string[] }
  | { strategy: "usernsProfile" }
  | { strategy: "winInstall" };

export interface EnvFix {
  /** auto：可由 EM 自己安装。pkg 策略只给**包名**，命令在 plan.ts 按发行版生成 */
  auto?: EnvAutoFix;
  /** manual：只能用户自己执行/下载 */
  manual?: { command?: string; url?: string };
  /** 只能靠关闭沙盒绕过 */
  sandboxOff?: boolean;
}

export interface EnvItem {
  id: EnvItemId;
  label: string;
  required: boolean;
  status: EnvItemStatus;
  version?: string;
  /** 缺了它会影响什么功能（面向用户的一句话，说"少了什么能力"而不是"这是个什么包"）。
   *  面板只在 status !== "ok" 时展示——用户要知道的不是包名，是"不装的后果"。 */
  impact?: string;
  /** status=unknown 时的原因（面向用户的中文） */
  detail?: string;
  fix: EnvFix;
}

export interface EnvDistro {
  /** /etc/os-release 的 ID（ubuntu / debian / fedora / arch / opensuse…） */
  id: string;
  /** /etc/os-release 的 ID_LIKE；衍生发行版据此复用对应包管理器。 */
  idLike?: string[];
  versionId?: string;
  /** false = 没有可用的自动安装通道（不猜命令，只把命令展示给用户） */
  autoInstallable: boolean;
}

export interface EnvReport {
  items: EnvItem[];
  distro: EnvDistro;
  probedAt: number;
}
