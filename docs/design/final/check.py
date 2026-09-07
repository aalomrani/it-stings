#!/usr/bin/env python3
"""It Stings — design mockup checker.
Walks the raw tag stack and reports open/close balance for every element,
with a hard assertion on <svg>, <style>, <details>, <div>, <section>.
Also resolves every url(#id) / href="#id", and enforces the direction's
own bans (gradients, border-radius, backdrop-filter, <img>, <script>)."""
import re, sys, os, collections

VOID = {'area','base','br','col','embed','hr','img','input','link','meta',
        'param','source','track','wbr'}   # HTML void elements only; every SVG
                                          # element in these files carries an
                                          # explicit closing tag.
WATCH = ['svg','style','details','div','section']

TAG = re.compile(r'<(/?)([a-zA-Z][a-zA-Z0-9:-]*)((?:"[^"]*"|\'[^\']*\'|[^>"\'])*?)(/?)>')
COMMENT = re.compile(r'<!--.*?-->', re.S)

def check(path):
    raw = open(path, 'rb').read()
    src = raw.decode('utf-8')
    body = COMMENT.sub('', src)
    stack, errors = [], []
    counts = collections.Counter()
    for m in TAG.finditer(body):
        closing, name, attrs, selfclose = m.group(1), m.group(2).lower(), m.group(3), m.group(4)
        if name.startswith('!'):
            continue
        if closing:
            counts[name + ':close'] += 1
            if not stack:
                errors.append(f'stray </{name}> at offset {m.start()}')
            elif stack[-1][0] != name:
                errors.append(f'</{name}> closes <{stack[-1][0]}> opened at offset {stack[-1][1]}')
                # pop until match, to keep going
                while stack and stack[-1][0] != name:
                    stack.pop()
                if stack: stack.pop()
            else:
                stack.pop()
        else:
            counts[name + ':open'] += 1
            if selfclose == '/' or name in VOID:
                continue
            stack.append((name, m.start()))
    for name, off in stack:
        errors.append(f'<{name}> opened at offset {off} never closed')

    # id / reference resolution
    ids = set(re.findall(r'\bid="([^"]+)"', src))
    refs = set(re.findall(r'url\(#([^)"\']+)\)', src)) | set(re.findall(r'href="#([^"]+)"', src))
    refs |= set(re.findall(r'\bfor="([^"]+)"', src)) | set(re.findall(r'aria-controls="([^"]+)"', src))
    missing = sorted(r for r in refs if r not in ids)

    # bans
    bans = []
    for pat, label in [(r'border-radius', 'border-radius'),
                       (r'linear-gradient|radial-gradient|conic-gradient', 'gradient'),
                       (r'backdrop-filter', 'backdrop-filter'),
                       (r'<img\b', '<img>'),
                       (r'<script\b', '<script>')]:
        if re.search(pat, src, re.I):
            bans.append(label)
    # box-shadow: inset-only is allowed (used for the typeahead pointer rule)
    for sh in re.findall(r'box-shadow:\s*([^;}]+)', src, re.I):
        if 'inset' not in sh.lower():
            bans.append(f'non-inset box-shadow ({sh.strip()})')

    # required
    required = []
    if 'prefers-reduced-motion' not in src: required.append('prefers-reduced-motion')
    if ':focus-visible' not in src: required.append(':focus-visible')
    ext = re.findall(r'(?:href|src)="(https?://[^"]+)"', src)
    bad_ext = [u for u in ext if not u.startswith(('https://fonts.googleapis.com',
                                                   'https://fonts.gstatic.com'))]
    # links in prose are content, not assets — only <link>/<script>/<img> matter
    asset_ext = [u for u in re.findall(r'<(?:link|script|img)[^>]*(?:href|src)="(https?://[^"]+)"', src)
                 if not u.startswith(('https://fonts.googleapis.com','https://fonts.gstatic.com'))]

    print('=' * 72)
    print(os.path.basename(path), f'({len(raw):,} bytes)')
    print('-' * 72)
    for w in WATCH:
        o, c = counts[w + ':open'], counts[w + ':close']
        flag = 'OK ' if o == c else 'FAIL'
        print(f'  {flag} <{w}>  open {o:>3}  close {c:>3}')
    others = sorted({k.split(':')[0] for k in counts} - set(WATCH) - VOID)
    unbal = [n for n in others if counts[n + ':open'] != counts[n + ':close']]
    print(f'  {"OK " if not unbal else "FAIL"} all other elements balanced'
          + ('' if not unbal else f' — {unbal}'))
    print(f'  {"OK " if not errors else "FAIL"} tag-stack walk'
          + ('' if not errors else ''))
    for e in errors[:20]:
        print('        ! ' + e)
    print(f'  {"OK " if not missing else "FAIL"} every #ref resolves'
          + ('' if not missing else f' — missing {missing}'))
    print(f'  {"OK " if not bans else "FAIL"} bans (radius/gradient/shadow/img/script)'
          + ('' if not bans else f' — found {bans}'))
    print(f'  {"OK " if not required else "FAIL"} required rules present'
          + ('' if not required else f' — missing {required}'))
    print(f'  {"OK " if not asset_ext else "FAIL"} only Google Fonts loaded externally'
          + ('' if not asset_ext else f' — {asset_ext}'))
    return not (errors or unbal or missing or bans or required or asset_ext)

ok = True
for p in sys.argv[1:]:
    ok &= check(p)
print('=' * 72)
print('RESULT:', 'ALL CHECKS PASS' if ok else 'FAILURES ABOVE')
sys.exit(0 if ok else 1)
