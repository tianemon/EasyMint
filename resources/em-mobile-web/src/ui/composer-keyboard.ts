import type { WebPlatform } from '../core/platform';

/** Mobile return inserts a newline; desktop keeps Enter-to-send. */
export function shouldSendOnEnter(event: { key: string; shiftKey: boolean; isComposing: boolean; keyCode: number }, platform: WebPlatform): boolean {
  return platform === 'desktop' && event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229;
}
