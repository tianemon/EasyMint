import os from "node:os";
import path from "node:path";
import {beforeEach,afterEach,describe,it,expect,vi} from "vitest";
import {findProtectedWriteTarget,findProtectedReadTarget} from "./permission/agent-permission-service";
vi.mock("./sandbox/manager",()=>({}));
beforeEach(()=>vi.stubEnv("EASYMINT_HOME",undefined));
afterEach(()=>vi.unstubAllEnvs());
const cwd=path.join(os.homedir(),"dev","permission-fixture");
const literal=(suffix:string)=>JSON.stringify(path.join(os.homedir(),...suffix.split("/")).replaceAll("\\","/"));
describe("home interpolation preserves shell quoting and path ownership",()=>{
 it("blocks protected home targets and allows ordinary home targets for each supported variable",()=>{
  for(const variable of ["$HOME","${HOME}","$USERPROFILE","${USERPROFILE}"]){
   expect(findProtectedWriteTarget(`mv "${variable}/.easymint/runtime-tools/git" ./moved`,cwd,"full"),variable).toBeTruthy();
   expect(findProtectedWriteTarget(`echo x > "${variable}/.easymint/agent/settings.json"`,cwd,"full"),variable).toBeTruthy();
   expect(findProtectedReadTarget(`cat "${variable}/.ssh/id_rsa"`,cwd),variable).toBeTruthy();
   expect(findProtectedWriteTarget(`mv "${variable}/Downloads/a.txt" ./a.txt`,cwd,"full"),variable).toBeNull();
   expect(findProtectedWriteTarget(`echo x > "${variable}/Desktop/a.txt"`,cwd,"full"),variable).toBeNull();
  }
  expect(findProtectedWriteTarget(`mv ${literal("Downloads/a.txt")} ./a.txt`,cwd,"full")).toBeNull();
 });
 it("keeps literal and unknown variable names from masquerading as the real home",()=>{
  for(const target of ["'$HOME/.easymint/runtime-tools/git'","'${HOME}/.easymint/runtime-tools/git'",String.raw`\$HOME/.easymint/runtime-tools/git`,"$HOME_BACKUP/.easymint/runtime-tools/git"])
   expect(findProtectedWriteTarget(`mv ${target} ./moved`,cwd,"full"),target).toBeNull();
 });
 it("follows home variables into nested shells without expanding top-level quoted data",()=>{
  expect(findProtectedWriteTarget(`bash -c 'mv "$HOME/.easymint/runtime-tools/git" ./moved'`,cwd,"full")).toBeTruthy();
  expect(findProtectedWriteTarget(`bash -c "mv $HOME/.easymint/runtime-tools/git ./moved"`,cwd,"full")).toBeTruthy();
  expect(findProtectedWriteTarget(String.raw`bash -c "mv \"$HOME/.easymint/runtime-tools/git\" ./moved"`,cwd,"full")).toBeTruthy();
  expect(findProtectedWriteTarget(`bash -c 'mv "$HOME/Downloads/a.txt" ./a.txt'`,cwd,"full")).toBeNull();
  expect(findProtectedWriteTarget(`echo 'mv "$HOME/.easymint/runtime-tools/git" ./moved'`,cwd,"full")).toBeNull();
 });
 it("retains a quoted home containing spaces as one path token",()=>{
  const home=path.join(os.homedir(),"Home With Spaces");const spy=vi.spyOn(os,"homedir").mockReturnValue(home);
  try{
   // The policy roots are calculated from the same host home, not from a guessed /HOME suffix.
   expect(findProtectedWriteTarget('mv "$HOME/.easymint/runtime-tools/git" ./moved',cwd,"full")).toBeTruthy();
   expect(findProtectedWriteTarget('mv "$HOME/Downloads/a.txt" ./a.txt',cwd,"full")).toBeNull();
  }finally{spy.mockRestore();}
 });
});
