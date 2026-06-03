; NSIS custom uninstall script for EasyMint
; Cleans up leftover data on uninstall

!macro customUnInstall
  ; Remove EasyMint AppData
  RMDir /r "$LOCALAPPDATA\EasyMint"
  RMDir /r "$APPDATA\EasyMint"
  ; Remove .easymint config
  RMDir /r "$PROFILE\.easymint"
!macroend
