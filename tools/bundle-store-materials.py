"""Bundle publisher-facing store materials separately from extension upload ZIPs."""
from pathlib import Path
import hashlib
import zipfile

ROOT = Path(__file__).resolve().parents[1]

def main() -> None:
    out = ROOT / 'dist/chrome-store'
    out.mkdir(parents=True, exist_ok=True)
    target = out / 'LLM_in_Work-chrome-store-materials-0.9.1.zip'
    with zipfile.ZipFile(target, 'w', zipfile.ZIP_DEFLATED) as z:
        for p in sorted((ROOT / 'docs/chrome-store').rglob('*')):
            if p.is_file(): z.write(p, p.relative_to(ROOT))
        for p in ('package-report.json', 'SHA256SUMS.txt'):
            z.write(out / p, p)
    print(target.name, target.stat().st_size, hashlib.sha256(target.read_bytes()).hexdigest())

if __name__ == '__main__': main()
