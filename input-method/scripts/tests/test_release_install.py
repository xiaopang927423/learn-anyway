"""Packaging/installation routing tests; never runs the macOS installer."""
import contextlib
import io
import json
from pathlib import Path
import plistlib
import runpy
import tempfile
import unittest
from unittest.mock import patch

SCRIPTS = Path(__file__).resolve().parents[1]


class ReleaseInstallTests(unittest.TestCase):
    def fixture(self, directory, version='0.6.4', build='6040'):
        root = Path(directory).resolve() / 'input-method'
        (root / 'scripts').mkdir(parents=True)
        (root / 'bundle/build.noindex/WordMateInput.app/Contents').mkdir(parents=True)
        (root / 'dist').mkdir()
        (root.parent / 'release.json').write_text(json.dumps({
            'components': {'inputMethod': '0.6.4'}, 'inputMethodBuild': '6040',
        }))
        (root / 'bundle/build.noindex/WordMateInput.app/Contents/Info.plist').write_bytes(plistlib.dumps({
            'CFBundleShortVersionString': version, 'CFBundleVersion': build,
        }))
        return root

    def run_script(self, root, name):
        target = root / 'scripts' / name
        target.write_text((SCRIPTS / name).read_text())
        with patch('sys.argv', [str(target)]), contextlib.redirect_stdout(io.StringIO()):
            runpy.run_path(str(target), run_name='__main__')

    def test_install_uses_current_release_even_with_old_package_present(self):
        with tempfile.TemporaryDirectory() as directory:
            root = self.fixture(directory)
            for version in ['0.6.0', '0.6.4']:
                (root / 'dist' / f'WordMateInput-{version}-dev-local.pkg').touch()
            with patch('subprocess.run') as run, patch('subprocess.check_output', return_value='{"ready": true}'):
                self.run_script(root, 'install.py')
            installs = [call.args[0] for call in run.call_args_list if call.args[0][0] == '/usr/sbin/installer']
            self.assertEqual(len(installs), 1)
            self.assertEqual(installs[0][2], str(root / 'dist/WordMateInput-0.6.4-dev-local.pkg'))

    def test_packaging_rejects_old_version_before_running_tools(self):
        self.assert_stale('0.6.3', '6030')

    def test_packaging_rejects_old_build_of_same_version(self):
        self.assert_stale('0.6.4', '6030')

    def assert_stale(self, version, build):
        with tempfile.TemporaryDirectory() as directory:
            root = self.fixture(directory, version, build)
            with patch('subprocess.run') as run:
                with self.assertRaisesRegex(SystemExit, 'Stale IME build'):
                    self.run_script(root, 'package.py')
                run.assert_not_called()


if __name__ == '__main__':
    unittest.main()
