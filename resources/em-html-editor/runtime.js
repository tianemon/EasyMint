/**
 * EM HTML Editor — 可视化页面编辑器运行时
 *
 * 注入到预览 HTML 中，提供：点击选中元素 → 样式面板 → 导出。
 * 借鉴 ClickDeck 的 patch 式撤销重做和面板设计。
 *
 * 用法：在父窗口（EM）中加载此脚本后，调用 EMEditor.start() 启动编辑。
 */

(function () {
  "use strict";

  // ═══════════════════════════════════════════════════════════
  // 1. 颜色预设
  // ═══════════════════════════════════════════════════════════

  var TEXT_COLORS = [
    "#111111", "#444444", "#737373", "#a3a3a3", "#d4d4d4", "#ffffff",
    "#dc2626", "#ef4444", "#f97316", "#f59e0b", "#eab308", "#84cc16",
    "#16a34a", "#14b8a6", "#06b6d4", "#0ea5e9", "#2563eb", "#4f46e5",
    "#7c3aed", "#a855f7", "#d946ef", "#ec4899", "#f43f5e", "#7f1d1d",
  ];

  var BG_COLORS = [
    { value: "transparent", label: "无背景" },
    { value: "#ffffff", label: "白色" },
    { value: "#f7f7f5", label: "浅灰" },
    { value: "#e5e7eb", label: "灰色" },
    { value: "#111111", label: "黑色" },
    { value: "#fef3c7", label: "浅黄" },
    { value: "#d9f99d", label: "浅绿" },
    { value: "#bbf7d0", label: "薄荷绿" },
    { value: "#bfdbfe", label: "浅蓝" },
    { value: "#c4b5fd", label: "浅紫" },
    { value: "#fed7aa", label: "浅橙" },
    { value: "#fecdd3", label: "浅红" },
  ];

  // ═══════════════════════════════════════════════════════════
  // 2. 选中逻辑
  // ═══════════════════════════════════════════════════════════

  function isEditorUI(el) {
    return !!(el && el.closest && el.closest("[data-em-editor]"));
  }

  function isSelectable(el) {
    if (!el || !(el instanceof HTMLElement)) return false;
    if (el === document.documentElement || el === document.body) return false;
    if (isEditorUI(el)) return false;

    var tag = el.tagName.toLowerCase();
    var contentTags = /^(h[1-6]|span|p|li|td|th|strong|em|b|i|small|mark|code|pre|blockquote|img|video|svg|canvas|button|input|select|textarea|a|label)$/;
    if (contentTags.test(tag)) return true;

    for (var i = 0; i < el.childNodes.length; i++) {
      var c = el.childNodes[i];
      if (c.nodeType === Node.TEXT_NODE && c.textContent.trim()) return true;
    }
    return false;
  }

  function isLargeContainer(el) {
    var rect = el.getBoundingClientRect();
    var viewArea = window.innerWidth * window.innerHeight;
    return (rect.width * rect.height) > viewArea * 0.4;
  }

  function resolveTarget(target) {
    if (!target || !(target instanceof HTMLElement)) return null;
    if (isEditorUI(target)) return null;
    if (isSelectable(target)) return target;

    if (isLargeContainer(target)) {
      for (var i = 0; i < target.children.length; i++) {
        var child = resolveTarget(target.children[i]);
        if (child) return child;
      }
    }
    return null;
  }

  // ═══════════════════════════════════════════════════════════
  // 3. Outline（高亮框）— 借鉴 ClickDeck overlay
  // ═══════════════════════════════════════════════════════════

  function createOutline() {
    var div = document.createElement("div");
    div.setAttribute("data-em-editor", "outline");
    Object.assign(div.style, {
      position: "fixed",
      pointerEvents: "none",
      zIndex: "99998",
      border: "2px solid #16a34a",
      borderRadius: "4px",
      // 双层 box-shadow 确保在任何背景色上都可见：
      // 内层白色环 → 绿色/深色背景上可见
      // 外层绿色光晕 → 白色/浅色背景上可见
      boxShadow: "0 0 0 1px rgba(255,255,255,0.85), 0 0 0 3px rgba(22,163,74,0.35)",
      backgroundColor: "rgba(22, 163, 74, 0.05)",
      transition: "all 0.12s ease",
      display: "none",
    });
    document.body.appendChild(div);
    return div;
  }

  function updateOutline(outline, el) {
    if (!el) { outline.style.display = "none"; return; }
    var r = el.getBoundingClientRect();
    outline.style.display = "block";
    outline.style.left = r.left + "px";
    outline.style.top = r.top + "px";
    outline.style.width = r.width + "px";
    outline.style.height = r.height + "px";
  }

  // ═══════════════════════════════════════════════════════════
  // 4. 样式操作 — 返回 {prop, before} 供 patch 记录
  // ═══════════════════════════════════════════════════════════

  /** 读取属性的当前有效值（优先 inline，其次 computed） */
  function readStyle(el, prop) {
    if (el.style[prop]) return el.style[prop];
    return getComputedStyle(el)[prop];
  }

  var STYLE_ACTIONS = {
    "font+": function (el) {
      var v = parseFloat(getComputedStyle(el).fontSize);
      return { prop: "fontSize", before: readStyle(el, "fontSize"), apply: function () { el.style.fontSize = (v + 2) + "px"; } };
    },
    "font-": function (el) {
      var v = parseFloat(getComputedStyle(el).fontSize);
      return { prop: "fontSize", before: readStyle(el, "fontSize"), apply: function () { el.style.fontSize = Math.max(8, v - 2) + "px"; } };
    },
    "align-left": function (el) {
      return { prop: "textAlign", before: readStyle(el, "textAlign"), apply: function () { el.style.textAlign = "left"; } };
    },
    "align-center": function (el) {
      return { prop: "textAlign", before: readStyle(el, "textAlign"), apply: function () { el.style.textAlign = "center"; } };
    },
    "align-right": function (el) {
      return { prop: "textAlign", before: readStyle(el, "textAlign"), apply: function () { el.style.textAlign = "right"; } };
    },
    "bold-toggle": function (el) {
      return { prop: "fontWeight", before: readStyle(el, "fontWeight"), apply: function () { el.style.fontWeight = getComputedStyle(el).fontWeight === "700" ? "400" : "700"; } };
    },
    "line-height+": function (el) {
      var v = parseFloat(getComputedStyle(el).lineHeight) || 20;
      return { prop: "lineHeight", before: readStyle(el, "lineHeight"), apply: function () { el.style.lineHeight = (v + 4) + "px"; } };
    },
    "line-height-": function (el) {
      var v = parseFloat(getComputedStyle(el).lineHeight) || 20;
      return { prop: "lineHeight", before: readStyle(el, "lineHeight"), apply: function () { el.style.lineHeight = Math.max(12, v - 4) + "px"; } };
    },
    "padding+": function (el) {
      var v = parseFloat(getComputedStyle(el).paddingTop) || 0;
      return { prop: "padding", before: readStyle(el, "padding"), apply: function () { el.style.padding = (v + 4) + "px"; } };
    },
    "padding-": function (el) {
      var v = parseFloat(getComputedStyle(el).paddingTop) || 0;
      return { prop: "padding", before: readStyle(el, "padding"), apply: function () { el.style.padding = Math.max(0, v - 4) + "px"; } };
    },
    "radius+": function (el) {
      var v = parseFloat(getComputedStyle(el).borderRadius) || 0;
      return { prop: "borderRadius", before: readStyle(el, "borderRadius"), apply: function () { el.style.borderRadius = (v + 4) + "px"; } };
    },
    "radius-": function (el) {
      var v = parseFloat(getComputedStyle(el).borderRadius) || 0;
      return { prop: "borderRadius", before: readStyle(el, "borderRadius"), apply: function () { el.style.borderRadius = Math.max(0, v - 4) + "px"; } };
    },
    "text-edit": function (el) {
      return { prop: "contentEditable", before: String(el.contentEditable), apply: function () { el.contentEditable = el.contentEditable === "true" ? "false" : "true"; if (el.contentEditable === "true") el.focus(); } };
    },
  };

  // ═══════════════════════════════════════════════════════════
  // 5. 历史（Patch 式 Undo / Redo）— 借鉴 ClickDeck
  // ═══════════════════════════════════════════════════════════

  function createHistory() {
    var undoStack = [];
    var redoStack = [];

    function applyPatch(patch, value) {
      if (patch.el && patch.el.style) {
        patch.el.style[patch.prop] = value;
      }
    }

    return {
      /** 记录一次修改：先应用，再入栈，清空 redo */
      record: function (el, prop, before, after) {
        var patch = { el: el, prop: prop, before: before, after: after };
        undoStack.push(patch);
        if (undoStack.length > 100) undoStack.shift();
        redoStack.length = 0; // 新操作清空重做栈
      },

      undo: function () {
        if (undoStack.length === 0) return false;
        var patch = undoStack.pop();
        applyPatch(patch, patch.before);
        redoStack.push(patch);
        return true;
      },

      redo: function () {
        if (redoStack.length === 0) return false;
        var patch = redoStack.pop();
        applyPatch(patch, patch.after);
        undoStack.push(patch);
        return true;
      },

      canUndo: function () { return undoStack.length > 0; },
      canRedo: function () { return redoStack.length > 0; },
    };
  }

  // ═══════════════════════════════════════════════════════════
  // 6. 面板 UI — 借鉴 ClickDeck panel，始终可见
  // ═══════════════════════════════════════════════════════════

  function createPanel() {
    var panel = document.createElement("div");
    panel.setAttribute("data-em-editor", "panel");
    panel.innerHTML =
      '<div data-em-editor="panel-inner" style="display:flex;align-items:center;gap:4px;flex-wrap:wrap">' +
        // 字号
        '<button type="button" data-action="font-" title="缩小字号" style="width:24px;height:24px;border:1px solid #d4d4d8;border-radius:4px;background:#fff;cursor:pointer;font-size:14px;line-height:1">A-</button>' +
        '<button type="button" data-action="font+" title="增大字号" style="width:24px;height:24px;border:1px solid #d4d4d8;border-radius:4px;background:#fff;cursor:pointer;font-size:14px;line-height:1">A+</button>' +
        '<span style="color:#d4d4d8;margin:0 2px">|</span>' +
        // 对齐
        '<button type="button" data-action="align-left" title="左对齐" style="width:24px;height:24px;border:1px solid #d4d4d8;border-radius:4px;background:#fff;cursor:pointer;font-size:12px">⬅</button>' +
        '<button type="button" data-action="align-center" title="居中" style="width:24px;height:24px;border:1px solid #d4d4d8;border-radius:4px;background:#fff;cursor:pointer;font-size:12px">⬌</button>' +
        '<button type="button" data-action="align-right" title="右对齐" style="width:24px;height:24px;border:1px solid #d4d4d8;border-radius:4px;background:#fff;cursor:pointer;font-size:12px">➡</button>' +
        '<span style="color:#d4d4d8;margin:0 2px">|</span>' +
        // 粗体 + 文字编辑
        '<button type="button" data-action="bold-toggle" title="切换粗体" style="width:24px;height:24px;border:1px solid #d4d4d8;border-radius:4px;background:#fff;cursor:pointer;font-weight:700;font-size:12px">B</button>' +
        '<button type="button" data-action="text-edit" title="编辑文字" style="height:24px;padding:0 6px;border:1px solid #d4d4d8;border-radius:4px;background:#fff;cursor:pointer;font-size:11px">✏️</button>' +
        '<span style="color:#d4d4d8;margin:0 2px">|</span>' +
        // 行高 + 边距 + 圆角
        '<button type="button" data-action="line-height-" title="缩小行高" style="width:24px;height:24px;border:1px solid #d4d4d8;border-radius:4px;background:#fff;cursor:pointer;font-size:10px">↕-</button>' +
        '<button type="button" data-action="line-height+" title="增大行高" style="width:24px;height:24px;border:1px solid #d4d4d8;border-radius:4px;background:#fff;cursor:pointer;font-size:10px">↕+</button>' +
        '<span style="color:#d4d4d8;margin:0 2px">|</span>' +
        '<button type="button" data-action="padding-" title="缩小边距" style="width:24px;height:24px;border:1px solid #d4d4d8;border-radius:4px;background:#fff;cursor:pointer;font-size:10px">⬜-</button>' +
        '<button type="button" data-action="padding+" title="增大边距" style="width:24px;height:24px;border:1px solid #d4d4d8;border-radius:4px;background:#fff;cursor:pointer;font-size:10px">⬜+</button>' +
        '<span style="color:#d4d4d8;margin:0 2px">|</span>' +
        '<button type="button" data-action="radius-" title="缩小圆角" style="width:24px;height:24px;border:1px solid #d4d4d8;border-radius:4px;background:#fff;cursor:pointer;font-size:10px">◯-</button>' +
        '<button type="button" data-action="radius+" title="增大圆角" style="width:24px;height:24px;border:1px solid #d4d4d8;border-radius:4px;background:#fff;cursor:pointer;font-size:10px">◯+</button>' +
        '<span style="color:#d4d4d8;margin:0 2px">|</span>' +
        // 文本颜色
        '<span style="font-size:10px;color:#666">字色</span>' +
        '<span data-em-editor="text-colors" style="display:flex;gap:2px"></span>' +
        '<span style="color:#d4d4d8;margin:0 2px">|</span>' +
        // 背景色
        '<span style="font-size:10px;color:#666">底色</span>' +
        '<span data-em-editor="bg-colors" style="display:flex;gap:2px"></span>' +
        '<span style="color:#d4d4d8;margin:0 2px">|</span>' +
        // Undo / Redo / 导出
        '<button type="button" data-action="undo" id="em-btn-undo" title="撤销 Ctrl+Z" disabled style="width:24px;height:24px;border:1px solid #d4d4d8;border-radius:4px;background:#fff;cursor:pointer;font-size:12px">↩</button>' +
        '<button type="button" data-action="redo" id="em-btn-redo" title="重做 Ctrl+Shift+Z" disabled style="width:24px;height:24px;border:1px solid #d4d4d8;border-radius:4px;background:#fff;cursor:pointer;font-size:12px">↪</button>' +
        '<button type="button" data-action="export" title="导出 HTML" style="height:24px;padding:0 8px;border:1px solid #16a34a;border-radius:4px;background:#16a34a;color:#fff;cursor:pointer;font-size:11px;font-weight:500">导出</button>' +
      '</div>';

    Object.assign(panel.style, {
      position: "fixed",
      bottom: "16px",
      left: "50%",
      transform: "translateX(-50%)",
      zIndex: "99999",
      background: "#fff",
      border: "1px solid #e4e4e7",
      borderRadius: "10px",
      padding: "8px 12px",
      boxShadow: "0 4px 24px rgba(0,0,0,0.12)",
      display: "flex",
      userSelect: "none",
    });
    document.body.appendChild(panel);

    // 填充颜色按钮
    var textColorsContainer = panel.querySelector("[data-em-editor=text-colors]");
    var bgColorsContainer = panel.querySelector("[data-em-editor=bg-colors]");
    for (var ci = 0; ci < TEXT_COLORS.length; ci++) {
      makeColorBtn(textColorsContainer, TEXT_COLORS[ci], TEXT_COLORS[ci], "字色");
    }
    for (var bi = 0; bi < BG_COLORS.length; bi++) {
      var item = BG_COLORS[bi];
      makeColorBtn(bgColorsContainer, item.value, item.label, "底色");
    }

    // 存储 undo/redo 按钮引用，供 refreshHistoryButtons 更新状态
    panel._undoBtn = panel.querySelector("#em-btn-undo");
    panel._redoBtn = panel.querySelector("#em-btn-redo");

    return panel;
  }

  function makeColorBtn(container, colorValue, label, type) {
    var btn = document.createElement("button");
    btn.type = "button";
    btn.setAttribute("data-em-editor", "color-btn");
    btn.title = label;
    Object.assign(btn.style, {
      width: "18px", height: "18px", borderRadius: "3px", border: "1px solid #d4d4d8",
      background: colorValue === "transparent"
        ? "linear-gradient(45deg, #eee 25%, transparent 25%, transparent 75%, #eee 75%)"
        : colorValue,
      cursor: "pointer", flexShrink: "0",
    });
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      if (type === "字色") EMEditor.setColor(colorValue);
      else EMEditor.setBgColor(colorValue);
    });
    container.appendChild(btn);
  }

  // ═══════════════════════════════════════════════════════════
  // 7. 编辑器主类
  // ═══════════════════════════════════════════════════════════

  var editor = null;

  function refreshHistoryButtons() {
    if (!editor || !editor.panel) return;
    var undoBtn = editor.panel._undoBtn;
    var redoBtn = editor.panel._redoBtn;
    if (undoBtn) undoBtn.disabled = !editor.history.canUndo();
    if (redoBtn) redoBtn.disabled = !editor.history.canRedo();
  }

  /** 颜色操作记录 patch */
  function recordColorPatch(el, prop, color) {
    if (!editor) return;
    var before = el.style[prop] || getComputedStyle(el)[prop];
    el.style[prop] = color;
    editor.history.record(el, prop, before, color);
    refreshHistoryButtons();
  }

  window.EMEditor = {
    start: function () {
      if (editor) return;

      var outline = createOutline();
      var panel = createPanel();
      var history = createHistory();

      editor = {
        outline: outline,
        panel: panel,
        history: history,
        selected: null,
        hoverOutline: null,
      };

      // 选中方法
      function selectElement(el) {
        editor.selected = el;
        updateOutline(outline, el);
      }

      // hover 高亮
      var hoverOutline = document.createElement("div");
      hoverOutline.setAttribute("data-em-editor", "hover-outline");
      Object.assign(hoverOutline.style, {
        position: "fixed", pointerEvents: "none", zIndex: "99997",
        border: "1px dashed rgba(22,163,74,0.35)", borderRadius: "4px",
        backgroundColor: "rgba(22,163,74,0.04)", display: "none",
      });
      document.body.appendChild(hoverOutline);
      editor.hoverOutline = hoverOutline;

      // ── 事件: mousemove ──
      function onMouseMove(e) {
        if (isEditorUI(e.target)) { hoverOutline.style.display = "none"; return; }
        var target = resolveTarget(e.target);
        if (!target) { hoverOutline.style.display = "none"; return; }
        var r = target.getBoundingClientRect();
        hoverOutline.style.display = "block";
        Object.assign(hoverOutline.style, {
          left: r.left + "px", top: r.top + "px",
          width: r.width + "px", height: r.height + "px",
        });
      }

      // ── 事件: mousedown（选中 / 取消选中）──
      function onMouseDown(e) {
        if (isEditorUI(e.target)) return;
        var target = resolveTarget(e.target);
        if (target && target.isContentEditable) return;
        selectElement(target);
      }

      // ── 事件: click（拦截页面链接/按钮跳转）──
      function onClick(e) {
        if (isEditorUI(e.target)) return;
        if (e.target && (e.target.isContentEditable || e.target.closest("[contenteditable=true]"))) return;
        e.preventDefault();
        e.stopPropagation();
      }

      // ── 事件: scroll / resize（同步 outline）──
      function onScrollOrResize() {
        if (editor && editor.selected) updateOutline(outline, editor.selected);
      }

      // ── 事件: Ctrl+Z / Ctrl+Shift+Z ──
      function onKeyDown(e) {
        if (!e.ctrlKey && !e.metaKey) return;
        if (e.code === "KeyZ" && !e.shiftKey) {
          e.preventDefault();
          EMEditor.undo();
        } else if (e.code === "KeyZ" && e.shiftKey) {
          e.preventDefault();
          EMEditor.redo();
        }
      }

      document.addEventListener("mousemove", onMouseMove, false);
      document.addEventListener("mousedown", onMouseDown, true);
      window.addEventListener("click", onClick, true);
      window.addEventListener("scroll", onScrollOrResize, true);
      window.addEventListener("resize", onScrollOrResize, true);
      document.addEventListener("keydown", onKeyDown, true);

      // rAF 循环：丝滑跟随（补充 scroll 事件）
      var rafId = null;
      (function syncOutline() {
        rafId = requestAnimationFrame(syncOutline);
        if (editor && editor.selected) updateOutline(outline, editor.selected);
      })();

      // 面板按钮事件
      panel.addEventListener("click", function (e) {
        var btn = e.target.closest("[data-action]");
        if (!btn) return;
        var action = btn.getAttribute("data-action");

        if (action === "undo") { EMEditor.undo(); return; }
        if (action === "redo") { EMEditor.redo(); return; }
        if (action === "export") { EMEditor.export(); return; }

        // 样式操作需要选中元素
        if (!editor.selected) return;

        var actionFn = STYLE_ACTIONS[action];
        if (!actionFn) return;

        // 1. 获取 before 值 + apply 函数
        var result = actionFn(editor.selected);
        // 2. 应用样式
        result.apply();
        // 3. 读取 after 值
        var after = editor.selected.style[result.prop];
        if (after === "" || after === undefined) after = getComputedStyle(editor.selected)[result.prop];
        // 4. 记录 patch
        if (result.before !== after) {
          editor.history.record(editor.selected, result.prop, result.before, after);
          refreshHistoryButtons();
        }
      });

      // 存储事件引用，供 stop 时移除
      editor._handlers = {
        mousemove: onMouseMove,
        mousedown: onMouseDown,
        click: onClick,
        scroll: onScrollOrResize,
        resize: onScrollOrResize,
        keydown: onKeyDown,
        rafId: rafId,
      };

      return editor;
    },

    stop: function () {
      if (editor && editor._handlers) {
        var h = editor._handlers;
        document.removeEventListener("mousemove", h.mousemove, false);
        document.removeEventListener("mousedown", h.mousedown, true);
        window.removeEventListener("click", h.click, true);
        window.removeEventListener("scroll", h.scroll, true);
        window.removeEventListener("resize", h.resize, true);
        document.removeEventListener("keydown", h.keydown, true);
        if (h.rafId) cancelAnimationFrame(h.rafId);
      }
      document.querySelectorAll("[data-em-editor]").forEach(function (el) { el.remove(); });
      editor = null;
    },

    undo: function () {
      if (!editor) return;
      editor.history.undo();
      updateOutline(editor.outline, editor.selected);
      refreshHistoryButtons();
    },

    redo: function () {
      if (!editor) return;
      editor.history.redo();
      updateOutline(editor.outline, editor.selected);
      refreshHistoryButtons();
    },

    /** 设置文字颜色 */
    setColor: function (color) {
      if (!editor || !editor.selected) return;
      recordColorPatch(editor.selected, "color", color);
    },

    /** 设置背景色 */
    setBgColor: function (color) {
      if (!editor || !editor.selected) return;
      recordColorPatch(editor.selected, "backgroundColor", color);
    },

    /** 导出当前 HTML */
    export: function () {
      var html = "<!DOCTYPE html>\n" + document.documentElement.outerHTML;
      try { window.parent.postMessage({ type: "em-editor-export", html: html }, "*"); } catch (e) { /* */ }
      var blob = new Blob([html], { type: "text/html" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url; a.download = "edited.html"; a.click();
      URL.revokeObjectURL(url);
    },

    /** 加载 HTML 到编辑器 */
    load: function (html) {
      document.open();
      document.write(html);
      document.close();
    },
  };
})();
