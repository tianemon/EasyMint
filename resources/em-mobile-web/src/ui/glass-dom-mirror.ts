import { renderFilter, renderContour } from '../../../../app/shared/visual-design/liquid-dom-optics.mjs';

const SVG_NS = 'http://www.w3.org/2000/svg';
const groups = new Map<HTMLElement, MirrorGroup>();
let serial = 0;
type Item = { node: HTMLElement; x: number; y: number; width: number; height: number };
type Surface = {
  node: HTMLElement; layer: HTMLDivElement; optics: HTMLDivElement; scene: HTMLDivElement;
  viewport: HTMLDivElement; column: HTMLElement; contour: HTMLCanvasElement;
  filter: SVGFilterElement; svg: SVGSVGElement; geometry: string;
  copies: Map<HTMLElement, { node: HTMLElement; version: number; rowVersion: number }>; ambientVersion: number;
};

/** Only the read-only visible band is cloned; real controls stay in their original tree. */
export function cloneMirrorNode(source: HTMLElement, prefix: string): HTMLElement {
  const clone = source.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('script,iframe,object,embed,[data-liquid-mirror-layer]').forEach(node => node.remove());
  const elements: Element[] = [clone, ...clone.querySelectorAll('*')];
  const ids = new Map<string, string>();
  for (const element of elements) {
    if (element.id) { const id = `${prefix}-${ids.size}`; ids.set(element.id, id); element.id = id; }
    element.removeAttribute('name'); element.removeAttribute('autofocus');
    element.removeAttribute('data-liquid-glass'); element.removeAttribute('data-liquid-ready');
    for (const attr of [...element.attributes]) if (/^on/i.test(attr.name)) element.removeAttribute(attr.name);
    if (element.matches('input,textarea,select,button,a,[tabindex]')) element.setAttribute('tabindex', '-1');
  }
  for (const element of elements) for (const attr of [...element.attributes]) {
    let value = attr.value;
    for (const [oldId, newId] of ids) {
      value = value.replaceAll(`url(#${oldId})`, `url(#${newId})`);
      if ((attr.name === 'href' || attr.name === 'xlink:href') && value === `#${oldId}`) value = `#${newId}`;
    }
    if (value !== attr.value) element.setAttribute(attr.name, value);
  }
  return clone;
}
function updateStyles(element: HTMLElement, styles: Partial<CSSStyleDeclaration>): void {
  for (const [key, value] of Object.entries(styles)) {
    const property = key as keyof CSSStyleDeclaration;
    if (element.style[property] !== value) (element.style as unknown as Record<string, string>)[key] = String(value);
  }
}
function syncLiveState(source: HTMLElement, clone: HTMLElement): void {
  const originals = [source, ...source.querySelectorAll<HTMLElement>('*')];
  const copies = [clone, ...clone.querySelectorAll<HTMLElement>('*')];
  // Match by traversal only when sanitization did not remove a subtree.
  if (originals.length !== copies.length) return;
  originals.forEach((original, index) => {
    const copy = copies[index];
    if (original instanceof HTMLInputElement && copy instanceof HTMLInputElement) { copy.value = original.value; copy.checked = original.checked; }
    if (original instanceof HTMLTextAreaElement && copy instanceof HTMLTextAreaElement) copy.value = original.value;
    if (original instanceof HTMLSelectElement && copy instanceof HTMLSelectElement) copy.selectedIndex = original.selectedIndex;
    if (original.scrollTop || original.scrollLeft) { copy.scrollTop = original.scrollTop; copy.scrollLeft = original.scrollLeft; }
  });
}

class MirrorGroup {
  private surfaces = new Map<HTMLElement, Surface>();
  private frame = 0;
  private version = 0;
  private rowVersions = new WeakMap<HTMLElement, number>();
  private ambientVersion = 0;
  private layoutDirty = true;
  private source: HTMLElement | null = null;
  private scroller: HTMLElement | null = null;
  private items: Item[] = [];
  private resize = new ResizeObserver(() => { this.layoutDirty = true; this.schedule(); });
  private mutations = new MutationObserver(records => {
    let affected = false;
    for (const record of records) {
      const element = record.target instanceof Element ? record.target : record.target.parentElement;
      if (!element || element.closest('[data-liquid-mirror-layer],[data-liquid-glass],[data-glass-diagnostics]')) continue;
      if (element.closest('.ambient')) { this.ambientVersion++; affected = true; continue; }
      if (!this.source || !this.source.contains(element)) continue;
      const row = element.closest<HTMLElement>('[data-liquid-row]');
      if (row && row.parentElement === this.source) {
        this.rowVersions.set(row, (this.rowVersions.get(row) ?? 0) + 1);
      } else {
        this.version++;
      }
      affected = true; this.layoutDirty = true;
    }
    if (affected) this.schedule();
  });
  private theme = new MutationObserver(() => { this.version++; this.ambientVersion++; this.schedule(); });
  private reduced = matchMedia('(prefers-reduced-transparency: reduce)');
  private scheme = matchMedia('(prefers-color-scheme: dark)');
  private onDiagnosticMode = (): void => { for (const surface of this.surfaces.values()) surface.geometry = ''; this.schedule(); };
  private onPreference = (): void => { this.version++; this.schedule(); };
  private onScroll = (event: Event): void => {
    const target = event.target;
    if (target instanceof Element && target.closest('[data-liquid-mirror-layer]')) return;
    if (target !== this.scroller) this.version++; // Nested code/output scroll has its own offset.
    this.schedule();
  };
  private onLoad = (event: Event): void => {
    if (event.target instanceof Element && event.target.closest('[data-liquid-mirror-layer]')) return;
    this.version++; this.layoutDirty = true; this.schedule();
  };
  constructor(private root: HTMLElement) {
    this.resize.observe(root);
    this.mutations.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class', 'style', 'open', 'src'] });
    this.theme.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class', 'style'] });
    this.reduced.addEventListener('change', this.onPreference);
    this.scheme.addEventListener('change', this.onPreference);
    root.addEventListener('liquid-diagnostic-mode', this.onDiagnosticMode);
    root.addEventListener('scroll', this.onScroll, true);
    root.addEventListener('load', this.onLoad, true);
    window.addEventListener('resize', this.onLoad);
    window.visualViewport?.addEventListener('resize', this.onLoad);
    window.visualViewport?.addEventListener('scroll', this.onLoad);
    document.addEventListener('visibilitychange', this.onPreference);
    void document.fonts.ready.then(() => { if (this.surfaces.size) this.onLoad(new Event('fonts')); });
  }
  add(node: HTMLElement): void {
    const layer = document.createElement('div'); layer.className = 'liquid-dom-layer';
    layer.dataset.liquidMirrorLayer = ''; layer.setAttribute('aria-hidden', 'true'); layer.inert = true;
    const optics = document.createElement('div'); optics.className = 'liquid-dom-optics';
    const scene = document.createElement('div'); scene.className = 'liquid-dom-scene';
    const viewport = document.createElement('div'); viewport.className = 'liquid-dom-viewport';
    const column = document.createElement('div');
    viewport.append(column); scene.append(viewport); optics.append(scene);
    const tint = document.createElement('div'); tint.className = 'liquid-dom-tint';
    const contour = document.createElement('canvas'); contour.className = 'liquid-dom-contour';
    const svg = document.createElementNS(SVG_NS, 'svg'); svg.classList.add('liquid-dom-defs'); svg.setAttribute('aria-hidden', 'true');
    const defs = document.createElementNS(SVG_NS, 'defs'); const filter = document.createElementNS(SVG_NS, 'filter');
    filter.id = `em-dom-glass-${++serial}`;
    for (const [key, value] of Object.entries({ x: '0', y: '0', width: '100%', height: '100%', 'color-interpolation-filters': 'sRGB' })) filter.setAttribute(key, value);
    defs.append(filter); svg.append(defs); layer.append(svg, optics, tint, contour); node.prepend(layer);
    optics.style.filter = `url("#${filter.id}")`;
    this.surfaces.set(node, { node, layer, optics, scene, viewport, column, contour, filter, svg, geometry: '', copies: new Map(), ambientVersion: -1 });
    this.resize.observe(node); this.layoutDirty = true; this.schedule();
  }
  remove(node: HTMLElement): boolean {
    const state = this.surfaces.get(node); state?.layer.remove(); node.removeAttribute('data-liquid-ready');
    this.resize.unobserve(node); this.surfaces.delete(node);
    if (this.surfaces.size) return false;
    cancelAnimationFrame(this.frame); this.resize.disconnect(); this.mutations.disconnect(); this.theme.disconnect();
    this.reduced.removeEventListener('change', this.onPreference); this.scheme.removeEventListener('change', this.onPreference);
    this.root.removeEventListener('liquid-diagnostic-mode', this.onDiagnosticMode);
    this.root.removeEventListener('scroll', this.onScroll, true); this.root.removeEventListener('load', this.onLoad, true);
    window.removeEventListener('resize', this.onLoad); window.visualViewport?.removeEventListener('resize', this.onLoad);
    window.visualViewport?.removeEventListener('scroll', this.onLoad); document.removeEventListener('visibilitychange', this.onPreference);
    delete this.root.dataset.liquidBackend;
    return true;
  }
  private schedule = (): void => { if (!this.frame) this.frame = requestAnimationFrame(this.update); };
  private update = (): void => {
    this.frame = 0;
    if (document.hidden) return;
    const mode = this.root.dataset.glassDiagnosticMode || 'full';
    if (mode === 'off') return;
    const started = this.root.dataset.glassDiagnosticActive === 'true' ? performance.now() : 0;
    const reduced = this.reduced.matches;
    this.root.dataset.liquidBackend = reduced ? 'reduced-transparency' : 'dom-mirror';
    if (reduced) return;
    const scroller = [...this.root.querySelectorAll<HTMLElement>('.message-scroll,.screen-body')]
      .find(el => !el.closest('[data-liquid-mirror-layer]') && el.clientWidth > 0 && el.clientHeight > 0) ?? null;
    const source = scroller?.querySelector<HTMLElement>('.message-column') ?? scroller;
    if (source !== this.source) {
      if (this.source) this.resize.unobserve(this.source);
      if (this.scroller && this.scroller !== this.source) this.resize.unobserve(this.scroller);
      this.source = source; this.scroller = scroller; this.layoutDirty = true; this.version++;
      if (source) this.resize.observe(source);
      if (scroller && scroller !== source) this.resize.observe(scroller);
      for (const state of this.surfaces.values()) { state.column.replaceChildren(); state.copies.clear(); }
    }
    const sourceRect = source?.getBoundingClientRect();
    if (this.layoutDirty) {
      this.items = source && sourceRect ? [...source.children].filter((el): el is HTMLElement => el instanceof HTMLElement)
        .map(node => { const box = node.getBoundingClientRect(); return { node, x: box.left - sourceRect.left, y: box.top - sourceRect.top + (source === scroller ? scroller.scrollTop : 0), width: box.width, height: box.height }; }) : [];
      this.layoutDirty = false;
    }
    const rootRect = this.root.getBoundingClientRect(), scrollRect = scroller?.getBoundingClientRect();
    const dark = (document.documentElement.dataset.theme || (this.scheme.matches ? 'dark' : 'light')) === 'dark';
    for (const state of this.surfaces.values()) {
      const box = state.node.getBoundingClientRect(); if (box.width < 1 || box.height < 1) continue;
      const radius = Math.min(parseFloat(getComputedStyle(state.node).borderTopLeftRadius) || 0, box.width / 2, box.height / 2);
      const blur = Number(state.node.dataset.liquidBlur ?? 2.5), key = [box.width, box.height, radius, blur, devicePixelRatio, mode].join(':');
      try {
        if (state.geometry !== key) {
          if (mode !== 'frost') renderFilter(state.filter, box.width, box.height, radius, { blur }, { bands: 3, monochrome: mode === 'no-dispersion', edgeOnly: mode === 'edge' });
          state.optics.style.filter = mode === 'frost' ? `blur(${blur}px)` : `url("#${state.filter.id}")`;
          renderContour(state.contour, box.width, box.height, radius);
          state.geometry = key;
        }
        state.node.dataset.liquidReady = ''; delete state.node.dataset.liquidError;
      } catch { delete state.node.dataset.liquidReady; state.node.dataset.liquidError = 'material-unavailable'; continue; }
      state.layer.style.setProperty('--liquid-dom-tint', dark ? '.05' : '0');
      updateStyles(state.scene, { width: `${rootRect.width}px`, height: `${rootRect.height}px`, transform: `translate(${rootRect.left - box.left + 48}px,${rootRect.top - box.top + 48}px)` });
      if (state.ambientVersion !== this.ambientVersion) {
        state.scene.querySelector(':scope > .ambient')?.remove();
        const ambient = this.root.querySelector<HTMLElement>(':scope > .ambient');
        if (ambient) state.scene.prepend(cloneMirrorNode(ambient, `${state.filter.id}-ambient`));
        state.ambientVersion = this.ambientVersion;
      }
      if (!source || !sourceRect || !scrollRect || !scroller) { state.viewport.style.display = 'none'; continue; }
      updateStyles(state.viewport, { display: 'block', left: `${scrollRect.left - rootRect.left}px`, top: `${scrollRect.top - rootRect.top}px`, width: `${scroller.clientWidth}px`, height: `${scroller.clientHeight}px` });
      if (state.column.className !== source.className) state.column.className = source.className;
      updateStyles(state.column, { position: 'absolute', display: 'block', flex: 'none', minHeight: '0', padding: '0', margin: '0', overflow: 'visible', width: `${sourceRect.width}px`, height: `${source.scrollHeight}px`, left: `${source === scroller ? 0 : sourceRect.left - scrollRect.left + scroller.scrollLeft}px`, top: `${source === scroller ? 0 : sourceRect.top - scrollRect.top + scroller.scrollTop}px`, transform: `translate(${-scroller.scrollLeft}px,${-scroller.scrollTop}px)` });
      const active = new Set<HTMLElement>();
      for (const item of this.items) {
        const top = sourceRect.top + item.y - (source === scroller ? scroller.scrollTop : 0);
        if (top + item.height < box.top - 96 || top > box.bottom + 96 || item.width < 1) continue;
        active.add(item.node);
        let cached = state.copies.get(item.node); let fresh = false;
        const rowVersion = this.rowVersions.get(item.node) ?? 0;
        if (!cached || cached.version !== this.version || cached.rowVersion !== rowVersion) {
          cached?.node.remove(); const clone = cloneMirrorNode(item.node, `${state.filter.id}-row-${++serial}`);
          state.column.append(clone); fresh = true;
          cached = { node: clone, version: this.version, rowVersion }; state.copies.set(item.node, cached);
        }
        updateStyles(cached.node, { position: 'absolute', left: `${item.x}px`, top: `${item.y}px`, width: `${item.width}px`, height: `${item.height}px`, margin: '0', contentVisibility: 'visible', containIntrinsicSize: 'none', overflow: 'hidden' });
        if (fresh) syncLiveState(item.node, cached.node);
      }
      for (const [node, cached] of state.copies) if (!active.has(node)) { cached.node.remove(); state.copies.delete(node); }
    }
    if (started) this.root.dispatchEvent(new CustomEvent('liquid-diagnostic-sample', { detail: { ms: performance.now() - started, rows: this.items.length, mirrored: [...this.surfaces.values()].reduce((n, surface) => n + surface.copies.size, 0) } }));
  };
}
export function registerLiquidGlass(surface: HTMLElement): () => void {
  const root = surface.closest<HTMLElement>('.app'); if (!root) return () => {};
  let group = groups.get(root); if (!group) { group = new MirrorGroup(root); groups.set(root, group); }
  group.add(surface);
  return () => { if (group.remove(surface)) groups.delete(root); };
}
