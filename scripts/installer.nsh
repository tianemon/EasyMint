; NSIS custom uninstall script for EasyMint
; Cleans up leftover data on uninstall

!macro customUnInstall
  ; 仅清理更新缓存，不删用户数据（~/.easymint）
  RMDir /r "$LOCALAPPDATA\easymint-updater"
!macroend

