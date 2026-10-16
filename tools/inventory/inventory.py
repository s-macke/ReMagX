#!/usr/bin/env python3
"""Extract VCL UI metadata, never implementation bodies or private project data."""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import re
import sys

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
# Only immediate GUI sources. Backups, history, binaries and numerical code are excluded.
SOURCE_DIRS = ('client', 'guidll')
EXCLUDED = {'client/Unit1backup2.cpp': 'Historical backup, not the active UI.'}
PROPERTIES = {'Caption', 'Hint', 'Text', 'Items.Strings', 'Enabled', 'Visible',
              'Checked', 'ItemIndex', 'Min', 'Max', 'Position', 'ReadOnly', 'ShortCut'}


def decode_source(data):
    try:
        return data.decode('utf-8-sig')
    except UnicodeDecodeError:
        return data.decode('cp1252')


def parse_dfm(text, source):
    """Parse text DFM objects and selected properties; skip opaque property blocks."""
    entries, stack = [], []
    lines = text.splitlines()
    index = 0
    while index < len(lines):
        line = lines[index].strip()
        number = index + 1
        index += 1
        match = re.fullmatch(r'(?:object|inherited|inline) (\w+): (\w+)(?: \[\d+\])?', line)
        if match:
            name, class_name = match.groups()
            path = '/'.join([e['name'] for e in stack] + [name])
            entry = {'id': f'{source}::{path}', 'kind': 'component', 'source': source,
                     'line': number, 'name': name, 'class': class_name, 'properties': {}, 'events': {}}
            entries.append(entry)
            stack.append(entry)
        elif line == 'end':
            if not stack:
                raise ValueError(f'{source}:{number}: unmatched end')
            stack.pop()
        elif match := re.fullmatch(r'([\w.]+)\s*=\s*(.*)', line):
            if not stack:
                raise ValueError(f'{source}:{number}: property outside object')
            key, value = match.groups()
            if value.startswith(('(', '<', '{')):
                closing = {'(': ')', '<': '>', '{': '}'}[value[0]]
                parts = [value]
                while not parts[-1].rstrip().endswith(closing):
                    if index >= len(lines):
                        raise ValueError(f'{source}:{number}: unclosed {key}')
                    parts.append(lines[index].strip())
                    index += 1
                value = '\n'.join(parts)
            while not value or value.rstrip().endswith('+'):
                if index >= len(lines):
                    raise ValueError(f'{source}:{number}: incomplete {key}')
                value += lines[index].strip()
                index += 1
            if key.startswith('On'):
                stack[-1]['events'][key] = value
            elif key in PROPERTIES:
                stack[-1]['properties'][key] = value
        elif line:
            raise ValueError(f'{source}:{number}: unsupported DFM syntax: {line[:80]}')
    if stack or not entries:
        raise ValueError(f'{source}: incomplete or empty DFM')
    return entries


# Preserve strings and newlines while removing comments. Used only on GUI C++ sources.
CPP_TOKEN = re.compile(r'"(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\'|//[^\n]*|/\*[\s\S]*?\*/')


def without_comments(text):
    return CPP_TOKEN.sub(lambda m: re.sub(r'[^\n]', ' ', m[0]) if m[0].startswith(('//', '/*')) else m[0], text)


def without_strings(text):
    return re.sub(r'"(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\'',
                  lambda m: re.sub(r'[^\n]', ' ', m[0]), text)


def parse_cpp(text, source):
    clean = without_comments(text)
    code = without_strings(clean)
    entries = []
    occurrences = Counter()
    for match in re.finditer(r'\bItems\s*->\s*Add\s*\(', code):
        start = match.end()
        end, depth = start, 1
        while end < len(code) and depth:
            if code[end] == '(':
                depth += 1
            elif code[end] == ')':
                depth -= 1
            end += 1
        if depth:
            raise ValueError(f'{source}: unterminated Items->Add')
        argument = re.sub(r'\s+', ' ', clean[start:end - 1]).strip()
        # Keep the receiver expression (including casts), not the surrounding function.
        begin = max(clean.rfind('\n', 0, match.start()), clean.rfind(';', 0, match.start())) + 1
        receiver = clean[begin:match.start()].strip().removesuffix('->').strip()
        fingerprint = hashlib.sha256(f'{receiver}\0{argument}'.encode()).hexdigest()[:16]
        occurrences[fingerprint] += 1
        entries.append({'id': f'{source}::item:{fingerprint}:{occurrences[fingerprint]}',
                        'kind': 'item', 'source': source, 'line': clean.count('\n', 0, match.start()) + 1,
                        'receiver': receiver, 'argument': argument})
    for match in re.finditer(r'->(On\w+)\s*=\s*([^;]+);', code):
        begin = max(clean.rfind('\n', 0, match.start()), clean.rfind(';', 0, match.start())) + 1
        receiver = clean[begin:match.start()].strip()
        handler = clean[match.start(2):match.end(2)].strip()
        fingerprint = hashlib.sha256(f'{receiver}\0{match[1]}\0{handler}'.encode()).hexdigest()[:16]
        occurrences[fingerprint] += 1
        entries.append({'id': f'{source}::event:{fingerprint}:{occurrences[fingerprint]}',
                        'kind': 'event', 'source': source, 'line': clean.count('\n', 0, match.start()) + 1,
                        'receiver': receiver, 'event': match[1], 'handler': handler})
    return sorted(entries, key=lambda e: (e['line'], e['id']))


def extract(legacy_root):
    entries, sources = [], []
    for directory in SOURCE_DIRS:
        folder = legacy_root / directory
        if not folder.is_dir():
            raise ValueError(f'Missing legacy GUI directory: {folder}')
        for path in sorted(folder.iterdir()):
            source = path.relative_to(legacy_root).as_posix()
            if path.suffix not in ('.dfm', '.cpp', '.h') or source in EXCLUDED:
                continue
            data = path.read_bytes()
            text = decode_source(data)
            sources.append({'path': source, 'sha256': hashlib.sha256(data).hexdigest()})
            entries.extend(parse_dfm(text, source) if path.suffix == '.dfm' else parse_cpp(text, source))
    return {'version': 1, 'sourceDirectories': list(SOURCE_DIRS), 'excluded': EXCLUDED,
            'sources': sources, 'entries': entries}


def snapshot_digest(snapshot):
    return hashlib.sha256(json.dumps(snapshot, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def validate(snapshot, review, root=ROOT):
    errors = []
    if snapshot.get('version') != 1 or review.get('version') != 1:
        errors.append('Unsupported inventory/review version')
    if review.get('inventoryDigest') != snapshot_digest(snapshot):
        errors.append('Inventory changed since review; review the diff and acknowledge its digest')
    sources = snapshot.get('sources', [])
    paths = [source['path'] for source in sources]
    if not paths or len(paths) != len(set(paths)):
        errors.append('Source manifest is empty or duplicated')
    for source in sources:
        path = Path(source['path'])
        if path.is_absolute() or '..' in path.parts or not re.fullmatch(r'[0-9a-f]{64}', source.get('sha256', '')):
            errors.append(f'Invalid source manifest entry: {source["path"]}')
    entries = snapshot.get('entries', [])
    for entry in entries:
        if entry.get('source') not in paths or entry.get('kind') not in ('component', 'item', 'event'):
            errors.append(f'Invalid inventory entry: {entry.get("id")}')
    ids = [entry['id'] for entry in entries]
    if not ids or len(ids) != len(set(ids)):
        errors.append('Inventory is empty or contains duplicate IDs')
    expected = set(ids)
    assigned = Counter()
    counts = Counter()
    groups = review.get('groups', [])
    names = [group.get('name') for group in groups]
    if len(names) != len(set(names)):
        errors.append('Duplicate review group names')
    for group in groups:
        name = group.get('name', '<unnamed>')
        status = group.get('status')
        if status not in ('ported', 'dropped', 'deferred'):
            errors.append(f'{name}: invalid or missing status')
        for field in ('reason', 'references'):
            if not group.get(field):
                errors.append(f'{name}: missing {field}')
        if status == 'deferred' and group.get('phase') not in ('ui', 'engine', 'later', 'decision'):
            errors.append(f'{name}: deferred entries need an explicit phase')
        if not group.get('entries'):
            errors.append(f'{name}: empty group')
        for reference in group.get('references', []):
            path = Path(reference.split('#', 1)[0])
            if path.is_absolute() or '..' in path.parts or not (root / path).is_file():
                errors.append(f'{name}: missing or unsafe reference {reference}')
        for entry_id in group.get('entries', []):
            assigned[entry_id] += 1
            counts[status] += 1
            if entry_id not in expected:
                errors.append(f'{name}: stale classification {entry_id}')
    for entry_id in ids:
        if assigned[entry_id] != 1:
            errors.append(f'{entry_id}: expected one classification, found {assigned[entry_id]}')
    return errors, counts


def read_json(path):
    return json.loads(path.read_text())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=('generate', 'check', 'report'))
    parser.add_argument('--legacy-root', type=Path, help='Verify/extract private GUI sources; not needed in CI')
    args = parser.parse_args()
    snapshot_path = HERE / 'inventory.json'
    if args.command == 'generate':
        snapshot = extract(args.legacy_root or ROOT / 'old/reMagX3')
        snapshot_path.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2) + '\n')
        print(f'Extracted {len(snapshot["entries"])} entries from {len(snapshot["sources"])} sources. Classifications were not changed.')
        print(f'Inventory digest: {snapshot_digest(snapshot)}')
        return 0
    snapshot, review = read_json(snapshot_path), read_json(HERE / 'review.json')
    errors, counts = validate(snapshot, review)
    if args.legacy_root and extract(args.legacy_root) != snapshot:
        errors.append('Legacy sources differ from the committed inventory; regenerate and review the changes')
    if errors:
        print('\n'.join(errors), file=sys.stderr)
        return 1
    print(f'Inventory: {len(snapshot["entries"])} entries; ' + ', '.join(f'{counts[s]} {s}' for s in ('ported', 'dropped', 'deferred')))
    if args.command == 'report':
        for group in review['groups']:
            print(f'{group["status"]:8} {group.get("phase", ""):8} {len(group["entries"]):3} {group["name"]}: {group["reason"]}')
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (ValueError, OSError, KeyError, TypeError) as error:
        print(f'Inventory error: {error}', file=sys.stderr)
        sys.exit(1)
