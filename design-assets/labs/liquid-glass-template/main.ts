import { createVisualSpec } from '../../../app/shared/visual-design/spec';
import { visualVariables } from '../../../app/shared/visual-design/spec';
import { renderLiquidShowcase } from '../../../app/shared/visual-design/liquid-showcase';
import { mountLiquidShowcase } from '../liquid-glass/baseline/liquid-interactions';
import { renderLiquidIcon } from '../../../app/shared/visual-design/liquid-icons';
import { roundedLensMap } from '../../../app/shared/visual-design/liquid-lens';
import { DEFAULT_TUNING, tunedLensMap, type TemplateTuning } from './optics';

const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const spec = createVisualSpec({ styleId: 'liquid-glass', effect: 'subtle', locale: 'zh-CN' });
const host = $('#template');
host.innerHTML = renderLiquidShowcase(spec);
const root = host.querySelector<HTMLElement>('[data-ios-root]')!;
root.dataset.device = 'mobile';
for (const [key, value] of Object.entries(visualVariables(spec))) root.style.setProperty(key, value);
let tuning = { ...DEFAULT_TUNING };
let baseline = false;
let cleanup = () => {};
let frame = 0;
const makeLens: typeof roundedLensMap = (width, height, radius) => baseline
  ? roundedLensMap(width, height, radius)
  : tunedLensMap(width, height, radius, tuning);
function renderMaterial() {
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(() => {
    cleanup();
    cleanup = mountLiquidShowcase(root, false, makeLens);
    $('#status').textContent = baseline ? '正在显示 Em 内置模板原版' : '正在显示过渡与细边调整版';
  });
}
const fields: [keyof TemplateTuning, string, number, number, number][] = [
  ['transitionStart', '内缘过渡起点', 0.2, 0.9, 0.01],
  ['outerFade', '外缘平滑范围', 0, 0.12, 0.005],
  ['darkEdge', '左右细暗边强度', 0, 0.35, 0.01],
  ['brightEdge', '上下细亮边强度', 0, 0.35, 0.01],
  ['edgeWidth', '细边宽度 CSS px', 0.15, 0.9, 0.05],
  ['edgeInset', '细边内缩 CSS px', 0.1, 1.2, 0.05],
];
for (const [key, label, min, max, step] of fields) {
  const field = document.createElement('label');
  field.className = 'parameter';
  field.innerHTML = `<span>${label}<output id="out-${key}">${tuning[key]}</output></span><input id="${key}" aria-label="${label}" type="range" min="${min}" max="${max}" step="${step}" value="${tuning[key]}">`;
  field.querySelector('input')!.addEventListener('input', (event) => {
    tuning[key] = Number((event.target as HTMLInputElement).value);
    $(`#out-${key}`).textContent = String(tuning[key]);
    baseline = false;
    $('#baseline').setAttribute('aria-pressed', 'false');
    renderMaterial();
  });
  $('#parameters').append(field);
}
$('#baseline').addEventListener('click', () => {
  baseline = !baseline;
  $('#baseline').setAttribute('aria-pressed', String(baseline));
  renderMaterial();
});
$('#reset').addEventListener('click', () => {
  tuning = { ...DEFAULT_TUNING };
  baseline = false;
  $('#baseline').setAttribute('aria-pressed', 'false');
  for (const [key] of fields) {
    $<HTMLInputElement>(`#${key}`).value = String(tuning[key]);
    $(`#out-${key}`).textContent = String(tuning[key]);
  }
  renderMaterial();
});
$('#material').addEventListener('change', (event) => {
  root.dataset.effect = (event.target as HTMLSelectElement).value;
  renderMaterial();
});
$('#export').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify({ version: 1, renderer: 'Em SVG backdrop template', effect: root.dataset.effect, tuning }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'em-template-liquid-glass.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
window.addEventListener('pagehide', (event) => {
  if (event.persisted) return;
  cancelAnimationFrame(frame);
  cleanup();
}, { once: true });
renderMaterial();
