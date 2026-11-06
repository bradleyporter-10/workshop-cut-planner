import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class DistributionVersionTests(unittest.TestCase):
    def test_builds_increment_and_stamp_both_html_files(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            shutil.copytree(ROOT / 'scripts', root / 'scripts', ignore=shutil.ignore_patterns('__pycache__'))
            shutil.copytree(ROOT / 'pwa', root / 'pwa')
            (root / 'vendor/openskp').mkdir(parents=True)
            (root / 'vendor/openskp/browser-bundle.js').write_text('var WorkshopSkp = {};')
            source = '<html><head></head><body><h1>Workshop Cut Planner</h1><script src="vendor/openskp/browser-bundle.js"></script></body></html>'
            (root / 'cut-planner.html').write_text(source)
            (root / 'package.json').write_text(json.dumps({'version':'1.2.9'}))
            (root / 'package-lock.json').write_text(json.dumps({'version':'1.2.9','packages':{'':{'version':'1.2.9'},'dependency':{'version':'3.4.5'}}}))
            for expected in ['1.2.10','1.2.11']:
                subprocess.run([sys.executable, str(root / 'scripts/package-distrib.py')], check=True, capture_output=True)
                self.assertEqual(json.loads((root / 'package.json').read_text())['version'], expected)
                lock = json.loads((root / 'package-lock.json').read_text())
                self.assertEqual(lock['version'], expected)
                self.assertEqual(lock['packages']['']['version'], expected)
                self.assertEqual(lock['packages']['dependency']['version'], '3.4.5')
                self.assertIn('>v'+expected+'</span>', (root / 'docs/index.html').read_text())
                stamped_source = (root / 'cut-planner.html').read_text()
                self.assertIn('>v'+expected+'</span>', stamped_source)
                self.assertEqual(stamped_source.count('id="app-version"'), 1)
                self.assertIn('<script src="vendor/openskp/browser-bundle.js"></script>', stamped_source)
            (root / 'cut-planner.html').write_text('<html>Missing parser script</html>')
            result = subprocess.run([sys.executable, str(root / 'scripts/package-distrib.py')], capture_output=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(json.loads((root / 'package.json').read_text())['version'], '1.2.11')
