/** SVG foreignObject serialization does not preserve an element's scrollTop/scrollLeft.
 * Freeze the current viewport in the clone only; the live page remains untouched.
 */
export function freezeCaptureScroll(source: HTMLElement, clone: HTMLElement, selector: string): void {
  // Preserve measured virtual row heights: SVG has no browser remembered sizes for content-visibility:auto.
  const rows = [...source.querySelectorAll<HTMLElement>('[data-liquid-row]')];
  const rowCopies = [...clone.querySelectorAll<HTMLElement>('[data-liquid-row]')];
  rows.forEach((row, index) => {
    const copy = rowCopies[index];
    const height = row.getBoundingClientRect().height;
    if (!copy || height <= 0) return;
    copy.style.height = `${height}px`;
    copy.style.contentVisibility = 'visible';
    copy.style.containIntrinsicSize = 'none';
    copy.style.overflow = 'hidden';
  });
  const originals = [...source.querySelectorAll<HTMLElement>(selector)];
  const copies = [...clone.querySelectorAll<HTMLElement>(selector)];
  originals.forEach((original, index) => {
    const copy = copies[index];
    if (!copy || (!original.scrollTop && !original.scrollLeft)) return;
    const content = copy.ownerDocument.createElement('div');
    content.style.cssText = `display:flow-root;flex:none;width:100%;height:${original.scrollHeight}px;transform:translate(${-original.scrollLeft}px,${-original.scrollTop}px);transform-origin:0 0;`;
    content.append(...copy.childNodes);
    copy.style.overflow = 'hidden';
    copy.style.width = `${original.offsetWidth}px`;
    copy.style.height = `${original.offsetHeight}px`;
    copy.append(content);
    copy.scrollTop = 0;
    copy.scrollLeft = 0;
  });
}
