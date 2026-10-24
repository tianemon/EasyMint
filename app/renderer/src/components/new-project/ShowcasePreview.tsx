import { useLayoutEffect, useMemo, useRef, type CSSProperties } from 'react';
import { renderShowcase } from '../../../../shared/visual-design/showcase';
import { mountShowcasePreview } from '../../../../shared/visual-design/showcase-runtime';
import { visualVariables, type VisualSpec } from '../../../../shared/visual-design/spec';
import { usePreviewScroll, type PreviewScrollMemory } from './use-preview-scroll';
import '../../../../../resources/visual-design/showcase.css';
import '../../../../../resources/visual-design/scene-showcase.css';
import '../../../../../resources/visual-design/glass-showcase.css';
import '../../../../../resources/visual-design/liquid-showcase.css';

export function ShowcasePreview({ spec, device, motion = false, active = true, scrollMemory }: {
  spec: VisualSpec; device: 'web' | 'mobile'; motion?: boolean; active?: boolean; scrollMemory?: PreviewScrollMemory;
}): JSX.Element {
  const host = useRef<HTMLDivElement>(null), scroller = useRef<HTMLDivElement>(null);
  const html = useMemo(() => renderShowcase(spec, motion), [spec, motion]);
  useLayoutEffect(() => {
    const root = host.current?.querySelector<HTMLElement>('.sc-page');
    if (!root) return;
    root.dataset.device = device;
    root.dataset.effect = spec.selection.effect;
    root.dataset.paused = String(!active);
    const syncHeight = () => {
      const height = scroller.current?.clientHeight ?? 0;
      root.style.setProperty('--gx-preview-height', `${height}px`);
      root.style.setProperty('--scene-preview-height', `${height}px`);
      root.dataset.sceneCompact=String(device==='web'&&height>0&&height<500);
      root.dataset.gxCompact = String(device === 'web' && height > 0 && height < 500);
    };
    const observer = new ResizeObserver(syncHeight);
    if (host.current) observer?.observe(host.current);
    syncHeight();
    const dispose = active ? mountShowcasePreview(root, spec.selection.locale === 'en') : undefined;
    return () => { dispose?.(); observer?.disconnect(); };
  }, [html, device, spec.selection.effect, spec.selection.locale, active]);
  usePreviewScroll(scroller, active ? scrollMemory : undefined, `showcase:${spec.selection.styleId}:${device}:${motion}`, spec.selection.styleId);
  return <div ref={host} className="sc-preview-host" data-device={device} data-style={spec.selection.styleId} style={visualVariables(spec) as CSSProperties}>
    <div ref={scroller} className="sc-preview-scroll" dangerouslySetInnerHTML={{ __html: html }} />
  </div>;
}
