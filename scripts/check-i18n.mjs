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

function checkDirectory(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory() && entry.name !== "dist") checkDirectory(file);
    else if (/\.tsx?$/.test(entry.name) && !entry.name.includes(".test.")) {
      const text = fs.readFileSync(file, "utf8");

      const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
      function visit(node) {
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
