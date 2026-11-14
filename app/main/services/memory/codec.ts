import { createHash } from "node:crypto";
export function hashText(text:string|Uint8Array):string { return createHash("sha256").update(text).digest("hex"); }
export function scopeKey(projectId?:string):string { return projectId ? `project:${projectId}` : "global"; }
export function memoryDay(date=new Date(),timeZone?:string):string {
  const parts=new Intl.DateTimeFormat("en-CA",{timeZone,year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(date);
  const value=(type:string)=>parts.find(part=>part.type===type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}
