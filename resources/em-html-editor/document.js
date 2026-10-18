/** Parse actual elements, never comments or strings embedded in scripts. */
window.EMEditorDocument = {
  prepare: function (html, directoryUrl) {
    if (!directoryUrl) return html;
    var doc = new DOMParser().parseFromString(html, "text/html");
    var base = doc.querySelector("base[href]");
    if (base) {
      var original = base.getAttribute("href");
      base.setAttribute("data-em-editor-base-href", original);
      base.setAttribute("href", new URL(original, directoryUrl).href);
    } else {
      base = doc.createElement("base");
      base.setAttribute("data-em-editor", "base");
      base.setAttribute("href", directoryUrl);
      doc.head.insertBefore(base, doc.head.firstChild);
    }
    var doctype = doc.doctype ? new XMLSerializer().serializeToString(doc.doctype) + "\n" : "";
    return doctype + doc.documentElement.outerHTML;
  },
};
