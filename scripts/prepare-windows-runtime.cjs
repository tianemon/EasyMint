const fs = require("node:fs");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");
const { Readable } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const { execFileSync } = require("node:child_process");
const SOURCE = require("../app/shared/windows-runtime.json");
const ROOT = path.join(__dirname, "..");
const ARCHIVE = "portable-git.7z.exe";

// Sources and digests are pinned together from the official release API and SHA-256 table:
// https://github.com/git-for-windows/git/releases/tag/v2.56.0.windows.4
function sourceFor(arch, source = SOURCE) {
  if (arch !== "x64" && arch !== "arm64") throw new Error(`Unsupported Windows runtime architecture: ${arch}`);
  return source.archives[arch];
}

async function sha256(file) {
  const hash = createHash("sha256");
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

async function download(url, destination) {
  const response = await fetch(url, { signal: AbortSignal.timeout(300_000) });
  if (!response.ok || !response.body) throw new Error(`PortableGit download failed: HTTP ${response.status}`);
  await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(destination, { flags: "wx" }));
}

async function verifiedDownload(url, digest, file, downloadFn) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file) && await sha256(file) === digest) return;
  const partial = `${file}.${randomUUID()}.partial`;
  try {
    await downloadFn(url, partial);
    if (await sha256(partial) !== digest) throw new Error("Windows runtime SHA-256 mismatch");
    fs.renameSync(partial, file);
  } finally {
    if (fs.existsSync(partial)) fs.unlinkSync(partial);
  }
}

function extract(archive, target, entries) {
  const binary = require("7zip-bin").path7za;
  // npm archives on some hosts lose executable bits; this is a build-local dependency only.
  if (process.platform !== "win32") fs.chmodSync(binary, fs.statSync(binary).mode | 0o111);
  execFileSync(binary, ["x", "-y", "-bd", `-o${target}`, archive, ...entries], {
    windowsHide: true, timeout: 30_000, stdio: "pipe",
  });
}

async function prepareWindowsRuntime(arch, options = {}) {
  const source = options.source ?? SOURCE;
  const asset = sourceFor(arch, source);
  const projectDir = options.projectDir ?? ROOT;
  const downloadFn = options.download ?? download;
  const dir = path.join(projectDir, "temp", "runtime-resources", "windows", arch);
  fs.mkdirSync(dir, { recursive: true });
  await verifiedDownload(asset.url, asset.sha256, path.join(dir, ARCHIVE), downloadFn);
  const extractor = source.extractor.archives[arch];
  const extraArchive = path.join(projectDir, "temp", "runtime-resources", "downloads", `7zip-${source.extractor.version}-extra.7z`);
  await verifiedDownload(extractor.url, extractor.archiveSha256, extraArchive, downloadFn);
  const stage = path.join(dir, `.extractor-${randomUUID()}`);
  try {
    (options.extract ?? extract)(extraArchive, stage, [extractor.entry, "License.txt", "readme.txt"]);
    const executable = path.join(stage, extractor.entry);
    if (await sha256(executable) !== extractor.sha256) throw new Error("7-Zip extractor SHA-256 mismatch");
    fs.copyFileSync(executable, path.join(dir, extractor.fileName));
    fs.copyFileSync(path.join(stage, "License.txt"), path.join(dir, "7zip-LICENSE.txt"));
    fs.copyFileSync(path.join(stage, "readme.txt"), path.join(dir, "7zip-README.txt"));
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
  const manifest = { version: source.version, arch, fileName: ARCHIVE, sha256: asset.sha256, url: asset.url, extractor: { fileName: extractor.fileName, sha256: extractor.sha256 } };
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  // The official SFX remains unmodified, including all of its upstream license files.
  fs.writeFileSync(path.join(dir, "NOTICE.txt"), [
    `PortableGit ${source.version} (${arch}) — official Git for Windows distribution.`,
    `Release and source downloads: https://github.com/git-for-windows/git/releases/tag/${source.releaseTag}`,
    "Build sources: https://github.com/git-for-windows/build-extra",
    "The archive is redistributed unmodified. Preserve its upstream license and copyright files when extracting.",
    "Git and the included components retain their respective upstream licenses.",
    `7-Zip ${source.extractor.version}: https://github.com/ip7z/7zip/releases/tag/${source.extractor.version}`,
    "The native standalone 7za.exe is included for extraction; see 7zip-LICENSE.txt and 7zip-README.txt.",
    "",
  ].join("\n"));
  console.log(`[windows-runtime] verified PortableGit ${source.version} (${arch})`);
  return dir;
}

async function verifyPackagedWindowsRuntime(resources, arch, source = SOURCE) {
  const asset = sourceFor(arch, source);
  const dir = path.join(resources, "windows-runtime");
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
  if (manifest.version !== source.version || manifest.arch !== arch || manifest.fileName !== ARCHIVE || manifest.sha256 !== asset.sha256) {
    throw new Error("Packaged Windows runtime manifest does not match the pinned runtime");
  }
  if (await sha256(path.join(dir, ARCHIVE)) !== asset.sha256) throw new Error("Packaged PortableGit SHA-256 mismatch");
  const extractor = source.extractor.archives[arch];
  if (manifest.extractor?.fileName !== extractor.fileName || manifest.extractor?.sha256 !== extractor.sha256) throw new Error("Packaged extractor manifest mismatch");
  if (await sha256(path.join(dir, extractor.fileName)) !== extractor.sha256) throw new Error("Packaged extractor SHA-256 mismatch");
  for (const file of ["7zip-LICENSE.txt", "7zip-README.txt"]) if (!fs.existsSync(path.join(dir, file))) throw new Error(`Packaged extractor notice missing: ${file}`);
  if (!fs.existsSync(path.join(dir, "NOTICE.txt"))) throw new Error("Packaged PortableGit distribution notice is missing");
}

function contextArchitecture(context) {
  const arch = typeof context.arch === "string" ? context.arch : require("electron-builder").Arch[context.arch];
  sourceFor(arch);
  return arch;
}

exports.default = async function (context) {
  if (context.electronPlatformName !== "win32") return;
  await prepareWindowsRuntime(contextArchitecture(context), { projectDir: context.packager.projectDir });
};
exports.prepareWindowsRuntime = prepareWindowsRuntime;
exports.verifyPackagedWindowsRuntime = verifyPackagedWindowsRuntime;
exports.contextArchitecture = contextArchitecture;

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== "--arch") {
    console.error("Usage: node scripts/prepare-windows-runtime.cjs --arch <x64|arm64>");
    process.exitCode = 1;
  } else {
    prepareWindowsRuntime(args[1]).catch(error => { console.error(error.message); process.exitCode = 1; });
  }
}
