; StrixGeo NSIS additions (electron-builder picks this file up by default).
;
; Desktop shortcut as an OPTION: electron-builder's assisted installer creates
; the desktop shortcut unconditionally (``createDesktopShortcut: true``) or not
; at all. The owner asked for a checkbox, so ``createDesktopShortcut`` is off in
; package.json and the finish page's "show readme" checkbox is repurposed as
; "Create a desktop shortcut" — the standard electron-builder recipe for an
; opt-in shortcut.
!define MUI_FINISHPAGE_SHOWREADME ""
!define MUI_FINISHPAGE_SHOWREADME_NOTCHECKED
!define MUI_FINISHPAGE_SHOWREADME_TEXT "Create a desktop shortcut / Snelkoppeling op het bureaublad"
!define MUI_FINISHPAGE_SHOWREADME_FUNCTION StrixCreateDesktopShortcut

Function StrixCreateDesktopShortcut
  CreateShortCut "$DESKTOP\${PRODUCT_NAME}.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
FunctionEnd
