export type LiquidIconName = 'home' | 'browse' | 'radio' | 'library' | 'search' | 'play' | 'pause' | 'next' | 'close' | 'down' | 'more' | 'heart' | 'speaker' | 'shuffle' | 'repeat';

/** Shared by first render and play/pause updates; self-contained for HTML export. */
export function renderLiquidIcon(name:LiquidIconName):string {
const paths = {
  home:'<path d="m3.5 10.5 8.5-7 8.5 7M5.5 9v11h4.75v-6h3.5v6h4.75V9"/>',
  browse:'<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
  radio:'<circle cx="12" cy="12" r="1.8" fill="currentColor" stroke="none"/><path d="M8 7.5a6 6 0 0 0 0 9m8-9a6 6 0 0 1 0 9M5 4.5a10 10 0 0 0 0 15m14-15a10 10 0 0 1 0 15"/>',
  library:'<path d="M5 4v16M10 4v16M14.5 4l4 16"/>',
  search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  play:'<path d="M8.5 6.2q0-.8.7-.4l9.2 5.5q1.2.7 0 1.4l-9.2 5.5q-.7.4-.7-.4Z" fill="currentColor" stroke="none"/>',
  pause:'<rect x="7" y="5" width="3" height="14" rx=".7" fill="currentColor" stroke="none"/><rect x="14" y="5" width="3" height="14" rx=".7" fill="currentColor" stroke="none"/>',
  next:'<path d="m5.5 5.5 10 6.5-10 6.5Z" fill="currentColor" stroke="none"/><rect x="17.5" y="5.5" width="2" height="13" rx=".7" fill="currentColor" stroke="none"/>',
  close:'<path d="m6 6 12 12M6 18 18 6"/>',
  down:'<path d="m5 9 7 7 7-7"/>',
  more:'<g fill="currentColor" stroke="none"><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></g>',
  heart:'<path d="M20.25 5.75a4.75 4.75 0 0 0-6.72 0L12 7.28l-1.53-1.53a4.75 4.75 0 0 0-6.72 6.72L12 20.72l8.25-8.25a4.75 4.75 0 0 0 0-6.72Z"/>',
  speaker:'<path d="m4 9 4 0 5-5v16l-5-5H4Zm13-1a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
  shuffle:'<path d="M3 6h3l12 12h3m-4-4 4 4-4 4M3 18h3L18 6h3m-4-4 4 4-4 4"/>',
  repeat:'<path d="m17 2 4 4-4 4M3 10V8a2 2 0 0 1 2-2h16M7 22l-4-4 4-4m14 0v2a2 2 0 0 1-2 2H3"/>',
} as const;
  return `<svg data-ios-icon="${name}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;
}
