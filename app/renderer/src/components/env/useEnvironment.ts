import { useEffect, useState } from "react";
import {
  DEFAULT_ENVIRONMENT_STATE,
  type EnvItem,
  type EnvReport,
  type EnvironmentState,
} from "@shared/environment";

const SANDBOX_COMPONENTS = new Set(["bwrap", "socat", "rg", "userns"]);

export function waitingForBubblewrap(item: EnvItem, report: EnvReport | null): boolean {
  return item.id === "userns" && item.status === "unknown"
    && report?.items.some(dependency => dependency.id === "bwrap" && dependency.status !== "ok") === true;
}

export function requiredEnvironmentProblems(report: EnvReport | null, sandboxDisabled: boolean): EnvItem[] {
  return report?.items.filter(item => item.required && item.status !== "ok"
    && (!sandboxDisabled || !SANDBOX_COMPONENTS.has(item.id)) && !waitingForBubblewrap(item, report)) ?? [];
}

export function useEnvironment({ checkOnMount = false } = {}): EnvironmentState {
  const [state, setState] = useState(DEFAULT_ENVIRONMENT_STATE);
  useEffect(() => {
    const api = window.electronAPI?.env;
    if (!api) return;
    let active = true;
    const receive = (snapshot: EnvironmentState) => {
      if (active) setState(current => snapshot.revision >= current.revision ? snapshot : current);
    };
    const off = api.onChanged(receive);
    const request = checkOnMount ? api.probe() : api.state();
    void request.then(receive).catch(() => {
      if (active && checkOnMount) setState(current => current.revision === 0 ? { ...current, probeFailed: true } : current);
    });
    return () => { active = false; off(); };
  }, [checkOnMount]);
  return state;
}
