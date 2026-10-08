#!/usr/bin/env python3
"""Native messaging RPC: receives text and returns a result from WordMate's local socket."""
import json, pathlib, socket, struct, subprocess, sys, time

def translate(message):
    if message.get('action', 'selection') not in ('selection', 'page'):
        raise ValueError('不支持的操作')
    text = message.get('text')
    if not isinstance(text, str) or not text.strip() or len(text) > 12000:
        raise ValueError('请选择 1–12000 字符的文本')
    message['action'] = message.get('action', 'selection')
    endpoint = pathlib.Path.home() / 'Library/Application Support/WordMate/browser.sock'
    client = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    client.settimeout(55)
    try:
        try:
            client.connect(str(endpoint))
        except (FileNotFoundError, ConnectionRefusedError):
            # 只在桌面程序尚未运行时启动；正常翻译不抢走浏览器焦点。
            subprocess.run(['/usr/bin/open', '-g', '-a', 'WordMate', '--args', '--browser-background'], check=True, capture_output=True)
            for attempt in range(50):
                time.sleep(.2)
                try:
                    client.connect(str(endpoint))
                    break
                except (FileNotFoundError, ConnectionRefusedError):
                    continue
            else:
                raise ValueError('WordMate 启动失败，请先运行新版桌面应用')
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
