import templatePreset from '../../../../resources/visual-design/liquid-template-preset.json';
const BASE_PRESET = { ...templatePreset, background: 'spectrum' };
import { materialFragment, spectrumUniforms } from './material.ts';

const $ = (selector) => document.querySelector(selector);
const viewport = { width: 390, height: 600 };
const resolutionScale = 2;
const groups = [
  ['形状与尺寸', [
    ['cardWidth', '输入卡宽度', 240, 358, 1, 358, 'dp'],
    ['cardHeight', '输入卡高度', 80, 180, 1, 98, 'dp'],
    ['radius', '输入卡圆角', 8, 48, 1, 24, 'dp'],
    ['circleSize', '圆形直径', 48, 140, 1, 80, 'dp'],
    ['referenceScale', '参考设备像素密度', 1, 4, 0.25, 3.75, '物理像素 / dp'],
  ]],
  ['主折射与圆润范围', [
    ['bevelRatio', '光影倒角宽度比例', 0.04, 0.2, 0.001, 0.025 / 0.244, '× 高度'],
    ['width', '基础折射范围', 0.6, 2.2, 0.01, 1.32, '× 倒角'],
    ['sideWidth', '左右范围增强', 1, 1.6, 0.01, 1.18, '倍'],
    ['heightRatio', '曲面高度', 0.2, 0.8, 0.01, 0.48, '× 基础范围'],
    ['normalStep', '法线平滑步长', 0.04, 0.3, 0.002, 0.152, '× 局部范围'],
    ['ior', '折射率', 1.1, 1.8, 0.01, 1.46, 'IOR'],
    ['travel', '背景传播距离', 0.2, 1.6, 0.01, 0.86, '× 倒角'],
    ['sideTravel', '左右光路增强', 1, 1.6, 0.01, 1.28, '倍'],
    ['faceScale', '中心背景采样比例', 0.94, 1.02, 0.001, 0.988, '倍'],
  ]],
  ['水滴边缘额外折射', [
    ['rimStrength', '额外偏移幅度', 0, 0.35, 0.005, 0.13, '× 倒角'],
    ['sideRim', '左右额外偏移增强', 1, 1.6, 0.01, 1.12, '倍'],
    ['rimRange', '额外折射向内范围', 0.1, 0.8, 0.01, 0.4, '× 局部范围'],
  ]],
  ['左右暗边与上下亮边', [
    ['darkEdge', '左右细暗边强度', 0, 0.4, 0.005, 0.16, ''],
    ['brightEdge', '上下细亮边强度', 0, 0.4, 0.005, 0.14, ''],
    ['edgeCenter', '细边距轮廓的距离', 0.1, 1.2, 0.02, 0.4, 'dp'],
    ['edgeWidth', '细边宽度', 0.1, 1, 0.02, 0.3, 'dp'],
    ['adaptation', '背景自适应光影强度', 0, 2, 0.05, 1, '倍'],
    ['environmentMix', '边缘背景颜色混合', 0, 2, 0.05, 1, '倍'],
  ]],
  ['色散与玻璃底色', [
    ['dispersion', '边缘基础色散', 0, 0.012, 0.0002, 0.003, 'IOR 差'],
    ['rimDispersion', '最外侧额外色散', 0, 0.008, 0.0002, 0.001, 'IOR 差'],
    ['blur', '背景模糊', 0, 8, 0.05, 0.65, 'dp'],
    ['tintLight', '亮色模式黑色染色', 0, 0.2, 0.005, 0.045, '比例'],
    ['tintDark', '暗色模式黑色染色', 0, 0.2, 0.005, 0.035, '比例'],
  ]],
];
groups[1][1] = groups[1][1].filter(([key]) => key !== 'width');
groups.unshift(['折射与光谱实验', [
  ['thicknessGain', '折射光路厚度', 0.3, 3, 0.05, 1.2, '倍'],
  ['width', '折射向内范围', 0.6, 2.2, 0.01, 1.36, '× 倒角'],
  ['curveGain', '曲率 / 法线倾斜', 0.4, 2.5, 0.05, 1, '倍'],
  ['spectralGain', '色散展开幅度', 0, 10, 0.05, 4, '倍'],
  ['saturation', '玻璃内饱和度', 0.8, 1.8, 0.05, 1, '倍'],
]]);
for (const [, fields] of groups) {
  for (const field of fields) {
    if (BASE_PRESET.parameters[field[0]] !== undefined) field[5] = BASE_PRESET.parameters[field[0]];
  }
}
const definitions = groups.flatMap(([, fields]) => fields);
const defaults = Object.fromEntries(definitions.map(([key, , , , , value]) => [key, value]));
defaults.spectralBands = 8;
const baselineDefaults = { ...defaults, ...BASE_PRESET.parameters, spectralBands: 3, thicknessGain: 1, curveGain: 1, spectralGain: 1, saturation: 1 };
let parameters = { ...defaults };
let compareBaseline = false;
const positions = BASE_PRESET.positions.map((position) => ({ ...position }));
const stage = $('#stage');
const canvas = $('#canvas');
const gl = canvas.getContext('webgl2', { alpha: false, antialias: false });
let invalidate = true;
let backgroundDirty = true;
let currentScroll = BASE_PRESET.scroll;
let lastTime = 0;
let frameId;
let activeDrag = null;

function status(message) {
  $('#status').textContent = message;
}
function format(value) {
  return Number(value.toFixed(4)).toString();
}
function markChanged() {
  for (const [key] of definitions) {
    const changed = Math.abs(parameters[key] - defaults[key]) > 0.00001;
    $(`[data-parameter="${key}"]`).classList.toggle('changed', changed);
  }
}
function updateControls() {
  for (const [key] of definitions) {
    $(`#range-${key}`).value = parameters[key];
    $(`#number-${key}`).value = format(parameters[key]);
  }
  $('#spectralMode').value = String(effectiveParameters().spectralBands);
  markChanged();
}
function parameterChanged(key, value, liveNumber = false) {
  if (!Number.isFinite(value)) return;
  const definition = definitions.find(([name]) => name === key);
  parameters[key] = Math.max(definition[2], Math.min(definition[3], value));
  compareBaseline = false;
  $('#baseline').setAttribute('aria-pressed', 'false');
  if (liveNumber) {
    $(`#range-${key}`).value = parameters[key];
    $('#spectralMode').value = String(parameters.spectralBands);
    markChanged();
  } else updateControls();
  backgroundDirty = true;
  invalidate = true;
  positionContent();
  status('正在显示调参效果');
}
for (const [groupIndex, [title, fields]] of groups.entries()) {
  const details = document.createElement('details');
  details.open = groupIndex === 0;
  const summary = document.createElement('summary');
  summary.textContent = title;
  details.append(summary);
  for (const [key, label, min, max, step, initial, unit] of fields) {
    const wrapper = document.createElement('div');
    wrapper.className = 'parameter';
    wrapper.dataset.parameter = key;
    wrapper.innerHTML = `<div class="parameter-head"><label for="range-${key}">${label}</label><input id="number-${key}" type="number" min="${min}" max="${max}" step="${step}" value="${format(initial)}" aria-label="${label}数值"></div><input id="range-${key}" type="range" min="${min}" max="${max}" step="${step}" value="${initial}"><small>${title === '形状与尺寸' ? '示例默认' : '实验默认'} ${format(initial)} ${unit}</small>`;
    wrapper.querySelector('input[type=range]').addEventListener('input', (event) => parameterChanged(key, Number(event.target.value)));
    wrapper.querySelector('input[type=number]').addEventListener('input', (event) => {
      if (event.target.value !== '') parameterChanged(key, Number(event.target.value), true);
    });
    wrapper.querySelector('input[type=number]').addEventListener('change', (event) => parameterChanged(key, Number(event.target.value)));
    details.append(wrapper);
  }
  $('#controls').append(details);
}
const baselineButton = document.createElement('button');
baselineButton.id = 'baseline';
baselineButton.textContent = '对比现有模板';
baselineButton.setAttribute('aria-pressed', 'false');
baselineButton.addEventListener('click', () => {
  compareBaseline = !compareBaseline;
  baselineButton.setAttribute('aria-pressed', String(compareBaseline));
  updateControls();
  backgroundDirty = true;
  invalidate = true;
  positionContent();
  status(compareBaseline ? '正在显示原有 RGB 模板基线；再次点击返回光谱实验' : '正在显示调参效果');
});
$('.actions').prepend(baselineButton);

function effectiveParameters() {
  return compareBaseline ? baselineDefaults : parameters;
}
function geometry() {
  const p = effectiveParameters();
  return [
    { x: positions[0].x, y: positions[0].y, width: p.cardWidth, height: p.cardHeight, radius: p.radius },
    { x: positions[1].x, y: positions[1].y, width: p.circleSize, height: p.circleSize, radius: p.circleSize / 2 },
  ];
}
function constrainPositions() {
  for (const [index, rect] of geometry().entries()) {
    positions[index].x = Math.max(4, Math.min(viewport.width - rect.width - 4, positions[index].x));
    positions[index].y = Math.max(70, Math.min(viewport.height - rect.height - 8, positions[index].y));
  }
}
function positionContent() {
  constrainPositions();
  const scale = stage.getBoundingClientRect().width / viewport.width;
  for (const [index, rect] of geometry().entries()) {
    const element = index === 0 ? $('#composer') : $('#circle');
    Object.assign(element.style, {
      left: `${rect.x * scale}px`, top: `${rect.y * scale}px`,
      width: `${rect.width}px`, height: `${rect.height}px`,
      transform: `scale(${scale})`,
    });
  }
}
new ResizeObserver(positionContent).observe(stage);
function beginDrag(event, index) {
  if (event.button !== 0) return;
  event.preventDefault();
  activeDrag = { index, startX: event.clientX, startY: event.clientY, ...positions[index] };
  event.currentTarget.setPointerCapture(event.pointerId);
}
for (const [id, index] of [['drag', 0], ['circle', 1]]) {
  const element = $(`#${id}`);
  element.addEventListener('pointerdown', (event) => beginDrag(event, index));
  element.addEventListener('pointermove', (event) => {
    if (!activeDrag || activeDrag.index !== index) return;
    const scale = stage.getBoundingClientRect().width / viewport.width;
    positions[index].x = activeDrag.x + (event.clientX - activeDrag.startX) / scale;
    positions[index].y = activeDrag.y + (event.clientY - activeDrag.startY) / scale;
    positionContent();
    invalidate = true;
  });
  const end = () => { activeDrag = null; };
  element.addEventListener('pointerup', end);
  element.addEventListener('pointercancel', end);
  element.addEventListener('keydown', (event) => {
    const delta = { ArrowLeft: [-2, 0], ArrowRight: [2, 0], ArrowUp: [0, -2], ArrowDown: [0, 2] }[event.key];
    if (!delta) return;
    event.preventDefault();
    positions[index].x += delta[0];
    positions[index].y += delta[1];
    positionContent();
    invalidate = true;
  });
}
$('#spectralMode').addEventListener('change', event => {
  parameters.spectralBands = Number(event.target.value);
  compareBaseline = false;
  baselineButton.setAttribute('aria-pressed', 'false');
  invalidate = true;
  status(parameters.spectralBands === 3 ? 'RGB 三通道 · 当前折射参数' : `${parameters.spectralBands} 波段光谱近似 · 当前折射参数`);
});
$('#send').addEventListener('click', () => status('这是本地材质预览，输入内容仅保留在当前页面'));
$('#theme').addEventListener('change', () => {
  document.body.classList.toggle('dark', $('#theme').value === 'dark');
  backgroundDirty = true;
  invalidate = true;
});
$('#background').addEventListener('change', () => { backgroundDirty = true; invalidate = true; });
$('#scroll').addEventListener('input', (event) => { currentScroll = Number(event.target.value); backgroundDirty = true; invalidate = true; });
canvas.addEventListener('wheel', (event) => {
  event.preventDefault();
  currentScroll = Math.max(0, Math.min(950, currentScroll + event.deltaY * 0.5));
  $('#scroll').value = currentScroll;
  backgroundDirty = true;
  invalidate = true;
}, { passive: false });
$('#autoScroll').checked = false;
$('#reset').addEventListener('click', () => {
  parameters = { ...defaults };
  compareBaseline = false;
  baselineButton.setAttribute('aria-pressed', 'false');
  BASE_PRESET.positions.forEach((position, index) => { positions[index] = { ...position }; });
  currentScroll = BASE_PRESET.scroll;
  $('#scroll').value = currentScroll;
  $('#autoScroll').checked = false;
  updateControls();
  positionContent();
  backgroundDirty = true;
  invalidate = true;
  status('已恢复光谱实验默认参数');
});
$('#export').addEventListener('click', () => {
  const state = { version: 2, source: 'EasyMint Web spectral experiment', parameters: { ...effectiveParameters() }, theme: $('#theme').value, background: $('#background').value, positions, scroll: currentScroll };
  const url = URL.createObjectURL(new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'easymint-liquid-spectral.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  status('参数已导出，可用“导入参数”恢复');
});
$('#import').addEventListener('click', () => $('#file').click());
$('#file').addEventListener('change', async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    if (file.size > 100000) throw new Error('参数文件过大');
    const state = JSON.parse(await file.text());
    if (![1, 2].includes(state.version) || !state.parameters || typeof state.parameters !== 'object') throw new Error('参数文件格式不匹配');
    const next = { ...defaults };
    for (const [key, , min, max] of definitions) {
      const value = state.parameters[key];
      if (['referenceScale','thicknessGain','curveGain','spectralGain','saturation'].includes(key) && value === undefined) continue;
      if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(`参数 ${key} 超出范围或缺失`);
      next[key] = value;
    }
    if (state.parameters.spectralBands !== undefined) {
      if (![3,8,12].includes(state.parameters.spectralBands)) throw new Error('色散模式必须为 RGB、8 或 12 波段');
      next.spectralBands = state.parameters.spectralBands;
    }
    parameters = next;
    if (['light', 'dark'].includes(state.theme)) $('#theme').value = state.theme;
    if (['chat', 'spectrum', 'plain'].includes(state.background)) $('#background').value = state.background;
    if (Array.isArray(state.positions) && state.positions.length === 2 && state.positions.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))) {
      state.positions.forEach((p, index) => { positions[index] = { x: p.x, y: p.y }; });
    }
    currentScroll = Number.isFinite(state.scroll) ? Math.max(0, Math.min(950, state.scroll)) : 0;
    $('#scroll').value = currentScroll;
    $('#theme').dispatchEvent(new Event('change'));
    compareBaseline = false;
    baselineButton.setAttribute('aria-pressed', 'false');
    updateControls();
    positionContent();
    status('参数已导入');
  } catch (error) {
    status(`导入失败：${error.message}`);
  }
  event.target.value = '';
});

$('#theme').value = BASE_PRESET.theme;
$('#background').value = BASE_PRESET.background;
$('#scroll').value = currentScroll;
document.body.classList.toggle('dark', BASE_PRESET.theme === 'dark');

const backgroundCanvas = document.createElement('canvas');
backgroundCanvas.width = canvas.width;
backgroundCanvas.height = canvas.height;
const ctx = backgroundCanvas.getContext('2d');
function paintBackground() {
  const dark = $('#theme').value === 'dark';
  const mode = $('#background').value;
  ctx.setTransform(resolutionScale, 0, 0, resolutionScale, 0, 0);
  ctx.clearRect(0, 0, viewport.width, viewport.height);
  ctx.fillStyle = dark ? '#0b1310' : '#edf2ec';
  ctx.fillRect(0, 0, viewport.width, viewport.height);
  for (const [x, y, radius, color] of [
    [-30, -40, 600, dark ? '#17553dcc' : '#cfe8d8cc'],
    [420, 20, 550, dark ? '#1b3557cc' : '#dbe6f8cc'],
    [180, 870, 500, dark ? '#19334bcc' : '#dce9f5cc'],
  ]) {
    const glow = ctx.createRadialGradient(x, y, 0, x, y, radius);
    glow.addColorStop(0, color);
    glow.addColorStop(1, color.slice(0, 7) + '00');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, viewport.width, viewport.height);
  }
  if (mode === 'plain') return;
  ctx.save();
  ctx.translate(0, -currentScroll);
  if (mode === 'spectrum') {
    const gradient = ctx.createLinearGradient(0, 0, 390, 1000);
    for (const [stop, color] of [[0, '#728cd0'], [0.3, '#c968b8'], [0.6, '#ff8f77'], [1, '#6caaa7']]) gradient.addColorStop(stop, color);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 390, 1800);
    ctx.strokeStyle = dark ? '#17243d66' : '#ffffff55';
    ctx.lineWidth = 0.6;
    for (let x = 0; x <= 390; x += 24) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 1800); ctx.stroke(); }
    for (let y = 0; y <= 1800; y += 24) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(390, y); ctx.stroke(); }
    ctx.lineWidth = 16;
    ctx.strokeStyle = '#274ca2';
    ctx.beginPath(); ctx.moveTo(-20, 280); ctx.bezierCurveTo(400, 200, 20, 620, 410, 780); ctx.stroke();
    ctx.fillStyle = '#182b3b'; ctx.font = '600 32px sans-serif'; ctx.fillText('Stay curious.', 24, 195);
  } else {
    ctx.fillStyle = dark ? '#d4d4d4' : '#253129';
    ctx.font = '600 18px sans-serif'; ctx.fillText('液态玻璃材质预览', 20, 125);
    ctx.font = '14px sans-serif';
    const lines = [
      '滚动这段文字，观察它穿过玻璃边缘。',
      '像素逐渐弯曲、拉伸，再平滑进入中心。',
      '左右暗边帮助亮色背景突出轮廓。',
      '上下亮边在暗色背景中提供厚度线索。',
    ];
    for (let block = 0; block < 6; block++) {
      const top = 175 + block * 260;
      lines.forEach((text, index) => ctx.fillText(text, 20, top + index * 27));
      ctx.strokeStyle = dark ? '#74847b55' : '#9da99b66';
      ctx.lineWidth = 0.6;
      for (let row = 0; row < 4; row++) {
        const y = top + 115 + row * 26;
        ctx.beginPath(); ctx.moveTo(20, y); ctx.lineTo(370, y); ctx.stroke();
        if (row < 3) {
          ctx.fillText(['范围', '幅度', '色散'][row], 28, y + 19);
          ctx.fillText(['连续过渡', '小幅增强', '集中在边缘'][row], 185, y + 19);
        }
      }
      ctx.fillStyle = dark ? '#254f91' : '#c6e7d0';
      ctx.beginPath(); ctx.roundRect(150, top + 225, 220, 32, 8); ctx.fill();
      ctx.fillStyle = dark ? '#e3e9f5' : '#1c4d32';
      ctx.fillText('背景颜色参与边缘光影', 165, top + 247);
      ctx.fillStyle = dark ? '#d4d4d4' : '#253129';
    }
  }
  ctx.restore();
}

const vertex = `#version 300 es
layout(location=0) in vec2 position;
out vec2 vUv;
void main(){vUv=position*0.5+0.5;gl_Position=vec4(position,0.0,1.0);}`;
const blurFragment = `#version 300 es
precision highp float;
uniform sampler2D inputTexture;
uniform vec2 direction;
uniform vec2 dimensions;
uniform float blurRadius;
in vec2 vUv;out vec4 fragColor;
void main(){
  vec4 sum=vec4(0.0);float weightSum=0.0;
  for(int i=-4;i<=4;i++){
    float weight=exp(-float(i*i)/8.0);
    vec2 delta=direction*float(i)*blurRadius*0.5/dimensions;
    sum+=texture(inputTexture,clamp(vUv+delta,vec2(0.001),vec2(0.999)))*weight;
    weightSum+=weight;
  }
  fragColor=sum/weightSum;
}`;
function createProgram(fragment) {
  const shaders = [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]].map(([type, source]) => {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
    return shader;
  });
  const program = gl.createProgram();
  shaders.forEach((shader) => gl.attachShader(program, shader));
  gl.linkProgram(program);
  shaders.forEach((shader) => gl.deleteShader(shader));
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
  return program;
}
function createTexture() {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, canvas.width, canvas.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  return texture;
}
function setup() {
  if (!gl) throw new Error('浏览器无法启动 WebGL 2，请使用支持硬件加速的浏览器。');
  const program = createProgram(materialFragment);
  const blurProgram = createProgram(blurFragment);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const sourceTexture = createTexture();
  const targets = [0, 1].map(() => {
    const texture = createTexture();
    const framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('背景模糊缓冲创建失败');
    return { texture, framebuffer };
  });
  const locations = new Map();
  function location(shader, name) {
    const key = `${shader === program ? 'material' : 'blur'}:${name}`;
    if (!locations.has(key)) locations.set(key, gl.getUniformLocation(shader, name));
    return locations.get(key);
  }
  function drawBackground() {
    paintBackground();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTexture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, backgroundCanvas);
    gl.useProgram(blurProgram);
    gl.uniform1i(location(blurProgram, 'inputTexture'), 0);
    gl.uniform2f(location(blurProgram, 'dimensions'), canvas.width, canvas.height);
    gl.uniform1f(location(blurProgram, 'blurRadius'), effectiveParameters().blur * resolutionScale);
    for (const [index, target] of targets.entries()) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
      gl.bindTexture(gl.TEXTURE_2D, index === 0 ? sourceTexture : targets[0].texture);
      gl.uniform2f(location(blurProgram, 'direction'), index === 0 ? 1 : 0, index === 1 ? 1 : 0);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
  function render(time) {
    frameId = requestAnimationFrame(render);
    const elapsed = Math.min((time - lastTime) / 1000, 0.05);
    lastTime = time;
    if (document.hidden) return;
    if ($('#autoScroll').checked) {
      currentScroll = (currentScroll + elapsed * 22) % 950;
      $('#scroll').value = currentScroll;
      backgroundDirty = true;
      invalidate = true;
    }
    if (!invalidate) return;
    if (backgroundDirty) { drawBackground(); backgroundDirty = false; }
    const p = effectiveParameters();
    gl.useProgram(program);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, targets[1].texture);
    gl.uniform1i(location(program, 'uBackdrop'), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, sourceTexture);
    gl.uniform1i(location(program, 'uScene'), 1);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform2f(location(program, 'uViewport'), viewport.width, viewport.height);
    gl.uniform4fv(location(program, 'uRects[0]'), new Float32Array(geometry().flatMap((r) => [r.x, r.y, r.width, r.height])));
    gl.uniform1fv(location(program, 'uRadii[0]'), new Float32Array(geometry().map((r) => r.radius)));
    const tint = $('#theme').value === 'dark' ? p.tintDark : p.tintLight;
    gl.uniform1f(location(program, 'u_tint'), tint);
    gl.uniform4fv(location(program, 'u_spectrum[0]'), spectrumUniforms(p.spectralBands === 12 ? 12 : 8));
    for (const [key, value] of Object.entries(p)) gl.uniform1f(location(program, `u_${key}`), value);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    invalidate = false;
  }
  canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    cancelAnimationFrame(frameId);
    $('#error').hidden = false;
    $('#error').textContent = '图形上下文已丢失，请刷新页面。';
  });
  canvas.addEventListener('webglcontextrestored', () => window.location.reload());
  window.addEventListener('pagehide', (event) => {
    if (event.persisted) return;
    cancelAnimationFrame(frameId);
    gl.deleteBuffer(buffer);
    gl.deleteTexture(sourceTexture);
    targets.forEach((target) => { gl.deleteTexture(target.texture); gl.deleteFramebuffer(target.framebuffer); });
    gl.deleteProgram(program);
    gl.deleteProgram(blurProgram);
  }, { once: true });
  frameId = requestAnimationFrame(render);
}
try { setup(); canvas.dataset.backend = 'webgl2'; } catch (error) {
  $('#error').hidden = false;
  $('#error').textContent = `材质预览启动失败：${error.message}`;
  status('渲染未启动');
}
positionContent();
