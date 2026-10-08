#!/usr/bin/env python3
"""Native messaging RPC: receives text and returns a result from WordMate's local socket."""
import json, pathlib, socket, struct, subprocess, sys, time

def translate(message):
    action = message.get('action', 'selection')
    if action not in ('selection', 'page', 'add-word', 'get-preferences', 'set-preferences'):
        raise ValueError('不支持的操作')
    if action not in ('get-preferences', 'set-preferences'):
        text = message.get('text')
        if not isinstance(text, str) or not text.strip() or len(text) > 12000:
            raise ValueError('请选择 1–12000 字符的文本')
    message['action'] = action
    endpoint = pathlib.Path.home() / 'Library/Application Support/WordMate/browser.sock'
    client = None
    config_file = endpoint.parent / 'browser-host' / 'connection.json'
    config = json.loads(config_file.read_text()) if config_file.exists() else {}
    application = config.get('appPath')
    if not application:
        candidates = [pathlib.Path('/Applications/WordMate.app'), pathlib.Path.home() / 'Applications/WordMate.app']
        application = next((str(path) for path in candidates if path.exists()), None)
    try:
        # 每次连接使用新 socket，避免复用失败的 AF_UNIX 描述符。
        for attempt in range(76):
            candidate = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            candidate.settimeout(55)
            try:
                candidate.connect(str(endpoint))
                client = candidate
                break
            except (FileNotFoundError, ConnectionRefusedError):
                candidate.close()
                if attempt == 0:
                    if not application or not pathlib.Path(application).is_dir():
                        raise ValueError('WordMate 安装路径已变化，请在新版应用设置中重新安装浏览器连接')
                    # 强制发起第二实例，由运行中的新版处理修复命令，不按名称找旧副本。
                    subprocess.run(['/usr/bin/open', '-g', '-n', application, '--args', '--browser-background', '--repair-browser-bridge'], check=True, capture_output=True, timeout=5)
                time.sleep(.2)
        if client is None:
            raise ValueError('WordMate 浏览器后端未就绪，请确认运行的是新版应用；可在设置中重新安装浏览器连接')
        client.sendall(json.dumps(message, ensure_ascii=False).encode() + b'\n')
        data = bytearray()
        while b'\n' not in data:
            chunk = client.recv(8192)
            if not chunk:
                raise ValueError('WordMate 连接已断开，请重试')
            data.extend(chunk)
            if len(data) > 800000:
                raise ValueError('翻译结果过长')
        return json.loads(bytes(data).split(b'\n', 1)[0])
    finally:
        if client is not None:
            client.close()

def main():
    header = sys.stdin.buffer.read(4)
    if len(header) != 4:
        return
    size = struct.unpack('<I', header)[0]
    try:
        if size > 100000:
            raise ValueError('请求过长')
        raw = sys.stdin.buffer.read(size)
        if len(raw) != size:
            raise ValueError('请求不完整')
        reply = translate(json.loads(raw))
    except Exception as error:
        reply = {'ok': False, 'error': str(error) or '无法连接 WordMate，请运行新版应用并安装本机连接'}
    data = json.dumps(reply, ensure_ascii=False).encode()
    sys.stdout.buffer.write(struct.pack('<I', len(data)) + data)
    sys.stdout.buffer.flush()

if __name__ == '__main__':
    main()
