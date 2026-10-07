"""Build auditable Chrome Web Store ZIPs and complete companion source bundles.
Run from any directory: python3 tools/package-chrome.py
Only extension/ goes into the upload ZIP. The local bridge is a separate download.
"""
from __future__ import annotations
import hashlib
import json
import re
import struct
import subprocess
import zipfile
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'dist/chrome-store'
PROJECTS = ('LLM_in_Overleaf', 'LLM_in_PDF')

class ResourceParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(); self.refs: list[str] = []; self.remote_scripts: list[str] = []
    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        a = dict(attrs)
        value = a.get('src') if tag in ('script', 'img', 'iframe', 'source') else a.get('href') if tag == 'link' else None
        if value:
            self.refs.append(value)
            if tag == 'script' and re.match(r'(https?:)?//', value): self.remote_scripts.append(value)

def extension_id(key: str) -> str:
    import base64
    digest = hashlib.sha256(base64.b64decode(key)).hexdigest()[:32]
    return ''.join(chr(97 + int(c, 16)) for c in digest)

def png_size(path: Path) -> tuple[int, int]:
    data = path.read_bytes()
    assert data[:8] == b'\x89PNG\r\n\x1a\n', f'Not PNG: {path}'
    return struct.unpack('>II', data[16:24])

def validate(root: Path) -> dict:
    manifest = json.loads((root / 'manifest.json').read_text())
    assert manifest['manifest_version'] == 3
    assert re.fullmatch(r'\d+(\.\d+){0,3}', manifest['version'])
    refs = [manifest['background']['service_worker'], manifest['action']['default_popup']]
    for block in manifest.get('content_scripts', []): refs += block.get('js', []) + block.get('css', [])
    refs += list(manifest['icons'].values())
    for ref in refs: assert (root / ref).is_file(), f'Missing manifest resource: {ref}'
    for block in manifest.get('web_accessible_resources', []):
        for pattern in block['resources']: assert list(root.glob(pattern)), f'Empty resource glob: {pattern}'
    for size, ref in manifest['icons'].items(): assert png_size(root / ref) == (int(size), int(size))
    for p in (root / '_locales').glob('*/messages.json'):
        messages = json.loads(p.read_text())
        for key in re.findall(r'__MSG_(\w+)__', json.dumps(manifest)):
            assert key in messages, f'Missing locale key: {p}: {key}'
        assert 0 < len(messages['extDescription']['message']) <= 132
    assert (root / '_locales' / manifest['default_locale'] / 'messages.json').is_file()
    checked = 0
    for p in sorted(root.rglob('*')):
        if not p.is_file(): continue
        assert not p.is_symlink(), f'Symlink: {p}'
        assert p.suffix.lower() not in ('.pem', '.key', '.p12', '.pfx', '.log', '.zip', '.crx'), f'Unexpected file: {p}'
        assert not any(part.startswith('.') for part in p.relative_to(root).parts), f'Hidden file: {p}'
        if p.suffix not in ('.html', '.css', '.js', '.mjs', '.json'): continue
        text = p.read_text()
        assert not re.search(r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----', text), f'Private key in {p}'
        assert not re.search(r'gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{50,}', text), f'Credential pattern in {p}'
        local_refs: list[str] = []
        if p.suffix == '.html':
            parser = ResourceParser(); parser.feed(text)
            assert not parser.remote_scripts, f'Remote script: {p}'
            local_refs += parser.refs
        elif p.suffix == '.css':
            local_refs += re.findall(r'url\(\s*[\'"]?([^\)\'"\s]+)', text)
        elif p.suffix in ('.js', '.mjs'):
            subprocess.run(['node', '--check', str(p)], check=True, capture_output=True)
            local_refs += re.findall(r'(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)[\'"](\.[^\'"\n]+)[\'"]', text)
        for ref in local_refs:
            if re.match(r'^(?:[\w+.-]+:|//|#)', ref) or ref.startswith('var('): continue
            ref = ref.split('#')[0].split('?')[0]
            target = (root / ref.lstrip('/')) if ref.startswith('/') else p.parent / ref
            assert target.resolve().is_relative_to(root.resolve()), f'Resource escapes package: {p}: {ref}'
            assert target.exists(), f'Missing local resource: {p.relative_to(root)} -> {ref}'
            checked += 1
    return {'version': manifest['version'], 'development_id': extension_id(manifest['key']), 'checked_static_references': checked, 'permissions': manifest['permissions'], 'host_permissions': manifest.get('host_permissions', []), 'file_count': sum(p.is_file() for p in root.rglob('*'))}

def add(z: zipfile.ZipFile, name: str, data: bytes, executable: bool = False) -> None:
    info = zipfile.ZipInfo(name, (2026, 10, 8, 0, 0, 0))
    info.create_system = 3; info.external_attr = (0o100755 if executable else 0o100644) << 16
    info.compress_type = zipfile.ZIP_DEFLATED
    z.writestr(info, data)

def artifact(path: Path) -> dict:
    return {'file': path.name, 'bytes': path.stat().st_size, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}

def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    report = {}
    for project in PROJECTS:
        root = ROOT / project; ext = root / 'extension'; facts = validate(ext)
        version = facts['version']; assert json.loads((root / 'package.json').read_text())['version'] == version
        slug = 'overleaf' if project.endswith('Overleaf') else 'pdf'
        store = ROOT / 'docs/chrome-store' / slug
        permissions = json.loads((store / 'permissions.json').read_text())
        assert set(permissions['permissions']) == set(facts['permissions'])
        assert set(permissions['host_permissions']) == set(facts['host_permissions'])
        for name in ('listing.en.md', 'listing.zh-CN.md', 'reviewer-notes.md'): assert (store / name).is_file()
        assets = store / 'assets'
        assert png_size(assets / 'icon-128.png') == (128, 128)
        assert png_size(assets / 'small-promo-440x280.png') == (440, 280)
        assert png_size(assets / 'marquee-1400x560.png') == (1400, 560)
        for locale in ('en', 'zh_CN'):
            shots = list((assets / locale).glob('screenshot-*.png'))
            assert 1 <= len(shots) <= 5
            for shot in shots: assert png_size(shot) == (1280, 800)
        upload = OUT / f'{project}-{version}-chrome.zip'
        with zipfile.ZipFile(upload, 'w', compression=zipfile.ZIP_DEFLATED) as z:
            for p in sorted(ext.rglob('*')):
                if not p.is_file(): continue
                data = p.read_bytes()
                if p.name == 'manifest.json' and p.parent == ext:
                    manifest = json.loads(data); manifest.pop('key', None)
                    data = (json.dumps(manifest, ensure_ascii=False, indent=2) + '\n').encode()
                add(z, str(p.relative_to(ext)), data)
            add(z, 'LICENSE', (ROOT / 'LICENSE').read_bytes())
        with zipfile.ZipFile(upload) as z:
            assert z.testzip() is None and 'manifest.json' in z.namelist()
            assert 'key' not in json.loads(z.read('manifest.json'))
        companion = OUT / f'{project}-{version}-companion.zip'
        paths = [*ext.rglob('*'), *(root / 'server').rglob('*'), *(root / 'docs/images').rglob('*')]
        paths += [root / n for n in ('package.json', 'package-lock.json', 'README.md', 'README.zh-CN.md', 'install.sh')]
        paths += ([root / 'install.ps1', root / 'tools/ping-host.mjs'] if slug == 'overleaf' else [root / 'tools/install.mjs', root / 'start.sh'])
        with zipfile.ZipFile(companion, 'w', compression=zipfile.ZIP_DEFLATED) as z:
            for p in sorted(set(paths)):
                if p.is_file(): add(z, f'{project}/{p.relative_to(root)}', p.read_bytes(), p.suffix == '.sh')
            for name in ('LICENSE', 'SECURITY.md', 'docs/chrome-store/PRIVACY.md', 'docs/chrome-store/README.zh-CN.md'):
                add(z, name, (ROOT / name).read_bytes())
        facts['artifacts'] = [artifact(upload), artifact(companion)]
        facts['store_id'] = 'Assigned by Chrome Web Store; verify in dashboard before installing the companion.'
        report[project] = facts
        print(project, json.dumps(facts, ensure_ascii=False))
    (OUT / 'package-report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    (OUT / 'SHA256SUMS.txt').write_text(''.join(f"{a['sha256']}  {a['file']}\n" for f in report.values() for a in f['artifacts']))

if __name__ == '__main__': main()
