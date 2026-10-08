import { uiText } from "../lib/i18n";
import { confirmDialog } from "./ui/ConfirmDialog";

/** 所有进入完全访问的 UI 入口共用同一份一次性风险确认。 */
export function confirmFullAccess(): Promise<boolean> {
  return confirmDialog({
    title: uiText("ui.permission-confirmation.switchToFullAccess"),
    message: uiText("ui.permission-confirmation.mintWillBeAbleToReadAnd"),
    confirmText: uiText("ui.permission-confirmation.confirmFullAccess"),
    // 实心权限色（与输入卡权限盾形图标一致），不是删除类的危险色线框
    permissionConfirm: true,
  });
}
