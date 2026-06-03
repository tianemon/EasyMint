; NSIS custom uninstall script for EasyMint
; Cleans up leftover data on uninstall

!macro customUnInstall
  ; Electron user data (redirected to ~/.easymint/electron)
  RMDir /r "$PROFILE\.easymint"
  ; NSIS updater leftovers
  RMDir /r "$LOCALAPPDATA\easymint-updater"
  RMDir /r "$LOCALAPPDATA\easymint"
!macroend
