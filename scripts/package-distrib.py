"""Build the installable PWA and single-file offline planner in docs/."""
from pathlib import Path
import re
import hashlib
import json
from pwa_icons import make_icon

ROOT = Path(__file__).resolve().parents[1]
package_path = ROOT / 'package.json'
package = json.loads(package_path.read_text())
match = re.fullmatch(r'(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)', package['version'])
if not match:
    raise SystemExit('Distribution version must use major.minor.patch format.')
major, minor, patch = map(int, match.groups())
release_version = f'{major}.{minor}.{patch + 1}'
lock_path = ROOT / 'package-lock.json'
lock = json.loads(lock_path.read_text()) if lock_path.exists() else None
output = ROOT / 'docs'
output.mkdir(exist_ok=True)
source_path = ROOT / 'cut-planner.html'
source_html = source_path.read_text()
html = source_html
bundle = (ROOT / 'vendor/openskp/browser-bundle.js').read_text()
script_tag = '<script src="vendor/openskp/browser-bundle.js"></script>'
if html.count(script_tag) != 1:
    raise SystemExit('Expected exactly one offline parser script tag.')
# Prevent any JS string/comment from accidentally terminating the HTML script element.
safe_bundle = re.sub(r'</script', lambda match: r'<\/script', bundle, flags=re.IGNORECASE)
html = html.replace(script_tag, '<script>\n' + safe_bundle + '\n</script>')
html = html.replace('Keep vendor/openskp/browser-bundle.js alongside this planner in its original folder structure.',
                    'This copy may be incomplete. Request a fresh copy of the distributed HTML file.')
if re.search(r'<script\b[^>]*\bsrc\s*=', html, flags=re.IGNORECASE):
    raise SystemExit('Distribution must not depend on external script files.')
heading = r'<h1>Workshop Cut Planner(?: <span id="app-version"[^>]*>v[^<]*</span>)?</h1>'
if len(re.findall(heading, html)) != 1:
    raise SystemExit('Expected one planner heading for the version badge.')
badge = (f'<span id="app-version" style="font-size:13px;font-weight:500;'
         f'letter-spacing:0;white-space:nowrap;vertical-align:middle;margin-left:8px;'
         f'padding:3px 7px;border:1px solid #64748b;border-radius:5px">v{release_version}</span>')
stamped_heading = '<h1>Workshop Cut Planner ' + badge + '</h1>'
html = re.sub(heading, lambda match: stamped_heading, html)
source_html = re.sub(heading, lambda match: stamped_heading, source_html)
pwa = ROOT / 'pwa'
head = ('<link rel="manifest" href="./manifest.webmanifest">'
        '<meta name="theme-color" content="#1664a3">'
        '<link rel="apple-touch-icon" href="./icons/apple-touch-icon.png">')
html = html.replace('</head>', head + '</head>')
client = (pwa / 'client.js').read_text()
html = html.replace('</body>', '<script>\n' + client + '\n</script></body>')
(output / 'manifest.webmanifest').write_bytes((pwa / 'manifest.webmanifest').read_bytes())
icons = output / 'icons'
icons.mkdir(exist_ok=True)
for filename, size in [('icon-192.png',192),('icon-512.png',512),('icon-maskable-512.png',512),('apple-touch-icon.png',180)]:
    (icons / filename).write_bytes(make_icon(size))
assets = ['index.html','manifest.webmanifest','icons/icon-192.png','icons/icon-512.png','icons/icon-maskable-512.png','icons/apple-touch-icon.png']
template = (pwa / 'sw.js').read_text()
# Content hashing invalidates offline files whenever the app or its assets change.
hash_input = html.encode() + template.encode() + b''.join((output / item).read_bytes() for item in assets if item != 'index.html')
cache_version = hashlib.sha256(hash_input).hexdigest()[:16]
worker = template.replace('__BUILD_VERSION__', cache_version).replace('__PRECACHE_ASSETS__', json.dumps(assets))
(output / 'sw.js').write_text(worker, encoding='utf-8')
name = 'index.html'
(output / name).write_text(html, encoding='utf-8')
instructions = f"""WORKSHOP CUT PLANNER v{release_version} — INSTALLABLE / OFFLINE EDITION

INSTALL AS AN APP
1. Open the published HTTPS site in your browser while online.
2. Wait for 'Ready for offline use' at the bottom of the page.
3. Click Install app when offered, or use your browser's install menu.
   On iPhone/iPad, use Safari > Share > Add to Home Screen.
4. Once cached, the app opens and imports SketchUp files offline.

No backend, account, or runtime third-party services are required.
For hosting, publish this entire docs folder, including icons and sw.js.
Installation requires HTTPS (localhost is supported for development).

DIRECT FILE USE
You can still save index.html alone and double-click it to run locally.
The SketchUp parser is embedded; no server or installation is needed.
PWA installation/caching is not enabled when opening a file:// URL.

PROJECTS AND UPDATES
Your models and projects stay in your browser and are not uploaded.
Use Save project to download JSON before closing or installing an update.
Use Open project to restore a saved project; projects are not auto-saved.
Updates wait until all app windows/tabs are closed; no automatic reload.
Browser cache clearing or eviction may require an online visit again.

SketchUp import is beta. Review dimensions, quantities, kerf and cut sequence
before cutting. Always verify the plan against your physical stock.
"""
(output / 'START-HERE.txt').write_text(instructions, encoding='utf-8')
# Stamp the root planner too, keeping its local parser script intact.
source_path.write_text(source_html, encoding='utf-8')
# Advance the release metadata only once all distribution files were written.
package['version'] = release_version
package_path.write_text(json.dumps(package, indent=4) + '\n')
if lock is not None:
    lock['version'] = release_version
    if '' in lock.get('packages', {}):
        lock['packages']['']['version'] = release_version
    lock_path.write_text(json.dumps(lock, indent=4) + '\n')
print(f'PWA and standalone HTML v{release_version} built in docs/ (cache {cache_version})')
