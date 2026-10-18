import { additionalArtwork } from "../../../../shared/visual-design/additional-artwork";
import { uiText } from "../../lib/i18n";
import type { StylePreset } from "./style-presets";

/** Decorative output stays code-native and never embeds a second set of fake controls. */
export function StyleArtwork({ preset, progress, anchor }: { preset: StylePreset; progress: number; anchor?: string }): JSX.Element {
  const extra = additionalArtwork(preset.id);
  if(extra !== null) return <div className={`sample-artwork craft-artwork craft-art-${preset.id}`} data-preview-anchor={anchor} aria-hidden="true" dangerouslySetInnerHTML={{__html:extra}}/>;
  if (preset.id === "neumorphism") {
    return <div className="sample-artwork sample-artwork-dial" data-preview-anchor={anchor} aria-hidden="true">
      <div className="sample-dial"><svg viewBox="0 0 160 160"><circle className="sample-dial-track" cx="80" cy="80" r="66" /><circle className="sample-dial-fill" cx="80" cy="80" r="66" pathLength="100" strokeDasharray={`${progress} 100`} /></svg><div><strong>{progress}<small>%</small></strong><span>{uiText("creation.sample.artProgress")}</span></div></div>
      <div className="sample-dial-caption"><i /><span>{uiText("creation.sample.artCaption")}</span><b>↗</b></div>
    </div>;
  }
  if (preset.id === "flat") {
    return <div className="sample-artwork sample-artwork-poster" data-preview-anchor={anchor} aria-hidden="true"><div className="sample-poster"><div className="sample-art-nav"><strong>FORM / STUDIO</strong><span>01 — 06</span></div><strong className="sample-poster-title">{uiText("creation.sample.artFlatHeadline")}</strong><div className="sample-poster-geometry"><i /><b /><em /></div><div className="sample-art-footer"><span>{uiText("creation.sample.artExplore")}</span><span>↗</span></div></div></div>;
  }
  if (preset.id === "material") {
    return <div className="sample-artwork sample-artwork-profile" data-preview-anchor={anchor} aria-hidden="true"><div className="sample-profile-page"><div className="sample-art-nav"><strong>FORM / STUDIO</strong><span>{uiText("creation.sample.artNavigation")}</span></div><div className="sample-profile-intro"><div><span className="sample-art-edition">DESIGNER / MAKER</span><strong>{uiText("creation.sample.artMaterialHeadline")}</strong><span className="sample-profile-chip">{uiText("creation.sample.artExplore")} ↗</span></div><div className="sample-profile-flower"><i /><b /></div></div><div className="sample-profile-gallery"><i /><b /><em /></div></div></div>;
  }
  if (preset.id === "glass") {
    return <div className="sample-artwork sample-artwork-glass" data-preview-anchor={anchor} aria-hidden="true"><div className="sample-art-orbit" /><div className="sample-glass-window"><div className="sample-art-nav"><strong>FORM / STUDIO</strong><span>{uiText("creation.sample.artNavigation")}</span></div><div className="sample-glass-lens"><i /><b /><em /></div><div className="sample-glass-caption"><strong>{uiText("creation.sample.artGlassHeadline")}</strong><span>01 / 06 ↗</span></div></div><div className="sample-art-tag"><span>✓</span>{uiText("creation.sample.artReady")}</div></div>;
  }
  if (preset.id === "skeuomorphism") {
    return <div className="sample-artwork sample-artwork-paper" data-preview-anchor={anchor} aria-hidden="true"><div className="sample-print"><div className="sample-art-nav"><strong>FORM / STUDIO</strong><span>No. 01</span></div><strong className="sample-print-title">{uiText("creation.sample.artPaperHeadline")}</strong><div className="sample-print-study"><i /><b /><em /></div><div className="sample-art-footer"><span>{uiText("creation.sample.artCaption")}</span><span>↗</span></div></div></div>;
  }
  return <div className="sample-artwork" data-preview-anchor={anchor} aria-hidden="true">
    <div className="sample-art-orbit" />
    <div className="sample-art-window">
      <div className="sample-art-nav"><strong>FORM / STUDIO</strong><span>{uiText("creation.sample.artNavigation")}</span></div>
      <div className="sample-art-body"><div className="sample-art-type"><span className="sample-art-edition">PORTFOLIO / 01</span><strong>{uiText("creation.sample.artHeadline")}</strong><p>{uiText("creation.sample.artCaption")}</p><span className="sample-art-explore">{uiText("creation.sample.artExplore")} ↗</span></div><div className="sample-art-sculpture"><i className="sample-art-disc" /><i className="sample-art-loop" /><i className="sample-art-ball" /></div></div>
      <div className="sample-art-footer"><span>DESIGN & EVERYDAY LIFE</span><span>01 — 06</span></div>
    </div>
    <div className="sample-art-tag"><span>✓</span>{uiText("creation.sample.artReady")}</div>
  </div>;
}
