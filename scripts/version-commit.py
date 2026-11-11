"""Prepare one release per commit, using staged inputs without staging local WIP."""
from pathlib import Path
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

ARTIFACTS = [
    'package.json', 'package-lock.json', 'cut-planner.html',
    'docs/index.html', 'docs/sw.js', 'docs/version.json', 'docs/START-HERE.txt',
    'docs/manifest.webmanifest', 'docs/icons/icon-192.png',
    'docs/icons/icon-512.png', 'docs/icons/icon-maskable-512.png',
    'docs/icons/apple-touch-icon.png', 'vendor/openskp/browser-bundle.js',
    'vendor/assembly/browser-bundle.js', 'vendor/printing/browser-bundle.js',
]


def git(*args, cwd=None, env=None):
    return subprocess.check_output(['git', *args], cwd=cwd, env=env)


def version(value):
    if not re.fullmatch(r'(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)', value):
        raise ValueError('Release version must use major.minor.patch.')
    return tuple(map(int, value.split('.')))


def set_metadata_version(folder, target):
    for name in ('package.json', 'package-lock.json'):
        path = folder / name
        if not path.exists():
            continue
        data = json.loads(path.read_text())
        data['version'] = target
        if name == 'package-lock.json' and '' in data.get('packages', {}):
            data['packages']['']['version'] = target
        path.write_text(json.dumps(data, indent=4) + '\n')


def stamp_local_metadata(name, content, target):
    """Update only version tokens in partially staged files, preserving other edits."""
    try:
        source = content.decode('utf-8')
        if name in ('package.json', 'package-lock.json'):
            original = json.loads(source)
            result = re.sub(r'("version"\s*:\s*")[^"]+(")',
                            lambda m: m[1] + target + m[2], source, count=1)
            # Keep npm's root package record in the lock file synchronized too.
            if name == 'package-lock.json' and '' in original.get('packages', {}):
                result = re.sub(r'("packages"\s*:\s*\{\s*""\s*:\s*\{[\s\S]*?"version"\s*:\s*")[^"]+(")',
                                lambda m: m[1] + target + (m[2] or ''), result, count=1)
            data = json.loads(result)
            if data['version'] != target:
                return None
            if name == 'package-lock.json' and '' in data.get('packages', {}):
                if data['packages']['']['version'] != target:
                    return None
            return result.encode('utf-8')
        if name == 'cut-planner.html':
            return re.sub(r'(<span\b[^>]*\bid=["\']app-version["\'][^>]*>v)[^<]+',
                          lambda m: m[1] + target, source).encode('utf-8')
    except (ValueError, UnicodeError, KeyError):
        pass  # An in-progress/invalid working copy must never block a valid index.
    return None


def prepare_commit(root):
    normal_env = {key: value for key, value in os.environ.items() if key != 'GIT_INDEX_FILE'}
    normal_index = Path(os.fsdecode(git('rev-parse', '--git-path', 'index', cwd=root, env=normal_env)).strip())
    if not normal_index.is_absolute():
        normal_index = root / normal_index
    active_index = Path(os.environ.get('GIT_INDEX_FILE') or normal_index)
    if not active_index.is_absolute():
        active_index = root / active_index
    if active_index.resolve() not in (normal_index.resolve(), normal_index.with_name(normal_index.name + '.lock').resolve()):
        raise ValueError('Stage the desired files, then run git commit without file paths. '
                         'Path-only/alternate-index commits cannot safely synchronize release artifacts.')
    original_tree = git('write-tree', cwd=root).strip()
    with tempfile.TemporaryDirectory(prefix='cut-planner-commit-') as directory:
        temporary = Path(directory)
        snapshot = temporary / 'staged'
        snapshot.mkdir()
        git('checkout-index', '--all', '--prefix=' + str(snapshot) + os.sep, cwd=root)
        if not (snapshot / 'scripts/version-commit.py').exists():
            raise ValueError('Stage the versioning setup files before committing them together.')
        package_path = snapshot / 'package.json'
        package = json.loads(package_path.read_text())
        current = package['version']
        major, minor, patch = version(current)
        try:
            previous = json.loads(git('show', 'HEAD:package.json', cwd=root))['version']
        except subprocess.CalledProcessError:
            previous = None
        # A staged version differing from HEAD is a deliberate reset/manual release
        # or a release already prepared by a canceled commit; do not bump twice.
        target = f'{major}.{minor}.{patch + 1}' if current == previous else current
        originals = {name: (snapshot / name).read_bytes() if (snapshot / name).exists() else None
                     for name in ARTIFACTS}
        set_metadata_version(snapshot, target)
        environment = os.environ.copy()
        modules = root / 'node_modules'
        if modules.is_dir():
            environment['NODE_PATH'] = str(modules) + (os.pathsep + environment['NODE_PATH'] if environment.get('NODE_PATH') else '')
            try:
                (snapshot / 'node_modules').symlink_to(modules, target_is_directory=True)
            except OSError:
                pass  # NODE_PATH also supports environments without directory symlinks.
        print(f'Preparing commit release {target} from staged files…', flush=True)
        subprocess.run(['npm', 'run', 'build:distrib'], cwd=snapshot, env=environment, check=True)
        if json.loads(package_path.read_text())['version'] != target:
            raise ValueError('Build changed the version. Stage the updated version-neutral build script.')
        if json.loads((snapshot / 'docs/version.json').read_text())['version'] != target:
            raise ValueError('Built release metadata does not match the commit version.')
        # Prepare a separate index first: failures cannot partially stage a release.
        index_path = Path(os.environ.get('GIT_INDEX_FILE') or
                          os.fsdecode(git('rev-parse', '--git-path', 'index', cwd=root)).strip())
        if not index_path.is_absolute():
            index_path = root / index_path
        candidate = temporary / 'index'
        shutil.copyfile(index_path, candidate)
        index_env = {**os.environ, 'GIT_INDEX_FILE': str(candidate)}
        generated = [name for name in ARTIFACTS if (snapshot / name).is_file()]
        git('--work-tree=' + str(snapshot), 'add', '--', *generated, cwd=root, env=index_env)
        candidate_tree = git('write-tree', cwd=root, env=index_env).strip()
        if git('write-tree', cwd=root).strip() != original_tree:
            raise ValueError('The staged files changed during the build; retry the commit.')
        git('read-tree', candidate_tree.decode('ascii'), cwd=root)
        preserved = []
        for name in generated:
            local = root / name
            content = local.read_bytes() if local.exists() else None
            if content == originals[name]:
                local.parent.mkdir(parents=True, exist_ok=True)
                local.write_bytes((snapshot / name).read_bytes())
            elif content is not None:
                updated = stamp_local_metadata(name, content, target)
                if updated is not None:
                    local.write_bytes(updated)
                else:
                    preserved.append(name)
        if preserved:
            print('Kept unstaged edits in: ' + ', '.join(preserved), flush=True)
        print(f'Release {target} and its staged build are ready to commit.', flush=True)


if __name__ == '__main__':
    try:
        root = Path(os.fsdecode(git('rev-parse', '--show-toplevel')).strip())
        prepare_commit(root)
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        print(f'Commit release preparation failed: {error}', file=sys.stderr)
        sys.exit(1)
