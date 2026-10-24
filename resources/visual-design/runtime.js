(() => {
  const root = document.querySelector('.visual-project');
  if (!root) return;
  const main = root.querySelector('.sample-main');
  const status = root.querySelector('.visual-status');
  const say = text => { if (status) status.textContent = text; };
  const closeSelect = select => {
    select.querySelector('[role=listbox]').hidden = true;
    select.querySelector('[data-select-toggle]').setAttribute('aria-expanded', 'false');
  };
  const openSelect = select => {
    root.querySelectorAll('.visual-select').forEach(other => { if (other !== select) closeSelect(other); });
    select.querySelector('[role=listbox]').hidden = false;
    select.querySelector('[data-select-toggle]').setAttribute('aria-expanded', 'true');
    select.querySelector('[aria-selected=true]')?.focus();
  };
  if (root.dataset.devicePolicy === 'auto') {
    const media = matchMedia('(max-width:640px)');
    const sync = () => { root.dataset.device = media.matches ? 'mobile' : 'web'; };
    sync();
    media.addEventListener('change', sync);
  }
  root.addEventListener('click', event => {
    const target = event.target.closest('button');
    if (!target) return;
    if (target.matches('[data-select-toggle]')) {
      const select = target.closest('.visual-select');
      if (select.querySelector('[role=listbox]').hidden) openSelect(select);
      else closeSelect(select);
    }
    if (target.matches('[role=option]')) {
      const select = target.closest('.visual-select');
      select.querySelectorAll('[role=option]').forEach(option => option.setAttribute('aria-selected', String(option === target)));
      select.querySelector('[data-select-label]').textContent = target.textContent;
      closeSelect(select);
      select.querySelector('[data-select-toggle]').focus();
      say(target.textContent);
    }
    if (target.matches('[data-open-dialog]')) root.querySelector('dialog')?.showModal();
    if (target.matches('[data-close-dialog]')) root.querySelector('dialog')?.close();
    if (target.matches('[data-action]')) say(target.dataset.action);
    if (target.matches('.visual-nav')) {
      root.querySelectorAll('.visual-nav').forEach(button => button.removeAttribute('aria-current'));
      target.setAttribute('aria-current', 'page');
      say(target.textContent);
    }
  });
  root.addEventListener('keydown', event => {
    const select = event.target.closest('.visual-select');
    if (!select) return;
    const list = select.querySelector('[role=listbox]');
    const options = [...list.querySelectorAll('[role=option]')];
    if (event.key === 'Escape' && !list.hidden) {
      event.preventDefault();
      event.stopPropagation();
      closeSelect(select);
      select.querySelector('[data-select-toggle]').focus();
    }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const wasHidden = list.hidden;
      if (wasHidden) openSelect(select);
      let index = options.indexOf(document.activeElement);
      index = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1
        : wasHidden ? Math.max(0, index) : (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
      options[index]?.focus();
    }
  });
  document.addEventListener('click', event => root.querySelectorAll('.visual-select').forEach(select => {
    if (!select.contains(event.target)) closeSelect(select);
  }));
  document.addEventListener('focusin', event => root.querySelectorAll('.visual-select').forEach(select => {
    if (!select.contains(event.target)) closeSelect(select);
  }));
  root.querySelectorAll('.gallery-range input[type=range]').forEach(input => {
    const sync = () => {
      const min = Number(input.min || 0), max = Number(input.max || 100);
      const progress = max > min ? Math.max(0, Math.min(100, (Number(input.value) - min) / (max - min) * 100)) : 0;
      input.closest('.gallery-range').querySelector('i').style.width = `${progress}%`;
      const output = input.closest('.gallery-range-label')?.querySelector('output');
      if (output) output.textContent = `${input.value}%`;
    };
    input.addEventListener('input', sync);
    sync();
  });
  root.querySelectorAll('form').forEach(form => {
    form.noValidate = true;
    form.addEventListener('submit', event => {
      event.preventDefault();
      let first;
      form.querySelectorAll('input,textarea').forEach(input => {
        const valid = input.checkValidity();
        input.setAttribute('aria-invalid', String(!valid));
        if (!valid && !first) first = input;
      });
      if (first) {
        first.focus();
        say(document.documentElement.lang === 'en' ? 'Please check the highlighted fields.' : '请检查标记的输入项。');
      } else say('✓');
    });
  });
  if (main) {
    let frame;
    main.addEventListener('scroll', () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => parent.postMessage({ type: 'visual-preview-scroll', top: main.scrollTop }, '*'));
    });
    window.addEventListener('message', event => {
      if (event.source === parent && event.data?.type === 'visual-preview-restore' && Number.isFinite(event.data.top)) main.scrollTop = Math.max(0, event.data.top);
    });
  }
})();

/* EasyMint scene runtime */
/* geographic data: Natural Earth (public domain), world-atlas (ISC). Copyright 2013-2019 Michael Bostock. Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted, provided that the above copyright notice and this permission notice appear in all copies. THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE. */
/* MIT License

Copyright (c) 2026 Sohum Suthar

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
 */
(() => { const scene = document.querySelector('.sc-page'); if (!scene) return; const english = document.documentElement.lang === 'en'; if (scene.hasAttribute('data-ios-root')) { const engine = (function createGlassOpticsEngine() {
  const N_D = 1.5168;
  const N_C = 1.5143;
  const N_F = 1.5224;
  function dispersionScales(strength = 1) {
    const r = (N_C - 1) / (N_D - 1);
    const b = (N_F - 1) / (N_D - 1);
    return {
      red: 1 + (r - 1) * strength,
      green: 1,
      blue: 1 + (b - 1) * strength
    };
  }
  const surfaces = {
    squircle: (x) => Math.pow(1 - Math.pow(1 - x, 4), 0.25),
    circle: (x) => Math.sqrt(1 - Math.pow(1 - x, 2))
  };
  function derivative(f, x, h = 1e-4) {
    const a = Math.max(0, x - h);
    const b = Math.min(1, x + h);
    return (f(b) - f(a)) / (b - a);
  }
  function fresnelReflectance(thetaI, n = N_D) {
    const ci = Math.cos(thetaI);
    const st = Math.sin(thetaI) / n;
    if (st >= 1) return 1;
    const ct = Math.sqrt(1 - st * st);
    const rs = (ci - n * ct) / (ci + n * ct);
    const rp = (n * ci - ct) / (n * ci + ct);
    return 0.5 * (rs * rs + rp * rp);
  }
  function displacementProfile(x, {
    n = N_D,
    baseT = 0.35,
    surface = surfaces.squircle,
    fresnelFade = true
  } = {}) {
    const slope = derivative(surface, x);
    const thetaS = Math.atan(slope);
    const thetaR = Math.asin(Math.sin(thetaS) / n);
    const t = baseT + surface(x);
    let d = t * Math.tan(thetaS - thetaR);
    if (fresnelFade) d *= 1 - fresnelReflectance(thetaS, n);
    return d;
  }
  function buildDisplacementLUT(samples = 255, opts = {}) {
    const lut = new Float32Array(samples + 1);
    let peak = 0;
    for (let i = 0; i <= samples; i++) {
      const d = displacementProfile(i / samples, opts);
      lut[i] = d;
      if (d > peak) peak = d;
    }
    for (let i = 0; i <= samples; i++) lut[i] /= peak;
    return { lut, peak };
  }
  function sampleLUT(lut, t) {
    const s = lut.length - 1;
    const ft = Math.min(1, Math.max(0, t)) * s;
    const i = Math.floor(ft);
    const j = Math.min(s, i + 1);
    const frac = ft - i;
    return lut[i] * (1 - frac) + lut[j] * frac;
  }
  function sdfRoundedRect(px, py, w, h, r) {
    const qx = Math.abs(px - w / 2) - w / 2 + r;
    const qy = Math.abs(py - h / 2) - h / 2 + r;
    const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
    const inside = Math.min(Math.max(qx, qy), 0);
    return outside + inside - r;
  }
  function sdfGradient(px, py, w, h, r, e = 0.75) {
    const dx = sdfRoundedRect(px + e, py, w, h, r) - sdfRoundedRect(px - e, py, w, h, r);
    const dy = sdfRoundedRect(px, py + e, w, h, r) - sdfRoundedRect(px, py - e, w, h, r);
    const mag = Math.hypot(dx, dy) || 1;
    return { x: dx / mag, y: dy / mag };
  }
  function renderDisplacementMap(data, {
    width,
    height,
    radius,
    bezel,
    lut,
    channelDepth = 127
  } = {}) {
    for (let py = 0; py < height; py++) {
      for (let px = 0; px < width; px++) {
        const idx = (py * width + px) * 4;
        let r = 128;
        let g = 128;
        const dist = -sdfRoundedRect(px + 0.5, py + 0.5, width, height, radius);
        if (dist > 0 && dist < bezel) {
          const mag = sampleLUT(lut, dist / bezel);
          const nrm = sdfGradient(px + 0.5, py + 0.5, width, height, radius);
          r = Math.round(128 - nrm.x * mag * channelDepth);
          g = Math.round(128 - nrm.y * mag * channelDepth);
          r = Math.max(0, Math.min(255, r));
          g = Math.max(0, Math.min(255, g));
        }
        data[idx] = r;
        data[idx + 1] = g;
        data[idx + 2] = 128;
        data[idx + 3] = 255;
      }
    }
    return data;
  }
  function rimReflectanceProfile(samples = 32, { n = N_D, surface = surfaces.squircle } = {}) {
    const out = new Float32Array(samples + 1);
    for (let i = 0; i <= samples; i++) {
      const slope = derivative(surface, i / samples);
      out[i] = fresnelReflectance(Math.atan(slope), n);
    }
    return out;
  }
  return { buildDisplacementLUT, renderDisplacementMap, derivative, fresnelReflectance, sdfGradient, sdfRoundedRect, surfaces };
})(); const makeLens = (width,height,radius,options) => (function roundedLensMap(width, height, radius, options = {}, engine = defaultEngine) {
  const { buildDisplacementLUT, renderDisplacementMap, derivative, fresnelReflectance, sdfGradient, sdfRoundedRect, surfaces } = engine;
  const physicalWidth = Math.max(1, Number.isFinite(width) ? width : 1), physicalHeight = Math.max(1, Number.isFinite(height) ? height : 1);
  const sampling = Math.min(2, 512 / physicalWidth, 256 / physicalHeight);
  const mapWidth = Math.max(1, Math.round(physicalWidth * sampling)), mapHeight = Math.max(1, Math.round(physicalHeight * sampling));
  const r = Math.max(0, Math.min(Number.isFinite(radius) ? radius : 0, physicalWidth / 2, physicalHeight / 2)) * sampling;
  const bezel = Math.max(0.1, Math.min(options.bezel ?? 10, physicalWidth / 2, physicalHeight / 2));
  const thickness = options.thickness ?? 0.8, gain = options.gain ?? 1.5;
  const innerWeight = (t) => {
    const x = Math.max(0, Math.min(1, (t - 0.6) / 0.4));
    return 1 - x * x * x * (x * (x * 6 - 15) + 10);
  };
  const { lut, peak } = buildDisplacementLUT(512, { baseT: thickness, surface: surfaces.squircle, fresnelFade: true });
  for (let i = 0; i < lut.length; i++) lut[i] = lut[i] * innerWeight(i / (lut.length - 1));
  const data = new Uint8ClampedArray(mapWidth * mapHeight * 4), reflection = new Uint8ClampedArray(data.length);
  renderDisplacementMap(data, { width: mapWidth, height: mapHeight, radius: r, bezel: bezel * sampling, lut });
  for (let y = 0; y < mapHeight; y++) for (let x = 0; x < mapWidth; x++) {
    const depth = -sdfRoundedRect(x + 0.5, y + 0.5, mapWidth, mapHeight, r);
    if (depth <= -0.5 || depth >= bezel * sampling) continue;
    const t = Math.max(0, depth / (bezel * sampling)), angle = Math.atan(derivative(surfaces.squircle, t));
    const normal = sdfGradient(x + 0.5, y + 0.5, mapWidth, mapHeight, r);
    const light = Math.max(0, -normal.x * 0.6 - normal.y * 0.8);
    const alpha = (fresnelReflectance(angle) * (0.18 + 0.65 * light) + Math.pow(light, 10) * Math.pow(1 - t, 5) * 0.12) * innerWeight(t);
    reflection.set([255, 255, 255, Math.round(Math.min(0.8, alpha) * Math.min(1, depth + 0.5) * 255)], (y * mapWidth + x) * 4);
  }
  return { width: mapWidth, height: mapHeight, data, reflection, scale: 2 * peak * bezel * gain };
})(width,height,radius,options,engine); (function mountLiquidShowcase(root, english, makeLens, makeIcon) {
  const scroll = root.querySelector("[data-ios-scroll]");
  const controls = root.querySelector("[data-ios-controls]");
  const overlay = root.querySelector("[data-ios-player-overlay]");
  const tabs = root.querySelector("[data-ios-tabs]");
  const defs = root.querySelector("[data-ios-filters]");
  const svgNS = "http://www.w3.org/2000/svg";
  const prefix = `ios-${Math.random().toString(36).slice(2, 9)}`;
  const optics = [...root.querySelectorAll("[data-ios-optic]")];
  const filters = /* @__PURE__ */ new Map();
  const reduced = matchMedia("(prefers-reduced-transparency:reduce)");
  let disposed = false, openFrame = 0, frame = 0, pointerFrame = 0, closeTimer, noticeTimer;
  let previousScroll = 0, activeTab = root.querySelector('[data-ios-tab][aria-pressed="true"]')?.dataset.iosTab ?? "home", searching = root.dataset.iosSearching === "true", playing = root.dataset.iosPlaying === "true", currentTrack = Number(root.dataset.iosIndex) || 0;
  let focusOrigin = null;
  let tabDrag = null;
  const originals = [...root.querySelectorAll(".ios-home-pane .ios-album")];
  const playSvg = makeIcon("play");
  const pauseSvg = makeIcon("pause");
  const say = (a, b) => {
    const notice = root.querySelector(".ios-notice");
    if (!notice) return;
    clearTimeout(noticeTimer);
    notice.textContent = english ? a : b;
    notice.hidden = false;
    noticeTimer = setTimeout(() => {
      notice.hidden = true;
    }, 2300);
  };
  const liked = new Set((root.dataset.iosLiked ?? "").split(",").filter(Boolean).map(Number));
  let likedOnly = root.dataset.iosLibraryFilter === "liked";
  const queue = document.createElement("section");
  queue.className = "ios-queue-view";
  queue.hidden = true;
  queue.dataset.overlayEscape = "true";
  root.querySelector(".ios-player-sheet")?.append(queue);
  const filterLibrary = () => {
    root.querySelectorAll(".ios-library-list>[data-ios-album]").forEach((row) => {
      row.hidden = likedOnly && !liked.has(Number(row.dataset.iosAlbum));
    });
    let empty = root.querySelector(".ios-liked-empty");
    if (!empty) {
      empty = document.createElement("p");
      empty.className = "ios-liked-empty";
      empty.textContent = english ? "Like a track in the player to keep it here." : "\u5728\u64AD\u653E\u5668\u91CC\u559C\u6B22\u4E00\u9996\u6B4C\uFF0C\u5B83\u5C31\u4F1A\u6765\u5230\u8FD9\u91CC\u3002";
      root.querySelector('[data-ios-pane="library"]')?.append(empty);
    }
    empty.hidden = !likedOnly || liked.size > 0;
  };
  const libraryFilters = document.createElement("div");
  libraryFilters.className = "ios-library-filters";
  libraryFilters.innerHTML = `<button type="button" data-ios-library-filter="all" aria-pressed="true">${english ? "All music" : "\u5168\u90E8\u97F3\u4E50"}</button><button type="button" data-ios-library-filter="liked" aria-pressed="false">${english ? "Favourites" : "\u559C\u6B22\u7684\u97F3\u4E50"}</button>`;
  root.querySelector('[data-ios-pane="library"]>.ios-section-title')?.after(libraryFilters);
  const showQueue = (shown) => {
    const sheet = queue.parentElement;
    if (!sheet) return;
    for (const node of sheet.children) if (node instanceof HTMLElement && !node.matches(".ios-player-top,.ios-queue-view")) node.hidden = shown;
    queue.hidden = !shown;
    if (shown) {
      const rows = root.querySelectorAll(".ios-library-list>[data-ios-album]");
      queue.innerHTML = `<header><h2>${english ? "Up next" : "\u63A5\u4E0B\u6765\u64AD\u653E"}</h2><button type="button" data-ios-queue-close>${english ? "Back to player" : "\u8FD4\u56DE\u64AD\u653E\u5668"}</button></header><div class="ios-library-list">${[...rows].map((row, i) => `<button type="button" data-ios-queue-track="${i}" aria-pressed="${i === currentTrack}">${row.innerHTML}</button>`).join("")}</div>`;
    }
    schedule();
  };
  const setPlaying = (next) => {
    playing = next;
    root.dataset.iosPlaying = String(next);
    root.querySelectorAll("[data-ios-play]").forEach((button2) => {
      button2.setAttribute("aria-pressed", String(next));
      const svg = button2.querySelector("svg");
      if (svg) svg.outerHTML = next ? pauseSvg : playSvg;
    });
  };
  const setTrack = (source) => {
    const title = source.dataset.iosTitle ?? "", artist = source.dataset.iosArtist ?? "", kind = source.dataset.iosArt ?? "blue";
    currentTrack = Math.max(0, Number(source.dataset.iosAlbum) || 0);
    root.dataset.iosIndex = String(currentTrack);
    root.querySelectorAll("[data-ios-now-title]").forEach((node) => {
      node.textContent = title;
    });
    root.querySelectorAll("[data-ios-now-artist]").forEach((node) => {
      node.textContent = artist;
    });
    const cover = source.querySelector(".ios-cover");
    for (const target of root.querySelectorAll(".ios-mini-open>.ios-cover,.ios-player-art>.ios-cover")) if (cover) target.outerHTML = cover.outerHTML;
    root.dataset.iosTrack = kind;
    root.querySelector("[data-ios-like]")?.setAttribute("aria-pressed", String(liked.has(currentTrack)));
    const progress = root.querySelector("[data-ios-progress]");
    if (progress) {
      progress.value = "0";
      progress.style.setProperty("--ios-progress", "0%");
    }
    root.querySelector("[data-ios-time]").textContent = "0:00";
    root.querySelector("[data-ios-remaining]").textContent = "\u22124:09";
    setPlaying(true);
  };
  const chooseTab = (name) => {
    activeTab = name;
    root.querySelectorAll("[data-ios-tab]").forEach((button2) => button2.setAttribute("aria-pressed", String(button2.dataset.iosTab === name)));
    root.querySelectorAll("[data-ios-pane]").forEach((pane) => {
      pane.hidden = pane.dataset.iosPane !== name;
    });
    const title = root.querySelector("[data-ios-heading]");
    const selected = tabs.querySelector(`[data-ios-tab="${name}"]`);
    if (title) title.textContent = selected?.textContent?.trim() ?? "";
    if (name === "library") filterLibrary();
    scroll.scrollTop = 0;
    root.dataset.iosMinimized = "false";
    schedule();
  };
  const closeSearch = () => {
    searching = false;
    root.dataset.iosSearching = "false";
    const form2 = root.querySelector("[data-ios-search-form]");
    form2.hidden = true;
    const launch = root.querySelector("[data-ios-search-open]");
    launch.setAttribute("aria-expanded", "false");
    tabs.inert = false;
    launch.inert = false;
    root.querySelectorAll("[data-ios-album]").forEach((album) => {
      album.hidden = false;
    });
    root.querySelector("[data-ios-search-empty]").hidden = true;
    filterLibrary();
    launch.focus({ preventScroll: true });
    schedule();
  };
  const openSearch = () => {
    if (activeTab !== "home") chooseTab("home");
    searching = true;
    root.dataset.iosSearching = "true";
    root.dataset.iosMinimized = "false";
    root.querySelector("[data-ios-search-form]").hidden = false;
    const launch = root.querySelector("[data-ios-search-open]");
    launch.setAttribute("aria-expanded", "true");
    tabs.inert = true;
    launch.inert = true;
    root.querySelector("[data-ios-query]").focus({ preventScroll: true });
    schedule();
  };
  const closePlayer = () => {
    root.dataset.iosPlayerOpen = "false";
    clearTimeout(closeTimer);
    const finish = () => {
      overlay.hidden = true;
      scroll.inert = false;
      controls.inert = false;
      if (focusOrigin?.isConnected) focusOrigin.focus({ preventScroll: true });
      schedule();
    };
    if (matchMedia("(prefers-reduced-motion:reduce)").matches) finish();
    else closeTimer = setTimeout(finish, 300);
  };
  const openPlayer = () => {
    clearTimeout(closeTimer);
    focusOrigin = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    overlay.hidden = false;
    scroll.inert = true;
    controls.inert = true;
    openFrame = requestAnimationFrame(() => {
      if (disposed) return;
      root.dataset.iosPlayerOpen = "true";
      overlay.querySelector("[data-ios-collapse]")?.focus({ preventScroll: true });
      schedule();
    });
  };
  const adapt = () => {
    const content = [...scroll.querySelectorAll("[data-ios-tone]")].filter((node) => !node.closest("[hidden]")).map((card) => ({ tone: card.dataset.iosTone, box: (card.querySelector(".ios-cover") ?? card).getBoundingClientRect() }));
    for (const optic of optics) {
      const box = optic.getBoundingClientRect();
      if (!box.width || !box.height) continue;
      const player = !!optic.closest("[data-ios-player-overlay]");
      optic.style.setProperty("--ios-ink-blend", player ? "100%" : "0%");
      if (reduced.matches || optic.hasAttribute("data-ios-search-form")) continue;
      const width = Math.round(optic.offsetWidth), height = Math.round(optic.offsetHeight), radius = Math.min(parseFloat(getComputedStyle(optic).borderTopLeftRadius) || 28, width / 2, height / 2);
      const size = `${width}:${height}:${Math.round(radius)}`;
      let entry = filters.get(optic);
      if (entry?.size === size) continue;
      if (!entry) {
        const filter = document.createElementNS(svgNS, "filter");
        const id = `${prefix}-${filters.size}`;
        filter.id = id;
        filter.setAttribute("filterUnits", "userSpaceOnUse");
        filter.setAttribute("color-interpolation-filters", "sRGB");
        filter.setAttribute("x", "0");
        filter.setAttribute("y", "0");
        const image = document.createElementNS(svgNS, "feImage");
        image.setAttribute("preserveAspectRatio", "none");
        image.setAttribute("result", "lens");
        const displacement = document.createElementNS(svgNS, "feDisplacementMap");
        displacement.setAttribute("in", "SourceGraphic");
        displacement.setAttribute("in2", "lens");
        displacement.setAttribute("scale", "32");
        displacement.setAttribute("xChannelSelector", "R");
        displacement.setAttribute("yChannelSelector", "G");
        const diffusion = document.createElementNS(svgNS, "feGaussianBlur");
        diffusion.setAttribute("stdDeviation", root.dataset.effect === "subtle" ? "0.25" : "3");
        filter.append(image, displacement, diffusion);
        defs.append(filter);
        entry = { id, size: "", image, filter, displacement };
        filters.set(optic, entry);
      }
      const map = makeLens(width, height, radius);
      const canvas = document.createElement("canvas");
      canvas.width = map.width;
      canvas.height = map.height;
      const context = canvas.getContext("2d");
      if (!context) continue;
      const pixels = context.createImageData(map.width, map.height);
      pixels.data.set(map.data);
      context.putImageData(pixels, 0, 0);
      entry.filter.setAttribute("width", String(width));
      entry.filter.setAttribute("height", String(height));
      entry.image.setAttribute("width", String(width));
      entry.image.setAttribute("height", String(height));
      entry.image.setAttribute("href", canvas.toDataURL());
      entry.displacement.setAttribute("scale", String(map.scale));
      entry.size = size;
      const light = optic.querySelector(".ios-optic-light");
      if (light) {
        pixels.data.set(map.reflection);
        context.putImageData(pixels, 0, 0);
        light.style.backgroundImage = `url(${canvas.toDataURL()})`;
      }
      optic.style.setProperty("--ios-lens-filter", `url(#${entry.id})`);
    }
    for (const glyph of root.querySelectorAll(".ios-tab>svg,.ios-tab>span,.ios-mini-open strong,.ios-mini-open small,.ios-mini-play svg,.ios-search-launch>svg")) {
      const box = glyph.getBoundingClientRect();
      if (!box.width || !box.height) continue;
      let coverage = 0;
      for (const card of content) {
        const b = card.box;
        if (card.tone === "dark") coverage += Math.max(0, Math.min(box.right, b.right) - Math.max(box.left, b.left)) * Math.max(0, Math.min(box.bottom, b.bottom) - Math.max(box.top, b.top));
      }
      const amount = Math.min(1, coverage / (box.width * box.height));
      glyph.style.setProperty("--ios-glyph-blend", `${Math.round(amount * amount * (3 - 2 * amount) * 100)}%`);
    }
    const selected = tabs.querySelector('[aria-pressed="true"]');
    if (selected && !tabDrag) {
      tabs.style.setProperty("--ios-tab-left", `${selected.offsetLeft}px`);
      tabs.style.setProperty("--ios-tab-width", `${selected.offsetWidth}px`);
    }
  };
  function schedule() {
    if (disposed) return;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(adapt);
  }
  const observer = new ResizeObserver(schedule);
  observer.observe(root);
  optics.forEach((node) => observer.observe(node));
  const onScroll = () => {
    const next = scroll.scrollTop;
    if (!searching && Math.abs(next - previousScroll) > 3) {
      root.dataset.iosMinimized = String(next > 70 && next > previousScroll);
    }
    previousScroll = next;
    schedule();
  };
  const onPointer = (event) => {
    if (tabDrag?.pointerId === event.pointerId) {
      tabDrag.x = event.clientX;
      const bounds = tabs.getBoundingClientRect(), selected = tabs.querySelector('[aria-pressed="true"]');
      const scale = tabs.offsetWidth ? bounds.width / tabs.offsetWidth : 1;
      if (selected && scale > 0) {
        const left = Math.max(6, Math.min(tabs.clientWidth - selected.offsetWidth - 6, (event.clientX - bounds.left) / scale - selected.offsetWidth / 2));
        tabs.style.setProperty("--ios-tab-left", `${left}px`);
      }
    }
    if (event.pointerType === "touch") return;
    const optic = event.target instanceof Element ? event.target.closest("[data-ios-optic]") : null;
    if (!optic || !root.contains(optic)) return;
    const b = optic.getBoundingClientRect();
    const x = Math.max(0, Math.min(100, (event.clientX - b.left) / b.width * 100)), y = Math.max(-30, Math.min(100, (event.clientY - b.top) / b.height * 100));
    cancelAnimationFrame(pointerFrame);
    pointerFrame = requestAnimationFrame(() => {
      optic.style.setProperty("--ios-light-x", `${x}%`);
      optic.style.setProperty("--ios-light-y", `${y}%`);
    });
  };
  const onTabDown = (event) => {
    if (event.button !== 0) return;
    const button2 = event.target instanceof Element ? event.target.closest("[data-ios-tab]") : null;
    if (!button2 || !tabs.contains(button2)) return;
    tabDrag = { pointerId: event.pointerId, x: event.clientX };
    root.dataset.iosDragging = "true";
    tabs.setPointerCapture(event.pointerId);
  };
  const onTabEnd = (event) => {
    if (tabDrag?.pointerId !== event.pointerId) return;
    const x = event.clientX;
    tabDrag = null;
    root.dataset.iosDragging = "false";
    if (tabs.hasPointerCapture(event.pointerId)) tabs.releasePointerCapture(event.pointerId);
    if (event.type === "pointerup") {
      const buttons = [...tabs.querySelectorAll("[data-ios-tab]")];
      const button2 = buttons.reduce((best, candidate) => {
        const b = candidate.getBoundingClientRect(), a = best?.getBoundingClientRect();
        return !a || Math.abs(x - b.left - b.width / 2) < Math.abs(x - a.left - a.width / 2) ? candidate : best;
      }, void 0);
      if (button2) {
        chooseTab(button2.dataset.iosTab);
        button2.focus({ preventScroll: true });
      }
    }
    schedule();
  };
  const onClick = (event) => {
    const target = event.target instanceof Element ? event.target.closest("button") : null;
    if (!target || !root.contains(target)) return;
    if (target.dataset.iosTab) chooseTab(target.dataset.iosTab);
    if (target.hasAttribute("data-ios-album")) setTrack(target);
    if (target.hasAttribute("data-ios-play")) setPlaying(!playing);
    if (target.hasAttribute("data-ios-next") || target.hasAttribute("data-ios-prev")) {
      const step = target.hasAttribute("data-ios-next") ? root.querySelector("[data-ios-shuffle]")?.getAttribute("aria-pressed") === "true" ? 1 + Math.floor(Math.random() * Math.max(1, originals.length - 1)) : 1 : -1;
      const source = originals[(currentTrack + step + originals.length) % originals.length];
      if (source) setTrack(source);
    }
    if (target.hasAttribute("data-ios-expand")) openPlayer();
    if (target.hasAttribute("data-ios-collapse")) closePlayer();
    if (target.hasAttribute("data-ios-search-open")) openSearch();
    if (target.hasAttribute("data-ios-search-close")) closeSearch();
    if (target.hasAttribute("data-ios-like") || target.hasAttribute("data-ios-shuffle") || target.hasAttribute("data-ios-repeat")) {
      const selected = target.getAttribute("aria-pressed") !== "true";
      target.setAttribute("aria-pressed", String(selected));
      if (target.hasAttribute("data-ios-like")) {
        if (selected) liked.add(currentTrack);
        else liked.delete(currentTrack);
        root.dataset.iosLiked = [...liked].join(",");
        filterLibrary();
      } else say(selected ? target.hasAttribute("data-ios-shuffle") ? "Shuffle enabled." : "Repeat track enabled." : "Playback mode disabled.", selected ? target.hasAttribute("data-ios-shuffle") ? "\u5DF2\u5F00\u542F\u968F\u673A\u64AD\u653E\uFF0C\u4E0B\u4E00\u9996\u5C06\u4F7F\u7528\u968F\u673A\u987A\u5E8F" : "\u5DF2\u5F00\u542F\u5355\u66F2\u5FAA\u73AF" : "\u5DF2\u5173\u95ED\u6B64\u64AD\u653E\u6A21\u5F0F");
    }
    if (target.hasAttribute("data-ios-info")) showQueue(!!queue.hidden);
    if (target.hasAttribute("data-ios-queue-close")) showQueue(false);
    if (target.hasAttribute("data-ios-queue-track")) {
      const source = originals[Number(target.dataset.iosQueueTrack)];
      if (source) setTrack(source);
      showQueue(false);
    }
    if (target.hasAttribute("data-ios-see-all")) chooseTab("browse");
    if (target.hasAttribute("data-ios-see-recent")) chooseTab("library");
    if (target.hasAttribute("data-ios-library-filter")) {
      likedOnly = target.dataset.iosLibraryFilter === "liked";
      root.dataset.iosLibraryFilter = target.dataset.iosLibraryFilter;
      libraryFilters.querySelectorAll("button").forEach((button2) => button2.setAttribute("aria-pressed", String(button2 === target)));
      filterLibrary();
    }
    schedule();
  };
  const onInput = (event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    if (input.hasAttribute("data-ios-query")) {
      const query = input.value.trim().toLocaleLowerCase();
      let visible = 0;
      root.querySelectorAll(".ios-home-pane [data-ios-album]").forEach((album) => {
        album.hidden = !`${album.dataset.iosTitle} ${album.dataset.iosArtist}`.toLocaleLowerCase().includes(query);
        if (!album.hidden) visible++;
      });
      root.querySelector("[data-ios-search-empty]").hidden = visible > 0;
    }
    if (input.type === "range") input.style.setProperty("--ios-progress", `${Number(input.value) / Number(input.max) * 100}%`);
    if (input.hasAttribute("data-ios-progress")) {
      const value = Number(input.value), remaining = root.querySelector("[data-ios-remaining]"), output = root.querySelector("[data-ios-time]");
      if (output) output.textContent = `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
      if (remaining) {
        const left = 249 - value;
        remaining.textContent = `\u2212${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
      }
    }
  };
  const onKey = (event) => {
    if (event.key === "Escape" && !queue.hidden) {
      event.preventDefault();
      event.stopPropagation();
      showQueue(false);
      return;
    }
    if (event.key === "Escape" && !overlay.hidden) {
      event.preventDefault();
      event.stopPropagation();
      closePlayer();
      return;
    }
    if (event.key === "Escape" && searching) {
      event.preventDefault();
      event.stopPropagation();
      closeSearch();
      return;
    }
    if (event.key === "Tab" && !overlay.hidden) {
      const focusable = [...overlay.querySelectorAll("button,input")].filter((node) => !node.closest("[hidden]") && node.getBoundingClientRect().width > 0 && !(node instanceof HTMLButtonElement && node.disabled));
      const first = focusable[0], last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
    if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key) && event.target instanceof HTMLElement && event.target.hasAttribute("data-ios-tab")) {
      const buttons = [...tabs.querySelectorAll("[data-ios-tab]")], index = buttons.indexOf(event.target);
      const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length;
      event.preventDefault();
      const button2 = buttons[next];
      if (button2) {
        chooseTab(button2.dataset.iosTab);
        button2.focus();
      }
    }
  };
  const onSubmit = (event) => {
    if (event.target instanceof Element && event.target.matches("[data-ios-search-form]")) event.preventDefault();
  };
  libraryFilters.querySelectorAll("button").forEach((button2) => button2.setAttribute("aria-pressed", String(button2.dataset.iosLibraryFilter === (likedOnly ? "liked" : "all"))));
  filterLibrary();
  tabs.inert = searching;
  root.querySelector("[data-ios-search-open]").inert = searching;
  scroll.inert = !overlay.hidden;
  controls.inert = !overlay.hidden;
  const playbackTimer = setInterval(() => {
    if (!playing) return;
    const input = root.querySelector("[data-ios-progress]");
    if (!input) return;
    let next = Number(input.value) + 1;
    if (next >= 249) {
      if (root.querySelector("[data-ios-repeat]")?.getAttribute("aria-pressed") === "true") next = 0;
      else {
        const step = root.querySelector("[data-ios-shuffle]")?.getAttribute("aria-pressed") === "true" ? 1 + Math.floor(Math.random() * Math.max(1, originals.length - 1)) : 1;
        const source = originals[(currentTrack + step) % originals.length];
        if (source) setTrack(source);
        next = 0;
      }
    }
    input.value = String(next);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, 1e3);
  root.addEventListener("click", onClick);
  root.addEventListener("input", onInput);
  root.addEventListener("keydown", onKey);
  root.addEventListener("submit", onSubmit);
  root.addEventListener("pointermove", onPointer);
  root.addEventListener("pointerdown", onTabDown);
  root.addEventListener("pointerup", onTabEnd);
  root.addEventListener("pointercancel", onTabEnd);
  scroll.addEventListener("scroll", onScroll, { passive: true });
  reduced.addEventListener("change", schedule);
  schedule();
  return () => {
    disposed = true;
    clearInterval(playbackTimer);
    showQueue(false);
    queue.remove();
    libraryFilters.remove();
    root.querySelector(".ios-liked-empty")?.remove();
    cancelAnimationFrame(openFrame);
    root.removeEventListener("click", onClick);
    root.removeEventListener("input", onInput);
    root.removeEventListener("keydown", onKey);
    root.removeEventListener("submit", onSubmit);
    root.removeEventListener("pointermove", onPointer);
    root.removeEventListener("pointerdown", onTabDown);
    root.removeEventListener("pointerup", onTabEnd);
    root.removeEventListener("pointercancel", onTabEnd);
    if (tabDrag && tabs.hasPointerCapture(tabDrag.pointerId)) tabs.releasePointerCapture(tabDrag.pointerId);
    scroll.removeEventListener("scroll", onScroll);
    reduced.removeEventListener("change", schedule);
    observer.disconnect();
    cancelAnimationFrame(frame);
    cancelAnimationFrame(pointerFrame);
    clearTimeout(closeTimer);
    clearTimeout(noticeTimer);
    filters.forEach((entry, optic) => {
      entry.filter.remove();
      optic.style.removeProperty("--ios-lens-filter");
      optic.querySelector(".ios-optic-light")?.style.removeProperty("background-image");
    });
    scroll.inert = false;
    controls.inert = false;
  };
})(scene, english, makeLens, (function renderLiquidIcon(name) {
  const paths = {
    home: '<path d="m3.5 10.5 8.5-7 8.5 7M5.5 9v11h4.75v-6h3.5v6h4.75V9"/>',
    browse: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
    radio: '<circle cx="12" cy="12" r="1.8" fill="currentColor" stroke="none"/><path d="M8 7.5a6 6 0 0 0 0 9m8-9a6 6 0 0 1 0 9M5 4.5a10 10 0 0 0 0 15m14-15a10 10 0 0 1 0 15"/>',
    library: '<path d="M5 4v16M10 4v16M14.5 4l4 16"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
    play: '<path d="M8.5 6.2q0-.8.7-.4l9.2 5.5q1.2.7 0 1.4l-9.2 5.5q-.7.4-.7-.4Z" fill="currentColor" stroke="none"/>',
    pause: '<rect x="7" y="5" width="3" height="14" rx=".7" fill="currentColor" stroke="none"/><rect x="14" y="5" width="3" height="14" rx=".7" fill="currentColor" stroke="none"/>',
    next: '<path d="m5.5 5.5 10 6.5-10 6.5Z" fill="currentColor" stroke="none"/><rect x="17.5" y="5.5" width="2" height="13" rx=".7" fill="currentColor" stroke="none"/>',
    close: '<path d="m6 6 12 12M6 18 18 6"/>',
    down: '<path d="m5 9 7 7 7-7"/>',
    more: '<g fill="currentColor" stroke="none"><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></g>',
    heart: '<path d="M20.25 5.75a4.75 4.75 0 0 0-6.72 0L12 7.28l-1.53-1.53a4.75 4.75 0 0 0-6.72 6.72L12 20.72l8.25-8.25a4.75 4.75 0 0 0 0-6.72Z"/>',
    speaker: '<path d="m4 9 4 0 5-5v16l-5-5H4Zm13-1a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
    shuffle: '<path d="M3 6h3l12 12h3m-4-4 4 4-4 4M3 18h3L18 6h3m-4-4 4 4-4 4"/>',
    repeat: '<path d="m17 2 4 4-4 4M3 10V8a2 2 0 0 1 2-2h16M7 22l-4-4 4-4m14 0v2a2 2 0 0 1-2 2H3"/>'
  };
  return `<svg data-ios-icon="${name}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;
})); } else { (function mountSceneJourneys(root, english = false) {
  const copy = (en, zh) => english ? en : zh;
  const remembered = (() => {
    try {
      return JSON.parse(root.dataset.journeyState ?? "{}");
    } catch {
      return {};
    }
  })();
  const escape3 = (value) => value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const button2 = (label, attrs = "", secondary = false) => `<button ${attrs.includes("type=") ? "" : 'type="button"'} class="sc-button${secondary ? " sc-secondary" : ""}" ${attrs}>${label}</button>`;
  const field = (label, name, value = "", area = false) => `<label class="journey-field"><span>${label}</span>${area ? `<textarea name="${name}" required rows="5">${escape3(value)}</textarea>` : `<input name="${name}" required value="${escape3(value)}">`}</label>`;
  const stack = [], hidden = /* @__PURE__ */ new Map(), animations = /* @__PURE__ */ new Set();
  const scroller = root.closest(".sc-preview-scroll") ?? document.scrollingElement;
  const back = () => {
    const item = stack.pop();
    if (!item) return;
    item.page.remove();
    if (stack.length) {
      stack.at(-1).page.hidden = false;
      root.dataset.journey = stack.at(-1).page.dataset.journeyPage;
    } else {
      hidden.forEach((was, node) => {
        node.hidden = was;
      });
      hidden.clear();
      delete root.dataset.journey;
    }
    if (scroller) scroller.scrollTop = item.scroll;
    if (item.origin?.isConnected && !item.origin.closest("[hidden]")) item.origin.focus({ preventScroll: true });
  };
  const open = (title, body, kind = "detail") => {
    const origin = document.activeElement instanceof HTMLElement ? document.activeElement : null, scroll = scroller?.scrollTop ?? 0;
    if (stack.length) stack.at(-1).page.hidden = true;
    else for (const node of root.children) {
      if (node instanceof HTMLElement && !node.matches(".scene-header,.sc-notice")) {
        hidden.set(node, node.hidden);
        node.hidden = true;
      }
    }
    root.dataset.journey = kind;
    const page = document.createElement("section");
    page.className = `scene-journey scene-view-${kind}`;
    page.dataset.journeyPage = kind;
    page.dataset.overlayEscape = "true";
    page.innerHTML = `<div class="journey-breadcrumb">${button2(copy("Back", "\u8FD4\u56DE"), "data-journey-back", true)}<span>${copy("PREVIEW / ", "\u9884\u89C8 / ")}${escape3(title)}</span></div><header class="journey-heading"><h1 tabindex="-1">${escape3(title)}</h1></header>${body}`;
    root.append(page);
    stack.push({ page, origin, scroll });
    if (scroller) scroller.scrollTop = 0;
    page.querySelector("h1")?.focus({ preventScroll: true });
    if (!matchMedia("(prefers-reduced-motion:reduce)").matches) {
      const animation = page.animate?.([{ opacity: 0.2, transform: "translateY(8px)" }, { opacity: 1, transform: "none" }], { duration: 220, easing: "cubic-bezier(.22,.8,.2,1)" });
      if (animation) {
        animations.add(animation);
        void animation.finished.then(() => animations.delete(animation), () => animations.delete(animation));
      }
    }
    return page;
  };
  const current = () => stack.at(-1)?.page;
  const enquiries = new Map(Array.isArray(remembered.enquiries) ? remembered.enquiries : []);
  let lastScan = remembered.lastScan ?? null;
  const products = [{ name: "LOOP", price: 280, desc: copy("A folded aluminium task lamp with a warm, adjustable light.", "\u6298\u53E0\u94DD\u5236\u53F0\u706F\uFF0C\u63D0\u4F9B\u67D4\u548C\u3001\u53EF\u8C03\u7684\u684C\u9762\u7167\u660E\u3002"), spec: copy("Aluminium / 32 cm / warm white", "\u94DD\u6750 / 32 cm / \u6696\u767D\u5149") }, { name: "ARC", price: 168, desc: copy("A sturdy canvas tote, made for books, groceries and everyday detours.", "\u7ED3\u5B9E\u8010\u7528\u7684\u5E06\u5E03\u888B\uFF0C\u88C5\u4E0B\u4E66\u672C\u3001\u91C7\u8D2D\u548C\u65E5\u5E38\u7684\u5C0F\u5C0F\u7ED5\u884C\u3002"), spec: copy("Cotton canvas / 14 L / washable", "\u68C9\u5E06\u5E03 / 14 L / \u53EF\u6C34\u6D17") }, { name: "FORM", price: 360, desc: copy("A hand-finished ceramic vessel. Every piece keeps a trace of its making.", "\u624B\u5DE5\u5B8C\u6210\u7684\u9676\u74F7\u82B1\u5668\uFF0C\u6BCF\u4E00\u4EF6\u90FD\u7559\u6709\u5236\u4F5C\u7684\u75D5\u8FF9\u3002"), spec: copy("Stoneware / 24 cm / handmade", "\u70BB\u5668 / 24 cm / \u624B\u5DE5\u5236\u4F5C") }];
  const cart = new Map(Array.isArray(remembered.cart) ? remembered.cart : []);
  const updateCart = () => {
    const count = [...cart.values()].reduce((a, b) => a + b, 0);
    root.querySelectorAll("[data-sc-cart-count]").forEach((n) => n.textContent = String(count));
  };
  const cartPage = () => {
    const total = [...cart].reduce((sum, [id, n]) => sum + products[id].price * n, 0);
    const rows = [...cart].map(([id, n]) => {
      const p = products[id];
      return `<article class="journey-cart-row"><div><h2>${p.name}</h2><p>${p.spec}</p></div><span>\xA5${p.price}</span><div class="journey-stepper">${button2("\u2212", `data-journey-cart="${id}" data-delta="-1" aria-label="${copy("Decrease quantity", "\u51CF\u5C11\u6570\u91CF")}"`, true)}<output>${n}</output>${button2("+", `data-journey-cart="${id}" data-delta="1" aria-label="${copy("Increase quantity", "\u589E\u52A0\u6570\u91CF")}"`, true)}</div>${button2(copy("Remove", "\u79FB\u9664"), `data-journey-remove="${id}"`, true)}</article>`;
    }).join("");
    return `<div data-cart-body>${rows || `<div class="journey-empty"><h2>${copy("Room for something good.", "\u8FD8\u6CA1\u6709\u6311\u9009\u7269\u4EF6\u3002")}</h2><p>${copy("Explore the collection and add an object you like.", "\u53BB\u7CBE\u9009\u7CFB\u5217\u770B\u770B\uFF0C\u628A\u559C\u6B22\u7684\u7269\u4EF6\u653E\u8FDB\u6765\u3002")}</p>${button2(copy("Continue shopping", "\u7EE7\u7EED\u9009\u8D2D"), "data-journey-back")}</div>`}${cart.size ? `<div class="journey-order-total" role="status"><span>${copy("Total", "\u5408\u8BA1")}</span><strong>\xA5${total}</strong></div>${button2(copy("Review demo order", "\u786E\u8BA4\u6F14\u793A\u8BA2\u5355"), "data-journey-checkout")}<p class="journey-caption">${copy("Local demonstration. No payment or real order is submitted.", "\u672C\u5730\u6F14\u793A\uFF0C\u4E0D\u652F\u4ED8\u3001\u4E0D\u63D0\u4EA4\u771F\u5B9E\u8BA2\u5355\u3002")}</p>` : ""}</div>`;
  };
  const refreshCart = () => {
    const body = current()?.querySelector("[data-cart-body]");
    if (body) body.outerHTML = cartPage();
    updateCart();
  };
  const addProduct = (id) => {
    cart.set(id, (cart.get(id) ?? 0) + 1);
    updateCart();
    const product = root.querySelectorAll(".curated-products>article")[id];
    if (product) {
      let feedback = product.querySelector(".journey-added");
      if (!feedback) {
        feedback = document.createElement("p");
        feedback.className = "journey-added";
        feedback.setAttribute("role", "status");
        product.append(feedback);
      }
      feedback.textContent = copy(`In your bag \xB7 ${cart.get(id)}`, `\u5DF2\u52A0\u5165\u8D2D\u7269\u888B \xB7 ${cart.get(id)} \u4EF6`);
    }
  };
  const articleBodies = [
    [copy("The space between things", "\u7269\u4EF6\u4E4B\u95F4\u7684\u7A7A\u95F4"), copy("A shelf can hold a hundred objects and still feel empty. What changes a room is often the distance between the things we choose to keep.", "\u67B6\u5B50\u4E0A\u53EF\u4EE5\u653E\u4E00\u767E\u4EF6\u7269\u54C1\uFF0C\u5374\u4ECD\u8BA9\u4EBA\u89C9\u5F97\u7A7A\u3002\u6539\u53D8\u4E00\u4E2A\u623F\u95F4\u7684\uFF0C\u5F80\u5F80\u662F\u6211\u4EEC\u51B3\u5B9A\u7559\u4E0B\u7684\u7269\u4EF6\uFF0C\u4EE5\u53CA\u5B83\u4EEC\u4E4B\u95F4\u7684\u8DDD\u79BB\u3002"), copy("Make room for attention", "\u7ED9\u6CE8\u610F\u529B\u7559\u51FA\u4F4D\u7F6E"), copy("Start with a single surface. Move everything away, then return only what has a purpose, a memory, or a shape you enjoy. The space you leave is useful too.", "\u4ECE\u4E00\u4E2A\u5C0F\u53F0\u9762\u5F00\u59CB\u3002\u5148\u79FB\u8D70\u6240\u6709\u4E1C\u897F\uFF0C\u518D\u653E\u56DE\u6709\u7528\u9014\u3001\u6709\u8BB0\u5FC6\uFF0C\u6216\u8BA9\u4F60\u559C\u6B22\u7684\u7269\u4EF6\u3002\u90A3\u4E9B\u7559\u4E0B\u7684\u7A7A\u767D\uFF0C\u540C\u6837\u6709\u7528\u3002")],
    [copy("An ordinary morning", "\u4E00\u4E2A\u666E\u901A\u7684\u6E05\u6668"), copy("Before the screen lights up, there is a brief kind of quiet. Water boils, a window opens, and the room slowly becomes part of the day.", "\u5728\u5C4F\u5E55\u4EAE\u8D77\u4E4B\u524D\uFF0C\u6709\u4E00\u5C0F\u6BB5\u5B89\u9759\u3002\u6C34\u5F00\u59CB\u6CB8\u817E\uFF0C\u7A97\u6237\u88AB\u63A8\u5F00\uFF0C\u623F\u95F4\u6162\u6162\u6210\u4E3A\u8FD9\u4E00\u5929\u7684\u4E00\u90E8\u5206\u3002"), copy("Keep one small ritual", "\u7559\u4F4F\u4E00\u4E2A\u5C0F\u4EEA\u5F0F"), copy("Choose something that asks for your hands: grinding coffee, watering a plant, folding a blanket. Repetition can be a gentle way of arriving in the present.", "\u9009\u4E00\u4EF6\u9700\u8981\u52A8\u624B\u7684\u5C0F\u4E8B\uFF1A\u78E8\u5496\u5561\u3001\u6D47\u82B1\u3001\u53E0\u597D\u6BEF\u5B50\u3002\u91CD\u590D\uFF0C\u6709\u65F6\u662F\u6E29\u67D4\u5730\u56DE\u5230\u5F53\u4E0B\u7684\u65B9\u6CD5\u3002")],
    [copy("Keep what matters", "\u7559\u4E0B\u771F\u6B63\u91CD\u8981\u7684"), copy("The most useful object is rarely the newest one. It is the bowl that fits your hands, the lamp you repair, the bag that travels with you.", "\u6700\u6709\u7528\u7684\u7269\u4EF6\uFF0C\u5F88\u5C11\u662F\u6700\u65B0\u7684\u90A3\u4E00\u4EF6\u3002\u5B83\u662F\u5408\u624B\u7684\u7897\u3001\u4FEE\u8FC7\u7684\u706F\uFF0C\u8FD8\u6709\u966A\u4F60\u8D70\u8FC7\u5F88\u591A\u5730\u65B9\u7684\u5305\u3002"), copy("Care as a design choice", "\u628A\u7167\u987E\uFF0C\u4E5F\u5F53\u4F5C\u8BBE\u8BA1"), copy("Before replacing an object, learn how it is made. Tighten a joint, mend a seam, or ask its maker for a spare part. A longer life gives an object a deeper meaning.", "\u5728\u66FF\u6362\u4E4B\u524D\uFF0C\u5148\u4E86\u89E3\u5B83\u662F\u600E\u4E48\u505A\u51FA\u6765\u7684\u3002\u62E7\u7D27\u8FDE\u63A5\u3001\u7F1D\u597D\u5F00\u7EBF\uFF0C\u6216\u5411\u5236\u4F5C\u8005\u8BE2\u95EE\u96F6\u4EF6\u3002\u66F4\u957F\u7684\u4F7F\u7528\u65F6\u95F4\uFF0C\u8BA9\u7269\u4EF6\u6709\u4E86\u66F4\u6DF1\u7684\u610F\u4E49\u3002")]
  ];
  const readArticle = (trigger) => {
    const owner = trigger.closest("article,.edition-feature"), siblings = [...root.querySelectorAll(".scene-story")], index = Math.max(0, siblings.indexOf(owner));
    const base = owner.classList.contains("edition-feature") ? [copy("The places we become", "\u6211\u4EEC\u6816\u5C45\u7684\uFF0C\u4E5F\u662F\u6211\u4EEC"), copy("A doorway frames the afternoon. As light moves across a wall, a familiar room becomes new again. We visit a home that has been made slowly, one decision at a time.", "\u4E00\u9053\u95E8\u6846\u4F4F\u5348\u540E\u3002\u5149\u6CBF\u7740\u5899\u79FB\u52A8\uFF0C\u719F\u6089\u7684\u623F\u95F4\u53C8\u6709\u4E86\u65B0\u9762\u8C8C\u3002\u6211\u4EEC\u8D70\u8FDB\u4E00\u4E2A\u6162\u6162\u5EFA\u7ACB\u8D77\u6765\u7684\u5BB6\uFF0C\u6BCF\u4E2A\u51B3\u5B9A\u90FD\u7559\u4E0B\u4E86\u75D5\u8FF9\u3002"), copy("A conversation with light", "\u4E0E\u5149\u76F8\u5904"), copy("The people who live here resisted the urge to finish everything at once. They learned where the morning sun lands, which chair a guest chooses, and how a shared table changes an evening.", "\u4F4F\u5728\u8FD9\u91CC\u7684\u4EBA\uFF0C\u6CA1\u6709\u6025\u7740\u4E00\u6B21\u5B8C\u6210\u6240\u6709\u5E03\u7F6E\u3002\u4ED6\u4EEC\u5148\u4E86\u89E3\u6668\u5149\u843D\u5728\u54EA\u91CC\uFF0C\u5BA2\u4EBA\u66F4\u559C\u6B22\u54EA\u5F20\u6905\u5B50\uFF0C\u4E00\u5F20\u5171\u4EAB\u7684\u684C\u5B50\u5982\u4F55\u6539\u53D8\u591C\u665A\u3002")] : articleBodies[(root.dataset.style === "editorial" && index === 1 ? 2 : index) % 3], title = owner.querySelector("h2,h3")?.textContent?.trim() ?? base[0];
    const art = owner.querySelector(".edition-architecture")?.outerHTML ?? "";
    open(title, `<article class="journey-reader">${art}<p class="journey-lead">${base[1]}</p><p>${copy("This journal follows the way ordinary spaces and objects shape the days we live. Each detail is an invitation to notice, rather than collect.", "\u8FD9\u672C\u65E5\u5FD7\u5173\u6CE8\u666E\u901A\u7A7A\u95F4\u548C\u7269\u4EF6\uFF0C\u5982\u4F55\u5851\u9020\u6211\u4EEC\u5EA6\u8FC7\u7684\u6BCF\u4E00\u5929\u3002\u6BCF\u4E00\u4E2A\u7EC6\u8282\uFF0C\u90FD\u9080\u8BF7\u6211\u4EEC\u591A\u770B\u4E00\u773C\uFF0C\u800C\u4E0D\u662F\u591A\u62E5\u6709\u4E00\u4EF6\u3002")}</p><h2>${base[2]}</h2><p>${base[3]}</p><blockquote>${copy("A little less, with a little more attention.", "\u5C11\u4E00\u70B9\uFF0C\u8BA4\u771F\u4E00\u70B9\u3002")}</blockquote><p>${copy("Try it today. Choose one corner, spend ten quiet minutes with it, and leave something better than you found it.", "\u4ECA\u5929\u5C31\u53EF\u4EE5\u8BD5\u8BD5\u3002\u9009\u4E00\u4E2A\u89D2\u843D\uFF0C\u5B89\u9759\u5730\u5F85\u4E0A\u5341\u5206\u949F\uFF0C\u8BA9\u5B83\u6BD4\u539F\u6765\u66F4\u597D\u4E00\u70B9\u3002")}</p><div class="journey-reader-end"><span>${copy("You reached the end.", "\u5DF2\u8BFB\u5230\u6587\u672B\u3002")}</span>${button2(copy("Back to the issue", "\u8FD4\u56DE\u672C\u671F\u76EE\u5F55"), "data-journey-back", true)}</div></article>`, "reader");
  };
  const projects = () => [...root.querySelectorAll("[data-sc-work-item]")];
  const projectDrafts = new Map(Array.isArray(remembered.projectDrafts) ? remembered.projectDrafts : []);
  const projectPage = (row) => {
    const index = projects().indexOf(row), draft = projectDrafts.get(index), taskSets = english ? [["Confirm the identity direction", "Set typography and colour rules", "Deliver the brand asset pack"], ["Review navigation and content", "Build the responsive home page", "Run accessibility checks"], ["Prepare the release announcement", "Collect channel assets", "Rehearse the release flow"], ["Unify semantic colour tokens", "Review component states", "Publish the change log"]] : [["\u786E\u8BA4\u54C1\u724C\u6807\u8BC6\u65B9\u5411", "\u786E\u5B9A\u5B57\u4F53\u4E0E\u8272\u5F69\u89C4\u8303", "\u4EA4\u4ED8\u54C1\u724C\u8D44\u4EA7\u5305"], ["\u8BC4\u5BA1\u5BFC\u822A\u548C\u5185\u5BB9\u7ED3\u6784", "\u5B8C\u6210\u54CD\u5E94\u5F0F\u9996\u9875", "\u6267\u884C\u53EF\u8BBF\u95EE\u6027\u68C0\u67E5"], ["\u51C6\u5907\u53D1\u5E03\u516C\u544A", "\u6574\u7406\u6E20\u9053\u7D20\u6750", "\u6F14\u7EC3\u53D1\u5E03\u6D41\u7A0B"], ["\u7EDF\u4E00\u8BED\u4E49\u8272\u53D8\u91CF", "\u68C0\u67E5\u7EC4\u4EF6\u72B6\u6001", "\u6574\u7406\u7248\u672C\u53D8\u66F4\u8BB0\u5F55"]];
    const projectTasks = taskSets[index] ?? (english ? ["Define project scope", "Build the first prototype", "Review the handoff"] : ["\u660E\u786E\u9879\u76EE\u8303\u56F4", "\u5B8C\u6210\u9996\u8F6E\u539F\u578B", "\u8BC4\u5BA1\u4EA4\u4ED8\u5185\u5BB9"]);
    const title = row.querySelector("strong")?.textContent ?? "", owner = row.querySelector(".business-owner")?.textContent ?? "Jun";
    const page = open(title, `<div class="journey-project-meta"><span>${copy("Owner", "\u8D1F\u8D23\u4EBA")}<strong>${escape3(owner)}</strong></span><span>${copy("Stage", "\u9636\u6BB5")}<strong>${copy("Design review", "\u8BBE\u8BA1\u8BC4\u5BA1")}</strong></span><span>${copy("Delivery", "\u4EA4\u4ED8")}<strong>${escape3(row.querySelector("span:last-child")?.textContent ?? "28 OCT")}</strong></span></div><div class="journey-project-columns"><section><h2>${copy("Delivery checklist", "\u4EA4\u4ED8\u6E05\u5355")}</h2>${projectTasks.map((name, i) => `<label class="journey-task"><input type="checkbox" data-journey-project-check="${i}" ${draft?.checks[i] ?? i === 0 ? "checked" : ""}><span>${name}</span></label>`).join("")}</section><section><h2>${copy("Project notes", "\u9879\u76EE\u8BB0\u5F55")}</h2><p>${row.dataset.projectBrief ? escape3(row.dataset.projectBrief) : copy(["Review the visual identity before delivering the final brand assets.", "Make the core website journey clear across desktop and mobile.", "Bring the release plan, channels and assets into one delivery.", "Keep components, semantic tokens and release notes consistent."][index] ?? "Define a clear first delivery.", ["\u4EA4\u4ED8\u54C1\u724C\u8D44\u4EA7\u524D\uFF0C\u5148\u786E\u8BA4\u6574\u5957\u89C6\u89C9\u8BC6\u522B\u65B9\u5411\u3002", "\u8BA9\u5B98\u7F51\u6838\u5FC3\u8DEF\u5F84\u5728\u684C\u9762\u548C\u79FB\u52A8\u7AEF\u90FD\u6E05\u6670\u53EF\u7528\u3002", "\u5C06\u53D1\u5E03\u8BA1\u5212\u3001\u6E20\u9053\u548C\u7D20\u6750\u6C47\u5408\u5230\u4E00\u6B21\u4EA4\u4ED8\u4E2D\u3002", "\u4FDD\u6301\u7EC4\u4EF6\u3001\u8BED\u4E49\u53D8\u91CF\u548C\u7248\u672C\u8BF4\u660E\u7684\u4E00\u81F4\u6027\u3002"][index] ?? "\u5148\u660E\u786E\u7B2C\u4E00\u6B21\u4EA4\u4ED8\u7684\u76EE\u6807\u3002")}</p><label class="journey-field"><span>${copy("Add a working note", "\u8865\u5145\u9879\u76EE\u8BB0\u5F55")}</span><textarea rows="4" data-journey-project-note placeholder="${copy("Write a decision or next step\u2026", "\u5199\u4E0B\u51B3\u5B9A\u6216\u4E0B\u4E00\u6B65\u2026\u2026")}">${escape3(draft?.note ?? "")}</textarea></label></section></div>`, "project");
    page.dataset.projectIndex = String(index);
  };
  const threads = new Map(Array.isArray(remembered.threads) ? remembered.threads : []);
  let activeThread = 0;
  const threadPage = (id) => {
    activeThread = id;
    const post = root.querySelectorAll(".material-post")[id];
    if (!post) return;
    const title = post.querySelector("h2")?.textContent ?? "", author = post.querySelector("header strong")?.textContent ?? "";
    const replies = threads.get(id) ?? [{ name: "Maya", text: copy(["For me, it was a small interaction that remembered what I was doing.", "I return to personal websites that change slowly and keep their own point of view.", "I made a small prototype this week. Getting one complete flow working was the best part."][id % 3], ["\u5BF9\u6211\u6765\u8BF4\uFF0C\u662F\u4E00\u4E2A\u80FD\u8BB0\u4F4F\u64CD\u4F5C\u72B6\u6001\u7684\u5C0F\u4EA4\u4E92\u3002", "\u6211\u4F1A\u53CD\u590D\u56DE\u8BBF\u90A3\u4E9B\u6162\u6162\u66F4\u65B0\u3001\u6709\u81EA\u5DF1\u89C6\u89D2\u7684\u4E2A\u4EBA\u7F51\u7AD9\u3002", "\u8FD9\u5468\u505A\u4E86\u4E2A\u5C0F\u539F\u578B\uFF0C\u628A\u4E00\u6761\u5B8C\u6574\u6D41\u7A0B\u8D70\u901A\uFF0C\u662F\u6700\u6709\u6536\u83B7\u7684\u90E8\u5206\u3002"][id % 3]) }, { name: "Jun", text: copy(["The details work best when they make the next action feel obvious.", "I keep a short reading list and revisit a few favourites each month.", "Work in progress is worth sharing too. I would love to see the process."][id % 3], ["\u7EC6\u8282\u6700\u597D\u7684\u72B6\u6001\uFF0C\u662F\u8BA9\u4E0B\u4E00\u6B65\u53D8\u5F97\u81EA\u7136\u3002", "\u6211\u4F1A\u6574\u7406\u4E00\u4EFD\u77ED\u77ED\u7684\u9605\u8BFB\u6E05\u5355\uFF0C\u6BCF\u4E2A\u6708\u56DE\u8BBF\u51E0\u4E2A\u559C\u6B22\u7684\u89D2\u843D\u3002", "\u6CA1\u6709\u5B8C\u6210\u7684\u8FC7\u7A0B\u4E5F\u503C\u5F97\u5206\u4EAB\uFF0C\u5F88\u671F\u5F85\u770B\u770B\u4F60\u600E\u4E48\u505A\u7684\u3002"][id % 3]) }];
    threads.set(id, replies);
    open(title, `<article class="journey-thread"><span class="scene-pill">${escape3(author)}</span><p class="journey-lead">${escape3(post.querySelector(":scope>p")?.textContent ?? "")}</p><section data-journey-replies>${replies.map((reply) => `<article class="journey-reply"><strong>${escape3(reply.name)}</strong><p>${escape3(reply.text)}</p></article>`).join("")}</section><form data-journey-form="reply">${field(copy("Join the discussion", "\u53C2\u4E0E\u8BA8\u8BBA"), "reply", "", true)}${button2(copy("Post reply", "\u53D1\u5E03\u56DE\u590D"), 'type="submit"')}</form></article>`, "thread");
  };
  const tracks = [["First Light", "HELIOS", "04:32"], ["Slow Motion", "NOVA", "06:18"], ["Open Window", "HAMMOCK", "05:16"]];
  let track = Number(root.dataset.audioTrack) || 0, elapsed = Number(root.dataset.audioElapsed) || 0, transportTimer;
  const time = (seconds) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  const setTrack = (index) => {
    track = (index + tracks.length) % tracks.length;
    elapsed = 0;
    const row = tracks[track];
    root.querySelectorAll("[data-sc-now]").forEach((node) => node.textContent = row[0]);
    const artist = root.querySelector(".neu-track strong+small");
    if (artist) artist.textContent = row[1];
    const length = root.querySelector(".neu-track>span");
    if (length) length.textContent = row[2];
    root.dataset.audioTrack = String(track);
    root.dataset.audioElapsed = "0";
    root.querySelectorAll("[data-sc-track]").forEach((node, i) => node.setAttribute("aria-pressed", String(i === track)));
    const output = root.querySelector("[data-journey-audio-time]"), studio = root.querySelector(".studio-time"), progress = root.querySelector("[data-journey-audio-progress]");
    if (output) output.textContent = `0:00 / ${row[2]}`;
    if (studio) studio.textContent = `0:00 / ${row[2]}`;
    if (progress) {
      progress.value = "0";
      progress.max = String(Number(row[2].split(":")[0]) * 60 + Number(row[2].split(":")[1]));
    }
  };
  const audioClock = () => {
    if (root.dataset.playing !== "true") return;
    elapsed++;
    root.dataset.audioElapsed = String(elapsed);
    const row = tracks[track], limit = Number(row[2].split(":")[0]) * 60 + Number(row[2].split(":")[1]);
    if (elapsed >= limit) setTrack(track + 1);
    const output = root.querySelector("[data-journey-audio-time]");
    if (output) output.textContent = `${time(elapsed)} / ${tracks[track][2]}`;
    const progress = root.querySelector("[data-journey-audio-progress]");
    if (progress) progress.value = String(elapsed);
    const studio = root.querySelector(".studio-time");
    if (studio) studio.textContent = `${time(elapsed)} / ${tracks[track][2]}`;
  };
  if (["neumorphism", "dark"].includes(root.dataset.style ?? "")) {
    const box = document.createElement("div");
    box.className = "journey-audio-status";
    box.innerHTML = `<div><span data-journey-audio-time>0:00 / 04:32</span>${button2(copy("Queue", "\u64AD\u653E\u5217\u8868"), "data-journey-queue", true)}</div><input type="range" min="0" max="272" value="0" aria-label="${copy("Demo playback progress", "\u6F14\u793A\u64AD\u653E\u8FDB\u5EA6")}" data-journey-audio-progress><small>${copy("Interactive transport simulation \xB7 no audio", "\u64AD\u653E\u4EA4\u4E92\u6A21\u62DF \xB7 \u65E0\u771F\u5B9E\u97F3\u9891")}</small>`;
    root.querySelector(".neu-transport,.studio-transport")?.after(box);
    const studio = root.querySelector(".studio-time"), initial = box.querySelector("[data-journey-audio-time]"), progress = box.querySelector("input");
    if (studio) studio.textContent = `${time(elapsed)} / ${tracks[track][2]}`;
    if (initial) initial.textContent = `${time(elapsed)} / ${tracks[track][2]}`;
    if (progress) {
      progress.value = String(elapsed);
      progress.max = String(Number(tracks[track][2].split(":")[0]) * 60 + Number(tracks[track][2].split(":")[1]));
    }
    transportTimer = setInterval(audioClock, 1e3);
  }
  const queuePage = () => open(copy("Your listening queue", "\u64AD\u653E\u5217\u8868"), `<div class="journey-queue">${tracks.map(([title, artist, length], i) => button2(`<span>0${i + 1}</span><div><strong>${title}</strong><small>${artist}</small></div><span>${length}</span>`, `data-journey-track="${i}" aria-pressed="${track === i}"`, true)).join("")}</div>`, "queue");
  const lessonPage = () => {
    paint = "#f06062";
    shapeCount = 0;
    lessonVisits.clear();
    paletteColors.clear();
    const index = Number(root.querySelector(".learning-feature")?.dataset.lesson ?? 2);
    activeLesson = index;
    const title = root.querySelector(".learning-feature h2")?.textContent ?? "";
    const page = open(title, `<div class="journey-lesson"><section><span class="scene-eyebrow">${copy("YOUR STUDIO", "\u4F60\u7684\u521B\u4F5C\u53F0")}</span><div class="journey-canvas" data-journey-canvas><span>${copy("Add a shape to begin.", "\u6DFB\u52A0\u4E00\u4E2A\u5F62\u72B6\uFF0C\u5F00\u59CB\u521B\u4F5C\u3002")}</span></div><div class="journey-shape-tools">${[copy("Circle", "\u5706\u5F62"), copy("Square", "\u65B9\u5F62"), copy("Triangle", "\u4E09\u89D2\u5F62")].map((shape, i) => button2(shape, `data-journey-shape="${i}"`, true)).join("")}${button2(copy("Clear", "\u6E05\u7A7A"), "data-journey-clear", true)}</div><div class="journey-paints">${["#f06062", "#edca40", "#5082d6", "#664dbb"].map((color) => `<button type="button" data-journey-paint="${color}" style="background:${color}" aria-label="${copy("Choose colour", "\u9009\u62E9\u989C\u8272")} ${color}" aria-pressed="${color === "#f06062"}"></button>`).join("")}</div></section><aside><h2>${copy("The brief", "\u8FD9\u6B21\u7684\u6311\u6218")}</h2><p>${escape3(root.querySelector(".learning-feature .sc-post-detail")?.textContent ?? "")}</p><ol><li>${copy("Choose your shapes.", "\u9009\u62E9\u60F3\u4F7F\u7528\u7684\u5F62\u72B6\u3002")}</li><li>${copy("Try a colour and composition.", "\u5C1D\u8BD5\u914D\u8272\u4E0E\u6784\u56FE\u3002")}</li><li>${copy("Keep a version you like.", "\u7559\u4E0B\u4E00\u4E2A\u559C\u6B22\u7684\u7248\u672C\u3002")}</li></ol>${button2(copy("Complete exercise", "\u5B8C\u6210\u7EC3\u4E60"), `data-journey-complete-lesson="${index}"`)}<p role="status" data-journey-lesson-status></p></aside></div>`, "lesson");
    const studio = page.querySelector(".journey-lesson>section");
    if (index === 0) studio.innerHTML = `<div class="journey-observation" data-observation-view="front"><div class="journey-cup"><i></i><b></b></div><span data-observation-caption>${copy("FRONT VIEW", "\u6B63\u89C6\u56FE")}</span></div><div class="journey-shape-tools">${[copy("Front", "\u6B63\u9762"), copy("From above", "\u4FEF\u89C6"), copy("Side", "\u4FA7\u9762")].map((name, i) => button2(name, `data-journey-viewpoint="${i}" aria-pressed="${i === 0}"`, true)).join("")}</div><p>${copy("Visit all three viewpoints and notice what changes.", "\u5207\u6362\u4E09\u4E2A\u89C6\u89D2\uFF0C\u89C2\u5BDF\u676F\u53E3\u3001\u676F\u8EAB\u4E0E\u628A\u624B\u5982\u4F55\u53D8\u5316\u3002")}</p>`;
    if (index === 0) lessonVisits.add(0);
    if (index === 1) studio.innerHTML = `<div class="journey-palette-board"><i data-palette-slot="0"></i><i data-palette-slot="1"></i><i data-palette-slot="2"></i><span>${copy("A palette, in your own words.", "\u642D\u914D\u5C5E\u4E8E\u81EA\u5DF1\u7684\u8272\u5F69\u3002")}</span></div><div class="journey-paints">${["#f06062", "#edca40", "#5082d6", "#664dbb", "#6b9f79", "#f2bfa1"].map((color) => `<button type="button" data-journey-paint="${color}" style="background:${color}" aria-label="${copy("Choose colour", "\u9009\u62E9\u989C\u8272")} ${color}" aria-pressed="false"></button>`).join("")}</div><p data-palette-status>${copy("Choose three colours to build your palette.", "\u9009\u62E9\u4E09\u79CD\u989C\u8272\uFF0C\u7EC4\u6210\u4E00\u5957\u914D\u8272\u3002")}</p>`;
    if (index === 3) {
      const label = document.createElement("label");
      label.className = "journey-field";
      label.innerHTML = `<span>${copy("Your poster title", "\u6D77\u62A5\u6807\u9898")}</span><input data-journey-poster-title value="MAKE / PLAY">`;
      studio.prepend(label);
      const title2 = document.createElement("strong");
      title2.dataset.posterWordmark = "true";
      title2.textContent = "MAKE / PLAY";
      page.querySelector("[data-journey-canvas]")?.prepend(title2);
      const layouts = document.createElement("div");
      layouts.className = "journey-shape-tools";
      layouts.innerHTML = [copy("Diagonal", "\u5BF9\u89D2\u6784\u56FE"), copy("Centred", "\u5C45\u4E2D\u6784\u56FE"), copy("Stacked", "\u5C42\u53E0\u6784\u56FE")].map((name, i) => button2(name, `data-journey-layout="${i}" aria-pressed="${i === 0}"`, true)).join("");
      studio.append(layouts);
    }
  };
  let paint = "#f06062", shapeCount = 0, activeLesson = 2;
  const lessonVisits = /* @__PURE__ */ new Set(), paletteColors = /* @__PURE__ */ new Set();
  const festival = ["IN GOOD SHAPE", "OUT OF OFFICE", "AFTER THE GRID"];
  let ticketEvent = "0";
  const ticketForm = (id) => {
    ticketEvent = id;
    open(copy("Reserve your place", "\u9884\u7559\u4F60\u7684\u5E2D\u4F4D"), `<form data-journey-form="ticket"><div class="journey-ticket-choice"><span>OFF / GRID \u2014 2026</span><h2>${festival[Number(id)]}</h2><p>${["24 OCT \xB7 14:00 \xB7 STUDIO A", "25 OCT \xB7 16:30 \xB7 STUDIO B", "26 OCT \xB7 19:00 \xB7 MAIN STAGE"][Number(id)]}</p></div><div class="journey-event-options" role="group" aria-label="${copy("Choose an event", "\u9009\u62E9\u573A\u6B21")}">${festival.map((title, i) => button2(title, `data-journey-ticket-choice="${i}" aria-pressed="${Number(id) === i}"`, true)).join("")}</div>${field(copy("Name on your demo ticket", "\u6F14\u793A\u7968\u5238\u59D3\u540D"), "name")}<label class="journey-field"><span>${copy("Seats", "\u5E2D\u4F4D\u6570\u91CF")}</span><input type="hidden" name="seats" value="1"><div class="journey-seat-options" role="group" aria-label="${copy("Seats", "\u5E2D\u4F4D\u6570\u91CF")}">${[1, 2, 3].map((n) => button2(String(n), `data-journey-seats="${n}" aria-pressed="${n === 1}"`, true)).join("")}</div></label>${button2(copy("Create demo ticket", "\u751F\u6210\u6F14\u793A\u7968\u5238"), 'type="submit"')}<p class="journey-caption">${copy("Local preview only. No payment or real reservation.", "\u4EC5\u672C\u5730\u9884\u89C8\uFF0C\u4E0D\u4ED8\u8D39\uFF0C\u4E0D\u5360\u7528\u771F\u5B9E\u5E2D\u4F4D\u3002")}</p></form>`, "ticket");
  };
  const paperDays = new Map(Array.isArray(remembered.paperDays) ? remembered.paperDays : []);
  let paperDay = typeof remembered.paperDay === "number" ? remembered.paperDay : 26;
  const paperInputs = () => [...root.querySelectorAll(".paper-page>.scene-checklist input")];
  const paperStatus = (message) => {
    const output = root.querySelector("[data-paper-status]");
    if (output) output.textContent = message ?? copy(`${paperInputs().filter((input2) => input2.checked).length} / ${paperInputs().length} complete`, `${paperInputs().filter((input2) => input2.checked).length} / ${paperInputs().length} \u9879\u5DF2\u5B8C\u6210`);
  };
  const appendTask = (text, checked = false) => {
    const list = root.querySelector(".paper-page>.scene-checklist,.dayboard-tasks .scene-checklist");
    if (!list) return;
    const label = document.createElement("label"), input2 = document.createElement("input"), span = document.createElement("span");
    input2.type = "checkbox";
    input2.checked = checked;
    span.textContent = text;
    label.append(input2, span);
    label.insertAdjacentHTML("beforeend", '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>');
    list.append(label);
    paperStatus();
  };
  const paintPaperHardware = () => {
    const reminder = root.dataset.paperReminder === "true", bookmarked = root.dataset.paperBookmark === "true", ink = root.dataset.paperInk ?? "#343a48";
    const toggle = root.querySelector("[data-paper-reminder]");
    toggle?.setAttribute("aria-pressed", String(reminder));
    const label = root.querySelector("[data-paper-reminder-label]");
    if (label) label.textContent = copy(reminder ? "ON \xB7 18:00" : "OFF", reminder ? "18:00 \u63D0\u9192" : "\u5173\u95ED");
    const bookmark = root.querySelector("[data-paper-bookmark]");
    bookmark?.setAttribute("aria-pressed", String(bookmarked));
    const bookmarkLabel = bookmark?.querySelector("span");
    if (bookmarkLabel) bookmarkLabel.textContent = copy(bookmarked ? "KEPT" : "KEEP", bookmarked ? "\u5DF2\u5B58" : "\u7559\u5B58");
    root.querySelectorAll("[data-paper-ink]").forEach((node) => node.setAttribute("aria-pressed", String(node.getAttribute("data-paper-ink") === ink)));
    root.querySelector(".paper-page")?.style.setProperty("--paper-ink", ink);
  };
  const loadPaperHardware = (data) => {
    root.dataset.paperReminder = String(data?.reminder ?? false);
    root.dataset.paperBookmark = String(data?.bookmarked ?? false);
    root.dataset.paperInk = data?.ink ?? "#343a48";
    paintPaperHardware();
  };
  const paperSaveDay = () => {
    paperDays.set(paperDay, { note: root.querySelector(".paper-writing textarea")?.value ?? "", tasks: paperInputs().map((input2) => ({ text: input2.closest("label")?.querySelector("span")?.textContent ?? "", done: input2.checked })), reminder: root.dataset.paperReminder === "true", bookmarked: root.dataset.paperBookmark === "true", ink: root.dataset.paperInk ?? "#343a48" });
  };
  const changePaperDate = (delta) => {
    paperSaveDay();
    paperDay += delta;
    const date = new Date(Date.UTC(2026, 9, paperDay)), data = paperDays.get(paperDay) ?? { note: "", tasks: [copy("Make something with your hands", "\u52A8\u624B\u505A\u4E00\u4EF6\u5C0F\u4E1C\u897F"), copy("Find a moment outside", "\u51FA\u95E8\u8D70\u8D70"), copy("Write a note to someone", "\u7ED9\u67D0\u4E2A\u4EBA\u5199\u4E00\u5F20\u4FBF\u7B7E")].map((text) => ({ text, done: false })) };
    const number = root.querySelector(".paper-margin>strong"), weekday = root.querySelector(".paper-margin>span"), month = root.querySelector(".paper-date");
    if (number) number.textContent = String(date.getUTCDate());
    const pageNumber = root.querySelector(".paper-page-number");
    if (pageNumber) pageNumber.textContent = `\u2014 ${String(date.getUTCDate()).padStart(3, "0")} \u2014`;
    root.querySelector(".paper-save-stamp")?.classList.remove("is-stamped");
    if (weekday) weekday.textContent = date.toLocaleDateString(english ? "en-US" : "zh-CN", { weekday: "long", timeZone: "UTC" }).toUpperCase();
    if (month) month.textContent = date.toLocaleDateString(english ? "en-US" : "zh-CN", { month: "long", year: "numeric", timeZone: "UTC" }).toUpperCase();
    const note = root.querySelector(".paper-writing textarea");
    if (note) note.value = data.note;
    root.querySelector(".paper-page>.scene-checklist")?.replaceChildren();
    data.tasks.forEach((item) => appendTask(item.text, item.done));
    loadPaperHardware(data);
    paperStatus(copy("Opened a different day. Notes and desk settings stay with their date.", "\u5DF2\u5207\u6362\u65E5\u671F\uFF0C\u968F\u8BB0\u3001\u4EFB\u52A1\u4E0E\u684C\u9762\u8BBE\u7F6E\u6309\u65E5\u671F\u4FDD\u7559\u3002"));
    const page = root.querySelector(".paper-page");
    if (page && !matchMedia("(prefers-reduced-motion:reduce)").matches) {
      const animation = page.animate?.([{ opacity: 0.25, transform: `perspective(900px) rotateY(${delta > 0 ? -9 : 9}deg)` }, { opacity: 1, transform: "perspective(900px) rotateY(0deg)" }], { duration: 340, easing: "cubic-bezier(.22,.8,.2,1)" });
      if (animation) {
        animations.add(animation);
        void animation.finished.then(() => animations.delete(animation), () => animations.delete(animation));
      }
    }
  };
  if (root.dataset.style === "skeuomorphism") {
    const dates = document.createElement("div");
    dates.className = "paper-date-controls";
    dates.innerHTML = `${button2(copy("Previous day", "\u524D\u4E00\u5929"), 'data-paper-date="-1" aria-label="' + copy("Previous day", "\u524D\u4E00\u5929") + '"', true)}${button2(copy("Next day", "\u540E\u4E00\u5929"), 'data-paper-date="1" aria-label="' + copy("Next day", "\u540E\u4E00\u5929") + '"', true)}`;
    root.querySelector(".paper-margin")?.prepend(dates);
    const tools = document.createElement("div");
    tools.className = "paper-action-tools";
    tools.innerHTML = `${button2(copy("New task", "\u65B0\u4EFB\u52A1"), "data-paper-new-task")}${button2(copy("Write a note", "\u5199\u4FBF\u7B7E"), "data-paper-note", true)}${button2(copy("Completed", "\u5B8C\u6210\u5939"), "data-paper-completed", true)}`;
    root.querySelector(".paper-page>h1")?.after(tools);
    const note = root.querySelector(".paper-writing");
    if (note) {
      const save = document.createElement("button");
      save.type = "button";
      save.dataset.paperSave = "true";
      save.className = "paper-save-stamp";
      save.textContent = copy("Keep this note", "\u4FDD\u5B58\u968F\u8BB0");
      note.after(save);
    }
    const ideas = root.querySelector("[data-sc-paper-ideas]");
    if (ideas) {
      const add = document.createElement("button");
      add.type = "button";
      add.dataset.paperNewIdea = "true";
      add.className = "paper-idea-add";
      add.textContent = copy("Add an idea card", "\u65B0\u589E\u7075\u611F\u5361");
      ideas.append(add);
    }
    const status = document.createElement("p");
    status.dataset.paperStatus = "true";
    status.className = "paper-save-status";
    status.setAttribute("role", "status");
    root.querySelector(".paper-page")?.append(status);
    loadPaperHardware(paperDays.get(paperDay));
    paperStatus();
  }
  if (root.dataset.style === "soft") {
    const meter = document.createElement("div");
    meter.className = "soft-session-meter";
    meter.innerHTML = "<output data-breath-clock>2:00</output><span>" + copy("4s in / 4s out", "\u5438\u6C14 4 \u79D2 / \u547C\u6C14 4 \u79D2") + "</span><div><i data-breath-progress></i></div>";
    root.querySelector(".soft-intro>[data-sc-breath]")?.after(meter);
    const label = root.querySelector(".soft-journal>label");
    if (label) {
      const actions = document.createElement("div");
      actions.className = "journey-journal-actions";
      actions.innerHTML = `${button2(copy("Keep this reflection", "\u4FDD\u5B58\u5FC3\u7EEA"), "data-journey-save-reflection")}${button2(copy("My reflections", "\u6211\u7684\u8BB0\u5F55"), "data-journey-reflections", true)}`;
      label.append(actions);
    }
  }
  if (root.dataset.style === "claymorphism") {
    const report = document.createElement("button");
    report.type = "button";
    report.className = "sc-button sc-secondary";
    report.dataset.journeyGarden = "true";
    report.textContent = copy("Garden record", "\u82B1\u56ED\u8BB0\u5F55");
    root.querySelector(".clay-progress")?.after(report);
  }
  const reflections = Array.isArray(remembered.reflections) ? remembered.reflections : [];
  const completedLessons = new Set(Array.isArray(remembered.completedLessons) ? remembered.completedLessons : [0, 1]);
  const updateLearningProgress = () => {
    const output = root.querySelector(".learning-progress>strong"), bar = root.querySelector(".learning-progress i");
    if (output) output.textContent = `${completedLessons.size} / 4`;
    if (bar) bar.style.width = `${completedLessons.size / 4 * 100}%`;
  };
  if (root.dataset.style === "colorful") updateLearningProgress();
  const stop = (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  if (root.dataset.style === "business") {
    const view = root.querySelector('[data-sc-view][aria-pressed="true"]')?.dataset.scView ?? "0";
    root.querySelectorAll(".business-summary,.business-toolbar,.business-table,.business-bottom").forEach((node) => {
      node.hidden = node.classList.contains("business-summary") ? view !== "0" : view !== "1";
    });
    root.querySelectorAll("[data-sc-business-panel]").forEach((panel) => {
      panel.hidden = panel.dataset.scBusinessPanel !== view;
    });
  }
  const click = (event) => {
    const target = event.target instanceof Element ? event.target.closest("button,a") : null;
    if (!target || !root.contains(target)) return;
    if (root.dataset.style === "skeuomorphism" && target.matches(".scene-header nav a")) {
      stop(event);
      while (stack.length) back();
      root.querySelectorAll(".scene-header nav a").forEach((link) => {
        if (link === target) link.setAttribute("aria-current", "page");
        else link.removeAttribute("aria-current");
      });
      root.querySelector(target.getAttribute("href") === "#scene-secondary" ? '[data-sc-view="1"]' : '[data-sc-view="0"]')?.click();
      return;
    }
    if (target.matches('.flat-hero a[href="#scene-secondary"],.luxury-link')) {
      stop(event);
      root.querySelector('.scene-header nav a[href="#scene-secondary"]')?.click();
      return;
    }
    if (root.dataset.style === "business" && target.matches(".scene-header nav a")) {
      stop(event);
      while (stack.length) back();
      root.querySelectorAll(".scene-header nav a").forEach((link) => {
        if (link === target) link.setAttribute("aria-current", "page");
        else link.removeAttribute("aria-current");
      });
      root.querySelector(target.getAttribute("href") === "#scene-secondary" ? '[data-sc-view="1"]' : '[data-sc-view="0"]')?.click();
      return;
    }
    if (target.hasAttribute("data-journey-business-view")) {
      stop(event);
      root.querySelector(`[data-sc-view="${target.dataset.journeyBusinessView}"]`)?.click();
      return;
    }
    if (target.hasAttribute("data-journey-ticket-choice")) {
      stop(event);
      ticketEvent = target.dataset.journeyTicketChoice;
      const card = current()?.querySelector(".journey-ticket-choice");
      if (card) card.innerHTML = `<span>OFF / GRID \u2014 2026</span><h2>${festival[Number(ticketEvent)]}</h2><p>${["24 OCT \xB7 14:00 \xB7 STUDIO A", "25 OCT \xB7 16:30 \xB7 STUDIO B", "26 OCT \xB7 19:00 \xB7 MAIN STAGE"][Number(ticketEvent)]}</p>`;
      current()?.querySelectorAll("[data-journey-ticket-choice]").forEach((n) => n.setAttribute("aria-pressed", String(n === target)));
      return;
    }
    if (target.hasAttribute("data-journey-seats")) {
      stop(event);
      const form2 = target.closest("form"), input2 = form2?.querySelector('[name="seats"]');
      if (input2) input2.value = target.dataset.journeySeats;
      form2?.querySelectorAll("[data-journey-seats]").forEach((n) => n.setAttribute("aria-pressed", String(n === target)));
      return;
    }
    if (target.hasAttribute("data-journey-back")) {
      stop(event);
      back();
      return;
    }
    if (stack.length && target.matches(".scene-brand,.scene-header nav a")) {
      while (stack.length) back();
    }
    if (target.hasAttribute("data-paper-reminder")) {
      stop(event);
      root.dataset.paperReminder = String(root.dataset.paperReminder !== "true");
      paintPaperHardware();
      paperSaveDay();
      paperStatus(copy(root.dataset.paperReminder === "true" ? "Reminder set for 18:00 on this date." : "Reminder switched off for this date.", root.dataset.paperReminder === "true" ? "\u5DF2\u8BBE\u4E3A\u5F53\u5929 18:00 \u63D0\u9192\u3002" : "\u5DF2\u5173\u95ED\u5F53\u5929\u63D0\u9192\u3002"));
      return;
    }
    if (target.hasAttribute("data-paper-bookmark")) {
      stop(event);
      root.dataset.paperBookmark = String(root.dataset.paperBookmark !== "true");
      paintPaperHardware();
      paperSaveDay();
      paperStatus(copy(root.dataset.paperBookmark === "true" ? "This day is marked in your notebook." : "Bookmark removed from this day.", root.dataset.paperBookmark === "true" ? "\u8FD9\u4E00\u5929\u5DF2\u5939\u4E0A\u4E66\u7B7E\u3002" : "\u5DF2\u53D6\u4E0B\u8FD9\u4E00\u5929\u7684\u4E66\u7B7E\u3002"));
      return;
    }
    if (target.hasAttribute("data-paper-ink")) {
      stop(event);
      root.dataset.paperInk = target.dataset.paperInk;
      paintPaperHardware();
      paperSaveDay();
      paperStatus(copy("Writing colour changed for this date.", "\u5DF2\u66F4\u6362\u8FD9\u4E00\u5929\u7684\u4E66\u5199\u989C\u8272\u3002"));
      return;
    }
    if (target.hasAttribute("data-paper-date")) {
      stop(event);
      changePaperDate(Number(target.dataset.paperDate));
      return;
    }
    if (target.hasAttribute("data-paper-new-task")) {
      stop(event);
      open(copy("One thing to do", "\u8BA4\u771F\u505A\u4E00\u4EF6\u4E8B"), `<form data-journey-form="paper-task"><div class="journey-note-paper">${field(copy("What would you like to do?", "\u4ECA\u5929\u60F3\u5B8C\u6210\u4EC0\u4E48\uFF1F"), "title")}<p>${copy("A small, specific action is enough.", "\u4E00\u4EF6\u5177\u4F53\u7684\u5C0F\u4E8B\uFF0C\u5C31\u5F88\u597D\u3002")}</p></div>${button2(copy("Add to this day", "\u653E\u8FDB\u4ECA\u65E5\u4EFB\u52A1"), 'type="submit"')}</form>`, "paper-editor");
      return;
    }
    if (target.hasAttribute("data-paper-note")) {
      stop(event);
      open(copy("A note for this day", "\u5199\u7ED9\u4ECA\u5929\u7684\u4FBF\u7B7E"), `<form data-journey-form="paper-note"><div class="journey-note-paper">${field(copy("Write with a little room to think", "\u7559\u4E00\u70B9\u7A7A\u95F4\uFF0C\u5199\u4E0B\u60F3\u6CD5"), "note", root.querySelector(".paper-writing textarea")?.value ?? "", true)}</div>${button2(copy("Keep in the notebook", "\u6536\u8FDB\u624B\u8D26"), 'type="submit"')}</form>`, "paper-editor");
      return;
    }
    if (target.hasAttribute("data-paper-new-idea")) {
      stop(event);
      open(copy("An idea worth keeping", "\u7ED9\u7075\u611F\u4E00\u5F20\u7EB8"), `<form data-journey-form="paper-idea"><div class="journey-idea-paper">${field(copy("A short title", "\u7075\u611F\u6807\u9898"), "title")}${field(copy("What could it become?", "\u5B83\u53EF\u4EE5\u53D8\u6210\u4EC0\u4E48\uFF1F"), "body", "", true)}</div>${button2(copy("Pin to ideas", "\u8D34\u8FDB\u7075\u611F\u9875"), 'type="submit"')}</form>`, "paper-editor");
      return;
    }
    if (target.hasAttribute("data-paper-save")) {
      stop(event);
      paperSaveDay();
      paperStatus(copy("Note kept for this date in the preview.", "\u968F\u8BB0\u5DF2\u4FDD\u7559\u5728\u672C\u6B21\u9884\u89C8\u7684\u5F53\u524D\u65E5\u671F\u3002"));
      target.classList.add("is-stamped");
      return;
    }
    if (target.hasAttribute("data-paper-completed")) {
      stop(event);
      const completed = paperInputs().flatMap((input2, i) => input2.checked ? [{ title: input2.closest("label")?.querySelector("span")?.textContent ?? "", id: i }] : []);
      open(copy("The completed folder", "\u4ECA\u65E5\u5B8C\u6210\u5939"), `<div class="journey-paper-archive">${completed.length ? completed.map((item) => `<article><span>\u2713</span><h2>${escape3(item.title)}</h2>${button2(copy("Return to tasks", "\u6062\u590D\u4E3A\u5F85\u529E"), `data-paper-restore="${item.id}"`, true)}</article>`).join("") : `<h2>${copy("Room for your first little win.", "\u5B8C\u6210\u7B2C\u4E00\u4EF6\u5C0F\u4E8B\u540E\uFF0C\u5B83\u4F1A\u6765\u5230\u8FD9\u91CC\u3002")}</h2><p>${copy("Tick a task in your notebook to file it here.", "\u5728\u624B\u8D26\u4E2D\u52FE\u9009\u5B8C\u6210\u7684\u4EFB\u52A1\uFF0C\u5C31\u80FD\u6536\u8FDB\u5B8C\u6210\u5939\u3002")}</p>`}</div>`, "paper-archive");
      return;
    }
    if (target.hasAttribute("data-paper-restore")) {
      stop(event);
      const input2 = paperInputs()[Number(target.dataset.paperRestore)];
      if (input2) input2.checked = false;
      back();
      paperStatus();
      return;
    }
    if (target.hasAttribute("data-paper-convert")) {
      stop(event);
      const card = target.closest(".paper-idea-card");
      appendTask(card?.querySelector("h3")?.textContent ?? "");
      target.textContent = copy("Added to this day", "\u5DF2\u653E\u8FDB\u4ECA\u65E5\u4EFB\u52A1");
      target.disabled = true;
      root.querySelector('[data-sc-view="0"]')?.click();
      root.querySelector(".paper-page>.scene-checklist label:last-child")?.scrollIntoView({ block: "nearest" });
      paperStatus(copy("Idea moved into the day\u2019s task list.", "\u7075\u611F\u5DF2\u8F6C\u5165\u4ECA\u5929\u7684\u4EFB\u52A1\u6E05\u5355\u3002"));
      return;
    }
    if (root.dataset.style === "luxury" && target.hasAttribute("data-sc-toggle")) {
      stop(event);
      const saved = target.getAttribute("aria-pressed") !== "true";
      target.setAttribute("aria-pressed", String(saved));
      open(copy("Your saved collection", "\u6536\u85CF\u7684\u5668\u7269\u7CFB\u5217"), saved ? `<div class="journey-saved-objects">${[...root.querySelectorAll(".luxury-collection-grid>article")].map((card) => `<article><div>${card.querySelector("svg")?.outerHTML ?? ""}</div><h3>${escape3(card.querySelector("h3")?.textContent ?? "")}</h3>${button2(copy("Explore this object", "\u4E86\u89E3\u8FD9\u4EF6\u5668\u7269"), "data-sc-expand", true)}</article>`).join("")}</div>` : `<div class="journey-empty"><h2>${copy("Collection removed from saved.", "\u5DF2\u53D6\u6D88\u6536\u85CF\u8FD9\u4E00\u7CFB\u5217\u3002")}</h2><p>${copy("You can keep it again from the collection header.", "\u559C\u6B22\u65F6\uFF0C\u53EF\u4EE5\u4ECE\u7CFB\u5217\u9875\u5934\u91CD\u65B0\u6536\u85CF\u3002")}</p></div>`, "collection");
      return;
    }
    if (target.hasAttribute("data-sc-bag")) {
      stop(event);
      open(copy("Your shopping bag", "\u8D2D\u7269\u888B"), cartPage(), "cart");
      return;
    }
    if (target.hasAttribute("data-sc-add")) {
      stop(event);
      const owner = target.closest("[data-sc-product]"), index = [...root.querySelectorAll("[data-sc-product]")].indexOf(owner);
      addProduct(Math.max(0, index));
      return;
    }
    if (target.hasAttribute("data-journey-product")) {
      stop(event);
      const id = Number(target.dataset.journeyProduct), p = products[id];
      const art = root.querySelectorAll(".product-object")[id]?.querySelector("svg")?.outerHTML ?? "";
      open(p.name, `<div class="journey-product"><div class="journey-product-art">${art}</div><section><span class="scene-eyebrow">OBJECT / ${String(id + 1).padStart(3, "0")}</span><p class="journey-lead">${p.desc}</p><p>${p.spec}</p><strong class="journey-price">\xA5${p.price}</strong>${button2(copy("Add to bag", "\u52A0\u5165\u8D2D\u7269\u888B"), `data-journey-add-product="${id}"`)}${button2(copy("View bag", "\u67E5\u770B\u8D2D\u7269\u888B"), "data-sc-bag", true)}<p role="status" data-product-status></p></section></div>`, "product");
      return;
    }
    if (target.hasAttribute("data-journey-add-product")) {
      stop(event);
      addProduct(Number(target.dataset.journeyAddProduct));
      const status = current()?.querySelector("[data-product-status]");
      if (status) status.textContent = copy("Added to your bag. Continue shopping or review your items.", "\u5DF2\u52A0\u5165\u8D2D\u7269\u888B\uFF0C\u53EF\u4EE5\u7EE7\u7EED\u9009\u8D2D\u6216\u67E5\u770B\u7269\u4EF6\u6E05\u5355\u3002");
      return;
    }
    if (target.hasAttribute("data-journey-cart") || target.hasAttribute("data-journey-remove")) {
      stop(event);
      const id = Number(target.dataset.journeyCart ?? target.dataset.journeyRemove), next = target.hasAttribute("data-journey-remove") ? 0 : (cart.get(id) ?? 0) + Number(target.dataset.delta);
      if (next > 0) cart.set(id, next);
      else cart.delete(id);
      refreshCart();
      const focus = current()?.querySelector(`[data-journey-cart="${id}"][data-delta="${target.dataset.delta ?? 1}"]`) ?? current()?.querySelector("[data-journey-back]");
      focus?.focus({ preventScroll: true });
      return;
    }
    if (target.hasAttribute("data-journey-checkout")) {
      stop(event);
      const total = [...cart].reduce((sum, [id, n]) => sum + products[id].price * n, 0);
      open(copy("Demo order ready", "\u6F14\u793A\u8BA2\u5355\u5DF2\u751F\u6210"), `<div class="journey-receipt"><span>OBJECT / CLUB</span><h2>${copy("A good choice, on paper.", "\u628A\u559C\u6B22\u7684\u7269\u4EF6\uFF0C\u7559\u5728\u6E05\u5355\u91CC\u3002")}</h2>${[...cart].map(([id, n]) => `<p><span>${products[id].name} \xD7 ${n}</span><strong>\xA5${products[id].price * n}</strong></p>`).join("")}<p><span>${copy("Total", "\u5408\u8BA1")}</span><strong>\xA5${total}</strong></p><small>${copy("DEMO-1026 \xB7 No charge. No real order.", "DEMO-1026 \xB7 \u672A\u6263\u6B3E\uFF0C\u672A\u751F\u6210\u771F\u5B9E\u8BA2\u5355\u3002")}</small></div>`, "receipt");
      return;
    }
    if (target.hasAttribute("data-journey-thread")) {
      stop(event);
      threadPage(Number(target.dataset.journeyThread));
      return;
    }
    if (target.hasAttribute("data-sc-compose")) {
      if (["material", "business", "bento"].includes(root.dataset.style ?? "")) {
        stop(event);
        const style = root.dataset.style;
        open(style === "material" ? copy("Start a conversation", "\u53D1\u8D77\u4E00\u6BB5\u8BA8\u8BBA") : style === "business" ? copy("Create a project", "\u65B0\u5EFA\u9879\u76EE") : copy("A note for your day", "\u5199\u4E00\u5219\u65E5\u5E38\u7B14\u8BB0"), `<form data-journey-form="${style}">${field(copy("Title", "\u6807\u9898"), "title")}${field(style === "business" ? copy("Project brief", "\u9879\u76EE\u76EE\u6807") : copy("Your thoughts", "\u5199\u4E0B\u5185\u5BB9"), "body", "", true)}${style === "business" ? field(copy("Owner", "\u8D1F\u8D23\u4EBA"), "owner", "Jun") : ""}${button2(style === "material" ? copy("Publish in this preview", "\u53D1\u5E03\u5230\u5F53\u524D\u793E\u533A") : style === "business" ? copy("Create local project", "\u521B\u5EFA\u6F14\u793A\u9879\u76EE") : copy("Keep this note", "\u4FDD\u5B58\u7B14\u8BB0"), 'type="submit"')}</form>`, "compose");
        return;
      }
    }
    if (target.hasAttribute("data-journey-project")) {
      stop(event);
      const row = target.closest("[data-sc-work-item]") ?? projects()[Number(target.dataset.journeyProject)];
      if (row) projectPage(row);
      return;
    }
    if (target.hasAttribute("data-journey-queue")) {
      stop(event);
      queuePage();
      return;
    }
    if (target.hasAttribute("data-journey-track")) {
      stop(event);
      setTrack(Number(target.dataset.journeyTrack));
      back();
      return;
    }
    if (root.dataset.style === "neumorphism" && (target.hasAttribute("data-sc-previous") || target.hasAttribute("data-sc-next"))) {
      stop(event);
      setTrack(track + (target.hasAttribute("data-sc-next") ? 1 : -1));
      return;
    }
    if (target.hasAttribute("data-sc-track")) {
      const index = [...root.querySelectorAll("[data-sc-track]")].indexOf(target);
      if (index >= 0) setTrack(index);
    }
    if (target.hasAttribute("data-sc-expand")) {
      if (["minimalism", "editorial"].includes(root.dataset.style ?? "")) {
        stop(event);
        readArticle(target);
        return;
      }
      if (root.dataset.style === "colorful") {
        stop(event);
        lessonPage();
        return;
      }
      if (root.dataset.style === "luxury") {
        stop(event);
        const card = target.closest("article"), title = card.querySelector("h3")?.textContent ?? "", art = card.querySelector("svg")?.outerHTML ?? "", objectIndex = title.includes("LOOP") ? 1 : title.includes("STILL") ? 2 : 0;
        open(title, `<div class="journey-atelier"><div class="journey-atelier-art">${art}</div><section><span class="scene-eyebrow">ATELIER / SMALL EDITION</span><p class="journey-lead">${copy(["A wheel-thrown vessel with a narrow opening, made for a single branch or a quiet corner.", "A folded aluminium task light, balanced for a desk and finished with a warm, dimmable glow.", "A wide-mouthed stoneware vessel with a low centre of gravity and a richly textured glaze."][objectIndex], ["\u624B\u5DE5\u62C9\u576F\u3001\u7A84\u53E3\u6536\u675F\uFF0C\u4E3A\u4E00\u679D\u82B1\u6216\u4E00\u4E2A\u5B89\u9759\u89D2\u843D\u800C\u5236\u4F5C\u3002", "\u6298\u5F2F\u94DD\u6750\u6784\u6210\u5E73\u8861\u7684\u684C\u9762\u706F\u5177\uFF0C\u6696\u5149\u53EF\u8C03\uFF0C\u966A\u4F34\u591C\u95F4\u9605\u8BFB\u3002", "\u5BBD\u53E3\u3001\u4F4E\u91CD\u5FC3\u7684\u539A\u58C1\u70BB\u5668\uFF0C\u4EE5\u4E30\u5BCC\u91C9\u9762\u627F\u6258\u65E5\u5E38\u82B1\u679D\u3002"][objectIndex])}</p><dl><dt>${copy("Material", "\u6750\u8D28")}</dt><dd>${copy(["Glazed stoneware", "Brushed aluminium", "Textured stoneware"][objectIndex], ["\u91C9\u9762\u70BB\u5668", "\u62C9\u4E1D\u94DD\u6750", "\u808C\u7406\u70BB\u5668"][objectIndex])}</dd><dt>${copy("Edition", "\u7248\u672C")}</dt><dd>${["07 / 40", "02 / 60", "08 / 25"][objectIndex]}</dd><dt>${copy("Dimensions", "\u89C4\u683C")}</dt><dd>${copy(["24 cm / narrow mouth", "42 cm / 2700 K", "32 cm / wide mouth"][objectIndex], ["24 cm / \u7A84\u53E3", "42 cm / 2700 K", "32 cm / \u5BBD\u53E3"][objectIndex])}</dd><dt>${copy("Availability", "\u5236\u4F5C\u5468\u671F")}</dt><dd>${copy(["Made to order \xB7 4 weeks", "Ready in 2 weeks", "Made to order \xB7 6 weeks"][objectIndex], ["\u63A5\u5355\u5236\u4F5C \xB7 4 \u5468", "2 \u5468\u5185\u5B8C\u6210", "\u63A5\u5355\u5236\u4F5C \xB7 6 \u5468"][objectIndex])}</dd></dl><form data-journey-form="enquiry">${field(copy("What would you like to know?", "\u60F3\u4E86\u89E3\u8FD9\u4EF6\u5668\u7269\u7684\u54EA\u4E9B\u7EC6\u8282\uFF1F"), "body", enquiries.get(title) ?? "", true)}${button2(copy("Keep enquiry draft", "\u4FDD\u5B58\u54A8\u8BE2\u8349\u7A3F"), 'type="submit"')}<p class="journey-caption">${copy("Saved locally in this preview; nothing is sent.", "\u4EC5\u5728\u672C\u6B21\u9884\u89C8\u4FDD\u7559\uFF0C\u4E0D\u53D1\u9001\u771F\u5B9E\u54A8\u8BE2\u3002")}</p></form></section></div>`, "atelier");
        return;
      }
    }
    if (target.hasAttribute("data-journey-viewpoint")) {
      stop(event);
      const index = Number(target.dataset.journeyViewpoint);
      lessonVisits.add(index);
      current()?.querySelector("[data-observation-view]")?.setAttribute("data-observation-view", ["front", "top", "side"][index]);
      const caption = current()?.querySelector("[data-observation-caption]");
      if (caption) caption.textContent = (english ? ["FRONT VIEW", "TOP VIEW", "SIDE VIEW"] : ["\u6B63\u89C6\u56FE", "\u4FEF\u89C6\u56FE", "\u4FA7\u89C6\u56FE"])[index];
      current()?.querySelectorAll("[data-journey-viewpoint]").forEach((n) => n.setAttribute("aria-pressed", String(n === target)));
      return;
    }
    if (target.hasAttribute("data-journey-layout")) {
      stop(event);
      const index = Number(target.dataset.journeyLayout);
      current()?.querySelectorAll(".journey-shape").forEach((shape, i) => {
        shape.style.left = `${index === 0 ? 15 + i * 15 : index === 1 ? 40 : 20 + i * 10}%`;
        shape.style.top = `${index === 0 ? 20 + i * 15 : index === 1 ? 20 + i * 20 : 35 + i * 5}%`;
      });
      current()?.querySelectorAll("[data-journey-layout]").forEach((n) => n.setAttribute("aria-pressed", String(n === target)));
      return;
    }
    if (target.hasAttribute("data-journey-shape")) {
      stop(event);
      const canvas = current()?.querySelector("[data-journey-canvas]");
      if (!canvas) return;
      canvas.querySelector(":scope>span")?.remove();
      const shape = document.createElement("i");
      shape.className = `journey-shape shape-${target.dataset.journeyShape}`;
      shape.style.background = paint;
      shape.style.left = `${15 + shapeCount * 23 % 60}%`;
      shape.style.top = `${18 + shapeCount * 17 % 55}%`;
      shapeCount++;
      canvas.append(shape);
      return;
    }
    if (target.hasAttribute("data-journey-paint")) {
      stop(event);
      paint = target.dataset.journeyPaint;
      if (activeLesson === 1) {
        if (paletteColors.size === 3 && !paletteColors.has(paint)) paletteColors.delete(paletteColors.values().next().value);
        paletteColors.add(paint);
        [...paletteColors].forEach((color, i) => {
          const slot = current()?.querySelector(`[data-palette-slot="${i}"]`);
          if (slot) slot.style.background = color;
        });
        const status = current()?.querySelector("[data-palette-status]");
        if (status) status.textContent = copy(`${paletteColors.size} / 3 colours chosen`, `${paletteColors.size} / 3 \u79CD\u989C\u8272\u5DF2\u9009\u62E9`);
      }
      current()?.querySelectorAll("[data-journey-paint]").forEach((n) => n.setAttribute("aria-pressed", String(activeLesson === 1 ? paletteColors.has(n.getAttribute("data-journey-paint")) : n === target)));
      return;
    }
    if (target.hasAttribute("data-journey-clear")) {
      stop(event);
      current()?.querySelectorAll(".journey-shape").forEach((n) => n.remove());
      shapeCount = 0;
      return;
    }
    if (target.hasAttribute("data-journey-complete-lesson")) {
      stop(event);
      const status = current()?.querySelector("[data-journey-lesson-status]");
      if (activeLesson === 0 && lessonVisits.size < 3 || activeLesson === 1 && paletteColors.size < 3 || activeLesson >= 2 && !current()?.querySelector(".journey-shape")) {
        if (status) status.textContent = activeLesson === 0 ? copy("Visit all three viewpoints first.", "\u5148\u89C2\u5BDF\u4E09\u4E2A\u4E0D\u540C\u89C6\u89D2\u3002") : activeLesson === 1 ? copy("Choose three colours first.", "\u5148\u9009\u62E9\u4E09\u79CD\u989C\u8272\u3002") : copy("Add at least one shape before completing the exercise.", "\u5148\u6DFB\u52A0\u4E00\u4E2A\u5F62\u72B6\uFF0C\u518D\u5B8C\u6210\u7EC3\u4E60\u3002");
        return;
      }
      completedLessons.add(activeLesson);
      updateLearningProgress();
      if (status) status.textContent = copy("Exercise complete. Your composition stays here until you return.", "\u7EC3\u4E60\u5DF2\u5B8C\u6210\uFF0C\u4F5C\u54C1\u4F1A\u4FDD\u7559\u5728\u5F53\u524D\u7EC3\u4E60\u4E2D\u3002");
      const lesson = root.querySelector(`[data-sc-lesson="${target.dataset.journeyCompleteLesson}"] small`);
      if (lesson) lesson.textContent = copy("Completed", "\u5DF2\u5B8C\u6210");
      target.textContent = copy("Completed", "\u5DF2\u5B8C\u6210");
      return;
    }
    if (target.hasAttribute("data-journey-programme")) {
      stop(event);
      const id = target.dataset.journeyProgramme;
      open(festival[Number(id)], `<div class="journey-festival"><span>OFF / GRID \u2014 DAY 0${Number(id) + 1}</span><h2>${copy(["A conversation about shapes, meaning and useful design.", "A studio visit beyond the ordinary working day.", "An evening of sound, light and independent music."][Number(id)], ["\u804A\u804A\u5F62\u72B6\u3001\u610F\u4E49\uFF0C\u4EE5\u53CA\u597D\u7528\u7684\u8BBE\u8BA1\u3002", "\u8D70\u51FA\u65E5\u5E38\uFF0C\u62DC\u8BBF\u4E00\u4E2A\u8BA4\u771F\u521B\u4F5C\u7684\u5DE5\u4F5C\u5BA4\u3002", "\u5C5E\u4E8E\u58F0\u97F3\u3001\u5149\u7EBF\u548C\u72EC\u7ACB\u97F3\u4E50\u7684\u591C\u665A\u3002"][Number(id)])}</h2><dl><dt>${copy("Time", "\u65F6\u95F4")}</dt><dd>${["14:00 \u2014 15:30", "16:30 \u2014 18:00", "19:00 \u2014 22:00"][Number(id)]}</dd><dt>${copy("Location", "\u5730\u70B9")}</dt><dd>${["STUDIO A", "STUDIO B", "MAIN STAGE"][Number(id)]}</dd></dl>${button2(copy("Reserve this event", "\u9884\u7559\u672C\u573A\u5E2D\u4F4D"), `data-journey-ticket="${id}"`)}</div>`, "festival");
      return;
    }
    if (target.hasAttribute("data-sc-ticket") || target.hasAttribute("data-journey-ticket")) {
      stop(event);
      ticketForm(target.dataset.journeyTicket ?? "0");
      return;
    }
    if (target.hasAttribute("data-gx-file")) {
      stop(event);
      const name = target.querySelector("strong")?.textContent ?? "Notes.md";
      open(name, `<div class="journey-file-view"><span class="scene-eyebrow">AURA / ${copy("FILE PREVIEW", "\u6587\u4EF6\u9884\u89C8")}</span>${name.endsWith(".md") ? `<article class="journey-reader"><h2>${copy("Notes for a quieter workspace", "\u4E00\u4E2A\u5B89\u9759\u5DE5\u4F5C\u7A7A\u95F4\u7684\u7B14\u8BB0")}</h2><ul><li>${copy("Keep one clear task in focus.", "\u628A\u4E00\u4EF6\u91CD\u8981\u7684\u4E8B\u653E\u5728\u773C\u524D\u3002")}</li><li>${copy("Collect references before choosing a direction.", "\u5148\u6536\u96C6\u53C2\u8003\uFF0C\u518D\u9009\u62E9\u65B9\u5411\u3002")}</li><li>${copy("Share a finished thought with the team.", "\u628A\u6574\u7406\u597D\u7684\u60F3\u6CD5\u5206\u4EAB\u7ED9\u56E2\u961F\u3002")}</li></ul></article>` : name.endsWith(".pdf") ? `<article class="journey-brand-document"><span>AURA / BRAND EXPLORATION</span><h2>${copy("A calmer place to create.", "\u66F4\u4ECE\u5BB9\u7684\u521B\u9020\u7A7A\u95F4\u3002")}</h2><div class="journey-brand-palette"><i></i><b></b><em></em></div><h3>Aa / ${copy("Room for ideas", "\u7ED9\u60F3\u6CD5\u7559\u70B9\u7A7A\u95F4")}</h3><p>${copy("A quiet identity built from clear space, a soft light palette and simple typography.", "\u6E05\u6670\u7559\u767D\u3001\u67D4\u548C\u6D45\u8272\u4E0E\u7B80\u5355\u6392\u7248\uFF0C\u6784\u6210\u4E00\u5957\u5B89\u9759\u7684\u89C6\u89C9\u8BC6\u522B\u3002")}</p><footer>01 / ${copy("IDENTITY DIRECTION", "\u89C6\u89C9\u8BC6\u522B\u65B9\u5411")}</footer></article>` : `<div class="journey-moodboard"><i></i><b></b><em></em><span>${copy("Shape / Light / Material", "\u5F62\u72B6 / \u5149\u7EBF / \u6750\u8D28")}</span></div><h2>${name === "Moodboard.fig" ? copy("Visual direction board", "\u89C6\u89C9\u65B9\u5411\u677F") : copy("Brand exploration", "\u54C1\u724C\u63A2\u7D22")}</h2><p>${copy("A curated preview of the material, colour and composition studies in this workspace.", "\u5F53\u524D\u5DE5\u4F5C\u7A7A\u95F4\u7684\u6750\u8D28\u3001\u8272\u5F69\u4E0E\u6784\u56FE\u63A2\u7D22\u9884\u89C8\u3002")}</p>`}<p class="journey-caption">${copy("Demonstration document; no local file is opened.", "\u6F14\u793A\u6587\u6863\uFF0C\u4E0D\u8BFB\u53D6\u771F\u5B9E\u672C\u5730\u6587\u4EF6\u3002")}</p></div>`, "file");
      return;
    }
    if (target.hasAttribute("data-journey-save-reflection")) {
      stop(event);
      const note = root.querySelector(".soft-journal textarea"), mood = root.querySelector('[data-sc-topic][aria-pressed="true"]')?.textContent ?? "";
      if (!note?.value.trim()) {
        note?.focus();
        if (!root.querySelector(".journey-reflection-error")) {
          const error = document.createElement("p");
          error.className = "journey-reflection-error";
          error.setAttribute("role", "alert");
          error.textContent = copy("Write a word or a sentence before saving.", "\u5148\u5199\u4E0B\u4E00\u4E2A\u8BCD\u6216\u4E00\u53E5\u8BDD\uFF0C\u518D\u4FDD\u5B58\u8FD9\u4EFD\u5FC3\u7EEA\u3002");
          note?.after(error);
        }
        note?.setAttribute("aria-invalid", "true");
        return;
      }
      reflections.push({ mood, text: note.value });
      note.value = "";
      open(copy("A moment, kept.", "\u8FD9\u4E00\u523B\uFF0C\u5DF2\u7ECF\u7559\u4E0B\u3002"), `<div class="journey-reflection"><span>${escape3(mood)}</span><blockquote>${escape3(reflections.at(-1).text)}</blockquote><p>${copy("Your reflection is kept in this preview session.", "\u8FD9\u4EFD\u8BB0\u5F55\u4F1A\u5728\u672C\u6B21\u9884\u89C8\u4E2D\u4FDD\u7559\u3002")}</p>${button2(copy("See my reflections", "\u67E5\u770B\u6211\u7684\u8BB0\u5F55"), "data-journey-reflections", true)}</div>`, "reflection");
      return;
    }
    if (target.hasAttribute("data-journey-reflections")) {
      stop(event);
      open(copy("My reflections", "\u6211\u7684\u5FC3\u7EEA\u8BB0\u5F55"), `<div class="journey-reflections">${reflections.length ? reflections.map((item, i) => `<article><span>0${i + 1} / ${escape3(item.mood)}</span><p>${escape3(item.text)}</p></article>`).join("") : `<div class="journey-empty"><h2>${copy("A page waiting for you.", "\u8FD9\u91CC\uFF0C\u7B49\u7740\u4F60\u7684\u7B2C\u4E00\u6761\u8BB0\u5F55\u3002")}</h2><p>${copy("Write a reflection and keep it to see it here.", "\u5728\u5FC3\u7EEA\u9875\u5199\u4E0B\u4E00\u70B9\u60F3\u6CD5\u5E76\u4FDD\u5B58\uFF0C\u5C31\u80FD\u5728\u8FD9\u91CC\u56DE\u770B\u3002")}</p></div>`}</div>`, "reflections");
      return;
    }
    if (target.hasAttribute("data-journey-garden")) {
      stop(event);
      const checks = [...root.querySelectorAll("[data-sc-habit]")], done = checks.filter((n) => n.checked).length;
      open(copy("Your growing garden", "\u6B63\u5728\u751F\u957F\u7684\u82B1\u56ED"), `<div class="journey-garden"><div class="journey-garden-flower">${root.querySelector(".clay-flower")?.outerHTML ?? ""}</div><section><span class="scene-eyebrow">TODAY / ${copy("YOUR CARE COUNTS", "\u6BCF\u4E00\u4EFD\u7167\u987E\uFF0C\u90FD\u7B97\u6570")}</span><h2>${done} / ${checks.length}</h2><p>${copy("Habits completed for the selected day.", "\u5F53\u524D\u6240\u9009\u65E5\u671F\u5DF2\u5B8C\u6210\u7684\u4E60\u60EF\u3002")}</p>${checks.map((check) => `<p class="journey-habit-line"><span>${check.checked ? "\u2713" : "\u25CB"}</span>${escape3(check.closest("label")?.querySelector("strong")?.textContent ?? "")}</p>`).join("")}</section></div>`, "garden");
      return;
    }
  };
  const notes = new Map(Array.isArray(remembered.notes) ? remembered.notes : []);
  let noteSerial = Number(remembered.noteSerial) || 0;
  const starterNote = notes.get("starter");
  if (starterNote) {
    const title = root.querySelector(".dayboard-note .scene-eyebrow");
    if (title) title.textContent = starterNote.title;
    const body = root.querySelector(".dayboard-note textarea");
    if (body) body.value = starterNote.body;
  }
  const onSubmit = (event) => {
    const form2 = event.target;
    if (!(form2 instanceof HTMLFormElement) || !root.contains(form2)) return;
    const kind = form2.dataset.journeyForm;
    if (!kind && !form2.matches(".scene-letter")) return;
    stop(event);
    if (!form2.reportValidity()) return;
    for (const input2 of form2.querySelectorAll("input[required],textarea[required]")) {
      if (!input2.value.trim()) {
        input2.setCustomValidity(copy("Please enter some content.", "\u8BF7\u586B\u5199\u6709\u6548\u5185\u5BB9\u3002"));
        input2.setAttribute("aria-invalid", "true");
        input2.reportValidity();
        return;
      }
    }
    const values = new FormData(form2), value = (name) => String(values.get(name) ?? "").trim();
    if (form2.matches(".scene-letter")) {
      const email = form2.querySelector("input")?.value ?? "";
      const recommendations = root.dataset.style === "editorial" ? [...root.querySelectorAll(".scene-story")].map((story, index) => ({ title: escape3(story.querySelector("h3")?.textContent ?? ""), index })) : articleBodies.map((story, index) => ({ title: story[0], index }));
      open(copy("A letter, when it matters.", "\u4E0B\u6B21\u6765\u4FE1\uFF0C\u7559\u7ED9\u91CD\u8981\u7684\u4E8B\u3002"), `<div class="journey-subscription"><span>FIELDNOTES / LETTER</span><h2>${copy("Your reading list is ready.", "\u4F60\u7684\u9605\u8BFB\u6E05\u5355\u5DF2\u51C6\u5907\u597D\u3002")}</h2><p>${copy("This preview has kept the address below locally. It has not subscribed or sent an email.", "\u5F53\u524D\u9884\u89C8\u5DF2\u4FDD\u7559\u4E0B\u9762\u7684\u5730\u5740\uFF0C\u6CA1\u6709\u771F\u5B9E\u8BA2\u9605\u6216\u53D1\u9001\u90AE\u4EF6\u3002")}</p><strong>${escape3(email)}</strong><h3>${copy("Start with these stories", "\u53EF\u4EE5\u4ECE\u8FD9\u4E9B\u6587\u7AE0\u5F00\u59CB")}</h3>${recommendations.map((item) => `<button type="button" class="scene-title-link" data-journey-read-index="${item.index}">${item.title}</button>`).join("")}</div>`, "subscription");
      return;
    }
    if (kind === "reply") {
      const reply = { name: copy("You", "\u4F60"), text: value("reply") };
      threads.get(activeThread)?.push(reply);
      const replyLink = root.querySelectorAll(".material-post")[activeThread]?.querySelector("footer [data-journey-thread]");
      if (replyLink) {
        const count = Number.parseInt(replyLink.textContent ?? "0", 10) || 0;
        replyLink.textContent = copy(`${count + 1} replies`, `${count + 1} \u6761\u56DE\u590D`);
      }
      const article = document.createElement("article");
      article.className = "journey-reply";
      article.innerHTML = `<strong>${reply.name}</strong><p>${escape3(reply.text)}</p>`;
      current()?.querySelector("[data-journey-replies]")?.append(article);
      form2.querySelector("textarea").value = "";
      article.scrollIntoView({ block: "nearest" });
      return;
    }
    if (kind === "material") {
      const id = root.querySelectorAll(".material-post").length;
      threads.set(id, []);
      const post = root.querySelector(".material-post").cloneNode(true);
      post.querySelector("h2").innerHTML = `<button type="button" class="scene-title-link" data-journey-thread="${id}">${escape3(value("title"))}</button>`;
      post.querySelector(":scope>p").textContent = value("body");
      post.querySelector("header strong").textContent = copy("You", "\u4F60");
      post.querySelector(".scene-avatar").textContent = "J";
      post.dataset.scTopicItem = "2";
      post.querySelector(".scene-pill").textContent = copy("Making", "\u521B\u4F5C");
      post.querySelectorAll("[aria-pressed]").forEach((n) => n.setAttribute("aria-pressed", "false"));
      post.querySelector("[data-sc-like] span").textContent = "0";
      post.querySelector("[data-journey-thread]")?.setAttribute("data-journey-thread", String(id));
      post.querySelector("footer [data-journey-thread]")?.setAttribute("data-journey-thread", String(id));
      post.querySelector("footer [data-journey-thread]").textContent = copy("0 replies", "0 \u6761\u56DE\u590D");
      while (stack.length) back();
      root.querySelector(".material-discussions").append(post);
      root.querySelector('[data-sc-view="0"]')?.click();
      root.querySelector('[data-sc-topic="0"]')?.click();
      post.scrollIntoView({ block: "nearest" });
      return;
    }
    if (kind === "business") {
      const row = projects()[0].cloneNode(true);
      row.querySelector("strong").innerHTML = `<button type="button" class="scene-title-link" data-journey-project="${projects().length}">${escape3(value("title"))}</button>`;
      row.querySelector("input").checked = false;
      row.dataset.status = "1";
      row.querySelector(".business-owner").textContent = value("owner");
      row.querySelector(".business-status").textContent = copy("In progress", "\u8FDB\u884C\u4E2D");
      row.querySelector("span:last-child").textContent = copy("UNSCHEDULED", "\u5F85\u6392\u671F");
      row.dataset.projectBrief = value("body");
      while (stack.length) back();
      root.querySelector(".business-table").append(row);
      root.querySelector('[data-sc-view="1"]')?.click();
      root.querySelector('[data-sc-status="0"]')?.click();
      const search = root.querySelector("[data-sc-search]");
      if (search) {
        search.value = "";
        search.dispatchEvent(new Event("input", { bubbles: true }));
      }
      row.scrollIntoView({ block: "nearest" });
      return;
    }
    if (kind === "bento") {
      const title = value("title"), body = value("body"), id = value("id") || String(++noteSerial);
      notes.set(id, { title, body });
      back();
      if (id === "starter") {
        const heading = root.querySelector(".dayboard-note .scene-eyebrow");
        if (heading) heading.textContent = title;
        const input2 = root.querySelector(".dayboard-note textarea");
        if (input2) input2.value = body;
        return;
      }
      let card = root.querySelector(`[data-note-id="${id}"]`);
      if (!card) {
        card = document.createElement("article");
        card.className = "dayboard-note journey-note-card";
        card.dataset.noteId = id;
        root.querySelector(".dayboard-grid")?.append(card);
      }
      card.innerHTML = `<span class="scene-eyebrow">NOTE / ${id.padStart(2, "0")}</span><h3>${escape3(title)}</h3><p>${escape3(body)}</p>${button2(copy("Edit note", "\u7F16\u8F91\u7B14\u8BB0"), `data-journey-edit-note="${id}"`, true)}`;
      card.scrollIntoView({ block: "nearest" });
      return;
    }
    if (kind === "paper-task") {
      const text = value("title");
      back();
      appendTask(text);
      root.querySelector('[data-sc-view="0"]')?.click();
      paperSaveDay();
      paperStatus(copy("A new task is on your page.", "\u65B0\u4EFB\u52A1\u5DF2\u653E\u8FDB\u4ECA\u5929\u7684\u624B\u8D26\u3002"));
      return;
    }
    if (kind === "paper-note") {
      const note = value("note");
      back();
      const input2 = root.querySelector(".paper-writing textarea");
      if (input2) input2.value = note;
      paperSaveDay();
      root.querySelector('[data-sc-view="1"]')?.click();
      paperStatus(copy("Your note is kept with this date.", "\u4FBF\u7B7E\u5DF2\u6536\u8FDB\u5F53\u524D\u65E5\u671F\u7684\u968F\u8BB0\u3002"));
      return;
    }
    if (kind === "paper-idea") {
      const title = value("title"), body = value("body");
      back();
      const card = document.createElement("article");
      card.className = "paper-idea-card";
      card.innerHTML = `<span>IDEA / ${String(root.querySelectorAll(".paper-idea-card").length + 1).padStart(2, "0")}</span><h3>${escape3(title)}</h3><p>${escape3(body)}</p>${button2(copy("Make it a task", "\u653E\u8FDB\u4ECA\u65E5\u4EFB\u52A1"), "data-paper-convert", true)}`;
      root.querySelector("[data-sc-paper-ideas]")?.append(card);
      root.querySelector('[data-sc-view="2"]')?.click();
      card.scrollIntoView({ block: "nearest" });
      return;
    }
    if (kind === "ticket") {
      const name = value("name"), seats = value("seats");
      open(copy("Your demo ticket", "\u4F60\u7684\u6F14\u793A\u7968\u5238"), `<article class="journey-ticket-stub"><div><span>OFF / GRID \u2014 2026</span><h2>${festival[Number(ticketEvent)]}</h2><p>${["24 OCT / 14:00", "25 OCT / 16:30", "26 OCT / 19:00"][Number(ticketEvent)]}</p></div><dl><dt>${copy("Guest", "\u6765\u5BBE")}</dt><dd>${escape3(name)}</dd><dt>${copy("Seats", "\u5E2D\u4F4D")}</dt><dd>${seats}</dd><dt>${copy("Reference", "\u7F16\u53F7")}</dt><dd>DEMO / 1026\u20140${Number(ticketEvent) + 1}</dd></dl><div class="journey-ticket-code" aria-hidden="true"></div><small>${copy("Demonstration only \xB7 not an admission ticket", "\u4EC5\u4F9B\u6F14\u793A \xB7 \u4E0D\u80FD\u7528\u4E8E\u771F\u5B9E\u5165\u573A")}</small></article>`, "ticket-stub");
      return;
    }
    if (kind === "enquiry") {
      const body = value("body");
      enquiries.set(current()?.querySelector("h1")?.textContent ?? "", body);
      form2.innerHTML = `<div class="journey-enquiry-kept" role="status"><span>ATELIER / NOTE KEPT</span><h2>${copy("An enquiry, ready when you are.", "\u60F3\u4E86\u89E3\u7684\uFF0C\u5DF2\u6574\u7406\u6210\u8349\u7A3F\u3002")}</h2><blockquote>${escape3(body)}</blockquote><p>${copy("This draft remains in the preview. No request has been sent.", "\u8349\u7A3F\u4FDD\u7559\u5728\u5F53\u524D\u9884\u89C8\uFF0C\u6CA1\u6709\u53D1\u9001\u54A8\u8BE2\u3002")}</p></div>`;
      return;
    }
  };
  const extraClick = (event) => {
    const target = event.target instanceof Element ? event.target.closest("button") : null;
    if (!target || !root.contains(target)) return;
    if (target.hasAttribute("data-journey-edit-note")) {
      stop(event);
      const id = target.dataset.journeyEditNote, note = notes.get(id);
      if (!note) return;
      open(copy("Edit your note", "\u7F16\u8F91\u8FD9\u5219\u7B14\u8BB0"), `<form data-journey-form="bento"><input type="hidden" name="id" value="${id}">${field(copy("Title", "\u6807\u9898"), "title", note.title)}${field(copy("Your thoughts", "\u5199\u4E0B\u5185\u5BB9"), "body", note.body, true)}${button2(copy("Save changes", "\u4FDD\u5B58\u4FEE\u6539"), 'type="submit"')}</form>`, "compose");
    }
    if (target.hasAttribute("data-journey-read-index")) {
      stop(event);
      const index = Number(target.dataset.journeyReadIndex), trigger = root.querySelectorAll(".scene-story [data-sc-expand]")[index];
      if (trigger) readArticle(trigger);
    }
    if (target.hasAttribute("data-journey-atlas-report")) {
      stop(event);
      const node = lastScan?.node ?? root.querySelector("[data-cyber-node-title]")?.textContent ?? "TOKYO / 07";
      open(copy("Relay scan report", "\u4E2D\u7EE7\u626B\u63CF\u62A5\u544A"), `<div class="journey-scan-report"><span class="scene-eyebrow">NEXUS / DIAGNOSTIC RESULT</span><h2>${escape3(node)}</h2><div class="journey-project-meta"><span>${copy("Latency", "\u5EF6\u8FDF")}<strong>${lastScan?.latency ?? "02"} ms</strong></span><span>${copy("Packet loss", "\u4E22\u5305\u7387")}<strong>0.00%</strong></span><span>${copy("Encryption", "\u52A0\u5BC6")}<strong>AES\u2014256</strong></span></div><ol>${[copy("Relay responded to probe", "\u4E2D\u7EE7\u63A2\u6D4B\u54CD\u5E94\u6B63\u5E38"), copy("Route verified across edge nodes", "\u8DE8\u8FB9\u7F18\u8282\u70B9\u8DEF\u7531\u5DF2\u9A8C\u8BC1"), copy("Signal locked and connection stable", "\u4FE1\u53F7\u5DF2\u9501\u5B9A\uFF0C\u94FE\u8DEF\u7A33\u5B9A")].map((text) => `<li>\u2713 ${text}</li>`).join("")}</ol><p class="journey-caption">${copy("Simulated diagnostic data; no network request was sent.", "\u6A21\u62DF\u8BCA\u65AD\u6570\u636E\uFF0C\u6CA1\u6709\u53D1\u8D77\u771F\u5B9E\u7F51\u7EDC\u626B\u63CF\u3002")}</p></div>`, "scan-report");
    }
  };
  const noteEditor = root.querySelector(".dayboard-note");
  if (noteEditor) {
    const expand = document.createElement("button");
    expand.type = "button";
    expand.className = "scene-title-link";
    expand.dataset.journeyEditStarter = "true";
    expand.textContent = copy("Open note editor", "\u5C55\u5F00\u7B14\u8BB0");
    noteEditor.append(expand);
  }
  const onStarter = (event) => {
    const target = event.target instanceof Element ? event.target.closest("[data-journey-edit-starter]") : null;
    if (!target) return;
    stop(event);
    const note = notes.get("starter");
    open(copy("A thought to keep", "\u503C\u5F97\u8BB0\u4F4F\u7684\u60F3\u6CD5"), `<form data-journey-form="bento"><input type="hidden" name="id" value="starter">${field(copy("Title", "\u6807\u9898"), "title", note?.title ?? copy("A thought to keep", "\u503C\u5F97\u8BB0\u4F4F\u7684\u60F3\u6CD5"))}${field(copy("Your thoughts", "\u5199\u4E0B\u5185\u5BB9"), "body", root.querySelector(".dayboard-note textarea")?.value ?? note?.body ?? "", true)}${button2(copy("Keep this note", "\u4FDD\u5B58\u7B14\u8BB0"), 'type="submit"')}</form>`, "compose");
  };
  const input = (event) => {
    const node = event.target;
    if (!(node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement)) return;
    if (node.matches(".dayboard-note textarea")) notes.set("starter", { title: root.querySelector(".dayboard-note .scene-eyebrow")?.textContent ?? copy("A thought to keep", "\u503C\u5F97\u8BB0\u4F4F\u7684\u60F3\u6CD5"), body: node.value });
    if (node.matches("[data-journey-project-note],[data-journey-project-check]")) {
      const page = node.closest(".scene-view-project"), index = Number(page?.dataset.projectIndex);
      if (page && Number.isInteger(index)) projectDrafts.set(index, { checks: [...page.querySelectorAll("[data-journey-project-check]")].map((input2) => input2.checked), note: page.querySelector("[data-journey-project-note]")?.value ?? "" });
    }
    if (node.hasAttribute("data-journey-poster-title")) {
      const wordmark = current()?.querySelector("[data-poster-wordmark]");
      if (wordmark) wordmark.textContent = node.value;
    }
    node.setCustomValidity("");
    node.removeAttribute("aria-invalid");
    if (node.matches(".soft-journal textarea")) root.querySelector(".journey-reflection-error")?.remove();
    if (node.matches(".paper-writing textarea")) {
      root.querySelector(".paper-save-stamp")?.classList.remove("is-stamped");
      paperStatus(copy("Unsaved note \xB7 keep it when ready.", "\u968F\u8BB0\u6709\u4FEE\u6539\uFF0C\u5199\u597D\u540E\u53EF\u4EE5\u4FDD\u5B58\u3002"));
    }
    if (node.matches(".paper-page>.scene-checklist input,.paper-page .scene-checklist input")) paperStatus();
    if (node.hasAttribute("data-journey-audio-progress")) {
      elapsed = Number(node.value);
      root.dataset.audioElapsed = String(elapsed);
      const output = root.querySelector("[data-journey-audio-time]");
      if (output) output.textContent = `${time(elapsed)} / ${tracks[track][2]}`;
      const studio = root.querySelector(".studio-time");
      if (studio) studio.textContent = `${time(elapsed)} / ${tracks[track][2]}`;
    }
  };
  const key = (event) => {
    if (event.key === "Escape" && stack.length) {
      stop(event);
      back();
    }
  };
  let wasScanning = false;
  const scanObserver = new MutationObserver(() => {
    const scanning = root.dataset.diagnosing === "true";
    if (wasScanning && !scanning) {
      lastScan = { node: root.querySelector("[data-cyber-node-title]")?.textContent ?? "TOKYO / 07", latency: root.dataset.cyberLatency ?? "02", time: (/* @__PURE__ */ new Date()).toISOString().slice(11, 19) };
      const event = document.createElement("article");
      event.className = "cyber-event";
      event.innerHTML = `<time>${lastScan.time}</time><b>SCAN</b><div><h2>${escape3(lastScan.node)} / ${copy("Scan complete", "\u626B\u63CF\u901A\u8FC7")}</h2><p>${copy("Simulation record", "\u6A21\u62DF\u8BB0\u5F55")}</p></div><span>\u2713</span>`;
      root.querySelector('[data-sc-mission-panel="2"]>.cyber-section-label')?.after(event);
      let report = root.querySelector("[data-journey-atlas-report]");
      if (!report) {
        report = document.createElement("button");
        report.setAttribute("type", "button");
        report.className = "sc-button sc-secondary journey-scan-result";
        report.dataset.journeyAtlasReport = "true";
        report.textContent = copy("View scan report", "\u67E5\u770B\u626B\u63CF\u62A5\u544A");
        root.querySelector("[data-sc-diagnostic]")?.after(report);
      }
    }
    wasScanning = scanning;
  });
  if (root.dataset.style === "tech" && lastScan && !root.querySelector("[data-journey-atlas-report]")) {
    const report = document.createElement("button");
    report.type = "button";
    report.className = "sc-button sc-secondary journey-scan-result";
    report.dataset.journeyAtlasReport = "true";
    report.textContent = copy("View scan report", "\u67E5\u770B\u626B\u63CF\u62A5\u544A");
    root.querySelector("[data-sc-diagnostic]")?.after(report);
  }
  if (root.dataset.style === "tech") scanObserver.observe(root, { attributes: true, attributeFilter: ["data-diagnosing"] });
  root.addEventListener("click", click, true);
  root.addEventListener("click", extraClick, true);
  root.addEventListener("click", onStarter, true);
  root.addEventListener("submit", onSubmit, true);
  root.addEventListener("input", input);
  root.addEventListener("keydown", key);
  return () => {
    if (root.dataset.style === "skeuomorphism") paperSaveDay();
    root.dataset.journeyState = JSON.stringify({ cart: [...cart], enquiries: [...enquiries], lastScan, threads: [...threads], notes: [...notes], noteSerial, projectDrafts: [...projectDrafts], paperDays: [...paperDays], paperDay, reflections, completedLessons: [...completedLessons] });
    root.removeEventListener("click", click, true);
    root.removeEventListener("click", extraClick, true);
    root.removeEventListener("click", onStarter, true);
    root.removeEventListener("submit", onSubmit, true);
    root.removeEventListener("input", input);
    root.removeEventListener("keydown", key);
    scanObserver.disconnect();
    clearInterval(transportTimer);
    animations.forEach((animation) => animation.cancel());
    while (stack.length) back();
    root.querySelectorAll(".paper-action-tools,.paper-date-controls,.paper-save-stamp,.paper-idea-add,.paper-save-status,.journey-audio-status,.journey-journal-actions,.soft-session-meter,[data-journey-garden],[data-journey-edit-starter],.journey-scan-result").forEach((node) => node.remove());
  };
})(scene,english); (function mountShowcase(root, english = false) {
  let noticeTimer;
  let diagnosticTimer;
  let cart = 0, workStatus = root.querySelector('[data-sc-status][aria-pressed="true"]')?.dataset.scStatus ?? "0", workQuery = root.querySelector("[data-sc-search]")?.value.toLocaleLowerCase() ?? "";
  let breathingTimer;
  let duration = root.dataset.style === "soft" ? [2, 5, 10][[...root.querySelectorAll("[data-sc-hour]")].findIndex((node) => node.getAttribute("aria-pressed") === "true")] ?? 2 : 2, breathStarted = 0, breathElapsed = Number(root.dataset.breathElapsed) || 0, focusRemaining = Number(root.dataset.focusRemaining) || 1500, focusStarted = 0;
  let focusTimer;
  const mark = (selector, target) => root.querySelectorAll(selector).forEach((button2) => button2.setAttribute("aria-pressed", String(button2 === target)));
  const filterWork = () => {
    let count = 0;
    root.querySelectorAll("[data-sc-work-item]").forEach((row) => {
      row.hidden = !(workStatus === "0" || row.dataset.status === workStatus) || !row.textContent?.toLocaleLowerCase().includes(workQuery);
      if (!row.hidden) count++;
    });
    const output = root.querySelector("[data-sc-result-count]");
    if (output) output.textContent = `${count} ${english ? "projects" : "\u4E2A\u9879\u76EE"}`;
  };
  const filterCommunity = () => {
    const saved = root.querySelector('[data-sc-view="2"][aria-pressed="true"]');
    const topic = root.querySelector('[data-sc-topic][aria-pressed="true"]')?.dataset.scTopic ?? "0";
    let count = 0;
    root.querySelectorAll(".material-post").forEach((post) => {
      post.hidden = !!saved && !post.querySelector('[data-sc-toggle][aria-pressed="true"]') || topic !== "0" && post.dataset.scTopicItem !== topic;
      if (!post.hidden) count++;
    });
    let empty = root.querySelector("[data-sc-empty]");
    if (!empty && root.querySelector(".material-discussions")) {
      empty = document.createElement("p");
      empty.dataset.scEmpty = "true";
      empty.className = "scene-muted";
      root.querySelector(".material-discussions").append(empty);
    }
    if (empty) {
      empty.textContent = english ? "No discussions in this view yet. Save a discussion or choose another topic." : "\u8FD9\u91CC\u8FD8\u6CA1\u6709\u8BA8\u8BBA\uFF0C\u6536\u85CF\u4E00\u6761\u8BA8\u8BBA\u6216\u5207\u6362\u4E3B\u9898\u8BD5\u8BD5\u3002";
      empty.hidden = count > 0;
    }
  };
  const say = (en, zh) => {
    const notice = root.querySelector(".sc-notice");
    if (!notice) return;
    clearTimeout(noticeTimer);
    notice.textContent = english ? en : zh;
    notice.hidden = false;
    noticeTimer = setTimeout(() => {
      notice.hidden = true;
    }, 2800);
  };
  const workspace = (name) => {
    root.querySelector("[data-gx-more]")?.setAttribute("aria-expanded", String(name === "about"));
    root.querySelectorAll("[data-gx-workspace]").forEach((button2) => button2.setAttribute("aria-pressed", String(button2.getAttribute("data-gx-workspace") === name)));
    root.querySelectorAll("[data-gx-panel]").forEach((panel) => {
      panel.hidden = panel.dataset.gxPanel !== name;
    });
    reveal(root.querySelector(`[data-gx-panel="${name}"]`));
  };
  const reducedMotion = () => matchMedia("(prefers-reduced-motion:reduce)").matches;
  const transitions = /* @__PURE__ */ new Set();
  const reveal = (panel) => {
    if (!panel || reducedMotion()) return;
    const style = root.dataset.style;
    const frames = style === "skeuomorphism" ? [{ opacity: 0.3, transform: "perspective(900px) rotateY(-12deg)", transformOrigin: "0 50%" }, { opacity: 1, transform: "perspective(900px) rotateY(0deg)", transformOrigin: "0 50%" }] : style === "claymorphism" ? [{ opacity: 0.6, transform: "translateY(10px) scale(.95)" }, { opacity: 1, transform: "translateY(-2px) scale(1.015)", offset: 0.7 }, { opacity: 1, transform: "none" }] : style === "retro" ? [{ clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0 0 0 0)" }] : style === "tech" ? [{ opacity: 0.2, clipPath: "inset(0 0 100% 0)" }, { opacity: 1, clipPath: "inset(0 0 0 0)" }] : [{ opacity: 0.25, transform: "translateY(10px)" }, { opacity: 1, transform: "translateY(0)" }];
    const animation = panel.animate?.(frames, { duration: style === "skeuomorphism" ? 450 : style === "claymorphism" ? 420 : 260, easing: "cubic-bezier(.22,.8,.2,1)" });
    if (animation) {
      transitions.add(animation);
      void animation.finished.then(() => transitions.delete(animation), () => transitions.delete(animation));
    }
  };
  const sceneVisibility = new IntersectionObserver((entries) => {
    root.dataset.motionVisible = String(entries[0]?.isIntersecting ?? true);
  });
  sceneVisibility.observe(root);
  const pageVisibility = () => {
    root.dataset.pageHidden = String(document.hidden);
  };
  document.addEventListener("visibilitychange", pageVisibility);
  pageVisibility();
  const hiddenByRoute = /* @__PURE__ */ new Set(), shownByRoute = /* @__PURE__ */ new Set(), focusedRoute = /* @__PURE__ */ new Set();
  const sceneNav = [...root.querySelectorAll(".scene-header nav a")];
  const resetRoute = () => {
    hiddenByRoute.forEach((node) => {
      node.hidden = false;
    });
    hiddenByRoute.clear();
    shownByRoute.forEach((node) => {
      node.hidden = true;
    });
    shownByRoute.clear();
    focusedRoute.forEach((node) => node.classList.remove("scene-route-focus"));
    focusedRoute.clear();
    root.querySelector("[data-sc-route-heading]")?.remove();
    delete root.dataset.sceneRoute;
  };
  sceneNav[0]?.setAttribute("aria-current", "page");
  const navigate = (target) => {
    resetRoute();
    sceneNav.forEach((link) => {
      if (link === target) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
    const isHome = target === sceneNav[0] || target.classList.contains("scene-brand");
    if (isHome) {
      sceneNav[0]?.setAttribute("aria-current", "page");
      root.scrollIntoView({ block: "start", behavior: "auto" });
      reveal(root.querySelector("#scene-main"));
      return;
    }
    const href = target.getAttribute("href"), destination = href ? root.querySelector(href) : null;
    if (!destination) return;
    root.dataset.sceneRoute = "detail";
    let branch = destination;
    while (branch.parentElement && branch !== root) {
      if (branch.hidden) {
        shownByRoute.add(branch);
        branch.hidden = false;
      }
      const parent = branch.parentElement;
      for (const node of parent.children) {
        if (!(node instanceof HTMLElement) || node === branch || node.matches(".scene-header,.scene-footer,.sc-notice")) continue;
        if (!node.hidden) {
          node.hidden = true;
          hiddenByRoute.add(node);
        }
      }
      if (parent !== root) {
        parent.classList.add("scene-route-focus");
        focusedRoute.add(parent);
      }
      branch = parent;
    }
    const heading = document.createElement("div");
    heading.dataset.scRouteHeading = "true";
    heading.className = "scene-route-heading";
    const title = document.createElement("h2");
    title.textContent = target.textContent?.trim() ?? "";
    heading.append(title);
    root.querySelector(".scene-header")?.after(heading);
    root.scrollIntoView({ block: "start", behavior: "auto" });
    reveal(destination);
  };
  const paperTitle = root.dataset.paperOriginalTitle ?? root.querySelector(".paper-page h1")?.innerHTML ?? "";
  if (root.dataset.style === "skeuomorphism") root.dataset.paperOriginalTitle = paperTitle;
  const dayHabits = /* @__PURE__ */ new Map();
  let habitDay = 0;
  const click = (event) => {
    const target = event.target instanceof Element ? event.target.closest("button,a") : null;
    if (!target || !root.contains(target)) return;
    if (target.hasAttribute("data-sc-toggle")) {
      const selected = target.getAttribute("aria-pressed") !== "true";
      target.setAttribute("aria-pressed", String(selected));
      if (root.dataset.style === "material") filterCommunity();
      if (root.dataset.style === "soft") {
        root.dataset.evening = String(selected);
        const phase = root.querySelector("[data-sc-breath-phase]");
        if (phase) phase.textContent = english ? selected ? "Let the day settle." : "Find your rhythm" : selected ? "\u8BA9\u4ECA\u5929\uFF0C\u6162\u6162\u6C89\u9759\u4E0B\u6765\u3002" : "\u627E\u5230\u81EA\u5DF1\u7684\u8282\u594F";
      }
      if (root.dataset.style === "neumorphism") {
        const panel = root.querySelector("[data-sc-neu-settings]");
        if (panel) {
          panel.hidden = !selected;
          target.setAttribute("aria-expanded", String(selected));
          reveal(panel);
        }
      }
    }
    if (target.hasAttribute("data-sc-directory-topic")) {
      const view = root.querySelector('[data-sc-view="0"]');
      view?.click();
      root.querySelector(`[data-sc-topic="${target.dataset.scDirectoryTopic}"]`)?.click();
      return;
    }
    if (target.hasAttribute("data-sc-topic")) {
      mark("[data-sc-topic]", target);
      if (root.dataset.style === "material") {
        filterCommunity();
        reveal(root.querySelector(".material-discussions"));
      }
      if (root.dataset.style === "soft") {
        const prompt = root.querySelector(".soft-journal label>span");
        if (prompt) prompt.textContent = (english ? ["What helped you feel calm?", "What would help you rest?", "What are you looking forward to?"] : ["\u662F\u4EC0\u4E48\uFF0C\u8BA9\u4F60\u611F\u5230\u5E73\u9759\uFF1F", "\u4EC0\u4E48\u80FD\u8BA9\u4F60\u4F11\u606F\u4E00\u4E0B\uFF1F", "\u6B64\u523B\uFF0C\u4F60\u5728\u671F\u5F85\u4EC0\u4E48\uFF1F"])[Number(target.dataset.scTopic)] ?? "";
        reveal(root.querySelector(".soft-journal label"));
      }
    }
    if (target.hasAttribute("data-sc-view")) {
      mark("[data-sc-view]", target);
      if (root.dataset.style === "material") {
        filterCommunity();
        const directory = root.querySelector("[data-sc-topic-directory]"), posts = root.querySelector(".material-discussions");
        if (directory) directory.hidden = target.dataset.scView !== "1";
        if (posts) posts.hidden = target.dataset.scView === "1";
        root.querySelectorAll(".material-feed>.scene-tabs,.material-compose-hint").forEach((node) => {
          node.hidden = target.dataset.scView === "1";
        });
        reveal(target.dataset.scView === "1" ? directory : posts);
      }
      if (root.dataset.style === "skeuomorphism") {
        const index = target.dataset.scView, heading = root.querySelector(".paper-page h1");
        root.querySelectorAll(".paper-page>.scene-eyebrow,.paper-page>.scene-checklist").forEach((node) => {
          node.hidden = index !== "0";
        });
        const writing = root.querySelector(".paper-writing"), ideas = root.querySelector("[data-sc-paper-ideas]");
        if (writing) writing.hidden = index === "2";
        if (ideas) ideas.hidden = index !== "2";
        const stamp = root.querySelector(".paper-save-stamp");
        if (stamp) stamp.hidden = index === "2";
        if (heading) {
          heading.hidden = index === "2";
          if (index === "0") heading.innerHTML = paperTitle;
          else heading.textContent = english ? "Notes, worth keeping." : "\u628A\u6B64\u523B\uFF0C\u7559\u5728\u7EB8\u4E0A\u3002";
        }
        reveal(root.querySelector(".paper-page"));
      }
      if (root.dataset.style === "neumorphism") {
        const presets = [[50, 50, 50, 50, 50, 50, 50], [68, 73, 64, 55, 46, 42, 38], [40, 45, 66, 78, 72, 53, 45]];
        root.querySelectorAll(".neu-eq-bars input").forEach((input2, index) => {
          input2.value = String(presets[Number(target.dataset.scView)]?.[index] ?? 50);
        });
      }
      if (root.dataset.style === "business") {
        const index = target.dataset.scView ?? "0";
        const heading = root.querySelector("h1");
        if (heading) heading.textContent = target.textContent?.trim() ?? "";
        root.querySelectorAll(".business-summary,.business-toolbar,.business-table,.business-bottom").forEach((node) => {
          node.hidden = node.classList.contains("business-summary") ? index !== "0" : index !== "1";
        });
        root.querySelectorAll("[data-sc-business-panel]").forEach((panel) => {
          panel.hidden = panel.dataset.scBusinessPanel !== index;
        });
        reveal(root.querySelector(".business-main"));
      }
    }
    if (target.hasAttribute("data-sc-status")) {
      mark("[data-sc-status]", target);
      workStatus = target.dataset.scStatus;
      filterWork();
    }
    if (target.hasAttribute("data-sc-programme")) {
      mark("[data-sc-programme]", target);
      const group = ["ALL", "TALKS", "LIVE"][Number(target.dataset.scProgramme)];
      root.querySelectorAll("[data-sc-programme-item]").forEach((row) => {
        row.hidden = group !== "ALL" && row.dataset.scProgrammeItem !== group;
      });
    }
    if (target.hasAttribute("data-sc-lesson")) {
      if (root.dataset.sceneRoute) {
        resetRoute();
        sceneNav.forEach((link, i) => {
          if (i === 0) link.setAttribute("aria-current", "page");
          else link.removeAttribute("aria-current");
        });
      }
      mark("[data-sc-lesson]", target);
      const index = Number(target.dataset.scLesson), feature = root.querySelector(".learning-feature");
      const title = feature?.querySelector("h2");
      if (title) title.textContent = target.querySelector("strong")?.textContent ?? "";
      const descriptions = english ? ["Discover familiar objects from new angles through light, shadow and perspective.", "Build a personal palette by exploring warm, cool and complementary colours.", "Turn a circle, a line and a little imagination into something new.", "Bring shape, colour and composition together in your own poster."] : ["\u7528\u5149\u5F71\u548C\u900F\u89C6\uFF0C\u53D1\u73B0\u65E5\u5E38\u7269\u4EF6\u4E0D\u4E00\u6837\u7684\u4E00\u9762\u3002", "\u63A2\u7D22\u51B7\u6696\u4E0E\u4E92\u8865\u8272\uFF0C\u642D\u914D\u5C5E\u4E8E\u4F60\u81EA\u5DF1\u7684\u914D\u8272\u3002", "\u4E00\u4E2A\u5706\u3001\u4E00\u6761\u7EBF\uFF0C\u52A0\u4E0A\u4E00\u70B9\u60F3\u8C61\uFF0C\u4F1A\u53D8\u6210\u4EC0\u4E48\uFF1F", "\u5C06\u5F62\u72B6\u3001\u8272\u5F69\u4E0E\u6784\u56FE\u7EC4\u5408\uFF0C\u5B8C\u6210\u4F60\u7684\u7B2C\u4E00\u5F20\u521B\u610F\u6D77\u62A5\u3002"];
      const challenges = english ? ["Draw the same cup from three different viewpoints.", "Choose three colours and use them to express a mood.", "Draw an object using three geometric shapes.", "Design a poster using your favourite shapes and colours."] : ["\u6311\u6218\uFF1A\u4ECE\u4E09\u4E2A\u4E0D\u540C\u89D2\u5EA6\u753B\u51FA\u540C\u4E00\u4E2A\u676F\u5B50\u3002", "\u6311\u6218\uFF1A\u9009\u62E9\u4E09\u79CD\u989C\u8272\uFF0C\u8868\u8FBE\u4F60\u6B64\u523B\u7684\u5FC3\u60C5\u3002", "\u6311\u6218\uFF1A\u7528\u4E09\u4E2A\u51E0\u4F55\u5F62\u72B6\u753B\u4E00\u4EF6\u7269\u54C1\u3002", "\u6311\u6218\uFF1A\u7528\u559C\u6B22\u7684\u5F62\u72B6\u548C\u8272\u5F69\uFF0C\u8BBE\u8BA1\u4E00\u5F20\u6D77\u62A5\u3002"];
      const description = feature?.querySelector(":scope>p"), eyebrow = feature?.querySelector(":scope>.scene-eyebrow");
      if (description) description.textContent = descriptions[index] ?? "";
      if (eyebrow) eyebrow.textContent = `LESSON 0${index + 1} / ${[8, 12, 15, 20][index]} MIN`;
      if (feature) feature.dataset.lesson = String(index);
      const detail = feature?.querySelector(".sc-post-detail");
      if (detail) {
        detail.hidden = true;
        const p = detail.querySelector("p");
        if (p) p.textContent = challenges[index] ?? "";
      }
      feature?.querySelector("[data-sc-expand]")?.setAttribute("aria-expanded", "false");
      feature?.scrollIntoView({ block: "nearest", behavior: reducedMotion() ? "auto" : "smooth" });
      reveal(feature ?? null);
    }
    if (target.hasAttribute("data-sc-mission-tab")) {
      mark("[data-sc-mission-tab]", target);
      const index = target.dataset.scMissionTab ?? "0";
      root.dataset.missionView = index;
      root.querySelectorAll("[data-sc-mission-panel]").forEach((panel) => {
        panel.hidden = panel.dataset.scMissionPanel !== index;
      });
      const log = root.querySelector(".mission-log");
      if (log) log.hidden = index !== "0";
      reveal(root.querySelector(`[data-sc-mission-panel="${index}"]`));
    }
    if (target.hasAttribute("data-sc-previous") || target.hasAttribute("data-sc-next")) {
      const tracks = [...root.querySelectorAll("[data-sc-track]")];
      const current = tracks.findIndex((track) => track.getAttribute("aria-pressed") === "true");
      if (tracks.length) tracks[(current + (target.hasAttribute("data-sc-next") ? 1 : -1) + tracks.length) % tracks.length]?.click();
      else say("Track changed in this audio-control study.", "\u5DF2\u5728\u97F3\u9891\u63A7\u5236\u793A\u4F8B\u4E2D\u5207\u6362\u66F2\u76EE");
    }
    if (target.hasAttribute("data-sc-breath")) {
      clearInterval(breathingTimer);
      const running = target.getAttribute("aria-pressed") !== "true";
      target.setAttribute("aria-pressed", String(running));
      root.dataset.breathing = String(running);
      const label = root.querySelector("[data-sc-breath-label]"), phase = root.querySelector("[data-sc-breath-phase]"), clock = root.querySelector("[data-breath-clock]"), progress = root.querySelector("[data-breath-progress]");
      if (running) {
        if (breathElapsed >= duration * 60) breathElapsed = 0;
        breathStarted = Date.now() - breathElapsed * 1e3;
        if (label) label.textContent = english ? "Pause practice" : "\u6682\u505C\u7EC3\u4E60";
        const tick = () => {
          breathElapsed = Math.floor((Date.now() - breathStarted) / 1e3);
          root.dataset.breathElapsed = String(breathElapsed);
          const left = Math.max(0, duration * 60 - breathElapsed);
          if (clock) clock.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
          if (progress) progress.style.width = `${Math.min(100, breathElapsed / (duration * 60) * 100)}%`;
          if (!left) {
            clearInterval(breathingTimer);
            root.dataset.breathing = "false";
            target.setAttribute("aria-pressed", "false");
            if (label) label.textContent = english ? "Practice again" : "\u518D\u7EC3\u4E60\u4E00\u6B21";
            if (phase) phase.textContent = english ? "A moment, just for you." : "\u8C22\u8C22\u4F60\uFF0C\u7559\u7ED9\u81EA\u5DF1\u8FD9\u4E00\u523B\u3002";
            return;
          }
          if (phase) phase.textContent = english ? Math.floor(breathElapsed / 4) % 2 ? "Breathe out" : "Breathe in" : Math.floor(breathElapsed / 4) % 2 ? "\u7F13\u7F13\u547C\u6C14" : "\u6162\u6162\u5438\u6C14";
        };
        tick();
        breathingTimer = setInterval(tick, 1e3);
      } else {
        if (label) label.textContent = english ? "Continue practice" : "\u7EE7\u7EED\u547C\u5438";
        if (phase) phase.textContent = english ? "Paused. Continue at your own pace." : "\u5DF2\u6682\u505C\uFF0C\u6309\u81EA\u5DF1\u7684\u8282\u594F\u7EE7\u7EED\u3002";
      }
    }
    if (target.hasAttribute("data-gx-workspace")) workspace(target.dataset.gxWorkspace);
    if (target.hasAttribute("data-gx-date")) {
      root.querySelectorAll("[data-gx-date]").forEach((button2) => button2.setAttribute("aria-pressed", String(button2 === target)));
      workspace("calendar");
      const day = target.textContent?.trim() ?? "24", title = root.querySelector('[data-gx-panel="calendar"]>.gx-eyebrow');
      if (title) title.textContent = english ? `OCTOBER ${day} / SCHEDULE` : `10\u6708${day}\u65E5 / \u65E5\u7A0B\u5B89\u6392`;
    }
    if (target.hasAttribute("data-gx-file")) say("File selected in this preview.", "\u5DF2\u5728\u9884\u89C8\u4E2D\u9009\u4E2D\u6587\u4EF6");
    if (target.hasAttribute("data-gx-more")) {
      workspace("about");
      target.setAttribute("aria-expanded", "true");
    }
    if (target.hasAttribute("data-gx-add-task")) {
      workspace("overview");
      const existing = root.querySelector("[data-gx-task-input]");
      if (existing) {
        existing.focus();
        return;
      }
      const form2 = document.createElement("form");
      form2.className = "gx-task-entry";
      form2.dataset.gxTaskForm = "true";
      const input2 = document.createElement("input");
      input2.dataset.gxTaskInput = "true";
      input2.required = true;
      input2.placeholder = english ? "One thing to do\u2026" : "\u60F3\u8981\u5B8C\u6210\u7684\u4E00\u4EF6\u4E8B\u2026\u2026";
      input2.setAttribute("aria-label", english ? "New task" : "\u65B0\u4EFB\u52A1");
      const submit2 = document.createElement("button");
      submit2.type = "submit";
      submit2.textContent = english ? "Add" : "\u6DFB\u52A0";
      form2.append(input2, submit2);
      root.querySelector("[data-gx-task-list]")?.after(form2);
      input2.focus();
    }
    if (sceneNav.includes(target) || target.classList.contains("scene-brand")) {
      event.preventDefault();
      navigate(target);
      return;
    }
    if (target.matches('a[href^="#"]')) {
      const destination = root.querySelector(target.getAttribute("href"));
      if (destination) {
        event.preventDefault();
        destination.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion:reduce)").matches ? "auto" : "smooth", block: "start" });
      }
    }
    if (target.hasAttribute("data-sc-add")) {
      cart++;
      const count = root.querySelector("[data-sc-cart-count]");
      if (count) count.textContent = String(cart);
      say("Added to your bag.", "\u5DF2\u52A0\u5165\u8D2D\u7269\u888B");
    }
    if (target.hasAttribute("data-sc-bag")) say(`Your bag contains ${cart} items.`, `\u8D2D\u7269\u888B\u4E2D\u6709 ${cart} \u4EF6\u7269\u54C1`);
    if (target.hasAttribute("data-sc-filter")) {
      root.querySelectorAll("[data-sc-filter]").forEach((button2) => button2.setAttribute("aria-pressed", String(button2 === target)));
      root.querySelectorAll("[data-sc-product]").forEach((product) => {
        product.hidden = target.dataset.scFilter !== "0" && product.dataset.scProduct !== (target.dataset.scFilter === "1" ? "Home" : "Carry");
      });
    }
    if (target.hasAttribute("data-sc-play")) {
      const playing = root.dataset.playing !== "true";
      root.dataset.playing = String(playing);
      root.querySelectorAll("[data-sc-play]").forEach((button2) => button2.setAttribute("aria-pressed", String(playing)));
      if (root.dataset.style === "bento") {
        clearInterval(focusTimer);
        const label = root.querySelector(".dayboard-focus [data-sc-play]>span:last-child"), output = root.querySelector(".dayboard-focus>small");
        if (label) label.textContent = english ? playing ? "Pause focus" : "Begin focus" : playing ? "\u6682\u505C\u4E13\u6CE8" : "\u5F00\u59CB\u4E13\u6CE8";
        if (!playing && focusStarted) {
          focusRemaining = Math.max(0, focusRemaining - Math.floor((Date.now() - focusStarted) / 1e3));
          focusStarted = 0;
        }
        if (playing) {
          if (!focusRemaining) focusRemaining = 1500;
          focusStarted = Date.now();
          const budget = focusRemaining;
          const tick = () => {
            const left = Math.max(0, budget - Math.floor((Date.now() - focusStarted) / 1e3));
            if (output) output.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")} / 25:00`;
            if (!left) {
              clearInterval(focusTimer);
              focusRemaining = 0;
              focusStarted = 0;
              root.dataset.playing = "false";
              target.setAttribute("aria-pressed", "false");
              if (label) label.textContent = english ? "Begin focus" : "\u5F00\u59CB\u4E13\u6CE8";
            }
          };
          tick();
          focusTimer = setInterval(tick, 1e3);
        }
        say(playing ? "Focus session started." : "Focus session paused.", playing ? "\u4E13\u6CE8\u8BA1\u65F6\u5DF2\u5F00\u59CB" : "\u4E13\u6CE8\u8BA1\u65F6\u5DF2\u6682\u505C");
      } else say(playing ? "Player controls started. This sample has no audio." : "Playback paused.", playing ? "\u64AD\u653E\u72B6\u6001\u5DF2\u5F00\u542F\uFF0C\u6B64\u793A\u4F8B\u65E0\u97F3\u9891" : "\u5DF2\u6682\u505C\u64AD\u653E");
    }
    if (target.hasAttribute("data-sc-track")) {
      root.querySelectorAll("[data-sc-track]").forEach((button2) => button2.setAttribute("aria-pressed", String(button2 === target)));
      const name = root.querySelector("[data-sc-now]");
      if (name) name.textContent = target.querySelector("strong")?.childNodes[0]?.textContent ?? "";
    }
    if (target.hasAttribute("data-sc-expand")) {
      const detail = target.closest("article,.edition-feature")?.querySelector(".sc-post-detail");
      if (detail) {
        detail.hidden = !detail.hidden;
        target.setAttribute("aria-expanded", String(!detail.hidden));
      }
    }
    if (target.hasAttribute("data-sc-like")) {
      const liked = target.getAttribute("aria-pressed") !== "true";
      target.setAttribute("aria-pressed", String(liked));
      const count = target.querySelector("span");
      if (count) count.textContent = String(Number(count.textContent) + (liked ? 1 : -1));
    }
    if (target.hasAttribute("data-sc-ritual") || target.hasAttribute("data-sc-hour")) {
      const selector = target.hasAttribute("data-sc-ritual") ? "[data-sc-ritual]" : "[data-sc-hour]";
      root.querySelectorAll(selector).forEach((button2) => button2.setAttribute("aria-pressed", String(button2 === target)));
      if (selector === "[data-sc-hour]" && root.dataset.style === "soft") {
        duration = [2, 5, 10][[...root.querySelectorAll("[data-sc-hour]")].indexOf(target)] ?? 2;
        clearInterval(breathingTimer);
        breathElapsed = 0;
        root.dataset.breathElapsed = "0";
        root.dataset.breathing = "false";
        root.querySelector("[data-sc-breath]")?.setAttribute("aria-pressed", "false");
        const label = root.querySelector("[data-sc-breath-label]"), clock = root.querySelector("[data-breath-clock]"), bar = root.querySelector("[data-breath-progress]"), phase = root.querySelector("[data-sc-breath-phase]");
        if (label) label.textContent = english ? "Begin breathing" : "\u5F00\u59CB\u547C\u5438";
        if (clock) clock.textContent = `${duration}:00`;
        if (bar) bar.style.width = "0%";
        if (phase) phase.textContent = english ? "Find your rhythm" : "\u627E\u5230\u81EA\u5DF1\u7684\u8282\u594F";
      }
      if (selector === "[data-sc-hour]" && root.dataset.style === "bento") {
        const index = [...root.querySelectorAll("[data-sc-hour]")].indexOf(target), agenda = root.querySelector(".dayboard-calendar>p");
        if (agenda) agenda.textContent = (english ? ["10:30 \u2014 Design catch-up", "14:00 \u2014 Prototype review", "09:00 \u2014 Focus time", "16:00 \u2014 Team sharing", "11:00 \u2014 Weekly review", "No plans. A day for yourself.", "A quiet Sunday."] : ["10:30 \u2014 \u8BBE\u8BA1\u78B0\u5934\u4F1A", "14:00 \u2014 \u539F\u578B\u8BC4\u5BA1", "09:00 \u2014 \u5B89\u9759\u521B\u4F5C", "16:00 \u2014 \u56E2\u961F\u5206\u4EAB", "11:00 \u2014 \u672C\u5468\u56DE\u987E", "\u6CA1\u6709\u5B89\u6392\uFF0C\u7559\u7ED9\u81EA\u5DF1\u7684\u4E00\u5929", "\u5B89\u9759\u7684\u661F\u671F\u65E5"])[index] ?? "";
        reveal(root.querySelector(".dayboard-calendar>p"));
      }
      if (selector === "[data-sc-hour]" && root.dataset.style === "claymorphism") {
        const checks = [...root.querySelectorAll("[data-sc-habit]")];
        dayHabits.set(habitDay, checks.map((check) => check.checked));
        habitDay = [...root.querySelectorAll("[data-sc-hour]")].indexOf(target);
        const states = dayHabits.get(habitDay) ?? [false, false, false];
        checks.forEach((check, i) => {
          check.checked = states[i] ?? false;
        });
        const count = states.filter(Boolean).length, output = root.querySelector("[data-sc-habit-count]"), fill = root.querySelector("[data-sc-habit-fill]");
        if (output) output.textContent = String(count);
        if (fill) fill.style.width = `${count / 3 * 100}%`;
        const note = root.querySelector(".clay-habits>p");
        if (note) note.textContent = english ? `October ${26 + habitDay > 31 ? 1 : 26 + habitDay} \xB7 ${count} of 3 habits complete` : `${26 + habitDay > 31 ? "11\u67081" : `10\u6708${26 + habitDay}`}\u65E5 \xB7 \u5DF2\u5B8C\u6210 ${count} / 3 \u4E2A\u4E60\u60EF`;
        reveal(root.querySelector(".clay-habits"));
      }
      if (selector === "[data-sc-ritual]") say("Your session is ready. Take your time.", "\u5DF2\u7ECF\u4E3A\u4F60\u51C6\u5907\u597D\u4E86\uFF0C\u6309\u81EA\u5DF1\u7684\u8282\u594F\u5F00\u59CB");
    }
    if (target.hasAttribute("data-sc-ticket")) say("Your spot is saved in this preview.", "\u6B64\u9884\u89C8\u4E2D\u5DF2\u4E3A\u4F60\u9884\u7559\u5E2D\u4F4D");
    if (target.hasAttribute("data-sc-diagnostic")) {
      clearTimeout(diagnosticTimer);
      root.dataset.diagnosing = "true";
      target.setAttribute("aria-busy", "true");
      diagnosticTimer = setTimeout(() => {
        root.dataset.diagnosing = "false";
        target.removeAttribute("aria-busy");
        const phase = root.querySelector("[data-cyber-scan-phase]");
        if (phase && root.querySelector("[data-cyber-canvas]")?.dataset.motionState === "paused") phase.textContent = english ? "Scan complete" : "\u626B\u63CF\u5B8C\u6210";
        say("Diagnostic complete. All systems nominal.", "\u8BCA\u65AD\u5B8C\u6210\uFF0C\u5404\u7CFB\u7EDF\u8FD0\u884C\u6B63\u5E38");
      }, root.dataset.style === "tech" ? 4500 : 1100);
    }
    if (target.hasAttribute("data-sc-compose")) {
      const current = root.querySelector("[data-sc-draft]");
      if (current) {
        current.focus();
        return;
      }
      const form2 = document.createElement("form");
      form2.className = "sc-subscribe";
      form2.dataset.scComposer = "true";
      const input2 = document.createElement("input");
      input2.dataset.scDraft = "true";
      input2.required = true;
      input2.placeholder = english ? "Write a title\u2026" : "\u5199\u4E00\u4E2A\u6807\u9898\u2026\u2026";
      input2.setAttribute("aria-label", english ? "Title" : "\u6807\u9898");
      const submit2 = document.createElement("button");
      submit2.type = "submit";
      submit2.className = "sc-button";
      submit2.textContent = english ? "Add" : "\u6DFB\u52A0";
      form2.append(input2, submit2);
      target.closest("section,header")?.after(form2);
      input2.focus();
    }
    if (target.hasAttribute("data-sc-pause")) {
      const paused = root.dataset.paused !== "true";
      root.dataset.paused = String(paused);
      target.setAttribute("aria-pressed", String(paused));
      target.textContent = english ? paused ? "Play motion" : "Pause motion" : paused ? "\u64AD\u653E\u52A8\u6548" : "\u6682\u505C\u52A8\u6548";
    }
  };
  const submit = (event) => {
    const form2 = event.target;
    if (!(form2 instanceof HTMLFormElement) || !root.contains(form2)) return;
    event.preventDefault();
    if (!form2.reportValidity()) return;
    if (form2.hasAttribute("data-gx-task-form")) {
      const input2 = form2.querySelector("[data-gx-task-input]");
      if (input2?.value.trim()) {
        const label = document.createElement("label");
        label.className = "gx-task";
        const check = document.createElement("input");
        check.type = "checkbox";
        const text = document.createElement("span");
        text.textContent = input2.value.trim();
        label.append(check, text);
        root.querySelector("[data-gx-task-list]")?.append(label);
        input2.value = "";
        input2.focus();
        say("Task added.", "\u4EFB\u52A1\u5DF2\u6DFB\u52A0");
      }
      return;
    }
    if (form2.hasAttribute("data-sc-composer")) {
      const draft = form2.querySelector("[data-sc-draft]");
      if (draft?.value.trim()) {
        const title = draft.value.trim();
        if (root.dataset.style === "material") {
          const item = root.querySelector(".material-post").cloneNode(true);
          item.querySelector("h2").textContent = title;
          item.querySelector("header strong").textContent = english ? "You" : "\u4F60";
          item.querySelector(".scene-avatar").textContent = "J";
          item.querySelectorAll("[aria-pressed]").forEach((button2) => button2.setAttribute("aria-pressed", "false"));
          item.querySelector("[data-sc-like] span").textContent = "0";
          root.querySelector(".material-discussions").prepend(item);
          root.querySelectorAll("[data-sc-view]").forEach((button2) => button2.setAttribute("aria-pressed", String(button2.getAttribute("data-sc-view") === "0")));
          filterCommunity();
        } else if (root.dataset.style === "business") {
          const item = root.querySelector("[data-sc-work-item]").cloneNode(true);
          item.querySelector("strong").textContent = title;
          item.querySelector("input").checked = false;
          item.querySelector(".business-owner").textContent = english ? "You" : "\u4F60";
          item.querySelector("span:last-child").textContent = english ? "UNSCHEDULED" : "\u5F85\u6392\u671F";
          root.querySelector(".business-table").append(item);
          filterWork();
        } else if (root.dataset.style === "bento") {
          const label = document.createElement("label"), check = document.createElement("input"), text = document.createElement("span");
          check.type = "checkbox";
          text.textContent = title;
          label.append(check, text);
          root.querySelector(".dayboard-tasks .scene-checklist").append(label);
          const count = root.querySelector(".dayboard-tasks .scene-section-title small");
          if (count) count.textContent = String(root.querySelectorAll(".dayboard-tasks input").length).padStart(2, "0");
        } else {
          const item = document.createElement("p");
          item.className = "sc-task";
          item.textContent = title;
          form2.after(item);
        }
        draft.value = "";
        say("Added to this preview.", "\u5DF2\u6DFB\u52A0\u5230\u5F53\u524D\u9884\u89C8");
      }
    } else {
      say("You are on the list. This preview sends no email.", "\u8BA2\u9605\u6210\u529F\uFF0C\u6B64\u9884\u89C8\u4E0D\u4F1A\u53D1\u9001\u90AE\u4EF6");
    }
  };
  const input = (event) => {
    const node = event.target;
    if (!(node instanceof HTMLInputElement)) return;
    if (node.hasAttribute("data-sc-search")) {
      workQuery = node.value.toLocaleLowerCase();
      filterWork();
    }
    if (node.type === "range") {
      const output = node.closest("label")?.querySelector("output");
      if (output) output.textContent = `${node.value}%`;
      if (node.hasAttribute("data-sc-volume-range")) {
        root.style.setProperty("--audio-volume", node.value);
        const volume = root.querySelector("[data-sc-volume]");
        if (volume) volume.textContent = node.value;
      }
    }
    if (node.hasAttribute("data-sc-habit")) {
      reveal(root.querySelector(".clay-flower"));
      const count = root.querySelectorAll("[data-sc-habit]:checked").length, total = root.querySelectorAll("[data-sc-habit]").length;
      const output = root.querySelector("[data-sc-habit-count]"), fill = root.querySelector("[data-sc-habit-fill]");
      if (output) output.textContent = String(count);
      if (fill) fill.style.width = `${count / total * 100}%`;
    }
  };
  if (root.dataset.style === "soft") {
    const clock = root.querySelector("[data-breath-clock]");
    const left = Math.max(0, duration * 60 - breathElapsed);
    if (clock) clock.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
  }
  root.addEventListener("click", click);
  root.addEventListener("submit", submit);
  root.addEventListener("input", input);
  return () => {
    root.removeEventListener("click", click);
    root.removeEventListener("submit", submit);
    root.removeEventListener("input", input);
    if (root.dataset.style === "bento") {
      if (focusStarted) focusRemaining = Math.max(0, focusRemaining - Math.floor((Date.now() - focusStarted) / 1e3));
      root.dataset.focusRemaining = String(focusRemaining);
      root.dataset.playing = "false";
      root.querySelector("[data-sc-play]")?.setAttribute("aria-pressed", "false");
      const label = root.querySelector(".dayboard-focus [data-sc-play]>span:last-child");
      if (label) label.textContent = english ? "Continue focus" : "\u7EE7\u7EED\u4E13\u6CE8";
    }
    if (root.dataset.style === "soft") {
      root.dataset.breathing = "false";
      root.querySelector("[data-sc-breath]")?.setAttribute("aria-pressed", "false");
      const label = root.querySelector("[data-sc-breath-label]");
      if (label && breathElapsed > 0) label.textContent = english ? "Continue practice" : "\u7EE7\u7EED\u547C\u5438";
    }
    clearInterval(breathingTimer);
    clearInterval(focusTimer);
    clearTimeout(noticeTimer);
    clearTimeout(diagnosticTimer);
    transitions.forEach((animation) => animation.cancel());
    sceneVisibility.disconnect();
    document.removeEventListener("visibilitychange", pageVisibility);
    resetRoute();
    sceneNav.forEach((link) => link.removeAttribute("aria-current"));
  };
})(scene, english); if(scene.dataset.style==='tech') (function mountCyberpunkMotion(root, english = false, coastlines) {
  const targetCanvas = root.querySelector("[data-cyber-canvas]");
  if (!targetCanvas) return () => {
  };
  const canvas = targetCanvas;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) return () => {
  };
  const ctx = context;
  const holder = canvas.parentElement, holographic = root.dataset.effect === "standard";
  const reduced = matchMedia("(prefers-reduced-motion:reduce)");
  let width = 0, height = 0, dpr = 1, raf = 0, last = 0, time = 0, visible = true, scanAt = -100, selected = Number(root.querySelector('[data-cyber-node][aria-pressed="true"]')?.dataset.cyberNode) || 0, pointerX = 0, pointerY = 0, disposed = false, userPaused = root.dataset.cyberPaused === "true", yawBase = selected ? -[139.7, 103.8, 8.7, -74, 151.2][selected] * Math.PI / 180 + 0.1 : -1.85, currentYaw = yawBase;
  const globePoints = [];
  const inside = (x, y, polygon) => {
    let yes = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const a = polygon[i], b = polygon[j];
      if (a[1] > y !== b[1] > y && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) yes = !yes;
    }
    return yes;
  };
  const vector = (lon, lat) => {
    const a = lon * Math.PI / 180, b = lat * Math.PI / 180;
    return [Math.cos(b) * Math.sin(a), -Math.sin(b), Math.cos(b) * Math.cos(a)];
  };
  for (let lat = -60; lat < 78; lat += 3.2) for (let lon = -180; lon < 180; lon += 3.2) if (coastlines.some((p) => inside(lon, lat, p))) globePoints.push(vector(lon, lat));
  const nodes = [[139.7, 35.7], [103.8, 1.3], [8.7, 50.1], [-74, 40.7], [151.2, -33.9]].map(([lon, lat]) => vector(lon, lat));
  const labels = ["TOKYO / 07", "SINGAPORE / 03", "FRANKFURT / 02", "NEW YORK / 04", "SYDNEY / 08"];
  const stars = Array.from({ length: 58 }, (_, i) => ({ x: i * 71.37 % 997 / 997, y: i * 37.91 % 991 / 991, a: 0.1 + i % 5 * 0.06 }));
  const grid = [];
  for (let lat = -60; lat <= 60; lat += 20) grid.push(Array.from({ length: 73 }, (_, i) => vector(-180 + i * 5, lat)));
  for (let lon = -180; lon < 180; lon += 30) grid.push(Array.from({ length: 37 }, (_, i) => vector(lon, -90 + i * 5)));
  const resize = () => {
    const box = holder.getBoundingClientRect();
    width = box.width;
    height = box.height;
    dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.max(1, Math.round(height * dpr));
    if (reduced.matches) draw(time);
  };
  const observer = new ResizeObserver(resize);
  observer.observe(holder);
  const intersection = new IntersectionObserver((entries) => {
    visible = entries[0]?.isIntersecting ?? true;
    sync();
  });
  intersection.observe(holder);
  const frameText = (text, x, y, size = 8, alpha = 0.65) => {
    ctx.globalAlpha = alpha;
    ctx.font = `${size}px ui-monospace,monospace`;
    ctx.fillStyle = "#8de9ef";
    ctx.fillText(text, x, y);
    ctx.globalAlpha = 1;
  };
  function draw(t) {
    if (width < 1 || height < 1) return;
    const sx = width / 640, sy = height / 440, scale = Math.min(sx, sy), ox = (width - 640 * scale) / 2, oy = (height - 440 * scale) / 2;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = holographic ? "#020d12" : "#03090d";
    ctx.fillRect(0, 0, width, height);
    ctx.translate(ox, oy);
    ctx.scale(scale, scale);
    const cx = 320 + pointerX * 5, cy = 215 + pointerY * 3, r = holographic ? 145 : 132;
    const targetYaw = yawBase + t * (holographic ? 0.075 : 0.045);
    currentYaw = reduced.matches || userPaused ? targetYaw : currentYaw + (targetYaw - currentYaw) * 0.055;
    const yaw = currentYaw, tilt = holographic ? -0.18 : -0.07;
    const project = (v, lift = 1) => {
      const a = v[0] * Math.cos(yaw) + v[2] * Math.sin(yaw), z = -v[0] * Math.sin(yaw) + v[2] * Math.cos(yaw), b = v[1] * Math.cos(tilt) - z * Math.sin(tilt), depth = v[1] * Math.sin(tilt) + z * Math.cos(tilt);
      return { x: cx + a * r * lift, y: cy + b * r * lift, z: depth };
    };
    for (const star of stars) {
      ctx.globalAlpha = star.a * (0.7 + 0.3 * Math.sin(t * 0.7 + star.x * 10));
      ctx.fillStyle = "#b8f9ff";
      ctx.fillRect(star.x * 640, star.y * 440, 1, 1);
    }
    ctx.globalAlpha = 1;
    if (!holographic) {
      ctx.strokeStyle = "#1b5b6440";
      ctx.lineWidth = 0.55;
      for (let n = -7; n <= 7; n++) {
        ctx.beginPath();
        ctx.moveTo(cx + n * 23, cy + 84);
        ctx.lineTo(cx + n * 100, 437);
        ctx.stroke();
      }
      for (let n = 0; n < 9; n++) {
        const y = cy + 85 + Math.pow((n + t * 0.14) % 9 / 9, 2) * 137;
        ctx.beginPath();
        ctx.moveTo(55, y);
        ctx.lineTo(585, y);
        ctx.stroke();
      }
    }
    const halo = ctx.createRadialGradient(cx, cy, r * 0.6, cx, cy, r * 1.65);
    halo.addColorStop(0, holographic ? "#24e9ec16" : "#02cbd50a");
    halo.addColorStop(1, "#00c9d500");
    ctx.fillStyle = halo;
    ctx.fillRect(cx - r * 1.7, cy - r * 1.7, r * 3.4, r * 3.4);
    const body = ctx.createRadialGradient(cx - r * 0.4, cy - r * 0.4, 5, cx, cy, r);
    body.addColorStop(0, holographic ? "#126673" : "#071d28");
    body.addColorStop(0.66, holographic ? "#073440" : "#04121c");
    body.addColorStop(1, holographic ? "#082732" : "#02080d");
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    for (const line of grid) {
      ctx.beginPath();
      let started = false;
      for (const v of line) {
        const p = project(v);
        if (p.z > -0.02) {
          if (!started) ctx.moveTo(p.x, p.y);
          else ctx.lineTo(p.x, p.y);
          started = true;
        } else started = false;
      }
      ctx.strokeStyle = holographic ? "#53cfd636" : "#24e6ef65";
      ctx.lineWidth = 0.55;
      ctx.stroke();
    }
    if (holographic) {
      for (const v of globePoints) {
        const p = project(v, 1.003);
        if (p.z < 0) continue;
        ctx.globalAlpha = 0.25 + p.z * 0.65;
        ctx.fillStyle = "#89ffff";
        ctx.fillRect(p.x, p.y, 1.4, 1.4);
      }
      ctx.globalAlpha = 1;
    } else for (const coast of coastlines) {
      ctx.beginPath();
      let started = false;
      for (let i = 0; i <= coast.length; i++) {
        const pair = coast[i % coast.length], p = project(vector(pair[0], pair[1]));
        if (p.z > 0) {
          if (!started) ctx.moveTo(p.x, p.y);
          else ctx.lineTo(p.x, p.y);
          started = true;
        } else started = false;
      }
      ctx.strokeStyle = "#53f8ee";
      ctx.shadowColor = "#02f3ed";
      ctx.shadowBlur = 5;
      ctx.lineWidth = 0.9;
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
    ctx.strokeStyle = holographic ? "#83ffff99" : "#39f6fccc";
    ctx.lineWidth = 1;
    ctx.shadowColor = "#2af4ed";
    ctx.shadowBlur = holographic ? 13 : 5;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.shadowBlur = 0;
    for (let i = 0; i < 96; i++) {
      const a = i * Math.PI / 48, rr = r + 21, end = rr + (i % 8 === 0 ? 9 : 3);
      ctx.strokeStyle = i % 8 === 0 ? "#93f4f3aa" : "#4dc2ce45";
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      ctx.moveTo(cx + Math.sin(a) * rr, cy + Math.cos(a) * rr);
      ctx.lineTo(cx + Math.sin(a) * end, cy + Math.cos(a) * end);
      ctx.stroke();
    }
    for (let i = 0; i < 3; i++) {
      ctx.strokeStyle = i === 1 ? "#6bfdf370" : "#4dcedb40";
      ctx.lineWidth = i === 1 ? 2 : 0.6;
      ctx.beginPath();
      ctx.arc(cx, cy, r + 13 + i * 10, t * (i % 2 ? -0.12 : 0.08) + i * 2, t * (i % 2 ? -0.12 : 0.08) + i * 2 + 1.05);
      ctx.stroke();
    }
    if (holographic) {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(-0.32);
      for (let i = 0; i < 2; i++) {
        ctx.beginPath();
        ctx.ellipse(0, 0, r + 47 + i * 12, 36 + i * 12, 0, t * 0.1 + i * Math.PI, t * 0.1 + i * Math.PI + Math.PI * 1.7);
        ctx.strokeStyle = i ? "#62f3f84a" : "#a4fffd9c";
        ctx.lineWidth = i ? 0.6 : 1.1;
        ctx.stroke();
      }
      ctx.restore();
    }
    const scanY = cy - r + t * (holographic ? 18 : 27) % (r * 2);
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();
    const scan = ctx.createLinearGradient(0, scanY - 28, 0, scanY + 2);
    scan.addColorStop(0, "#1ff5ef00");
    scan.addColorStop(1, holographic ? "#65ffff40" : "#38f7ff18");
    ctx.fillStyle = scan;
    ctx.fillRect(cx - r, scanY - 28, r * 2, 30);
    ctx.strokeStyle = "#aaffff80";
    ctx.beginPath();
    ctx.moveTo(cx - r, scanY);
    ctx.lineTo(cx + r, scanY);
    ctx.stroke();
    ctx.restore();
    const origin = project(nodes[selected]);
    nodes.forEach((node, i) => {
      const p = project(node);
      if (p.z < 0) return;
      const pulse = (t * 0.65 + i * 0.19) % 1;
      ctx.strokeStyle = `rgba(91,255,245,${(1 - pulse) * 0.6})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4 + pulse * 15, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = i === selected ? "#efffff" : "#4bfff1";
      ctx.shadowColor = "#35fff2";
      ctx.shadowBlur = i === selected ? 13 : 6;
      ctx.beginPath();
      ctx.arc(p.x, p.y, i === selected ? 3.5 : 2.1, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      if (origin.z > 0 && i !== selected) {
        const controlX = (origin.x + p.x) / 2, controlY = Math.min(origin.y, p.y) - 40;
        ctx.strokeStyle = "#4ff5ed45";
        ctx.lineWidth = 0.7;
        ctx.beginPath();
        ctx.moveTo(origin.x, origin.y);
        ctx.quadraticCurveTo(controlX, controlY, p.x, p.y);
        ctx.stroke();
        const f = (t * 0.22 + i * 0.2) % 1, x = (1 - f) ** 2 * origin.x + 2 * (1 - f) * f * controlX + f * f * p.x, y = (1 - f) ** 2 * origin.y + 2 * (1 - f) * f * controlY + f * f * p.y;
        ctx.fillStyle = "#b6ffff";
        ctx.beginPath();
        ctx.arc(x, y, 1.8, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    if (origin.z > 0) {
      ctx.strokeStyle = "#83efeb90";
      ctx.setLineDash([2, 4]);
      ctx.beginPath();
      ctx.moveTo(origin.x, origin.y);
      ctx.lineTo(origin.x + 28, origin.y - 25);
      ctx.lineTo(Math.min(585, origin.x + 110), origin.y - 25);
      ctx.stroke();
      ctx.setLineDash([]);
      frameText(labels[selected], Math.min(495, origin.x + 34), origin.y - 33, 8, 0.9);
    }
    const age = performance.now() / 1e3 - scanAt;
    if (age >= 0 && age < 4.5) {
      const f = age / 4.5;
      ctx.strokeStyle = `rgba(155,255,251,${1 - f})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, 10 + f * r * 1.6, 0, Math.PI * 2);
      ctx.stroke();
      if (age > 2.3) {
        ctx.strokeStyle = "#d9ffff";
        const target = origin.z > 0 ? origin : { x: cx, y: cy };
        const rr = 14 + Math.max(0, 4 - age) * 6;
        ctx.strokeRect(target.x - rr, target.y - rr, rr * 2, rr * 2);
        frameText("SIGNAL LOCKED", cx - 40, cy + r + 48, 9, 0.9);
      }
    }
    ctx.strokeStyle = "#77d9db55";
    ctx.lineWidth = 0.7;
    for (const [x, y, dx, dy] of [[26, 38, 19, 19], [614, 38, -19, 19], [26, 402, 19, -19], [614, 402, -19, -19]]) {
      ctx.beginPath();
      ctx.moveTo(x, y + dy);
      ctx.lineTo(x, y);
      ctx.lineTo(x + dx, y);
      ctx.stroke();
    }
    frameText(holographic ? "VOLUMETRIC / HOLOGRAPHIC PROJECTION" : "NEON / VECTOR SIGNAL MESH", 29, 26, 8, 0.8);
    frameText("NXS \xB7 LIVE SIMULATION", 430, 26, 7, 0.5);
    frameText("GLOBAL RELAY / ENCRYPTED", 29, 425, 7, 0.6);
    frameText(`${String(Math.floor(t / 60)).padStart(2, "0")}:${String(Math.floor(t) % 60).padStart(2, "0")} / TRACKING`, 470, 425, 7, 0.65);
    const phase = root.querySelector("[data-cyber-scan-phase]");
    if (phase) {
      const label = age < 0 || age >= 4.5 ? english ? "LINK ESTABLISHED" : "\u94FE\u8DEF\u5DF2\u8FDE\u63A5" : age < 1.4 ? english ? "PROBING RELAYS" : "\u6B63\u5728\u63A2\u6D4B\u4E2D\u7EE7" : age < 2.8 ? english ? "TRACING ROUTE" : "\u6B63\u5728\u8FFD\u8E2A\u8DEF\u5F84" : english ? "SIGNAL LOCKED" : "\u4FE1\u53F7\u5DF2\u9501\u5B9A";
      if (phase.textContent !== label) phase.textContent = label;
    }
    const output = root.querySelector("[data-cyber-live-rate]");
    if (output) output.textContent = (1696.1 + Math.sin(t * 0.7) * 24 + Math.sin(t * 1.9) * 6).toFixed(1);
  }
  const tick = (now) => {
    raf = 0;
    if (disposed) return;
    if (!last) last = now;
    const dt = Math.min((now - last) / 1e3, 0.1);
    if (now - last >= 1e3 / 30) {
      time += dt;
      last = now;
      draw(time);
    }
    raf = requestAnimationFrame(tick);
  };
  function sync() {
    cancelAnimationFrame(raf);
    raf = 0;
    last = 0;
    if (disposed) return;
    const running = !document.hidden && visible && root.dataset.paused !== "true" && !reduced.matches && !userPaused;
    canvas.dataset.motionState = running ? "running" : "paused";
    if (running) raf = requestAnimationFrame(tick);
    else draw(time);
  }
  const onClick = (event) => {
    const target = event.target instanceof Element ? event.target.closest("[data-cyber-node],[data-sc-diagnostic],[data-cyber-motion-toggle]") : null;
    if (!target) return;
    if (target.hasAttribute("data-cyber-motion-toggle")) {
      userPaused = !userPaused;
      root.dataset.cyberPaused = String(userPaused);
      target.setAttribute("aria-pressed", String(userPaused));
      target.textContent = english ? userPaused ? "RESUME" : "PAUSE" : userPaused ? "\u7EE7\u7EED" : "\u6682\u505C";
      sync();
      return;
    }
    if (target.hasAttribute("data-cyber-node")) {
      selected = Number(target.dataset.cyberNode) || 0;
      root.querySelectorAll("[data-cyber-node]").forEach((button2) => button2.setAttribute("aria-pressed", String(button2 === target)));
      const name = root.querySelector("[data-cyber-node-title]");
      if (name) name.textContent = labels[selected];
      const latency = [2, 18, 82, 14, 36][selected] ?? 2;
      root.dataset.cyberLatency = String(latency).padStart(2, "0");
      const latencyOutput = root.querySelector(".mission-telemetry>div:nth-child(2)>strong");
      if (latencyOutput?.firstChild) latencyOutput.firstChild.textContent = root.dataset.cyberLatency;
      yawBase = -[139.7, 103.8, 8.7, -74, 151.2][selected] * Math.PI / 180 + 0.1 - time * (holographic ? 0.075 : 0.045);
      scanAt = reduced.matches || userPaused ? -100 : performance.now() / 1e3;
    } else scanAt = performance.now() / 1e3;
    draw(time);
  };
  const pointer = (event) => {
    if (reduced.matches) return;
    const box = holder.getBoundingClientRect();
    pointerX = (event.clientX - box.left) / box.width - 0.5;
    pointerY = (event.clientY - box.top) / box.height - 0.5;
  };
  const leave = () => {
    pointerX = 0;
    pointerY = 0;
  };
  const state = new MutationObserver(sync);
  state.observe(root, { attributes: true, attributeFilter: ["data-paused"] });
  root.addEventListener("click", onClick);
  holder.addEventListener("pointermove", pointer);
  holder.addEventListener("pointerleave", leave);
  document.addEventListener("visibilitychange", sync);
  reduced.addEventListener("change", sync);
  resize();
  sync();
  return () => {
    disposed = true;
    cancelAnimationFrame(raf);
    observer.disconnect();
    intersection.disconnect();
    state.disconnect();
    root.removeEventListener("click", onClick);
    holder.removeEventListener("pointermove", pointer);
    holder.removeEventListener("pointerleave", leave);
    document.removeEventListener("visibilitychange", sync);
    reduced.removeEventListener("change", sync);
  };
})(scene,english,[[[143.18,-11.96],[143.75,-14.35],[145.29,-14.94],[146.38,-18.98],[148.76,-20.29],[149.71,-22.44],[150.67,-22.42],[153.17,-25.96],[153.62,-28.67],[152.95,-31.43],[149.48,-37.77],[147.88,-37.93],[146.4,-39.15],[144.89,-37.9],[143.54,-38.82],[141.43,-38.36],[139.78,-37.25],[139.28,-35.38],[138.19,-35.61],[138.09,-34.17],[136.88,-35.24],[137.78,-32.58],[135.65,-34.94],[134.23,-32.55],[131.14,-31.5],[125.92,-32.3],[123.21,-33.99],[119.85,-33.97],[118.14,-34.99],[116.52,-34.99],[115.01,-34.26],[115.7,-31.7],[113.3,-26.24],[113.83,-26.5],[113.45,-25.6],[114.22,-26.29],[113.42,-24.44],[113.96,-21.94],[114.14,-22.48],[116.71,-20.65],[121,-19.6],[122.35,-18.11],[122.33,-17.06],[122.97,-16.44],[123.56,-17.52],[123.61,-16.22],[124.77,-16.4],[124.44,-15.49],[126.05,-13.98],[127.46,-14.03],[128.07,-15.33],[128.58,-14.77],[129.64,-15.14],[129.38,-14.39],[130.62,-12.43],[132.71,-12.12],[131.96,-11.18],[135.03,-12.19],[135.92,-11.83],[136.08,-12.42],[136.54,-11.96],[136.95,-12.35],[135.45,-14.92],[140.21,-17.7],[141.29,-16.46],[142.46,-10.71],[143.18,-11.96]],[[164.2,-20.25],[167,-22.26],[166.52,-22.25],[164.2,-20.25]],[[127.73,0.85],[128.69,1.57],[128.26,0.73],[128.9,0.22],[127.89,0.3],[128.43,-0.89],[127.43,1.14],[128.04,2.2],[127.73,0.85]],[[69.18,-49.11],[70.48,-49.08],[69.75,-49.45],[70.22,-49.63],[68.82,-49.7],[69,-48.66],[69.18,-49.11]],[[-25.43,70.92],[-28,70.47],[-25.43,70.92]],[[117.31,8.44],[119.53,11.1],[119.69,10.5],[117.31,8.44]],[[122.5,11.61],[123.12,11.29],[122.05,10.51],[121.92,11.85],[122.5,11.61]],[[123.13,9.06],[122.41,9.69],[122.97,10.84],[123.57,10.78],[123.13,9.06]],[[125.24,12.53],[125.43,11.11],[124.29,12.57],[125.24,12.53]],[[120.7,13.48],[121.54,13.09],[121.15,12.24],[120.7,13.48]],[[155.96,-6.69],[154.71,-5.75],[155.96,-6.69]],[[152.97,-4.76],[150.75,-2.74],[153.02,-4.11],[152.97,-4.76]],[[129.75,-2.87],[130.81,-3.86],[128.75,-3.3],[127.88,-3.22],[129.75,-2.87]],[[122.78,-8.61],[119.91,-8.86],[120.61,-8.24],[122.32,-8.63],[122.92,-8.1],[122.78,-8.61]],[[120.01,-9.38],[120.83,-10.04],[120,-10.04],[118.96,-9.52],[120.01,-9.38]],[[118.24,-8.32],[119.13,-8.67],[117.39,-9.03],[116.83,-8.53],[118.24,-8.32]],[[106.04,-1.67],[106.67,-3.07],[105.81,-2.31],[105.14,-1.97],[106.04,-1.67]],[[21.61,78.6],[24.9,77.76],[22.47,77.33],[20.93,77.46],[21.65,77.92],[20.23,78.48],[21.61,78.6]],[[47.44,80.85],[48.69,80.63],[47.01,80.56],[44.91,80.61],[47.44,80.85]],[[50.28,80.93],[51.7,80.69],[48.09,80.12],[46.64,80.3],[50.28,80.93]],[[50.27,69.19],[48.31,68.94],[48.84,69.49],[50.27,69.19]],[[60.45,69.94],[58.68,70.05],[60.45,69.94]],[[23.85,35.53],[26.29,35.31],[24.8,34.93],[23.85,35.53]],[[23.42,38.96],[24.21,38.12],[22.87,38.87],[23.42,38.96]],[[34.46,35.59],[32.69,34.65],[32.3,35.08],[34.46,35.59]],[[12.57,55.79],[11.86,54.77],[11.07,55.63],[12.57,55.79]],[[-180,71.54],[-177.5,71.22],[-178.53,71.02],[-180,70.99],[-180,70.99],[179.88,70.98],[178.79,70.82],[179.88,71.52],[-180,71.54]],[[-58.85,-51.27],[-57.81,-51.52],[-58.22,-51.82],[-59.65,-52.14],[-58.85,-51.27]],[[-37.1,-54.07],[-36.08,-54.87],[-38.02,-54.01],[-37.1,-54.07]],[[-73.77,-43.35],[-74.39,-43.23],[-73.73,-41.88],[-73.77,-43.35]],[[-61.8,49.09],[-64.24,49.94],[-61.8,49.09]],[[-61.11,45.94],[-59.87,46.16],[-60.21,45.74],[-61.49,45.94],[-60.41,47],[-61.11,45.94]],[[-171.46,63.64],[-168.72,63.31],[-169.57,63],[-171.46,63.64]],[[-77.26,18.46],[-76.21,17.91],[-77.16,17.85],[-78.34,18.29],[-77.26,18.46]],[[-152.9,57.82],[-152.21,57.58],[-154.38,57.11],[-154.54,57.56],[-152.9,57.82]],[[-133.57,56.34],[-132.17,55.48],[-131.98,54.8],[-132.47,54.94],[-133.57,56.34]],[[-134.97,57.35],[-134.65,56.23],[-135.16,56.82],[-135.82,57.28],[-134.97,57.35]],[[-131.75,53.2],[-131.12,52.22],[-132.55,53.14],[-131.75,53.2]],[[-63.81,46.47],[-62.02,46.42],[-63,46.29],[-64.4,46.69],[-63.99,47.06],[-63.81,46.47]],[[151.92,-4.3],[152.41,-4.34],[152.08,-5.46],[150.47,-6.26],[148.34,-5.67],[150.09,-5.01],[150.74,-5.51],[151.92,-4.3]],[[127.3,-8.42],[123.65,-10.17],[125.18,-8.65],[127.3,-8.42]],[[145.04,-40.79],[148.22,-40.85],[147.7,-43.12],[146.04,-43.55],[145.04,-40.79]],[[96.53,81.08],[97.86,80.7],[91.64,80.27],[93.07,80.99],[96.53,81.08]],[[97.67,80.16],[100.06,79.78],[99.04,79.29],[99.93,78.96],[98.82,78.82],[93.07,79.5],[97.67,80.16]],[[102.88,79.25],[102.41,78.84],[105.34,78.59],[99.29,78.04],[101.59,79.35],[102.88,79.25]],[[140.05,75.83],[145.36,75.53],[144.02,75.04],[142.09,75.66],[142.78,74.87],[139.1,74.66],[136.95,75.33],[138.21,76.12],[140.05,75.83]],[[142.19,73.9],[143.49,73.25],[140.39,73.44],[139.69,73.42],[142.19,73.9]],[[146.8,75.37],[150.58,74.92],[146.15,75.2],[146.8,75.37]],[[173.27,-34.93],[174.32,-35.25],[174.72,-36.84],[175.54,-37.2],[175.46,-36.48],[176.11,-37.64],[178.53,-37.69],[175.69,-41.41],[174.64,-41.31],[175.26,-40.29],[173.78,-39.38],[174.93,-37.09],[172.71,-34.46],[173.27,-34.93]],[[173.12,-41.28],[174.37,-41.1],[172.53,-43.47],[173.07,-43.88],[171.24,-44.26],[170.78,-45.87],[169.69,-46.55],[168.23,-46.39],[166.49,-45.83],[171.04,-42.86],[172.47,-40.62],[173.12,-41.28]],[[126.01,9.32],[126.58,7.25],[126.19,6.31],[125.69,7.26],[125.46,5.66],[124.21,6.23],[124.21,7.4],[123.48,7.76],[121.9,7.07],[123.44,8.7],[123.8,8.05],[125.5,9.01],[125.47,9.76],[126.01,9.32]],[[121.1,18.62],[122.27,18.46],[122.52,17.12],[121.39,15.32],[121.77,14.17],[123.81,13.84],[123.74,12.9],[122.54,13.93],[122.6,13.19],[120.64,13.81],[120.94,14.65],[120.08,14.85],[119.77,16.25],[120.37,16.11],[121.1,18.62]],[[133.47,-0.73],[134.11,-0.85],[135.09,-3.35],[137.91,-1.48],[144.48,-3.83],[145.75,-5.4],[147.8,-6.31],[146.95,-6.88],[148.58,-9.05],[150.85,-10.24],[147.77,-10.07],[146.03,-8.08],[143.65,-7.46],[143.78,-8.03],[142.21,-8.2],[143.38,-8.76],[142.65,-9.33],[141.13,-9.22],[140.12,-7.92],[138.89,-8.24],[139.18,-7.19],[137.28,-4.95],[133.97,-3.82],[133.84,-3.05],[132.92,-4.06],[131.97,-2.79],[133.92,-2.1],[132.31,-2.24],[131,-1.38],[132.39,-0.36],[133.47,-0.73]],[[124.89,1],[123.75,0.31],[120.31,0.41],[120.67,-1.37],[123.43,-0.78],[121.36,-1.88],[122.87,-4.39],[121.65,-4.79],[120.91,-3.56],[120.77,-2.64],[120.43,-5.59],[119.56,-5.61],[119.62,-4.03],[118.78,-2.72],[120.27,0.97],[123.85,0.84],[125.11,1.69],[124.89,1]],[[107.37,-6.01],[108.68,-6.79],[112.54,-6.93],[114.41,-7.79],[114.28,-8.62],[105.26,-6.84],[106.07,-5.91],[107.37,-6.01]],[[96.49,5.23],[97.55,5.21],[103.03,0.58],[102.55,0.22],[103.48,0.48],[104.65,-2.59],[105.9,-2.89],[105.8,-5.72],[104.6,-5.91],[101.58,-3.17],[98.6,1.87],[95.23,5.56],[96.49,5.23]],[[116.81,6.69],[119.26,5.37],[117.06,3.62],[118.99,0.98],[117.91,1.1],[117.56,-0.77],[116.74,-1.04],[116.26,-3.13],[115.26,-3.91],[113.04,-2.93],[111.91,-3.55],[111.7,-2.89],[110.26,-2.97],[108.92,0.91],[109.63,2.03],[111.22,1.4],[111.51,2.74],[115.43,4.97],[116.81,6.69]],[[67.77,76.24],[61.36,75.32],[56.63,73.31],[53.76,73.77],[55.42,74.44],[56.5,74.96],[55.92,75.17],[61.2,76.28],[68.94,76.71],[67.77,76.24]],[[55.32,73.31],[56.43,73.2],[55.3,71.94],[57.62,70.73],[53.62,70.95],[54.16,71.12],[51.44,71.93],[53.36,73.23],[55.32,73.31]],[[142.76,54.39],[144.71,48.82],[143.03,49.11],[142.56,47.74],[143.43,46.03],[143.28,46.56],[142.08,45.92],[141.83,46.45],[142.21,51.22],[141.66,52.27],[142.76,54.39]],[[143.82,44.12],[145.37,44.33],[145.14,43.66],[145.83,43.39],[143.24,42],[140.39,42.49],[141.08,41.76],[140.09,41.43],[139.83,42.45],[140.39,43.3],[141.38,43.28],[141.67,45.4],[143.82,44.12]],[[141.23,41.37],[141.98,39.43],[140.96,38.15],[140.36,35.18],[139.8,34.96],[139.83,35.66],[138.19,34.6],[136.8,35.05],[135.69,33.49],[135.42,34.62],[133.97,34.53],[130.92,33.98],[132.92,35.51],[135.9,35.61],[136.84,37.38],[137.32,37.52],[137.25,36.75],[138.32,37.22],[139.8,38.88],[139.97,40.67],[141.23,41.37]],[[134.36,34.26],[134.18,33.25],[132.8,32.75],[132.52,33.26],[132.03,33.34],[132.94,34.1],[134.36,34.26]],[[131.18,33.6],[132.01,32.92],[131.34,31.4],[130.69,31.01],[130.2,31.95],[130.64,32.62],[130.24,33.18],[129.77,32.57],[129.61,33.34],[131.18,33.6]],[[121.01,22.62],[120.84,21.92],[120.07,23.15],[120.84,24.72],[121.91,25.06],[121.01,22.62]],[[110.89,19.99],[110.02,18.42],[108.68,18.75],[109.26,19.88],[110.89,19.99]],[[79.98,9.81],[81.87,7.29],[80.73,5.98],[79.86,6.83],[79.98,9.81]],[[49.54,-12.43],[50.48,-15.39],[50.21,-15.96],[49.66,-15.52],[47.04,-24.98],[45.21,-25.57],[44.03,-25],[43.26,-22.28],[43.91,-20.87],[44.44,-16.24],[47.1,-15.43],[48.8,-12.44],[49.54,-12.43]],[[-69.17,-52.67],[-65.18,-54.68],[-71.93,-54.53],[-70.93,-54.36],[-70.31,-54.53],[-70.53,-53.63],[-70.24,-54.35],[-69.05,-54.43],[-70.15,-53.89],[-69.39,-53.37],[-70.46,-53.21],[-69.17,-52.67]],[[-81.84,23.16],[-74.14,20.23],[-76.89,19.92],[-77.72,19.86],[-77.11,20.49],[-78.73,21.59],[-81.84,22.67],[-84.89,21.86],[-81.84,23.16]],[[20.9,80.25],[27.2,79.91],[22.91,79.23],[17.92,80.14],[20.9,80.25]],[[16.79,79.91],[21.39,78.74],[19.15,78.38],[16.7,76.58],[14,77.51],[16.91,77.9],[13.68,78.03],[17.17,78.42],[16.7,78.61],[13.15,78.24],[10.68,79.76],[14.59,79.8],[16.34,78.98],[15.83,79.71],[16.79,79.91]],[[9.63,40.88],[9.56,39.17],[8.65,38.93],[8.55,39.84],[8.22,40.91],[9.63,40.88]],[[9.48,42.81],[9.19,41.39],[8.7,42.04],[9.48,42.81]],[[15.58,38.22],[15.11,36.69],[12.76,37.57],[12.74,38.18],[15.58,38.22]],[[-52.73,69.94],[-51.9,69.6],[-53.83,69.54],[-54.82,70.19],[-52.73,69.94]],[[-127.2,50.64],[-125.48,50.32],[-123.29,48.46],[-126.17,49.42],[-128.35,50.7],[-127.2,50.64]],[[-71.96,19.72],[-69.96,19.67],[-68.34,18.61],[-71.11,18.07],[-74.46,18.39],[-72.38,18.57],[-73.44,19.72],[-71.96,19.72]],[[-49.63,-0.23],[-48.38,-0.35],[-49.41,-1.55],[-50.51,-1.79],[-50.76,-1.24],[-50.65,-0.27],[-49.63,-0.23]],[[-3.11,58.52],[-4.13,57.58],[-1.78,57.47],[-3.31,56.36],[-2.67,56.25],[-3.79,56.09],[-2.15,55.9],[-0.08,54.12],[0.12,53.61],[-0.66,53.72],[0.05,52.91],[1.75,52.47],[0.42,51.47],[1.42,51.36],[0.96,50.93],[-5.65,50.08],[-2.43,51.74],[-3.89,51.59],[-5.26,51.88],[-4.15,52.33],[-4.27,53.14],[-2.75,53.31],[-3.59,54.56],[-3.04,54.95],[-4.91,54.69],[-4.58,55.94],[-5.73,55.33],[-5.19,56.76],[-6.13,56.72],[-5.02,58.57],[-3.11,58.52]],[[-7.18,55.06],[-6.13,55.22],[-5.47,54.5],[-6.35,53.99],[-6.32,52.25],[-9.74,51.47],[-10.39,52.13],[-9.77,52.25],[-8.78,52.68],[-9.92,52.57],[-8.93,53.21],[-10.09,53.41],[-9.58,53.8],[-10.06,54.26],[-7.18,55.06]],[[-180,68.98],[-175.35,67.68],[-174.06,66.23],[-174.55,67.09],[-169.73,66.06],[-172.78,65.68],[-172.21,65.05],[-173.16,64.28],[-176.09,65.47],[-178.41,65.49],[-178.53,66.4],[-179.68,66.18],[-179.35,65.52],[-180,65.07],[-180,65.07],[179.83,65.03],[174.55,64.68],[178.23,64.36],[179.57,62.77],[179.12,62.32],[177.02,62.78],[170.35,59.97],[168.46,60.59],[163.49,59.89],[161.96,58.08],[163.23,57.79],[162.76,57.24],[163.34,56.23],[162.09,56.09],[162.1,54.75],[160.07,54.19],[160.02,53.13],[158.47,53.03],[158.1,51.81],[156.75,50.97],[155.56,55.2],[156.02,56.75],[165.4,62.49],[163.33,62.55],[163.09,61.57],[160.17,60.64],[160.31,61.89],[157.09,61.68],[154.29,59.83],[155.16,59.19],[151.33,58.88],[152.26,59.22],[149.64,59.77],[142.58,59.24],[135.26,54.94],[136.8,54.62],[136.72,53.8],[137.67,54.28],[137.25,53.55],[139.79,54.26],[141.38,53.29],[140.84,53.09],[141.49,52.18],[140.11,48.42],[135.48,43.83],[133.16,42.7],[131.8,43.25],[129.76,41.71],[129.71,40.86],[127.57,39.78],[129.42,37.06],[129.21,35.18],[126.53,34.31],[126.63,37.78],[124.69,38.13],[125.55,38.69],[124.35,40.01],[121.16,38.73],[122.26,40.5],[121.83,40.97],[117.78,39.13],[117.65,38.42],[118.94,38.04],[119.11,37.2],[120.75,37.83],[122.67,37.4],[120.18,36.2],[119.17,34.85],[121.86,31.82],[120.03,31.94],[121.88,30.92],[120.2,30.24],[122.08,29.87],[121.61,28.29],[119.14,26.12],[119.62,25.39],[116.47,22.95],[114.27,22.3],[113.52,23.1],[113.55,22.22],[110.41,21.34],[110.35,20.29],[109.93,21.48],[108.59,21.9],[106.68,21],[105.62,18.97],[108.82,15.38],[109.45,12.6],[108.99,11.34],[106.61,10.47],[106.6,9.86],[106.14,10.22],[106.57,9.64],[105.83,10],[106.17,9.4],[105.12,8.63],[105.03,10.07],[103.15,10.91],[102.6,12.2],[100.9,12.65],[100.96,13.43],[100.02,13.35],[99.25,9.27],[99.83,9.29],[100.42,7.19],[103.2,5.26],[104.18,1.37],[101.3,2.89],[100.12,6.44],[98.3,8.23],[98.88,11.72],[97.72,16.57],[96.85,17.4],[95.39,15.72],[94.7,16.51],[94.23,16.02],[94.59,17.57],[93.49,19.37],[94,19.44],[90.6,23.59],[90.23,21.83],[89.98,22.47],[88.12,21.64],[87.94,22.37],[86.75,20.31],[80.29,15.71],[79.84,10.32],[78.94,9.57],[79.41,9.19],[77.52,8.08],[76.55,8.9],[73.34,16.46],[72.81,22.23],[72.18,22.27],[72.02,21.16],[70.48,20.84],[68.97,22.29],[70.49,23.09],[68.82,23.05],[68.78,23.85],[67.56,23.88],[66.43,25.58],[61.41,25.1],[57.8,25.65],[56.73,27.13],[54.64,26.51],[51.59,27.86],[50.07,30.2],[47.98,30.01],[47.72,29.39],[50.15,26.66],[50.81,24.79],[51,25.98],[51.54,25.9],[51.31,24.34],[54.15,24.17],[56.41,26.35],[56.64,24.47],[59.82,22.3],[57.86,20.24],[57.81,19.02],[55.06,17.04],[43.93,12.62],[42.3,17.44],[39.27,20.97],[38.46,23.71],[34.62,28.06],[34.97,29.55],[34.22,27.76],[32.47,29.93],[35.78,23.94],[35.7,22.95],[36.83,22.1],[37.47,18.82],[38.57,18.07],[39.5,15.53],[43.35,12.37],[42.54,11.51],[44.94,10.44],[50.79,11.98],[51.39,10.39],[47.98,4.5],[40.22,-2.69],[39.23,-4.67],[39.3,-8.44],[40.61,-10.66],[40.56,-15.47],[34.65,-19.7],[35.44,-24.17],[32.79,-25.64],[32.54,-28.2],[29.97,-31.32],[25.57,-34.04],[20.02,-34.79],[18.46,-34.35],[18.21,-31.74],[15.29,-27.28],[14.46,-22.45],[11.78,-18],[11.75,-15.83],[13.85,-11.05],[12.28,-6.12],[13.07,-5.87],[12.24,-5.81],[8.7,-0.59],[10,0.2],[9.33,0.55],[9.69,4.06],[8.25,4.92],[6.08,4.29],[5.46,5.61],[3.72,6.6],[-2,4.76],[-4.36,5.3],[-7.66,4.37],[-12.49,7.39],[-13.69,9.93],[-15.39,11.22],[-15.08,11.97],[-16.75,12.4],[-16.75,13.43],[-15.43,13.47],[-16.44,13.35],[-17.53,14.75],[-16.03,17.89],[-16.93,21.9],[-12.95,27.91],[-9.74,29.96],[-9.25,32.57],[-6.9,33.97],[-5.92,35.79],[-1.91,35.09],[1.26,36.52],[9.69,37.34],[11.13,36.87],[10.31,33.73],[15.18,32.39],[15.71,31.43],[18.94,30.29],[20.01,30.8],[20.12,32.22],[21.63,32.94],[29.07,30.83],[31.08,31.6],[32.6,31.07],[34.48,31.59],[35.98,34.55],[36.18,36.81],[32.79,36.04],[31.24,36.82],[29.69,36.16],[27.54,36.68],[28.24,37.03],[27.26,36.98],[27.23,37.98],[26.29,38.28],[27.14,38.45],[26.18,39.99],[33.38,42.02],[38.38,40.93],[41.41,41.42],[41.42,42.74],[36.63,45.15],[37.65,45.38],[38.49,46.09],[37.77,46.64],[39.2,47.27],[35.23,46.44],[35.02,45.7],[36.39,45.07],[33.91,44.39],[32.51,45.4],[33.59,46.1],[31.83,46.28],[32.58,46.62],[31.76,47.21],[31.87,46.65],[28.93,44.97],[27.48,42.47],[28.96,41.01],[26.2,40.07],[26.79,40.63],[24.48,40.95],[23.63,39.92],[22.63,40.5],[23.33,39.18],[22.57,38.87],[24.02,38.14],[22.73,37.54],[23.16,36.45],[21.89,36.74],[21.12,37.89],[23.15,38.18],[21.11,38.39],[19.4,40.28],[19.58,41.79],[15.99,43.52],[14.55,45.3],[13.86,44.84],[13.63,45.77],[12.27,45.45],[12.4,44.22],[14.54,42.24],[18.46,40.22],[16.93,40.46],[16.52,39.75],[17.17,39],[16.06,37.94],[15.69,39.99],[8.76,44.42],[6.11,43.07],[3.26,43.19],[3.25,41.94],[0.71,40.82],[-0.33,39.52],[0.2,38.76],[-2.19,36.74],[-5.63,36.03],[-6.86,37.28],[-9,37.03],[-8.79,39.08],[-9.47,38.73],[-8.66,41.03],[-9.18,43.17],[-7.7,43.77],[-1.99,43.35],[-1.08,45.53],[-0.55,45],[-2.09,46.87],[-1.74,47.22],[-4.31,47.82],[-4.72,48.54],[-1.38,48.65],[-1.86,49.68],[0.42,49.45],[1.77,50.93],[4.22,51.39],[3.45,51.54],[4.28,51.47],[5.53,53.27],[9.78,53.55],[8.13,55.6],[8.16,56.61],[9.2,56.7],[8.27,56.75],[8.62,57.11],[10.61,57.74],[10.28,56.62],[10.93,56.44],[9.59,55.49],[9.87,54.47],[11.4,53.95],[13.03,54.41],[14.58,53.64],[13.83,54.13],[18.08,54.84],[19.41,54.39],[21.12,55.62],[20.59,54.98],[21.19,54.93],[21.03,56.64],[21.73,57.57],[24.38,57.25],[24.53,58.35],[23.77,58.36],[23.5,59.19],[30.12,59.87],[28.51,60.68],[23.02,59.82],[21.44,60.6],[21.54,63.21],[25.37,65.01],[24.63,65.86],[22.4,65.86],[20.76,63.87],[17.41,62.51],[17.25,60.7],[18.97,59.76],[16.21,58.64],[16.93,58.49],[16.35,56.71],[14.18,55.4],[12.89,55.41],[12.88,56.62],[10.6,59.76],[7.46,58.02],[5.59,58.62],[6.4,59.56],[5.13,59.23],[7,60.51],[5.15,59.64],[5.65,60.69],[5.01,61.04],[7.61,61.21],[5.11,61.19],[4.93,61.88],[6.73,61.87],[5.14,62.16],[8.62,62.85],[8.16,63.16],[8.67,63.62],[10.76,63.46],[11.46,64],[9.57,63.71],[14.03,66.3],[13.21,66.64],[15.69,67.52],[14.8,67.81],[17.55,68.43],[16.52,68.53],[18.26,69.47],[23.36,69.98],[24.66,71],[25.77,70.85],[25.04,70.11],[28.14,71.04],[28.19,70.25],[28.83,70.86],[30.96,70.34],[28.78,70.15],[29.69,69.74],[31.98,69.95],[33.45,69.43],[33.14,69.07],[35.86,69.19],[40.97,67.71],[41.19,66.83],[38.66,66.07],[31.89,67.16],[34.69,65.95],[35.03,64.44],[37.44,63.81],[38.06,64.09],[36.58,64.79],[36.88,65.17],[39.76,64.58],[40.44,64.78],[39.82,65.6],[42.21,66.52],[44.11,66.01],[44.2,68.25],[43.33,68.67],[45.89,68.48],[46.69,67.85],[44.9,67.41],[46.49,66.8],[53.8,69],[54.19,69],[54.49,68.99],[53.26,68.27],[59.06,69.01],[59.73,68.35],[60.93,68.99],[60.17,69.59],[60.91,69.85],[68.5,68.35],[69.14,68.95],[66.9,69.55],[67.29,70.74],[66.64,71.08],[69.39,72.96],[71.5,72.91],[72.81,72.69],[71.87,71.46],[72.7,70.96],[72.58,68.97],[73.59,68.48],[71.54,66.68],[69.01,66.79],[72.07,66.25],[74.77,67.77],[74.39,68.42],[75.12,68.86],[76.46,68.98],[77.18,67.78],[78.92,67.59],[77.59,67.75],[77.65,68.9],[73.78,69.2],[74.34,70.58],[73.09,71.44],[74.99,72.15],[74.79,72.81],[75.6,72.58],[75.73,71.27],[79.02,70.95],[76.03,71.91],[78.48,72.4],[83.11,71.72],[82.16,70.6],[83.01,70.9],[83.08,70.09],[83.74,70.55],[83.15,71.1],[83.53,71.68],[80.83,72.49],[80.58,73.57],[86.89,73.89],[85.79,73.44],[86.68,73.11],[85.91,73.39],[87.57,73.81],[85.79,74.65],[87.47,75.01],[87.01,75.17],[94.16,75.96],[93.26,76.1],[99.54,75.8],[98.8,76.48],[101.6,76.44],[100.91,76.9],[104.18,77.73],[106.06,77.39],[104.2,77.1],[107.43,76.93],[106.42,76.51],[111.11,76.72],[113.87,75.86],[112.45,75.83],[113.73,75.45],[113.62,75.29],[112.92,75.02],[105.14,72.78],[110.87,73.73],[109.67,73.8],[110.26,74.02],[113.03,73.91],[113.67,72.64],[113.22,72.81],[114.06,73.58],[122.54,72.88],[124.54,73.75],[129.1,73.11],[128.42,72.53],[129.28,72.09],[127.73,72.41],[131.02,70.75],[132.65,71.93],[137.94,71.13],[139.99,71.49],[139.36,71.95],[140.19,72.19],[139.14,72.33],[140.81,72.89],[146.83,72.29],[145.19,71.7],[149.5,72.16],[150.02,71.9],[148.92,71.71],[152.51,70.83],[158.7,70.94],[160.91,69.61],[160.86,68.54],[163.2,69.72],[167.86,69.73],[170.54,68.83],[171,69.04],[171,69.14],[170.16,69.63],[170.49,70.11],[179.87,69.01],[-180,68.98]],[[-15.54,66.23],[-14.6,66.38],[-15.11,66.1],[-13.57,65.07],[-18.3,63.46],[-22.65,63.83],[-21.59,64.63],[-24.02,64.86],[-21.76,65.17],[-22.4,65.16],[-21.84,65.45],[-24.47,65.52],[-22.44,65.91],[-22.89,66.44],[-21.41,66.03],[-21.13,65.27],[-20.21,66.1],[-15.54,66.23]],[[54.72,81.12],[57.69,80.79],[55.54,80.7],[54.07,80.81],[54.72,81.12]],[[148.6,45.32],[146.9,44.4],[147.56,45.06],[148.6,45.32]],[[-155.58,19.01],[-155.83,20.28],[-154.8,19.52],[-155.58,19.01]],[[-86.59,71.01],[-84.82,71.03],[-84.7,71.63],[-85.91,71.99],[-84.28,72.04],[-85.65,72.72],[-84.26,72.8],[-85.46,73.11],[-81.6,73.7],[-80.28,72.77],[-80.95,71.92],[-79.83,72.45],[-78.58,71.88],[-78.7,72.35],[-77.52,72.18],[-78.42,72.57],[-77.25,72.74],[-75.07,72.32],[-75.92,71.72],[-74.27,72.04],[-75.21,71.71],[-75,71.22],[-71.64,71.52],[-71.19,71.28],[-72.63,70.83],[-70.67,71.05],[-71.89,70.43],[-71.43,70.13],[-70.08,70.83],[-68.5,70.61],[-70.06,70.04],[-67.86,70.28],[-67.19,69.76],[-69.25,69.51],[-66.68,69.26],[-69.32,68.86],[-63.04,67.23],[-63.7,66.82],[-61.3,66.65],[-62.55,66.41],[-61.99,66.03],[-62.66,65.64],[-63.46,65.85],[-63.61,64.93],[-65.4,65.76],[-64.45,66.32],[-68.75,66.2],[-68.19,65.87],[-65.09,64.48],[-65.59,64.31],[-64.41,63.71],[-64.67,63.24],[-65.19,63.76],[-64.68,62.9],[-68.91,63.7],[-65.98,62.21],[-66.33,61.87],[-71.35,63.07],[-73.27,64.58],[-77.79,64.37],[-78.19,64.75],[-77.33,65.45],[-75.45,64.84],[-75.8,65.3],[-73.55,65.48],[-74.42,66.17],[-72.23,67.28],[-74.72,69.04],[-76.59,68.7],[-75.65,69.21],[-78.98,70.58],[-79.09,69.93],[-81.65,70.1],[-80.92,69.73],[-87.9,70.25],[-89.46,71.06],[-87.14,71.01],[-90.02,71.95],[-88.71,73.4],[-85.01,73.78],[-86.67,72.76],[-85.02,71.35],[-86.59,71.01]],[[-69.49,83.02],[-61.21,82.34],[-68.69,81.29],[-64.78,81.49],[-72.06,80.12],[-70.56,80.07],[-71.39,79.76],[-76.9,79.51],[-74.48,79.23],[-78.58,79.08],[-74.43,78.72],[-78.49,77.37],[-82.06,77.28],[-78,76.85],[-79.29,76.36],[-89.57,76.49],[-86.81,77.19],[-88.02,77.78],[-84.49,77.37],[-82.59,77.99],[-85.29,77.76],[-84.22,78.18],[-87.55,78.18],[-86.81,78.77],[-81.75,78.98],[-84.41,79],[-83.58,79.05],[-86.5,80.26],[-80.48,79.61],[-82.99,80.32],[-76.86,80.87],[-78.72,80.95],[-76.88,81.43],[-85.15,80.52],[-86.62,80.63],[-83.29,81.15],[-87.71,80.66],[-89.26,80.91],[-84.94,81.29],[-89.62,81.03],[-87.6,81.53],[-91.68,81.64],[-84.9,82.45],[-79.43,81.85],[-82.45,82.39],[-78.75,82.68],[-79.89,82.94],[-69.49,83.02]],[[-94.31,71.77],[-91.57,70.18],[-92.89,69.67],[-90.42,69.46],[-91.24,69.29],[-90.25,68.27],[-89.28,69.26],[-88.04,68.81],[-88.31,67.95],[-87.36,67.18],[-84.87,68.77],[-85.51,69.85],[-82.37,69.64],[-81.25,68.74],[-82.55,68.45],[-81.47,67.07],[-83.41,66.37],[-85.11,66.91],[-83.87,66.21],[-86.71,66.52],[-85.96,66.12],[-87.45,65.34],[-91.43,65.95],[-87.03,65.2],[-88.11,64.18],[-90.81,63.58],[-93.7,64.15],[-90.71,63.3],[-93.21,62.36],[-94.76,60.5],[-94.96,59.07],[-94.33,58.3],[-93.18,58.73],[-92.8,56.92],[-90.59,57.22],[-85.37,55.08],[-82.39,55.07],[-81.83,52.22],[-79.35,50.76],[-79.69,51.35],[-78.9,51.2],[-78.45,52.26],[-79.71,54.67],[-76.55,56.36],[-76.89,57.76],[-78.51,58.68],[-77.29,60.02],[-78.18,60.82],[-77.51,61.56],[-78.13,62.28],[-73.71,62.47],[-71.42,61.16],[-69.47,61.01],[-69.67,60.08],[-70.66,60.03],[-69.35,59.3],[-70.16,58.76],[-68.38,58.74],[-69.04,57.9],[-66,58.43],[-64.5,60.27],[-63.42,59.19],[-63.97,59.05],[-62.87,58.67],[-63.54,58.33],[-62.61,58.5],[-63.26,58.01],[-61.96,57.91],[-62.49,57.49],[-61.33,57.01],[-62.5,56.8],[-60.34,55.79],[-60.62,55.06],[-57.4,54.59],[-60.33,53.27],[-57.42,54.16],[-57.33,53.47],[-55.96,53.47],[-56.32,52.54],[-55.67,52.19],[-60.08,50.25],[-66.49,50.21],[-69.67,48.2],[-71.02,48.46],[-69.77,48.1],[-74.31,45.53],[-74.71,45],[-68.82,48.37],[-65.52,49.27],[-64.26,48.55],[-66.7,48.02],[-64.7,47.73],[-65.32,47.1],[-64.54,46.24],[-61.03,45.29],[-64.29,44.55],[-65.48,43.52],[-66.09,44.5],[-63.37,45.36],[-64.87,45.36],[-64.63,45.95],[-68.76,44.57],[-71.04,42.33],[-69.95,41.68],[-73.99,40.75],[-73.97,41.25],[-74.92,38.94],[-75.47,39.78],[-75.04,38.43],[-75.93,37.15],[-75.87,39.51],[-76.57,39.27],[-76.34,38.09],[-77.03,38.89],[-76.28,37.05],[-77.25,37.33],[-76,36.91],[-75.53,35.82],[-75.95,36.66],[-75.82,36.11],[-76.73,36.23],[-75.76,35.84],[-77.04,35.53],[-76.44,34.84],[-80.8,32.45],[-81.44,31.2],[-80.05,26.81],[-80.48,25.23],[-81.11,25.14],[-82.72,27.5],[-82.65,28.89],[-84.04,30.1],[-85.32,29.68],[-88.01,30.69],[-90.33,30.28],[-89.4,30.05],[-89.16,29.02],[-93.84,29.98],[-96.64,28.71],[-97.77,27.46],[-97.14,26.03],[-97.86,22.62],[-95.92,18.82],[-94.46,18.17],[-91.53,18.46],[-90.35,21.01],[-87.04,21.59],[-88.89,15.89],[-84.97,15.99],[-83.37,15.24],[-83.87,11.3],[-82.08,8.93],[-79.11,9.54],[-76.79,7.93],[-75.45,10.61],[-71.6,12.43],[-71.14,12.05],[-71.96,11.57],[-72.11,9.82],[-71.62,9.05],[-71.05,9.71],[-71.47,10.96],[-69.81,11.47],[-70,12.18],[-68.14,10.49],[-65.13,10.07],[-61.88,10.74],[-62.91,10.53],[-62.74,10.06],[-60.79,9.36],[-61.3,8.41],[-60.17,8.62],[-58.81,7.74],[-58.67,6.39],[-57.98,6.79],[-57.18,5.53],[-53.85,5.78],[-51.22,4.09],[-49.9,1.16],[-52.66,-1.55],[-50.9,-0.94],[-50.4,-2.01],[-49.32,-1.73],[-49.64,-2.66],[-48.12,-0.74],[-47.27,-0.65],[-44.65,-1.75],[-44.72,-3.2],[-43.38,-2.38],[-39.97,-2.86],[-37.18,-4.91],[-35.48,-5.17],[-34.99,-6.39],[-35.16,-8.93],[-38.24,-12.84],[-38.85,-12.79],[-39.16,-17.7],[-41,-22],[-42.04,-22.95],[-44.64,-23.06],[-48.73,-25.37],[-48.8,-28.58],[-52.04,-32.12],[-50.58,-30.44],[-51.3,-30.04],[-52.65,-33.14],[-54.17,-34.67],[-57.83,-34.48],[-58.2,-32.47],[-58.52,-34.3],[-57.17,-35.36],[-56.73,-36.96],[-58.18,-38.44],[-62.34,-38.8],[-62.39,-40.89],[-65.07,-40.81],[-64.99,-42.1],[-63.63,-42.28],[-63.69,-42.81],[-65.03,-42.76],[-64.32,-42.97],[-65.64,-45.01],[-67.6,-46.05],[-65.85,-47.16],[-65.81,-47.94],[-67.91,-49.98],[-68.98,-50],[-68.42,-50.16],[-69.46,-51.58],[-68.44,-52.36],[-70.8,-52.77],[-71.3,-53.88],[-72.41,-53.35],[-71.23,-52.81],[-73.05,-53.24],[-71.51,-52.61],[-74.01,-52.64],[-74.3,-52.12],[-72.52,-52.25],[-75.09,-50.68],[-73.81,-50.94],[-74.63,-50.19],[-73.83,-49.61],[-74.58,-48],[-73.39,-48.15],[-74.66,-47.7],[-74.31,-46.79],[-75.71,-46.7],[-73.96,-45.4],[-74.39,-46.22],[-73.73,-45.81],[-73.85,-46.57],[-72.68,-44.59],[-73.27,-44.17],[-72.32,-41.5],[-73.52,-41.8],[-73.96,-41.12],[-73.23,-39.22],[-73.66,-37.34],[-71.45,-32.66],[-70.15,-19.81],[-70.36,-18.4],[-71.44,-17.37],[-75.93,-14.63],[-78.76,-8.62],[-81.18,-5.94],[-81.28,-4.32],[-79.73,-2.58],[-80.93,-2.27],[-80.9,-1.08],[-80.09,0.79],[-78.9,1.21],[-77.08,3.91],[-78.1,8.5],[-79.44,9.01],[-80.46,8.21],[-80.01,7.5],[-80.84,7.22],[-81.06,7.9],[-83.61,8.48],[-85.26,10.26],[-85.08,9.6],[-85.63,9.9],[-87.49,13.35],[-91.38,13.99],[-94.37,16.28],[-96.51,15.65],[-103.44,18.33],[-105.48,19.98],[-105.79,22.63],[-109.31,25.63],[-109.28,26.53],[-112.16,29.02],[-113.05,31.18],[-114.93,31.9],[-114.55,30.02],[-109.42,23.48],[-110,22.89],[-112.07,24.84],[-112.38,26.21],[-114.99,27.74],[-114.07,27.68],[-114.05,28.43],[-115.67,29.76],[-117.47,33.3],[-120.65,34.58],[-122.5,37.54],[-121.52,38.06],[-123,37.99],[-123.7,38.91],[-124.54,42.81],[-123.99,46.22],[-123.22,46.15],[-124.07,46.28],[-124.71,48.38],[-122.78,48.14],[-123.14,47.36],[-122.53,47.92],[-122.63,47.14],[-122.24,48.01],[-122.88,49.4],[-124.7,49.96],[-124.86,50.87],[-126.09,50.5],[-127.71,51.15],[-126.69,51.7],[-127.85,51.67],[-127.44,52.36],[-126.71,52.06],[-127.01,52.84],[-128.1,51.79],[-128.05,52.91],[-129.17,53.53],[-127.93,53.28],[-128.53,53.86],[-129.56,53.25],[-130.33,53.72],[-129.56,55.46],[-130.05,55.06],[-130.02,55.89],[-130.54,54.75],[-131.03,56.09],[-132.12,55.57],[-131.55,56.21],[-133.47,57.17],[-133.88,58.52],[-134.66,58.38],[-135.36,59.42],[-135.09,58.25],[-136.99,59.04],[-136.06,58.45],[-136.61,58.24],[-139.77,59.53],[-138.99,59.84],[-139.43,60.01],[-144.15,60.02],[-147.75,61.22],[-148.56,60.83],[-147.96,60.48],[-148.46,59.97],[-151.95,59.26],[-151.04,59.77],[-151.85,59.78],[-151.32,60.74],[-149.08,60.88],[-150.05,61.17],[-149.63,61.49],[-153.02,60.3],[-152.63,60.04],[-154.18,59.15],[-153.44,58.76],[-158.48,56.08],[-163.34,54.84],[-157.46,57.51],[-156.81,59.13],[-158.81,58.97],[-158.95,58.4],[-160.36,59.05],[-162.14,58.64],[-161.95,60.68],[-163.91,59.81],[-165.36,60.54],[-163.59,60.9],[-166.17,61.65],[-164.41,63.22],[-160.93,63.66],[-161.49,64.43],[-160.89,64.8],[-166.14,64.58],[-166.93,65.16],[-166.16,65.29],[-168.09,65.66],[-164.46,66.59],[-161.04,66.19],[-162.36,66.95],[-160.23,66.42],[-166.79,68.36],[-161.88,70.33],[-156.47,71.41],[-155.58,71.12],[-155.97,70.84],[-143.22,70.12],[-135.26,68.68],[-135.91,69.11],[-129.54,70.11],[-133.42,68.84],[-132.71,68.81],[-127.99,70.57],[-125.73,69.38],[-124.56,70.15],[-124.34,69.36],[-121.74,69.8],[-113.96,68.4],[-115.13,67.82],[-110.07,67.99],[-107.26,66.4],[-107.96,67.82],[-105.75,68.59],[-108.72,68.3],[-108.64,68.38],[-108.34,68.6],[-106.16,68.92],[-102.32,67.74],[-97.16,67.73],[-98.65,68.36],[-97.83,68.53],[-95.97,68.25],[-96.37,67.51],[-95.42,67.01],[-96.42,67.04],[-95.79,66.62],[-95.46,68.02],[-93.45,68.62],[-94.6,68.8],[-93.43,69.37],[-96.05,69.83],[-96.53,71.13],[-94.31,71.77]],[[-82,62.96],[-83.73,62.26],[-82,62.96]],[[-93.54,75.03],[-96.39,75],[-94.88,75.63],[-93.54,75.03]],[[-109.82,78.65],[-109.35,78.37],[-111.52,78.28],[-113.29,78.33],[-109.82,78.65]],[[-105.29,72.92],[-106.95,73.51],[-105.51,73.77],[-104.55,73.54],[-105.29,72.92]],[[-100,73.95],[-97.17,73.82],[-98.42,72.94],[-96.45,72.55],[-96.61,71.83],[-99.22,71.39],[-102.71,72.78],[-100.13,72.91],[-101.52,73.49],[-100,73.95]],[[-84.92,65.26],[-80.26,63.8],[-83.58,64.06],[-85.24,63.14],[-87.18,63.6],[-86.25,64.14],[-85.81,65.83],[-84.92,65.26]],[[-75.67,68.32],[-75.2,67.46],[-76.86,67.24],[-77.13,67.95],[-75.67,68.32]],[[-79.54,73.65],[-76.09,72.88],[-79.5,72.76],[-80.86,73.67],[-79.54,73.65]],[[-97.7,76.47],[-97.34,75.42],[-97.99,75.05],[-100.73,75.35],[-99.19,75.7],[-102.8,75.6],[-101.94,75.88],[-100.97,75.8],[-101.79,76.45],[-99.87,75.92],[-100.89,76.48],[-97.7,76.47]],[[-103.43,79.32],[-99,78],[-101.3,78.2],[-104.51,78.29],[-105,78.52],[-103.37,78.74],[-105.58,79.11],[-103.43,79.32]],[[-91.89,81.13],[-85.04,79.28],[-90.61,78.15],[-94.17,78.97],[-91.3,79.37],[-95.1,79.29],[-95.73,79.42],[-94.4,79.74],[-96.77,80.14],[-94.26,80.2],[-96.39,80.32],[-93.24,81.13],[-94.18,81.34],[-91.89,81.13]],[[-94.29,76.91],[-89.29,76.3],[-91.41,76.22],[-88.92,75.45],[-82.15,75.83],[-79.4,74.92],[-83.06,74.63],[-91.55,74.66],[-93.09,76.35],[-96.9,76.75],[-94.29,76.91]],[[-96.21,78.53],[-94.93,78.08],[-97.66,78.09],[-96.94,78.15],[-98.33,78.77],[-96.21,78.53]],[[-110.46,78.1],[-109.62,78.06],[-112.18,77.34],[-113.28,77.84],[-110.46,78.1]],[[-115.55,77.36],[-116.33,77.14],[-116.08,76.65],[-118.2,76.76],[-119.54,75.98],[-122.9,76.13],[-119.09,77.3],[-115.55,77.36]],[[-108.29,76.06],[-105.48,75.7],[-106.09,75.09],[-112.52,74.42],[-114.38,74.67],[-111.03,75.23],[-115.48,75.1],[-117.6,75.27],[-115.14,75.68],[-117.16,75.65],[-114.99,75.9],[-116.66,75.96],[-115,76.5],[-109.09,75.51],[-110.31,76.4],[-108.83,76.82],[-108.29,76.06]],[[-93.17,74.16],[-90.36,73.87],[-92.12,72.75],[-94.21,72.76],[-93.53,72.5],[-94.04,72.03],[-95.19,72.03],[-95.64,73.67],[-93.17,74.16]],[[-97.44,69.64],[-95.27,68.83],[-98.91,68.93],[-99.56,69.03],[-97.44,69.64]],[[-114.52,72.59],[-111.27,72.71],[-111.67,72.3],[-110.01,72.98],[-107.81,71.63],[-107.3,71.9],[-108.24,73.15],[-106.48,73.2],[-105.41,72.79],[-104.51,71.06],[-100.91,69.87],[-103.46,69.64],[-103.03,69.43],[-101.79,69.13],[-106.66,69.44],[-113.13,68.49],[-117.19,70.05],[-111.63,70.31],[-117.59,70.63],[-118.26,70.89],[-118.38,70.97],[-115.3,71.49],[-118.99,71.76],[-116.57,73.06],[-114.21,73.3],[-114.52,72.59]],[[-119.74,74.11],[-115.39,73.5],[-119.08,72.64],[-120.62,71.51],[-123.09,71.09],[-124.01,71.68],[-125.84,71.98],[-123.8,73.77],[-124.7,74.35],[-119.74,74.11]],[[-55.46,51.54],[-56.82,49.61],[-56.18,50.12],[-55.35,49.08],[-53.62,49.32],[-54.11,48.39],[-53.04,48.66],[-53.86,47.79],[-52.88,48.13],[-52.89,47.05],[-54.13,46.84],[-54.19,47.86],[-55.79,46.87],[-54.78,47.66],[-59.32,47.74],[-57.04,51.01],[-55.46,51.54]],[[15.76,68.56],[16.55,68.72],[15.04,68.28],[14.26,68.19],[16.13,69.27],[15.76,68.56]],[[-44.87,82.08],[-47.27,82.66],[-44.87,82.08]],[[-29.95,83.56],[-25.8,83.26],[-32.03,82.98],[-21.52,82.6],[-29.89,82.05],[-21.13,81.93],[-23.12,80.78],[-19.63,81.64],[-11.42,81.48],[-20.15,80.01],[-18.99,79.18],[-21.13,78.66],[-21.73,77.71],[-19.49,77.72],[-20.68,77.62],[-18.34,76.92],[-22.61,76.7],[-19.51,75.76],[-19.52,75.18],[-22.23,75.12],[-19.23,74.48],[-22.33,74.29],[-20.51,73.49],[-25.52,73.85],[-24.78,73.54],[-27.56,73.14],[-22.04,72.92],[-22.29,72.12],[-24.63,73.04],[-26.66,72.72],[-24.81,72.9],[-25.2,72.39],[-21.96,71.74],[-22.48,71.38],[-21.75,71.48],[-21.52,70.53],[-27.01,71.63],[-25.67,71.27],[-29.07,70.44],[-22.29,70.03],[-26.48,68.68],[-32.33,68.44],[-34.63,66.43],[-37.76,65.59],[-37.28,66.3],[-38.15,66.39],[-38.2,65.71],[-40.17,65.56],[-39.58,65.34],[-41.09,65.03],[-40.18,64.48],[-41.58,64.3],[-40.55,63.73],[-42.94,62.72],[-42.11,61.86],[-43.04,60.52],[-43.94,60.57],[-43.32,59.93],[-45.38,60.2],[-44.74,60.65],[-46.05,60.61],[-45.87,61.22],[-48.43,61.17],[-49.29,61.59],[-48.83,62.08],[-50.32,62.47],[-49.79,63.05],[-51.54,63.76],[-50.26,64.21],[-51.4,64.46],[-50.12,64.7],[-50.96,65.2],[-50.78,64.75],[-52.06,64.35],[-52.54,65.33],[-51.09,65.78],[-53.2,65.59],[-53.36,66.07],[-51.23,66.88],[-53.61,66.15],[-52.39,66.88],[-53.8,67.42],[-50.61,67.53],[-53.74,67.55],[-51.17,68.39],[-53.04,68.61],[-50.3,69.17],[-51.08,69.21],[-50.32,70.03],[-54.53,70.7],[-50.68,70.4],[-53.12,71.31],[-51.78,71.68],[-53.44,71.58],[-53.65,72.36],[-53.96,71.46],[-55.59,71.55],[-54.84,72.38],[-55.6,72.45],[-54.74,72.87],[-57.23,74.12],[-56.26,74.53],[-58.52,75.69],[-68.32,76.09],[-69.48,76.4],[-68.11,76.65],[-71.16,77.07],[-66.27,77.51],[-72.72,78.36],[-65.82,79.17],[-64.18,80.1],[-67.19,80.28],[-61.44,81.13],[-60.43,81.92],[-56.62,81.36],[-59.27,81.98],[-49.54,81.92],[-50.99,82.46],[-50.82,82.47],[-50.04,82.47],[-44.73,81.78],[-44.33,82.47],[-45.56,82.75],[-41.37,82.75],[-46.48,82.95],[-29.95,83.56]],[[-180,-16.49],[180,-16.54],[179.99,-16.54],[179.99,-16.52],[-180,-16.49]]]); } })();