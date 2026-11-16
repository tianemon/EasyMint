import { expect,it } from "vitest";
import { parseMemorySettings } from "./memory";
it("defaults to enabled when no explicit config exists",()=>{
  expect(parseMemorySettings(undefined)).toMatchObject({enabled:true,background:true});
  expect(parseMemorySettings({enabled:false,background:false})).toMatchObject({enabled:false,background:false});
});
it.each([null,"broken",[],{enabled:"false",background:true}])("ignores invalid config and falls back to the default: %j",raw=>{
  expect(parseMemorySettings(raw)).toMatchObject({enabled:true,background:true});
});
