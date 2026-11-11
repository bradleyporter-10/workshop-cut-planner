"""Exercise release hooks in disposable Git repositories; never commit this checkout."""
from pathlib import Path
import json
import os
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class CommitVersionTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='cut-version-test-')
        self.root = Path(self.temporary.name)
        self.env = {**os.environ, 'GIT_CONFIG_GLOBAL': os.devnull, 'GIT_CONFIG_NOSYSTEM': '1',
                    'GIT_AUTHOR_NAME': 'Version Hook Test', 'GIT_AUTHOR_EMAIL': 'test@example.invalid',
                    'GIT_COMMITTER_NAME': 'Version Hook Test', 'GIT_COMMITTER_EMAIL': 'test@example.invalid'}
        for key in ('GIT_INDEX_FILE', 'GIT_DIR', 'GIT_WORK_TREE'):
            self.env.pop(key, None)
        self.write('package.json', json.dumps({'name': 'hook-test', 'version': '0.2.0',
                   'scripts': {'build:distrib': 'python3 scripts/fake-build.py'}}, indent=4) + '\n')
        self.write('package-lock.json', json.dumps({'name': 'hook-test', 'version': '0.2.0',
                   'packages': {'': {'version': '0.2.0'}}}, indent=4) + '\n')
        self.write('code.txt', 'initial\n')
        self.write('other.txt', 'initial\n')
        self.write('cut-planner.html', '<h1><span id="app-version">v0.2.0</span></h1>\n')
        self.write('scripts/version-commit.py', (ROOT / 'scripts/version-commit.py').read_text())
        self.write('.githooks/pre-commit', (ROOT / '.githooks/pre-commit').read_text())
        (self.root / '.githooks/pre-commit').chmod(0o755)
        self.write('scripts/fake-build.py', '''from pathlib import Path
import json, re, sys
root=Path(__file__).resolve().parents[1]
if (root/'fail-build').exists(): sys.exit(1)
v=json.loads((root/'package.json').read_text())['version']
source=(root/'code.txt').read_text()
html=(root/'cut-planner.html').read_text()
html=re.sub(r'(id="app-version">v)[^<]+',lambda m:m[1]+v,html)
(root/'cut-planner.html').write_text(html)
(root/'docs').mkdir(exist_ok=True)
for name,text in {'index.html':v+'\\n'+source+html,'sw.js':v+'\\n'+source,'version.json':json.dumps({'version':v}),'START-HERE.txt':v}.items():
    (root/'docs'/name).write_text(text)
''')
        self.run_command('python3', 'scripts/fake-build.py')
        self.git('init', '-q')
        self.git('add', '.')
        self.git('commit', '--no-verify', '-qm', 'fixture baseline')
        self.git('config', 'core.hooksPath', '.githooks')

    def tearDown(self):
        self.temporary.cleanup()

    def write(self, name, text):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)

    def run_command(self, *args, check=True, env=None):
        return subprocess.run(args, cwd=self.root, env=env or self.env, check=check,
                              stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)

    def git(self, *args, **kwargs):
        return self.run_command('git', *args, **kwargs).stdout.strip()

    def staged_version(self, env=None):
        return json.loads(self.git('show', ':package.json', env=env))['version']

    def test_each_commit_bumps_once_and_commits_generated_build(self):
        for expected in ('0.2.1', '0.2.2'):
            self.write('code.txt', expected + '\n')
            self.git('add', 'code.txt')
            self.git('commit', '-qm', 'test change')
            self.assertEqual(json.loads(self.git('show', 'HEAD:package.json'))['version'], expected)
            self.assertEqual(json.loads(self.git('show', 'HEAD:docs/version.json'))['version'], expected)
            self.assertIn(expected, self.git('show', 'HEAD:docs/index.html'))
            self.assertEqual(self.git('status', '--porcelain'), '')

    def test_partial_staging_preserves_unstaged_source_metadata_and_docs(self):
        self.write('code.txt', 'staged change\n')
        self.git('add', 'code.txt')
        self.write('code.txt', 'staged change\nunfinished code\n')
        self.write('docs/index.html', 'local unfinished generated document\n')
        html = (self.root / 'cut-planner.html').read_text() + '<p>unfinished UI</p>\n'
        self.write('cut-planner.html', html)
        package = (self.root / 'package.json').read_text().replace('"name":', '"unfinished": true,\n    "name":', 1)
        self.write('package.json', package)
        self.git('commit', '-qm', 'only staged change')
        self.assertEqual(self.git('show', 'HEAD:code.txt'), 'staged change')
        self.assertNotIn('unfinished', self.git('show', 'HEAD:package.json'))
        self.assertNotIn('unfinished', self.git('show', 'HEAD:docs/index.html'))
        self.assertEqual((self.root / 'code.txt').read_text(), 'staged change\nunfinished code\n')
        self.assertEqual((self.root / 'docs/index.html').read_text(), 'local unfinished generated document\n')
        self.assertEqual((self.root / 'package.json').read_text(), package.replace('0.2.0', '0.2.1'))
        self.assertEqual((self.root / 'cut-planner.html').read_text(), html.replace('v0.2.0', 'v0.2.1'))

    def test_failed_build_leaves_index_and_version_unchanged(self):
        self.write('fail-build', 'intentional failure')
        self.git('add', 'fail-build')
        tree = self.git('write-tree')
        result = self.run_command('git', 'commit', '-qm', 'must fail', check=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.git('write-tree'), tree)
        self.assertEqual(self.staged_version(), '0.2.0')
        self.assertEqual(json.loads((self.root / 'package.json').read_text())['version'], '0.2.0')

    def test_retry_does_not_bump_prepared_release_twice(self):
        self.write('code.txt', 'new code\n')
        self.git('add', 'code.txt')
        self.run_command('python3', 'scripts/version-commit.py')
        self.assertEqual(self.staged_version(), '0.2.1')
        self.run_command('python3', 'scripts/version-commit.py')
        self.assertEqual(self.staged_version(), '0.2.1')
        self.git('commit', '-qm', 'retry prepared commit')
        self.assertEqual(json.loads(self.git('show', 'HEAD:package.json'))['version'], '0.2.1')

    def test_manual_reset_is_preserved_then_patch_bumps_resume(self):
        for name in ('package.json', 'package-lock.json'):
            self.write(name, (self.root / name).read_text().replace('0.2.0', '0.1.0'))
        self.git('add', 'package.json', 'package-lock.json')
        self.git('commit', '-qm', 'manual version reset')
        self.assertEqual(json.loads(self.git('show', 'HEAD:package.json'))['version'], '0.1.0')
        self.write('code.txt', 'next change\n')
        self.git('add', 'code.txt')
        self.git('commit', '-qm', 'next release')
        self.assertEqual(json.loads(self.git('show', 'HEAD:package.json'))['version'], '0.1.1')

    def test_path_only_commit_is_rejected_without_changing_other_staged_work(self):
        self.write('other.txt', 'a different staged change\n')
        self.git('add', 'other.txt')
        self.write('code.txt', 'only this file\n')
        result = self.run_command('git', 'commit', '-qm', 'path-only commit', '--', 'code.txt', check=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('without file paths', result.stderr)
        self.assertEqual(self.git('show', 'HEAD:other.txt'), 'initial')
        self.assertEqual(json.loads(self.git('show', 'HEAD:package.json'))['version'], '0.2.0')
        self.assertIn('other.txt', self.git('diff', '--cached', '--name-only'))
        self.assertEqual(self.staged_version(), '0.2.0')

    def test_commit_all_keeps_index_and_working_copy_in_sync(self):
        self.write('code.txt', 'include tracked changes\n')
        self.git('commit', '-qam', 'commit all tracked changes')
        self.assertEqual(json.loads(self.git('show', 'HEAD:package.json'))['version'], '0.2.1')
        self.assertEqual(self.staged_version(), '0.2.1')
        self.assertEqual(self.git('status', '--porcelain'), '')


class BuildVersionTests(unittest.TestCase):
    @unittest.skipUnless((ROOT / 'node_modules').is_dir(), 'Install npm dependencies first')
    def test_hook_rebuilds_real_app_from_staged_snapshot(self):
        with tempfile.TemporaryDirectory(prefix='cut-real-release-') as directory:
            folder = Path(directory)
            for name in ('assembly', 'printing', 'vendor', 'scripts', 'pwa', '.githooks'):
                shutil.copytree(ROOT / name, folder / name, ignore=shutil.ignore_patterns('__pycache__'))
            for name in ('package.json', 'package-lock.json', 'cut-planner.html', 'USER_GUIDE.html', '.gitignore'):
                shutil.copyfile(ROOT / name, folder / name)
            (folder / 'node_modules').symlink_to(ROOT / 'node_modules', target_is_directory=True)
            environment = {**os.environ, 'GIT_CONFIG_GLOBAL': os.devnull, 'GIT_CONFIG_NOSYSTEM': '1',
                           'GIT_AUTHOR_NAME': 'Version Hook Test', 'GIT_AUTHOR_EMAIL': 'test@example.invalid',
                           'GIT_COMMITTER_NAME': 'Version Hook Test', 'GIT_COMMITTER_EMAIL': 'test@example.invalid'}
            for key in ('GIT_INDEX_FILE', 'GIT_DIR', 'GIT_WORK_TREE'):
                environment.pop(key, None)
            def run(*command):
                return subprocess.check_output(command, cwd=folder, env=environment, stderr=subprocess.PIPE)
            run('git', 'init', '-q')
            run('git', 'add', '.')
            run('git', 'commit', '--no-verify', '-qm', 'test baseline')
            run('git', 'config', 'core.hooksPath', '.githooks')
            (folder / 'release-test.txt').write_text('staged change')
            run('git', 'add', 'release-test.txt')
            run('git', 'commit', '-qm', 'real release build test')
            before = json.loads((ROOT / 'package.json').read_text())['version']
            major, minor, patch = map(int, before.split('.'))
            expected = f'{major}.{minor}.{patch + 1}'
            self.assertEqual(json.loads(run('git', 'show', 'HEAD:docs/version.json'))['version'], expected)
            self.assertIn(f'>v{expected}</span>'.encode(), run('git', 'show', 'HEAD:docs/index.html'))
            self.assertEqual(json.loads((folder / 'package.json').read_text())['version'], expected)
            self.assertEqual(json.loads((ROOT / 'package.json').read_text())['version'], before)

    def test_repeated_distribution_builds_keep_version_and_cache_identity(self):
        with tempfile.TemporaryDirectory(prefix='cut-build-version-') as directory:
            folder = Path(directory)
            files = ['package.json', 'package-lock.json', 'cut-planner.html', 'USER_GUIDE.html',
                     'scripts/package-distrib.py', 'scripts/pwa_icons.py',
                     'vendor/openskp/browser-bundle.js', 'vendor/assembly/browser-bundle.js',
                     'vendor/printing/browser-bundle.js', 'pwa/client.js', 'pwa/sw.js', 'pwa/manifest.webmanifest']
            for name in files:
                target = folder / name
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(ROOT / name, target)
            metadata = {name: (folder / name).read_bytes() for name in ('package.json', 'package-lock.json')}
            expected = json.loads(metadata['package.json'])['version']
            def build():
                subprocess.run(['python3', 'scripts/package-distrib.py'], cwd=folder,
                               check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            build()
            outputs = {name: (folder / name).read_bytes() for name in
                       ('docs/index.html', 'docs/sw.js', 'docs/version.json', 'cut-planner.html')}
            build()
            for name, content in metadata.items():
                self.assertEqual((folder / name).read_bytes(), content, name)
            for name, content in outputs.items():
                self.assertEqual((folder / name).read_bytes(), content, name)
            self.assertEqual(json.loads((folder / 'docs/version.json').read_text())['version'], expected)


if __name__ == '__main__':
    unittest.main()
