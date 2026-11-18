import { useEffect, useRef, useState } from "react";
import type { EnvItem, EnvReport, EnvironmentState } from "@shared/environment";
import { appText, uiText, useUiLocale } from "../../lib/i18n";
import { useSettingsStore } from "../../stores/settings-store";
import { confirmDialog } from "../ui/ConfirmDialog";
import { toast } from "../ui/Toast";
import { requiredEnvironmentProblems, useEnvironment, waitingForBubblewrap } from "./useEnvironment";

type AutoAction = "pkg" | "userns" | "windowsRuntime";
const attemptedAutomaticRepairs = new Set<AutoAction>();

export function nextAutoAction(s: {
  autoFix: boolean;
  hasReport: boolean;
  probeFailed: boolean;
  probing: boolean;
  installing: boolean;
  sandboxDisabled: boolean;
  installableCount: number;
  runtimeCount?: number;
  fixableCount: number;
  done: ReadonlySet<AutoAction>;
}): AutoAction | null {
  if (!s.autoFix || !s.hasReport || s.probeFailed || s.probing || s.installing) return null;
  if (s.runtimeCount) return s.done.has("windowsRuntime") ? null : "windowsRuntime";
  if (s.sandboxDisabled) return null;
  if (s.installableCount > 0) return s.done.has("pkg") ? null : "pkg";
  if (s.fixableCount > 0) return s.done.has("userns") ? null : "userns";
  return null;
}

type Row = Omit<EnvItem, "id"> & { id: string; description?: string };

function useDevelopmentTools(report: EnvReport | null) {
  const [tools, setTools] = useState<Row[]>([]);
  const probedAt = report?.probedAt;
  useEffect(() => {
    const api = window.electronAPI;
    if (!api || probedAt === undefined) return;
    let active = true;
    const specs = [
      ...(api.platform === "win32" ? [] : [{ id: "git" as const, label: "Git", url: "https://git-scm.com/downloads" }]),
      { id: "nodeRuntime" as const, label: "Node.js", url: "https://nodejs.org/" },
      { id: "codegraph" as const, label: "CodeGraph" },
    ];
    void Promise.all(specs.map(async ({ id, label, url }): Promise<Row> => {
      const info = await api[id]?.detect().catch(() => ({ found: false, reason: "probe-error" as const }));
      const status = info?.found ? "ok" : (!info || ("reason" in info && info.reason === "probe-error")) ? "unknown" : "missing";
      return { id, label, required: false, status, version: info && "version" in info ? info.version : undefined,
        fix: status === "missing" && url ? { manual: { url } } : {} };
    })).then(rows => { if (active) setTools(rows); });
    return () => { active = false; };
  }, [probedAt]);
  return tools;
}

function rowForItem(item: EnvItem): Row {
  switch (item.id) {
    case "windowsRuntime": return { ...item, label: uiText("environment.runtime"), description: uiText("environment.runtimeDescription") };
    case "winSandbox": return { ...item, label: uiText("environment.protection"), description: uiText("environment.protectionDescription") };
    case "bwrap": return { ...item, label: "bubblewrap", description: uiText("environment.bwrapDescription") };
    case "socat": return { ...item, label: "socat", description: uiText("environment.socatDescription") };
    case "rg": return { ...item, label: "ripgrep", description: uiText("environment.rgDescription") };
    case "userns": return { ...item, label: uiText("environment.isolation"), description: uiText("environment.isolationDescription") };
    default: return item;
  }
}

const developerDescriptions = {
  git: "environment.gitDescription",
  nodeRuntime: "environment.nodeDescription",
  codegraph: "environment.codegraphDescription",
} as const;

const actionStyle = "settings-action settings-action--compact";
const primaryAction = `${actionStyle} btn-accent`;

function installable(item: EnvItem, strategy: NonNullable<EnvItem["fix"]["auto"]>["strategy"]) {
  if (item.fix.auto?.strategy !== strategy) return false;
  if (strategy === "windowsRuntime") return item.status !== "ok";
  return item.status === (strategy === "usernsProfile" ? "blocked" : "missing");
}

function phaseLabel(operation: NonNullable<EnvironmentState["operation"]>) {
  if (operation.cancelling) return uiText("environment.cancelling");
  if (operation.phase === "installing") return uiText(operation.ids.some(id => id === "windowsRuntime" || id === "userns") ? "ui.EnvPanel.repairing" : "ui.EnvPanel.installing");
  if (operation.phase === "verifying") return uiText("environment.verifying");
  return uiText("environment.preparing");
}

export function EnvPanel({ variant = "settings", autoFix = false, onReady, waitForUser = false, focusId }: {
  variant?: "settings" | "onboarding";
  autoFix?: boolean;
  onReady?: () => void;
  waitForUser?: boolean;
  focusId?: string;
}): JSX.Element {
  useUiLocale();
  const isOnboarding = variant === "onboarding";
  const snapshot = useEnvironment({ checkOnMount: true });
  const { report, checking, probeFailed, operation, failures } = snapshot;
  const tools = useDevelopmentTools(report);
  const sandboxDisabled = useSettingsStore(s => s.sandboxDisabled);
  const setSandboxDisabled = useSettingsStore(s => s.setSandboxDisabled);
  const [expanded, setExpanded] = useState<string>();
  const [authorizedSelection, setAuthorizedSelection] = useState<string[]>();
  const [minElapsed, setMinElapsed] = useState(!autoFix);
  const started = useRef(false);
  const readySent = useRef(false);
  const focusRow = useRef<HTMLLIElement>(null);
  const focused = useRef<string | undefined>(undefined);
  const items = report?.items.filter(item => !isOnboarding || item.id !== "winSandbox") ?? [];
  const authorization = !operation && authorizedSelection?.every(id => items.some(item => {
    const strategy = item.fix.auto?.strategy;
    return item.id === id && strategy && installable(item, strategy);
  })) ? authorizedSelection : undefined;
  const packages = items.filter(item => installable(item, "pkg"));
  const portable = items.find(item => installable(item, "windowsRuntime"));
  const userns = items.find(item => installable(item, "usernsProfile"));
  const problems = requiredEnvironmentProblems(report, sandboxDisabled);
  const autoAction = nextAutoAction({
    autoFix, hasReport: Boolean(report), probeFailed, probing: checking, installing: Boolean(operation), sandboxDisabled,
    installableCount: packages.length, runtimeCount: portable ? 1 : 0, fixableCount: userns ? 1 : 0, done: attemptedAutomaticRepairs,
  });

  async function run(ids: string[]) {
    if (started.current) return;
    started.current = true;
    setAuthorizedSelection(undefined);
    try {
      const api = window.electronAPI.env;
      if (ids[0] === "userns") await api.fixUserns();
      else await api.install(ids);
    } catch (error) {
      toast(appText(error instanceof Error ? error.message : String(error)));
    } finally {
      started.current = false;
    }
  }

  useEffect(() => {
    if (!autoAction || started.current) return;
    const ids = autoAction === "pkg" ? packages.map(item => item.id)
      : autoAction === "windowsRuntime" ? ["windowsRuntime"] : ["userns"];
    attemptedAutomaticRepairs.add(autoAction);
    void run(ids);
  });

  useEffect(() => {
    if (!autoFix) return;
    const timer = setTimeout(() => setMinElapsed(true), 5000);
    return () => clearTimeout(timer);
  }, [autoFix]);

  const ready = Boolean(report && !checking && !probeFailed && !operation && !autoAction && problems.length === 0);
  useEffect(() => {
    if (!readySent.current && ready && minElapsed && onReady) {
      readySent.current = true;
      onReady();
    }
  }, [ready, minElapsed, onReady]);

  useEffect(() => {
    if (operation) setAuthorizedSelection(undefined);
  }, [operation]);

  const targetPresent = items.some(item => item.id === focusId);
  useEffect(() => {
    if (!focusId || !targetPresent || focused.current === focusId) return;
    const row = focusRow.current;
    if (!row) return;
    focused.current = focusId;
    row.closest(".environment-panel")?.scrollIntoView?.({ block: "start" });
    row.scrollIntoView?.({ block: "nearest" });
    row.focus({ preventScroll: true });
  }, [focusId, targetPresent]);

  async function setSandbox() {
    if (sandboxDisabled) { setSandboxDisabled(false); return; }
    const confirmed = await confirmDialog({
      title: uiText("ui.EnvPanel.disableSandboxMode"),
      message: uiText("ui.EnvPanel.commandsWillNoLongerHaveOsLevel")
        + uiText("ui.EnvPanel.onlyLimitedPreflightChecksRemainStructuredFile")
        + uiText("ui.EnvPanel.youCanInstallTheComponentsLaterUnder"),
      confirmText: uiText("ui.EnvPanel.iUnderstandDisableSandbox"),
      danger: true,
    });
    if (confirmed) setSandboxDisabled(true);
  }

  const locked = checking || probeFailed || Boolean(operation || authorization);
  const disabled = Boolean(operation || authorization);
  const phase = operation ? phaseLabel(operation) : "";
  const initialCheck = !report && !probeFailed && !operation;
  const quietReady = isOnboarding && ready && onReady && (!minElapsed || !waitForUser);
  const showList = !initialCheck && !quietReady;
  const sandboxItem = items.find(item => item.id === "userns");
  const summary = probeFailed ? uiText("settings.detectFailed")
    : checking || !report ? uiText("settings.detecting")
    : problems.length ? uiText("environment.needsAttention", { v0: problems.length }) : uiText(sandboxDisabled && sandboxItem ? "environment.sandboxDisabled" : "messages.environmentReady");
  const runtimeProblem = problems.some(item => item.id === "windowsRuntime");
  const sandboxControl = Boolean(sandboxItem?.fix.sandboxOff && !sandboxDisabled);
  const requiredRows = items.filter(item => item.required).map(rowForItem);
  const optionalRows = [...items.filter(item => !item.required).map(rowForItem), ...tools.map(row => ({
    ...row, description: uiText(developerDescriptions[row.id as keyof typeof developerDescriptions]),
    detail: row.id === "codegraph" && row.status !== "ok" ? uiText("environment.codegraphLocation") : undefined,
  }))];
  const confirmIds = (ids: string[]) => setAuthorizedSelection(ids);

  function renderRow(row: Row) {
    const current = items.find(item => item.id === row.id);
    const pending = operation?.ids.includes(row.id);
    const failure = failures.find(entry => entry.ids.includes(row.id));
    const failed = Boolean(failure);
    const authorizationHere = authorization?.[0] === row.id;
    const open = expanded === row.id;
    const waiting = current && waitingForBubblewrap(current, report);
    const status = pending ? phase : failed && row.status !== "ok" ? uiText("environment.repairIncomplete")
      : waiting ? uiText("environment.awaitingVerification") : row.status === "ok" ? uiText("environment.ready")
      : row.status === "unknown" ? uiText(row.repairNeeded ? "environment.needsRepair" : "settings.detectFailed")
      : row.status === "blocked" ? uiText("ui.EnvPanel.blockedBySystemPolicy")
      : uiText("settings.notInstalled");
    const strategy = row.fix.auto?.strategy;
    const canInstall = Boolean(current && strategy && installable(current, strategy));
    const repair = strategy === "windowsRuntime" || strategy === "usernsProfile";
    const label = failed ? uiText("environment.retry") : uiText(repair ? "environment.repair" : "environment.install");
    const manual = row.fix.manual;
    const showFailure = failure?.ids[0] === row.id;
    const command = (showFailure ? failure.manualCommand : undefined) ?? manual?.command;
    const reason = showFailure ? failure.reason : undefined;
    const description = [row.description, row.status === "ok" ? row.version : undefined].filter(Boolean).join(" · ");
    const hasDetails = Boolean(row.detail || row.impact || manual || reason || command || (row.id === "userns" && sandboxControl));
    const directDownload = !canInstall && manual?.url && !manual.command && !row.required;
    const onAction = () => {
      if (strategy === "windowsRuntime") void run([row.id]);
      else confirmIds([row.id]);
    };
    return (
      <li key={row.id} data-environment-id={row.id} ref={row.id === focusId ? focusRow : undefined}
        tabIndex={row.id === focusId ? -1 : undefined}
        className={`environment-row ${row.id === focusId && row.status !== "ok" ? "environment-row-target" : ""}`}>
        <div className="environment-row-main">
          <div className="environment-component">
            <p className="text-sm font-medium text-text-primary">{row.label}</p>
            {description && <p className="text-xs text-text-secondary">{description}</p>}
          </div>
          <span className={`environment-status ${pending || waiting ? "" : row.status === "ok" ? "environment-status-ready" : failed ? "text-danger" : row.required ? "environment-status-warning" : ""}`}>{status}</span>
          <div className="environment-actions">
            {pending && operation?.cancellable && row.id === operation.ids[0] && (
              <button type="button" className={actionStyle} data-tone="quiet" disabled={operation.cancelling} onClick={() => void window.electronAPI.env.cancel()}>{uiText("common.cancel")}</button>
            )}
            {!pending && canInstall && (
              <button type="button" className={row.required ? primaryAction : actionStyle} onClick={onAction} disabled={locked}>{label}</button>
            )}
            {!pending && directDownload && (
              <a className={actionStyle} href={manual.url} target="_blank" rel="noopener noreferrer">{uiText("ui.EnvPanel.download")}</a>
            )}
            {!pending && hasDetails && !directDownload && (
              <button type="button" className={actionStyle} data-tone="quiet" aria-expanded={open}
                aria-label={uiText(open ? "environment.hideComponentDetails" : "environment.showComponentDetails", { name: row.label })}
                onClick={() => setExpanded(open ? undefined : row.id)}>{uiText(open ? "environment.hideDetails" : "environment.details")}</button>
            )}
          </div>
        </div>
        {pending && <div className="environment-row-detail">
          {operation?.message && row.id === operation.ids[0] && <p className="break-words">{appText(operation.message)}</p>}
          <div className="environment-progress" role="progressbar" aria-label={`${row.label} ${phase}`} />
        </div>}
        {!pending && (open || authorizationHere || reason || (failed && command)) && (
          <div className="environment-row-detail">
            {reason && <p className="break-words">{appText(reason)}</p>}
            {authorizationHere && <>
              <p>{uiText("environment.authorization")}</p>
              <div className="flex flex-wrap gap-1.5">
                <button type="button" className={primaryAction} disabled={checking || probeFailed} onClick={() => void run(authorization)}>{uiText("environment.continue")}</button>
                <button type="button" className={actionStyle} data-tone="quiet" onClick={() => setAuthorizedSelection(undefined)}>{uiText("common.cancel")}</button>
              </div>
            </>}
            {open && row.status !== "ok" && row.impact && <p>{appText(row.impact)}</p>}
            {open && row.detail && <p className="break-words">{appText(row.detail)}</p>}
            {(open || failed) && command && <div className="space-y-1">
              <pre className="environment-command">{command}</pre>
              <button type="button" className={actionStyle} onClick={() => void navigator.clipboard.writeText(command)
                .then(() => toast(uiText("environment.copied"))).catch(() => toast(uiText("environment.copyFailed")))}>{uiText("environment.copyCommand")}</button>
              {manual?.url && <a className={actionStyle} href={manual.url} target="_blank" rel="noopener noreferrer">{uiText("ui.EnvPanel.officialInstructions")}</a>}
            </div>}
            {open && !command && manual?.url && <a className={actionStyle} href={manual.url} target="_blank" rel="noopener noreferrer">{uiText("ui.EnvPanel.download")}</a>}
            {open && row.id === "userns" && sandboxControl && (
              <button type="button" className={actionStyle} data-tone="danger" disabled={disabled}
                onClick={() => void setSandbox()}>{uiText("ui.EnvPanel.runWithoutSandbox")}</button>
            )}
          </div>
        )}
      </li>
    );
  }

  return (
    <section className={`environment-panel ${isOnboarding ? "environment-onboarding" : ""}`} aria-label={uiText("settings.environment")}>
      <div className="environment-heading">
        <h2 className={isOnboarding ? "text-xl font-semibold" : "text-sm font-medium text-text-primary"}>
          {uiText(isOnboarding ? "onboarding.environment" : "settings.environment")}
        </h2>
        {!isOnboarding && <button type="button" className={actionStyle} disabled={checking || disabled}
          onClick={() => void window.electronAPI.env.retest().catch(() => toast(uiText("settings.detectFailed")))}>{uiText("ui.EnvRetestButton.checkAgain")}</button>}
      </div>
      {isOnboarding && (initialCheck || quietReady) ? <div className="environment-progress" role="progressbar" aria-label={uiText("settings.detecting")} /> : (
        <div className="environment-summary" data-warning={probeFailed || problems.length > 0 || Boolean(sandboxDisabled && sandboxItem)} role="status">
          <strong>{summary}</strong>
          {!operation && !checking && !probeFailed && problems.length > 0 && (
            <span>{uiText(runtimeProblem ? "environment.runtimeImpact" : "environment.linuxImpact")}</span>
          )}
          {!operation && probeFailed && report && <span>{uiText("environment.previousReport")}</span>}
        </div>
      )}
      {showList && requiredRows.length > 0 && (
        <section className="environment-group" aria-label={uiText("environment.required")}>
          <div className="environment-group-heading">
            <h3>{uiText("environment.required")}</h3>
            {sandboxItem && sandboxDisabled && <button type="button" className={actionStyle} disabled={disabled} onClick={() => void setSandbox()}>{uiText("ui.EnvPanel.reEnableSandbox")}</button>}
            {packages.length > 1 && !sandboxDisabled && !operation && <button type="button" className={actionStyle} disabled={locked}
              onClick={() => confirmIds(packages.map(item => item.id))}>{uiText("environment.installMissing")}</button>}
          </div>
          <ul className="environment-list">{requiredRows.map(renderRow)}</ul>
        </section>
      )}
      {showList && optionalRows.length > 0 && (
        <section className="environment-group" aria-label={uiText(requiredRows.length ? "environment.optional" : "environment.developmentTools")}>
          <div className="environment-group-heading"><h3>{uiText(requiredRows.length ? "environment.optional" : "environment.developmentTools")}</h3></div>
          <ul className="environment-list">{optionalRows.map(renderRow)}</ul>
        </section>
      )}
    </section>
  );
}
