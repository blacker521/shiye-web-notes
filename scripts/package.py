"""Build source and Chrome Web Store archives using explicit runtime files."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import hashlib
import json
import shutil

root = Path(__file__).resolve().parents[1]
dist = root / 'dist'
dist.mkdir(exist_ok=True)
version = json.loads((root / 'manifest.json').read_text())['version']
runtime = [
    'manifest.json', 'anchors.js', 'background.js', 'content.js', 'content.css',
    'library.html', 'library.js', 'library.css', 'popup.html', 'popup.js',
    'popup.css', 'page-access.js', 'screenshot.html', 'screenshot.js',
    'screenshot.css', 'store.js', 'ui-icons.js',
]
runtime += [str(p.relative_to(root)) for p in (root / 'icons').iterdir() if p.suffix in {'.png', '.svg'}]
for name in runtime:
    if not (root / name).is_file():
        raise FileNotFoundError(name)
store = dist / f'shiye-chrome-web-store-v{version}.zip'
with ZipFile(store, 'w', ZIP_DEFLATED) as archive:
    for name in sorted(runtime):
        archive.write(root / name, name)
    assert 'manifest.json' in archive.namelist()

source = dist / f'shiye-web-notes-v{version}.zip'
excluded = {'.git', 'node_modules', 'dist', 'test-results', '__pycache__'}
with ZipFile(source, 'w', ZIP_DEFLATED) as archive:
    for file in sorted(root.rglob('*')):
        relative = file.relative_to(root)
        if not file.is_file() or any(part in excluded for part in relative.parts):
            continue
        if file.name == '.DS_Store' or file.suffix in {'.zip', '.pem', '.key', '.crx'} or file.name.startswith('.env'):
            continue
        archive.write(file, Path('shiye-web-notes') / relative)
shutil.copyfile(source, dist / 'shiye-web-notes.zip')
checksums = []
for file in (source, store):
    checksums.append(f'{hashlib.sha256(file.read_bytes()).hexdigest()}  {file.name}')
    print(f'{file.name}: {file.stat().st_size:,} bytes')
(dist / 'SHA256SUMS.txt').write_text('\n'.join(checksums) + '\n')
