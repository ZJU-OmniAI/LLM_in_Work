#!/bin/bash
# LLM_in_Excel macOS 一次性安装脚本：
#   1) 把运行文件拷到 ~/.llm_in_excel/app（launchd 拉起的 node 读桌面会被 TCC 拦，拷出去绕开）
#   2) 准备本机 HTTPS 证书：已装 LLM_in_Word 或 LLM_in_PowerPoint 就沿用它们已信任的证书（不再弹密码框），
#      否则生成新证书并加入钥匙串信任（第一次会弹一次钥匙串密码框）
#   3) 注册 launchd 常驻服务 com.llm_in_excel.server（开机自启、崩了自动拉起）
#   4) 把加载项 manifest 拷进 Excel 的侧载目录
# 改了代码 / 换了代理端口 → 重跑一次本脚本即可（幂等）。卸载：./install.sh --uninstall
set -euo pipefail
cd "$(dirname "$0")"
PROJ="$(pwd)"
MODE="install"
case "${1:-}" in
  --update-only) MODE="update" ;;
  --uninstall) MODE="uninstall" ;;
  "") ;;
  *) echo "用法：./install.sh [--update-only | --uninstall]"; exit 2 ;;
esac

PORT=8397
LABEL="com.llm_in_excel.server"
BASE="$HOME/.llm_in_excel"
APP="$BASE/app"
CERT_DIR="$BASE/cert"
WEF="$HOME/Library/Containers/com.microsoft.Excel/Data/Documents/wef"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

if [ "$(uname -s)" != "Darwin" ]; then echo "Windows: run install.ps1 instead."; exit 1; fi

if [ "$MODE" = "uninstall" ]; then
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  rm -f "$PLIST" "$WEF/LLM_in_Excel-manifest.xml"
  echo "✅ 已停止服务并移除 Excel 加载项清单。"
  echo "   本机数据仍在 ${BASE}（含证书、会话日志），不需要可手动删除：rm -rf \"$BASE\""
  echo "   钥匙串里的本机证书没有删除（LLM_in_Word / LLM_in_PowerPoint 可能还在用它）。"
  exit 0
fi

NODE_BIN="$(command -v node || true)"
if [ -z "$NODE_BIN" ]; then
  echo "❌ 未找到 node。请先安装 Node.js 22.12+（22.x）或 24+（本机 nvm 用户请先 source ~/.zshrc）"
  exit 1
fi
"$NODE_BIN" -e "const [a,b]=process.versions.node.split('.').map(Number);if(!((a===22&&b>=12)||a>=24))process.exit(1)"

if [ "$MODE" = "update" ] && { [ ! -f "$CERT_DIR/localhost-cert.pem" ] || [ ! -f "$CERT_DIR/localhost-key.pem" ]; }; then
  echo "缺少已安装的 HTTPS 证书，请先运行 ./install.sh 完成首次安装。"
  exit 1
fi
mkdir -p "$BASE" "$CERT_DIR"
chmod 700 "$BASE" "$CERT_DIR"

# ---- 1) 运行文件拷出桌面（TCC 保护区）----
echo "① 同步运行文件 → $APP"
STAGE="$(mktemp -d "$BASE/app.stage.XXXXXX")"
trap 'if [ -n "${STAGE:-}" ] && [ -d "$STAGE" ]; then rm -rf "$STAGE"; fi' EXIT
cp -R "$PROJ/tools" "$PROJ/server" "$PROJ/taskpane" "$PROJ/assets" "$PROJ/package.json" "$STAGE/"
"$NODE_BIN" --check "$STAGE/server/server.js"
if [ -d "$APP" ]; then
  PREVIOUS="$BASE/app.backup.$(date +%Y%m%d%H%M%S)"
  mv "$APP" "$PREVIOUS"
  echo "   旧版备份 → $PREVIOUS"
  # 只留最近 3 份备份
  ls -1dt "$BASE"/app.backup.* 2>/dev/null | tail -n +4 | while read -r old; do rm -rf "$old"; done
fi
mv "$STAGE" "$APP"
STAGE=""

# ---- 2) 本机 HTTPS 证书 ----
# 证书只绑定主机名（localhost/127.0.0.1），与端口无关，所以可以和 LLM_in_Word / LLM_in_PowerPoint 共用同一张已信任的证书。
CRT="$CERT_DIR/localhost-cert.pem"
KEY="$CERT_DIR/localhost-key.pem"
KEYCHAIN="$HOME/Library/Keychains/login.keychain-db"
is_trusted() { security verify-cert -c "$1" -p ssl -s localhost >/dev/null 2>&1; }
if [ ! -f "$CRT" ] || [ ! -f "$KEY" ]; then
  REUSED=""
  for OTHER_CERT in "$HOME/.word_edit/cert" "$HOME/.llm_in_word/cert" "$HOME/.llm_in_powerpoint/cert"; do
    if [ -f "$OTHER_CERT/localhost-cert.pem" ] && [ -f "$OTHER_CERT/localhost-key.pem" ] && is_trusted "$OTHER_CERT/localhost-cert.pem"; then
      cp "$OTHER_CERT/localhost-cert.pem" "$CRT"
      cp "$OTHER_CERT/localhost-key.pem" "$KEY"
      echo "$OTHER_CERT" > "$CERT_DIR/shared-from.txt"
      REUSED="$OTHER_CERT"
      break
    fi
  done
  if [ -n "$REUSED" ]; then
    echo "② 沿用已信任的本机证书（${REUSED}），无需再次输入密码"
  else
    echo "② 生成本机 HTTPS 证书…"
    openssl req -x509 -newkey rsa:2048 -sha256 -days 800 -nodes \
      -keyout "$KEY" -out "$CRT" \
      -subj "/CN=LLM_in_Excel-localhost" \
      -addext "subjectAltName=DNS:localhost,IP:127.0.0.1" \
      -addext "extendedKeyUsage=serverAuth" \
      -addext "keyUsage=digitalSignature,keyEncipherment" 2>/dev/null
  fi
else
  echo "② 证书已存在，跳过生成"
fi
chmod 600 "$KEY"

# 加入登录钥匙串并设为信任（已信任就跳过；需要时会弹一次密码框，输入 Mac 登录密码）
if is_trusted "$CRT"; then
  echo "   证书已被系统信任，跳过信任步骤"
elif [ "$MODE" = "update" ]; then
  echo "   ⚠️ 证书尚未被信任。请运行一次 ./install.sh（不带参数）完成信任，否则 Excel 面板会是空白的。"
else
  echo "   把证书加入钥匙串信任（会弹一次密码框，输 Mac 登录密码）…"
  if ! security add-trusted-cert -r trustRoot -k "$KEYCHAIN" "$CRT"; then
    echo "   ⚠️ 自动信任失败。手动办法：双击打开 $CRT 导入钥匙串，"
    echo "      然后在「钥匙串访问」里找到这张 localhost 证书，双击 → 信任 → 始终信任"
  fi
fi

# ---- 3) 启动垫片：把安装这一刻的代理设置和 CLI 路径烤进去（launchd 拉起的进程不带 ~/.zshrc）----
CLAUDE_PATH="${LLM_IN_EXCEL_CLAUDE_BIN:-$(command -v claude || true)}"
CODEX_PATH="${LLM_IN_EXCEL_CODEX_BIN:-$(command -v codex || true)}"
# 用 printf %q 生成安全的 shell 字面量，不 eval 代理值，也不把凭证打印到日志。
{
  printf '#!/bin/zsh\n# 由 install.sh 生成；代理或 CLI 路径变化后重跑安装。\n'
  for v in http_proxy https_proxy all_proxy no_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY NO_PROXY; do
    val="$(printenv "$v" || true)"
    if [ -n "$val" ]; then printf 'export %s=%q\n' "$v" "$val"; fi
  done
  if [ -n "$CLAUDE_PATH" ]; then printf 'export LLM_IN_EXCEL_CLAUDE_BIN=%q\n' "$CLAUDE_PATH"; fi
  if [ -n "$CODEX_PATH" ]; then printf 'export LLM_IN_EXCEL_CODEX_BIN=%q\n' "$CODEX_PATH"; fi
  printf 'export LLM_IN_EXCEL_DATA_DIR=%q\n' "$BASE"
  for v in LLM_IN_EXCEL_TIMEOUT_MS LLM_IN_EXCEL_MAX_CHARS; do
    val="$(printenv "$v" || true)"
    if [ -n "$val" ]; then printf 'export %s=%q\n' "$v" "$val"; fi
  done
  printf 'export LLM_IN_EXCEL_PORT=%q\n' "$PORT"
  printf 'exec %q %q\n' "$NODE_BIN" "$APP/server/server.js"
} > "$BASE/run.sh"
echo "③ 已同步 CLI 路径与代理设置（敏感值不显示）"
chmod 700 "$BASE/run.sh"

# ---- 4) launchd 常驻服务 ----
echo "④ 注册 launchd 服务 $LABEL"
mkdir -p "$HOME/Library/LaunchAgents"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string>
    <string>$BASE/run.sh</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>$BASE/server.log</string>
  <key>StandardErrorPath</key><string>$BASE/server.log</string>
</dict>
</plist>
EOF
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
# bootout can return before the previous job has fully disappeared.
STARTED=false
for attempt in 1 2 3 4 5; do
  if launchctl bootstrap "gui/$(id -u)" "$PLIST" 2>"$BASE/launchd-error.log"; then STARTED=true; break; fi
  sleep 1
done
if ! $STARTED; then cat "$BASE/launchd-error.log"; exit 1; fi

# ---- 5) 侧载 manifest 到 Excel ----
echo "⑤ 侧载 manifest → $WEF"
mkdir -p "$WEF"
cp "$PROJ/manifest.xml" "$WEF/LLM_in_Excel-manifest.xml"

# ---- 6) 健康检查（必须绕开代理：走 http_proxy 的话本机回环会被代理吞掉而误报）----
if ! "$NODE_BIN" "$APP/tools/check-install.js" "$CERT_DIR"; then
  echo "服务启动或证书验证失败，请查看 $BASE/server.log"
  exit 1
fi
echo "✅ LLM_in_Excel 已在 https://localhost:$PORT 运行。"
if [ "$MODE" = "update" ]; then
  echo "  更新已完成，在 Excel 的 LLM_in_Excel 面板点右上角 ⟳ 即可加载新版。"
  exit 0
fi
echo "  1. 完全退出 Excel（Cmd+Q）再重新打开"
echo "  2. 「开始」功能区右侧点「LLM_in_Excel」；没有按钮的话，从「插入」→「加载项」→「我的加载项」→「开发人员加载项」里选它"
echo "     （首次打开如果面板空白：多半是证书信任没生效，重跑本脚本或看 docs/troubleshooting.md）"
echo ""
echo "卸载：./install.sh --uninstall"
