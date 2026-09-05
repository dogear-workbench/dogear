; Dogear 自定义 NSIS 安装脚本
; 在安装前检测 Git 环境，未安装则提示用户并执行静默安装

!macro customInit
  ; 检测 Git 是否已安装（通过 PATH 中的 git 命令）
  ClearErrors
  nsExec::ExecToStack 'git --version'
  Pop $0  ; 返回值（0=成功）
  Pop $1  ; 输出内容

  ${If} $0 != 0
    ; Git 未安装，检查安装包是否存在
    ; 先查找 extraResources 中的 Git 安装包
    FindFirst $2 $3 "$INSTDIR\resources\installers\Git-*.exe"
    FindClose $2

    ${If} $3 != ""
      ; 找到了内嵌的 Git 安装包，询问用户是否安装
      MessageBox MB_YESNO|MB_ICONQUESTION "Dogear 的 AI Agent 功能需要 Git 支持。$\r$\n$\r$\n检测到您的系统尚未安装 Git，是否立即安装？$\r$\n$\r$\n（选择$\"否$\"可以稍后手动安装 Git）" IDYES 0 IDNO skipGit

      ; 用户选择"是"，执行静默安装
      DetailPrint "正在安装 Git，请稍候..."
      ExecWait '"$INSTDIR\resources\installers\$3" /VERYSILENT /NORESTART /NOCANCEL /SP- /CLOSEAPPLICATIONS /RESTARTAPPLICATIONS /COMPONENTS="icons,ext\reg\shellhere,assoc,assoc_sh"' $4
      ${If} $4 != 0
        MessageBox MB_OK|MB_ICONEXCLAMATION "Git 安装可能未成功（错误代码: $4）。$\r$\n$\r$\n您可以在安装 Dogear 完成后手动安装 Git。"
      ${Else}
        DetailPrint "Git 安装完成"
      ${EndIf}

    ${Else}
      ; 未找到内嵌安装包，提示用户手动下载
      MessageBox MB_OK|MB_ICONINFORMATION "未找到内置的 Git 安装包。$\r$\n$\r$\n请在安装 Dogear 后手动下载安装 Git：$\r$\nhttps://git-scm.com/download/win"
    ${EndIf}

    skipGit:

  ${Else}
    DetailPrint "Git 已安装: $1"
  ${EndIf}
!macroend

!macro customInstall
  ; 浏览器 NM host 注册：与 dev 注册脚本同键名，后写者胜，--unregister 后回落安装版
  WriteRegStr HKCU "Software\Google\Chrome\NativeMessagingHosts\com.dogear.nmhost" "" "$INSTDIR\resources\nm-host\com.dogear.nmhost.json"
  WriteRegStr HKCU "Software\Microsoft\Edge\NativeMessagingHosts\com.dogear.nmhost" "" "$INSTDIR\resources\nm-host\com.dogear.nmhost.json"
!macroend

; createDesktopShortcut 为 false 时模板的卸载清理会被跳过，在这里补上
!macro customUnInstall
  ${IfNot} ${isKeepShortcuts}
    WinShell::UninstShortcut "$oldDesktopLink"
    Delete "$oldDesktopLink"
  ${EndIf}
  DeleteRegKey HKCU "Software\Google\Chrome\NativeMessagingHosts\com.dogear.nmhost"
  DeleteRegKey HKCU "Software\Microsoft\Edge\NativeMessagingHosts\com.dogear.nmhost"
!macroend
