"""Optional Chrome smoke test of direct file:// import; no test server required."""
import base64
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
chrome = os.environ.get('CHROME_BIN', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
if not Path(chrome).is_file():
    raise SystemExit('Set CHROME_BIN to a locally installed Chrome/Chromium executable.')
source = Path(sys.argv[1]).resolve() if len(sys.argv)>1 else ROOT / 'cut-planner.html'
html = source.read_text()
html = html.replace('src="vendor/openskp/browser-bundle.js"',
                    'src="' + (ROOT / 'vendor/openskp/browser-bundle.js').as_uri() + '"')
fixture = base64.b64encode((ROOT / 'sketchup-examples/playroom cabinets.skp').read_bytes()).decode()
# Block runtime network APIs before the actual application scripts execute.
html = html.replace('<head>', '<head><script>window.fetch=()=>{throw Error("Network forbidden")};window.XMLHttpRequest=function(){throw Error("Network forbidden")};</script>', 1)
smoke = '''<pre id="offline-result">PENDING</pre><script>
(async()=>{
    try {
        if(location.protocol!=='file:')throw Error('Expected file protocol');
        const bytes=Uint8Array.from(atob('FIXTURE'),c=>c.charCodeAt(0));
        await loadSkpIntoParts(new File([bytes],'fixture.skp'));
        if(!parts.length)throw Error('No parts imported');
        document.getElementById('offline-result').textContent='PASS: '+parts.length+' grouped parts imported directly from file://';
    }catch(error){document.getElementById('offline-result').textContent='FAIL: '+error.message;}
})();
</script>'''.replace('FIXTURE', fixture)
html = html.replace('</body>', smoke + '</body>')
with tempfile.TemporaryDirectory(prefix='cut-planner-chrome-') as folder:
    test_file = Path(folder) / 'offline-test.html'
    test_file.write_text(html)
    result = subprocess.run([
        chrome, '--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
        '--disable-background-networking', '--disable-sync', '--disable-component-update',
        '--disable-extensions', '--user-data-dir=' + str(Path(folder) / 'profile'),
        '--virtual-time-budget=10000', '--dump-dom', test_file.as_uri()
    ], capture_output=True, text=True, timeout=60)
    match = re.search(r'<pre id="offline-result">([^<]+)</pre>', result.stdout)
    if result.returncode or not match or not match.group(1).startswith('PASS:'):
        raise SystemExit(match.group(1) if match else 'Chrome did not complete the offline test (exit '+str(result.returncode)+').')
    print(match.group(1))
