import fs from "fs";
import path from "path";
import { resolveHome } from "../utils/paths";
import type { FileReadResult } from "../../shared/file-read";
import { canonicalPolicyPath, isWithin, pathHitsAny, protectedCredentialPaths, protectedWriteRoots } from "./permission/access-policy";

interface FileNode {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: FileNode[];
}

/** 树遍历的排除项。模块级常量：原先每次递归都重建一个 Set（本项目 697 个目录就是 697 个）。 */
const TREE_EXCLUDE = new Set([".git", "node_modules", ".DS_Store", "dist", "temp"]);

/**
 * 单次遍历的节点上限。
 *
 * 没有上限时，monorepo 十万级文件会生成几十 MB JSON 走 IPC + 结构化克隆——
 * 那不是"卡一下"而是界面直接卡死。超限即停止递归并回报 truncated，由前端提示。
 */
const TREE_NODE_LIMIT = 5000;

/** 遍历预算：递归各层共用一个，超限即停并标记截断。 */
interface TreeBudget {
  remaining: number;
  truncated: boolean;
}

export class FileService {
  private expand(p: string): string {
    return resolveHome(p);
  }

  /**
   * 路径安全校验（强制 baseDir 包含关系——file:* 通道防任意路径读写）。
   *
   * 展开 home、折叠 `..` 并解析已存在祖先的真实路径，再校验系统核心/凭据保护及
   * baseDir 包含关系。工作区内合法的 `a/../b` 不误拒，真正越界仍会被识别。
   */
  isPathSafe(filePath: string, baseDir?: string): boolean {
    if (!filePath) return false;
    if (!baseDir) return false;
    const base = canonicalPolicyPath(this.expand(baseDir), process.cwd());
    const target = canonicalPolicyPath(this.expand(filePath), base);
    if (pathHitsAny(target, [...protectedWriteRoots(), ...protectedCredentialPaths()], base)) return false;
    return isWithin(base, target);
  }

  /**
   * 读取文件树（`file:readTree` 通道）。
   *
   * 两个性能点都踩过（2026-10-30 实测本项目 697 个目录 / 3071 节点）：
   * ① 原先 `fs.readdirSync` 逐层同步递归，主进程被整段占住；
   * ② 更贵的是**每层都做一次路径安全校验**：`isPathSafe` 里两次 `canonicalPolicyPath`
   *    （`existsSync` 循环 + `realpathSync.native`）加两次保护清单构造，697 层实测 239ms，
   *    把一次读树从 ~20ms 拖到 ~222ms。现在只在入口校验一次（见下方论证）。
   */
  async readTree(
    baseDir: string,
    dirPath: string,
    maxDepth = 10,
    /** 节点上限（缺省 TREE_NODE_LIMIT）；参数化的目的是让截断行为可被小规模夹具验证 */
    nodeLimit = TREE_NODE_LIMIT,
  ): Promise<{ nodes: FileNode[]; truncated: boolean }> {
    const expanded = this.expand(dirPath);
    if (!this.isPathSafe(expanded, baseDir)) return { nodes: [], truncated: false };
    // 安全根内仍可能有独立受保护的后代；一次解析保护根并映射回遍历别名，
    // 后续只做轻量路径比较，不恢复逐目录 realpath 的开销。
    const realRoot = canonicalPolicyPath(expanded, this.expand(baseDir));
    const protectedPaths = [...protectedWriteRoots(), ...protectedCredentialPaths()]
      .map(root => canonicalPolicyPath(root, realRoot))
      .filter(root => {
        const relative = path.relative(realRoot, root);
        return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
      })
      .map(root => path.join(expanded, path.relative(realRoot, root)));
    const budget: TreeBudget = { remaining: nodeLimit, truncated: false };
    const nodes = await this.readTreeDir(expanded, maxDepth, budget, protectedPaths);
    return { nodes, truncated: budget.truncated };
  }

  private async readTreeDir(expanded: string, depth: number, budget: TreeBudget, protectedPaths: readonly string[]): Promise<FileNode[]> {
    if (depth <= 0 || budget.remaining <= 0) return [];
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(expanded, { withFileTypes: true });
    } catch {
      // 不存在 / 无权限 / 遍历中被删：单目录失败不拖垮整棵树（原 existsSync+readdirSync 同样会返回空）
      return [];
    }
    const nodes: FileNode[] = [];
    for (const entry of entries) {
      if (TREE_EXCLUDE.has(entry.name)) continue;
      const fullPath = path.join(expanded, entry.name);
      if (protectedPaths.some(root => isWithin(root, fullPath))) continue;
      if (budget.remaining <= 0) {
        budget.truncated = true;
        break;
      }
      budget.remaining -= 1;
      if (entry.isDirectory()) {
        nodes.push({
          name: entry.name,
          path: fullPath,
          isDirectory: true,
          children: await this.readTreeDir(fullPath, depth - 1, budget, protectedPaths),
        });
      } else {
        nodes.push({ name: entry.name, path: fullPath, isDirectory: false });
      }
    }
    return nodes;
  }

  /**
   * 读取文本文件内容（file:readContent 通道）。
   *
   * 失败不再返回空串，而是带上原因码：调用方据此给用户一句准确提示——原先「越界」与
   * 「文件不存在」都返回 ""，渲染层无法与空文件区分，表现为空白 tab 且无任何提示。
   * 存在性判定在归属判定之前：链接指向一个已改名/删除的文件时，先说「不在项目内」会掩盖真正的原因。
   * 这会区分越界路径的存在性；本结果只返回本机 UI。若接入模型或远程命令，须先校验归属。
   * baseDir 可为 null（路径不属于任何已登记项目根时，由调用方传入）。
   */
  readContent(baseDir: string | null, filePath: string): FileReadResult {
    if (!filePath) return { ok: false, reason: "missing" };
    const expanded = this.expand(filePath);
    // throwIfNoEntry：不存在时返回 undefined，不在 existsSync 与 statSync 之间留竞态窗口
    const stat = fs.statSync(expanded, { throwIfNoEntry: false });
    if (!stat?.isFile()) return { ok: false, reason: "missing" };
    if (!this.isPathSafe(filePath, baseDir ?? undefined)) return { ok: false, reason: "outside-project" };
    return { ok: true, content: fs.readFileSync(expanded, "utf-8") };
  }

  writeContent(baseDir: string, filePath: string, content: string): void {
    if (!filePath || !this.isPathSafe(filePath, baseDir)) {
      throw new Error("无效的文件路径");
    }
    const expanded = this.expand(filePath);
    fs.mkdirSync(path.dirname(expanded), { recursive: true });
    fs.writeFileSync(expanded, content, "utf-8");
  }

  /** 新建文件（已存在时抛错，不覆盖） */
  createFile(baseDir: string, filePath: string, content = ""): void {
    if (!filePath || !this.isPathSafe(filePath, baseDir)) {
      throw new Error("无效的文件路径");
    }
    const expanded = this.expand(filePath);
    if (fs.existsSync(expanded)) {
      throw new Error("文件已存在");
    }
    fs.mkdirSync(path.dirname(expanded), { recursive: true });
    fs.writeFileSync(expanded, content, "utf-8");
  }

  /** 新建文件夹（已存在时抛错，不覆盖） */
  createFolder(baseDir: string, dirPath: string): void {
    if (!dirPath || !this.isPathSafe(dirPath, baseDir)) {
      throw new Error("无效的目录路径");
    }
    const expanded = this.expand(dirPath);
    if (fs.existsSync(expanded)) {
      throw new Error("文件夹已存在");
    }
    fs.mkdirSync(expanded, { recursive: true });
  }
}
