import { describe, it, expect } from 'vitest';
import { Window } from 'happy-dom';
import { freezeCaptureScroll } from './liquid-capture-scroll';

describe('scrolling glass capture', () => {
  it('serializes vertical and horizontal scroll offsets without changing the original', () => {
    const window = new Window();
    window.document.body.innerHTML = '<main><section class="scroll"><p>first</p><p>second</p></section></main>';
    const source = window.document.querySelector('main')!;
    const scroll = source.querySelector('section')!;
    scroll.scrollTop = 340; scroll.scrollLeft = 12;
    const original = source.outerHTML;
    const clone = source.cloneNode(true);
    freezeCaptureScroll(source as unknown as HTMLElement, clone as unknown as HTMLElement, '.scroll');
    expect(clone.outerHTML).toContain('translate(-12px,-340px)');
    expect(clone.querySelector('.scroll')!.children).toHaveLength(1);
    expect(clone.textContent).toBe('firstsecond');
    expect(source.outerHTML).toBe(original);
    expect(scroll.scrollTop).toBe(340);
    scroll.scrollTop = 620;
    const next = source.cloneNode(true);
    freezeCaptureScroll(source as unknown as HTMLElement, next as unknown as HTMLElement, '.scroll');
    expect(next.outerHTML).toContain('translate(-12px,-620px)');
    expect(clone.outerHTML).toContain('translate(-12px,-340px)');
    window.happyDOM.abort();
  });
  it('preserves measured virtual row geometry in the serialized copy', () => {
    const window = new Window();
    const source=window.document.createElement('main');source.innerHTML='<div data-liquid-row>content</div>';
    const row=source.firstElementChild!;
    Object.defineProperty(row,'getBoundingClientRect',{value:()=>({height:238})});
    const clone=source.cloneNode(true);
    freezeCaptureScroll(source as unknown as HTMLElement,clone as unknown as HTMLElement,'.scroll');
    expect(clone.firstElementChild!.getAttribute('style')).toContain('height: 238px');
    expect(clone.firstElementChild!.getAttribute('style')).toContain('content-visibility: visible');
    expect(row.getAttribute('style')).toBe(null);
    window.happyDOM.abort();
  });
  it('leaves unscrolled content and its layout intact', () => {
    const window = new Window();
    const source = window.document.createElement('main');source.innerHTML='<div class="scroll"><p>content</p></div>';
    const clone=source.cloneNode(true);
    freezeCaptureScroll(source as unknown as HTMLElement,clone as unknown as HTMLElement,'.scroll');
    expect(clone.outerHTML).toBe(source.outerHTML);
    window.happyDOM.abort();
  });
});
