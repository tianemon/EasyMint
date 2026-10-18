/** Static, trusted artwork markup shared by React samples and compiled project HTML.
 * It is decorative composition, never fake application controls or made-up metrics. */
export function additionalArtwork(id: string): string | null {
  const masthead=(name:string)=>`<div class="craft-art-masthead"><span>FORM / ${name}</span><span>STUDY — 01</span></div>`;
  switch(id) {
    case "liquid-glass": return `${masthead('LIGHT')}<div class="craft-landscape"><i></i><b></b><em></em></div><div class="craft-liquid-platter"><strong>Light, held gently.</strong><span>CLARITY / FLOW</span></div>`;
    case "claymorphism": return `${masthead('PLAY')}<div class="craft-clay-shapes"><i></i><b></b><em></em></div><div class="craft-art-caption">Made of possibility.</div>`;
    case "business": return `${masthead('SYSTEM')}<div class="craft-system-grid"><div class="craft-system-column"><i></i><i></i><i></i></div><div class="craft-system-chart"><i></i><b></b><em></em><span></span></div><div class="craft-system-lines"><i></i><i></i><i></i></div></div><div class="craft-art-caption">Order creates clarity.</div>`;
    case "luxury": return `<div class="craft-atelier-type">FORM<span>ATELIER / EDITION</span></div><div class="craft-atelier-object"><i></i><b></b></div><div class="craft-art-caption">The art of less.</div>`;
    case "bento": return `<div class="craft-bento-grid"><div class="craft-bento-lead"><span>MAKE</span><strong>space.</strong></div><div class="craft-bento-orb"><i></i></div><div class="craft-bento-lines"><i></i><b></b><em></em></div><div class="craft-bento-small">FORM<br>+ FUNCTION</div></div>`;
    case "colorful": return `${masthead('EXPRESSION')}<div class="craft-color-type">Think<br><em>in color.</em></div><div class="craft-color-forms"><i></i><b></b><em></em></div>`;
    case "retro": return `${masthead('PRINT')}<div class="craft-retro-type">NEW<br>IDEAS.</div><div class="craft-retro-star"></div><div class="craft-retro-strip"></div><span class="craft-retro-stamp">OPEN<br>EDITION</span>`;
    case "soft": return `${masthead('PACE')}<div class="craft-soft-shapes"><i></i><b></b><em></em></div><div class="craft-art-caption">Room to breathe.</div>`;
    case "editorial": return `<div class="craft-editorial-masthead"><span>THE FORM</span><span>Vol. 01</span></div><div class="craft-editorial-headline">A fresh<br>perspective.</div><div class="craft-editorial-columns"><div><i></i><b></b></div><p>DESIGN &<br>EVERYDAY LIFE<span>Stories in the making.</span></p></div>`;
    case "dark": return `${masthead('AFTER HOURS')}<div class="craft-dark-stack"><i></i><b></b><em></em></div><div class="craft-art-caption">Focus, without noise.</div>`;
    case "tech": return `${masthead('SIGNAL')}<div class="craft-tech-orbit"><svg viewBox="0 0 240 150"><path d="M0 76h43l17-34 27 75 28-99 29 58h96"/><circle cx="120" cy="76" r="55"/><path d="M20 15h24M20 15v24M220 135h-24M220 135v-24"/></svg></div><div class="craft-art-caption">PRECISION / IN FOCUS</div>`;
    default: return null;
  }
}
