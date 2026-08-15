#!/usr/bin/env python3
"""Bundles the game into one self-contained HTML file.

The Artifact host serves the page under a strict CSP that blocks every
external request, so the scripts are inlined. The game has no image
assets — the board is DOM and CSS — which keeps this short.

    python3 tools/build-bundle.py [output.html]
"""
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else \
    ROOT / 'short-circuit.html'

html = (ROOT / 'index.html').read_text(encoding='utf-8')
head = re.search(r'<head>(.*?)</head>', html, re.S).group(1)
title = re.search(r'<title>(.*?)</title>', head, re.S).group(1)
style = re.search(r'<style>.*?</style>', head, re.S).group(0)
body = re.search(r'<body[^>]*>(.*)</body>', html, re.S).group(1)
body = re.sub(r'\s*<script\s+src="[^"]*"></script>', '', body)

scripts = []
for name in ('sounds.js', 'engine.js', 'sound.js', 'app.js'):
    js = (ROOT / name).read_text(encoding='utf-8')
    if '</script' in js:
        raise SystemExit(f'{name} contains </script> and cannot be inlined')
    scripts.append(f'<script>\n{js}\n</script>')

OUT.write_text(
    f'<title>{title}</title>\n{style}\n{body}\n' + '\n'.join(scripts),
    encoding='utf-8',
)
print(f'wrote {OUT} ({OUT.stat().st_size / 1024:.0f} KB)')
