/**
 * Keep workspace IDE settings and Git hooks editable while retaining SRT's
 * executable-config denies and platform-specific path handling.
 */
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..", "node_modules", "@anthropic-ai", "sandbox-runtime", "dist", "sandbox");
const marker = "// EasyMint: retain executable configuration protections.";
const patches = [
  {
    file: "macos-sandbox-utils.js",
    edits: [
      ["for (const dirName of getDangerousDirectories()) {", `${marker}
    for (const dirName of getDangerousDirectories().filter(name => name !== '.vscode' && name !== '.idea')) {`],
      ["    entries.push(literal('.git/hooks'));\n    entries.push(beneathCwd('**/.git/hooks/**'));\n", ""],
      ["    // Git hooks are always blocked for security\n", ""],
    ],
  },
  {
    file: "linux-sandbox-utils.js",
    edits: [
      ["...getDangerousDirectories().map(d => path.resolve(cwd, d)),", `${marker}
        ...getDangerousDirectories().filter(name => name !== '.vscode' && name !== '.idea').map(d => path.resolve(cwd, d)),`],
      ["const dangerousDirectories = getDangerousDirectories();", "const dangerousDirectories = getDangerousDirectories().filter(name => name !== '.vscode' && name !== '.idea');"],
      ["        // Git hooks always blocked for security\n        denyPaths.push(path.resolve(cwd, '.git/hooks'));\n", ""],
      ["    // Git hooks always blocked in nested repos. A repository is known by its\n    // HEAD, so that its hooks are denied before there are any.\n    iglobArgs.push('--iglob', '**/.git/hooks/**', '--iglob', '**/.git/HEAD');\n", ""],
      ["        '.git/hooks',\n        '.git/config',\n        '.git/HEAD',\n", "        '.git/config',\n"],
      ["        if (lower[at] === '.git' && lower[at + 1] === 'head')\n            found[at + 1] = 'hooks';\n", ""],
    ],
  },
];

const updates = [];
for (const { file, edits } of patches) {
  const target = path.join(root, file);
  let source = fs.readFileSync(target, "utf8");
  if (source.includes(marker)) continue;
  for (const [before, after] of edits) {
    if (source.split(before).length !== 2) throw new Error(`sandbox-runtime 补丁锚点失效：${file}（${before.trim()}）`);
    source = source.replace(before, () => after);
  }
  updates.push({ target, source });
}
for (const { target, source } of updates) {
  fs.writeFileSync(target, source);
  console.log(`已应用补丁：${path.basename(target)}`);
}
