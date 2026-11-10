import { afterEach, describe, expect, it, vi } from "vitest";
import { isSessionOpenElsewhere, removeDesktopSessions, removeMobileConnection, setDesktopSessions, setMobileView } from "./session-visibility";

afterEach(() => { removeDesktopSessions(1); removeDesktopSessions(2); removeMobileConnection("device", "c1"); removeMobileConnection("device", "c2"); vi.useRealTimers(); });

describe("session ownership during reclaim", () => {
  it("retains a session open in another valid window, including a minimized window", () => {
    let valid = true;
    setDesktopSessions(1, ["a", "b"], () => valid);
    setDesktopSessions(2, ["b"]);
    expect(isSessionOpenElsewhere("a")).toBe(true);
    valid = false;
    expect(isSessionOpenElsewhere("a")).toBe(false);
    expect(isSessionOpenElsewhere("b")).toBe(true);
    removeDesktopSessions(2);
    expect(isSessionOpenElsewhere("b")).toBe(false);
  });
  it("expires disconnected mobile viewers and keeps independent pages separate", () => {
    vi.useFakeTimers();
    setMobileView("device", "one", "a", "c1", 1);
    setMobileView("device", "two", "a", "c1", 2);
    setMobileView("device", "one", null, "c1", 3);
    setMobileView("device", "one", "a", "c1", 1);
    expect(isSessionOpenElsewhere("a")).toBe(true);
    setMobileView("device", "two", null, "c1", 4);
    expect(isSessionOpenElsewhere("a")).toBe(false);
    setMobileView("device", "two", "b", "c2", 1);
    removeMobileConnection("device", "c1");
    expect(isSessionOpenElsewhere("b")).toBe(true);
    vi.advanceTimersByTime(45_001);
    expect(isSessionOpenElsewhere("b")).toBe(false);
  });
});
