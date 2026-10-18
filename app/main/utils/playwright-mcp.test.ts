import { describe, expect, it } from "vitest";
import { playwrightMcpArgs } from "./playwright-mcp";

describe("default Playwright MCP browser isolation", () => {
  it("recognizes package runners, the server binary and a node entrypoint without mutating config", () => {
    const args = ['-y', '@playwright/mcp@0.0.83', '--headless'];
    expect(playwrightMcpArgs('npx', args)).toEqual([...args, '--isolated']);
    expect(args).toHaveLength(3);
    expect(playwrightMcpArgs('mcp-server-playwright')).toEqual(['--isolated']);
    expect(playwrightMcpArgs('node', ['/tmp/node_modules/@playwright/mcp/cli.js'])).toContain('--isolated');
    expect(playwrightMcpArgs('node', ['server.js'])).toEqual(['server.js']);
  });
  it.each(['--isolated', '--user-data-dir=/tmp/profile', '--user-data-dir', '--cdp-endpoint', '--browser-endpoint', '--extension', '--config'])("respects explicit %s", flag => {
    const args = ['@playwright/mcp', flag, 'value'];
    expect(playwrightMcpArgs('npx', args)).toBe(args);
  });
  it.each(['ISOLATED', 'USER_DATA_DIR', 'CDP_ENDPOINT', 'BROWSER_ENDPOINT', 'EXTENSION', 'CONFIG'])("respects an environment override for %s", key => {
    const args = ['@playwright/mcp'];
    expect(playwrightMcpArgs('npx', args, { [`PLAYWRIGHT_MCP_${key}`]: 'explicit' })).toBe(args);
  });
});
