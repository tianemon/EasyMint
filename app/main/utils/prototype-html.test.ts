import path from "node:path";
import { describe, expect, it } from "vitest";
import { prototypeBaseUrl } from "./prototype-html";

const root = process.platform === "win32" ? "C:\\tmp" : "/tmp";
const urlRoot = process.platform === "win32" ? "file:///C:/tmp/" : "file:///tmp/";

describe("prototype resource directory URL", () => {
  it("encodes URL delimiters and leaves HTML escaping to DOM serialization", () => {
    expect(prototypeBaseUrl(path.join(root, '页面 #1? &copy;'))).toBe(urlRoot + '%E9%A1%B5%E9%9D%A2%20%231%3F%20&copy;/');
  });
  it("keeps a trailing slash so relative base paths resolve within the directory", () => {
    expect(new URL('assets/', prototypeBaseUrl(path.join(root, 'prototype'))).href).toBe(urlRoot + 'prototype/assets/');
  });
});
