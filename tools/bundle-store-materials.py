"""Bundle publisher-facing store materials separately from extension upload ZIPs."""
from pathlib import Path
import hashlib
import json
import zipfile

ROOT = Path(__file__).resolve().parents[1]

def main() -> None:
    out = ROOT / 'dist/chrome-store'
    out.mkdir(parents=True, exist_ok=True)
    report = json.loads((out / 'package-report.json').read_text())
    version = max((item['version'] for item in report.values()), key=lambda value: tuple(map(int, value.split('.'))))
    target = out / f'LLM_in_Work-chrome-store-materials-{version}.zip'
    with zipfile.ZipFile(target, 'w', zipfile.ZIP_DEFLATED) as z:
        for p in sorted((ROOT / 'docs/chrome-store').rglob('*')):
            if p.is_file(): z.write(p, p.relative_to(ROOT))
        for p in ('package-report.json', 'SHA256SUMS.txt'):
            z.write(out / p, p)
    print(target.name, target.stat().st_size, hashlib.sha256(target.read_bytes()).hexdigest())

if __name__ == '__main__': main()
