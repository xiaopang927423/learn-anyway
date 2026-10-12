#!/usr/bin/env python3
"""Create a local per-user macOS development installer; does not publish artifacts."""
import pathlib, plistlib, shutil, subprocess, tempfile
ROOT=pathlib.Path(__file__).resolve().parents[1]
bundle=ROOT/'bundle/WordMateInput.app'
if not bundle.exists():raise SystemExit('Build WordMateInput.app first')
subprocess.run(['codesign','--verify','--strict',str(bundle)],check=True)
output=ROOT/'dist';output.mkdir(exist_ok=True)
with tempfile.TemporaryDirectory(prefix='wm-ime-package-') as directory:
    work=pathlib.Path(directory);payload=work/'payload'
    destination=payload/'Library/Input Methods/WordMateInput.app';destination.parent.mkdir(parents=True)
    subprocess.run(['ditto',str(bundle),str(destination)],check=True)
    components=work/'components.plist'
    subprocess.run(['pkgbuild','--analyze','--root',str(payload),str(components)],check=True)
    values=plistlib.loads(components.read_bytes())
    for item in values:
        item['BundleIsRelocatable']=False;item['BundleIsVersionChecked']=False
        item['BundleHasStrictIdentifier']=True;item['BundleOverwriteAction']='upgrade'
    components.write_bytes(plistlib.dumps(values))
    identifier='com.qiji.wordmate.inputmethod.local'
    subprocess.run(['pkgbuild','--root',str(payload),'--component-plist',str(components),'--scripts',str(ROOT/'scripts/pkg'),'--identifier',identifier,'--version','0.6.0','--install-location','/',str(work/'input-method.pkg')],check=True)
    distribution=work/'Distribution.xml'
    distribution.write_text('''<?xml version="1.0" encoding="utf-8"?>
<installer-gui-script minSpecVersion="2">
<title>WordMate 0.6.0 输入法 · 本地开发版</title>
<options customize="never" require-scripts="true" hostArchitectures="arm64"/>
<domains enable_anywhere="false" enable_currentUserHome="true" enable_localSystem="false"/>
<choices-outline><line choice="ime"/></choices-outline>
<choice id="ime" title="WordMate 输入法"><pkg-ref id="com.qiji.wordmate.inputmethod.local"/></choice>
<pkg-ref id="com.qiji.wordmate.inputmethod.local" version="0.6.0" auth="none" onConclusion="None">input-method.pkg</pkg-ref>
</installer-gui-script>
''')
    package=output/'WordMateInput-0.6.0-dev-local.pkg'
    subprocess.run(['productbuild','--distribution',str(distribution),'--package-path',str(work),str(package)],check=True)
print('IME_PACKAGE_OK '+str(package))
