/**
 * 本机档案（环境态）：只采集变化慢的项，变化快的（磁盘余量、端口、进程）一律不入档。
 *
 * 依赖外部命令与平台判定，按项目测试纪律必须参数注入，不在模块内裸调 process.platform。
 */
import { createHash } from "node:crypto";

export interface MachineProbe {
  platform: string;
  arch: string;
  env?: Record<string, string | undefined>;
  /** 执行一次只读命令，返回去掉首尾空白的 stdout；失败返回 null。 */
  run(command: string): string | null;
}

export interface MachineProfile {
  cpu?: string;
  cores?: number;
  memoryGb?: number;
  os?: string;
  arch: string;
  shell?: string;
  tools: Record<string, string>;
  fingerprint: string;
}

const TOOL_COMMANDS: Array<{ name: string; command: string; pattern: RegExp }> = [
  { name: "node", command: "node -v", pattern: /v?\d+\.\d+\.\d+/u },
  { name: "npm", command: "npm -v", pattern: /\d+\.\d+\.\d+/u },
  { name: "pnpm", command: "pnpm -v", pattern: /\d+\.\d+\.\d+/u },
  { name: "git", command: "git --version", pattern: /\d+\.\d+(?:\.\d+)?/u },
];

function number(value: string | null): number | undefined {
  if (!value) return undefined;
  const match = value.match(/\d+(?:\.\d+)?/u);
  return match ? Number(match[0]) : undefined;
}

function bytesToGb(value: string | null): number | undefined {
  const bytes = number(value);
  if (!bytes) return undefined;
  return Math.round(bytes / 1024 ** 3);
}

function collectDarwin(probe: MachineProbe): Partial<MachineProfile> {
  const name = probe.run("sw_vers -productName");
  const version = probe.run("sw_vers -productVersion");
  return {
    cpu: probe.run("sysctl -n machdep.cpu.brand_string") ?? undefined,
    cores: number(probe.run("sysctl -n hw.ncpu")),
    memoryGb: bytesToGb(probe.run("sysctl -n hw.memsize")),
    os: name ? `${name} ${version ?? ""}`.trim() : undefined,
  };
}

function collectLinux(probe: MachineProbe): Partial<MachineProfile> {
  const cpuLine = probe.run("grep -m1 'model name' /proc/cpuinfo");
  const pretty = probe.run("grep -m1 '^PRETTY_NAME=' /etc/os-release");
  const memoryKb = number(probe.run("grep -m1 MemTotal /proc/meminfo"));
  return {
    cpu: cpuLine ? cpuLine.split(":").slice(1).join(":").trim() : undefined,
    cores: number(probe.run("nproc")),
    memoryGb: memoryKb ? Math.round(memoryKb / 1024 ** 2) : undefined,
    os: pretty ? pretty.replace(/^PRETTY_NAME=|"/gu, "") : probe.run("uname -srm") ?? undefined,
  };
}

function collectWindows(probe: MachineProbe): Partial<MachineProfile> {
  const info = probe.run(
    'powershell -NoProfile -Command "Get-CimInstance Win32_Processor | Select-Object -First 1 -ExpandProperty Name"',
  );
  const version = probe.run('powershell -NoProfile -Command "(Get-CimInstance Win32_OperatingSystem).Caption"');
  const memory = number(
    probe.run('powershell -NoProfile -Command "(Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory"'),
  );
  return {
    cpu: info ?? undefined,
    os: version ?? undefined,
    memoryGb: memory ? Math.round(memory / 1024 ** 3) : undefined,
    cores: number(probe.env?.NUMBER_OF_PROCESSORS ?? null),
  };
}

function collectTools(probe: MachineProbe): Record<string, string> {
  const tools: Record<string, string> = {};
  for (const { name, command, pattern } of TOOL_COMMANDS) {
    const raw = probe.run(command);
    const match = raw?.match(pattern);
    if (match) tools[name] = match[0].replace(/^v/u, "");
  }
  return tools;
}

export function machineFingerprint(profile: Omit<MachineProfile, "fingerprint">): string {
  const parts = [
    profile.cpu ?? "",
    String(profile.cores ?? ""),
    String(profile.memoryGb ?? ""),
    profile.os ?? "",
    profile.arch,
    profile.shell ?? "",
    Object.entries(profile.tools)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join(","),
  ];
  return createHash("sha1").update(parts.join("|")).digest("hex").slice(0, 16);
}

export function collectMachineProfile(probe: MachineProbe): MachineProfile {
  const base =
    probe.platform === "darwin"
      ? collectDarwin(probe)
      : probe.platform === "win32"
        ? collectWindows(probe)
        : collectLinux(probe);
  const shell = probe.env?.SHELL ?? probe.env?.ComSpec;
  const partial: Omit<MachineProfile, "fingerprint"> = {
    ...base,
    arch: probe.arch,
    shell: shell || undefined,
    tools: collectTools(probe),
  };
  return { ...partial, fingerprint: machineFingerprint(partial) };
}

/** 指纹未变即视为无需刷新；这是环境态唯一的失效判据。 */
export function machineChanged(previous: string | undefined, next: MachineProfile): boolean {
  return previous !== next.fingerprint;
}

/** 渲染为带自动块标记的一节正文，硬上限 600 字符。 */
export function renderMachineSection(profile: MachineProfile): string {
  const spec = [
    profile.cpu,
    profile.cores ? `${profile.cores} 核` : undefined,
    profile.memoryGb ? `${profile.memoryGb}GB` : undefined,
    profile.os,
    `(${profile.arch})`,
  ].filter(Boolean);
  const lines: string[] = [];
  if (spec.length) lines.push(`- ${spec.join(" · ")}`);
  const tools = Object.entries(profile.tools)
    .map(([key, value]) => `${key} ${value}`)
    .join(" · ");
  if (tools) lines.push(`- 工具链 ${tools}`);
  if (profile.shell) lines.push(`- shell ${profile.shell}`);
  const text = lines.join("\n");
  return text.length > 600 ? text.slice(0, 597).trimEnd() + "…" : text;
}
