"""Build a single-file offline planner and a small, allowlisted shareable ZIP."""
from pathlib import Path
import re
import zipfile

ROOT = Path(__file__).resolve().parents[1]
output = ROOT / 'docs'
output.mkdir(exist_ok=True)
html = (ROOT / 'cut-planner.html').read_text()
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
name = 'Workshop-Cut-Planner.html'
(output / name).write_text(html, encoding='utf-8')
instructions = '''WORKSHOP CUT PLANNER — OFFLINE EDITION

1. Extract this ZIP into a folder on your computer.
2. Open Workshop-Cut-Planner.html in a current desktop browser (Chrome tested).
   If needed, right-click the HTML file and choose Open With > Google Chrome.
3. Import a SketchUp (SKP) file, import a CSV, or enter your parts manually.
4. Click Optimize cut plan, then Print / Save PDF for a shop copy.

No installation, account, internet connection, or server is required.
Everything needed to run the planner is embedded in the HTML file.
You can also share just Workshop-Cut-Planner.html; this text file is optional.

Your models and projects are processed in your browser and are not uploaded.
Use Save project to download your project JSON before closing the browser.
Use Open project to restore a saved JSON project later.

SketchUp import is beta. Review imported dimensions and quantities.
Always verify stock sizes, kerf, dimensions, and cut sequence before cutting.
'''
(output / 'START-HERE.txt').write_text(instructions, encoding='utf-8')
archive = output / 'Workshop-Cut-Planner.zip'
# Include only recipient files, never project data, backups, or development tools.
with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED) as package:
    for filename in (name, 'START-HERE.txt'):
        info = zipfile.ZipInfo(filename, date_time=(2026, 1, 1, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        info.external_attr = 0o100644 << 16
        package.writestr(info, (output / filename).read_bytes())
print(f'Packaged {archive.relative_to(ROOT)} ({archive.stat().st_size:,} bytes)')
print(f'Standalone HTML: docs/{name}')
