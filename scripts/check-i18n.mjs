import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const root = path.resolve(import.meta.dirname, "..");
const read = (language) => JSON.parse(fs.readFileSync(path.join(root, `app/shared/i18n/locales/${language}.json`), "utf8"));
const zh = read("zh-CN");
const en = read("en");
const errors = [];
const exceptions = JSON.parse(fs.readFileSync(path.join(root, "app/shared/i18n/source-exceptions.json"), "utf8"));
const seenExceptions = new Set();
const parameters = (text) => [...new Set([...text.matchAll(/{{\s*([\w.]+)\s*}}/g)].map((match) => match[1]))].sort().join(",");

for (const key of new Set([...Object.keys(zh), ...Object.keys(en)])) {
  if (typeof zh[key] !== "string" || typeof en[key] !== "string" || !zh[key].trim() || !en[key].trim()) {
    errors.push(`${key}: both languages require a non-empty string`);
  } else if (parameters(zh[key]) !== parameters(en[key])) {
    errors.push(`${key}: interpolation parameters differ`);
  }
}

const sharedDisplayExports = new Map();
const translatedCalls = new Set(["t", "uiText", "appText"]);

function displayImports(source, file) {
  const imports = new Map();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || statement.importClause?.isTypeOnly || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const specifier = statement.moduleSpecifier.text;
    const base = specifier.startsWith("@shared/") ? path.join(root, "app/shared", specifier.slice(8))
      : specifier.startsWith(".") ? path.resolve(path.dirname(file), specifier) : "";
    if (!base || !base.startsWith(path.join(root, "app/shared") + path.sep)) continue;
    const target = [`${base}.ts`, path.join(base, "index.ts")].find(candidate => fs.existsSync(candidate));
    if (!target) continue;
    if (!sharedDisplayExports.has(target)) {
      const shared = ts.createSourceFile(target, fs.readFileSync(target, "utf8"), ts.ScriptTarget.Latest, true);
      const names = new Set();
      function containsDisplayText(node) {
        if (ts.isTypeNode(node)) return false;
        if (ts.isCallExpression(node) && translatedCalls.has(node.expression.getText(shared))) return false;
        if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && (/\p{Script=Han}/u.test(node.text) || node.text in zh)) return true;
        return !!ts.forEachChild(node, containsDisplayText);
      }
      for (const declaration of shared.statements) {
        if (!ts.isVariableStatement(declaration) || !declaration.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)) continue;
        for (const value of declaration.declarationList.declarations) {
          if (ts.isIdentifier(value.name) && value.initializer && containsDisplayText(value.initializer)) names.add(value.name.text);
        }
      }
      sharedDisplayExports.set(target, names);
    }
    const names = sharedDisplayExports.get(target);
    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      for (const item of bindings.elements) {
        const exported = item.propertyName?.text ?? item.name.text;
        if (!item.isTypeOnly && names.has(exported)) imports.set(item.name.text, `${specifier}#${exported}`);
      }
    } else if (bindings && ts.isNamespaceImport(bindings)) {
      for (const name of names) imports.set(`${bindings.name.text}.${name}`, `${specifier}#${name}`);
    }
  }
  return imports;
}

function checkSharedDisplay(node, source, file, imports) {
  if (!ts.isJsxExpression(node) || !node.expression || !imports.size) return;
  if (ts.isJsxAttribute(node.parent) && !["title", "placeholder", "aria-label", "alt", "label", "description", "tip", "options"].includes(node.parent.name.getText(source))) return;
  const found = new Set();
  function visit(value) {
    // Nested JSX slots are checked separately; event handlers carry model inputs.
    if (ts.isJsxExpression(value)) return;
    if (ts.isJsxAttribute(value) && !["title", "placeholder", "aria-label", "alt", "label", "description", "tip", "options"].includes(value.name.getText(source))) return;
    if (ts.isCallExpression(value) && translatedCalls.has(value.expression.getText(source))) return;
    const reference = (ts.isIdentifier(value) || ts.isPropertyAccessExpression(value)) && imports.get(value.getText(source));
    if (reference) found.add(reference);
    ts.forEachChild(value, visit);
  }
  visit(node.expression);
  for (const reference of found) errors.push(`${path.relative(root, file)}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}: shared display text ${reference} must be localized before rendering`);
}

function checkDirectory(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory() && entry.name !== "dist") checkDirectory(file);
    else if (/\.tsx?$/.test(entry.name) && !entry.name.includes(".test.")) {
      const text = fs.readFileSync(file, "utf8");

      const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
      const renderer = file.includes(`${path.sep}renderer${path.sep}src${path.sep}`);
      const imports = renderer ? displayImports(source, file) : new Map();
      function visit(node) {
        if (renderer) checkSharedDisplay(node, source, file, imports);
        if (ts.isCallExpression(node) && ["t", "uiText"].includes(node.expression.getText(source)) && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
          const key = node.arguments[0].text;
          if (!(key in zh) && !(`${key}_one` in zh && `${key}_other` in zh)) {
            errors.push(`${path.relative(root, file)}: unknown translation key ${key}`);
          }
        }
        if (file.includes(`${path.sep}renderer${path.sep}src${path.sep}`) &&
          (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isJsxText(node) || ts.isTemplateExpression(node))) {
          const value = ts.isTemplateExpression(node)
            ? node.head.text + node.templateSpans.map((span, index) => `{{v${index}}}` + span.literal.text).join("") : node.text;
          if (/\p{Script=Han}/u.test(value)) {
            let internal = false;
            for (let parent = node.parent; parent; parent = parent.parent) {
              if (ts.isTypeNode(parent) || (ts.isCallExpression(parent) && /^console\./.test(parent.expression.getText(source)))) {
                internal = true;
                break;
              }
            }
            if (!internal) {
              const relative = path.relative(root, file).split(path.sep).join("/");
              const exception = exceptions.findIndex(item => item.file === relative && item.text === value && item.reason);
              if (exception < 0) errors.push(`${relative}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}: untranslated source text ${JSON.stringify(value.slice(0, 80))}`);
              else seenExceptions.add(exception);
            }
          }
        }
        ts.forEachChild(node, visit);
      }
      visit(source);
    }
  }
}
checkDirectory(path.join(root, "app"));
for (const name of ["index.html", "runtime.js"]) {
  const text = fs.readFileSync(path.join(root, "resources/em-html-editor", name), "utf8");
  for (const match of text.matchAll(/data-em-i18n(?:-title)?=\\?"(editor\.[A-Za-z0-9]+)\\?"/g)) {
    if (!(match[1] in zh)) errors.push(`editor ${name}: unknown translation key ${match[1]}`);
  }
  const script = name.endsWith(".html") ? text.slice(text.indexOf("<script>") + 8, text.lastIndexOf("</script>")) : text;
  const source = ts.createSourceFile(name, script, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const editorSources = new Set(Object.entries(zh).filter(([key]) => key.startsWith("editor.")).map(([, value]) => value));
  function visitEditor(node) {
    if (ts.isCallExpression(node) && node.expression.getText(source) === "editorText" && node.arguments[0] && ts.isStringLiteral(node.arguments[0]) && !editorSources.has(node.arguments[0].text)) {
      errors.push(`editor ${name}: unknown source message ${node.arguments[0].text}`);
    }
    ts.forEachChild(node, visitEditor);
  }
  visitEditor(source);
}

exceptions.forEach((item, index) => {
  if (!seenExceptions.has(index)) errors.push(`${item.file}: stale source exception ${JSON.stringify(item.text.slice(0, 50))}`);
});
if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`[i18n] ${Object.keys(zh).length} bilingual keys; interpolation parameters and static references match`);
}
