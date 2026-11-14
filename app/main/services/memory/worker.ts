import { readConclusionEntries } from "./source-reader";
import { parentPort, workerData } from "node:worker_threads";
import path from "node:path";
import { MemoryDatabase } from "./database";
import { migrateExperiences } from "./migration";
import { adoptDocuments, documentStatus, generateDocuments, previewDocuments } from "./documents";

const db = new MemoryDatabase((workerData as {file:string}).file);
const methods = {
  readSource: readConclusionEntries,
  save: db.save.bind(db), get: db.get.bind(db), query: db.query.bind(db), update: db.update.bind(db),
  revisions: db.revisions.bind(db), getRevision: db.getRevision.bind(db), forget: db.forget.bind(db), evaluate: db.evaluate.bind(db),
  enqueue: db.enqueue.bind(db), claim: db.claim.bind(db), finishJob: db.finishJob.bind(db), finishBatch: db.finishBatch.bind(db), failJob: db.failJob.bind(db), releaseJob: db.releaseJob.bind(db), skipJob: db.skipJob.bind(db), retryFailed: db.retryFailed.bind(db),
  detachSession: db.detachSession.bind(db), invalidateSession: db.invalidateSession.bind(db), lookupSummaries: db.lookupSummaries.bind(db), status: db.status.bind(db), reserveUsage: db.reserveUsage.bind(db), metadata: db.metadata.bind(db), setMetadata: db.setMetadata.bind(db),
  migrate: (directory:string,projectId?:string) => migrateExperiences(db,directory,path.join(path.dirname((workerData as {file:string}).file),"backups"),projectId),
  previewDocuments,
  adoptDocuments: (projectId:string,projectPath:string,directory:string,hash:string) => adoptDocuments(db,projectId,projectPath,directory,hash,path.join(path.dirname((workerData as {file:string}).file),"backups")),
  generateDocuments: (projectId:string,projectPath:string) => generateDocuments(db,projectId,projectPath),
  projectEventCount: db.projectEventCount.bind(db),
  documentStatus: (projectId:string) => documentStatus(db,projectId),
  close: () => { db.close(); },
};
export type MemoryMethods = typeof methods;
parentPort?.on("message", async (request:{id:number;method:string;args:unknown[]}) => {
  try {
    if (!Object.hasOwn(methods,request.method)) throw new Error("Unknown memory operation");
    const fn = methods[request.method as keyof typeof methods] as (...args:unknown[])=>unknown;
    const result = await fn(...request.args);
    parentPort?.postMessage({ id:request.id,result });
    if (request.method === "close") parentPort?.close();
  } catch (error) { parentPort?.postMessage({id:request.id,error:(error as Error).message}); }
});
parentPort?.postMessage({ready:true});
