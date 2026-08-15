"""Builds the CrazyGames submission zip.

Two differences from the plain game: the CrazyGames SDK script tag goes
in (app.js treats it as optional everywhere), and the GameVolt link on
the title screen comes out — CrazyGames QA rejects external links, and
links to other game portals most of all. The tag lives here rather than
in index.html so the GitHub Pages and artifact builds keep their
zero-external-requests property.

Usage: python3 tools/build-crazygames.py [out.zip]
"""
import pathlib
import re
import sys
import tempfile
import zipfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else \
    ROOT / 'short-circuit-crazygames.zip'

SDK_TAG = ('<script src="https://sdk.crazygames.com/'
           'crazygames-sdk-v3.js"></script>\n')
FILES = ('sounds.js', 'engine.js', 'sound.js', 'app.js')

html = (ROOT / 'index.html').read_text(encoding='utf-8')
anchor = '<script src="sounds.js'
if anchor not in html:
    raise SystemExit('script anchor not found in index.html')
html = html.replace(anchor, SDK_TAG + anchor, 1)

html, removed = re.subn(
    r'[ \t]*<a[^>]*href="https://gamevolt\.io"[^>]*>.*?</a>\n?', '', html
)
if removed != 1:
    raise SystemExit(f'expected 1 GameVolt link to strip, found {removed}')
if 'gamevolt.io' in html:
    raise SystemExit('a gamevolt.io reference survived the strip')

with tempfile.TemporaryDirectory() as tmp:
    stage = pathlib.Path(tmp) / 'game'
    stage.mkdir()
    (stage / 'index.html').write_text(html, encoding='utf-8')
    for name in FILES:
        (stage / name).write_bytes((ROOT / name).read_bytes())
    (stage / 'manifest.webmanifest').write_bytes(
        (ROOT / 'manifest.webmanifest').read_bytes())
    (stage / 'icons').mkdir()
    for icon in (ROOT / 'icons').glob('*.png'):
        (stage / 'icons' / icon.name).write_bytes(icon.read_bytes())

    with zipfile.ZipFile(OUT, 'w', zipfile.ZIP_DEFLATED) as z:
        for path in sorted(stage.rglob('*')):
            if path.is_file():
                z.write(path, path.relative_to(stage))

count = len(zipfile.ZipFile(OUT).namelist())
print(f'wrote {OUT} ({OUT.stat().st_size // 1024} KB, '
      f'{count} files, SDK tag injected)')
