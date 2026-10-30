/**
 * 局域网地址选择的判定测试。
 *
 * 为什么单独钉这一段：mDNS 上报的 addresses 顺序不保证，Windows 上 Hyper-V/WSL 的
 * 172.x 虚拟网卡会排到首位。取错地址的后果是「手机扫码配对了但一直连不上」，
 * 且现象与网络无关，很难从用户侧定位（实测踩过 172.28.64.1）。
 *
 * 这里只测纯判定，不实例化 NetworkService：它的构造函数会写 home 并占用 47777 端口。
 */
import { describe, expect, it } from "vitest";
import { pickBestAddress } from "./device-address";

/** 本机网段（前两段）：与候选地址比对用 */
const local = new Set(["192.168"]);

describe("pickBestAddress", () => {
  it("虚拟网卡排在首位时，仍然选同网段的真实局域网地址", () => {
    // 真实形态：Hyper-V / WSL 的 172.28.x 先上报，家里网段是 192.168.x
    expect(pickBestAddress(["172.28.64.1", "192.168.5.23"], local)).toBe("192.168.5.23");
  });

  it("没有同网段候选时退回第一个 IPv4（不因匹配失败就返回空）", () => {
    expect(pickBestAddress(["10.0.0.7", "10.0.0.8"], local)).toBe("10.0.0.7");
  });

  it("排除回环与 APIPA（169.254 自分配地址连不上对端）", () => {
    expect(pickBestAddress(["127.0.0.1", "169.254.13.9", "192.168.1.4"], local)).toBe("192.168.1.4");
  });

  it("只有回环/APIPA 时返回 undefined，不做无意义连接", () => {
    expect(pickBestAddress(["127.0.0.1", "169.254.1.1"], local)).toBeUndefined();
  });

  it("只有 IPv6 时返回 undefined（本服务按 IPv4 局域网寻址）", () => {
    expect(pickBestAddress(["fe80::1", "::1"], local)).toBeUndefined();
  });

  it("空列表返回 undefined", () => {
    expect(pickBestAddress([], local)).toBeUndefined();
  });
});
