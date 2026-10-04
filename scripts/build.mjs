import {mkdir,cp,writeFile,chmod} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const bundle=path.join(root,'dist','Voice Studio.app','Contents');
await mkdir(path.join(bundle,'MacOS'),{recursive:true});await mkdir(path.join(bundle,'Resources','app'),{recursive:true});
for(const entry of ['lib','public','server.mjs','package.json','README.md'])await cp(path.join(root,entry),path.join(bundle,'Resources','app',entry),{recursive:true});
const plist=`<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleName</key><string>Voice Studio</string><key>CFBundleDisplayName</key><string>Voice Studio</string><key>CFBundleIdentifier</key><string>local.script.voice-studio</string><key>CFBundleExecutable</key><string>launch</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleShortVersionString</key><string>1.0.0</string><key>LSUIElement</key><true/></dict></plist>`;
await writeFile(path.join(bundle,'Info.plist'),plist);
const launch=`#!/bin/zsh
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
bundle="$(cd "$(dirname "$0")/.." && pwd)"
export TTS_WORKSPACE="$(cd "$bundle/../../.." && pwd)"
mkdir -p "$TTS_WORKSPACE/data"
exec node "$bundle/Resources/app/lib/launcher.mjs" >> "$TTS_WORKSPACE/data/launcher.log" 2>&1
`;
await writeFile(path.join(bundle,'MacOS','launch'),launch);await chmod(path.join(bundle,'MacOS','launch'),0o755);await chmod(path.join(root,'시작.command'),0o755);
console.log('빌드 완료: dist/Voice Studio.app (API 키와 대본 데이터는 번들에 포함하지 않음)');
