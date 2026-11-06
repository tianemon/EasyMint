import html2canvas from 'html2canvas';
import { LIQUID_MATERIAL_CORE } from './liquid-material-source';
import preset from '../../../resources/visual-design/liquid-template-preset.json';

type Capture = {
  target: HTMLElement;
  texture: WebGLTexture | null;
  framebuffer: WebGLFramebuffer | null;
  blurred: WebGLTexture | null;
  scratch: WebGLTexture | null;
  scratchFramebuffer: WebGLFramebuffer | null;
  width: number;
  height: number;
  revision: number;
  pending: boolean;
  ready: boolean;
};
const vertexSource = `#version 300 es
layout(location=0) in vec2 position;out vec2 vUv;
void main(){vUv=position*.5+.5;gl_Position=vec4(position,0,1);}`;
const blurSource = `#version 300 es
precision highp float;uniform sampler2D image;uniform vec2 direction;uniform vec2 dimensions;uniform float radius;
in vec2 vUv;out vec4 fragColor;
void main(){vec4 sum=vec4(0);float weights=0.;for(int i=-4;i<=4;i++){
float weight=exp(-float(i*i)/8.);vec2 offset=direction*float(i)*radius*.5/dimensions;
sum+=texture(image,clamp(vUv+offset,vec2(.0001),vec2(.9999)))*weight;weights+=weight;}fragColor=sum/weights;}`;
const geometryUniforms = 'uniform vec2 size; uniform float radius; uniform float bevel; uniform float refractionWidth; uniform float pixelScale; uniform float padding;';
const core = LIQUID_MATERIAL_CORE.replace(/uniform (?:vec2|float) (?:size|radius|bevel|refractionWidth|pixelScale|padding);/g, '')
  .replace('smoothstep(-0.75, 0.75, distance)', 'smoothstep(-max(fwidth(distance),0.75),max(fwidth(distance),0.75),distance)');
const materialSource = `#version 300 es
precision highp float;${geometryUniforms}
uniform sampler2D scene;uniform vec2 captureOffset;uniform vec2 captureScale;uniform vec2 captureSize;
uniform float referenceScale;uniform float tint;uniform vec4 outsideColor;in vec2 vUv;out vec4 fragColor;
vec4 sampleCapture(vec2 uv){vec2 point=captureOffset+(uv-padding)/referenceScale*captureScale;
if(any(lessThan(point,vec2(0)))||any(greaterThan(point,captureSize)))return outsideColor;
vec2 t=clamp(point/captureSize,vec2(.0001),vec2(.9999));vec4 sampled=texture(scene,vec2(t.x,1.-t.y));
return vec4(sampled.rgb+outsideColor.rgb*(1.-sampled.a),1.);}
${core}
void main(){vec2 point=vec2(vUv.x,1.-vUv.y)*size;vec4 color=shadeGlass(point+padding);
float d=surfaceDistance(point);float aa=max(fwidth(d),.75);float coverage=1.-smoothstep(-aa,aa,d);
fragColor=vec4(color.rgb*(1.-tint)*coverage,color.a*coverage);}`;

/** The exported runtime bundles this same renderer and DOM capture dependency. */
export function mountLiquidWebGL(root: HTMLElement): () => void {
  const reducedTransparency = matchMedia('(prefers-reduced-transparency:reduce)');
  const scratchCanvas: HTMLCanvasElement | OffscreenCanvas = typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(1, 1) : document.createElement('canvas');
  const gl = scratchCanvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false,
    preserveDrawingBuffer: true }) as WebGL2RenderingContext | null;
  if (!gl) {
    root.dataset.liquidBackend = 'blur-fallback';
    root.dataset.liquidError = 'WebGL 2 unavailable';
    return () => {};
  }
  const captures = new Map<HTMLElement, Capture>();
  const surfaces = new Map<HTMLElement, HTMLCanvasElement>();
  const parameters = preset.parameters;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const referenceScale = parameters.referenceScale;
  let disposed = false;
  let frame = 0;
  let captureTimer: ReturnType<typeof setTimeout> | undefined;
  let animateUntil = 0;
  let failed = false;
  let material: WebGLProgram;
  let blur: WebGLProgram;
  const shaders: WebGLShader[] = [];
  const programs: WebGLProgram[] = [];
  const locations = new Map<string, WebGLUniformLocation | null>();

  function program(fragment: string) {
    const result = gl!.createProgram()!;
    for (const [type, source] of [[gl!.VERTEX_SHADER, vertexSource], [gl!.FRAGMENT_SHADER, fragment]] as const) {
      const shader = gl!.createShader(type)!;
      shaders.push(shader);
      gl!.shaderSource(shader, source);
      gl!.compileShader(shader);
      if (!gl!.getShaderParameter(shader, gl!.COMPILE_STATUS)) throw new Error(gl!.getShaderInfoLog(shader) || 'Liquid shader compilation failed');
      gl!.attachShader(result, shader);
    }
    gl!.linkProgram(result);
    programs.push(result);
    if (!gl!.getProgramParameter(result, gl!.LINK_STATUS)) throw new Error(gl!.getProgramInfoLog(result) || 'Liquid shader link failed');
    return result;
  }
  function location(p: WebGLProgram, name: string) {
    const key = `${p === material ? 'material' : 'blur'}:${name}`;
    if (!locations.has(key)) locations.set(key, gl!.getUniformLocation(p, name));
    return locations.get(key)!;
  }
  function releaseCapture(capture: Capture) {
    for (const texture of [capture.texture, capture.blurred, capture.scratch]) if (texture) gl!.deleteTexture(texture);
    if (capture.framebuffer) gl!.deleteFramebuffer(capture.framebuffer);
    if (capture.scratchFramebuffer) gl!.deleteFramebuffer(capture.scratchFramebuffer);
    capture.texture = capture.blurred = capture.scratch = null;
    capture.framebuffer = capture.scratchFramebuffer = null;
    capture.ready = false;
  }
  function texture(width: number, height: number, canvas?: HTMLCanvasElement) {
    const result = gl!.createTexture()!;
    gl!.bindTexture(gl!.TEXTURE_2D, result);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MIN_FILTER, gl!.LINEAR);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MAG_FILTER, gl!.LINEAR);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_S, gl!.CLAMP_TO_EDGE);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_T, gl!.CLAMP_TO_EDGE);
    if (canvas) {
      gl!.pixelStorei(gl!.UNPACK_FLIP_Y_WEBGL, true);
      gl!.texImage2D(gl!.TEXTURE_2D, 0, gl!.RGBA, gl!.RGBA, gl!.UNSIGNED_BYTE, canvas);
    } else gl!.texImage2D(gl!.TEXTURE_2D, 0, gl!.RGBA, width, height, 0, gl!.RGBA, gl!.UNSIGNED_BYTE, null);
    return result;
  }
  function framebuffer(image: WebGLTexture) {
    const result = gl!.createFramebuffer()!;
    gl!.bindFramebuffer(gl!.FRAMEBUFFER, result);
    gl!.framebufferTexture2D(gl!.FRAMEBUFFER, gl!.COLOR_ATTACHMENT0, gl!.TEXTURE_2D, image, 0);
    if (gl!.checkFramebufferStatus(gl!.FRAMEBUFFER) !== gl!.FRAMEBUFFER_COMPLETE) throw new Error('Liquid capture buffer unavailable');
    return result;
  }
  function fail(error: unknown) {
    if (disposed || failed) return;
    failed = true;
    root.dataset.liquidBackend = 'blur-fallback';
    root.dataset.liquidError = error instanceof Error ? error.message : String(error);
    surfaces.forEach(canvas => canvas.remove());
    console.warn('EasyMint Liquid Glass fallback:', root.dataset.liquidError);
  }
  try {
    material = program(materialSource);
    blur = program(blurSource);
  } catch (error) {
    fail(error);
    programs.forEach(p => gl.deleteProgram(p));
    shaders.forEach(s => gl.deleteShader(s));
    return () => {};
  }
  const buffer = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  function captureFor(surface: HTMLElement) {
    const player = surface.closest<HTMLElement>('.ios-player-sheet');
    const target = player || root.querySelector<HTMLElement>('[data-liquid-backdrop],[data-ios-scroll]') || root;
    let result = captures.get(target);
    if (!result) {
      result = { target, texture: null, framebuffer: null, blurred: null, scratch: null, scratchFramebuffer: null,
        width: 0, height: 0, revision: 0, pending: false, ready: false };
      captures.set(target, result);
    }
    return result;
  }
  function blurCapture(capture: Capture, canvas: HTMLCanvasElement) {
    releaseCapture(capture);
    capture.texture = texture(canvas.width, canvas.height, canvas);
    capture.scratch = texture(canvas.width, canvas.height);
    capture.blurred = texture(canvas.width, canvas.height);
    capture.scratchFramebuffer = framebuffer(capture.scratch);
    capture.framebuffer = framebuffer(capture.blurred);
    gl!.useProgram(blur);
    gl!.uniform1i(location(blur, 'image'), 0);
    gl!.uniform2f(location(blur, 'dimensions'), canvas.width, canvas.height);
    const blurRadius = root.dataset.effect === 'standard' ? Math.max(3, parameters.blur) : parameters.blur;
    gl!.uniform1f(location(blur, 'radius'), blurRadius * (canvas.width / capture.width));
    for (let index = 0; index < 2; index++) {
      gl!.bindFramebuffer(gl!.FRAMEBUFFER, index === 0 ? capture.scratchFramebuffer : capture.framebuffer);
      gl!.bindTexture(gl!.TEXTURE_2D, index === 0 ? capture.texture : capture.scratch);
      gl!.uniform2f(location(blur, 'direction'), index === 0 ? 1 : 0, index === 1 ? 1 : 0);
      gl!.viewport(0, 0, canvas.width, canvas.height);
      gl!.drawArrays(gl!.TRIANGLES, 0, 6);
    }
    gl!.bindFramebuffer(gl!.FRAMEBUFFER, null);
    capture.ready = true;
  }
  async function refreshCapture(capture: Capture) {
    if (disposed || failed || capture.pending || capture.target.getBoundingClientRect().width === 0) return;
    capture.pending = true;
    const revision = capture.revision;
    const target = capture.target;
    const width = target.offsetWidth;
    const height = Math.max(target.scrollHeight, target.offsetHeight);
    const limit = gl!.getParameter(gl!.MAX_TEXTURE_SIZE) as number;
    const scale = Math.min(dpr, limit / Math.max(width, height));
    try {
      const image = await html2canvas(target, {
        backgroundColor: getComputedStyle(target.classList.contains('ios-player-sheet') ? target : root).backgroundColor,
        width, height, scale, logging: false, useCORS: true, foreignObjectRendering: true,
        ignoreElements: element => {
          if (element.hasAttribute('data-liquid-canvas')) return true;
          if (['HEAD','STYLE','LINK','META','TITLE'].includes(element.tagName)) return false;
          return element !== target && !element.contains(target) && !target.contains(element);
        },
        onclone: (_document, cloned) => {
          const scene = cloned.closest<HTMLElement>('.sc-page');
          if (scene) { scene.style.overflow = 'visible'; scene.style.height = 'auto'; scene.style.minHeight = '0'; }
          cloned.style.width = `${width}px`;
          cloned.style.height = `${height}px`;
          cloned.style.maxHeight = 'none';
          cloned.style.overflow = 'visible';
          cloned.style.transform = 'none';
          cloned.style.opacity = '1';
          cloned.scrollTop = 0;
          cloned.querySelectorAll<HTMLElement>('[data-ios-optic],[data-liquid-glass]').forEach(element => { element.style.visibility = 'hidden'; });
        },
      });
      if (disposed || failed || reducedTransparency.matches || revision !== capture.revision) return;
      capture.width = width;
      capture.height = height;
      blurCapture(capture, image);
      root.dataset.liquidBackend = 'webgl2';
      schedule();
    } catch (error) { fail(error); }
    finally {
      capture.pending = false;
      if (!disposed && !failed && revision !== capture.revision) void refreshCapture(capture);
    }
  }
  function draw() {
    frame = 0;
    if (disposed || failed || document.hidden || reducedTransparency.matches) return;
    for (const surface of root.querySelectorAll<HTMLElement>('[data-ios-optic],[data-liquid-glass]')) {
      const box = surface.getBoundingClientRect();
      if (!box.width || !box.height || surface.closest('[hidden]')) continue;
      const capture = captureFor(surface);
      if (!capture.ready) { void refreshCapture(capture); continue; }
      let canvas = surfaces.get(surface);
      if (!canvas) {
        canvas = document.createElement('canvas');
        canvas.dataset.liquidCanvas = '';
        canvas.setAttribute('aria-hidden', 'true');
        canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;border-radius:inherit;pointer-events:none;z-index:0';
        surface.prepend(canvas);
        surfaces.set(surface, canvas);
      }
      const width = surface.offsetWidth;
      const height = surface.offsetHeight;
      const rasterWidth = Math.max(1, Math.round(width * dpr));
      const rasterHeight = Math.max(1, Math.round(height * dpr));
      if (canvas.width !== rasterWidth || canvas.height !== rasterHeight) {
        canvas.width = rasterWidth; canvas.height = rasterHeight;
      }
      if (scratchCanvas.width !== rasterWidth || scratchCanvas.height !== rasterHeight) {
        scratchCanvas.width = rasterWidth; scratchCanvas.height = rasterHeight;
      }
      const captureBox = capture.target.getBoundingClientRect();
      const scaleX = captureBox.width / capture.target.offsetWidth || 1;
      const scaleY = captureBox.height / capture.target.offsetHeight || 1;
      const rawRadius = getComputedStyle(surface).borderTopLeftRadius;
      const radius = rawRadius.endsWith('%') ? parseFloat(rawRadius) * Math.min(width, height) / 100 : parseFloat(rawRadius) || 0;
      gl!.bindFramebuffer(gl!.FRAMEBUFFER, null);
      gl!.viewport(0, 0, rasterWidth, rasterHeight);
      gl!.useProgram(material);
      gl!.bindTexture(gl!.TEXTURE_2D, capture.blurred);
      gl!.uniform1i(location(material, 'scene'), 0);
      gl!.uniform2f(location(material, 'size'), width * referenceScale, height * referenceScale);
      gl!.uniform1f(location(material, 'radius'), Math.min(radius, width / 2, height / 2) * referenceScale);
      gl!.uniform1f(location(material, 'pixelScale'), referenceScale);
      gl!.uniform1f(location(material, 'padding'), 26 * referenceScale);
      gl!.uniform1f(location(material, 'bevel'), height * parameters.bevelRatio * referenceScale);
      gl!.uniform1f(location(material, 'refractionWidth'), height * parameters.bevelRatio * parameters.width * referenceScale);
      gl!.uniform1f(location(material, 'referenceScale'), referenceScale);
      const base = getComputedStyle(capture.target.classList.contains('ios-player-sheet') ? capture.target : root).backgroundColor;
      const components = base.match(/[\d.]+/g)?.map(Number) || [247,247,250];
      gl!.uniform4f(location(material, 'outsideColor'), (components[0] || 0)/255, (components[1] || 0)/255, (components[2] || 0)/255, 1);
      gl!.uniform2f(location(material, 'captureSize'), capture.width, capture.height);
      gl!.uniform2f(location(material, 'captureOffset'),
        (box.left - captureBox.left) / scaleX + capture.target.scrollLeft,
        (box.top - captureBox.top) / scaleY + capture.target.scrollTop);
      gl!.uniform2f(location(material, 'captureScale'), box.width / width / scaleX, box.height / height / scaleY);
      const dark = !!surface.closest('.ios-player-sheet') || root.dataset.theme === 'dark';
      gl!.uniform1f(location(material, 'tint'), dark ? parameters.tintDark : parameters.tintLight);
      for (const [key, value] of Object.entries(parameters)) gl!.uniform1f(location(material, `u_${key}`), value);
      gl!.drawArrays(gl!.TRIANGLES, 0, 6);
      const context = canvas.getContext('2d');
      context?.clearRect(0, 0, rasterWidth, rasterHeight);
      if (typeof OffscreenCanvas !== 'undefined' && scratchCanvas instanceof OffscreenCanvas) {
        // Freeze each surface before reusing/resizing the shared GL buffer.
        const bitmap = scratchCanvas.transferToImageBitmap();
        context?.drawImage(bitmap, 0, 0, rasterWidth, rasterHeight);
        bitmap.close();
      } else {
        gl!.flush();
        context?.drawImage(scratchCanvas, 0, 0, rasterWidth, rasterHeight);
      }
    }
    if (performance.now() < animateUntil) schedule();
  }
  function schedule() {
    if (!disposed && !failed && !frame) frame = requestAnimationFrame(draw);
  }
  function invalidateCaptures() {
    for (const capture of captures.values()) { capture.revision++; capture.ready = false; }
    clearTimeout(captureTimer);
    captureTimer = setTimeout(() => { for (const capture of captures.values()) void refreshCapture(capture); }, 70);
    animateUntil = performance.now() + 550;
    schedule();
  }
  const mutation = new MutationObserver(records => {
    const changed = records.some(record => {
      const element = record.target instanceof Element ? record.target : record.target.parentElement;
      if (!element || element.closest('[data-ios-optic],[data-liquid-glass],[data-liquid-canvas]')) return false;
      if (record.type === 'attributes' && record.target === root) return ['data-effect', 'data-theme'].includes(record.attributeName || '');
      return true;
    });
    if (changed) invalidateCaptures();
    else schedule();
  });
  mutation.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'data-effect', 'data-theme'] });
  let lastWidth = root.offsetWidth;
  const resize = new ResizeObserver(() => {
    if (root.offsetWidth !== lastWidth) { lastWidth = root.offsetWidth; invalidateCaptures(); }
    animateUntil = performance.now() + 550;
    schedule();
  });
  resize.observe(root);
  root.querySelectorAll<HTMLElement>('[data-ios-optic],[data-liquid-glass]').forEach(surface => resize.observe(surface));
  const onInteraction = () => { animateUntil = performance.now() + 550; schedule(); };
  const onVisibility = () => { if (!document.hidden) schedule(); };
  root.addEventListener('scroll', onInteraction, true);
  root.addEventListener('click', onInteraction);
  root.addEventListener('pointerdown', onInteraction);
  root.addEventListener('input', onInteraction);
  document.addEventListener('visibilitychange', onVisibility);
  scratchCanvas.addEventListener('webglcontextlost', event => { event.preventDefault(); fail(new Error('WebGL context lost')); });
  void document.fonts.ready.then(() => { if (!disposed) invalidateCaptures(); });
  const onTransparency = () => {
    if (reducedTransparency.matches) {
      root.dataset.liquidBackend = 'reduced-transparency';
      surfaces.forEach(canvas => { canvas.hidden = true; });
    } else {
      root.dataset.liquidBackend = 'capturing';
      surfaces.forEach(canvas => { canvas.hidden = false; });
      invalidateCaptures();
    }
  };
  reducedTransparency.addEventListener('change', onTransparency);
  onTransparency();
  return () => {
    disposed = true;
    cancelAnimationFrame(frame);
    clearTimeout(captureTimer);
    mutation.disconnect();
    resize.disconnect();
    root.removeEventListener('scroll', onInteraction, true);
    root.removeEventListener('click', onInteraction);
    root.removeEventListener('pointerdown', onInteraction);
    root.removeEventListener('input', onInteraction);
    document.removeEventListener('visibilitychange', onVisibility);
    reducedTransparency.removeEventListener('change', onTransparency);
    surfaces.forEach(canvas => canvas.remove());
    captures.forEach(releaseCapture);
    gl.deleteBuffer(buffer);
    programs.forEach(p => gl.deleteProgram(p));
    shaders.forEach(s => gl.deleteShader(s));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    delete root.dataset.liquidBackend;
    delete root.dataset.liquidError;
  };
}
