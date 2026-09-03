; StrixGeo NSIS additions (electron-builder loads this file through nsis.include;
; it is read before the assisted-installer template, so the macros below replace
; the template's defaults where the template checks for them).
;
; Desktop shortcut as an OPTION. electron-builder's assisted installer creates
; the desktop shortcut unconditionally (``createDesktopShortcut: true``) or not
; at all. The owner asked for a checkbox, so ``createDesktopShortcut`` is off in
; package.json and the finish page's "show readme" checkbox is repurposed as
; "Create a desktop shortcut". The checkbox text follows the installer's own
; language at runtime (NSIS picks the system language; a hard-coded bilingual
; string wrapped and clipped).
;
; electron-builder compiles the uninstaller in a second makensis pass with
; BUILD_UNINSTALLER defined and the same include; everything here is installer
; only, and ``customFinishPage`` replaces the template's finish page, so the
; "Run StrixGeo" checkbox (StartApp) is re-declared here exactly as the template
; does it.
!ifndef BUILD_UNINSTALLER
  !macro customFinishPage
    !ifndef HIDE_RUN_AFTER_FINISH
      Function StartApp
        ${if} ${isUpdated}
          StrCpy $1 "--updated"
        ${else}
          StrCpy $1 ""
        ${endif}
        ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "$1"
      FunctionEnd

      !define MUI_FINISHPAGE_RUN
      !define MUI_FINISHPAGE_RUN_FUNCTION "StartApp"
    !endif

    ; ``APP_EXECUTABLE_FILENAME`` is not defined at include time; the executable
    ; is named after the product, so ``${PRODUCT_NAME}.exe`` is exact.
    Function StrixCreateDesktopShortcut
      CreateShortCut "$DESKTOP\${PRODUCT_NAME}.lnk" "$INSTDIR\${PRODUCT_NAME}.exe"
    FunctionEnd

    !define MUI_FINISHPAGE_SHOWREADME ""
    !define MUI_FINISHPAGE_SHOWREADME_NOTCHECKED
    !define MUI_FINISHPAGE_SHOWREADME_TEXT "Create a desktop shortcut"
    !define MUI_FINISHPAGE_SHOWREADME_FUNCTION StrixCreateDesktopShortcut
    !define MUI_PAGE_CUSTOMFUNCTION_SHOW StrixFinishPageShow
    !insertmacro MUI_PAGE_FINISH

    ; Set the checkbox text in the installer's language once the page is built
    ; (1043 = Dutch; everything else reads English). Declared AFTER the page
    ; insert: MUI2 declares ``$mui.FinishPage.ShowReadme`` inside MUI_PAGE_FINISH,
    ; and NSIS resolves the function reference above at link time.
    !include WinMessages.nsh
    Function StrixFinishPageShow
      ${if} $LANGUAGE == 1043
        SendMessage $mui.FinishPage.ShowReadme ${WM_SETTEXT} 0 "STR:Snelkoppeling op het bureaublad maken"
      ${else}
        SendMessage $mui.FinishPage.ShowReadme ${WM_SETTEXT} 0 "STR:Create a desktop shortcut"
      ${endif}
    FunctionEnd
  !macroend
!endif
