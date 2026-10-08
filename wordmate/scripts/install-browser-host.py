#!/usr/bin/env python3
import json, pathlib, re, shutil, sys
extension_id = sys.argv[1] if len(sys.argv) == 2 else 'ceofdapoadbljkhedkgbbffeajbpplpe'
if len(sys.argv) > 2 or not re.fullmatch('[a-p]{32}', extension_id):
    raise SystemExit('用法：python3 scripts/install-browser-host.py 扩展ID（32 位 a-p）')
root = pathlib.Path.home() / 'Library/Application Support/WordMate/browser-host'
root.mkdir(parents=True, exist_ok=True)
application = next((p for p in pathlib.Path(__file__).resolve().parents if p.suffix == '.app'), None)
if application is None:
    candidates = [pathlib.Path('/Applications/WordMate.app'), pathlib.Path.home() / 'Applications/WordMate.app']
    application = next((p for p in candidates if p.exists()), None)
if application is None:
    raise SystemExit('请先安装打包后的 WordMate.app')
config_file = root / 'connection.json'
config_file.write_text(json.dumps({'appPath': str(application)}, ensure_ascii=False))
config_file.chmod(0o600)
host = root / 'browser-host.py'
shutil.copyfile(pathlib.Path(__file__).with_name('browser-host.py'), host)
launcher = root / 'launch-host'
import shlex
launcher.write_text('#!/bin/sh\nexec ' + shlex.quote('/usr/bin/python3') + ' ' + shlex.quote(str(host)) + '\n')
launcher.chmod(0o700)
manifest = {'name': 'com.qiji.wordmate', 'description': 'WordMate selection translation', 'path': str(launcher), 'type': 'stdio', 'allowed_origins': ['chrome-extension://' + extension_id + '/']}
for browser in ['Google/Chrome', 'Microsoft Edge', 'Chromium']:
    target = pathlib.Path.home() / 'Library/Application Support' / browser / 'NativeMessagingHosts'
    target.mkdir(parents=True, exist_ok=True)
    (target / 'com.qiji.wordmate.json').write_text(json.dumps(manifest, indent=2))
print('已安装 Chrome / Edge / Chromium 浏览器连接程序。')
