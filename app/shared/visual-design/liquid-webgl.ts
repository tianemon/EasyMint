import html2canvas from 'html2canvas';
import { freezeCaptureScroll } from './liquid-capture-scroll';
import { LIQUID_MATERIAL_CORE } from './liquid-material-source';
import preset from '../../../resources/visual-design/liquid-template-preset.json';

export type LiquidFrame = { image: HTMLCanvasElement; x: number; y: number; width: number; height: number; revision: number };
type Capture = {
  external?: boolean; frameRevision?: number; rasterWidth?: number; rasterHeight?: number;
  target: HTMLElement;
  surface?: HTMLElement;
  x: number; y: number;
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
export function mountLiquidWebGL(root: HTMLElement, options: { liveBackdrop?: boolean; excludeFromCapture?: string; scrollContainers?: string; frameSource?: (surface: HTMLElement) => LiquidFrame | null | undefined } = {}): () => void {
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
  let scrollEndTimer: ReturnType<typeof setTimeout> | undefined;
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
    const target = options.liveBackdrop ? root : player || root.querySelector<HTMLElement>('[data-liquid-backdrop],[data-ios-scroll]') || root;
    const key = options.liveBackdrop ? surface : target;
    let result = captures.get(key);
    if (!result) {
      result = { target, surface: options.liveBackdrop ? surface : undefined, x: 0, y: 0, texture: null, framebuffer: null, blurred: null, scratch: null, scratchFramebuffer: null,
        width: 0, height: 0, revision: 0, pending: false, ready: false };
      captures.set(key, result);
    }
    return result;
  }
  function blurCapture(capture: Capture, canvas: HTMLCanvasElement) {
    if (capture.rasterWidth !== canvas.width || capture.rasterHeight !== canvas.height || !capture.texture) {
      releaseCapture(capture);
      capture.texture = texture(canvas.width, canvas.height, canvas);
      capture.scratch = texture(canvas.width, canvas.height);
      capture.blurred = texture(canvas.width, canvas.height);
      capture.scratchFramebuffer = framebuffer(capture.scratch);
      capture.framebuffer = framebuffer(capture.blurred);
      capture.rasterWidth = canvas.width; capture.rasterHeight = canvas.height;
    } else {
      gl!.bindTexture(gl!.TEXTURE_2D, capture.texture);
      gl!.pixelStorei(gl!.UNPACK_FLIP_Y_WEBGL, true);
      gl!.texSubImage2D(gl!.TEXTURE_2D, 0, 0, 0, gl!.RGBA, gl!.UNSIGNED_BYTE, canvas);
    }
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
    if (capture.external || disposed || failed || capture.pending || capture.target.getBoundingClientRect().width === 0) return;
    capture.pending = true;
    const revision = capture.revision;
    const target = capture.target;
    const fullWidth = target.offsetWidth;
    const fullHeight = options.liveBackdrop ? target.offsetHeight : Math.max(target.scrollHeight, target.offsetHeight);
    const targetBox = target.getBoundingClientRect();
    const surfaceBox = capture.surface?.getBoundingClientRect();
    if (surfaceBox && (!surfaceBox.width || !surfaceBox.height)) { capture.pending = false; return; }
    const margin = 28; // Refraction needs pixels beyond the visible contour.
    const x = surfaceBox ? Math.max(0, Math.floor(surfaceBox.left - targetBox.left - margin)) : 0;
    const y = surfaceBox ? Math.max(0, Math.floor(surfaceBox.top - targetBox.top - margin)) : 0;
    const width = surfaceBox ? Math.max(1, Math.min(fullWidth, Math.ceil(surfaceBox.right - targetBox.left + margin)) - x) : fullWidth;
    const height = surfaceBox ? Math.max(1, Math.min(fullHeight, Math.ceil(surfaceBox.bottom - targetBox.top + margin)) - y) : fullHeight;
    const limit = gl!.getParameter(gl!.MAX_TEXTURE_SIZE) as number;
    const scale = Math.min(options.liveBackdrop ? 1 : dpr, limit / Math.max(width, height));
    try {
      let image = await html2canvas(target, {
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
          cloned.style.width = `${fullWidth}px`;
          cloned.style.height = `${fullHeight}px`;
          cloned.style.maxHeight = 'none';
          cloned.style.overflow = 'visible';
          cloned.style.transform = 'none';
          cloned.style.opacity = '1';
          cloned.scrollTop = 0;
          if (options.liveBackdrop && options.scrollContainers) freezeCaptureScroll(root, cloned, options.scrollContainers);
          if (options.excludeFromCapture) cloned.querySelectorAll<HTMLElement>(options.excludeFromCapture).forEach(element => { element.style.display = 'none'; });
          cloned.querySelectorAll<HTMLElement>('[data-ios-optic],[data-liquid-glass]').forEach(element => { element.style.visibility = 'hidden'; });
          if (options.liveBackdrop) {
            // Crop before foreignObject rasterization. Its scale<1 path clips content, so
            // rasterize this small strip at 1x and downsample before uploading the texture.
            const strip = cloned.ownerDocument.createElement('div');
            strip.style.cssText = `position:relative;width:${fullWidth}px;height:${fullHeight}px;transform:translate(${-x}px,${-y}px);transform-origin:0 0;`;
            strip.append(...cloned.childNodes);
            cloned.append(strip);
            cloned.style.width = `${width}px`; cloned.style.height = `${height}px`;
            cloned.style.position = 'fixed'; cloned.style.left = '0'; cloned.style.top = '0';
            cloned.style.margin = '0'; cloned.style.overflow = 'hidden';
          }
        },
      });
      if (disposed || failed || reducedTransparency.matches || (!options.liveBackdrop && revision !== capture.revision)) return;
      if (options.liveBackdrop) {
        const small = document.createElement('canvas');
        small.width = Math.max(1, Math.round(width * 0.5));
        small.height = Math.max(1, Math.round(height * 0.5));
        const context = small.getContext('2d');
        if (!context) throw new Error('Capture downsampling unavailable');
        context.drawImage(image, 0, 0, small.width, small.height);
        image = small;
      }
      capture.x = x; capture.y = y;
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
      const supplied = options.frameSource?.(surface);
      capture.external = supplied !== undefined;
      if (supplied !== undefined) {
        if (!supplied) {
          if (!surface.hasAttribute('data-liquid-waiting')) surface.setAttribute('data-liquid-waiting', '');
          continue;
        }
        if (surface.hasAttribute('data-liquid-waiting')) surface.removeAttribute('data-liquid-waiting');
        if (capture.frameRevision !== supplied.revision) {
          capture.x = supplied.x; capture.y = supplied.y; capture.width = supplied.width; capture.height = supplied.height;
          blurCapture(capture, supplied.image); capture.frameRevision = supplied.revision;
          root.dataset.liquidBackend = 'webgl2';
        }
      }
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
        (box.left - captureBox.left) / scaleX + capture.target.scrollLeft - capture.x,
        (box.top - captureBox.top) / scaleY + capture.target.scrollTop - capture.y);
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
    for (const capture of captures.values()) { capture.revision++; if (!options.liveBackdrop) capture.ready = false; }
    clearTimeout(captureTimer);
    captureTimer = setTimeout(() => { captureTimer = undefined; for (const capture of captures.values()) void refreshCapture(capture); }, 70);
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
    if (options.liveBackdrop || root.offsetWidth !== lastWidth) { lastWidth = root.offsetWidth; invalidateCaptures(); }
    animateUntil = performance.now() + 550;
    schedule();
  });
  resize.observe(root);
  root.querySelectorAll<HTMLElement>('[data-ios-optic],[data-liquid-glass]').forEach(surface => resize.observe(surface));
  const onInteraction = () => { animateUntil = performance.now() + 550; schedule(); };
  const onScroll = () => {
    onInteraction();
    if (options.liveBackdrop) { clearTimeout(scrollEndTimer); scrollEndTimer = setTimeout(onScrollEnd, 180); }
    if (options.liveBackdrop && !captureTimer) captureTimer = setTimeout(() => {
      captureTimer = undefined;
      for (const capture of captures.values()) void refreshCapture(capture);
    }, 100);
  };
  const onVisibility = () => { if (!document.hidden) invalidateCaptures(); };
  const onScrollEnd = () => {
    if (!options.liveBackdrop) return;
    clearTimeout(scrollEndTimer); scrollEndTimer = undefined;
    clearTimeout(captureTimer); captureTimer = undefined;
    for (const capture of captures.values()) { capture.revision++; void refreshCapture(capture); }
    onInteraction();
  };
  root.addEventListener('liquid-frame-ready', onInteraction);
  root.addEventListener('scrollend', onScrollEnd, true);
  root.addEventListener('scroll', onScroll, true);
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
    clearTimeout(scrollEndTimer);
    mutation.disconnect();
    resize.disconnect();
    root.removeEventListener('liquid-frame-ready', onInteraction);
    root.removeEventListener('scrollend', onScrollEnd, true);
    root.removeEventListener('scroll', onScroll, true);
    root.removeEventListener('click', onInteraction);
    root.removeEventListener('pointerdown', onInteraction);
    root.removeEventListener('input', onInteraction);
    document.removeEventListener('visibilitychange', onVisibility);
    reducedTransparency.removeEventListener('change', onTransparency);
    surfaces.forEach((canvas, surface) => { canvas.remove(); surface.removeAttribute('data-liquid-waiting'); });
    captures.forEach(releaseCapture);
    gl.deleteBuffer(buffer);
    programs.forEach(p => gl.deleteProgram(p));
    shaders.forEach(s => gl.deleteShader(s));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    delete root.dataset.liquidBackend;
    delete root.dataset.liquidError;
  };
}
