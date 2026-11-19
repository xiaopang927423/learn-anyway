#!/usr/bin/env python3
"""Keep one desktop installation and archive backups without discoverable .app copies."""
import argparse
import datetime
import os
from pathlib import Path
import plistlib
import shutil
import subprocess
import zipfile

LSREGISTER = '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister'


def verify_identity(bundle):
    if bundle.is_symlink() or plistlib.loads((bundle / 'Contents/Info.plist').read_bytes()).get('CFBundleIdentifier') != 'com.qiji.wordmate':
        raise RuntimeError('Unexpected WordMate bundle; replacement canceled: ' + str(bundle))


def archive(bundle, directory):
    verify_identity(bundle)
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    stamp = datetime.datetime.now().strftime('%Y%m%d-%H%M%S-%f')
    target = directory / ('WordMate-' + stamp + '.zip')
    subprocess.run(['/usr/bin/ditto', '-c', '-k', '--keepParent', str(bundle), str(target)], check=True)
    with zipfile.ZipFile(target) as saved:
        if saved.testzip() is not None or 'WordMate.app/Contents/Info.plist' not in saved.namelist():
            raise RuntimeError('Backup verification failed; original application retained')
    return target


def unregister(bundle):
    # Missing/stale registration must not prevent installing a valid application.
    subprocess.run([LSREGISTER, '-u', str(bundle)], check=False, stdout=subprocess.DEVNULL)


def install(source, home, system=Path('/Applications/WordMate.app')):
    user = home / 'Applications/WordMate.app'
    destination = system if system.exists() else user
    verify_identity(source)
    for old in {user, destination}:
        if old.exists():
            verify_identity(old)
            if not os.access(old, os.W_OK):
                raise RuntimeError('Existing WordMate is not writable; installation canceled: ' + str(old))
    backups = home / 'Library/Application Support/WordMate/app-backup'
    for old in {user, destination}:
        if old.exists():
            archive(old, backups)
    destination.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(['/usr/bin/ditto', str(source), str(destination)], check=True)
    verify_identity(destination)
    subprocess.run(['/usr/bin/codesign', '--verify', '--strict', str(destination)], check=True)
    # Remove only the redundant application, after backup and successful validation.
    # Preferences, learning records, and credentials live outside the app bundle.
    if destination != user and user.exists():
        unregister(user)
        shutil.rmtree(user)
    return destination


def consolidate(home, system=Path('/Applications/WordMate.app')):
    user = home / 'Applications/WordMate.app'
    verify_identity(user)
    if not system.exists():
        subprocess.run(['/usr/bin/codesign', '--verify', '--strict', str(user)], check=True)
        return user
    # preinstall already archived both old installations. The user bundle is the
    # new package payload; retain it if copying or verifying the system copy fails.
    verify_identity(system)
    if not os.access(system, os.W_OK):
        raise RuntimeError('Existing system WordMate is not writable; user payload retained')
    subprocess.run(['/usr/bin/ditto', str(user), str(system)], check=True)
    subprocess.run(['/usr/bin/codesign', '--verify', '--strict', str(system)], check=True)
    unregister(user)
    shutil.rmtree(user)
    return system


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--home', type=Path, required=True)
    parser.add_argument('--source', type=Path)
    args = parser.parse_args()
    print(install(args.source, args.home) if args.source else consolidate(args.home))
