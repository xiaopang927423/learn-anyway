#!/usr/bin/env python3
"""Package prebuilt WordMate desktop + IME locally. Never fetches or uploads source/artifacts."""
import argparse,hashlib,json,pathlib,plistlib,shutil,subprocess,tempfile
ROOT=pathlib.Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser()
p.add_argument('--output',type=pathlib.Path,default=ROOT/'dist')
a=p.parse_args();out=a.output.resolve();out.mkdir(parents=True,exist_ok=True)
subprocess.run(['python3',str(ROOT/'scripts/versions.py')],check=True)
release=json.loads((ROOT/'release.json').read_text());release_version=release['version']
desktop=ROOT/'wordmate/dist/mac-arm64/WordMate.app'
ime=ROOT/'input-method/bundle/WordMateInput.app'
for app,identity in [(desktop,'com.qiji.wordmate'),(ime,'com.qiji.wordmate.inputmethod')]:
    if not app.is_dir():raise SystemExit('Build first: '+str(app))
    info=plistlib.loads((app/'Contents/Info.plist').read_bytes())
    if info.get('CFBundleIdentifier')!=identity:raise SystemExit('Unexpected bundle identity')
if plistlib.loads((ime/'Contents/Info.plist').read_bytes())['CFBundleShortVersionString']!=release['components']['inputMethod']:raise SystemExit('Stale IME build')
if plistlib.loads((desktop/'Contents/Info.plist').read_bytes())['CFBundleShortVersionString']!=release_version:raise SystemExit('Stale desktop build')
subprocess.run(['/usr/bin/codesign','--verify','--strict',str(ime)],check=True)
# Inspect the exact packaged backend, not just its version label.
subprocess.run(['node','-e',"const a=require('@electron/asar'),p=process.argv[1];const b=a.extractFile(p,'src/ime-bridge.js').toString(),m=a.extractFile(p,'main.js').toString();if(!b.includes(\"'english'\")||!m.includes('startImeBridge'))process.exit(1)",str(desktop/'Contents/Resources/app.asar')],cwd=ROOT/'wordmate',check=True)
with tempfile.TemporaryDirectory(prefix='wordmate-local-product-') as directory:
    work=pathlib.Path(directory);payload=work/'payload'
    for src,relative in [(desktop,'Applications/WordMate.app'),(ime,'Library/Input Methods/WordMateInput.app')]:
        dst=payload/relative;dst.parent.mkdir(parents=True,exist_ok=True)
        subprocess.run(['/usr/bin/ditto',str(src),str(dst)],check=True)
    guide=payload/'Applications/WordMate-使用说明';guide.mkdir()
    shutil.copy2(ROOT/'docs/测试目录/本地安装包使用说明.md',guide/'安装与使用.md')
    shutil.copy2(ROOT/'LICENSE',guide/'LICENSE')
    shutil.copy2(ROOT/'release.json',guide/'release.json')
    shutil.copy2(ROOT/'THIRD_PARTY_NOTICES.md',guide/'第三方许可.md')
    # Extension files are already inside desktop Resources; expose a convenient stable folder.
    extension=desktop/'Contents/Resources/browser-extension'
    if extension.is_dir():shutil.copytree(extension,guide/'浏览器扩展')
    parts=work/'components.plist'
    subprocess.run(['pkgbuild','--analyze','--root',str(payload),str(parts)],check=True)
    rows=plistlib.loads(parts.read_bytes())
    for row in rows:
        row.update(BundleIsRelocatable=False,BundleIsVersionChecked=False,BundleHasStrictIdentifier=True,BundleOverwriteAction='upgrade')
    parts.write_bytes(plistlib.dumps(rows))
    identifier='com.qiji.wordmate.local.product'
    subprocess.run(['pkgbuild','--root',str(payload),'--component-plist',str(parts),'--scripts',str(ROOT/'scripts/local-installer'),'--identifier',identifier,'--version',release_version,'--install-location','/',str(work/'wordmate-components.pkg')],check=True)
    (work/'Welcome.html').write_text(f'<html><body><h2>WordMate {release_version}</h2><p>独立本地实验版：包含桌面学习助手、原生输入法、浏览器扩展文件。输入法仍存在已知和未知 bug，请保留系统输入法。</p><p>安装到当前用户目录，模型凭证、学习库和个人词条不随安装包分发。现有数据保留。</p></body></html>')
    (work/'ReadMe.html').write_text('<html><body><p>适用于 Apple Silicon macOS 13 及以上。本地开发包，未进行 Developer ID 公证。</p><p>双击安装后打开 WordMate 配置模型；在系统键盘输入源中启用 WordMate。Shift 切换；中文数字选词，英文 Space 空格、Tab 补全。浏览器扩展需手动加载。安装脚本需要本机 /usr/bin/python3 可用。</p><p>详细说明安装到 ~/Applications/WordMate-使用说明/。安装后若输入源暂未出现，可注销后重新登录再添加。</p></body></html>')
    distribution=work/'Distribution.xml'
    distribution.write_text(f'''<?xml version="1.0" encoding="utf-8"?>
<installer-gui-script minSpecVersion="2">
<title>WordMate {release_version} · 独立本地实验版</title>
<options customize="never" require-scripts="true" hostArchitectures="arm64"/>
<domains enable_anywhere="false" enable_currentUserHome="true" enable_localSystem="false"/>
<volume-check><allowed-os-versions><os-version min="13.0"/></allowed-os-versions></volume-check>
<welcome file="Welcome.html"/><readme file="ReadMe.html"/>
<choices-outline><line choice="wordmate"/></choices-outline>
<choice id="wordmate" title="WordMate 桌面与输入法"><pkg-ref id="com.qiji.wordmate.local.product"/></choice>
<pkg-ref id="com.qiji.wordmate.local.product" version="{release_version}" auth="none" onConclusion="None">wordmate-components.pkg</pkg-ref>
</installer-gui-script>''')
    package=out/f'WordMate-{release_version}-macOS-arm64.pkg'
    subprocess.run(['productbuild','--distribution',str(distribution),'--resources',str(work),'--package-path',str(work),str(package)],check=True)
sha=hashlib.sha256(package.read_bytes()).hexdigest()
source_commit=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()
source_dirty=bool(subprocess.check_output(['git','status','--porcelain','--untracked-files=no'],cwd=ROOT,text=True).strip())
(out/(package.name+'.release.json')).write_text(json.dumps({'version':release_version,'components':release['components'],'sourceCommit':source_commit,'sourceDirty':source_dirty,'file':package.name,'bytes':package.stat().st_size,'sha256':sha},ensure_ascii=False,indent=2)+'\n')
shutil.copy2(out/(package.name+'.release.json'),out/'current-release.json')
(out/(package.name+'.sha256')).write_text(sha+'  '+package.name+'\n')
shutil.copy2(ROOT/'docs/测试目录/本地安装包使用说明.md',out/'WordMate-安装说明.md')
print(json.dumps({'package':str(package),'bytes':package.stat().st_size,'sha256':sha},ensure_ascii=False))
