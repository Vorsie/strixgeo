; StrixGeo NSIS additions (electron-builder picks this file up by default).
;
; Desktop shortcut as an OPTION: electron-builder's assisted installer creates
; the desktop shortcut unconditionally (``createDesktopShortcut: true``) or not
; at all. The owner asked for a checkbox, so ``createDesktopShortcut`` is off in
; package.json and the finish page's "show readme" checkbox is repurposed as
; "Create a desktop shortcut" — the standard electron-builder recipe for an
; opt-in shortcut.
; electron-builder compiles the uninstaller in a second makensis pass with
; BUILD_UNINSTALLER defined and the same include; the finish-page checkbox and
; its function belong to the installer only.
!ifndef BUILD_UNINSTALLER
  !define MUI_FINISHPAGE_SHOWREADME ""
  !define MUI_FINISHPAGE_SHOWREADME_NOTCHECKED
  !define MUI_FINISHPAGE_SHOWREADME_TEXT "Create a desktop shortcut / Snelkoppeling op het bureaublad"
  !define MUI_FINISHPAGE_SHOWREADME_FUNCTION StrixCreateDesktopShortcut

  ; ``APP_EXECUTABLE_FILENAME`` is not defined yet when this include is read
  ; (NSIS warns, electron-builder turns the warning into an error); the
  ; executable is named after the product, so ``${PRODUCT_NAME}.exe`` is exact.
  Function StrixCreateDesktopShortcut
    CreateShortCut "$DESKTOP\${PRODUCT_NAME}.lnk" "$INSTDIR\${PRODUCT_NAME}.exe"
  FunctionEnd
!endif
