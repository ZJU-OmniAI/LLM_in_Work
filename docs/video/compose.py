"""Build the five-assistant demo from the prior release and a real PDF capture.

python3 docs/video/compose.py --previous /path/to/video_v2/out --lang en
Dependencies: ffmpeg, ffprobe, Pillow. See README.md for the recording/voice steps.
"""
from __future__ import annotations
import argparse
import json
import os
import re
import subprocess
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
BUILD = HERE / 'build'
SIZE = (1920, 1080)
FONT = os.environ.get('DEMO_FONT')
if not FONT:
    matches = list(Path('/System/Library/AssetsV2/com_apple_MobileAsset_Font7').glob('*/AssetData/PingFang.ttc'))
    FONT = str(matches[0]) if matches else '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc'

def run(args: list[str]) -> None:
    subprocess.run(args, check=True)

def font(size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(FONT, size)

def duration(p: Path) -> float:
    return float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', str(p)]))

def wrap(text: str, size: int, width: int) -> list[str]:
    f = font(size)
    words = text.split(' ') if len(text.split(' ')) > 3 else list(text)
    join = ' ' if len(text.split(' ')) > 3 else ''
    lines, line = [], ''
    for word in words:
        candidate = line + (join if line else '') + word
        if f.getlength(candidate) > width and line:
            lines.append(line)
            line = word
        else:
            line = candidate
    if line:
        lines.append(line)
    return lines

def caption(primary: str, secondary: str, target: Path) -> None:
    im = Image.new('RGBA', SIZE, (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    lines = [(line, 36, '#ffffff') for line in wrap(primary, 36, 1700)] + [(line, 27, '#d5e8e1') for line in wrap(secondary, 27, 1700)]
    height = sum(size + 9 for _, size, _ in lines) + 28
    top = 1060 - height
    d.rounded_rectangle((65, top, 1855, 1062), radius=18, fill=(12, 30, 25, 236))
    y = top + 10
    for text, size, color in lines:
        f = font(size)
        d.text(((1920 - f.getlength(text)) / 2, y), text, font=f, fill=color)
        y += size + 9
    im.save(target)

def card(scene: str, lang: str, target: Path) -> None:
    im = Image.new('RGB', SIZE, '#102b23')
    d = ImageDraw.Draw(im)
    d.ellipse((1200, -350, 2250, 700), fill='#163c30')
    d.ellipse((-450, 620, 550, 1620), fill='#15382d')
    d.text((130, 100), 'LLM_IN_WORK   /   2026.10', font=font(27), fill='#90cbb4')
    title = {'title':'LLM_in_Work', 'arch':('Your CLI. Five assistants.' if lang=='en' else '你的命令行，五个助手。'), 'outro':('Write. Read. Stay in context.' if lang=='en' else '写作与阅读，都在文档旁。')}[scene]
    d.text((125, 235), title, font=font(76), fill='#f3f8f5')
    subtitle = {'title':('AI beside the work you already do.' if lang=='en' else '把已登录的 AI，带进日常工作。'), 'arch':('Local bridges → Claude Code / Codex → model provider' if lang=='en' else '本机桥 → Claude Code / Codex → 模型服务'), 'outro':'github.com/ZJU-OmniAI/LLM_in_Work'}[scene]
    d.text((132, 358), subtitle, font=font(38), fill='#bbd9ca')
    names=['Word','PowerPoint','Excel','Overleaf','PDF']
    colors=['#5487bc','#d08766','#5cb78a','#9bc96d','#e7ad71']
    for i,(name,col) in enumerate(zip(names,colors)):
        x=132+i*330
        d.rounded_rectangle((x,510,x+302,710),radius=20,fill='#204738',outline='#3a6754',width=2)
        d.rounded_rectangle((x+24,540,x+70,547),radius=3,fill=col)
        d.text((x+24,584),name,font=font(34),fill='#f4faf6')
        d.text((x+24,647),('Read & ask' if i==4 else 'Review & edit') if lang=='en' else ('阅读与问答' if i==4 else '审阅与编辑'),font=font(22),fill='#aacbbb')
    im.save(target)

def stamp(t: float) -> str:
    n=round(t*1000)
    return f'{n//3600000:02}:{n//60000%60:02}:{n//1000%60:02},{n%1000:03}'

def seconds(t: str) -> float:
    h,m,s=t.replace(',','.').split(':')
    return int(h)*3600+int(m)*60+float(s)

def previous_cues(file: Path, start: float, end: float, offset: float) -> list[tuple[float,float,str]]:
    result=[]
    for block in re.split(r'\n\s*\n',file.read_text().strip()):
        lines=block.splitlines()
        a,b=map(seconds,lines[1].split(' --> '))
        if a>=start and b<=end:
            result.append((a-start+offset,b-start+offset,'\n'.join(lines[2:])))
    return result

def main() -> None:
    parser=argparse.ArgumentParser()
    parser.add_argument('--previous',type=Path,required=True)
    parser.add_argument('--lang',choices=['en','zh'],required=True)
    args=parser.parse_args();lang=args.lang;other='zh' if lang=='en' else 'en'
    spec=json.loads((HERE/'script.json').read_text())
    marks={x['label']:x['t'] for x in json.loads((BUILD/'pdf-marks.json').read_text())['marks']}
    pdf=BUILD/'pdf-live.webm'
    bounds={
      'pdf_open':(marks['picker'],marks['selection']-.25),
      'pdf_text':(marks['selection']-.25,marks['crop']-1),
      'pdf_figure':(marks['crop']-1,marks['restored']-.6),
      'pdf_history':(marks['restored']-.6,duration(pdf)-.1),
    }
    clips=[];cues=[];timeline=[];at=0.
    out=BUILD/lang;out.mkdir(exist_ok=True)
    for scene in spec['scenes']:
        sid=scene['id'];sent=scene['sentences'][0]
        audio=BUILD/'tts'/f'{sid}_0_{lang}.mp3';D=duration(audio)+1.2
        pngs=[]
        # Captions follow the first spoken word of each sentence using TTS boundaries.
        meta=json.loads(Path(str(audio)+'.json').read_text());words=meta['words']
        # The first two logical lines partition the spoken text; proportional timing is
        # used for title overrides that pronounce product identifiers differently.
        weight=len(sent[lang][0]) / sum(len(x) for x in sent[lang])
        split=.25+duration(audio)*weight
        for i,(a,b) in enumerate([(.25,split),(split,D-.35)]):
            cp=out/f'{sid}-caption-{i}.png';caption(sent[lang][i],sent[other][i],cp);pngs.append(cp)
            cues.append((at+a,at+b,sent[lang][i]+'\n'+sent[other][i]))
        target=out/f'{sid}.mp4'
        base=['ffmpeg','-hide_banner','-loglevel','error','-y']
        if sid in bounds:
            a,b=bounds[sid]
            speed=min(1.,D/max(.1,b-a))
            base+=['-ss',str(a),'-t',str(b-a),'-i',str(pdf)]
            vf=f'[0:v]setpts={speed}*(PTS-STARTPTS),scale=1600:900,pad=1920:1080:160:28:color=0xeff5f1,tpad=stop_mode=clone:stop_duration={D},fps=30,setsar=1[bg];'
        else:
            bg=out/f'{sid}.png';card(sid,lang,bg)
            base+=['-loop','1','-framerate','30','-i',str(bg)]
            vf='[0:v]setsar=1[bg];'
        base+=['-i',str(audio),'-loop','1','-i',str(pngs[0]),'-loop','1','-i',str(pngs[1])]
        vf+=f"[bg][2:v]overlay=enable='between(t,0.25,{split})'[sub1];[sub1][3:v]overlay=enable='between(t,{split},{D-.35})'[v];[1:a]adelay=250|250,apad[a]"
        run(base+['-filter_complex',vf,'-map','[v]','-map','[a]','-t',str(D),'-c:v','libx264','-preset','veryfast','-crf','20','-pix_fmt','yuv420p','-r','30','-c:a','aac','-ar','48000','-ac','2','-b:a','128k','-movflags','+faststart',str(target)])
        clips.append(target);timeline.append({'id':sid,'start':at,'duration':D});at+=D
        print(lang,sid,round(at,2),flush=True)
        if sid=='title':
            start,end=(10.246,224.013579) if lang=='en' else (10.534,232.955870)
            old=args.previous/f'LLM_in_Work_demo_{lang}.mp4';middle=out/'editing.mp4'
            run(['ffmpeg','-hide_banner','-loglevel','error','-y','-ss',str(start),'-i',str(old),'-t',str(end-start),'-vf','fps=30,setsar=1','-c:v','libx264','-preset','veryfast','-crf','20','-pix_fmt','yuv420p','-c:a','aac','-ar','48000','-ac','2','-b:a','128k',str(middle)])
            clips.append(middle);cues+=previous_cues(args.previous/f'LLM_in_Work_demo_{lang}.srt',start,end,at)
            timeline.append({'id':'four_editing_assistants','start':at,'duration':end-start});at+=end-start
    listing=out/'concat.txt';listing.write_text(''.join("file '"+str(p).replace("'", "'\\''")+"'\n" for p in clips))
    final=BUILD/f'LLM_in_Work_demo_{lang}.mp4'
    run(['ffmpeg','-hide_banner','-loglevel','error','-y','-f','concat','-safe','0','-i',str(listing),'-c','copy','-movflags','+faststart',str(final)])
    (BUILD/f'LLM_in_Work_demo_{lang}.srt').write_text('\n\n'.join(f'{i+1}\n{stamp(a)} --> {stamp(b)}\n{text}' for i,(a,b,text) in enumerate(cues))+'\n')
    (BUILD/f'timeline-{lang}.json').write_text(json.dumps(timeline,indent=2))
    # A compact companion file is kept below 10 MB for GitHub attachment embeds.
    bit_rate=int((9.4*1024*1024*8)/duration(final)/1000)-48
    web=BUILD/f'LLM_in_Work_demo_{lang}_720p.mp4'
    for pass_n in [1,2]:
        run(['ffmpeg','-hide_banner','-loglevel','error','-y','-i',str(final),'-vf','scale=1280:720','-r','24','-c:v','libx264','-preset','fast','-b:v',f'{bit_rate}k','-pass',str(pass_n),'-passlogfile',str(out/'web-pass'),*(['-an','-f','null','/dev/null'] if pass_n==1 else ['-c:a','aac','-b:a','48k','-movflags','+faststart',str(web)])])
    print(f'{lang}: {duration(final):.1f}s, web {web.stat().st_size/1024/1024:.2f} MiB',flush=True)

if __name__=='__main__':
    main()
