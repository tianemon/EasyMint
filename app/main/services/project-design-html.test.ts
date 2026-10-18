import { describe, expect, it } from "vitest";
import path from "node:path";
import fs from "node:fs";
import { STYLE_PRESETS } from "../../shared/visual-design/presets";
import { createVisualSpec } from "../../shared/visual-design/spec";
import { deriveThemeCss, renderVisualDocument, type VisualAssets, VISUAL_STYLE_FILES } from "../../shared/visual-design/document";
import { updatePrototypeHtml } from "./project-design-html";
import { parse, serialize, serializeOuter, type DefaultTreeAdapterTypes as Html } from "parse5";
const assets: VisualAssets = {
  css: VISUAL_STYLE_FILES.map(file => fs.readFileSync(path.resolve('resources/visual-design',file),'utf8')).join('\n'),
  runtime: fs.readFileSync(path.resolve('resources/visual-design/runtime.js'),'utf8'),
};
function fixture(styleId = 'flat', nextStyle = 'glass') {
  const previous = createVisualSpec({styleId}), next = createVisualSpec({styleId:nextStyle});
  const before = renderVisualDocument(previous,assets), after = renderVisualDocument(next,assets);
  return { before, after, update: {root:path.resolve('fixture-project'),previous,next,
    resources:[{marker:'theme',tag:'style',file:'theme.css',before:deriveThemeCss(previous),after:deriveThemeCss(next)},
      {marker:'components',tag:'style',file:'components.css',before:assets.css,after:assets.css},
      {marker:'runtime',tag:'script',file:'runtime.js',before:assets.runtime,after:assets.runtime}],templates:[{before,after}]}};
}
function artwork(html:string): string {
  const visit = (node:Html.Node):Html.Element|undefined => {
    if('tagName' in node&&node.attrs.some(attr=>attr.name==='class'&&attr.value.split(/\s+/).includes('sample-artwork')))return node;
    if('childNodes' in node)for(const child of node.childNodes){const found=visit(child);if(found)return found;}
  };
  return serializeOuter(visit(parse(html))!);
}
describe('source-preserving prototype updates',()=>{
  it('accepts real DOM serialization, empty marker values, reordered attributes and single quotes',()=>{
    const {before,update}=fixture();
    const serialized=serialize(parse(before));
    expect(serialized).toContain('data-easymint-theme=""');
    const html=serialized.replace('<style data-easymint-theme="">',"<STYLE media='all' data-easymint-theme=''>").replace('</style>','</STYLE>').replace('data-device-policy="auto" data-style="flat"',"data-device-policy=\"auto\" data-style='flat'");
    const result=updatePrototypeHtml(html,update);
    expect(result).toContain('data-style="glass"');
    expect(result).toContain("<STYLE media='all' data-easymint-theme=''>");
    expect(artwork(result)).toBe(artwork(fixture('glass','glass').before));
  });
  it('preserves business markup verbatim and supports legacy artwork without a marker',()=>{
    const {before,update}=fixture();
    const legacy=before.replaceAll('data-easymint-artwork ','');
    update.templates[0]!.before=legacy;
    const business="<article data-user='authored'><!-- keep spacing -->  My &amp; content\n</article>";
    const result=updatePrototypeHtml(legacy.replace('</main>',business+'</main>'),update);
    expect(result).toContain(business);
    expect(result).toContain('sample-glass-window');
    expect(artwork(result)).not.toContain('sample-artwork-poster');
  });
  it('switches the actual material structure between every built-in direction and baseline materials',()=>{
    const pairs=STYLE_PRESETS.flatMap(style=>[[style.id,'glass'],['flat',style.id]] as const);
    for(const [from,to] of pairs){const f=fixture(from,to);expect(artwork(updatePrototypeHtml(f.before,f.update)),`${from} → ${to}`).toBe(artwork(f.after));}
  });
  it('recognizes actual external file URLs with cache parameters, fragments and a relative base',()=>{
    const {before,update}=fixture();
    let external=before.replace('<head>','<head><base href="nested/">');
    for(const resource of update.resources)external=external.replace(new RegExp(`<${resource.tag} data-easymint-${resource.marker}>[\\s\\S]*?</${resource.tag}>`),resource.tag==='style'?`<link rel="STYLESHEET" href="../../.easymint/design/${resource.file}?v=1#asset">`:`<script src="../../.easymint/design/${resource.file}?v=1#asset"></script>`);
    expect(updatePrototypeHtml(external,update)).toContain('data-style="glass"');
    expect(()=>updatePrototypeHtml(external.replace('theme.css?v=1','another.css?v=1'),update)).toThrow('not linked');
    expect(()=>updatePrototypeHtml(external.replace('<base href="nested/">','<base href="https://example.com/nested/">'),update)).toThrow('not linked');
  });
  it('refuses changed artwork instead of discarding custom content, and accepts an explicit merge',()=>{
    const {before,after,update}=fixture();
    expect(()=>updatePrototypeHtml(before.replace('MAKE IT MATTER.','MY CUSTOM ART'),update)).toThrow('artwork has user changes');
    const merged=serialize(parse(before)).replace(artwork(before),artwork(after));
    expect(artwork(merged)).toBe(artwork(after));
    expect(artwork(updatePrototypeHtml(merged,update))).toBe(artwork(after));
  });
  it('does not mistake comment or script strings for managed nodes, nor accept duplicate or changed blocks',()=>{
    const {before,update}=fixture();
    const fake='<!-- <style data-easymint-theme>fake</style> --><script>const example="<style data-easymint-theme>fake</style>";</script>';
    expect(updatePrototypeHtml(before.replace('<head>','<head>'+fake),update)).toContain(fake);
    expect(()=>updatePrototypeHtml(before.replace('<style data-easymint-theme>','<style data-easymint-theme="">/* user */'),update)).toThrow('theme has user changes');
    expect(()=>updatePrototypeHtml(before.replace('</head>','<style data-easymint-theme=""></style></head>'),update)).toThrow('duplicate');
  });
});
