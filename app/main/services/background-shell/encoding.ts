/**
 * 编码容错解码 — Windows 下 Git Bash 自身输出 UTF-8,但其调用的原生程序按系统代码页(GBK)输出,
 * 单用 UTF-8 解 GBK 字节必乱码。每段累积原始字节,判定编码后一次性输出。
 */

/**
 * 判定并解码一段字节缓冲:
 *  1. ≤3 字节:完整 UTF-8(单字节 ASCII 等)直接输出;不完整多字节前缀保留等待
 *  2. 严格 UTF-8 解全量成功 → UTF-8,输出清空
 *  3. 去尾 1-3 字节的任一前缀严格 UTF-8 成功 → 输出已确定前缀,仅保留尾部不完整字节等待
 *     (不整段保留:否则混入非 UTF-8 字节时已确定输出被永久吞掉,前端永远收不到)
 *  4. 其余 → GBK,输出清空
 * (GBK 双字节字符去尾前缀必失败,不会误判未完成;UTF-8 跨 chunk 截断能正确等待)
 */
export function decodeSeg(bytes: Buffer): { text: string; rest: Buffer } {
  const fatal = (b: Buffer): string => new TextDecoder("utf-8", { fatal: true }).decode(b);
  if (bytes.length <= 3) {
    try {
      return { text: fatal(bytes), rest: Buffer.alloc(0) };
    } catch {
      return { text: "", rest: bytes };
    }
  }
  try {
    return { text: fatal(bytes), rest: Buffer.alloc(0) };
  } catch {
    for (const cut of [1, 2, 3]) {
      if (bytes.length - cut <= 0) continue;
      try {
        const text = fatal(bytes.subarray(0, bytes.length - cut));
        return { text, rest: bytes.subarray(bytes.length - cut) };
      } catch { /* 继续尝试更小 cut */ }
    }
    return { text: new TextDecoder("gbk").decode(bytes), rest: Buffer.alloc(0) };
  }
}

/** 终局解码(命令退出时):不再等待未完成序列,UTF-8 尝试失败则 GBK */
export function finalDecode(bytes: Buffer): string {
  if (bytes.length === 0) return "";
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("gbk").decode(bytes);
  }
}

/** 增量解码器:持续 feed chunk,输出解码文本(UTF-8/GBK 自动判定) */
export function createCodingAwareDecoder(): {
  feed(chunk: Buffer): string;
  finish(): string;
} {
  let bytes: Buffer = Buffer.alloc(0);
  return {
    feed(chunk: Buffer): string {
      bytes = Buffer.concat([bytes, chunk]);
      const { text, rest } = decodeSeg(bytes);
      bytes = rest;
      return text;
    },
    finish(): string {
      const t = finalDecode(bytes);
      bytes = Buffer.alloc(0);
      return t;
    },
  };
}
