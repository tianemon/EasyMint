/**
 * EM HTML Editor — 可视化页面编辑器运行时
 *
 * 注入到预览 HTML 中，提供：
 *   画布转换 → 点击选中 → 拖动移位 → resize → 样式编辑 → 撤销重做 → 导出
 *
 * 借鉴 ClickDeck（patch 式撤销重做、选中机制）和
 * html-deck-editor（画布式布局、拖动/resize 手柄）。
 */
(function () {
  "use strict";

  // ═══════════════════════════════════════════════════════════
  // 1. 常量
  // ═══════════════════════════════════════════════════════════

  var TEXT_COLORS = [
    "#111111", "#444444", "#737373", "#a3a3a3", "#d4d4d4", "#ffffff",
    "#dc2626", "#ef4444", "#f97316", "#f59e0b", "#eab308", "#84cc16",
    "#16a34a", "#14b8a6", "#06b6d4", "#0ea5e9", "#2563eb", "#4f46e5",
    "#7c3aed", "#a855f7", "#d946ef", "#ec4899", "#f43f5e", "#7f1d1d",
    "#78350f", "#365314", "#064e3b", "#0f172a", "#312e81", "#581c87"
  ];

  var BG_COLORS = [
    { value: "transparent", label: "无背景" },
    { value: "#ffffff", label: "白色" },
    { value: "#f7f7f5", label: "浅灰" },
    { value: "#e5e7eb", label: "灰色" },
    { value: "#d4d4d4", label: "中灰" },
    { value: "#111111", label: "黑色" },
    { value: "#fff2b8", label: "浅黄" },
    { value: "#fde68a", label: "暖黄" },
    { value: "#ffd6e7", label: "浅粉" },
    { value: "#fecdd3", label: "玫瑰粉" },
    { value: "#d9f99d", label: "浅绿" },
    { value: "#bbf7d0", label: "薄荷绿" },
    { value: "#99f6e4", label: "青绿" },
    { value: "#bfdbfe", label: "浅蓝" },
    { value: "#bae6fd", label: "天蓝" },
    { value: "#c4b5fd", label: "浅紫" },
    { value: "#fed7aa", label: "浅橙" },
    { value: "#fca5a5", label: "浅红" },
    { value: "#ff3d8b", label: "洋红" },
    { value: "#f97316", label: "橙色" },
    { value: "#eab308", label: "黄色" },
    { value: "#22c55e", label: "绿色" },
    { value: "#14b8a6", label: "青色" },
    { value: "#0ea5e9", label: "亮蓝" },
    { value: "#1f2be0", label: "蓝色" },
    { value: "#7c3aed", label: "紫色" },
    { value: "#0f172a", label: "深蓝灰" }
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
    // canvas 内的元素全部直接可选，不钻子元素（用户需要选中/拖动整个容器）
    if (target.closest("#em-canvas")) return target;
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
  // 3. Outline（选中高亮框）
  // ═══════════════════════════════════════════════════════════

  function createOutline() {
    var div = document.createElement("div");
    div.setAttribute("data-em-editor", "outline");
    Object.assign(div.style, {
      position: "fixed", pointerEvents: "none", zIndex: "99998",
      border: "2px solid #16a34a", borderRadius: "4px",
      boxShadow: "0 0 0 1px rgba(255,255,255,0.85), 0 0 0 3px rgba(22,163,74,0.35)",
      backgroundColor: "rgba(22, 163, 74, 0.05)",
      transition: "all 0.12s ease", display: "none",
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
  // 4. EditorFrame（选中框：拖动把手 + resize 手柄 + 删除按钮）
  // ═══════════════════════════════════════════════════════════

  function createEditorFrame() {
    var frame = document.createElement("div");
    frame.setAttribute("data-em-editor", "editor-frame");
    Object.assign(frame.style, {
      position: "fixed", pointerEvents: "none", zIndex: "99999",
      display: "none",
    });
    frame.innerHTML =
      '<div data-em-editor="frame-drag-handle" style="' +
        'position:absolute;top:-28px;left:0;right:0;min-height:24px;' +
        'background:#16a34a;border-radius:4px 4px 0 0;' +
        'display:flex;align-items:center;justify-content:center;gap:4px;' +
        'cursor:grab;pointer-events:auto;color:#fff;font-size:10px;' +
        'line-height:1.3;padding:2px 6px;white-space:normal;word-break:break-all;user-select:none' +
      '"><span id="em-frame-label">拖动</span></div>' +
      '<button data-em-editor="frame-delete-btn" style="' +
        'position:absolute;top:-28px;right:0;min-width:24px;min-height:24px;' +
        'border:none;background:transparent;color:#fff;font-size:16px;' +
        'cursor:pointer;pointer-events:auto;line-height:1' +
      '" title="删除 (Delete)">×</button>' +
      // 四角 resize 手柄
      '<div data-em-editor="frame-resize" data-handle="nw" style="position:absolute;top:-6px;left:-6px;width:10px;height:10px;background:#fff;border:2px solid #16a34a;border-radius:2px;cursor:nwse-resize;pointer-events:auto"></div>' +
      '<div data-em-editor="frame-resize" data-handle="ne" style="position:absolute;top:-6px;right:-6px;width:10px;height:10px;background:#fff;border:2px solid #16a34a;border-radius:2px;cursor:nesw-resize;pointer-events:auto"></div>' +
      '<div data-em-editor="frame-resize" data-handle="sw" style="position:absolute;bottom:-6px;left:-6px;width:10px;height:10px;background:#fff;border:2px solid #16a34a;border-radius:2px;cursor:nesw-resize;pointer-events:auto"></div>' +
      '<div data-em-editor="frame-resize" data-handle="se" style="position:absolute;bottom:-6px;right:-6px;width:10px;height:10px;background:#fff;border:2px solid #16a34a;border-radius:2px;cursor:nwse-resize;pointer-events:auto"></div>';

    document.body.appendChild(frame);
    frame._dragHandle = frame.querySelector("[data-em-editor=frame-drag-handle]");
    frame._deleteBtn = frame.querySelector("[data-em-editor=frame-delete-btn]");
    frame._resizeHandles = frame.querySelectorAll("[data-em-editor=frame-resize]");
    return frame;
  }

  function updateFramePosition(frame, el) {
    if (!el) { frame.style.display = "none"; return; }
    var r = el.getBoundingClientRect();
    var flipped = r.top < 60;
    frame.style.display = "block";
    frame.style.left = (r.left - 2) + "px";
    frame.style.top = (r.top - 2) + "px";
    frame.style.width = (r.width + 4) + "px";
    frame.style.height = (r.height + 4) + "px";
    // 用 JS 直接设 style 覆盖行内样式（CSS class 优先级不够）
    var handle = frame._dragHandle;
    var delBtn = frame._deleteBtn;
    // 根据实际高度动态偏移，避免覆盖选中框
    var handleH = Math.max(handle.offsetHeight, 24);
    if (flipped) {
      handle.style.top = "auto"; handle.style.bottom = (-handleH) + "px"; handle.style.borderRadius = "0 0 4px 4px";
      delBtn.style.top = "auto"; delBtn.style.bottom = (-handleH) + "px";
    } else {
      handle.style.top = (-handleH) + "px"; handle.style.bottom = "auto"; handle.style.borderRadius = "4px 4px 0 0";
      delBtn.style.top = (-handleH) + "px"; delBtn.style.bottom = "auto";
    }
  }

  /** 描述元素的简短标识：tag + 关键 class */
  function describeElement(el) {
    if (!el) return "(空)";
    var tag = el.tagName.toLowerCase();
    var cls = "";
    if (el.classList && el.classList.length) {
      // 取前两个最可能语义化的 class
      var parts = [];
      for (var ci = 0; ci < Math.min(el.classList.length, 2); ci++) {
        parts.push(el.classList[ci]);
      }
      cls = "." + parts.join(".");
    }
    var id = el.id ? "#" + el.id : "";
    return tag + id + cls;
  }

  /** 获取元素在 canvas 中的层级路径 */
  function getElementPath(el) {
    var parts = [];
    var cur = el;
    var canvas = document.getElementById("em-canvas");
    while (cur && cur !== canvas && cur !== document.body) {
      parts.unshift(describeElement(cur));
      cur = cur.parentElement;
    }
    if (cur === canvas) parts.unshift("canvas");
    return parts.join(" › ");
  }

  // ═══════════════════════════════════════════════════════════
  // 5. 样式操作 — 返回 {prop, before, apply}
  // ═══════════════════════════════════════════════════════════

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
    "italic-toggle": function (el) {
      return { prop: "fontStyle", before: readStyle(el, "fontStyle"), apply: function () { el.style.fontStyle = getComputedStyle(el).fontStyle === "italic" ? "normal" : "italic"; } };
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
  };

  // ═══════════════════════════════════════════════════════════
  // 6. 历史系统（Patch 式）
  // ═══════════════════════════════════════════════════════════

  function createHistory() {
    var undoStack = [];
    var redoStack = [];

    function applyValue(patch, value) {
      switch (patch.type) {
        case "style":
          if (patch.el && patch.el.style) patch.el.style[patch.prop] = value;
          break;
        case "move":
          if (patch.el && patch.el.style) { patch.el.style.left = value.l; patch.el.style.top = value.t; }
          break;
        case "resize":
          if (patch.el && patch.el.style) {
            patch.el.style.width = value.w; patch.el.style.height = value.h;
            patch.el.style.left = value.l; patch.el.style.top = value.t;
          }
          break;
        case "delete":
          // value.html contains the element's outerHTML; value.pEl is parent; value.ref is nextSibling
          var tmp = document.createElement("div");
          tmp.innerHTML = value.h;
          var restored = tmp.firstChild;
          if (value.ref && value.ref.parentNode === value.pEl) {
            value.pEl.insertBefore(restored, value.ref);
          } else if (value.pEl) {
            value.pEl.appendChild(restored);
          }
          patch.el = restored;
          break;
        case "add":
          if (patch.el && patch.el.parentNode) patch.el.remove();
          break;
      }
    }

    return {
      record: function (type, el, before, after, extra) {
        var patch = { type: type, el: el, before: before, after: after };
        if (extra) { patch.parent = extra.parent; patch.nextSibling = extra.nextSibling; patch.html = extra.html; patch.prop = extra.prop; }
        undoStack.push(patch);
        if (undoStack.length > 100) undoStack.shift();
        redoStack.length = 0;
      },

      undo: function () {
        if (undoStack.length === 0) return false;
        var patch = undoStack.pop();
        applyValue(patch, patch.before);
        redoStack.push(patch);
        return true;
      },

      redo: function () {
        if (redoStack.length === 0) return false;
        var patch = redoStack.pop();
        applyValue(patch, patch.after);
        undoStack.push(patch);
        return true;
      },

      canUndo: function () { return undoStack.length > 0; },
      canRedo: function () { return redoStack.length > 0; },
    };
  }

  /** 将元素的关键计算样式冻结为行内样式，避免更换父容器后样式丢失 */
  function freezeStyles(el) {
    var cs = getComputedStyle(el);
    var props = ["color","backgroundColor","fontSize","fontWeight","fontFamily",
      "fontStyle","textAlign","lineHeight","borderRadius",
      "boxSizing","opacity","letterSpacing"];
    for (var pi = 0; pi < props.length; pi++) {
      var p = props[pi];
      var v = cs[p];
      // 不覆盖已有的行内样式（保留用户手动设置的）
      if (el.style[p] && el.style[p] !== "") continue;
      el.style[p] = v;
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 7. 面板 UI
  // ═══════════════════════════════════════════════════════════

  function createPanel() {
    var panel = document.createElement("div");
    panel.setAttribute("data-em-editor", "panel");
    panel.innerHTML =
      '<div data-em-editor="panel-inner" style="display:flex;align-items:center;gap:4px;flex-wrap:wrap">' +
        // Undo / Redo
        '<button type="button" data-action="undo" id="em-btn-undo" title="撤销 Ctrl+Z" disabled style="width:28px;height:28px;border:1px solid #d4d4d8;border-radius:4px;background:#fff;cursor:pointer;font-size:14px;line-height:1">↩</button>' +
        '<button type="button" data-action="redo" id="em-btn-redo" title="重做 Ctrl+Shift+Z" disabled style="width:28px;height:28px;border:1px solid #d4d4d8;border-radius:4px;background:#fff;cursor:pointer;font-size:14px;line-height:1">↪</button>' +
        '<span style="color:#d4d4d8;margin:0 2px">|</span>' +
        // 添加元素
        '<button type="button" data-action="add-text" title="添加文字" style="height:28px;padding:0 8px;border:1px solid #d4d4d8;border-radius:4px;background:#fff;cursor:pointer;font-size:12px">+文字</button>' +
        '<button type="button" data-action="add-image" title="添加图片" style="height:28px;padding:0 8px;border:1px solid #d4d4d8;border-radius:4px;background:#fff;cursor:pointer;font-size:12px">+图片</button>' +
        '<span style="color:#d4d4d8;margin:0 2px">|</span>' +
        // 字号
        '<button type="button" data-action="font-" title="缩小字号" style="width:24px;height:24px;border:1px solid #d4d4d8;border-radius:4px;background:#fff;cursor:pointer;font-size:14px;line-height:1">A-</button>' +
        '<button type="button" data-action="font+" title="增大字号" style="width:24px;height:24px;border:1px solid #d4d4d8;border-radius:4px;background:#fff;cursor:pointer;font-size:14px;line-height:1">A+</button>' +
        '<span style="color:#d4d4d8;margin:0 2px">|</span>' +
        // 对齐
        '<button type="button" data-action="align-left" title="左对齐" style="width:24px;height:24px;border:1px solid #d4d4d8;border-radius:4px;background:#fff;cursor:pointer;font-size:12px">⬅</button>' +
        '<button type="button" data-action="align-center" title="居中" style="width:24px;height:24px;border:1px solid #d4d4d8;border-radius:4px;background:#fff;cursor:pointer;font-size:12px">⬌</button>' +
        '<button type="button" data-action="align-right" title="右对齐" style="width:24px;height:24px;border:1px solid #d4d4d8;border-radius:4px;background:#fff;cursor:pointer;font-size:12px">➡</button>' +
        '<span style="color:#d4d4d8;margin:0 2px">|</span>' +
        // 粗体 + 斜体
        '<button type="button" data-action="bold-toggle" title="切换粗体" style="width:24px;height:24px;border:1px solid #d4d4d8;border-radius:4px;background:#fff;cursor:pointer;font-weight:700;font-size:12px">B</button>' +
        '<button type="button" data-action="italic-toggle" title="切换斜体" style="width:24px;height:24px;border:1px solid #d4d4d8;border-radius:4px;background:#fff;cursor:pointer;font-style:italic;font-size:12px">I</button>' +
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
        // 导出
        '<button type="button" data-action="export" title="导出 HTML" style="height:28px;padding:0 10px;border:1px solid #16a34a;border-radius:4px;background:#16a34a;color:#fff;cursor:pointer;font-size:12px;font-weight:500">导出</button>' +
      '</div>';

    Object.assign(panel.style, {
      position: "fixed", bottom: "16px", left: "50%", transform: "translateX(-50%)",
      zIndex: "99999", background: "#fff", border: "1px solid #e4e4e7",
      borderRadius: "10px", padding: "8px 12px",
      boxShadow: "0 4px 24px rgba(0,0,0,0.12)", display: "flex", userSelect: "none",
    });
    document.body.appendChild(panel);

    // 填充颜色按钮
    var tc = panel.querySelector("[data-em-editor=text-colors]");
    var bc = panel.querySelector("[data-em-editor=bg-colors]");
    for (var ci = 0; ci < TEXT_COLORS.length; ci++) {
      makeColorBtn(tc, TEXT_COLORS[ci], TEXT_COLORS[ci], "字色");
    }
    for (var bi = 0; bi < BG_COLORS.length; bi++) {
      var item = BG_COLORS[bi];
      makeColorBtn(bc, item.value, item.label, "底色");
    }

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
  // 8. HTML 转换引擎
  // ═══════════════════════════════════════════════════════════

  function convertToCanvas() {
    var canvas = document.createElement("div");
    canvas.id = "em-canvas";
    // 注意：canvas 不能有 data-em-editor 属性，否则 isEditorUI 会把画布内所有元素排除
    canvas.style.position = "relative";
    canvas.style.margin = "0";
    canvas.style.padding = "0";
    canvas.style.minHeight = window.innerHeight + "px";

    // 收集 body 的所有直接子元素
    var children = [];
    // 先收集为静态数组，避免 live NodeList 在移动元素时被修改导致跳过
    var bodyChildren = [];
    var rawChildren = document.body.childNodes;
    for (var ri = 0; ri < rawChildren.length; ri++) bodyChildren.push(rawChildren[ri]);
    for (var i = 0; i < bodyChildren.length; i++) {
      var node = bodyChildren[i];
      // 跳过编辑 UI、文本节点、脚本、样式
      if (isEditorUI(node)) continue;
      if (node.nodeType === Node.TEXT_NODE && !node.textContent.trim()) continue;
      if (node.nodeType !== Node.ELEMENT_NODE) continue;
      var tag = node.tagName.toLowerCase();
      if (tag === "script" || tag === "style" || tag === "link" || tag === "meta" || tag === "noscript") continue;
      children.push(node);
    }

    // 第一遍：收集所有元素的坐标（必须在修改任何元素之前完成，
    // 否则 position:absolute 会让后续元素在文档流中移位）
    var snapshots = [];
    var maxBottom = 0;
    var maxRight = 0;
    var scrollX = window.scrollX || window.pageXOffset || 0;
    var scrollY = window.scrollY || window.pageYOffset || 0;

    for (var j = 0; j < children.length; j++) {
      var child = children[j];
      var rect = child.getBoundingClientRect();
      var docLeft = rect.left + scrollX;
      var docTop = rect.top + scrollY;
      var docRight = docLeft + rect.width;
      var docBottom = docTop + rect.height;

      if (docRight > maxRight) maxRight = docRight;
      if (docBottom > maxBottom) maxBottom = docBottom;

      var snap = {
        el: child,
        left: docLeft, top: docTop,
        width: rect.width, height: rect.height,
        boxSizing: getComputedStyle(child).boxSizing,
      };
      snapshots.push(snap);
    }

    // 第二遍：应用绝对定位并移入 canvas（此时坐标已锁定，互不影响）
    for (var k = 0; k < snapshots.length; k++) {
      var s = snapshots[k];
      s.el.style.position = "absolute";
      s.el.style.left = s.left + "px";
      s.el.style.top = s.top + "px";
      s.el.style.width = s.width + "px";
      s.el.style.height = s.height + "px";
      s.el.style.margin = "0";
      s.el.style.zIndex = String(k + 1);
      if (s.boxSizing === "border-box") s.el.style.boxSizing = "border-box";
      canvas.appendChild(s.el);
    }

    canvas.style.width = Math.max(maxRight, window.innerWidth) + "px";
    canvas.style.height = Math.max(maxBottom, window.innerHeight) + "px";

    // 替换 body 内容，同时重置 body 样式避免默认 margin 干扰定位
    document.body.innerHTML = "";
    document.body.style.margin = "0";
    document.body.style.padding = "0";
    document.body.style.overflow = "auto";
    document.body.appendChild(canvas);
    window.scrollTo(0, 0);

    return canvas;
  }

  // ═══════════════════════════════════════════════════════════
  // 9. 编辑器主类
  // ═══════════════════════════════════════════════════════════

  var editor = null;

  function refreshHistoryButtons() {
    if (!editor || !editor.panel) return;
    var ub = editor.panel._undoBtn;
    var rb = editor.panel._redoBtn;
    if (ub) ub.disabled = !editor.history.canUndo();
    if (rb) rb.disabled = !editor.history.canRedo();
  }

  function recordColorPatch(el, prop, color) {
    if (!editor) return;
    var before = el.style[prop] || getComputedStyle(el)[prop];
    el.style[prop] = color;
    editor.history.record("style", el, before, color, { prop: prop });
    refreshHistoryButtons();
  }

  /** 同步 outline + frame 位置 */
  function syncAll(el) {
    if (!editor) return;
    updateOutline(editor.outline, el);
    updateFramePosition(editor.frame, el);
  }

  window.EMEditor = {
    start: function () {
      if (editor) return;

      // 1. 转换 HTML 为画布模式
      var canvas = convertToCanvas();

      // 2. 创建 UI 元素
      var outline = createOutline();
      var frame = createEditorFrame();
      var history = createHistory();

      editor = {
        canvas: canvas,
        outline: outline,
        frame: frame,
        panel: null, // 面板已移至 index.html 右侧栏
        history: history,
        selected: null,
        hoverOutline: null,
        _dragging: null,
        _editingText: null,
      };

      function selectElement(el) {
        editor.selected = el;
        syncAll(el);
        // 更新 frame 标签显示元素信息
        var label = document.getElementById("em-frame-label");
        if (label) label.textContent = el ? getElementPath(el) : "拖动";
        // 取消文字编辑
        if (editor._editingText && editor._editingText !== el) {
          editor._editingText.contentEditable = "false";
          editor._editingText = null;
        }
      }

      // ── hover 高亮 ──
      var hoverOutline = document.createElement("div");
      hoverOutline.setAttribute("data-em-editor", "hover-outline");
      Object.assign(hoverOutline.style, {
        position: "fixed", pointerEvents: "none", zIndex: "99997",
        border: "1px dashed rgba(22,163,74,0.40)", borderRadius: "2px",
        backgroundColor: "rgba(22,163,74,0.04)", display: "none",
      });
      document.body.appendChild(hoverOutline);
      editor.hoverOutline = hoverOutline;

      // ── mousemove ──
      function onMouseMove(e) {
        // 拖动/resize 中
        if (editor._dragging) {
          var d = editor._dragging;
          var dx = e.clientX - d.startX;
          var dy = e.clientY - d.startY;

          if (d.type === "move") {
            var newL = d.startL + dx;
            var newT = d.startT + dy;
            // Ctrl 吸附 10px
            if (e.ctrlKey || e.metaKey) { newL = Math.round(newL / 10) * 10; newT = Math.round(newT / 10) * 10; }
            editor.selected.style.left = newL + "px";
            editor.selected.style.top = newT + "px";
          } else if (d.type === "resize") {
            var newW, newH, newL, newT;
            var minW = 10, minH = 10;
            var handle = d.handle;

            if (handle === "se") {
              newW = Math.max(minW, d.startW + dx); newH = Math.max(minH, d.startH + dy);
              newL = d.startL; newT = d.startT;
            } else if (handle === "sw") {
              newW = Math.max(minW, d.startW - dx); newH = Math.max(minH, d.startH + dy);
              newL = d.startL + (d.startW - newW); newT = d.startT;
            } else if (handle === "ne") {
              newW = Math.max(minW, d.startW + dx); newH = Math.max(minH, d.startH - dy);
              newL = d.startL; newT = d.startT + (d.startH - newH);
            } else if (handle === "nw") {
              newW = Math.max(minW, d.startW - dx); newH = Math.max(minH, d.startH - dy);
              newL = d.startL + (d.startW - newW); newT = d.startT + (d.startH - newH);
            }

            if (e.shiftKey) {
              // 保持宽高比
              var ratio = d.startW / d.startH;
              if (Math.abs(newW / newH - ratio) > 0.01) {
                newH = newW / ratio;
              }
            }

            editor.selected.style.width = newW + "px";
            editor.selected.style.height = newH + "px";
            editor.selected.style.left = newL + "px";
            editor.selected.style.top = newT + "px";
          }
          syncAll(editor.selected);
          return;
        }

        if (isEditorUI(e.target)) { hoverOutline.style.display = "none"; return; }
        var target = resolveTarget(e.target);
        if (!target) { hoverOutline.style.display = "none"; return; }
        var r = target.getBoundingClientRect();
        hoverOutline.style.display = "block";
        hoverOutline.style.left = r.left + "px";
        hoverOutline.style.top = r.top + "px";
        hoverOutline.style.width = r.width + "px";
        hoverOutline.style.height = r.height + "px";
      }

      // ── mousedown ──
      function onMouseDown(e) {
        // 拖动把手
        if (e.target.closest("[data-em-editor=frame-drag-handle]") && editor.selected) {
          e.preventDefault();
          var el = editor.selected;
          var r = el.getBoundingClientRect();
          var cs = getComputedStyle(el);
          // 确保元素可拖动：非 absolute/fixed/relative 则设为 relative
          if (cs.position !== "absolute" && cs.position !== "fixed" && cs.position !== "relative") {
            el.style.position = "relative";
            el.style.left = "0px";
            el.style.top = "0px";
          }
          editor._dragging = {
            type: "move",
            startX: e.clientX, startY: e.clientY,
            startL: parseFloat(el.style.left) || 0,
            startT: parseFloat(el.style.top) || 0,
          };
          return;
        }
        // resize 手柄
        var resizeHandle = e.target.closest("[data-em-editor=frame-resize]");
        if (resizeHandle && editor.selected) {
          e.preventDefault();
          var rr = editor.selected.getBoundingClientRect();
          editor._dragging = {
            type: "resize",
            handle: resizeHandle.getAttribute("data-handle"),
            startX: e.clientX, startY: e.clientY,
            startL: parseFloat(editor.selected.style.left) || rr.left,
            startT: parseFloat(editor.selected.style.top) || rr.top,
            startW: parseFloat(editor.selected.style.width) || rr.width,
            startH: parseFloat(editor.selected.style.height) || rr.height,
          };
          return;
        }
        // 删除按钮
        if (e.target.closest("[data-em-editor=frame-delete-btn]")) {
          e.preventDefault();
          EMEditor.deleteSelected();
          return;
        }
        // 编辑 UI 不选中
        if (isEditorUI(e.target)) return;

        var target = resolveTarget(e.target);
        if (target && target.isContentEditable) return;
        selectElement(target);
      }

      // ── mouseup（拖动/resize 结束，记录 patch）──
      function onMouseUp(e) {
        if (!editor._dragging || !editor.selected) { editor._dragging = null; return; }
        var d = editor._dragging;
        var el = editor.selected;
        var newL = parseFloat(el.style.left);
        var newT = parseFloat(el.style.top);
        var newW = parseFloat(el.style.width);
        var newH = parseFloat(el.style.height);

        if (d.type === "move") {
          if (newL !== d.startL || newT !== d.startT) {
            editor.history.record("move", el,
              { l: d.startL, t: d.startT },
              { l: newL, t: newT });
            refreshHistoryButtons();
          }
          // 脱离检测：元素中心点超出父容器 → 脱离为独立 canvas 子元素
          var parent = el.parentElement;
          var canvas = document.getElementById("em-canvas");
          if (parent && parent !== canvas && parent !== document.body) {
            var elRect = el.getBoundingClientRect();
            var parentRect = parent.getBoundingClientRect();
            var cx = elRect.left + elRect.width / 2;
            var cy = elRect.top + elRect.height / 2;
            var outside = cx < parentRect.left || cx > parentRect.right ||
                          cy < parentRect.top || cy > parentRect.bottom;
            console.log("[detach] el:", describeElement(el),
              "| elRect:", Math.round(elRect.left), Math.round(elRect.top), Math.round(elRect.width), Math.round(elRect.height),
              "| center:", Math.round(cx), Math.round(cy),
              "| parent:", describeElement(parent),
              "| parentRect:", Math.round(parentRect.left), Math.round(parentRect.top), Math.round(parentRect.right), Math.round(parentRect.bottom),
              "| styleL:", el.style.left, "styleT:", el.style.top,
              "| position:", getComputedStyle(el).position,
              "| outside:", outside);
            if (outside) {
              // 视口坐标 → canvas 坐标（canvas 是 position:relative 在 document 原点）
              var sx = window.scrollX || window.pageXOffset || 0;
              var sy = window.scrollY || window.pageYOffset || 0;
              freezeStyles(el);
              el.style.position = "absolute";
              el.style.left = (elRect.left + sx) + "px";
              el.style.top = (elRect.top + sy) + "px";
              canvas.appendChild(el);
              console.log("[detach] -> canvas, scrollXY:", sx, sy, "new left:", el.style.left, "new top:", el.style.top);
            }
          }
        } else if (d.type === "resize") {
          if (newW !== d.startW || newH !== d.startH || newL !== d.startL || newT !== d.startT) {
            editor.history.record("resize", el,
              { w: d.startW, h: d.startH, l: d.startL, t: d.startT },
              { w: newW, h: newH, l: newL, t: newT });
            refreshHistoryButtons();
          }
        }
        editor._dragging = null;
      }

      // ── dblclick（文字编辑）──
      function onDblClick(e) {
        if (!editor.selected || isEditorUI(e.target)) return;
        var el = editor.selected;
        var tag = el.tagName.toLowerCase();
        var textTags = /^(h[1-6]|span|p|li|td|th|strong|em|b|i|small|mark|code|pre|a|label|div|section|article|header|footer|nav|aside|button)$/;
        if (!textTags.test(tag)) return;
        if (el.querySelector && (el.querySelector("img, video, svg, canvas, iframe"))) return;

        editor._editingText = el;
        var beforeText = el.textContent;
        el.contentEditable = "true";
        el.focus();
        // 选中全部文字方便替换
        var sel = window.getSelection();
        if (sel && el.firstChild) {
          var range = document.createRange();
          range.selectNodeContents(el);
          sel.removeAllRanges();
          sel.addRange(range);
        }

        var onBlur = function () {
          el.removeEventListener("blur", onBlur);
          el.contentEditable = "false";
          var afterText = el.textContent;
          if (beforeText !== afterText) {
            editor.history.record("style", el, beforeText, afterText, { prop: "textContent" });
            refreshHistoryButtons();
          }
          editor._editingText = null;
        };
        el.addEventListener("blur", onBlur);
      }

      // ── click 拦截（链接/按钮跳转）──
      function onClick(e) {
        if (isEditorUI(e.target)) return;
        if (e.target && (e.target.isContentEditable || e.target.closest("[contenteditable=true]"))) return;
        e.preventDefault();
        e.stopPropagation();
      }

      // ── scroll / resize 同步 ──
      function onScrollOrResize() {
        syncAll(editor.selected);
      }

      // ── 键盘快捷键 ──
      function onKeyDown(e) {
        // Ctrl+Z / Cmd+Z
        if ((e.ctrlKey || e.metaKey) && e.code === "KeyZ" && !e.shiftKey) {
          e.preventDefault();
          EMEditor.undo();
          return;
        }
        // Ctrl+Shift+Z / Cmd+Shift+Z
        if ((e.ctrlKey || e.metaKey) && e.code === "KeyZ" && e.shiftKey) {
          e.preventDefault();
          EMEditor.redo();
          return;
        }
        // Delete / Backspace
        if ((e.code === "Delete" || e.code === "Backspace") && editor.selected) {
          // 如果正在编辑文字，不拦截
          if (e.target && (e.target.isContentEditable || e.target.closest("[contenteditable=true]"))) return;
          if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")) return;
          e.preventDefault();
          EMEditor.deleteSelected();
          return;
        }
        // Escape 取消选中
        if (e.code === "Escape" && editor.selected) {
          if (e.target && (e.target.isContentEditable || e.target.closest("[contenteditable=true]"))) return;
          e.preventDefault();
          selectElement(null);
          return;
        }
        // 方向键微移
        if (editor.selected && !e.ctrlKey && !e.metaKey && !e.altKey) {
          var step = e.shiftKey ? 10 : 1;
          var el = editor.selected;
          var curL = parseFloat(el.style.left) || 0;
          var curT = parseFloat(el.style.top) || 0;
          var moved = false;

          if (e.code === "ArrowLeft") { el.style.left = (curL - step) + "px"; moved = true; }
          else if (e.code === "ArrowRight") { el.style.left = (curL + step) + "px"; moved = true; }
          else if (e.code === "ArrowUp") { el.style.top = (curT - step) + "px"; moved = true; }
          else if (e.code === "ArrowDown") { el.style.top = (curT + step) + "px"; moved = true; }

          if (moved) {
            e.preventDefault();
            syncAll(el);
            // 方向键结束后记录 patch
            if (!editor._arrowTimer) {
              editor._arrowBefore = { l: curL, t: curT };
            }
            clearTimeout(editor._arrowTimer);
            editor._arrowTimer = setTimeout(function () {
              var afterL = parseFloat(el.style.left) || 0;
              var afterT = parseFloat(el.style.top) || 0;
              if (afterL !== editor._arrowBefore.l || afterT !== editor._arrowBefore.t) {
                editor.history.record("move", el,
                  { l: editor._arrowBefore.l, t: editor._arrowBefore.t },
                  { l: afterL, t: afterT });
                refreshHistoryButtons();
              }
              editor._arrowBefore = null;
              editor._arrowTimer = null;
            }, 300);
          }
        }
      }

      document.addEventListener("mousemove", onMouseMove, false);
      document.addEventListener("mousedown", onMouseDown, false);
      document.addEventListener("mouseup", onMouseUp, false);
      document.addEventListener("dblclick", onDblClick, false);
      window.addEventListener("click", onClick, true);
      window.addEventListener("scroll", onScrollOrResize, true);
      window.addEventListener("resize", onScrollOrResize, true);
      document.addEventListener("keydown", onKeyDown, true);

      // rAF 循环
      var rafId = null;
      (function syncLoop() {
        rafId = requestAnimationFrame(syncLoop);
        if (editor && editor.selected && !editor._dragging) syncAll(editor.selected);
      })();

      editor._handlers = {
        mousemove: onMouseMove, mousedown: onMouseDown, mouseup: onMouseUp,
        dblclick: onDblClick, click: onClick,
        scroll: onScrollOrResize, resize: onScrollOrResize, keydown: onKeyDown,
        rafId: rafId,
      };

      return editor;
    },

    stop: function () {
      if (editor && editor._handlers) {
        var h = editor._handlers;
        document.removeEventListener("mousemove", h.mousemove, false);
        document.removeEventListener("mousedown", h.mousedown, false);
        document.removeEventListener("mouseup", h.mouseup, false);
        document.removeEventListener("dblclick", h.dblclick, false);
        window.removeEventListener("click", h.click, true);
        window.removeEventListener("scroll", h.scroll, true);
        window.removeEventListener("resize", h.resize, true);
        document.removeEventListener("keydown", h.keydown, true);
        clearTimeout(editor._arrowTimer);
        if (h.rafId) cancelAnimationFrame(h.rafId);
      }
      document.querySelectorAll("[data-em-editor]").forEach(function (el) { el.remove(); });
      editor = null;
    },

    undo: function () {
      if (!editor) return;
      editor.history.undo();
      syncAll(editor.selected);
      refreshHistoryButtons();
    },

    redo: function () {
      if (!editor) return;
      editor.history.redo();
      syncAll(editor.selected);
      refreshHistoryButtons();
    },

    deleteSelected: function () {
      if (!editor || !editor.selected) return;
      var el = editor.selected;
      var parent = el.parentNode;
      var nextSibling = el.nextSibling;
      var html = el.outerHTML;
      el.remove();
      editor.history.record("delete", null,
        { h: html, pEl: parent, ref: nextSibling },
        { h: "", pEl: null, ref: null });
      editor.selected = null;
      syncAll(null);
      refreshHistoryButtons();
    },

    addText: function () {
      if (!editor) return;
      var canvas = editor.canvas || document.getElementById("em-canvas") || document.body;
      var div = document.createElement("div");
      div.textContent = "双击编辑文字";
      Object.assign(div.style, {
        position: "absolute",
        left: (canvas.clientWidth / 2 - 100) + "px",
        top: (canvas.clientHeight / 2 - 20) + "px",
        width: "200px", minHeight: "40px",
        padding: "12px 16px", fontSize: "16px", color: "#111",
        background: "#fff", border: "1px dashed #16a34a",
        borderRadius: "6px", cursor: "move", zIndex: String(Date.now() % 1000),
        fontFamily: "system-ui, sans-serif",
      });
      canvas.appendChild(div);
      editor.history.record("add", div,
        { present: false }, { present: true },
        { parent: canvas });
      refreshHistoryButtons();
      // 自动选中新元素
      editor.selected = div;
      syncAll(div);
    },

    addImage: function () {
      if (!editor) return;
      var input = document.createElement("input");
      input.type = "file";
      input.accept = "image/*";
      input.setAttribute("data-em-editor", "file-input");
      input.style.display = "none";
      document.body.appendChild(input);
      input.addEventListener("change", function () {
        var file = input.files && input.files[0];
        if (!file) { input.remove(); return; }
        var reader = new FileReader();
        reader.onload = function () {
          var canvas = editor.canvas || document.getElementById("em-canvas") || document.body;
          var img = document.createElement("img");
          img.src = reader.result;
          Object.assign(img.style, {
            position: "absolute",
            left: (canvas.clientWidth / 2 - 150) + "px",
            top: (canvas.clientHeight / 2 - 100) + "px",
            maxWidth: "300px", maxHeight: "200px",
            cursor: "move", zIndex: String(Date.now() % 1000),
          });
          canvas.appendChild(img);
          editor.history.record("add", img,
            { present: false }, { present: true },
            { parent: canvas });
          refreshHistoryButtons();
          editor.selected = img;
          syncAll(img);
          input.remove();
        };
        reader.readAsDataURL(file);
      });
      input.click();
    },

    setColor: function (color) {
      if (!editor || !editor.selected) return;
      recordColorPatch(editor.selected, "color", color);
    },

    setBgColor: function (color) {
      if (!editor || !editor.selected) return;
      recordColorPatch(editor.selected, "backgroundColor", color);
    },

    /** 导出完整 HTML */
    export: function () {
      var clone = document.documentElement.cloneNode(true);
      // 移除编辑 UI
      var uiElements = clone.querySelectorAll("[data-em-editor]");
      for (var i = 0; i < uiElements.length; i++) {
        uiElements[i].remove();
      }
      // 移除 canvas 容器，提取内容
      var canvasEl = clone.querySelector("#em-canvas");
      var body = clone.querySelector("body");
      if (canvasEl && body) {
        body.innerHTML = "";
        while (canvasEl.firstChild) {
          body.appendChild(canvasEl.firstChild);
        }
      }
      var html = "<!DOCTYPE html>\n" + clone.outerHTML;
      try { window.parent.postMessage({ type: "em-editor-export", html: html }, "*"); } catch (e) { /* */ }
      var blob = new Blob([html], { type: "text/html" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url; a.download = "edited.html"; a.click();
      URL.revokeObjectURL(url);
    },

    /** 面板调用的样式操作入口 */
    applyStyle: function (action) {
      if (!editor || !editor.selected) return;
      var actionFn = STYLE_ACTIONS[action];
      if (!actionFn) return;
      var result = actionFn(editor.selected);
      result.apply();
      var after = editor.selected.style[result.prop];
      if (after === "" || after === undefined) after = getComputedStyle(editor.selected)[result.prop];
      if (result.before !== after) {
        editor.history.record("style", editor.selected, result.before, after, { prop: result.prop });
        refreshHistoryButtons();
      }
    },

    /** 供 index.html 查询按钮状态 */
    getState: function () {
      return {
        canUndo: editor ? editor.history.canUndo() : false,
        canRedo: editor ? editor.history.canRedo() : false,
        hasSelection: editor ? !!editor.selected : false,
      };
    },

    load: function (html) {
      document.open();
      document.write(html);
      document.close();
    },
  };
})();
