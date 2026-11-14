import { expect,it } from "vitest";
import { parseMemorySettings } from "./memory";
it("preserves legacy experience consent without granting background-model consent",()=>{
  expect(parseMemorySettings(undefined,true)).toMatchObject({enabled:true,background:false});
  expect(parseMemorySettings({enabled:false,background:false},true)).toMatchObject({enabled:false,background:false});
});
it.each([null,"broken",[],{enabled:"false",background:true},{background:true}])("does not use an invalid explicit configuration to enable memory or background calls: %j",raw=>{
  expect(parseMemorySettings(raw,true)).toMatchObject({enabled:false,background:false});
});
