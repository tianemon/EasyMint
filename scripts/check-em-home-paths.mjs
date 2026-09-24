#!/usr/bin/env node
/**
 * `~/.easymint` 落盘条目 × 保护清单 的一致性守卫。
 *
 * **为什么需要**：`access-policy.ts` 的三份保护清单是**按名字逐个列举**的，不受类型系统保护 ——
 * 新增一个落盘文件时，没有任何机制提醒去登记它。实测代价（2026-09-24）：
 * `mcp-instructions.json` 的内容会在工具搜索结果中进模型上下文；若漏在清单外，
 * 完全访问档下可被改写，成为持久化的第三方文本注入通道。
 * 这与 `check-deps.mjs` 属同一类问题：**靠人记得住的约定，迟早会漏**。
 *
 * **判据**：源码里出现的每个 `emHome()/<条目>`（最多取两段）都必须在下面的 `DECLARED` 表里
 * 显式登记，并声明保护档；随后与 `access-policy.ts` 的真实清单交叉核对：
 *   - `klass` ≠ `none` → 必须出现在对应函数的清单里（credential/persistence/state）；`also` 可要求第二档
 *   - `klass` = `none` → 必须**不**出现在任何清单里（写了就是清单与表打架）
 * 匹配取**最长前缀**：`agent/auth.json` 命中自身条目而非父目录 `agent`。
 *
 * **覆盖的写法**：
 *   path.join(emHome(), "a", "b.json")   `${emHome()}/a.json`   path.join(DATA_DIR, "a.json")
 *   path.join(path.dirname(getMcpConfigPath()), "a.json")      ← 间接派生，见 INDIRECT
 * 别名取自 `const X = emHome()` 的既有惯例（DATA_DIR / MANAGED_DIR / EM_HOME）。
 * **已知边界**：把 emHome 再往下传（当参数递给别的函数）的写法扫不到；用了新的间接写法而不在
 * INDIRECT 里登记，那个文件也会逃过扫描（实测：mcp-instructions.json 就是 `dirname(getMcpConfigPath())`
 * 写的，第一版脚本没认出来）。脚本的价值是把"漏登记"从"没人知道"变成"构建期必红"——
 * 前提是它认得的写法覆盖了你用的那种。
 * 别名按**名字**匹配（DATA_DIR / MANAGED_DIR / EM_HOME），不校验它是否真的等于 emHome()：
 * 将来若出现同名却指向别处的变量，脚本会误报并要求登记 —— 这是刻意的取舍（宁可吵，不要漏）。
 *
 * 用法：node scripts/check-em-home-paths.mjs（已接入 `npm run lint`）；有问题时 exit 1。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCAN_DIR = "app";
const POLICY_REL = "app/main/services/permission/access-policy.ts";

/** 保护档 → access-policy 的对应函数 */
const KLASS_FN = {
  credential: "protectedCredentialPaths",
  persistence: "protectedPersistencePaths",
  state: "protectedStatePaths",
};

/**
 * 逐条登记的落盘条目。**新增落盘文件时必须在这里加一行**，并想清楚它的保护档。
 * `why` 是给下一个人的理由，不是装饰 —— 写"待定"也要写清待定的是什么。
 */
const DECLARED = [
  // ── credential：高敏凭据（只读档与标准档都不可读；完全访问免读、但仍禁写）──
  { entry: "em-settings.json", klass: "credential", why: "含 API 密钥与供应商设置" },
  { entry: "mcp-oauth.json", klass: "credential", why: "MCP OAuth 令牌" },
  { entry: "environment.sh", klass: "credential", why: "宿主导出的环境变量（可能含密钥）" },
  { entry: ".control-tmp", klass: "credential", why: "宿主控制通道的临时区" },
  { entry: "agent/auth.json", klass: "credential", why: "模型供应商登录凭据" },

  // ── persistence：完全访问也禁止改写（改一次 = 绕过整个判定层或影响模型行为）──
  { entry: "mcp.json", klass: "persistence", why: "决定下次会话启动哪些本地进程" },
  { entry: "mcp-instructions.json", klass: "persistence", why: "server 自述，会进工具说明与搜索结果（提示词注入面）" },
  { entry: "agent/settings.json", klass: "persistence", why: "agent 运行期设置" },
  { entry: "agent/models.json", klass: "persistence", why: "模型清单，可把请求转发到别的端点" },
  { entry: "system-prompts.json", klass: "persistence", why: "下次会话的系统提示词内容" },

  // ── state：标准 / 只读档保护，完全访问放开 ──
  { entry: "session-cache", klass: "state", why: "会话状态（权限模式、思考等级）" },

  // ── none：明确不保护。逐条登记的意义是"有人想过并给了理由"，不是"随便放行"──
  { entry: "agent", klass: "none", exact: true, why: "仅容器目录；未知子项不得继承 none" },
  { entry: "agent/sessions", klass: "none", why: "会话记录" },
  { entry: "agent/skills", klass: "persistence", why: "Pi 原生发现的全局技能" },
  { entry: "agent/models-store.json", klass: "persistence", why: "pi SDK 的模型存储，与 agent/models.json 一同参与 ModelRuntime 构建" },
  { entry: "pi-agent/models-store.json", klass: "none", why: "历史位置，只作迁移来源" },
  { entry: "sessions", klass: "none", why: "历史位置，只作迁移来源" },
  { entry: "electron", klass: "none", why: "Electron userData（Chromium 缓存）" },
  { entry: "projects", klass: "none", why: "pi SDK 的项目会话目录" },
  { entry: "projects.json", klass: "none", why: "项目清单（路径与最近打开时间）" },
  { entry: ".cleanup-pending.json", klass: "none", why: "退出清理的待处理标记" },
  { entry: "migration-cache", klass: "none", why: "迁移用的临时包" },
  { entry: "migration-ignore", klass: "none", why: "迁移忽略清单" },
  { entry: "uploads", klass: "none", why: "用户上传的临时附件" },
  { entry: "device-id.json", klass: "none", why: "本机标识" },
  { entry: "paired-devices.json", klass: "credential", also: "persistence", why: "含配对密钥，写入还会改变设备认证" },
  { entry: "paired-mobile-devices.json", klass: "credential", also: "persistence", why: "含 sharedSecret，写入还会改变设备认证" },
  { entry: "skills", klass: "persistence", why: "技能描述进 <skills> 分节、正文由 use_skill 读（每会话随行）" },
  { entry: "managed-skills", klass: "persistence", why: "同上（AI 写入的技能区）" },
  { entry: "skill-registry.json", klass: "none", why: "只是登记表；注入内容来自技能文件本身，它只决定可见性" },
  { entry: "experiences", klass: "persistence", why: "buildExperienceInjection 在会话构建时注入，每轮随行" },
  { entry: "learn-state.json", klass: "none", why: "自沉淀的节流状态，不构成注入" },
  { entry: "agent-templates.json", klass: "persistence", why: "id + 名称 + 描述拼进 task 工具描述" },
  { entry: "session-types.json", klass: "none", why: "只切换提示词档位（mint/designer），不能注入文本" },
  { entry: "session-pins.json", klass: "none", why: "会话置顶（UI 状态）" },
  { entry: "pinned-sessions.json", klass: "none", why: "会话置顶（UI 状态）" },
  { entry: "archived-sessions.json", klass: "none", why: "会话归档（UI 状态）" },
  { entry: "session-titles.json", klass: "none", why: "会话标题（UI 状态）" },
  { entry: "runtimes", klass: "none", why: "沙盒运行区（标准档本来就在 allowWrite 里）" },
  { entry: "logs", klass: "none", why: "日志" },
];

const ALIASES = ["DATA_DIR", "MANAGED_DIR", "EM_HOME"];
const LITERALS = String.raw`((?:"[^"]+"\s*,\s*)*"[^"]+")`;
/**
 * 间接派生：`path.dirname(getMcpConfigPath())` 就是 emHome()（mcp.json 恒在数据目录根）。
 * **新增这类间接写法时必须在这里补一条**，否则那个新文件会逃过扫描 ——
 * 这正是本脚本的软肋：它认形式，而形式是可以绕的（实测：mcp-instructions.json 就是这么写的）。
 */
const INDIRECT = [
  /join\(\s*path\.dirname\(getMcpConfigPath\(\)\)\s*,\s*((?:"[^"]+"\s*,\s*)*"[^"]+")/g,
];
const PATTERNS = [
  { re: new RegExp(String.raw`emHome\(\),\s*${LITERALS}`, "g"), kind: "direct" },
  { re: new RegExp(String.raw`\bjoin\(\s*(?:${ALIASES.join("|")})\s*,\s*${LITERALS}`, "g"), kind: "alias" },
  { re: new RegExp(String.raw`\$\{emHome\(\)\}\/([^/"'\s` + "`" + String.raw`]+)`, "g"), kind: "template" },
  ...INDIRECT.map((re) => ({ re, kind: "indirect" })),
];

function lineAt(content, index) {
  return content.slice(0, index).split("\n").length;
}

/** 从源码里抽出所有 `emHome()/<条目>`（最多两段；含变量插值的段跳过） */
function entriesIn(content, collect) {
  for (const { re } of PATTERNS) {
    for (const m of content.matchAll(re)) {
      const segs = [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
      const raw = segs.length > 0 ? segs.slice(0, 2).join("/") : m[1];
      if (!raw || raw.includes("${") || raw.includes("\\")) continue;
      collect(raw, lineAt(content, m.index ?? 0));
    }
  }
}

/** 递归收集源文件（跳过测试：测试自己的临时落盘不算产品条目） */
function collectFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "dist" || entry.name === "node_modules") continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectFiles(abs));
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(abs);
  }
  return out;
}

/** 解析 access-policy.ts：条目 → 它出现在哪些 protectedXxx 函数里 */
function policyIndex(content) {
  const index = new Map();
  let fn = null;
  for (const line of content.split("\n")) {
    const decl = line.match(/^export function (protected\w+)/);
    // 只跟踪真正承载保护清单的三个函数（`protectedWriteRoots` / `protectedDevicePaths` 等不参与）
    if (decl) fn = Object.values(KLASS_FN).includes(decl[1]) ? decl[1] : null;
    else if (/^\}/.test(line)) fn = null;
    if (!fn) continue;
    entriesIn(line, (entry) => {
      if (!index.has(entry)) index.set(entry, new Set());
      index.get(entry).add(fn);
    });
  }
  return index;
}

/** 最长前缀匹配；`exact` 容器只匹配自身，未知子项不得继承它的 none 档。 */
function declaredFor(entry) {
  let best = null;
  for (const d of DECLARED) {
    if (entry === d.entry || (!d.exact && entry.startsWith(d.entry + "/"))) {
      if (!best || d.entry.length > best.entry.length) best = d;
    }
  }
  return best;
}

function main() {
  const files = collectFiles(path.join(ROOT, SCAN_DIR));
  const policy = policyIndex(fs.readFileSync(path.join(ROOT, POLICY_REL), "utf-8"));
  const problems = [];
  const hits = new Set();
  if (declaredFor("agent/__unregistered_guard_probe__.json")) {
    problems.push("agent 容器吞掉了未知子项，落盘清单守卫失效");
  }

  // 表自身的自检：同名两条会各自被"档位核对"检查一遍，报出的信息互相矛盾（维护者会被绕晕），
  // 而且 resolveTableEntry 只会采用其中一条 —— 先挡住这种表。
  const seenEntry = new Set();
  for (const d of DECLARED) {
    if (seenEntry.has(d.entry)) problems.push(`DECLARED 表重复登记：${d.entry}（同一档位只应有一行）`);
    seenEntry.add(d.entry);
  }

  for (const abs of files) {
    const rel = path.relative(ROOT, abs).split(path.sep).join("/"); // Windows 下 path.sep 是 \，与 POLICY_REL 的 / 不一致
    if (rel === POLICY_REL) continue; // 清单本身单独解析
    const content = fs.readFileSync(abs, "utf-8");
    entriesIn(content, (entry, line) => {
      hits.add(entry);
      if (!declaredFor(entry)) problems.push(`未登记：${rel}:${line} 用了 emHome()/${entry}，DECLARED 表里没有它`);
    });
  }

  for (const d of DECLARED) {
    const inFns = policy.get(d.entry) ?? new Set();
    if (d.klass === "none") {
      if (inFns.size > 0) {
        problems.push(`表与清单打架：${d.entry} 登记为 none，却出现在 ${[...inFns].join(" / ")}`);
      }
      continue;
    }
    for (const klass of [d.klass, ...(d.also ? [d.also] : [])]) {
      const want = KLASS_FN[klass];
      if (!inFns.has(want)) {
        problems.push(
          `漏进清单：${d.entry} 登记为 ${klass}，但 ${want} 里没有它` +
            (inFns.size > 0 ? `（实际出现在 ${[...inFns].join(" / ")}）` : ""),
        );
      }
    }
  }

  // 反向检查：清单里登记了、DECLARED 表却没有的条目 —— 此前只查"表 → 清单"一个方向，
  // 只加清单不加表会静默通过（守卫自身的检测缺口，2026-09-24 自查时发现）
  for (const [entry, fns] of policy) {
    if (!declaredFor(entry)) {
      problems.push(`清单里有 emHome()/${entry}（${[...fns].join(" / ")}），但 DECLARED 表没登记它`);
    }
  }

  if (problems.length === 0) {
    // 按"是否被任何命中覆盖"判断，而不是精确相等：只出现 agent/settings.json 时，
    // 父条目 agent 不该被报成"未命中"
    const covered = new Set([...hits].map((h) => declaredFor(h)?.entry).filter(Boolean));
    const idle = DECLARED.filter((d) => !covered.has(d.entry)).map((d) => d.entry);
    console.log(
      `[check-em-home] ✓ 扫描 ${files.length} 个源文件，命中 ${hits.size} 个落盘条目，全部登记且与保护清单一致` +
        (idle.length > 0 ? `（下列登记项未在产品代码里命中：${idle.join("、")}——由依赖库写入，或其写法未被扫描覆盖）` : ""),
    );
    return 0;
  }

  console.error(`[check-em-home] ✗ 发现 ${problems.length} 处问题：`);
  for (const p of problems) console.error(`   ${p}`);
  console.error(
    "\n处置：新增落盘文件时在 scripts/check-em-home-paths.mjs 的 DECLARED 表登记保护档\n" +
      "      （credential/persistence/state/none，none 也要写理由），\n" +
      "      然后按档位把它加进 access-policy.ts 对应函数的清单。\n" +
      "      判断依据：内容会进模型上下文或决定后续执行能力 → persistence；含凭据 → credential；\n" +
      "      只影响本机 UI 状态且不构成提权 → none。",
  );
  return 1;
}

process.exit(main());
