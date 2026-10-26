(function () {
  'use strict';

  var REPO = 'tianemon/EasyMint';
  var RELEASES = 'https://github.com/' + REPO + '/releases/latest';

  var MATCH = {
    mac: /EasyMint-macOS-arm64\.dmg$/i,
    win: /EasyMint-windows-x64\.exe$/i,
    linux: /EasyMint-linux-x86_64\.AppImage$/i
  };

  var LABEL = {
    mac: '下载 · macOS（Apple 芯片）',
    win: '下载 · Windows x64',
    linux: '下载 · Linux x64'
  };

  function detectOS() {
    var ua = navigator.userAgent;
    if (/Mac OS X|Macintosh/i.test(ua) && !/iPhone|iPad/i.test(ua)) return 'mac';
    if (/Windows/i.test(ua)) return 'win';
    if (/Linux|X11/i.test(ua) && !/Android/i.test(ua)) return 'linux';
    return null;
  }

  function setDownloadButtons(os, url, label) {
    var nodes = document.querySelectorAll('[data-download]');
    for (var i = 0; i < nodes.length; i++) {
      nodes[i].href = url;
      if (label && nodes[i].hasAttribute('data-label')) nodes[i].textContent = label;
    }
  }

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

    var os = detectOS();
    if (os && byOS[os]) setDownloadButtons(os, byOS[os], LABEL[os]);
    else if (os) setDownloadButtons(os, RELEASES, LABEL[os]);
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
      .catch(function () {
        var os = detectOS();
        if (os) setDownloadButtons(os, RELEASES, LABEL[os]);
      });
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

  function initReveal() {
    var items = document.querySelectorAll('.reveal');
    if (!('IntersectionObserver' in window)) {
      Array.prototype.forEach.call(items, function (el) { el.classList.add('in'); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('in');
        io.unobserve(entry.target);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });

    Array.prototype.forEach.call(items, function (el) { io.observe(el); });
  }

  function initTour() {
    var stack = document.getElementById('tourStack');
    var dots = document.getElementById('tourDots');
    var section = document.getElementById('tour');
    if (!stack || !dots || !section) return;

    var AUTO_MS = 6500;
    var cards = Array.prototype.slice.call(stack.querySelectorAll('.stack-card'));
    var panels = Array.prototype.slice.call(section.querySelectorAll('[data-tour-panel]'));
    var dotButtons = Array.prototype.slice.call(dots.querySelectorAll('.dot'));
    var counter = section.querySelector('[data-tour-index]');
    var total = cards.length;
    var current = 0;
    var timer = null;
    var paused = false;
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');

    dots.style.setProperty('--auto-ms', AUTO_MS + 'ms');

    dotButtons.forEach(function (dot) {
      var span = dot.querySelector('span');
      if (span && !span.querySelector('i')) span.appendChild(document.createElement('i'));
    });

    function render(next) {
      current = (next + total) % total;

      cards.forEach(function (card, i) {
        var offset = (i - current + total) % total;
        var pos = 'x';
        if (offset === 0) pos = '0';
        else if (offset === 1) pos = '1';
        else if (offset === 2) pos = '2';
        else if (offset === total - 1) pos = '-1';
        card.setAttribute('data-pos', pos);
      });

      panels.forEach(function (panel, i) {
        panel.classList.toggle('is-active', i === current);
      });

      dotButtons.forEach(function (dot, i) {
        var active = i === current;
        dot.classList.toggle('is-active', active);
        if (active) dot.setAttribute('aria-current', 'true');
        else dot.removeAttribute('aria-current');
      });

      if (counter) counter.textContent = ('0' + (current + 1)).slice(-2);
    }

    function restartProgress() {
      var bar = dotButtons[current] && dotButtons[current].querySelector('i');
      if (!bar) return;
      bar.style.animation = 'none';
      void bar.offsetWidth;
      bar.style.animation = '';
    }

    function schedule() {
      clearTimeout(timer);
      if (paused || (reduce && reduce.matches)) return;
      timer = setTimeout(function () {
        render(current + 1);
        schedule();
      }, AUTO_MS);
    }

    function pause() {
      if (paused) return;
      paused = true;
      clearTimeout(timer);
      dots.classList.add('is-paused');
    }

    function resume() {
      if (!paused) return;
      paused = false;
      dots.classList.remove('is-paused');
      restartProgress();
      schedule();
    }

    function goto(next) {
      render(next);
      if (!paused) {
        dots.classList.remove('is-paused');
        restartProgress();
        schedule();
      }
    }

    dots.addEventListener('click', function (event) {
      var button = event.target.closest('.dot');
      if (!button) return;
      goto(dotButtons.indexOf(button));
    });

    dots.addEventListener('keydown', function (event) {
      if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
      event.preventDefault();
      goto(current + (event.key === 'ArrowRight' ? 1 : -1));
      dotButtons[current].focus();
    });

    var startX = null;
    var stage = section.querySelector('.tour-stage');
    stage.addEventListener('pointerdown', function (event) { startX = event.clientX; });
    stage.addEventListener('pointerup', function (event) {
      if (startX === null) return;
      var delta = event.clientX - startX;
      startX = null;
      if (Math.abs(delta) < 48) return;
      goto(current + (delta < 0 ? 1 : -1));
    });
    stage.addEventListener('pointercancel', function () { startX = null; });

    section.addEventListener('pointerenter', pause);
    section.addEventListener('pointerleave', resume);
    section.addEventListener('focusin', pause);
    section.addEventListener('focusout', function (event) {
      if (!section.contains(event.relatedTarget)) resume();
    });

    document.addEventListener('visibilitychange', function () {
      if (document.hidden) pause(); else resume();
    });

    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) { if (!section.matches(':hover')) resume(); }
          else pause();
        });
      }, { threshold: 0.35 });
      io.observe(section);
    }

    render(0);
    schedule();
  }

  loadRelease();  loadRelease();
  initCopy();
  initReveal();
  initTour();
})();
