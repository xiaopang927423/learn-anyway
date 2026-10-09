#!/usr/bin/env python3
# coding: utf-8
"""Build a local development bundle without installing or activating input sources."""
import argparse, hashlib, json, pathlib, plistlib, shutil, subprocess
ROOT = pathlib.Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--reference', type=pathlib.Path, help='Import documented local Qingjian data assets')
parser.add_argument('--release', action='store_true', help='Optimized local build; does not authorize publication')
args = parser.parse_args()
resources = ROOT / 'resources'
manifest = json.loads((ROOT / 'resource-manifest.json').read_text())
if args.reference:
    reference = args.reference.resolve()
    resources.mkdir(exist_ok=True)
    for item in manifest['files']:
        name = item['file']
        if name.startswith('wubi/'):
            source = reference / 'assets' / name
        elif name in ['emoji-zh.tsv', 'emoji-en.tsv']:
            source = reference / 'assets/emoji' / name
        elif name == 'levels-en.tsv':
            source = reference / 'assets/levels' / name
        else:
            source = reference / 'data/generated' / name
        target = resources / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
for item in manifest['files']:
    source = resources / item['file']
    if not source.is_file() or hashlib.sha256(source.read_bytes()).hexdigest() != item['sha256']:
        raise SystemExit('Resource missing or changed: ' + item['file'] + '; supply --reference with the documented snapshot')
command = ['cargo', 'build', '--offline', '--manifest-path', str(ROOT / 'Cargo.toml'), '-p', 'qingjian-macos']
if args.release: command.append('--release')
subprocess.run(command, check=True)
bundle = ROOT / 'bundle/WordMateInput.app'
contents = bundle / 'Contents'
(contents / 'MacOS').mkdir(parents=True, exist_ok=True)
output = contents / 'Resources'
if output.exists(): shutil.rmtree(output)
shutil.copytree(resources, output)
shutil.copytree(ROOT / 'licenses', output / 'licenses')
for name in ['LICENSE', 'NOTICE.md', 'UPSTREAM-DATA-SOURCES.md', 'resource-manifest.json']:
    shutil.copy2(ROOT / name, output / name)
shutil.copy2(ROOT / ('target/release' if args.release else 'target/debug') / 'qingjian-macos', contents / 'MacOS/WordMateInput')
info = plistlib.loads((ROOT / 'apps/macos/Info.plist').read_bytes())
info['CFBundleExecutable'] = 'WordMateInput'
info['CFBundleShortVersionString'] = '0.5.0'
info['CFBundleVersion'] = '5001'
info['WMDevelopmentBuild'] = True
info['CFBundleIconFile'] = 'WordMateInput.icns'
# Original WordMate W mark, no upstream brand asset.
info['tsInputMethodIconFileKey'] = 'wordmate-menu.pdf'
for mode in info['ComponentInputModeDict']['tsInputModeListKey'].values():
    for k in ['tsInputModeMenuIconFileKey', 'tsInputModeAlternateMenuIconFileKey', 'tsInputModePaletteIconFileKey']:
        mode[k] = 'wordmate-menu.pdf'
shutil.copy2(ROOT / 'assets/wordmate-menu.pdf',output / 'wordmate-menu.pdf')
(contents / 'Info.plist').write_bytes(plistlib.dumps(info))
shutil.copy2(ROOT.parent / 'wordmate/assets/icon.icns', output / 'WordMateInput.icns')
strings = output / 'zh-Hans.lproj'
strings.mkdir(exist_ok=True)
(strings / 'InfoPlist.strings').write_text('CFBundleName = "WordMate 输入法";\nCFBundleDisplayName = "WordMate 输入法";\n"com.qiji.wordmate.inputmethod.Hans" = "WordMate 输入法";\n', encoding='utf-8')
english = output / 'en.lproj'
english.mkdir(exist_ok=True)
(english / 'InfoPlist.strings').write_text('CFBundleName = "WordMate Input";\nCFBundleDisplayName = "WordMate Input";\n"com.qiji.wordmate.inputmethod.Hans" = "WordMate Input";\n', encoding='utf-8')
subprocess.run(['/usr/bin/codesign', '--force', '--sign', '-', str(bundle)], check=True)
print('IME_BUILD_OK ' + str(bundle))
