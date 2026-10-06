# Generate narration audio per sentence (zh + en) with edge-tts; record durations and word timings.
import asyncio, json, os, subprocess, sys
import edge_tts
from typing import Awaitable
HERE = os.path.dirname(os.path.abspath(__file__))
script = json.load(open(os.path.join(HERE, 'script.json'), encoding='utf-8'))
OUT = os.path.join(HERE, 'build', 'tts')
os.makedirs(OUT, exist_ok=True)

def duration(path: str) -> float:
    return float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path]).decode().strip())

def spoken_text(s: dict, lang: str) -> str:
    if lang == 'zh':
        return s.get('zh_say') or ''.join(s['zh'])
    return s.get('en_say') or ' '.join(s['en'])

async def synth(text: str, voice: str, rate: str, path: str) -> None:
    meta_path = path + '.json'
    if os.path.exists(path) and os.path.exists(meta_path):
        meta = json.load(open(meta_path, encoding='utf-8'))
        if meta.get('text') == text and meta.get('voice') == voice and meta.get('rate') == rate and meta.get('words'):
            return
    for attempt in range(4):
        try:
            words: list[list] = []
            audio = bytearray()
            comm = edge_tts.Communicate(text, voice, rate=rate, boundary='WordBoundary')
            async for chunk in comm.stream():
                if chunk['type'] == 'audio':
                    audio += chunk['data']
                elif chunk['type'] == 'WordBoundary':
                    words.append([chunk['offset'] / 1e7, chunk['duration'] / 1e7, chunk['text']])
            if not audio or not words:
                raise RuntimeError('empty tts result')
            with open(path, 'wb') as f:
                f.write(audio)
            json.dump({'text': text, 'voice': voice, 'rate': rate, 'words': words}, open(meta_path, 'w', encoding='utf-8'), ensure_ascii=False)
            return
        except Exception as e:
            print('retry', attempt, e, file=sys.stderr)
            await asyncio.sleep(2 + attempt * 2)
    raise RuntimeError('tts failed: ' + text)

async def main() -> None:
    jobs, index = [], []
    for scene in script['scenes']:
        for i, s in enumerate(scene['sentences']):
            for lang in ('zh', 'en'):
                path = os.path.join(OUT, f"{scene['id']}_{i}_{lang}.mp3")
                jobs.append(synth(spoken_text(s, lang), script['voices'][lang], script['rates'][lang], path))
                index.append((scene['id'], i, lang, path))
    sem = asyncio.Semaphore(4)
    async def run(j: Awaitable[None]) -> None:
        async with sem:
            await j
    await asyncio.gather(*(run(j) for j in jobs))
    result: dict = {}
    for sid, i, lang, path in index:
        meta = json.load(open(path + '.json', encoding='utf-8'))
        result.setdefault(sid, {}).setdefault(str(i), {})[lang] = {'file': os.path.basename(path), 'dur': duration(path), 'words': meta['words']}
    json.dump(result, open(os.path.join(OUT, 'durations.json'), 'w'), indent=1, ensure_ascii=False)
    tot = {l: round(sum(v[l]['dur'] for s in result.values() for v in s.values()), 1) for l in ('zh', 'en')}
    print('total narration seconds', tot)

asyncio.run(main())
