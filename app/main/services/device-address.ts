/**
 * 局域网地址选择 — 从 mDNS 上报的地址里挑「与本机同网段」的那一个。
 *
 * 单列成模块的原因有两条：
 * ① 这是纯判定，与 NetworkService 的连接/配对状态无关；
 * ② `network-service` 在模块顶层就 `new NetworkService()`（写 home、开 47777 端口），
 *    任何 import 它的测试都会污染真实环境。判定放在这里才能被直接验证。
 *
 * 问题背景：Windows 多网卡（Hyper-V/WSL 虚拟网卡 172.x）会抢占 mDNS addresses 首位，
 * 取第一个 IPv4 会连到虚拟网卡（实测 172.28.64.1）；对端真实 IP 与本机同网段。
 */

import * as os from "node:os";

/** 本机 IPv4 地址集（前两段作网段前缀，排除回环 / APIPA / 虚拟网卡段）。 */
function localIPv4Prefixes(): Set<string> {
  const prefixes = new Set<string>();
  try {
    for (const addrs of Object.values(os.networkInterfaces())) {
      for (const a of addrs ?? []) {
        if (a.family !== "IPv4" || a.internal) continue;
        // 排除 WSL/Hyper-V(172.16-31)/Docker(172.17+ 也被 172.16-31 覆盖)/APIPA(169.254)
        const first = a.address.split(".")[0];
        const second = Number(a.address.split(".")[1] ?? 0);
        if (first === "127" || first === "169") continue;
        if (first === "172" && second >= 16 && second <= 31) continue;
        prefixes.add(a.address.split(".").slice(0, 2).join("."));
      }
    }
  } catch { /* 取不到网卡信息时按无前缀处理，回退首个 IPv4 */ }
  return prefixes;
}

/**
 * 从候选地址里选最佳地址：优先同网段，无匹配退回第一个 IPv4。
 *
 * `prefixes` 可注入——真实网卡列表在测试或 CI 上不可控，判定必须能给定输入。
 */
export function pickBestAddress(addresses: string[], prefixes: Set<string> = localIPv4Prefixes()): string | undefined {
  const v4 = addresses.filter((a) => a.includes(".") && !a.startsWith("169.") && !a.startsWith("127."));
  if (v4.length === 0) return undefined;
  return v4.find((a) => prefixes.has(a.split(".").slice(0, 2).join("."))) ?? v4[0];
}
