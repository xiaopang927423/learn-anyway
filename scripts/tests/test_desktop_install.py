"""Exercise upgrade routing and failure preservation with isolated app fixtures."""
import importlib.util
from pathlib import Path
import plistlib
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import zipfile

SPEC = importlib.util.spec_from_file_location('desktop_bundle', Path(__file__).resolve().parents[1] / 'local-installer/desktop-bundle.py')
bundles = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(bundles)


class DesktopInstallTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.home = self.root / 'home'
        self.user = self.home / 'Applications/WordMate.app'
        self.system = self.root / 'Applications/WordMate.app'
        self.source = self.root / 'build.noindex/WordMate.app'
        self.make_app(self.source, 'new')
        self.commands = []

    def make_app(self, path, content, identity='com.qiji.wordmate'):
        (path / 'Contents').mkdir(parents=True)
        (path / 'Contents/Info.plist').write_bytes(plistlib.dumps({'CFBundleIdentifier': identity}))
        (path / 'Contents/version').write_text(content)

    def run_tool(self, command, **kwargs):
        self.commands.append(command)
        if command[0] == '/usr/bin/ditto':
            if '-c' in command:
                source, target = map(Path, command[-2:])
                with zipfile.ZipFile(target, 'w') as saved:
                    for file in source.rglob('*'):
                        if file.is_file():
                            saved.write(file, file.relative_to(source.parent))
            else:
                shutil.copytree(command[1], command[2], dirs_exist_ok=True)
        return subprocess.CompletedProcess(command, 0)

    def test_existing_system_keeps_one_app_and_archives_both_old_versions(self):
        self.make_app(self.system, 'system-old')
        self.make_app(self.user, 'user-old')
        with patch.object(bundles.subprocess, 'run', side_effect=self.run_tool):
            self.assertEqual(bundles.install(self.source, self.home, self.system), self.system)
        self.assertFalse(self.user.exists())
        self.assertEqual((self.system / 'Contents/version').read_text(), 'new')
        backups = list((self.home / 'Library/Application Support/WordMate/app-backup').glob('*.zip'))
        versions = set()
        for backup in backups:
            with zipfile.ZipFile(backup) as saved:
                versions.add(saved.read('WordMate.app/Contents/version'))
        self.assertEqual(versions, {b'user-old', b'system-old'})
        self.assertIn([bundles.LSREGISTER, '-u', str(self.user)], self.commands)

    def test_new_install_stays_in_user_applications(self):
        with patch.object(bundles.subprocess, 'run', side_effect=self.run_tool):
            self.assertEqual(bundles.install(self.source, self.home, self.system), self.user)
        self.assertTrue(self.user.exists())
        self.assertFalse(self.system.exists())

    def test_backup_failure_keeps_both_originals(self):
        self.make_app(self.system, 'system-old')
        self.make_app(self.user, 'user-old')
        with patch.object(bundles.subprocess, 'run', side_effect=subprocess.CalledProcessError(1, 'ditto')):
            with self.assertRaises(subprocess.CalledProcessError):
                bundles.install(self.source, self.home, self.system)
        self.assertEqual((self.system / 'Contents/version').read_text(), 'system-old')
        self.assertEqual((self.user / 'Contents/version').read_text(), 'user-old')

    def test_wrong_identity_is_never_overwritten(self):
        self.make_app(self.system, 'unrelated', 'com.example.other')
        with patch.object(bundles.subprocess, 'run') as run:
            with self.assertRaisesRegex(RuntimeError, 'Unexpected'):
                bundles.install(self.source, self.home, self.system)
            run.assert_not_called()

    def test_pkg_consolidates_new_payload_into_system_app(self):
        self.make_app(self.system, 'old')
        self.make_app(self.user, 'new')
        with patch.object(bundles.subprocess, 'run', side_effect=self.run_tool):
            self.assertEqual(bundles.consolidate(self.home, self.system), self.system)
        self.assertEqual((self.system / 'Contents/version').read_text(), 'new')
        self.assertFalse(self.user.exists())

    def test_failed_signature_keeps_user_payload_for_recovery(self):
        self.make_app(self.system, 'old')
        self.make_app(self.user, 'new')
        def fail_signature(command, **kwargs):
            if command[0] == '/usr/bin/codesign':
                raise subprocess.CalledProcessError(1, command)
            return self.run_tool(command, **kwargs)
        with patch.object(bundles.subprocess, 'run', side_effect=fail_signature):
            with self.assertRaises(subprocess.CalledProcessError):
                bundles.consolidate(self.home, self.system)
        self.assertTrue(self.user.exists())
        self.assertFalse(any(c[0] == bundles.LSREGISTER for c in self.commands))

    def test_readonly_system_cancels_before_copy_or_removal(self):
        self.make_app(self.system, 'old')
        self.make_app(self.user, 'new')
        with patch.object(bundles.os, 'access', return_value=False), patch.object(bundles.subprocess, 'run') as run:
            with self.assertRaisesRegex(RuntimeError, 'not writable'):
                bundles.consolidate(self.home, self.system)
            run.assert_not_called()
        self.assertTrue(self.user.exists())


if __name__ == '__main__':
    unittest.main()
