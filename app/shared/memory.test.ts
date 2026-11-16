import { expect,it } from "vitest";
import { parseMemorySettings } from "./memory";
it("defaults to enabled only when the config is absent",()=>{
  expect(parseMemorySettings(undefined)).toMatchObject({enabled:true,background:true});
  expect(parseMemorySettings({enabled:false,background:false})).toMatchObject({enabled:false,background:false});
});
it.each([null,"broken",[]])("fails closed when the config itself is corrupt: %j",raw=>{
  expect(parseMemorySettings(raw)).toMatchObject({enabled:false,background:false});
});
