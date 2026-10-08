#!/usr/bin/env python3
"""Block local data / artifacts and obvious literal API credentials in staged changes."""
import re, subprocess, sys
paths = subprocess.check_output(['git', 'diff', '--cached', '--name-only', '--diff-filter=ACM', '-z']).decode().split('\0')
errors = []
for path in filter(None, paths):
    if any(part in path.split('/') for part in ['node_modules', 'dist', 'test-artifacts', '__pycache__']):
        errors.append(path + ': generated artifact')
    if re.search(r'(?:^|/)(?:\.env(?:\..*)?|models\.json)$|\.(?:db|db-wal|db-shm|sock|node)$', path) and not path.endswith('.env.example'):
        errors.append(path + ': local data or configuration')
    raw = subprocess.check_output(['git', 'show', ':' + path])
    try:
        content = raw.decode('utf-8')
    except UnicodeDecodeError:
        continue
    if re.search(r'\bsk-[A-Za-z0-9_-]{20,}\b', content):
        errors.append(path + ': possible literal API credential')
if errors:
    print('STAGED_CHECK_FAILED\n' + '\n'.join(errors))
    sys.exit(1)
print('STAGED_CHECK_OK no local data, build artifacts or obvious API keys')
