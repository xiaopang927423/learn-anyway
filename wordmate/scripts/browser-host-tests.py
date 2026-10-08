#!/usr/bin/env python3
import importlib.util, pathlib, tempfile, unittest
from unittest.mock import patch
spec = importlib.util.spec_from_file_location('host',pathlib.Path(__file__).with_name('browser-host.py'))
host = importlib.util.module_from_spec(spec)
spec.loader.exec_module(host)

class FakeSocket:
    def __init__(self, error=None): self.error=error;self.closed=False;self.sent=None
    def settimeout(self, timeout): pass
    def connect(self, address):
        if self.error: raise self.error
    def sendall(self, data): self.sent=data
    def recv(self, size): return b'{"ok":true,"result":{"thinkingEnabled":false}}\n'
    def close(self): self.closed=True

class HostTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.home=pathlib.Path(self.temp.name)
        self.app=self.home/'Applications/WordMate.app';self.app.mkdir(parents=True)
        config=self.home/'Library/Application Support/WordMate/browser-host/connection.json'
        config.parent.mkdir(parents=True)
        config.write_text(host.json.dumps({'appPath':str(self.app)}))
    def tearDown(self): self.temp.cleanup()
    def test_existing_backend_does_not_open_application(self):
        client=FakeSocket()
        with patch.object(host.pathlib.Path,'home',return_value=self.home),patch.object(host.socket,'socket',return_value=client),patch.object(host.subprocess,'run') as run:
            self.assertTrue(host.translate({'action':'get-preferences'})['ok'])
            run.assert_not_called();self.assertTrue(client.closed)
    def test_stale_socket_launches_exact_bundle_and_reconnects_with_fresh_socket(self):
        first=FakeSocket(ConnectionRefusedError());second=FakeSocket(FileNotFoundError());third=FakeSocket()
        with patch.object(host.pathlib.Path,'home',return_value=self.home),patch.object(host.socket,'socket',side_effect=[first,second,third]),patch.object(host.subprocess,'run') as run,patch.object(host.time,'sleep'):
            self.assertTrue(host.translate({'action':'get-preferences'})['ok'])
            args=run.call_args.args[0]
            self.assertIn(str(self.app),args);self.assertIn('-n',args);self.assertIn('--repair-browser-bridge',args);self.assertNotIn('-a',args)
            self.assertTrue(first.closed and second.closed and third.closed)
    def test_missing_installation_reports_reinstall_without_launching_by_name(self):
        self.app.rmdir()
        with patch.object(host.pathlib.Path,'home',return_value=self.home),patch.object(host.socket,'socket',return_value=FakeSocket(FileNotFoundError())),patch.object(host.subprocess,'run') as run:
            with self.assertRaisesRegex(ValueError,'安装路径'): host.translate({'action':'get-preferences'})
            run.assert_not_called()

if __name__=='__main__': unittest.main()
