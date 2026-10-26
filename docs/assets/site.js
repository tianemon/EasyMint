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

  function initHeroVideo() {
    var video = document.getElementById('heroVideo');
    var button = document.getElementById('heroToggle');
    if (!video || !button || typeof video.play !== 'function') return;

    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');

    function label(playing) {
      button.textContent = playing ? '暂停' : '播放';
      button.setAttribute('aria-label', playing ? '暂停动效' : '播放动效');
    }
    function play() {
      var result = video.play();
      if (result && typeof result.then === 'function') {
        result.then(function () { label(true); }, function () { label(false); });
      } else {
        label(true);
      }
    }
    function pause() { video.pause(); label(false); }

    video.addEventListener('play', function () { label(true); });
    video.addEventListener('pause', function () { label(false); });
    button.addEventListener('click', function () { video.paused ? play() : pause(); });

    if (reduce && reduce.matches) { label(false); return; }

    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) { entry.isIntersecting ? play() : video.pause(); });
      }, { threshold: 0.25 });
      io.observe(video);
    } else {
      play();
    }
  }

  loadRelease();
  initCopy();
  initReveal();
  initHeroVideo();
})();
