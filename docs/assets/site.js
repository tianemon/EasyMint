(function () {
  'use strict';

  var REPO = 'tianemon/EasyMint';

  var MATCH = {
    mac: /EasyMint-macOS-arm64\.dmg$/i,
    win: /EasyMint-windows-x64\.exe$/i,
    linux: /EasyMint-linux-x86_64\.AppImage$/i
  };

  function applyVersion(tagName, assets) {
    var badge = document.querySelector('[data-version]');
    if (badge && tagName) {
      badge.textContent = tagName;
      badge.hidden = false;
    }

    var byOS = {};
    (assets || []).forEach(function (asset) {
      Object.keys(MATCH).forEach(function (os) {
        if (!byOS[os] && MATCH[os].test(asset.name)) byOS[os] = asset.browser_download_url;
      });
    });

    ['mac', 'win', 'linux'].forEach(function (os) {
      var link = document.querySelector('[data-os="' + os + '"]');
      if (link && byOS[os]) link.href = byOS[os];
    });
  }

  function loadRelease() {
    if (!('fetch' in window)) return;
    fetch('https://api.github.com/repos/' + REPO + '/releases/latest', {
      headers: { Accept: 'application/vnd.github+json' }
    })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (data) {
        applyVersion(data.tag_name, data.assets);
      })
      .catch(function () { /* Keep the working Releases links if the API is unavailable. */ });
  }

  function initCopy() {
    var buttons = document.querySelectorAll('[data-copy]');
    Array.prototype.forEach.call(buttons, function (btn) {
      btn.addEventListener('click', function () {
        var text = btn.getAttribute('data-copy') || '';
        var done = function () {
          var old = btn.textContent;
          btn.textContent = '已复制';
          setTimeout(function () { btn.textContent = old; }, 1600);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(done, function () {});
          return;
        }
        var area = document.createElement('textarea');
        area.value = text;
        area.setAttribute('readonly', '');
        area.style.position = 'fixed';
        area.style.opacity = '0';
        document.body.appendChild(area);
        area.select();
        try { document.execCommand('copy'); done(); } catch (e) {}
        document.body.removeChild(area);
      });
    });
  }

  function initTour() {
    var section = document.getElementById('tour');
    if (!section) return;
    var stage = section.querySelector('.tour-stage');
    var cards = Array.from(section.querySelectorAll('.stack-card'));
    var panels = Array.from(section.querySelectorAll('[data-tour-panel]'));
    var dots = section.querySelector('.tour-dots');
    var buttons = Array.from(dots.querySelectorAll('.dot'));
    var counter = section.querySelector('[data-tour-index]');
    var announcement = section.querySelector('[data-tour-announcement]');
    var dialog = document.querySelector('.image-dialog');
    var current = 0;
    var renderRequest = 0;
    var timer = null;
    var FIRST_MS = 1800;
    var AUTO_MS = 4200;
    var remainingMs = FIRST_MS;
    var deadline = 0;
    var hasActivated = false;
    var keyboardInteraction = false;
    var reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    // Pauses have independent causes. Mouse hover and mouse-selected controls
    // do not stop playback; keyboard navigation and media dialogs still do.
    var state = { focus: false, hidden: document.hidden, outside: 'IntersectionObserver' in window, reduced: reduce.matches, dialog: false, loading: false };
    buttons.forEach(function (button) { button.querySelector('span').appendChild(document.createElement('i')); });

    function resetClock(delay) {
      clearTimeout(timer);
      timer = null;
      remainingMs = delay;
      dots.style.setProperty('--auto-ms', delay + 'ms');
      var bar = buttons[current].querySelector('i');
      bar.style.animation = 'none';
      void bar.offsetWidth;
      bar.style.animation = '';
    }

    function syncPlayback() {
      var stopped = Object.keys(state).some(function (key) { return state[key]; });
      if (stopped && timer !== null) {
        remainingMs = Math.max(0, deadline - performance.now());
        clearTimeout(timer);
        timer = null;
      }
      dots.classList.toggle('is-paused', stopped);
      if (!stopped && timer === null) {
        deadline = performance.now() + remainingMs;
        timer = setTimeout(function () {
          timer = null;
          remainingMs = AUTO_MS;
          render(current + 1, false);
        }, remainingMs);
      }
    }

    function warmNextImages() {
      if (state.outside) return;
      [1, 2].forEach(function (offset) { cards[(current + offset) % cards.length].querySelector('img').loading = 'eager'; });
    }

    function render(next, manual) {
      var target = (next + cards.length) % cards.length;
      var request = ++renderRequest;
      var img = cards[target].querySelector('img');
      img.loading = 'eager';
      if (img.complete && img.naturalWidth) { activate(target, manual); return; }
      // Keep the current complete screenshot visible while a full-resolution image loads.
      state.loading = true;
      stage.setAttribute('aria-busy', 'true');
      syncPlayback();
      img.decode().then(function () {
        if (request === renderRequest) activate(target, manual);
      }).catch(function () {
        if (request !== renderRequest) return;
        state.loading = false;
        stage.setAttribute('aria-busy', 'false');
        announcement.textContent = '截图暂时未能加载，请稍后重试。';
        syncPlayback();
      });
    }

    function activate(target, manual) {
      state.loading = false;
      stage.setAttribute('aria-busy', 'false');
      current = target;
      cards.forEach(function (card, i) {
        var offset = (i - current + cards.length) % cards.length;
        card.dataset.pos = offset === 0 ? '0' : offset === 1 ? '1' : offset === 2 ? '2' : offset === cards.length - 1 ? '-1' : 'x';
        card.setAttribute('aria-hidden', String(i !== current));
      });
      panels.forEach(function (panel, i) {
        panel.classList.toggle('is-active', i === current);
        panel.setAttribute('aria-hidden', String(i !== current));
        panel.inert = i !== current;
      });
      buttons.forEach(function (button, i) {
        button.classList.toggle('is-active', i === current);
        if (i === current) button.setAttribute('aria-current', 'true');
        else button.removeAttribute('aria-current');
      });
      resetClock(hasActivated ? AUTO_MS : FIRST_MS);
      hasActivated = true;
      warmNextImages();
      counter.textContent = String(current + 1).padStart(2, '0');
      if (manual) announcement.textContent = '第 ' + (current + 1) + ' 张，共 ' + cards.length + ' 张：' + cards[current].querySelector('img').alt;
      syncPlayback();
    }

    buttons.forEach(function (button, i) {
      button.addEventListener('click', function () { render(i, true); });
    });
    dots.addEventListener('keydown', function (event) {
      var next;
      if (event.key === 'ArrowRight') next = current + 1;
      else if (event.key === 'ArrowLeft') next = current - 1;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = cards.length - 1;
      else return;
      event.preventDefault();
      render(next, true);
      buttons[(next + cards.length) % cards.length].focus();
    });
    section.querySelector('[data-tour-prev]').addEventListener('click', function () { render(current - 1, true); });
    section.querySelector('[data-tour-next]').addEventListener('click', function () { render(current + 1, true); });
    document.addEventListener('keydown', function () { keyboardInteraction = true; }, true);
    document.addEventListener('pointerdown', function () {
      keyboardInteraction = false;
      if (state.focus) { state.focus = false; syncPlayback(); }
    }, true);
    section.addEventListener('focusin', function (event) {
      state.focus = keyboardInteraction;
      syncPlayback();
    });
    section.addEventListener('focusout', function (event) {
      state.focus = keyboardInteraction && section.contains(event.relatedTarget);
      syncPlayback();
    });
    document.addEventListener('visibilitychange', function () { state.hidden = document.hidden; syncPlayback(); });
    reduce.addEventListener('change', function () { state.reduced = reduce.matches; syncPlayback(); });
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) {
        var outside = !entries[0].isIntersecting;
        warmNextImages();
        if (outside === state.outside) return;
        state.outside = outside;
        warmNextImages();
        syncPlayback();
      }, { threshold: 0.15 }).observe(stage);
    }
    var pointerStart = null;
    var swiped = false;
    stage.addEventListener('pointerdown', function (event) { pointerStart = { x: event.clientX, y: event.clientY }; swiped = false; });
    stage.addEventListener('pointerup', function (event) {
      if (!pointerStart) return;
      var dx = event.clientX - pointerStart.x;
      var dy = event.clientY - pointerStart.y;
      pointerStart = null;
      if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.3) { swiped = true; render(current + (dx < 0 ? 1 : -1), true); }
    });
    stage.addEventListener('pointercancel', function () { pointerStart = null; swiped = false; });
    var zoom = section.querySelector('[data-zoom]');
    zoom.addEventListener('click', function () {
      if (swiped) { swiped = false; return; }
      var img = cards[current].querySelector('img');
      showImage(cards[current].querySelector('.focus-shot') || img, String(current + 1).padStart(2, '0') + ' / ' + cards.length + ' · ' + img.alt);
    });
    function showImage(source, caption) {
      dialog.querySelector('.dialog-stage').replaceChildren(source.cloneNode(true));
      dialog.querySelector('p').textContent = caption;
      state.dialog = true;
      syncPlayback();
      dialog.showModal();
    }
    var heroZoom = document.querySelector('[data-hero-zoom]');
    heroZoom.addEventListener('click', function () { showImage(heroZoom.querySelector('img'), 'EasyMint · 完整工作界面实拍'); });
    var videoDialog = document.querySelector('.video-dialog');
    var video = videoDialog.querySelector('video');
    section.querySelector('[data-video]').addEventListener('click', function () {
      state.dialog = true;
      syncPlayback();
      if (!video.getAttribute('src')) video.src = video.dataset.source;
      video.muted = true;
      videoDialog.showModal();
      video.play().catch(function () { /* The native controls remain available. */ });
    });
    videoDialog.querySelector('.dialog-close').addEventListener('click', function () { videoDialog.close(); });
    videoDialog.addEventListener('close', function () { video.pause(); state.dialog = false; syncPlayback(); });
    videoDialog.addEventListener('click', function (event) {
      if (event.target !== videoDialog) return;
      var r = videoDialog.getBoundingClientRect();
      if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) videoDialog.close();
    });
    dialog.querySelector('.dialog-close').addEventListener('click', function () { dialog.close(); });
    dialog.addEventListener('click', function (event) { if (event.target === dialog) { var r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close(); } });
    dialog.addEventListener('close', function () { state.dialog = false; syncPlayback(); });
    render(0, false);
  }

  loadRelease();
  initCopy();
  initTour();
})();
