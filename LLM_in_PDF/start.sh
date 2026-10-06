#!/bin/bash
# 启动 LLM_in_PDF 本地后端。保持这个窗口开着；关掉即停止服务。
# 想换端口：LLM_IN_PDF_PORT=8790 ./start.sh
cd "$(dirname "$0")" || exit 1
echo "启动 LLM_in_PDF 后端…（Ctrl+C 停止）"
exec node server/server.js
