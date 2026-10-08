import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const root = path.resolve(import.meta.dirname, "..");
const read = (language) => JSON.parse(fs.readFileSync(path.join(root, `app/shared/i18n/locales/${language}.json`), "utf8"));
const zh = read("zh-CN");
const en = read("en");
const errors = [];
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
      if (!text.includes("react-i18next") && !text.includes('from "./services/ui-language"')) continue;
      const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
      function visit(node) {
        if (ts.isCallExpression(node) && node.expression.getText(source) === "t" && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
          const key = node.arguments[0].text;
          if (!(key in zh) && !(`${key}_one` in zh && `${key}_other` in zh)) {
            errors.push(`${path.relative(root, file)}: unknown translation key ${key}`);
          }
        }
        ts.forEachChild(node, visit);
      }
      visit(source);
    }
  }
}
checkDirectory(path.join(root, "app"));
if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`[i18n] ${Object.keys(zh).length} bilingual keys; interpolation parameters and static references match`);
}
