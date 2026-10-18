import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parse, type DefaultTreeAdapterTypes as Html } from "parse5";
import type { VisualSpec } from "../../shared/visual-design/spec";

type Element = Html.Element;
interface Patch { start: number; end: number; value: string }
interface PrototypeUpdate {
  root: string;
  previous: VisualSpec;
  next: VisualSpec;
  resources: { marker: string; tag: string; file: string; before: string | null; after: string }[];
  templates: { before: string; after: string }[];
}

// parse5 8 sourceCodeLocationInfo gives source ranges. Patching those ranges keeps
// user markup verbatim; DOM serialization would rewrite unrelated business content.
function elements(html: string): Element[] {
  const result: Element[] = [];
  const visit = (node: Html.Node) => {
    if ("tagName" in node) result.push(node);
    if ("childNodes" in node) node.childNodes.forEach(visit);
  };
  visit(parse(html, { sourceCodeLocationInfo: true }));
  return result;
}
const attribute = (node: Element, name: string) => node.attrs.find(attr => attr.name === name)?.value;
function range(node: Element) {
  const location = node.sourceCodeLocation;
  if (!location?.startTag || !location.endTag) throw new Error("Incomplete managed prototype element");
  return location as typeof location & { startTag: NonNullable<typeof location.startTag>; endTag: NonNullable<typeof location.endTag> };
}
function canonical(node: Html.Node): unknown {
  if ("tagName" in node) return [node.namespaceURI, node.tagName,
    node.attrs.map(attr => [attr.name, attr.value]).sort(([a], [b]) => a!.localeCompare(b!)), node.childNodes.map(canonical)];
  if ("value" in node) return node.value;
  if ("data" in node) return [node.nodeName, node.data];
  return node.nodeName;
}
function isArtwork(node: Element): boolean {
  return attribute(node, "data-easymint-artwork") !== undefined ||
    (attribute(node, "aria-hidden") === "true" && attribute(node, "class")?.split(/\s+/).includes("sample-artwork") === true);
}

export function updatePrototypeHtml(html: string, update: PrototypeUpdate): string {
  const nodes = elements(html), patches: Patch[] = [];
  const roots = nodes.filter(node => attribute(node, "data-easymint-root") !== undefined);
  if (roots.length !== 1) throw new Error("Prototype root is not linked or has user changes; reconcile its visual style before updating.");
  const root = roots[0]!;
  const documentUrl = pathToFileURL(path.join(update.root, "prototype/index.html"));
  const baseHref = nodes.find(node => node.tagName === "base" && attribute(node,"href") !== undefined);
  let referenceBase = documentUrl;
  if (baseHref) {
    try { referenceBase = new URL(attribute(baseHref,"href")!, documentUrl); } catch { /* Invalid base falls back to the document URL. */ }
  }
  const rootStyle = attribute(root, "data-style");
  if (rootStyle !== update.previous.selection.styleId && rootStyle !== update.next.selection.styleId)
    throw new Error("Prototype root has user changes; reconcile its visual style before updating.");
  if (update.previous.selection.layout !== update.next.selection.layout && attribute(root, "data-layout") !== update.next.selection.layout)
    throw new Error("Existing prototype layout requires a content merge: copy the chosen layout from .easymint/design/templates into prototype/index.html, retain user content and its data-layout attribute, then call set_project_design again.");

  for (const resource of update.resources) {
    const managed = nodes.filter(node => attribute(node, `data-easymint-${resource.marker}`) !== undefined);
    if (managed.length > 1 || managed.some(node => node.tagName !== resource.tag))
      throw new Error("Prototype theme has duplicate or invalid managed blocks. Nothing was overwritten.");
    if (managed.length) {
      const location = range(managed[0]!);
      const content = html.slice(location.startTag.endOffset, location.endTag.startOffset);
      // HTML parsing normalizes CRLF; that normalization does not change CSS/JS ownership.
      if (resource.before === null || content.replace(/\r\n?/g, "\n") !== resource.before.replace(/\r\n?/g, "\n"))
        throw new Error("Prototype theme has user changes. Reconcile managed styles before updating. Nothing was overwritten.");
      patches.push({ start: location.startTag.endOffset, end: location.endTag.startOffset, value: resource.after });
    } else {
      const linked = nodes.some(node => {
        const reference = attribute(node, resource.tag === "script" ? "src" : "href");
        const expectedTag = resource.tag === "script" ? "script" : "link";
        if (node.tagName !== expectedTag || reference === undefined ||
          (expectedTag === "link" && !attribute(node, "rel")?.toLowerCase().split(/\s+/).includes("stylesheet"))) return false;
        try {
          const url = new URL(reference, referenceBase);
          return url.protocol === "file:" && fileURLToPath(url) === path.resolve(update.root, ".easymint/design", resource.file);
        } catch { return false; }
      });
      if (!linked) throw new Error("Prototype theme is not linked or has user changes. Reconcile the managed style blocks before changing the design. Nothing was overwritten.");
    }
  }

  if (update.previous.selection.styleId !== update.next.selection.styleId) {
    const candidates = update.templates.flatMap(template => {
      const before = elements(template.before).filter(isArtwork), after = elements(template.after).filter(isArtwork);
      return before.map((node, index) => ({ before: node, after: after[index], html: template.after }));
    });
    for (const artwork of nodes.filter(isArtwork)) {
      const actual = JSON.stringify(canonical(artwork));
      const candidate = candidates.find(item => actual === JSON.stringify(canonical(item.before)));
      if (!candidate?.after) {
        // An explicitly merged new material is also valid; never overwrite custom art.
        if (candidates.some(item => item.after && actual === JSON.stringify(canonical(item.after)))) continue;
        throw new Error("Prototype artwork has user changes; merge the selected style's artwork while preserving your content before updating. Nothing was overwritten.");
      }
      const original = range(artwork), replacement = range(candidate.after);
      patches.push({ start: original.startOffset, end: original.endOffset, value: candidate.html.slice(replacement.startOffset, replacement.endOffset) });
    }
  }
  for (const [name, value] of [["data-style", update.next.selection.styleId], ["data-effect", update.next.selection.effect]]) {
    const location = root.sourceCodeLocation?.attrs?.[name!];
    if (!location) throw new Error("Prototype root has user changes; missing visual attributes.");
    patches.push({ start: location.startOffset, end: location.endOffset, value: `${name}="${value}"` });
  }
  const palette = root.sourceCodeLocation?.attrs?.["data-palette"];
  if(palette) patches.push({start:palette.startOffset,end:palette.endOffset,value:`data-palette="${update.next.selection.palette}"`});
  else { const end = root.sourceCodeLocation!.startTag!.endOffset - 1; patches.push({start:end,end,value:` data-palette="${update.next.selection.palette}"`}); }
  let updated = html, boundary = html.length;
  for (const patch of patches.sort((a, b) => b.start - a.start)) {
    if (patch.end > boundary) throw new Error("Overlapping managed prototype elements. Nothing was overwritten.");
    updated = updated.slice(0, patch.start) + patch.value + updated.slice(patch.end);
    boundary = patch.start;
  }
  return updated;
}
