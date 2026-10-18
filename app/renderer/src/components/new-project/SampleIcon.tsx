export type IconName = "grid" | "folder" | "layers" | "settings" | "plus" | "check" | "alert";
export function SampleIcon({ name }: { name: IconName }): JSX.Element {
  const paths: Record<IconName, string> = { grid: "M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z", folder: "M3 7V5h6l2 2h10v13H3z", layers: "m12 3 10 5-10 5L2 8zM2 12l10 5 10-5M2 16l10 5 10-5", settings: "M4 7h16M4 17h16M8 4v6M16 14v6", plus: "M12 5v14M5 12h14", check: "m5 12 4 4L19 6", alert: "M12 8v5m0 3h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0" };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}
