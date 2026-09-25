#!/bin/bash
# LLM_in_Word macOS 一次性安装脚本：
#   1) 把运行文件拷到 ~/.llm_in_word/app（旧安装沿用原目录）（launchd 拉起的 node 读桌面会被 TCC 拦，拷出去绕开）
#   2) 生成并信任本机 HTTPS 证书（Word 的网页视图只认 https，第一次会弹一次钥匙串密码框）
#   3) 注册 launchd 常驻服务 com.llm_in_word.server（开机自启、崩了自动拉起）
#   4) 把加载项 manifest 拷进 Word 的侧载目录
# 改了代码 / 换了代理端口 → 重跑一次本脚本即可（幂等）。
set -euo pipefail
cd "$(dirname "$0")"
PROJ="$(pwd)"
UPDATE_ONLY=false
if [ "${1:-}" = "--update-only" ]; then UPDATE_ONLY=true; fi

PORT=8377
LABEL="com.llm_in_word.server"
BASE="$HOME/.llm_in_word"
# Preserve existing certificate trust, sessions and local data during upgrade.
if [ -d "$HOME/.word_edit" ]; then BASE="$HOME/.word_edit"; fi
APP="$BASE/app"
CERT_DIR="$BASE/cert"
WEF="$HOME/Library/Containers/com.microsoft.Word/Data/Documents/wef"

NODE_BIN="$(command -v node || true)"
if [ -z "$NODE_BIN" ]; then
  echo "❌ 未找到 node。请先安装 Node.js 22.12+（22.x）或 24+（本机 nvm 用户请先 source ~/.zshrc）"
  exit 1
fi

if [ "$(uname -s)" != "Darwin" ]; then echo "Windows: run install.ps1 instead."; exit 1; fi
"$NODE_BIN" -e "const [a,b]=process.versions.node.split('.').map(Number);if(!((a===22&&b>=12)||a>=24))process.exit(1)"

if $UPDATE_ONLY && { [ ! -f "$CERT_DIR/localhost-cert.pem" ] || [ ! -f "$CERT_DIR/localhost-key.pem" ]; }; then
  echo "缺少已安装的 HTTPS 证书，请先运行 ./install.sh 完成首次安装。"
  exit 1
fi
mkdir -p "$BASE" "$CERT_DIR"

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
fi
mv "$STAGE" "$APP"
STAGE=""

# ---- 2) 本机 HTTPS 证书（自签，SAN=localhost/127.0.0.1；macOS 要求有效期 ≤825 天）----
CRT="$CERT_DIR/localhost-cert.pem"
KEY="$CERT_DIR/localhost-key.pem"
if [ ! -f "$CRT" ] || [ ! -f "$KEY" ]; then
  echo "② 生成本机 HTTPS 证书…"
  openssl req -x509 -newkey rsa:2048 -sha256 -days 800 -nodes \
    -keyout "$KEY" -out "$CRT" \
    -subj "/CN=LLM_in_Word-localhost" \
    -addext "subjectAltName=DNS:localhost,IP:127.0.0.1" \
    -addext "extendedKeyUsage=serverAuth" \
    -addext "keyUsage=digitalSignature,keyEncipherment" 2>/dev/null
else
  echo "② 证书已存在，跳过生成"
fi

# 加入登录钥匙串并设为信任（已加过就跳过；第一次会弹密码框，输入 Mac 登录密码）
if $UPDATE_ONLY; then
  echo "   更新模式：沿用已安装证书，不修改钥匙串"
elif security find-certificate -c "LLM_in_Word-localhost" "$HOME/Library/Keychains/login.keychain-db" >/dev/null 2>&1; then
  echo "   钥匙串里已有该证书，跳过信任步骤"
else
  echo "   把证书加入钥匙串信任（会弹一次密码框，输 Mac 登录密码）…"
  if ! security add-trusted-cert -r trustRoot -k "$HOME/Library/Keychains/login.keychain-db" "$CRT"; then
    echo "   ⚠️ 自动信任失败。手动办法：双击打开 $CRT 导入钥匙串，"
    echo "      然后在「钥匙串访问」里找到 LLM_in_Word-localhost，双击 → 信任 → 始终信任"
  fi
fi

# ---- 3) 启动垫片：把安装这一刻的代理设置烤进去（launchd/Word 拉起的进程不带 ~/.zshrc 的代理）----
CLAUDE_PATH="${LLM_IN_WORD_CLAUDE_BIN:-${WORD_EDIT_CLAUDE_BIN:-$(command -v claude || true)}}"
CODEX_PATH="${LLM_IN_WORD_CODEX_BIN:-${WORD_EDIT_CODEX_BIN:-$(command -v codex || true)}}"
# 用 printf %q 生成安全的 shell 字面量，不 eval 代理值，也不把凭证打印到日志。
{
  printf '#!/bin/zsh\n# 由 install.sh 生成；代理或 CLI 路径变化后重跑安装。\n'
  for v in http_proxy https_proxy all_proxy no_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY NO_PROXY; do
    val="$(printenv "$v" || true)"
    if [ -n "$val" ]; then printf 'export %s=%q\n' "$v" "$val"; fi
  done
  if [ -n "$CLAUDE_PATH" ]; then printf 'export LLM_IN_WORD_CLAUDE_BIN=%q\n' "$CLAUDE_PATH"; fi
  if [ -n "$CODEX_PATH" ]; then printf 'export LLM_IN_WORD_CODEX_BIN=%q\n' "$CODEX_PATH"; fi
  printf 'export LLM_IN_WORD_DATA_DIR=%q\n' "$BASE"
  for v in LLM_IN_WORD_TIMEOUT_MS LLM_IN_WORD_MAX_CHARS; do
    val="$(printenv "$v" || true)"
    if [ -n "$val" ]; then printf 'export %s=%q\n' "$v" "$val"; fi
  done
  printf 'export LLM_IN_WORD_PORT=%q\n' "$PORT"
  printf 'exec %q %q\n' "$NODE_BIN" "$APP/server/server.js"
} > "$BASE/run.sh"
echo "③ 已同步 CLI 路径与代理设置（敏感值不显示）"
chmod 700 "$BASE/run.sh"

# ---- 4) launchd 常驻服务 ----
echo "④ 注册 launchd 服务 $LABEL"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
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
launchctl bootout "gui/$(id -u)/com.word_edit.server" 2>/dev/null || true
rm -f "$HOME/Library/LaunchAgents/com.word_edit.server.plist"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
# bootout can return before the previous job has fully disappeared.
STARTED=false
for attempt in 1 2 3 4 5; do
  if launchctl bootstrap "gui/$(id -u)" "$PLIST" 2>"$BASE/launchd-error.log"; then STARTED=true; break; fi
  sleep 1
done
if ! $STARTED; then cat "$BASE/launchd-error.log"; exit 1; fi

# ---- 5) 侧载 manifest 到 Word ----
echo "⑤ 侧载 manifest → $WEF"
mkdir -p "$WEF"
cp "$PROJ/manifest.xml" "$WEF/LLM_in_Word-manifest.xml"
rm -f "$WEF/word_edit-manifest.xml"

# ---- 6) 健康检查（必须绕开代理：curl 走 http_proxy 的话本机回环会被代理吞掉而误报）----
if ! "$NODE_BIN" "$APP/tools/check-install.js" "$CERT_DIR"; then
  echo "服务启动或证书验证失败，请查看 $BASE/server.log"
  exit 1
fi
echo "✅ LLM_in_Word 已在 https://localhost:$PORT 运行。"
if $UPDATE_ONLY; then
  echo "  更新已完成，在 Word 的 LLM_in_Word面板点右上角 ⟳ 即可加载新版。"
  exit 0
fi
echo "  1. 完全退出 Word（Cmd+Q）再重新打开"
echo "  2. 功能区「插入」→「加载项」（或「我的加载项」下拉小箭头）→「开发人员」区域 → 选「LLM_in_Word」"
echo "     （首次打开如果面板空白：多半是证书信任没生效，重跑本脚本或看 README 排查）"
echo "  3. 以后每次打开 Word，「开始」功能区右侧会有「✦ LLM_in_Word」按钮，点击开合面板"
echo ""
echo "卸载：launchctl bootout gui/\$(id -u)/${LABEL} && rm -rf \"$BASE\" \"$PLIST\" \"$WEF/LLM_in_Word-manifest.xml\""
