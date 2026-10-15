#!/usr/bin/env python3
"""Synchronize or verify release metadata. Does not build, tag or publish."""
import argparse,json,pathlib,plistlib,re
ROOT=pathlib.Path(__file__).resolve().parents[1]
SEMVER=re.compile(r'\d+\.\d+\.\d+')
def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--sync',action='store_true');args=p.parse_args()
 release=json.loads((ROOT/'release.json').read_text());version=release['version'];c=release['components']
 if not all(SEMVER.fullmatch(v) for v in [version,*c.values()]):raise SystemExit('Invalid release version')
 if c['desktop']!=version or c['extension']!=version:raise SystemExit('Desktop / extension must match product release')
 expected={}
 for name,key in [('wordmate/package.json','desktop'),('wordmate/browser-extension/manifest.json','extension'),('wordmate/package-lock.json','desktop')]:
  path=ROOT/name;data=json.loads(path.read_text());data['version']=c[key]
  if name.endswith('package-lock.json'):data['packages']['']['version']=c[key]
  expected[path]=json.dumps(data,ensure_ascii=False,indent=2)+'\n'
 path=ROOT/'input-method/apps/macos/Info.plist';data=plistlib.loads(path.read_bytes());data['CFBundleShortVersionString']=c['inputMethod'];data['CFBundleVersion']=release['inputMethodBuild'];expected[path]=plistlib.dumps(data).decode()
 for name in ['website/index.html','website/app.js','README.md','docs/测试目录/本地安装包使用说明.md']:
  path=ROOT/name;text=path.read_text();text=re.sub(r'(WordMate-)\d+\.\d+\.\d+(-macOS-arm64\.pkg)',lambda m:m[1]+version+m[2],text)
  text=re.sub(r'(macOS · )\d+\.\d+\.\d+',lambda m:m[1]+version,text)
  if name.endswith('本地安装包使用说明.md'):
   text=re.sub(r'(# WordMate )\d+\.\d+\.\d+',lambda m:m[1]+version,text)
   text=re.sub(r'(插件版本为 )\d+\.\d+\.\d+',lambda m:m[1]+c['extension'],text)
  expected[path]=text
 stale=[]
 for path,text in expected.items():
  # JSON and plist formatting is not a version mismatch.
  if path.suffix=='.json':same=json.loads(path.read_text())==json.loads(text)
  elif path.suffix=='.plist':same=plistlib.loads(path.read_bytes())==plistlib.loads(text.encode())
  else:same=path.read_text()==text
  if not same:
   if args.sync:path.write_text(text)
   else:stale.append(str(path.relative_to(ROOT)))
 if stale:raise SystemExit('VERSION_MISMATCH '+', '.join(stale)+'; edit release.json then run python3 scripts/versions.py --sync')
 print('VERSIONS_OK product='+version+' desktop='+c['desktop']+' extension='+c['extension']+' inputMethod='+c['inputMethod'])
if __name__=='__main__':main()
