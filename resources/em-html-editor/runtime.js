/**
 * EM HTML Editor — 可视化页面编辑器运行时
 *
 * 注入到预览 HTML 中，提供：点击选中元素 → 样式面板 → 导出。
 * 借鉴 ClickDeck 的选中机制和 Anchor Deck 的颜色预设。
 *
 * 用法：在父窗口（EM）中加载此脚本后，new EMEditor() 即可启动编辑模式。
 */

(function () {
  "use strict";

  // ═══════════════════════════════════════════════════════════
  // 1. 颜色预设（借鉴 Anchor Deck）
  // ═══════════════════════════════════════════════════════════

  const TEXT_COLORS = [
    "#111111", "#444444", "#737373", "#a3a3a3", "#d4d4d4", "#ffffff",
    "#dc2626", "#ef4444", "#f97316", "#f59e0b", "#eab308", "#84cc16",
    "#16a34a", "#14b8a6", "#06b6d4", "#0ea5e9", "#2563eb", "#4f46e5",
    "#7c3aed", "#a855f7", "#d946ef", "#ec4899", "#f43f5e", "#7f1d1d",
  ];

  const BG_COLORS = [
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
  // 2. 选中逻辑（借鉴 ClickDeck）
  // ═══════════════════════════════════════════════════════════

  function isEditorUI(el) {
    return !!(el && el.closest && el.closest("[data-em-editor]"));
  }

  function isSelectable(el) {
    if (!el || !(el instanceof HTMLElement)) return false;
    if (el === document.documentElement || el === document.body) return false;
    if (isEditorUI(el)) return false;

    var tag = el.tagName.toLowerCase();
    // 明确内容元素：直接可选
    var contentTags = /^(h[1-6]|span|p|li|td|th|strong|em|b|i|small|mark|code|pre|blockquote|img|video|svg|canvas|button|input|select|textarea|a|label)$/;
    if (contentTags.test(tag)) return true;

    // 包含文本的 div/section 等
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

  /** 点击目标 → 解析最合适的可编辑元素 */
  function resolveTarget(target) {
    if (!target || !(target instanceof HTMLElement)) return null;
    if (isEditorUI(target)) return null;
    if (isSelectable(target)) return target;

    // 大容器：钻入有意义的子元素
    if (isLargeContainer(target)) {
      for (var i = 0; i < target.children.length; i++) {
        var child = resolveTarget(target.children[i]);
        if (child) return child;
      }
    }
    return null;
  }

  // ═══════════════════════════════════════════════════════════
  // 3. Outline（高亮框）
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
      backgroundColor: "rgba(22, 163, 74, 0.06)",
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
  // 4. 样式操作（原子操作）
  // ═══════════════════════════════════════════════════════════

  var STYLE_ACTIONS = {
    "font+": function (el) {
      var v = parseFloat(getComputedStyle(el).fontSize);
      el.style.fontSize = (v + 2) + "px";
    },
    "font-": function (el) {
      var v = parseFloat(getComputedStyle(el).fontSize);
      el.style.fontSize = Math.max(8, v - 2) + "px";
    },
    "align-left": function (el) { el.style.textAlign = "left"; },
    "align-center": function (el) { el.style.textAlign = "center"; },
    "align-right": function (el) { el.style.textAlign = "right"; },
    "bold-toggle": function (el) {
      el.style.fontWeight = getComputedStyle(el).fontWeight === "700" ? "400" : "700";
    },
    "text-edit": function (el) {
      el.contentEditable = el.contentEditable === "true" ? "false" : "true";
      if (el.contentEditable === "true") el.focus();
    },
  };

  // ═══════════════════════════════════════════════════════════
  // 5. 历史（Undo / Redo）
  // ═══════════════════════════════════════════════════════════

  function createHistory() {
    var stack = [];
    var idx = -1;
    return {
      push: function (html) {
        stack = stack.slice(0, idx + 1);
        stack.push(html);
        idx = stack.length - 1;
        if (stack.length > 50) { stack.shift(); idx--; }
      },
      undo: function () {
        if (idx > 0) { idx--; return stack[idx]; }
        return null;
      },
      redo: function () {
        if (idx < stack.length - 1) { idx++; return stack[idx]; }
        return null;
      },
    };
  }

  // ═══════════════════════════════════════════════════════════
  // 6. 浮动面板 UI
  // ═══════════════════════════════════════════════════════════

  function createPanel() {
    var panel = document.createElement("div");
    panel.setAttribute("data-em-editor", "panel");
    panel.innerHTML =
      '<div data-em-editor="panel-inner" style="display:flex;align-items:center;gap:4px;flex-wrap:wrap">' +
        // 字号
        '<button data-action="font-" title="缩小字号" style="width:24px;height:24px;border:1px solid #d4d4d8;border-radius:4px;background:#fff;cursor:pointer;font-size:14px;line-height:1">A-</button>' +
        '<button data-action="font+" title="增大字号" style="width:24px;height:24px;border:1px solid #d4d4d8;border-radius:4px;background:#fff;cursor:pointer;font-size:14px;line-height:1">A+</button>' +
        '<span style="color:#d4d4d8;margin:0 2px">|</span>' +
        // 对齐
        '<button data-action="align-left" title="左对齐" style="width:24px;height:24px;border:1px solid #d4d4d8;border-radius:4px;background:#fff;cursor:pointer;font-size:12px">⬅</button>' +
        '<button data-action="align-center" title="居中" style="width:24px;height:24px;border:1px solid #d4d4d8;border-radius:4px;background:#fff;cursor:pointer;font-size:12px">⬌</button>' +
        '<button data-action="align-right" title="右对齐" style="width:24px;height:24px;border:1px solid #d4d4d8;border-radius:4px;background:#fff;cursor:pointer;font-size:12px">➡</button>' +
        '<span style="color:#d4d4d8;margin:0 2px">|</span>' +
        // 粗体 + 文字编辑
        '<button data-action="bold-toggle" title="切换粗体" style="width:24px;height:24px;border:1px solid #d4d4d8;border-radius:4px;background:#fff;cursor:pointer;font-weight:700;font-size:12px">B</button>' +
        '<button data-action="text-edit" title="编辑文字" style="height:24px;padding:0 6px;border:1px solid #d4d4d8;border-radius:4px;background:#fff;cursor:pointer;font-size:11px">✏️</button>' +
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
        '<button data-action="undo" title="撤销" style="width:24px;height:24px;border:1px solid #d4d4d8;border-radius:4px;background:#fff;cursor:pointer;font-size:12px">↩</button>' +
        '<button data-action="redo" title="重做" style="width:24px;height:24px;border:1px solid #d4d4d8;border-radius:4px;background:#fff;cursor:pointer;font-size:12px">↪</button>' +
        '<button data-action="export" title="导出 HTML" style="height:24px;padding:0 8px;border:1px solid #16a34a;border-radius:4px;background:#16a34a;color:#fff;cursor:pointer;font-size:11px;font-weight:500">导出</button>' +
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
      display: "none",
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

    return panel;
  }

  function makeColorBtn(container, colorValue, label, type) {
    var btn = document.createElement("button");
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

  window.EMEditor = {
    /** 启动编辑模式 */
    start: function () {
      if (editor) return;
      var outline = createOutline();
      var panel = createPanel();
      var history = createHistory();
      editor = { select: null, outline: outline, panel: panel, history: history, selected: null };

      history.push(document.documentElement.outerHTML);

      editor.select = function (el) {
        editor.selected = el;
        updateOutline(outline, el);
        panel.style.display = el ? "flex" : "none";
      };

      // 点击页面选中（mousedown 选，click 拦截跳转）
      document.addEventListener("mousedown", function (e) {
        if (isEditorUI(e.target)) return;
        var target = resolveTarget(e.target);
        if (target && target.isContentEditable) return;
        editor.select(target);
      }, true);

      // click 阶段拦截链接/按钮/表单的原生行为
      document.addEventListener("click", function (e) {
        if (isEditorUI(e.target)) return;
        var target = resolveTarget(e.target);
        if (target && target.isContentEditable) return;
        if (e.target.closest("a") || e.target.closest("button") || e.target.closest("form")) {
          e.preventDefault();
          e.stopPropagation();
        }
      }, true);

      // rAF 循环：每帧同步 outline 位置（滚动/动画时丝滑跟随）
      var rafId = null;
      (function syncOutline() {
        rafId = requestAnimationFrame(syncOutline);
        if (editor && editor.selected) updateOutline(outline, editor.selected);
      })();
      // 停止编辑时取消循环
      var origStop = EMEditor.stop;
      EMEditor.stop = function () {
        if (rafId) cancelAnimationFrame(rafId);
        origStop();
      };

      // 面板按钮事件
      panel.addEventListener("click", function (e) {
        var btn = e.target.closest("[data-action]");
        if (!btn || !editor.selected) return;
        var action = btn.getAttribute("data-action");

        if (STYLE_ACTIONS[action]) {
          history.push(document.documentElement.outerHTML);
          STYLE_ACTIONS[action](editor.selected);
        } else if (action === "undo") {
          var html = history.undo();
          if (html) restoreHTML(html);
        } else if (action === "redo") {
          var html = history.redo();
          if (html) restoreHTML(html);
        } else if (action === "export") {
          EMEditor.export();
        }
      });

      function restoreHTML(html) {
        document.open();
        document.write(html);
        document.close();
        editor.selected = null;
        updateOutline(outline, null);
      }

      return editor;
    },

    /** 停止编辑 */
    stop: function () {
      document.querySelectorAll("[data-em-editor]").forEach(function (el) { el.remove(); });
      editor = null;
    },

    /** 设置文字颜色 */
    setColor: function (color) {
      if (!editor || !editor.selected) return;
      editor.history.push(document.documentElement.outerHTML);
      editor.selected.style.color = color;
    },

    /** 设置背景色 */
    setBgColor: function (color) {
      if (!editor || !editor.selected) return;
      editor.history.push(document.documentElement.outerHTML);
      editor.selected.style.backgroundColor = color;
    },

    /** 导出当前 HTML */
    export: function () {
      var html = "<!DOCTYPE html>\n" + document.documentElement.outerHTML;
      // 通过 postMessage 发送给父窗口（EM），同时触发下载
      try { window.parent.postMessage({ type: "em-editor-export", html: html }, "*"); } catch (e) { /* */ }
      // fallback：触发下载
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
