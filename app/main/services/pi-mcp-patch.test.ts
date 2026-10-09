import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("version-pinned Pi MCP patch", () => {
  it("generates deterministically from clean 1.1.0 and refuses unrecognized source changes", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "em-pi-patch-"));
    try {
      const scripts = path.join(root, "scripts"); fs.mkdirSync(scripts);
      const script = path.join(scripts, "patch-pi-mcp.cjs");
      fs.copyFileSync(path.resolve("scripts/patch-pi-mcp.cjs"), script);
      const cached = JSON.parse(fs.readFileSync(path.resolve("node_modules/.cache/easymint-pi-mcp-1.1.0.json"), "utf8"));
      const vendor = path.join(root, "node_modules/@earendil-works/pi-coding-agent");
      fs.mkdirSync(vendor, { recursive: true }); fs.writeFileSync(path.join(vendor, "package.json"), '{"version":"1.1.0","type":"module"}');
      for (const [file, value] of Object.entries(cached) as [string, { original: string }][]) {
        fs.mkdirSync(path.dirname(path.join(vendor, file)), { recursive: true }); fs.writeFileSync(path.join(vendor, file), value.original);
      }
      const run = () => spawnSync(process.execPath, [script], { encoding: "utf8" });
      expect(run().status).toBe(0);
      const first = fs.readFileSync(path.join(vendor, "dist/extensions/mcp/index.js"), "utf8");
      expect(run().status).toBe(0);
      expect(fs.readFileSync(path.join(vendor, "dist/extensions/mcp/index.js"), "utf8")).toBe(first);
      expect(spawnSync(process.execPath, ["--check", path.join(vendor, "dist/extensions/mcp/index.js")]).status).toBe(0);
      fs.appendFileSync(path.join(vendor, "dist/extensions/mcp/index.js"), "\n// unexpected edit\n");
      expect(run().stderr).toContain("changed outside the verified patch");
      fs.writeFileSync(path.join(vendor, "package.json"), '{"version":"1.1.1"}');
      expect(run().stderr).toContain("require a review for Pi 1.1.1");
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
});
