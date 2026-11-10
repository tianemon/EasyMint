import { describe, expect, it } from "vitest";
import { projectWindowRoute, shouldRememberProject } from "./project-window";

describe("project window origin", () => {
  it("does not overwrite the last desktop project for a remote-opened window", () => {
    const route = projectWindowRoute("project-1", { remote: true });
    const [pathname, query] = route.split("?");
    expect(pathname).toBe("/project/project-1");
    expect(new URLSearchParams(query).get("fresh")).toBe("1");
    expect(shouldRememberProject(`?${query}`)).toBe(false);
  });
  it("records desktop opens and later user navigation, retaining session and init options", () => {
    const route = projectWindowRoute("project-2", { sessionId: "s1", init: true });
    const query = route.split("?")[1]!;
    expect(new URLSearchParams(query).get("session")).toBe("s1");
    expect(new URLSearchParams(query).get("init")).toBe("1");
    expect(shouldRememberProject(`?${query}`)).toBe(true);
    expect(shouldRememberProject("")).toBe(true);
  });
});
