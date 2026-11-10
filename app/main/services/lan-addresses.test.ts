import { describe, expect, it } from "vitest";
import type { NetworkInterfaceInfo } from "node:os";
import { orderedLanAddresses } from "./lan-addresses";

const v4 = (address: string): NetworkInterfaceInfo => ({ address, netmask: "255.255.255.0", family: "IPv4", mac: "00:00:00:00:00:00", internal: false, cidr: `${address}/24` });

describe("mobile LAN address selection", () => {
  it("prioritizes physical adapters but keeps VPN and virtual addresses as fallback", () => {
    expect(orderedLanAddresses({ utun4: [v4("10.0.0.2")], "vEthernet (WSL)": [v4("172.22.0.1")], en0: [v4("172.20.1.2")], "Wi-Fi": [v4("192.168.5.5")] }))
      .toEqual(["172.20.1.2", "192.168.5.5", "10.0.0.2", "172.22.0.1"]);
  });
  it("keeps unknown adapters and filters public and duplicate addresses", () => {
    expect(orderedLanAddresses({ unknown: [v4("10.2.3.4"), v4("8.8.8.8"), v4("10.2.3.4")] })).toEqual(["10.2.3.4"]);
  });
});
