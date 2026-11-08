/** react-native Alert 的 Web 替身：签名保持兼容，用原生 confirm 承载确认类弹窗。 */
export type AlertButton = {
  text?: string;
  style?: 'cancel' | 'destructive' | 'default';
  onPress?: () => void;
};

export const Alert = {
  alert(title: string, message?: string, buttons?: AlertButton[]): void {
    const body = message ? `${title}\n\n${message}` : title;
    const confirmed = typeof window !== 'undefined' && typeof window.confirm === 'function'
      ? window.confirm(body)
      : true;
    if (!confirmed) {
      buttons?.find((item) => item.style === 'cancel')?.onPress?.();
      return;
    }
    const action = buttons?.find((item) => item.style !== 'cancel' && item.onPress);
    action?.onPress?.();
  },
};
