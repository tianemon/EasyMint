import { createSceneContract, sceneImplementationGuide } from "../../shared/visual-design/scene-contract";
import { showcaseRuntimeSource } from "../../shared/visual-design/showcase-runtime";
import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { getResourcesDir } from "../utils/paths";
import { createVisualSpec, parseVisualSpec, resolvedComponents, visualSpecPrompt, VISUAL_LAYOUTS, type VisualSelection, type VisualSpec } from "../../shared/visual-design/spec";
import { deriveThemeCss, renderVisualDocument, VISUAL_STYLE_FILES, type VisualAssets } from "../../shared/visual-design/document";
import { updatePrototypeHtml } from "./project-design-html";
const DIR = '.easymint/design';
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const read = (file: string) => fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
const allowed = (relative: string) => relative === 'prototype/index.html' || relative === '.easymint/project-profile.json' || /^\.easymint\/design\/(?:visual-spec\.json|theme\.css|components\.css|runtime\.js|native-tokens\.json|PORTING\.md|gallery\.html|showcase(?:-mobile)?\.html|scene-contract\.json|DESIGN\.md|motion\.html|manifest\.json|templates\/template-(?:landing|dashboard|form|detail)\.html)$/.test(relative);
function target(root: string, relative: string): string {
    if (!allowed(relative))
        throw new Error('Invalid managed design path');
    const full = path.resolve(root, relative);
    let current = root;
    for (const part of path.relative(root, full).split(path.sep)) {
        current = path.join(current, part);
        try {
            if (fs.lstatSync(current).isSymbolicLink())
                throw new Error('Design path must not be a symbolic link');
        }
        catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
                throw error;
        }
    }
    return full;
}
function atomic(file: string, text: string) { fs.mkdirSync(path.dirname(file), { recursive: true }); const temp = file + '.' + randomUUID() + '.tmp'; try {
    fs.writeFileSync(temp, text, 'utf8');
    fs.renameSync(temp, file);
}
finally {
    if (fs.existsSync(temp))
        fs.unlinkSync(temp);
} }
interface Change {
    relative: string;
    before: string | null;
    after: string;
}
function journalPath(root: string) { const file = path.join(root, DIR, '.transaction.json'); target(root, `${DIR}/manifest.json`); try {
    if (fs.lstatSync(file).isSymbolicLink())
        throw new Error('Invalid design journal');
}
catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        throw error;
} return file; }
export function recoverProjectDesign(root: string): void {
    const journal = journalPath(root), raw = read(journal);
    if (raw === null)
        return;
    const changes = JSON.parse(raw) as Change[];
    if (!Array.isArray(changes) || changes.some(c => !allowed(c.relative) || (c.before !== null && typeof c.before !== 'string') || typeof c.after !== 'string'))
        throw new Error('Invalid design transaction');
    for (const c of changes) {
        const now = read(target(root, c.relative));
        if (now !== c.before && now !== c.after)
            throw new Error('Design recovery conflicts with a changed file; original files and transaction retained');
    }
    for (const c of [...changes].reverse()) {
        const file = target(root, c.relative);
        if (c.before === null) {
            if (fs.existsSync(file))
                fs.unlinkSync(file);
        }
        else
            atomic(file, c.before);
    }
    fs.unlinkSync(journal);
}
export function loadVisualAssets(resources = getResourcesDir()): VisualAssets {
    const dir = path.join(resources, 'visual-design');
    return { css: VISUAL_STYLE_FILES.map(name => fs.readFileSync(path.join(dir, name), 'utf8')).join('\n'), runtime: fs.readFileSync(path.join(dir, 'runtime.js'), 'utf8') + '\n' + showcaseRuntimeSource() };
}
export function readProjectDesign(root: string): VisualSpec | null {
    recoverProjectDesign(root);
    const text = read(target(root, `${DIR}/visual-spec.json`));
    if (text === null) {
        const profile = read(target(root, '.easymint/project-profile.json'));
        if (profile && JSON.parse(profile).visualSpec)
            throw new Error('Project visual specification is missing');
        return null;
    }
    return parseVisualSpec(JSON.parse(text));
}
export function projectDesignSection(root: string): string {
    const spec = readProjectDesign(root);
    if (spec)
        ensureProjectDesign(root);
    return spec ? `\n<easymint_project_visual>\n## Project visual system\n${visualSpecPrompt(spec)}\nThe code and files in this project are authoritative. Preserve user-edited files. Never switch to the legacy blue seed templates when this contract exists.\n</easymint_project_visual>\n` : '';
}
export function saveProjectDesign(root: string, selection: VisualSelection, platformSpec?: string, resources = getResourcesDir()): VisualSpec {
    root = path.resolve(root);
    if (!fs.statSync(root).isDirectory())
        throw new Error('Project directory does not exist');
    recoverProjectDesign(root);
    const snapshot = new Map<string, string | null>();
    const before = (relative: string) => { if (!snapshot.has(relative))
        snapshot.set(relative, read(target(root, relative))); return snapshot.get(relative)!; };
    const assets = loadVisualAssets(resources), spec = createVisualSpec(selection), files = new Map<string, string>();
    const previous = before(`${DIR}/manifest.json`);
    const manifest = previous ? JSON.parse(previous) as {
        files: Record<string, string>;
    } : { files: {} };
    files.set(`${DIR}/visual-spec.json`, JSON.stringify(spec, null, 2) + '\n');
    files.set(`${DIR}/theme.css`, deriveThemeCss(spec));
    files.set(`${DIR}/components.css`, assets.css);
    files.set(`${DIR}/runtime.js`, assets.runtime);
    files.set(`${DIR}/native-tokens.json`, JSON.stringify({ schemaVersion: 1, source: 'visual-spec.json', platforms: spec.selection.targets, primitive: spec.primitive, semantic: spec.semantic, components: resolvedComponents(spec), states: spec.states, material: spec.material }, null, 2) + '\n');
    files.set(`${DIR}/PORTING.md`, '# Visual implementation contract\n\nWeb/Electron: reuse theme.css, components.css and runtime.js. Read DESIGN.md and scene-contract.json first. showcase.html and showcase-mobile.html share the picker source. In preset mode they are the selected complete product scene: reuse its defining layout, useful controls and material layers. In brief mode they are an optional neutral base; the user brief determines composition, materials and motion, including whether animation is needed. Templates and gallery are legacy compatibility starters, not the selected direction. There is no per-style motion destination. Copy inline marked theme/component style blocks into a single-file prototype, or import these project-relative files. Preserve the CSS classes, component states and material layers.\n\nNative Flutter/SwiftUI/Compose/React Native: the HTML showcase is a visual and interaction reference, not an implementation to copy. Use native-tokens.json as the decision source. Translate semantic colors, typography, spacing, radii, shadows and component states into the target toolkit; prefer platform navigation, controls and motion over reproducing DOM structure. Do not copy CSS strings into native properties. Declare unsupported effects instead of silently switching styles; provide the actual target preview before claiming parity.\n\n| Web effect | Native treatment |\n| --- | --- |\n| glass / liquid-glass blur and refraction | system material or blur+tint, with a declared fallback; refraction only when the target can draw it |\n| claymorphism / skeuomorphism layered shadows and texture | native elevation/shadow layers and asset textures |\n| retro print grain / halftone | static texture asset, not a runtime CSS filter |\n| tech canvas / 3D scan | simplified static or native-rendered equivalent; declare unsupported motion |\n\nTo change an existing prototype layout, merge its content into the matching generated template first, keeping data-easymint-root and data-layout, then call set_project_design with that layout. This adoption is checked before saving.\n\nUpdate appearance through set_project_design. It preserves edited managed files by reporting a conflict. User overrides belong in a separate project stylesheet, not in the generated theme. Brand references are inspirations; use the same available font stack in preview and implementation.\n');
    const title = spec.selection.projectName || path.basename(root);
    files.set(`${DIR}/showcase.html`, renderVisualDocument(spec, assets, { layout: 'showcase', title }));
    files.set(`${DIR}/showcase-mobile.html`, renderVisualDocument(spec, assets, { layout: 'showcase', device: 'mobile', title }));
    files.set(`${DIR}/scene-contract.json`, JSON.stringify(createSceneContract(spec), null, 2)+'\n');
    files.set(`${DIR}/DESIGN.md`, sceneImplementationGuide(spec));
    files.set(`${DIR}/gallery.html`, renderVisualDocument(spec, assets, { layout: 'gallery', title }));
    for (const layout of VISUAL_LAYOUTS)
        files.set(`${DIR}/templates/template-${layout}.html`, renderVisualDocument(spec, assets, { layout, title }));
    const profileFile = '.easymint/project-profile.json';
    const oldProfile = before(profileFile);
    const profile = oldProfile ? JSON.parse(oldProfile) : {};
    if (platformSpec !== undefined)
        profile.platformSpec = platformSpec;
    profile.visualSpec = `${DIR}/visual-spec.json`;
    files.set(profileFile, JSON.stringify(profile, null, 2) + '\n');
    const prototype = before('prototype/index.html');
    if (prototype !== null) {
        const oldSpec = before(`${DIR}/visual-spec.json`);
        if (!oldSpec) throw new Error('Prototype theme is not linked; establish its project visual specification first. Nothing was overwritten.');
        const updated = updatePrototypeHtml(prototype, {
            root, previous: parseVisualSpec(JSON.parse(oldSpec)), next: spec,
            resources: ([['theme','style','theme.css'],['components','style','components.css'],['runtime','script','runtime.js']] as const).map(([marker,tag,file]) => ({ marker,tag,file,before:before(`${DIR}/${file}`),after:files.get(`${DIR}/${file}`)! })),
            templates: [...VISUAL_LAYOUTS.map(layout => ({ before: before(`${DIR}/templates/template-${layout}.html`) ?? '', after: files.get(`${DIR}/templates/template-${layout}.html`)! })), { before: before(`${DIR}/showcase.html`)??'', after: files.get(`${DIR}/showcase.html`)! }, { before: before(`${DIR}/showcase-mobile.html`)??'', after: files.get(`${DIR}/showcase-mobile.html`)! }],
        });
        if (updated !== prototype)
            files.set('prototype/index.html', updated);
    }
    for (const [relative, after] of files) {
        if (relative === profileFile || relative === 'prototype/index.html')
            continue;
        const original = before(relative);
        if (original !== null && original !== after && (!manifest.files[relative] || hash(original) !== manifest.files[relative]))
            throw new Error(`Design file has user changes: ${relative}. Nothing was overwritten.`);
    }
    files.set(`${DIR}/manifest.json`, JSON.stringify({ schemaVersion: 1, packVersion: 1, files: Object.fromEntries([...files].filter(([r]) => r !== profileFile && r !== 'prototype/index.html').map(([r, text]) => [r, hash(text)])) }, null, 2) + '\n');
    const changes: Change[] = [...files].map(([relative, after]) => ({ relative, before: before(relative), after })).filter(c => c.before !== c.after);
    if (!changes.length)
        return spec;
    const journal = journalPath(root);
    atomic(journal, JSON.stringify(changes));
    try {
        for (const c of changes) {
            const file = target(root, c.relative);
            if (read(file) !== c.before)
                throw new Error('Project design changed during save');
            atomic(file, c.after);
        }
        fs.unlinkSync(journal);
    }
    catch (error) {
        recoverProjectDesign(root);
        throw error;
    }
    return spec;
}
export function ensureProjectDesign(root: string): boolean {
    const spec = readProjectDesign(root);
    if (!spec)
        return false;
    for (const name of ['theme.css', 'components.css', 'runtime.js', 'native-tokens.json', ...VISUAL_LAYOUTS.map(l => `templates/template-${l}.html`)])
        if (!fs.existsSync(target(root, `${DIR}/${name}`)))
            throw new Error(`Project visual asset missing: ${name}. Restore the project design before generation.`);
    if(fs.existsSync(target(root, `${DIR}/scene-contract.json`)))for(const name of ['DESIGN.md','showcase.html','showcase-mobile.html'])if(!fs.existsSync(target(root, `${DIR}/${name}`)))throw new Error(`Project visual asset missing: ${name}. Restore the project design before generation.`);
    return true;
}
