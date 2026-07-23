import { useSettingsStore } from "../stores/settings-store";

/** 获取 workspace 目录路径（无项目时 fallback） */
export function getWorkspaceDir(): string {
  const base = useSettingsStore.getState().defaultProjectDir || "~/EasyMintProject";
  return `${base.replace(/\/$/, "")}/workspace`;
}
