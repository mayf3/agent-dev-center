#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
python3 - "$root" <<'PYTEST'
import pathlib, re, sys
root = pathlib.Path(sys.argv[1])
a = root / 'mobile/src/api/llmtodo.ts'
b = root / 'mobile/src/constants/llmtodo.ts'
assert 'DEFAULT_TOKEN' not in a.read_text()
assert not re.search(r'LLM_TODO_TOKEN\s*=\s*[\x27\x22]',b.read_text())
for name in ('qa-review-poll.sh', 'normalize-roles.sh', 'smoke-test.sh'):
    s = (root / 'scripts' / name).read_text()
    assert not re.search(r'ADC_PASSWORD=["\x27][^"\x27]+["\x27]',s), name
    assert 'StrictHostKeyChecking=no' not in s, name
print('public credential regressions passed')
PYTEST
