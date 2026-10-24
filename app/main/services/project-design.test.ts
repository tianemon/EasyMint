import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { saveProjectDesign, readProjectDesign, projectDesignSection, ensureProjectDesign, loadVisualAssets, recoverProjectDesign } from './project-design';
import { createVisualSpec, visualVariables, presetFromVisualSpec, parseVisualSpec, BRAND_REFERENCES } from '../../shared/visual-design/spec';
import { STYLE_PRESETS } from '../../shared/visual-design/presets';
import { deriveThemeCss, renderVisualDocument } from '../../shared/visual-design/document';
vi.mock('electron', () => ({ app: { isPackaged: false } }));
const roots: string[] = [];
const root = () => { const r = fs.mkdtempSync(path.join(os.tmpdir(), 'em-design-')); roots.push(r); return r; };
const resources = path.resolve('resources');
afterEach(() => { vi.restoreAllMocks(); for (const r of roots.splice(0))
    fs.rmSync(r, { recursive: true, force: true }); });
describe('project visual pipeline', () => {
    it.each(STYLE_PRESETS.map(style=>style.id))('persists the actual %s preview theme, four layouts, controls and native projection', styleId => { const r = root(), spec = saveProjectDesign(r, { styleId, targets: ['web', 'ios-mobile'] }, 'technical', resources); const dir = path.join(r, '.easymint/design'); expect(readProjectDesign(r)).toEqual(spec); expect(fs.readFileSync(path.join(dir, 'theme.css'), 'utf8')).toBe(deriveThemeCss(spec)); for (const layout of ['landing', 'dashboard', 'form', 'detail']) {
        const html = fs.readFileSync(path.join(dir, 'templates', `template-${layout}.html`), 'utf8');
        expect(html).toContain(deriveThemeCss(spec));
        expect(html).toContain(`data-style="${styleId}"`);
        expect(html).toContain('sample-button');
    } expect(JSON.parse(fs.readFileSync(path.join(dir, 'native-tokens.json'), 'utf8')).components).toEqual(presetFromVisualSpec(spec).recipes); expect(ensureProjectDesign(r)).toBe(true); expect(projectDesignSection(r)).toContain('visual-spec.json'); expect(JSON.parse(fs.readFileSync(path.join(r, '.easymint/project-profile.json'), 'utf8')).platformSpec).toBe('technical'); });
    it('updates the theme while retaining technical metadata and legacy/custom files', () => { const r = root(); fs.mkdirSync(path.join(r, '.easymint/templates'), { recursive: true }); fs.writeFileSync(path.join(r, '.easymint/templates/template-form.html'), 'user legacy'); saveProjectDesign(r, { styleId: 'flat' }, 'technical', resources); const updated = saveProjectDesign(r, { styleId: 'glass', effect: 'subtle', brandId: 'apple' }, undefined, resources); expect(updated.selection.styleId).toBe('glass'); expect(readProjectDesign(r)).toEqual(updated); expect(fs.readFileSync(path.join(r, '.easymint/templates/template-form.html'), 'utf8')).toBe('user legacy'); expect(JSON.parse(fs.readFileSync(path.join(r, '.easymint/project-profile.json'), 'utf8')).platformSpec).toBe('technical'); });
    it('updates managed prototype style blocks and preserves actual user content', () => { const r = root(); saveProjectDesign(r, { styleId: 'flat' }, 'tech', resources); fs.mkdirSync(path.join(r, 'prototype')); const template = fs.readFileSync(path.join(r, '.easymint/design/templates/template-dashboard.html'), 'utf8').replace('YOUR WORKSPACE', 'USER CONTENT'); fs.writeFileSync(path.join(r, 'prototype/index.html'), template); const spec = saveProjectDesign(r, { styleId: 'glass' }, undefined, resources); const output = fs.readFileSync(path.join(r, 'prototype/index.html'), 'utf8'); expect(output).toContain('USER CONTENT'); expect(output.match(/<div class="sample-app[^>]+>/)?.[0]).toContain('data-style="glass"'); expect(output.match(/<div class="sample-app[^>]+>/)?.[0]).not.toContain('data-style="flat"'); expect(output).toContain(deriveThemeCss(spec)); expect(output).not.toContain(deriveThemeCss(createVisualSpec({ styleId: 'flat' }))); });
    it('updates a prototype importing canonical project files and preserves its body', () => { const r = root(); saveProjectDesign(r, { styleId: 'flat' }, 'tech', resources); fs.mkdirSync(path.join(r, 'prototype')); let template = fs.readFileSync(path.join(r, '.easymint/design/templates/template-dashboard.html'), 'utf8'); for (const [marker, tag, file] of [['theme', 'style', 'theme.css'], ['components', 'style', 'components.css'], ['runtime', 'script', 'runtime.js']])
        template = template.replace(new RegExp(`<${tag} data-easymint-${marker}>[\\s\\S]*?</${tag}>`), tag === 'style' ? `<link rel="stylesheet" href="../.easymint/design/${file}">` : `<script src="../.easymint/design/${file}"></script>`); fs.writeFileSync(path.join(r, 'prototype/index.html'), template); saveProjectDesign(r, { styleId: 'glass' }, undefined, resources); expect(fs.readFileSync(path.join(r, 'prototype/index.html'), 'utf8').match(/<div class="sample-app[^>]+>/)?.[0]).toContain('data-style="glass"'); });
    it('allows a layout merge using an existing alternative template then adopts it atomically', () => { const r = root(); saveProjectDesign(r, { styleId: 'glass', layout: 'dashboard' }, 'tech', resources); fs.mkdirSync(path.join(r, 'prototype')); const file = path.join(r, 'prototype/index.html'); fs.writeFileSync(file, fs.readFileSync(path.join(r, '.easymint/design/templates/template-dashboard.html'), 'utf8')); expect(() => saveProjectDesign(r, { styleId: 'glass', layout: 'form' }, undefined, resources)).toThrow('content merge'); const merged = fs.readFileSync(path.join(r, '.easymint/design/templates/template-form.html'), 'utf8').replace('Studio', 'MERGED USER CONTENT'); fs.writeFileSync(file, merged); saveProjectDesign(r, { styleId: 'glass', layout: 'form' }, undefined, resources); expect(readProjectDesign(r)?.selection.layout).toBe('form'); expect(fs.readFileSync(file, 'utf8')).toContain('MERGED USER CONTENT'); });
    it('ships the selected scene, mobile source and implementation guide without a motion destination',()=>{
        for(const style of STYLE_PRESETS){const r=root();saveProjectDesign(r,{styleId:style.id},undefined,resources);
            const dir=path.join(r,'.easymint/design');
            const contract=JSON.parse(fs.readFileSync(path.join(dir,'scene-contract.json'),'utf8'));
            expect(contract.styleId).toBe(style.id);expect(contract.sources.mobile).toBe('showcase-mobile.html');
            expect(fs.readFileSync(path.join(dir,'DESIGN.md'),'utf8')).toContain('same renderers');
            expect(fs.readFileSync(path.join(dir,'showcase-mobile.html'),'utf8')).toContain('data-device="mobile"');
            expect(fs.existsSync(path.join(dir,'motion.html'))).toBe(false);
        }
    });
    it('keeps a scene prototype linked while updating its effect and preserving edited content',()=>{
        const r=root();saveProjectDesign(r,{styleId:'flat'},undefined,resources);fs.mkdirSync(path.join(r,'prototype'));
        const file=path.join(r,'prototype/index.html');fs.writeFileSync(file,fs.readFileSync(path.join(r,'.easymint/design/showcase.html'),'utf8').replace('日常精选','USER COLLECTION'));
        saveProjectDesign(r,{styleId:'flat',effect:'subtle'},undefined,resources);
        const html=fs.readFileSync(file,'utf8');expect(html).toContain('USER COLLECTION');expect(html).toContain('data-style="flat" data-effect="subtle" data-sc-mode="page"');
    });
    it('can adopt another scene only when its previous scene has no user changes',()=>{
        const r=root();saveProjectDesign(r,{styleId:'flat'},undefined,resources);fs.mkdirSync(path.join(r,'prototype'));
        const file=path.join(r,'prototype/index.html');fs.copyFileSync(path.join(r,'.easymint/design/showcase.html'),file);
        saveProjectDesign(r,{styleId:'business'},undefined,resources);expect(fs.readFileSync(file,'utf8')).toContain('data-sc-scene="operations"');
        fs.writeFileSync(file,fs.readFileSync(file,'utf8').replace('项目总览','USER WORKSPACE'));
        expect(()=>saveProjectDesign(r,{styleId:'editorial'},undefined,resources)).toThrow('scene has user changes');
        expect(fs.readFileSync(file,'utf8')).toContain('USER WORKSPACE');expect(readProjectDesign(r)?.selection.styleId).toBe('business');
    });
    it('refuses missing assets instead of providing a stale generation contract', () => { const r = root(); saveProjectDesign(r, { styleId: 'glass' }, '', resources); fs.unlinkSync(path.join(r, '.easymint/design/theme.css')); expect(() => projectDesignSection(r)).toThrow('asset missing'); });
    it('exports native component states and normalizes brand primitives without losing flat geometry', () => { const r = root(); const spec = saveProjectDesign(r, { styleId: 'flat', brandId: 'apple' }, '', resources); expect(spec.primitive.radius.primary).toBe('0px'); expect(spec.semantic.controls.primary.border).toContain(spec.semantic.accent); expect(spec.provenance.traits).toBeDefined(); expect(JSON.parse(fs.readFileSync(path.join(r, '.easymint/design/native-tokens.json'), 'utf8')).states).toEqual(spec.states); });
    it('refuses to leave an existing unlinked prototype silently unchanged', () => { const r = root(); saveProjectDesign(r, { styleId: 'flat' }, '', resources); fs.mkdirSync(path.join(r, 'prototype')); fs.writeFileSync(path.join(r, 'prototype/index.html'), '<h1>User prototype</h1>'); expect(() => saveProjectDesign(r, { styleId: 'glass' }, '', resources)).toThrow('not linked'); expect(readProjectDesign(r)?.selection.styleId).toBe('flat'); expect(fs.readFileSync(path.join(r, 'prototype/index.html'), 'utf8')).toBe('<h1>User prototype</h1>'); });
    it('refuses to overwrite any user-edited managed file, without partially changing the spec', () => { const r = root(); saveProjectDesign(r, { styleId: 'flat' }, '', resources); const before = readProjectDesign(r); fs.appendFileSync(path.join(r, '.easymint/design/components.css'), '\n/* user */'); expect(() => saveProjectDesign(r, { styleId: 'glass' }, '', resources)).toThrow('user changes'); expect(readProjectDesign(r)).toEqual(before); });
    it('recovers an interrupted update and never follows a managed symlink outside the project', () => { const r = root(); saveProjectDesign(r, { styleId: 'flat' }, '', resources); const file = path.join(r, '.easymint/design/theme.css'), before = fs.readFileSync(file, 'utf8'); fs.writeFileSync(file, 'partial'); fs.writeFileSync(path.join(r, '.easymint/design/.transaction.json'), JSON.stringify([{ relative: '.easymint/design/theme.css', before, after: 'partial' }])); recoverProjectDesign(r); expect(fs.readFileSync(file, 'utf8')).toBe(before); const outside = root(); fs.unlinkSync(file); fs.symlinkSync(path.join(outside, 'escape'), file); expect(() => saveProjectDesign(r, { styleId: 'glass' }, '', resources)).toThrow(); expect(fs.existsSync(path.join(outside, 'escape'))).toBe(false); });
    it('rolls back every file after a write failure and permits retry', () => { const r = root(); saveProjectDesign(r, { styleId: 'flat' }, 'tech', resources); const before = readProjectDesign(r); const rename = fs.renameSync; let failed = false; vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => { if (!failed && String(to).endsWith('/theme.css')) {
        failed = true;
        throw Error('disk error');
    } return rename(from, to); }); expect(() => saveProjectDesign(r, { styleId: 'glass' }, 'tech', resources)).toThrow('disk error'); expect(readProjectDesign(r)).toEqual(before); vi.restoreAllMocks(); expect(saveProjectDesign(r, { styleId: 'glass' }, undefined, resources).selection.styleId).toBe('glass'); });
    it('keeps dark brand references readable on the selected light component material', () => { for (const brandId of ['framer', 'linear.app']) {
        const spec = createVisualSpec({ styleId: 'minimalism', brandId });
        const controls = presetFromVisualSpec(spec).recipes;
        expect(controls.card.color).not.toBe('#ffffff');
        expect(controls.input.color).not.toBe('#ffffff');
        expect(controls.card.background).toBe('#ffffff');
        expect(spec.provenance.traits).toBeDefined();
    } expect(createVisualSpec({ styleId: 'glass', effect: 'subtle' }).material.blur).toBe(4); });
    it('normalizes references with explicit quality, and rejects text-only references and CSS injection', () => { expect(BRAND_REFERENCES).toHaveLength(74); for (const brand of BRAND_REFERENCES) {
        if (brand.quality === 'reference')
            expect(() => createVisualSpec({ brandId: brand.id })).toThrow();
        else
            expect(createVisualSpec({ brandId: brand.id }).provenance.reference).toBe(brand.source);
    } const spec = createVisualSpec({ styleId: 'glass' }); spec.semantic.accent = 'red; color: black'; expect(() => parseVisualSpec(spec)).toThrow('Unsafe'); });
    it('keeps brand foregrounds readable on every solid component surface across all built-in styles',()=>{
        const luminance=(hex:string)=>{const channels=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return channels[0]!*.2126+channels[1]!*.7152+channels[2]!*.0722};
        for(const base of STYLE_PRESETS)for(const brand of BRAND_REFERENCES.filter(brand=>brand.quality!=='reference')) {
            const spec=createVisualSpec({styleId:base.id,brandId:brand.id});
            for(const recipe of Object.values(presetFromVisualSpec(spec).recipes))if(/^#[a-f0-9]{6}$/i.test(recipe.background)&&/^#[a-f0-9]{6}$/i.test(recipe.color)) {
                const values=[luminance(recipe.background),luminance(recipe.color)].sort((a,b)=>b-a);
                expect((values[0]!+.05)/(values[1]!+.05),`${base.id}/${brand.id}`).toBeGreaterThanOrEqual(4.5);
            }
        }
    });
    it('produces standalone HTML without project-name injection and deterministic shared CSS', () => { const s = createVisualSpec({ styleId: 'glass' }), assets = loadVisualAssets(resources); const html = renderVisualDocument(s, assets, { title: '<script>alert(1)</script>' }); expect(html).toContain('&lt;script&gt;'); expect(html).toContain(deriveThemeCss(s)); expect(visualVariables(s)['--sample-card-shadow']).toBe(presetFromVisualSpec(s).recipes.card.shadow); expect(createHash('sha256').update(deriveThemeCss(s)).digest('hex')).toBe(createHash('sha256').update(deriveThemeCss(createVisualSpec({ styleId: 'glass' }))).digest('hex')); });
});
