import * as os from "node:os";

/** Keep every private IPv4 as a fallback, but put likely physical adapters first. */
export function orderedLanAddresses(interfaces: ReturnType<typeof os.networkInterfaces>): string[] {
  const found: Array<{ address: string; rank: number; order: number }> = [];
  for (const [name, entries] of Object.entries(interfaces)) {
    const virtual = /(?:^utun\d|^tun\d|^tap\d|vpn|wireguard|wintun|tailscale|zerotier|hyper-v|vethernet|wsl|vmware|virtualbox|vbox|docker|^br-|^veth|^bridge|^ppp)/i.test(name);
    const physical = /^(?:en\d+|eth\d+|wlan\d+|wi-?fi|ethernet|以太网|无线局域网)/i.test(name);
    for (const entry of entries ?? []) {
      if (entry.family !== "IPv4" || entry.internal) continue;
      const [a, b] = entry.address.split(".").map(Number);
      if (a !== 10 && !(a === 172 && b >= 16 && b <= 31) && !(a === 192 && b === 168)) continue;
      found.push({ address: entry.address, rank: virtual ? 2 : physical ? 0 : 1, order: found.length });
    }
  }
  found.sort((a, b) => a.rank - b.rank || a.order - b.order);
  return [...new Set(found.map(item => item.address))];
}
