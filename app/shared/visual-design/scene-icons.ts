import { renderLiquidIcon, type LiquidIconName } from './liquid-icons';
export function sceneIcon(name:string):string {
  const extra:Record<string,string>={
    check:'<path d="m5 12 4 4 10-10"/>', plus:'<path d="M12 5v14M5 12h14"/>',
    clock:'<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3 2"/>', sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
    moon:'<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z"/>', bag:'<path d="M5 8h14l1 13H4L5 8Z"/><path d="M8 8V6a4 4 0 0 1 8 0v2"/>',
    mail:'<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m4 7 8 6 8-6"/>', leaf:'<path d="M20 4C8 2 2 10 6 17s15 1 14-13Z"/><path d="m4 21 12-12"/>',
    tune:'<path d="M5 3v18M12 3v18M19 3v18"/><path d="M2 8h6m1 8h6m1-9h6"/>', bookmark:'<path d="M6 3h12v18l-6-4-6 4V3Z"/>',
    chevron:'<path d="m9 5 7 7-7 7"/>', dots:'<path d="M4 7h16M4 12h16M4 17h16"/>', calendar:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 10h18m-13 4h2m4 0h2m-8 3h2"/>',
  };
  if(!extra[name])return renderLiquidIcon(name as LiquidIconName);
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${extra[name]}</svg>`;
}
