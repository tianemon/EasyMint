import { readConclusionEntries } from "./source-reader";
import { parentPort, workerData } from "node:worker_threads";
import { MemoryDatabase } from "./database";
import type {MemoryConclusion} from "../../../shared/memory";
import path from "node:path";

const startup=workerData as {file:string;recordingStartedAt?:number};
const db = new MemoryDatabase(startup.file,startup.recordingStartedAt);
const methods = {
  cancelCapture:db.cancelCapture.bind(db),
  sourceEntryIds:db.sourceEntryIds.bind(db),
  cleanupLegacyProjects:db.cleanupLegacyProjects.bind(db),
  ensureRoutine:db.ensureRoutine.bind(db),finishRoutine:db.finishRoutine.bind(db),submissionsForRound:db.submissionsForRound.bind(db),
  checkCapacity:db.checkCapacity.bind(db),compact:db.compact.bind(db),
  readSource: (request:MemoryConclusion & {sourceRoot:string},history=false)=>{
    if(typeof request.sourceRoot!=="string"||!path.isAbsolute(request.sourceRoot))throw new Error("来源会话缺少权威目录");
    return readConclusionEntries(request,history);
  },
  scopeDocument:db.scopeDocument.bind(db),
  editDocument:db.editDocument.bind(db),lookupReferences:db.lookupReferences.bind(db),nextRunAt:db.nextRunAt.bind(db),
  activateDue:db.activateDue.bind(db),
  save: db.save.bind(db), get: db.get.bind(db), query: db.query.bind(db), update: db.update.bind(db),
  revisions: db.revisions.bind(db), getRevision: db.getRevision.bind(db), forget: db.forget.bind(db), evaluate: db.evaluate.bind(db),
  enqueue: db.enqueue.bind(db), claim: db.claim.bind(db), finishJob: db.finishJob.bind(db), finishBatch: db.finishBatch.bind(db), failJob: db.failJob.bind(db), releaseJob: db.releaseJob.bind(db), skipJob: db.skipJob.bind(db), retryFailed: db.retryFailed.bind(db), reviveFailed: db.reviveFailed.bind(db),
  detachSession: db.detachSession.bind(db), invalidateSession: db.invalidateSession.bind(db), lookupSummaries: db.lookupSummaries.bind(db), status: db.status.bind(db), reserveUsage: db.reserveUsage.bind(db), metadata: db.metadata.bind(db), setMetadata: db.setMetadata.bind(db),
  projectEventCount: db.projectEventCount.bind(db),
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
