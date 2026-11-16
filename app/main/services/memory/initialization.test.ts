import { DatabaseSync } from "node:sqlite";
import { expect,it,vi } from "vitest";
import { MemoryDatabase } from "./database";

it("retries transient WAL-mode contention while preserving real SQLite schema initialization",()=>{
  const original=DatabaseSync.prototype.exec;
  let attempts=0;
  const spy=vi.spyOn(DatabaseSync.prototype,"exec").mockImplementation(function(this:DatabaseSync,sql:string){
    if(sql.includes("journal_mode=WAL") && attempts++===0)throw Object.assign(new Error("database is locked"),{errcode:5});
    return original.call(this,sql);
  });
  let db:MemoryDatabase|undefined;
  try {
    db=new MemoryDatabase(":memory:");
    expect(attempts).toBe(2);
    expect(db.save({kind:"preference",text:"并发初始化后仍能保存"},{source:{ref:"test",type:"manual"},confirmed:true}).item.confidence).toBe("confirmed");
  } finally {spy.mockRestore();db?.close();}
});

it("refuses an existing foreign database before changing its bytes",async()=>{
  const fs=await import("node:fs"),os=await import("node:os"),path=await import("node:path");
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"em-memory-foreign-")),file=path.join(root,"memory.sqlite");
  const foreign=new DatabaseSync(file);foreign.exec("CREATE TABLE personal_data(value TEXT); INSERT INTO personal_data VALUES ('KEEP ORIGINAL')");foreign.close();
  const original=fs.readFileSync(file);
  try {expect(()=>new MemoryDatabase(file)).toThrow("未识别");expect(fs.readFileSync(file)).toEqual(original);}
  finally {fs.rmSync(root,{recursive:true,force:true});}
});
