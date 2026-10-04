#!/bin/zsh
cd "$(dirname "$0")"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! command -v node >/dev/null 2>&1; then
  print "Node.js 22 이상이 필요합니다. https://nodejs.org 에서 설치해 주세요."
  read "?Enter를 누르면 종료합니다. "
  exit 1
fi
node lib/launcher.mjs
