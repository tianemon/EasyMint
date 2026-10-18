import "../../../../../resources/visual-design/additional-styles.css";
import { useId, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { uiText } from "../../lib/i18n";
import { sampleStyle, type PreviewDevice, type StylePreset } from "./style-presets";
import { usePreviewScroll, type PreviewScrollMemory } from "./use-preview-scroll";
import { StyleArtwork } from "./StyleArtwork";
import { SampleSelect } from "./SampleSelect";
import "./style-preview.css";

import type { StyleEffect } from "./style-appearance";
import { SampleIcon as Icon } from "./SampleIcon";

/** Comparing styles/devices or opening the larger view must not discard sample input. */
export function useStyleSample() {
  const [done, setDone] = useState([true, false]);
  const [extraTasks, setExtraTasks] = useState<Array<{ title: string; done: boolean }>>([]);
  const [reminders, setReminders] = useState(true);
  const [task, setTask] = useState("");
  const [title, setTitle] = useState<string | null>(null);
  const [slug, setSlug] = useState("studio-notes");
  const [priority, setPriority] = useState("normal");
  const [notice, setNotice] = useState<{ kind: "success" | "error"; key: string; parameters?: Record<string, string> } | null>(null);
  const [section, setSection] = useState("grid");
  return { done, setDone, extraTasks, setExtraTasks, reminders, setReminders, task, setTask, title, setTitle, slug, setSlug, priority, setPriority, notice, setNotice, section, setSection };
}
type SampleController = ReturnType<typeof useStyleSample>;

function SamplePage({ preset, device, sample, showStates, viewport, effect, scrollMemory, projectName, projectDescription, previewActive }: { previewActive: boolean; scrollMemory?: PreviewScrollMemory; projectName?: string; projectDescription?: string; preset: StylePreset; device: PreviewDevice; sample: SampleController; effect: StyleEffect; showStates: boolean; viewport: { scale: number; height: number } }): JSX.Element {
  const { done, setDone, extraTasks, setExtraTasks, reminders, setReminders, task, setTask, title, setTitle, slug, setSlug, priority, setPriority, notice, setNotice, section, setSection } = sample;
  const taskRef = useRef<HTMLInputElement>(null);
  const slugRef = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const saveRef = useRef<HTMLButtonElement>(null);
  const noticeOrigin = useRef<HTMLElement | null>(null);
  const mainRef = useRef<HTMLElement>(null);
  const exampleRef = useRef<HTMLDivElement>(null);
  usePreviewScroll(mainRef, previewActive ? scrollMemory : undefined, `layout:${device}`, `${preset.id}:${viewport.scale}:${viewport.height}`);
  const projectTitle = title ?? (projectName?.trim() || uiText("creation.sample.projectValue"));
  const previousScroll = useRef(0);
  const previouslyShowingStates = useRef(false);
  useLayoutEffect(() => {
    const main = mainRef.current;
    if (!main || !viewport.scale || !main.offsetHeight) return;
    if (showStates && exampleRef.current) {
      if (!previouslyShowingStates.current) previousScroll.current = main.scrollTop;
      // backdrop-filter changes offsetParent. Compare viewport rects in one coordinate space,
      // then convert the movement back to unscaled scroll units (including modal transforms).
      const frame = main.getBoundingClientRect();
      const target = exampleRef.current.getBoundingClientRect();
      const scale = frame.height / main.offsetHeight;
      if (scale > 0) {
        const top = frame.top + (main.clientTop + 12) * scale;
        const bottom = frame.top + (main.clientTop + main.clientHeight - 12) * scale;
        if (target.height > bottom - top || target.top < top) main.scrollTop += (target.top - top) / scale;
        else if (target.bottom > bottom) main.scrollTop += (target.bottom - bottom) / scale;
      }
    } else if (previouslyShowingStates.current) main.scrollTop = previousScroll.current;
    previouslyShowingStates.current = showStates;
  }, [showStates, preset.id, device, viewport]);
  const slugErrorId = useId();
  const exampleErrorId = useId();
  const invalid = !/^[a-z0-9-]+$/.test(slug);
  const nav = [
    { id: "grid", label: uiText("creation.sample.overview") },
    { id: "folder", label: uiText("creation.sample.projects") },
    { id: "layers", label: uiText("creation.sample.assets") },
    { id: "settings", label: uiText("creation.sample.settings") },
  ] as const;
  const style = sampleStyle(preset) as CSSProperties;
  const navigation = nav.map((item) => <button key={item.id} type="button" className={`sample-nav-item ${section === item.id ? "is-active" : ""}`} aria-pressed={section === item.id} onClick={() => {
    setSection(item.id); setNotice(null);
    const main = mainRef.current;
    if (!main) return;
    if (item.id === "grid") { main.scrollTop = 0; return; }
    const anchor = item.id === "folder" ? "project" : item.id === "layers" ? "assets" : "settings";
    const target = main.querySelector<HTMLElement>(`[data-preview-anchor="${anchor}"]`);
    const scale = main.getBoundingClientRect().height / main.offsetHeight;
    if (target && scale) main.scrollTop += (target.getBoundingClientRect().top - main.getBoundingClientRect().top) / scale - 12;
    if (item.id === "settings") titleRef.current?.focus({ preventScroll: true });
  }}><Icon name={item.id} /><span>{item.label}</span></button>);
  const completed = done.filter(Boolean).length + extraTasks.filter((item) => item.done).length;
  const total = done.length + extraTasks.length;
  const progress = Math.round(completed / total * 100);
  const addTask = () => {
    const name = task.trim();
    if (!name) { taskRef.current?.focus(); return; }
    setExtraTasks((current) => [...current, { title: name, done: false }]);
    setTask("");
    noticeOrigin.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setNotice({ kind: "success", key: "creation.sample.taskAdded", parameters: { name } });
  };
  const saveSample = () => {
    noticeOrigin.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setNotice({ kind: invalid ? "error" : "success", key: invalid ? "creation.sample.urlError" : "creation.sample.saved" });
    if (invalid) slugRef.current?.focus();
  };
  const closeNotice = () => {
    setNotice(null);
    const origin = noticeOrigin.current?.isConnected ? noticeOrigin.current : saveRef.current;
    origin?.focus();
  };
  return (
    <div className="sample-app" data-style={preset.id} data-device={device} data-effect={effect} data-palette={preset.appearance?.palette ?? "default"} style={style}>
      <aside className="sample-sidebar">
        <div className="sample-brand"><span className="sample-brand-mark"><Icon name="layers" /></span>MINT<span className="sample-brand-detail">STUDIO</span></div>
        <div className="sample-sidebar-label">{uiText("creation.sample.workspace")}</div>
        <nav aria-label={uiText("creation.sample.navigation")}>{navigation}</nav>
        <div className="sample-sidebar-note"><span className="sample-avatar">M</span><div><strong>{uiText("creation.sample.personal")}</strong><small>{uiText("creation.sample.freePlan")}</small></div></div>
      </aside>
      <div className="sample-workspace">
        <header className="sample-topbar"><span className="sample-breadcrumb">{uiText("creation.sample.workspace")}<i>/</i><strong>{nav.find((item) => item.id === section)?.label}</strong></span><span className="sample-mobile-brand"><Icon name="layers" />MINT</span><span className="sample-avatar">M</span></header>
        <main ref={mainRef} className="sample-main">
          <div className="sample-hero" data-preview-anchor="overview"><div><span className="sample-overline">{uiText("creation.sample.today")}</span><h2>{uiText("creation.sample.heading")}</h2><p>{uiText("creation.sample.subheading")}</p></div><button type="button" className="sample-button sample-primary" onClick={() => taskRef.current?.focus()}><Icon name="plus" />{uiText("creation.sample.newTask")}</button></div>
          <section className="sample-feature" data-preview-anchor="project" aria-label={uiText("creation.sample.featureLabel")}>
            <div className="sample-feature-copy"><span className="sample-overline">{uiText("creation.sample.featureKicker")}</span><h3>{projectTitle}</h3><p>{(projectDescription?.trim() || uiText("creation.sample.featureDescription"))}</p><div className="sample-feature-progress"><span>{uiText("creation.sample.taskSummary", { done: completed, total })}</span><span>{progress}%</span><i><b style={{ width: `${progress}%` }} /></i></div><button type="button" className="sample-feature-link" onClick={() => titleRef.current?.focus()}>{uiText("creation.sample.continueEditing")}<span aria-hidden="true">↗</span></button></div>
            <StyleArtwork preset={preset} progress={progress} anchor="assets" />
          </section>
          <div className="sample-content">
            <section className="sample-card sample-tasks">
              <div className="sample-section-title"><h3>{uiText("creation.sample.tasks")}</h3><span className="sample-badge">{String(2 + extraTasks.length).padStart(2, "0")}</span></div>
              <div className="sample-task-list">
                {[uiText("creation.sample.taskOne"), uiText("creation.sample.taskTwo")].map((text, index) => <label className={`sample-task ${done[index] ? "is-done" : ""}`} key={index}><input type="checkbox" checked={done[index]} onChange={() => { setDone((current) => current.map((value, i) => i === index ? !value : value)); setNotice(null); }} /><span>{text}<small>{uiText(done[index] ? "creation.sample.taskDone" : "creation.sample.taskOpen")}</small></span></label>)}
                {extraTasks.map((item, index) => <label className={`sample-task ${item.done ? "is-done" : ""}`} key={`added-${index}`}><input type="checkbox" checked={item.done} onChange={() => { setExtraTasks((current) => current.map((value, i) => i === index ? { ...value, done: !value.done } : value)); setNotice(null); }} /><span>{item.title}</span></label>)}
              </div>
              <label className="sample-field sample-add-field"><span>{uiText("creation.sample.taskName")}</span><div className="sample-add-row"><input ref={taskRef} value={task} onChange={(event) => setTask(event.target.value)} placeholder={uiText("creation.sample.taskPlaceholder")} onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); addTask(); } }} /><button type="button" className="sample-button sample-secondary" aria-label={uiText("creation.sample.addTask")} onClick={addTask}><Icon name="plus" /></button></div></label>
              <p className="sample-task-summary">{uiText("creation.sample.taskSummary", { done: completed, total })}</p>
            </section>
            <section className="sample-preferences" data-preview-anchor="settings">
              <div className="sample-section-title"><h3>{uiText("creation.sample.projectSettings")}</h3></div>
              <div className="sample-form-grid">
                <label className="sample-field sample-name-field"><span>{uiText("creation.sample.projectName")}</span><input ref={titleRef} value={projectTitle} onChange={(event) => { setTitle(event.target.value); setNotice(null); }} /></label>
                <SampleSelect label={uiText("creation.sample.priority")} value={priority} onChange={(value) => { setPriority(value); setNotice(null); }} options={[{ value: "normal", label: uiText("creation.sample.normal") }, { value: "high", label: uiText("creation.sample.high") }, { value: "low", label: uiText("creation.sample.low") }]} adornment={priority === "high" ? <b className="sample-priority-flag" aria-hidden="true">!</b> : undefined} />
                <label className="sample-field sample-slug-field"><span>{uiText("creation.sample.projectUrl")}</span><input ref={slugRef} aria-label={uiText("creation.sample.projectUrl")} aria-describedby={invalid ? slugErrorId : undefined} value={slug} spellCheck={false} autoCapitalize="none" aria-invalid={invalid} onChange={(event) => { setSlug(event.target.value); setNotice(null); }} /><small id={slugErrorId} className={`sample-error ${invalid ? "has-error" : ""}`}>{invalid ? uiText("creation.sample.urlError") : "\u00a0"}</small></label>
              </div>
              <div className="sample-toggle-row"><span>{uiText("creation.sample.reminders")}</span><button type="button" role="switch" className="sample-switch" aria-label={uiText("creation.sample.reminders")} aria-checked={reminders} onClick={() => { setReminders(!reminders); setNotice(null); }}><i /></button></div>
              <div className="sample-form-actions"><button ref={saveRef} type="button" className="sample-button sample-secondary" onClick={saveSample}>{uiText("creation.sample.save")}</button>{showStates && <button type="button" className="sample-button sample-secondary" disabled>{uiText("creation.sample.archive")}</button>}</div>
              {showStates && <div ref={exampleRef} className="sample-state-examples"><label className="sample-field"><span>{uiText("creation.sample.errorExample")}</span><input value="mint notes" readOnly tabIndex={-1} aria-invalid="true" aria-describedby={exampleErrorId} /><small id={exampleErrorId} className="sample-error has-error">{uiText("creation.sample.urlError")}</small></label><span className="sample-dialog-label">{uiText("creation.sample.dialogExample")}</span><div className="sample-dialog-example" role="group" aria-label={uiText("creation.sample.dialogExample")}><strong>{uiText("creation.sample.dialogTitle")}</strong><p>{uiText("creation.sample.dialogDescription")}</p><div><button type="button" className="sample-button sample-secondary" onClick={() => setNotice(null)}>{uiText("creation.sample.cancel")}</button><button type="button" className="sample-button sample-primary" onClick={saveSample}>{uiText("creation.sample.confirm")}</button></div></div></div>}
            </section>
          </div>
        </main>
        {device === "mobile" && <nav className="sample-bottom-nav" aria-label={uiText("creation.sample.navigation")}>{navigation}</nav>}
      </div>
      <div className="sample-feedback" data-kind={notice?.kind} hidden={!notice} role="status"><span className="sample-feedback-symbol" aria-hidden="true"><Icon name={notice?.kind === "error" ? "alert" : "check"} /></span><span>{notice ? uiText(notice.key, notice.parameters) : ""}</span><button type="button" aria-label={uiText("common.close")} onClick={closeNotice}><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m4 4 8 8m0-8-8 8" /></svg></button></div>
    </div>
  );
}

export function StylePreview({ preset, device, interactive = false, inline = false, showStates = false, sample, effect = "standard", fluid = false, scrollMemory, projectName, projectDescription, previewActive = true }: { previewActive?: boolean; scrollMemory?: PreviewScrollMemory; projectName?: string; projectDescription?: string; preset: StylePreset; device: PreviewDevice; interactive?: boolean; inline?: boolean; fluid?: boolean; showStates?: boolean; sample?: SampleController; effect?: StyleEffect }): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  const localSample = useStyleSample();
  const [viewport, setViewport] = useState({ scale: 0, width: device === "web" ? 800 : 360, height: device === "web" ? 640 : 760 });
  const width = device === "web" ? 800 : 360;
  const height = device === "web" ? (inline ? 480 : 640) : (inline ? 520 : 760);
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const measure = () => {
      if (fluid) {
        const nextWidth = host.clientWidth;
        const nextHeight = host.clientHeight;
        const scale = nextWidth > 0 && nextHeight > 0 ? 1 : 0;
        setViewport((current) => current.width === nextWidth && current.height === nextHeight && current.scale === scale ? current : { scale, width: nextWidth, height: nextHeight });
        return;
      }
      // Interactive mobile previews keep readable controls and scroll instead of shrinking to fit.
      const fitWidth = inline || (interactive && device === "mobile");
      const scale = Math.max(0, Math.min((host.clientWidth - 24) / width, fitWidth ? 1 : (host.clientHeight - 24) / height, 1));
      const nextHeight = fitWidth && scale ? Math.max(240, (host.clientHeight - 24) / scale) : height;
      setViewport((current) => current.scale === scale && current.width === width && current.height === nextHeight ? current : { scale, width, height: nextHeight });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    return () => observer.disconnect();
  }, [width, height, inline, device, interactive, fluid]);
  return <div ref={hostRef} className={`style-preview ${interactive ? "is-interactive" : ""} ${inline ? "is-inline" : ""} ${fluid ? "is-fluid" : ""}`} data-device={device} aria-hidden={interactive ? undefined : true} inert={!interactive}><div className="style-preview-artboard" style={{ width: viewport.width, height: viewport.height, transform: `translate(-50%, -50%) scale(${viewport.scale})`, visibility: viewport.scale ? "visible" : "hidden" }}><SamplePage previewActive={previewActive} scrollMemory={scrollMemory} projectName={projectName} projectDescription={projectDescription} effect={effect} preset={preset} device={device} sample={sample ?? localSample} showStates={showStates} viewport={viewport} /></div></div>;
}
