import type { PcCredential } from '../protocol/types';

/**
 * 「添加到主屏幕」后仍能连上电脑。
 *
 * iOS 的主屏 web app 与 Safari 是两个存储分区，IndexedDB 里的配对凭证带不过去，
 * 打开就是未配对页——用户只能重新扫码，而扫码会把页面又拉回 Safari，形成死循环。
 *
 * 解法：把凭证压进 **manifest 的 start_url**。主屏图标启动时 URL 自带 `?h=`，
 * 页面在首帧把它读出来写进本地设备本、随后把 query 抹掉。
 *
 * 为什么用 Blob 而不是让电脑端生成这个 manifest：签发在电脑端意味着 sharedSecret 会走一趟
 * HTTP 请求行，同网段抓包即可冒充这台设备；Blob 全程在手机本地拼装，密钥不出设备。
 * manifest 被浏览器拒收时，Safari 会退回「用当前页面 URL 作为 start_url」，
 * 两条路径都落在同一个 `?h=` 上，不需要额外兜底。
 */

const QUERY_KEY = 'h';
const MANIFEST_MIME = 'application/manifest+json';

type InstallPayload = {
  v: 1;
  /** 设备 id（含 web- 前缀），主屏端据此复用同一条配对记录 */
  d: string;
  /** sharedSecret（base64） */
  k: string;
  /** 电脑 id */
  p: string;
  /** 电脑显示名 */
  n: string;
  /** 局域网地址，逗号分隔（IPv4） */
  a: string;
  /** 远程端口 */
  q: number;
};

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = atob(padded);
  return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
}

/** 生成 `h=<base64url>` 查询串：单测与 manifest 拼装共用同一份编码。 */
export function encodeInstallQuery(credential: PcCredential): string {
  const payload: InstallPayload = {
    v: 1,
    d: credential.deviceId,
    k: credential.sharedSecret,
    p: credential.pcId,
    n: credential.pcName,
    a: credential.addresses.join(','),
    q: credential.port,
  };
  return `${QUERY_KEY}=${toBase64Url(JSON.stringify(payload))}`;
}

/** 从当前 URL 读回凭证；没有或格式不对都返回 null（绝不因此阻塞首帧）。 */
export function readInstallCredential(search: string): PcCredential | null {
  const params = new URLSearchParams(search);
  const raw = params.get(QUERY_KEY);
  if (!raw) return null;
  try {
    const value = JSON.parse(fromBase64Url(raw)) as Partial<InstallPayload>;
    if (value.v !== 1) return null;
    if (!value.d || !value.k || !value.p || !value.n || !value.a || !Number.isInteger(value.q)) return null;
    const addresses = value.a.split(',').filter(Boolean);
    if (!addresses.length) return null;
    return {
      version: 1,
      deviceId: value.d,
      sharedSecret: value.k,
      pcId: value.p,
      pcName: value.n,
      addresses,
      port: value.q as number,
    } as PcCredential;
  } catch {
    return null;
  }
}

/** 抹掉 `?h=`，避免密钥长期留在地址栏与历史记录里（主屏图标的 start_url 不受影响）。 */
export function stripInstallQuery(): void {
  if (!location.search) return;
  history.replaceState(null, '', location.pathname + location.hash);
}

function absoluteBase(): string {
  const base = document.baseURI ?? location.href;
  const url = new URL(base);
  url.search = '';
  url.hash = '';
  return url.pathname.endsWith('/') ? url.pathname : url.pathname.replace(/[^/]+$/, '');
}

/**
 * 重写 `<link rel="manifest">`：start_url 带上当前设备的凭证。
 * 首尾都必须是绝对地址——Blob URL 没有相对基准，相对 start_url 会被判非法。
 */
export function syncInstallManifest(credential: PcCredential | null): void {
  const link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
  if (!link || typeof Blob === 'undefined') return;
  const manifestUrl = new URL(link.dataset.baseHref ?? link.getAttribute('href') ?? './manifest.webmanifest', location.href);
  // 保存原始 href，切设备时以它为基准重新拼，避免在已是 blob 的 href 上继续叠加
  if (!link.dataset.baseHref) link.dataset.baseHref = manifestUrl.pathname.replace(/^\//, '');
  const origin = location.origin;
  const dir = absoluteBase();
  const scope = `${origin}${dir}`;
  const base = {
    name: 'EasyMint',
    short_name: 'EasyMint',
    description: '在手机上操作电脑端的 EasyMint',
    display: 'standalone',
    background_color: '#f7faf7',
    theme_color: '#141414',
    lang: 'zh-CN',
    scope,
    icons: [
      { src: `${origin}${dir}icon-192.png`, sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: `${origin}${dir}icon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'any' },
    ],
  };
  if (!credential) {
    const href = URL.createObjectURL(new Blob([
      JSON.stringify({ ...base, start_url: `${scope}` }),
    ], { type: MANIFEST_MIME }));
    link.href = href;
    return;
  }
  const href = URL.createObjectURL(new Blob([
    JSON.stringify({ ...base, start_url: `${scope}?${encodeInstallQuery(credential)}` }),
  ], { type: MANIFEST_MIME }));
  link.href = href;
}
