import { describe, expect, it } from 'vitest';
import { parse } from 'parse5';
import { STYLE_PRESETS } from './presets';
import { createVisualSpec } from './spec';
import { renderShowcase, SHOWCASE_SCENES } from './showcase';
import { renderVisualDocument, VISUAL_STYLE_FILES } from './document';
import fs from 'node:fs';

interface Tree { tagName?: string; attrs?: Array<{name:string;value:string}>; childNodes?: Tree[] }
function elements(node: Tree): Tree[] { return [node, ...(node.childNodes ?? []).flatMap(elements)]; }
const attr = (node: Tree, key: string) => node.attrs?.find(a => a.name === key)?.value;

describe('product showcases', () => {
  it.each(STYLE_PRESETS.map(preset => preset.id))('%s has a complete localized composition with valid unique anchors', styleId => {
    for (const locale of ['en', 'zh-CN'] as const) {
      const spec = createVisualSpec({styleId,locale});
      const html = renderShowcase(spec);
      const nodes = elements(parse(html) as Tree);
      const ids = nodes.flatMap(node => attr(node,'id') ? [attr(node,'id')!] : []);
      expect(new Set(ids).size).toBe(ids.length);
      for (const node of nodes) {
        const href = attr(node,'href');
        if (href?.startsWith('#')) expect(ids).toContain(href.slice(1));
      }
      expect(nodes.filter(node => node.tagName === 'h1')).toHaveLength(1);
      expect(html).not.toContain('undefined');
      expect(html).not.toContain('&lt;br&gt;');
      expect(html).toContain(`data-sc-scene="${SHOWCASE_SCENES[styleId]}"`);
      if (locale === 'en') expect(html).not.toMatch(/\p{Script=Han}/u);
    }
  });
  it('gives the three priority styles different page structures and actual actions', () => {
    const tech = renderShowcase(createVisualSpec({styleId:'tech'}));
    const dark = renderShowcase(createVisualSpec({styleId:'dark'}));
    const flat = renderShowcase(createVisualSpec({styleId:'flat'}));
    expect(tech).toContain('sc-radar'); expect(tech).toContain('data-sc-diagnostic');
    expect(dark).toContain('sc-track-list'); expect(dark).toContain('data-sc-track');
    expect(flat).toContain('sc-products'); expect(flat).toContain('data-sc-filter');
  });
  it('has a unique product composition per style and no per-style motion destination', () => {
    expect(new Set(Object.values(SHOWCASE_SCENES)).size).toBe(STYLE_PRESETS.length);
    const spec=createVisualSpec({styleId:'tech'});
    expect(renderShowcase(spec,true)).toBe(renderShowcase(spec));
    expect(renderShowcase(spec)).not.toContain('data-sc-pause');
  });
  it('exports the same composition and interaction code as the picker', () => {
    const spec=createVisualSpec({styleId:'flat',locale:'en'});
    const html=renderVisualDocument(spec,{css:'',runtime:''},{layout:'showcase',device:'mobile',title:'<script>unsafe</script>'});
    expect(html).toContain(renderShowcase(spec).replace(/class="sc-page[^"]*"/,match=>`${match} data-device="mobile"`));
    expect(html).toContain('data-easymint-root'); expect(html).toContain('data-easymint-runtime');
    expect(html).toContain('data-easymint-theme');
    expect(html).toContain('data-sc-add'); expect(html).toContain('root.addEventListener');
    expect(html).toContain('&lt;script&gt;unsafe&lt;/script&gt;');
    expect(VISUAL_STYLE_FILES).toContain('showcase.css');
  });
  it('makes frosted and clear glass visibly different without displacement', () => {
    const frosted=createVisualSpec({styleId:'glass',effect:'standard'});
    const clear=createVisualSpec({styleId:'glass',effect:'subtle'});
    expect(frosted.material.blur).toBe(24); expect(clear.material.blur).toBe(4);
    expect(renderShowcase(frosted)).toContain('gx-frost-surface');
    expect(renderShowcase(clear)).toContain('data-effect="subtle"');
    expect(renderShowcase(frosted)).not.toContain('feDisplacementMap');
    expect(renderShowcase(frosted)).not.toContain('>32</button>');
    expect(renderShowcase(frosted)).not.toBe(renderShowcase(clear));
  });
  it('uses regular/clear variants and an iOS control layer over scrollable content', () => {
    expect(createVisualSpec({styleId:'liquid-glass'}).selection.effect).toBe('subtle');
    const regular=createVisualSpec({styleId:'liquid-glass',effect:'standard'});
    const clear=createVisualSpec({styleId:'liquid-glass',effect:'subtle'});
    expect(regular.material.blur).toBe(3); expect(clear.material.blur).toBe(0.25);
    const html=renderShowcase(regular);
    expect(html).toContain('data-ios-root'); expect(html).toContain('data-ios-filters');
    expect(html).toContain('data-ios-scroll'); expect(html).toContain('data-ios-expand');
    expect(html).toContain('data-ios-tabs'); expect(html).toContain('data-ios-progress');
    expect(html).toContain('data-ios-search-form');
    expect(html).not.toContain('feTurbulence');
    const exported=renderVisualDocument(regular,{css:'',runtime:''},{layout:'showcase'});
    expect(exported).toContain('feDisplacementMap'); expect(exported).toContain('roundedLensMap');
    expect(exported).not.toContain('feTurbulence');
  });
  it('bundles the two original motion studies without remote runtime dependencies', () => {
    for(const id of ['01-flat-vector','09-bauhaus']) {
      const html=fs.readFileSync(`assets/design-motion/${id}/index.html`,'utf8');
      expect(html).not.toContain("fetch(");
      expect(html).not.toMatch(/(?:src|href)=["']https?:/);
      expect(html).toContain('Vincentwei1021');
      expect(html).toContain('cancelAnimationFrame');
    }
    expect(fs.readFileSync('assets/design-motion/LICENSE','utf8')).toContain('MIT License');
  });
});
