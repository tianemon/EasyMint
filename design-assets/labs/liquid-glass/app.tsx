import React, { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import UpstreamGlass from './vendor/rdev/index';
import { roundedLensMap as approvedOptics } from '../../../app/shared/visual-design/liquid-lens';
import { mountLiquidShowcase } from './baseline/liquid-interactions';
import { roundedLensMap } from './baseline/liquid-lens';
import baselineMarkup from './baseline/markup.html';
import './baseline/material.css';
import './lab.css';
import { renderLiquidIcon, type LiquidIconName } from '../../../app/shared/visual-design/liquid-icons';
import candidate from './presets/c-candidate-2026-10-24.json';

type Shape = 'nav' | 'pill' | 'circle';
type Background = 'landscape' | 'grid' | 'split' | 'text';
const labels = ['现在就听', '发现', '广播', '资料库'];
const names = ['home', 'browse', 'radio', 'library'];
const iconMarkup = (index: number) => renderLiquidIcon(index < 0 ? 'play' : names[index] as LiquidIconName);
function Icon({ index }: { index: number }) { return <span className="sample-icon" dangerouslySetInnerHTML={{ __html: iconMarkup(index) }} />; }
const dimensions = (shape: Shape, navWidth = 312) => ({ width: shape === 'nav' ? navWidth : shape === 'pill' ? 196 : 68, height: 68, radius: 34 });

function Payload({ shape, selected, onSelect }: { shape: Shape; selected: number; onSelect: (i: number) => void }) {
  if (shape !== 'nav') return <button className="single-action" aria-label="播放示例" onClick={() => onSelect((selected + 1) % 4)}><Icon index={-1} />{shape === 'pill' && <span>开始探索</span>}</button>;
  return <nav className="sample-nav" aria-label="材质示例导航"><span className="sample-selection" style={{ transform: `translateX(${selected * 100}%)` }} />{labels.map((label, i) => <button key={label} aria-pressed={selected === i} onClick={() => onSelect(i)}><Icon index={i} /><span>{label}</span></button>)}</nav>;
}

function Baseline({ shape, regular, selected, onSelect }: { shape: Shape; regular: boolean; selected: number; onSelect: (i: number) => void }) {
  const host = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = host.current!;
    element.innerHTML = baselineMarkup;
    const root = element.querySelector<HTMLElement>('[data-ios-root]')!;
    root.dataset.effect = regular ? 'standard' : 'subtle';
    root.dataset.device = 'mobile';
    root.querySelectorAll<HTMLElement>('[data-ios-tab]').forEach((button, index) => { button.querySelector('svg')!.outerHTML = iconMarkup(index); });
    root.style.setProperty('--gx-preview-height', '420px');
    root.querySelector<HTMLElement>('[data-ios-controls]')!.setAttribute('aria-label', '当前版本材质示例');
    if (shape !== 'nav') {
      const button = root.querySelector<HTMLElement>('[data-ios-tab]')!;
      button.innerHTML = `${iconMarkup(-1)}${shape === 'pill' ? '<span>开始探索</span>' : ''}`;
      button.setAttribute('aria-label', '播放示例');
    }
    return mountLiquidShowcase(root, false, roundedLensMap);
  }, [shape, regular]);
  useEffect(() => {
    const tabs = host.current!.querySelector<HTMLElement>('[data-ios-tabs]')!;
    const buttons = [...tabs.querySelectorAll<HTMLElement>('[data-ios-tab]')];
    buttons.forEach((button, i) => button.setAttribute('aria-pressed', String(i === selected)));
    const active = buttons[selected];
    if (active) { tabs.style.setProperty('--ios-tab-left', `${active.offsetLeft}px`); tabs.style.setProperty('--ios-tab-width', `${active.offsetWidth}px`); }
  }, [selected, shape, regular]);
  return <div ref={host} className={`baseline-host shape-${shape}`} onFocusCapture={event => {
    const name = (event.target as HTMLElement).closest<HTMLElement>('[data-ios-tab]')?.dataset.iosTab;
    if (name) onSelect(names.indexOf(name));
  }} />;
}

function Optical({ shape, regular, selected, onSelect, bezel, thickness, gain, motion, navWidth }: { shape: Shape; regular: boolean; selected: number; onSelect: (i: number) => void; bezel: number; thickness: number; gain: number; motion: boolean; navWidth: number }) {
  const id = useId().replaceAll(':', '');
  const size = dimensions(shape, navWidth);
  const map = useMemo(() => {
    const { width, height, radius } = size;
    const field = approvedOptics(width, height, radius, { bezel, thickness, gain });
    const canvas = document.createElement('canvas'); canvas.width = field.width; canvas.height = field.height;
    const context = canvas.getContext('2d')!;
    const image = context.createImageData(field.width, field.height);
    image.data.set(field.data); context.putImageData(image, 0, 0);
    const displacement = canvas.toDataURL();
    image.data.set(field.reflection); context.putImageData(image, 0, 0);
    return { displacement, reflection: canvas.toDataURL(), scale: field.scale };
  }, [shape, bezel, thickness, gain, navWidth]);
  const host = useRef<HTMLDivElement>(null);
  return <div className="optical-position" style={{ width: size.width, height: size.height }}>
    <svg className="filter-defs" aria-hidden="true"><defs><filter id={id} x="0" y="0" width={size.width} height={size.height} filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
      <feImage href={map.displacement} x="0" y="0" width={size.width} height={size.height} preserveAspectRatio="none" result="map" />
      <feDisplacementMap in="SourceGraphic" in2="map" xChannelSelector="R" yChannelSelector="G" scale={map.scale} />
      <feGaussianBlur stdDeviation={regular ? 3 : .25} />
    </filter></defs></svg>
    <div ref={host} className={`optical-glass ${regular ? 'regular' : 'clear'}`} style={{ backdropFilter: `url(#${id}) saturate(1.35)`, borderRadius: size.radius }} onPointerMove={event => {
      if (!motion || event.pointerType === 'touch') return;
      const box = event.currentTarget.getBoundingClientRect();
      host.current!.style.setProperty('--light-x', `${(event.clientX - box.left) / box.width * 100}%`);
    }}><span className="optical-reflection" style={{ backgroundImage: `url(${map.reflection})` }} /><span className="optical-glint" /><Payload shape={shape} selected={selected} onSelect={onSelect} /></div>
  </div>;
}

function BackgroundArt({ background }: { background: Background }) {
  return <div className={`scene-paint background-${background}`} aria-hidden="true">{background === 'landscape' && <><div className="orb orb-one" /><div className="orb orb-two" /><div className="landscape-horizon" /><div className="scene-type">EVERY<br />LITTLE<br />DETAIL.</div><span className="scene-caption">光与形之间 · 一片透明的风景</span></>}{background === 'grid' && <><span className="grid-line diagonal-one" /><span className="grid-line diagonal-two" /><div className="calibration-copy">01 — 02 — 03<br /><br />REFRACTION<br />0123456789</div></>}{background === 'split' && <><span className="split-white" /><span className="split-line" /><span className="split-label left">DARK</span><span className="split-label right">LIGHT</span></>}{background === 'text' && <div className="reading-copy"><span>READABILITY STUDY</span><h3>看见背景，也看清内容</h3>{Array.from({ length: 8 }, (_, i) => <p key={i}>光线穿过玻璃，在边缘轻轻转折。界面应该保留清晰的内容与自然的操作反馈。The details make the difference.</p>)}</div>}</div>;
}

function App() {
  const [background, setBackground] = useState<Background>(candidate.background as Background);
  const [shape, setShape] = useState<Shape>(candidate.shape as Shape);
  const [regular, setRegular] = useState(candidate.regular);
  const [moving, setMoving] = useState(candidate.moving);
  const [interaction, setInteraction] = useState(candidate.interaction);
  const [offset, setOffset] = useState(candidate.offset);
  const [selected, setSelected] = useState(candidate.selected);
  const [bezel, setBezel] = useState(candidate.bezel);
  const [thickness, setThickness] = useState(candidate.thickness);
  const [gain, setGain] = useState(candidate.gain);
  const [mode, setMode] = useState<'standard' | 'polar' | 'prominent' | 'shader'>(candidate.mode as 'polar');
  const [ink, setInk] = useState<'white' | 'dark'>(candidate.ink as 'white');
  const [notice, setNotice] = useState('');
  const [vote, setVote] = useState('');
  const [navWidth, setNavWidth] = useState(312);
  useLayoutEffect(() => {
    const stage = document.querySelector<HTMLElement>('.sample-stage')!;
    const observer = new ResizeObserver(([entry]) => setNavWidth(Math.min(312, Math.max(180, Math.floor(entry.contentRect.width - 30)))));
    observer.observe(stage); return () => observer.disconnect();
  }, []);
  const specimen = dimensions(shape, navWidth);
  useEffect(() => {
    try { setVote(localStorage.getItem('em-glass-lab-vote') || ''); } catch { /* Private browsing still works. */ }
  }, []);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 2600); return () => clearTimeout(timer); }, [notice]);
  function reset() { setBackground(candidate.background as Background); setShape(candidate.shape as Shape); setRegular(candidate.regular); setMoving(candidate.moving); setInteraction(candidate.interaction); setOffset(candidate.offset); setSelected(candidate.selected); setBezel(candidate.bezel); setThickness(candidate.thickness); setGain(candidate.gain); setMode(candidate.mode as 'polar'); setInk(candidate.ink as 'white'); }
  async function copyRecipe() {
    const recipe = { background, shape, regular, moving, interaction, offset, selected, bezel, thickness, gain, mode, ink, vote };
    try { await navigator.clipboard.writeText(JSON.stringify(recipe, null, 2)); setNotice('对照参数已复制'); } catch { setNotice('复制受限，可在下方查看参数'); }
  }
  return <main className={`lab ${moving ? 'scene-moving' : ''} ${interaction ? '' : 'interaction-off'}`} style={{ '--scene-offset': `${offset}px`, '--sample-width': `${navWidth}px`, '--sample-ink': ink === 'white' ? '#fff' : '#17212d' } as React.CSSProperties}>
    <header className="lab-header"><div className="eyebrow"><span className="brand-dot" /> Em · 材质实验室 <span className="study-number">STUDY 01 / LOCAL</span></div><div className="title-row"><div><h1>液态玻璃，同场对照</h1><p>相同背景、相同尺寸、相同内容。让差异来自材质本身。</p></div><button className="quiet-button" onClick={reset}>恢复候选参数</button></div></header>
    <section className="control-panel" aria-label="共同对照条件"><div className="control-row"><span className="control-label">背景</span><div className="segmented">{([['landscape', '彩色景深'], ['grid', '校准网格'], ['split', '明暗交界'], ['text', '真实正文']] as const).map(([key, label]) => <button key={key} aria-pressed={background === key} onClick={() => { setBackground(key); setInk(key === 'text' ? 'dark' : 'white'); }}>{label}</button>)}</div><span className="control-spacer" /><label className="switch-label"><input type="checkbox" checked={moving} onChange={e => setMoving(e.target.checked)} /> 背景流动</label><label className="switch-label"><input type="checkbox" checked={interaction} onChange={e => setInteraction(e.target.checked)} /> 交互反馈</label></div><div className="control-row"><span className="control-label">形状</span><div className="segmented compact">{([['nav', '导航胶囊'], ['pill', '长按钮'], ['circle', '圆形按钮']] as const).map(([key, label]) => <button key={key} aria-pressed={shape === key} onClick={() => setShape(key)}>{label}</button>)}</div><label className="offset-control">背景位置 <input aria-label="背景位置" type="range" min="0" max="240" value={offset} onChange={e => setOffset(Number(e.target.value))} /><output>{offset}</output></label><div className="segmented compact ink-control"><button aria-pressed={ink === 'white'} onClick={() => setInk('white')}>白字</button><button aria-pressed={ink === 'dark'} onClick={() => setInk('dark')}>深色字</button></div></div></section>
    <div className="comparison-heading"><span>三个实现 · 同步切换内容</span><span>{specimen.width} × {specimen.height} px <i /> 正式模板保持原样</span></div>
    <section className="comparison-grid" aria-label="三个玻璃实现对照">{['baseline', 'rdev', 'optical'].map((key, index) => <article className={`comparison-card implementation-${key}`} key={key}><header className="card-heading"><span className="column-id">{'ABC'[index]}</span><div><h2>{['当前版本', 'rdev 原始组件', '光学模型候选'][index]}</h2><p>{['冻结基线 · 当前 Em 材质', '原始源码 · 仅适配内容与尺寸', '上游光学库 · 实验合成层'][index]}</p></div></header><div className={`sample-stage shape-${shape}`} data-implementation={key}><BackgroundArt background={background} />{key === 'baseline' ? <Baseline shape={shape} regular={regular} selected={selected} onSelect={setSelected} /> : key === 'rdev' ? <UpstreamGlass key={`${shape}-${mode}-${navWidth}`} mode={mode} displacementScale={64} blurAmount={.1} saturation={130} aberrationIntensity={2} elasticity={interaction ? .35 : 0} padding="5px" cornerRadius={34} style={{ position: 'absolute', top: '50%', left: '50%', width: specimen.width, height: specimen.height }} onClick={() => {}}><div className="rdev-payload" style={{ width: specimen.width - 10, height: specimen.height - 10 }}><Payload shape={shape} selected={selected} onSelect={setSelected} /></div></UpstreamGlass> : <Optical shape={shape} regular={regular} selected={selected} onSelect={setSelected} bezel={bezel} thickness={thickness} gain={gain} motion={interaction} navWidth={navWidth} />}</div><footer className="card-footer"><p>{['保留最近一轮的折射、反光和阴影，作为比较起点。', '保留上游滤镜与反馈逻辑，使用其按钮示例参数。', '曲面、厚度与反射关联计算，独立验证材质方向。'][index]}</p><button className={`preference ${vote === key ? 'chosen' : ''}`} aria-pressed={vote === key} onClick={() => { const next = vote === key ? '' : key; setVote(next); try { if (next) localStorage.setItem('em-glass-lab-vote', next); else localStorage.removeItem('em-glass-lab-vote'); } catch {} }}>{vote === key ? '已标记偏好' : '标记为更喜欢'}</button></footer></article>)}</section>
    <section className="tuning-section"><div className="tuning-intro"><span className="eyebrow">继续比较</span><h2>先观察，再调参数</h2><p>移动背景，检查边缘如何弯折；按下与切换，检查内容是否始终清晰。偏好仅保存在当前浏览器。</p></div><div className="tuning-options"><label className="variant-option"><span>A / C 材质</span><select value={regular ? 'regular' : 'clear'} onChange={e => setRegular(e.target.value === 'regular')}><option value="clear">清透</option><option value="regular">常规</option></select></label><label><span>B / 上游折射模式</span><select value={mode} onChange={e => setMode(e.target.value as typeof mode)}><option value="standard">Standard</option><option value="polar">Polar</option><option value="prominent">Prominent</option><option value="shader">Shader</option></select></label><label><span>C / 倒角宽度 <output>{bezel} px</output></span><input aria-label="候选倒角宽度" type="range" min="4" max="22" step="1" value={bezel} onChange={e => setBezel(Number(e.target.value))} /></label><label><span>C / 虚拟厚度 <output>{thickness.toFixed(2)}</output></span><input aria-label="候选虚拟厚度" type="range" min=".1" max="1.2" step=".05" value={thickness} onChange={e => setThickness(Number(e.target.value))} /></label><label><span>C / 折射倍率 <output>{gain.toFixed(1)}</output></span><input aria-label="候选折射倍率" type="range" min=".4" max="2.8" step=".1" value={gain} onChange={e => setGain(Number(e.target.value))} /></label><button className="copy-button" onClick={copyRecipe}>复制当前对照参数</button></div></section>
    <details className="provenance"><summary>实现来源与比较边界</summary><p>B 使用 rdev/liquid-glass-react 固定提交的原始组件，包含最低限度的 Tailwind 工具类兼容；组件源码未修改。C 复用 sohumsuthar 的纯光学库，外围滤镜、反光合成和交互由本实验编写，并非其完整产品原样。A 固定保存本轮开始前的 Em 源码。共同内容的前景字色统一，避免配色混入材质比较。</p><p>B 没有 A / C 的同名材质档位，因此“清透 / 常规”只影响 A / C；其 Blur Amount 不是 CSS 像素值。各栏独立展示各自方案，参数数值不能直接横比。本页背景由本地 CSS 绘制，不包含第三方演示图片、字体或音频。</p><div className="source-links"><a href="https://github.com/rdev/liquid-glass-react" target="_blank" rel="noreferrer">rdev / MIT ↗</a><a href="https://github.com/sohumsuthar/liquid-glass" target="_blank" rel="noreferrer">光学库 / MIT ↗</a><a href="./PROVENANCE.md">来源、版本与许可证</a></div><pre>{JSON.stringify({ background, shape, regular, moving, interaction, offset, selected, bezel, thickness, gain, mode, ink, vote }, null, 2)}</pre></details>
    <footer className="lab-footer"><span>Em Design Studies</span><span>独立研究样本 · 2026.10.24</span></footer><div className="notice" role="status" hidden={!notice}>{notice}</div>
  </main>;
}

createRoot(document.getElementById('root')!).render(<App />);
