import { expect, it } from "vitest";
import { formatTokenCount, formatTokenWindow } from "./token-format";

it.each([[0,"0"],[999,"999"],[1000,"1K"],[35000,"35K"],[35500,"35.5K"],[131072,"131.1K"],[999999,"1M"],[1250000,"1.3M"]])("formats usage %s as %s without locale-specific compact units",(value,label)=>{
  expect(formatTokenCount(Number(value))).toBe(label);
});
it("does not confuse usage counts with binary model window labels",()=>{
  expect(formatTokenWindow(131072)).toBe("128K");
  expect(formatTokenCount(131072)).toBe("131.1K");
  expect(formatTokenCount(NaN)).toBe("—");expect(formatTokenCount(-1)).toBe("—");
});
