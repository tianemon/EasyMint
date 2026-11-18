import { expect,it } from "vitest";
import { parseMemorySettings } from "./memory";
it("defaults to enabled only when the config is absent",()=>{
  expect(parseMemorySettings(undefined)).toMatchObject({enabled:true,background:true});
  expect(parseMemorySettings({enabled:false,background:false})).toMatchObject({enabled:false,background:false});
});
it.each([null,"broken",[]])("fails closed when the config itself is corrupt: %j",raw=>{
  expect(parseMemorySettings(raw)).toMatchObject({enabled:false,background:false});
});

it.each([{enabled:"false"},{background:0},{enabledAt:"yesterday"},{enabledAt:Number.NaN}])("fails closed on malformed individual switches: %j",raw=>{expect(parseMemorySettings(raw)).toMatchObject({enabled:false,background:false});});
it("defaults background on independently of the total switch while retaining an explicit opt-out",()=>{
 expect(parseMemorySettings({enabled:false})).toMatchObject({enabled:false,background:true});
 expect(parseMemorySettings({enabled:true})).toMatchObject({enabled:true,background:true});
 expect(parseMemorySettings({enabled:true,background:false})).toMatchObject({enabled:true,background:false});
});
