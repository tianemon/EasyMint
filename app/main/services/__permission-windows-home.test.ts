import {beforeEach,afterEach,describe,it,expect,vi} from "vitest";
const host=vi.hoisted(()=>({home:"C:\\Users\\Alice"}));
vi.mock("node:path",async()=>{const actual=await vi.importActual<typeof import("node:path")>("node:path");return {...actual,...actual.win32,default:actual.win32};});
vi.mock("node:os",()=>({default:{homedir:()=>host.home,tmpdir:()=>"C:\\Temp"}}));
vi.mock("node:fs",()=>({default:{existsSync:()=>false,realpathSync:{native:(value:string)=>value},readdirSync:()=>[]}}));
vi.mock("node:child_process",()=>({spawnSync:()=>({status:1})}));
vi.mock("../utils/paths",()=>({emHome:()=>host.home+"\\.easymint",emAgentDir:()=>host.home+"\\.easymint\\agent"}));
vi.mock("./permission/development-runtime",()=>({developmentRuntimeFor:()=>({root:"C:\\runtime"}),developmentRuntimesRoot:()=>"C:\\runtimes"}));
vi.mock("./sandbox/manager",()=>({}));
vi.mock("./sandbox/compat-policy",()=>({}));
vi.mock("./session-cache",()=>({}));
vi.mock("./permission/execution-context",()=>({normalizePermissionMode:(mode:string)=>mode}));
import {findProtectedWriteTarget,findProtectedReadTarget} from "./permission/agent-permission-service";
beforeEach(()=>{
 const win=Object.create(process);Object.defineProperty(win,"platform",{value:"win32"});Object.defineProperty(win,"env",{value:{SystemRoot:"C:\\Windows",TEMP:"C:\\Temp"}});vi.stubGlobal("process",win);host.home="C:\\Users\\Alice";
});
afterEach(()=>vi.unstubAllGlobals());
describe("actual guard functions with Windows paths on any host",()=>{
 it("allows ordinary home targets instead of mapping them into the MSYS root",()=>{
  for(const variable of ["$HOME","${HOME}","$USERPROFILE","${USERPROFILE}"]){
   expect(findProtectedWriteTarget(`mv "${variable}/Downloads/a.txt" ./a.txt`,"C:\\work","full")).toBeNull();
   expect(findProtectedWriteTarget(`echo x > "${variable}/Desktop/a.txt"`,"C:\\work","full")).toBeNull();
   expect(findProtectedWriteTarget(`mv "${variable}/.easymint/runtime-tools/git" ./moved`,"C:\\work","full")).toBe(host.home+"\\.easymint\\runtime-tools\\git");
   expect(findProtectedReadTarget(`cat "${variable}/.ssh/id_rsa"`,"C:\\work")).toBe(host.home+"\\.ssh\\id_rsa");
  }
 });
 it("protects both inner and outer nested-shell expansion with native backslash host paths",()=>{
  for(const command of [
   `bash -c 'mv "$HOME/.easymint/runtime-tools/git" ./moved'`,
   `bash -c "mv $HOME/.easymint/runtime-tools/git ./moved"`,
   String.raw`bash -c "mv \"$HOME/.easymint/runtime-tools/git\" ./moved"`,
  ])expect(findProtectedWriteTarget(command,"C:\\work","full"),command).toBe(host.home+"\\.easymint\\runtime-tools\\git");
  expect(findProtectedWriteTarget(`bash -c "mv $HOME/Downloads/a.txt ./a.txt"`,"C:\\work","full")).toBeNull();
 });
 it("handles quoted homes with spaces and preserves escaped or single-quoted dollar signs",()=>{
  host.home="C:\\Users\\Alice Smith";
  expect(findProtectedWriteTarget(String.raw`bash -c "mv \"$HOME/.easymint/runtime-tools/git\" ./moved"`,"C:\\work","full")).toBe(host.home+"\\.easymint\\runtime-tools\\git");
  expect(findProtectedWriteTarget('mv "$HOME/Downloads/a.txt" ./a.txt',"C:\\work","full")).toBeNull();
  for(const target of ["'$HOME/.easymint/runtime-tools/git'",String.raw`\$HOME/.easymint/runtime-tools/git`,"$HOME_BACKUP/.easymint/runtime-tools/git"])
   expect(findProtectedWriteTarget(`mv ${target} ./moved`,"C:\\work","full")).toBeNull();
 });
});
