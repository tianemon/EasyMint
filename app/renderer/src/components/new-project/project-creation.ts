import type { ProjectFormData } from "./ProjectFormTypes";

/** A recovery hint only. The registered project must be checked before it is reused. */
export interface PendingCreation {
  projectId: string;
  projectPath: string;
  name: string;
  baseDir: string;
  directoryName: string;
}

export function parsePendingCreation(value: unknown): PendingCreation | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const fields = ["projectId", "projectPath", "name", "baseDir", "directoryName"] as const;
  if (!fields.every(key => typeof record[key] === "string" && record[key].trim())) return undefined;
  return Object.fromEntries(fields.map(key => [key, record[key]])) as unknown as PendingCreation;
}

export function matchesCreationInput(record: PendingCreation | undefined, data: Pick<ProjectFormData, "name" | "dir">): boolean {
  const base = (dir: string) => dir.trim().replace(/[\\/]+$/, "");
  return !!record && record.name === data.name.trim() && base(record.baseDir) === base(data.dir);
}

export function isRecoverableProject(record: PendingCreation, project: (Project & { exists?: boolean }) | undefined): project is Project & { exists: true } {
  return !!project && project.exists === true && project.id === record.projectId
    && project.path === record.projectPath && project.name === record.name && project.status === "setup"
    && project.path.split(/[\\/]/).at(-1) === record.directoryName;
}

interface CreationAPI {
  get(id: string): Promise<(Project & { exists?: boolean }) | undefined>;
  create(options: { name: string; path: string; directoryName: string }): Promise<Project>;
}

/** Shared by guided and direct creation; never reuse a project for a different input identity. */
export async function prepareCreationProject(
  data: Pick<ProjectFormData, "name" | "dir">,
  pending: PendingCreation | undefined,
  api: CreationAPI,
  resolveDirectoryName: (name: string) => Promise<string>,
): Promise<{ project: Project; pending: PendingCreation } | null> {
  if (matchesCreationInput(pending, data) && pending) {
    const project = await api.get(pending.projectId);
    return isRecoverableProject(pending, project) ? { project, pending } : null;
  }
  const directoryName = await resolveDirectoryName(data.name);
  const project = await api.create({ name: data.name.trim(), path: data.dir.trim(), directoryName });
  return { project, pending: { projectId: project.id, projectPath: project.path,
    name: data.name.trim(), baseDir: data.dir.trim(), directoryName } };
}

/** Inputs consumed by feature recommendation. Manual feature edits do not invalidate a response. */
export function recommendationContextChanged(previous: ProjectFormData, patch: Partial<ProjectFormData>): boolean {
  return (["name", "description", "scene", "targets"] as const)
    .some(key => key in patch && JSON.stringify(previous[key]) !== JSON.stringify(patch[key]));
}
