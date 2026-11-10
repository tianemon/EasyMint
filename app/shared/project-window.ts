/** Carry the window origin through the hash route until the initial page loads. */
export function projectWindowRoute(projectId: string, options: { sessionId?: string; init?: boolean; remote?: boolean }): string {
  const params = new URLSearchParams();
  if (options.sessionId) params.set("session", options.sessionId);
  if (options.init) params.set("init", "1");
  params.set("fresh", "1");
  if (options.remote) params.set("remote", "1");
  return `/project/${projectId}?${params.toString()}`;
}

export function shouldRememberProject(search: string): boolean {
  return new URLSearchParams(search).get("remote") !== "1";
}
