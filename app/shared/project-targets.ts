export const MOBILE_TARGET_IDS = ["ios-mobile", "android-mobile", "harmony-mobile"] as const;
export function isMobileTarget(target: string): boolean {
  return (MOBILE_TARGET_IDS as readonly string[]).includes(target);
}
