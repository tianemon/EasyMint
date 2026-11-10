import type { ModelCapabilities, OpenProject } from '../protocol/types';

type ProjectClient = {
  command<T>(command: 'capability.models' | 'project.list' | 'project.listOpen'): Promise<T>;
};

/** Old desktop servers close the socket on unknown commands, so negotiate before sending one. */
export async function listRemoteProjects(client: ProjectClient): Promise<OpenProject[]> {
  const capabilities = await client.command<ModelCapabilities>('capability.models');
  if (capabilities.features?.projectBrowse) return client.command<OpenProject[]>('project.list');
  const open = await client.command<OpenProject[]>('project.listOpen');
  return open.map((project) => ({ ...project, open: true }));
}
