"""Prepare caption-free, public-demo clips for the story edit.

The input is the original LLM_in_Work_demo_video recording folder, not a browser
profile or a user's documents. Each clip has a deliberate crop and no audio.
"""
from __future__ import annotations
import argparse
import json
import subprocess
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HERE = Path(__file__).resolve().parent
# Coordinates refer to the original 3240x2156 Office / 3200x1800 Overleaf captures.
SHOTS: dict[str, tuple[str, list[float], list[float], list[int]]] = {
    'word_doc': ('word', [.2, 4.8], [.2, 4.8], [420, 340, 2800, 1575]),
    'word_select': ('word', [1.4, 12.8], [1.4, 12.8], [470, 350, 2770, 1558]),
    'word_diff': ('word', [25.5, 34.8], [26.1, 35.4], [1700, 790, 1540, 866]),
    'word_confirm': ('word', [35.5, 43.5], [36.1, 44.1], [420, 270, 2820, 1586]),
    'word_review': ('word', [43.4, 48.0], [44.0, 48.6], [600, 0, 2200, 1238]),
    'overleaf_select': ('overleaf', [1.2, 13.3], [1.2, 13.3], [0, 0, 3200, 1800]),
    'overleaf_diff': ('overleaf', [25.8, 33.5], [23.6, 31.3], [1720, 210, 1480, 832]),
    'overleaf_apply': ('overleaf', [34, 42.8], [31.8, 40.6], [300, 180, 2800, 1575]),
    'pdf_select': ('pdf', [4.3, 12.5], [4.3, 12.5], [0, 0, 1600, 900]),
    'pdf_answer': ('pdf', [12.1, 15.0], [12.1, 15.0], [0, 0, 1600, 900]),
    'pdf_figure': ('pdf', [15, 25.5], [15, 25.5], [0, 0, 1600, 900]),
    'pdf_history': ('pdf', [25.9, 28.8], [25.9, 28.8], [0, 0, 1600, 900]),
    'ppt_overview': ('ppt', [.2, 4.8], [.2, 4.8], [300, 370, 2800, 1575]),
    'ppt_select': ('ppt', [1.1, 4.6], [1.1, 4.6], [1680, 290, 1560, 877]),
    'ppt_diff': ('ppt', [19.3, 27.5], [17.5, 25.5], [2240, 560, 1000, 562]),
    'ppt_apply': ('ppt', [29.2, 37.3], [27.3, 35.4], [470, 500, 2170, 1221]),
    'excel_select': ('excel', [1.5, 6.5], [1.5, 6.5], [0, 262, 1760, 990]),
    'excel_diff': ('excel', [17, 22], [17.3, 22.3], [2240, 680, 1000, 562]),
    'excel_apply': ('excel', [22, 27.4], [22.3, 27.7], [0, 262, 1760, 990]),
    'excel_fill': ('excel', [51.3, 57.1], [53.4, 59.2], [0, 262, 1760, 990]),
}

def main() -> None:
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--recordings', type=Path, required=True)
    parser.add_argument('--pdf',type=Path,default=HERE/'build/pdf-live.webm')
    parser.add_argument('--output',type=Path,default=HERE/'build/story-sources')
    args=parser.parse_args()
    args.output.mkdir(parents=True,exist_ok=True)
    tasks=[]
    for lang in ('en','zh'):
        sources={
            'word':args.recordings/'rec'/('word_en_take2.mp4' if lang=='en' else 'word_zh_take1.mp4'),
            'overleaf':args.recordings/f'ol/hd-{lang}/capture.mp4',
            'ppt':args.recordings/f'rec/ppt_{lang}_take1.mp4',
            'excel':args.recordings/'rec'/('xl_en_take1.mp4' if lang=='en' else 'xl_zh_take3.mp4'),
            'pdf':args.pdf,
        }
        for name,(source,en,zh,crop) in SHOTS.items():
            tasks.append((name,lang,sources[source],en if lang=='en' else zh,crop))
    def prepare(task: tuple) -> None:
        name,lang,source,bounds,crop=task
        target=args.output/f'{name}-{lang}.mp4'
        if target.exists():return
        x,y,w,h=crop
        cmd=['ffmpeg','-hide_banner','-loglevel','error','-y','-ss',str(bounds[0]),'-i',str(source),'-t',str(bounds[1]-bounds[0]),'-vf',f'crop={w}:{h}:{x}:{y},scale=1600:900,fps=30,setsar=1','-an','-c:v','libx264','-threads','2','-preset','veryfast','-crf','19','-pix_fmt','yuv420p','-movflags','+faststart',str(target)]
        subprocess.run(cmd,check=True)
        print(target.name,flush=True)
    with ThreadPoolExecutor(max_workers=3) as executor:list(executor.map(prepare,tasks))
    # No personal absolute paths in the reproducible source bundle.
    (args.output/'manifest.json').write_text(json.dumps({'description':'Caption-free clips from synthetic LLM_in_Work demonstrations. No narration audio.','frame_size':[1600,900],'clips':SHOTS},ensure_ascii=False,indent=2)+'\n')

if __name__=='__main__':main()
