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
release_version = package['version']
output = ROOT / 'docs'
output.mkdir(exist_ok=True)
source_path = ROOT / 'cut-planner.html'
source_html = source_path.read_text()
# Keep the root planner and single-file distribution in sync with the authored guide.
start_marker='<!-- USER_GUIDE_START -->'
end_marker='<!-- USER_GUIDE_END -->'
if start_marker in source_html:
    guide_document=(ROOT / 'USER_GUIDE.html').read_text()
    guide=guide_document.split('<!-- GUIDE_CONTENT_START -->',1)[1].split('<!-- GUIDE_CONTENT_END -->',1)[0].strip()
    before,rest=source_html.split(start_marker,1)
    _,after=rest.split(end_marker,1)
    source_html=before+start_marker+'\n'+guide+'\n'+end_marker+after
html = source_html
bundle = (ROOT / 'vendor/openskp/browser-bundle.js').read_text()
script_tag = '<script src="vendor/openskp/browser-bundle.js"></script>'
if html.count(script_tag) != 1:
    raise SystemExit('Expected exactly one offline parser script tag.')
# Prevent any JS string/comment from accidentally terminating the HTML script element.
safe_bundle = re.sub(r'</script', lambda match: r'<\/script', bundle, flags=re.IGNORECASE)
html = html.replace(script_tag, '<script>\n' + safe_bundle + '\n</script>')
assembly_tag = '<script src="vendor/assembly/browser-bundle.js"></script>'
if assembly_tag in html:
    assembly_bundle = (ROOT / 'vendor/assembly/browser-bundle.js').read_text()
    safe_assembly = re.sub(r'</script', lambda match: r'<\/script', assembly_bundle, flags=re.IGNORECASE)
    html = html.replace(assembly_tag, '<script>\n' + safe_assembly + '\n</script>')
print_tag = '<script src="vendor/printing/browser-bundle.js"></script>'
if print_tag in html:
    print_bundle = (ROOT / 'vendor/printing/browser-bundle.js').read_text()
    safe_print = re.sub(r'</script', lambda match: r'<\/script', print_bundle, flags=re.IGNORECASE)
    html = html.replace(print_tag, '<script>\n' + safe_print + '\n</script>')
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
html = html.replace('</head>', head + '</head>', 1)
client = (pwa / 'client.js').read_text().replace('__APP_VERSION__', release_version)
body_start, body_end = html.rsplit('</body>', 1)
html = body_start + '<script>\n' + client + '\n</script></body>' + body_end
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
worker = template.replace('__BUILD_VERSION__', cache_version).replace('__APP_VERSION__', release_version).replace('__PRECACHE_ASSETS__', json.dumps(assets))
(output / 'sw.js').write_text(worker, encoding='utf-8')
# Intentionally excluded from the service-worker cache: checked directly online.
(output / 'version.json').write_text(json.dumps({'version': release_version}) + '\n', encoding='utf-8')
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
For hosting, publish this entire docs folder, including icons, sw.js, and version.json.
Installation requires HTTPS (localhost is supported for development).

DIRECT FILE USE
You can still save index.html alone and double-click it to run locally.
The SketchUp parser is embedded; no server or installation is needed.
PWA installation/caching is not enabled when opening a file:// URL.

PROJECTS AND UPDATES
Your models and projects stay in your browser and are not uploaded.
Use Save project to download JSON before closing or installing an update.
Use Open project to restore a saved project; projects are not auto-saved.
Online launches/reloads fetch the published page; offline launches use cache.
Use Refresh app in the top banner to check/apply updates after saving your JSON.
A green dot marks an available update; hover for the save-project reminder.
Version checks bypass caches on launch, app focus, and each minute online.
Workers activate after downloading; open plans are never automatically reloaded.
Reloads require confirmation; alternatively close all app windows and reopen.
Browser cache clearing or eviction may require an online visit again.

SketchUp import is beta. Review dimensions, quantities, kerf and cut sequence
before cutting. Always verify the plan against your physical stock.
"""
(output / 'START-HERE.txt').write_text(instructions, encoding='utf-8')
# Stamp the root planner too, keeping its local parser script intact.
source_path.write_text(source_html, encoding='utf-8')
print(f'PWA and standalone HTML v{release_version} built in docs/ (cache {cache_version})')
