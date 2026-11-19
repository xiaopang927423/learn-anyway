#!/usr/bin/env python3
"""Install through macOS Installer and verify both method and mode activation."""
import argparse, json, pathlib, subprocess
ROOT=pathlib.Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser()
parser.add_argument('--select',action='store_true',help='Select WordMate after activation has been verified')
args=parser.parse_args()
bundle=ROOT/'bundle/build.noindex/WordMateInput.app'
if not bundle.is_dir():raise SystemExit('Run scripts/build.py first')
if pathlib.Path('/Library/Input Methods/WordMateInput.app').exists():
    raise SystemExit('A system-wide WordMate input method exists; resolve its installation location before using this per-user installer')
subprocess.run(['python3',str(ROOT/'scripts/package.py')],check=True)
release=json.loads((ROOT.parent/'release.json').read_text())
package=ROOT/'dist'/f"WordMateInput-{release['components']['inputMethod']}-dev-local.pkg"
subprocess.run(['/usr/sbin/installer','-pkg',str(package),'-target','CurrentUserHomeDirectory'],check=True)
destination=pathlib.Path.home()/'Library/Input Methods/WordMateInput.app'
exe=destination/'Contents/MacOS/WordMateInput'
status=json.loads(subprocess.check_output([str(exe),'--registration-status'],text=True))
if not status['ready']:
    print('IME_FILES_INSTALLED_ACTIVATION_PENDING '+str(destination))
    print('Parent input method and mode must both be enabled. Run --register from a normal user Terminal, then check --registration-status. See install-state.json for the observed state.')
    raise SystemExit(2)
if args.select:
    subprocess.run([str(exe),'--select-source',status['sourceId']],check=True)
    selected=json.loads(subprocess.check_output([str(exe),'--registration-status'],text=True))
    if selected['currentSourceId']!=status['sourceId']:raise SystemExit('Input source selection did not persist')
print('IME_INSTALLED_AND_ENABLED '+str(destination))
