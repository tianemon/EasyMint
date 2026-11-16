/** Shared slider switch, matching the existing plugin switches. */
export function Toggle({checked,onChange,disabled=false,ariaLabel}:{checked:boolean;onChange:(value:boolean)=>void;disabled?:boolean;ariaLabel?:string}):JSX.Element {
 return <button type="button" role="switch" aria-checked={checked} aria-label={ariaLabel} disabled={disabled} onClick={()=>onChange(!checked)}
  className={`relative w-8 h-4 rounded-full transition-colors overflow-hidden shrink-0 ml-2 disabled:opacity-50 ${checked?"bg-accent":"bg-surface-hover"}`}>
  <span className={`absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-surface-elevated shadow transition-all ${checked?"left-[calc(100%-14px)]":"left-0.5"}`} />
 </button>;
}
