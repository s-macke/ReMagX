"""Reject alternate numeric precision in the maintained engine C/C++ source."""
from pathlib import Path
import re
import sys


def forbidden_precision(source):
    # Strip comments and literals before checking type tokens and numeric suffixes.
    source = re.sub(r'//[^\n]*|/\*.*?\*/|"(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\'', ' ', source, flags=re.S)
    source = re.sub(r'^\s*#\s*include\s*[<\"][^>\"]+[>\"]\s*$', ' ', source, flags=re.M)
    return bool(re.search(r'\b(?:float|long\s+double|__float\w*|_Float\w*|float(?:16|32|64|128)_t|bfloat16_t|mpfr\w*|mp[fqz]_t|multiprecision|cpp_dec_float\w*|CLNFloat)\b|\b(?:\d+\.\d*|\.\d+|\d+[eE][+-]?\d+)(?:[eE][+-]?\d+)?[fFlL]\b', source) or re.search(r'\b0[xX][0-9a-fA-F]+(?:\.[0-9a-fA-F]*)?[pP][+-]?\d+[fFlL]\b', source))


def main():
    root = Path(__file__).resolve().parents[1]
    files = [path for directory in ['src', 'include', 'third_party/glibc_math', 'third_party/musl_math'] for path in (root / directory).rglob('*') if path.suffix in {'.h', '.hpp', '.c', '.cpp', '.tbl'}]
    if not files or any(forbidden_precision(path.read_text()) for path in files):
        print('Engine precision gate failed: numeric source must use double only.', file=sys.stderr)
        return 1
    print(f'Engine precision gate passed for {len(files)} source/header files.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
