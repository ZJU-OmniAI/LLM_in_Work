"""Render the story edit: live captures, moving layouts, narration and original score.

python3 docs/video/compose.py --lang zh --sources docs/video/build/story-sources
Use --preview to render only the opening, or --stills for storyboard contact frames.
"""
from __future__ import annotations
import argparse
import functools
import json
import math
import re
import subprocess
import wave
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

HERE=Path(__file__).resolve().parent
BUILD=HERE/'build'
W,H,FPS=1920,1080,30
MINT='#9ef5cf'; WHITE='#f5f4ee'; MUTED='#91a4b3'; CORAL='#f6aa94'
FONT_PATH=next(iter(Path('/System/Library/AssetsV2/com_apple_MobileAsset_Font7').glob('*/AssetData/PingFang.ttc')),Path('/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc'))
CHAPTERS=['word','overleaf','pdf','powerpoint','excel']
NAMES=['Word','Overleaf','Chrome PDF','PowerPoint','Excel']

@functools.lru_cache(maxsize=128)
def font(size: int, bold: bool=False) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(FONT_PATH),size,index=11 if bold and FONT_PATH.suffix=='.ttc' and 'PingFang' in str(FONT_PATH) else 0)

def run(args: list[str]) -> None:
    subprocess.run(args,check=True)

def duration(path: Path) -> float:
    return float(subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration','-of','csv=p=0',str(path)]))

def ease(t: float) -> float:
    t=max(0.,min(1.,t));return 1-(1-t)**3

def wrap(text: str, size: int, width: int, bold: bool=False) -> list[str]:
    result=[]
    for paragraph in text.split('\n'):
        words=paragraph.split(' ') if len(paragraph.split(' '))>3 else list(paragraph)
        sep=' ' if len(paragraph.split(' '))>3 else ''
        line=''
        for word in words:
            candidate=line+(sep if line else '')+word
            if line and font(size,bold).getlength(candidate)>width:result.append(line);line=word
            else:line=candidate
        if line:result.append(line)
    return result

@functools.lru_cache(maxsize=1024)
def text_image(text: str, size: int, color: str, width: int, bold: bool=False) -> Image.Image:
    lines=wrap(text,size,width,bold)
    im=Image.new('RGBA',(width,(size+15)*len(lines)+10))
    d=ImageDraw.Draw(im)
    for i,line in enumerate(lines):d.text((0,i*(size+15)),line,font=font(size,bold),fill=color)
    return im

def label(im: Image.Image, text: str, xy: tuple[float,float], size: int=32, color: str=WHITE, width: int=1700, bold: bool=False, alpha: float=1.) -> None:
    layer=text_image(text,size,color,width,bold)
    if alpha<1:
        layer=layer.copy();layer.putalpha(layer.getchannel('A').point(lambda a:int(a*max(0,alpha))))
    im.alpha_composite(layer,(int(xy[0]),int(xy[1])))

def backdrop() -> Image.Image:
    yy,xx=np.mgrid[:H,:W]
    glow=np.exp(-((xx-1450)**2+(yy-180)**2)/900000)
    low=np.exp(-((xx-200)**2+(yy-900)**2)/700000)
    arr=np.stack([9+12*glow+4*low,17+21*glow+10*low,27+24*glow+8*low],axis=2)
    return Image.fromarray(np.uint8(arr)).convert('RGBA')

BASE=backdrop()

class Footage:
    def __init__(self, path: Path) -> None:
        self.cap=cv2.VideoCapture(str(path))
        if not self.cap.isOpened():raise RuntimeError(f'Cannot open {path}')
        self.count=int(self.cap.get(cv2.CAP_PROP_FRAME_COUNT));self.fps=self.cap.get(cv2.CAP_PROP_FPS)
        self.index=-1;self.frame=None
    def get(self, p: float) -> Image.Image:
        target=min(self.count-1,max(0,int(p*(self.count-1))))
        if target<self.index:self.cap.set(cv2.CAP_PROP_POS_FRAMES,target);self.index=target-1
        while self.index<target:
            ok,frame=self.cap.read()
            if not ok:break
            self.frame=frame;self.index+=1
        if self.frame is None:raise RuntimeError('Missing source frame')
        return Image.fromarray(cv2.cvtColor(self.frame,cv2.COLOR_BGR2RGB))
    def close(self) -> None:self.cap.release()

@functools.lru_cache(maxsize=100)
def mask_for(size: tuple[int,int], radius: int=22) -> Image.Image:
    mask=Image.new('L',size,0);ImageDraw.Draw(mask).rounded_rectangle((0,0,size[0]-1,size[1]-1),radius,fill=255);return mask

def window(im: Image.Image, frame: Image.Image, box: tuple[float,float,float,float], zoom: float=1., opacity: float=1.) -> None:
    x,y,w,h=map(int,box)
    # Crop gently within a shot, without distorting the application's aspect ratio.
    iw,ih=frame.size
    desired=w/h
    cw=min(iw,ih*desired)/zoom;ch=cw/desired
    frame=frame.crop(((iw-cw)/2,(ih-ch)/2,(iw+cw)/2,(ih+ch)/2)).resize((w,h),Image.Resampling.BICUBIC).convert('RGBA')
    frame.putalpha(mask_for((w,h)).point(lambda a:int(a*opacity)))
    shadow=ImageDraw.Draw(im)
    shadow.rounded_rectangle((x+5,y+12,x+w+5,y+h+12),24,fill=(0,0,0,100))
    im.alpha_composite(frame,(x,y))
    shadow.rounded_rectangle((x,y,x+w,y+h),22,outline=(192,239,227,int(80*opacity)),width=2)

def header(im: Image.Image, chapter: str, progress: float) -> None:
    d=ImageDraw.Draw(im)
    d.rounded_rectangle((60,39,72,72),4,fill=MINT)
    label(im,'LLM_in_Work',(86,35),27,WHITE,300,True)
    for i,name in enumerate(NAMES):
        x=650+i*240
        color=MINT if chapter==CHAPTERS[i] else MUTED
        label(im,name,(x,41),23,color,235)
        if chapter==CHAPTERS[i]:d.rounded_rectangle((x,79,x+190,82),2,fill=MINT)
    d.rectangle((0,H-4,int(W*progress),H),fill=MINT)

def type_bubble(im: Image.Image, text: str, xy: tuple[int,int], elapsed: float, n: int, lang: str) -> None:
    x,y=xy;d=ImageDraw.Draw(im)
    p=ease((elapsed-n*.65)/.45)
    y+=int((1-p)*24)
    d.rounded_rectangle((x,y,x+590,y+104),18,fill=(45,42,48,240),outline=(151,113,111,150),width=1)
    chars=max(0,min(len(text),int((elapsed-n*.65)*16)))
    label(im,text[:chars]+('▏' if chars<len(text) else ''),(x+25,y+25),29,CORAL,550,alpha=p)

def draw_scene(scene: dict, lang: str, t: float, D: float, footage: list[Footage], global_progress: float) -> Image.Image:
    im=BASE.copy();d=ImageDraw.Draw(im)
    # A drifting fine grid and light trail give transitions depth, without flashing.
    offset=int(t*10)%100
    for x in range(-100,W+100,100):d.line((x+offset,100,x+offset,H),fill=(28,51,57,70),width=1)
    layout=scene['layout'];p=t/D;entry=ease(t/.7)
    title=scene['title'][lang]
    index=min(len(footage)-1,int(p*len(footage)))
    local=p if len(set(scene['shots']))==1 else (p*len(footage)-index)
    current=footage[index].get(local) if layout not in ('proof','reveal','connection') else None
    header(im,scene['chapter'],global_progress)
    if layout=='hook':
        label(im,'想象一下' if lang=='zh' else 'PICTURE THIS',(95,186),26,MINT,560,alpha=entry)
        label(im,title,(90,270+(1-entry)*35),70,WHITE,610,True,entry)
        label(im,'你 · 文档 · 一处想改好的地方' if lang=='zh' else 'You. Your draft. One small change.',(96,552),28,MUTED,570,alpha=ease((t-.7)/.6))
        window(im,current,(745+(1-entry)*85,205,1090,613),1.02+.025*local)
        d.rounded_rectangle((790,768,1230,834),18,fill=(147,242,201,255))
        label(im,'“只改这一段。”' if lang=='zh' else '“Just this paragraph.”',(815,781),29,'#10231e',410,True)
    elif layout=='friction':
        window(im,current,(68,228,1080,608),1.025)
        label(im,title,(90,125),52,WHITE,1700,True)
        texts=['第几页？','哪一段？','哪些内容不要动？'] if lang=='zh' else ['Which page?','Which paragraph?','What should stay untouched?']
        for j,txt in enumerate(texts):type_bubble(im,txt,(1220,260+j*155),t,j,lang)
        label(im,'场景示意' if lang=='zh' else 'SCENARIO ILLUSTRATION',(1225,771),20,MUTED,580)
        # The pointer travels back toward the paragraph: the friction is locating a target.
        x=1160+26*math.sin(t*1.4);d.line((x,500,x+30,485),fill=CORAL,width=4);d.line((x,500,x+30,515),fill=CORAL,width=4)
    elif layout in ('turn','return'):
        window(im,current,(115,120,1690,950),1.0+.04*p)
        cover=Image.new('RGBA',(W,H),(4,12,20,150));im=Image.alpha_composite(im,cover)
        label(im,title,(140,365+(1-entry)*45),80,MINT,1650,True,entry)
        label(im,'选中眼前这一段' if lang=='zh' else 'Select the passage in front of you',(150,505),33,WHITE,1550,alpha=ease((t-.3)/.6))
        radius=38+18*((t*1.2)%1);d=ImageDraw.Draw(im);d.ellipse((1595-radius,400-radius,1595+radius,400+radius),outline=(158,245,207,200),width=3)
    elif layout=='proof':
        label(im,title,(105,160),66,WHITE,1710,True,entry)
        for j,f in enumerate(footage):
            x=64+j*620;pop=ease((t-j*.5)/.6)
            window(im,f.get(min(1,max(0,p*1.3-j*.08))),(x,340+(1-pop)*45,590,332),1.02)
            word=(['选中','审阅','确认'] if lang=='zh' else ['Select','Review','Confirm'])[j]
            label(im,f'0{j+1}  {word}',(x+18,712),38,MINT if p*3>=j else MUTED,570,True)
            d.line((x+12,297,x+12+int(566*min(1,max(0,p*3-j))),297),fill=MINT,width=5)
    elif layout=='reveal':
        for j,f in enumerate(footage):
            window(im,f.get(min(1,p+.05*j)),(130+j*580,160+35*math.sin(t*.5+j),540,304),1.04,.65)
        im=Image.alpha_composite(im,Image.new('RGBA',(W,H),(4,12,20,55)))
        label(im,'LLM_in_Work',(145,495+(1-entry)*40),117,WHITE,1650,True,entry)
        label(im,'你的本机 Agent，来到工作现场。' if lang=='zh' else 'Your local agent. Right where you work.',(155,663),40,MINT,1630,alpha=ease((t-.6)/.7))
        for j,name in enumerate(NAMES):
            a=ease((t-1.0-j*.22)/.5);label(im,name,(155+j*330,775+(1-a)*20),29,WHITE,325,alpha=a)
    elif layout=='connection':
        label(im,title,(100,122),60,WHITE,1710,True)
        for j,f in enumerate(footage):
            window(im,f.get(min(1,p+.08*j)),(80,258+j*182,265,149),1.)
        boxes=[(495,385,970,622),(1190,385,1775,622)]
        for x1,y1,x2,y2 in boxes:d.rounded_rectangle((x1,y1,x2,y2),26,fill='#172e35',outline='#4c8175',width=2)
        label(im,'Claude Code\nCodex',(550,425),45,WHITE,405,True)
        label(im,'模型服务' if lang=='zh' else 'Model provider',(1230,459),43,WHITE,540,True)
        label(im,'本机桥' if lang=='zh' else 'LOCAL BRIDGE',(518,662),24,MUTED,400)
        for j,y in enumerate([332,514,696]):
            d.line((350,y,494,500),fill='#4c8175',width=3)
            q=(p*4+j*.25)%1;xx=350+144*q;yy=y+(500-y)*q;d.ellipse((xx-7,yy-7,xx+7,yy+7),fill=MINT)
        d.line((976,505,1184,505),fill='#4c8175',width=3)
        xx=976+208*((t*.5)%1);d.ellipse((xx-8,497,xx+8,513),fill=MINT)
    elif layout in ('outro','montage'):
        # Rapid live-action cuts continue behind the final message.
        window(im,current,(630,160+12*math.sin(t*.8),1200,675),1.015+.03*local,.86)
        shade=Image.new('RGBA',(W,H));sd=ImageDraw.Draw(shade);sd.rectangle((0,95,800,890),fill=(6,17,25,220));im=Image.alpha_composite(im,shade)
        label(im,title,(88,245+(1-entry)*28),62,WHITE,550,True,entry)
        label(im,'LLM_in_Work',(95,626),48,MINT,950,True)
        label(im,'github.com/ZJU-OmniAI/LLM_in_Work',(96,714),26,WHITE,1600)
        label(im,'从你正在用的软件开始' if lang=='zh' else 'Start where you already work.',(96,782),30,MUTED,1550)
    else:
        label(im,title,(105,100+(1-entry)*18),48,WHITE,1710,True,entry)
        window(im,current,(246,180,1428,803),1.0+.035*local)
        # A numbered chapter marker keeps the product sequence legible.
        chapter=CHAPTERS.index(scene['chapter'])+1
        label(im,f'0{chapter}',(75,286),76,MINT,160,True)
        label(im,NAMES[chapter-1],(70,394),25,MUTED,200)
        if scene['chapter']=='overleaf':label(im,'真实扩展 · 本地演示页' if lang=='zh' else 'Real extension · local demo page',(257,863),22,'#26394a',1340)
    return im

def normalize(text: str) -> str:
    return re.sub(r'[\W_]+','',text).casefold()

def caption_parts(scene: dict, lang: str, meta: dict, audio_duration: float) -> list[tuple[float,float,str,str]]:
    sent=scene['sentences'][0];other='en' if lang=='zh' else 'zh'
    chunks=sent[lang];translations=sent[other]
    if len(chunks)==1:return [(.28,audio_duration+.28,chunks[0],translations[0])]
    all_words=meta['words'];acc='';boundary=audio_duration*.5
    for i,w in enumerate(all_words[:-1]):
        acc+=normalize(w[2])
        if acc==normalize(chunks[0]):boundary=all_words[i+1][0];break
    return [(.28,boundary+.28,chunks[0],translations[0]),(boundary+.28,audio_duration+.28,chunks[1],translations[1])]

def add_caption(im: Image.Image, first: str, second: str) -> None:
    a=text_image(first,35,WHITE,1700);b=text_image(second,25,'#a8bbb9',1700)
    height=a.height+b.height+24;top=H-22-height
    layer=Image.new('RGBA',(W,H));d=ImageDraw.Draw(layer)
    d.rounded_rectangle((68,top,W-68,H-14),20,fill=(5,14,20,238))
    layer.alpha_composite(a,(110,top+11));layer.alpha_composite(b,(110,top+11+a.height))
    im.alpha_composite(layer)

def stamp(t: float) -> str:
    n=round(t*1000);return f'{n//3600000:02}:{n//60000%60:02}:{n//1000%60:02},{n%1000:03}'

def score(path: Path, seconds: float, scenes: list[dict], sample_rate: int=24000) -> None:
    """Original, quiet instrumental bed: warm pads, soft plucks and transition taps."""
    count=int(seconds*sample_rate);track=np.zeros((count,2),np.float32)
    bpm=82.;beat=60/bpm;chords=[[57,60,64,67],[53,57,60,64],[48,55,60,64],[55,59,62,67]]
    def note(midi: int, start: float, length: float, volume: float, pluck: bool=False, pan: float=.5) -> None:
        a=int(start*sample_rate);n=min(int(length*sample_rate),count-a)
        if n<=0:return
        t=np.arange(n,dtype=np.float32)/sample_rate;hz=440*2**((midi-69)/12)
        signal=np.sin(2*np.pi*hz*t)+.16*np.sin(2*np.pi*hz*2*t)
        env=np.minimum(1,t/.18)*np.minimum(1,(length-t)/.7)
        if pluck:env=np.minimum(1,t/.012)*np.exp(-t*2.7)
        signal*=np.maximum(0,env)*volume
        track[a:a+n,0]+=signal*math.sqrt(1-pan);track[a:a+n,1]+=signal*math.sqrt(pan)
    for bar in range(math.ceil(seconds/(beat*8))):
        chord=chords[bar%4];start=bar*beat*8
        for j,midi in enumerate(chord):note(midi,start,beat*8.7,.009,False,.18+j*.2)
        for k in range(8):note(chord[k%4]+12,start+k*beat,beat*1.5,.009 if k%2 else .012,True,.25+(k%3)*.23)
    for s in scenes:
        # A soft nonverbal pulse marks a chapter cut; no sampled copyrighted audio.
        if s['chapter'] in ('opening','closing'):
            note(81,s['start'],.32,.012,True,.5)
    fade=np.minimum(1,np.arange(count)/sample_rate/2)*np.minimum(1,(count-np.arange(count))/sample_rate/3)
    track*=fade[:,None]
    with wave.open(str(path),'wb') as out:
        out.setnchannels(2);out.setsampwidth(2);out.setframerate(sample_rate);out.writeframes((np.clip(track,-1,1)*32767).astype('<i2').tobytes())

def main() -> None:
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--lang',choices=['en','zh'],required=True)
    parser.add_argument('--sources',type=Path,default=BUILD/'story-sources')
    parser.add_argument('--preview',action='store_true')
    parser.add_argument('--stills',action='store_true')
    parser.add_argument('--only',help='Render one scene for QA')
    args=parser.parse_args();lang=args.lang
    spec=json.loads((HERE/'script.json').read_text());scenes=spec['scenes']
    if args.preview:scenes=[s for s in scenes if s['chapter']=='opening']
    if args.only:scenes=[s for s in scenes if s['id']==args.only]
    out=BUILD/f'story-{lang}';out.mkdir(exist_ok=True)
    timeline=[];at=0.
    for s in scenes:
        audio=BUILD/'story-tts'/f'{s["id"]}_0_{lang}.mp3'
        d=duration(audio);D=math.ceil((d+.9+(1.2 if s['id']=='outro' else 0))*FPS)/FPS
        timeline.append({**s,'start':at,'duration':D,'audio':str(audio),'audio_duration':d});at+=D
    all_cues=[];scene_files=[]
    for s in timeline:
        D=s['duration'];N=round(D*FPS);sid=s['id'];target=out/f'{sid}.mp4'
        meta=json.loads(Path(s['audio']+'.json').read_text());cues=caption_parts(s,lang,meta,s['audio_duration'])
        for a,b,x,y in cues:all_cues.append((s['start']+a,s['start']+b,x+'\n'+y))
        footage=[Footage(args.sources/f'{name}-{lang}.mp4') for name in s['shots']]
        try:
            if args.stills:
                for p in (.18,.55,.82):
                    # Readers support backwards seeks when the layout uses multiple windows.
                    im=draw_scene(s,lang,D*p,D,footage,(s['start']+D*p)/at)
                    for a,b,x,y in cues:
                        if a<=D*p<b:add_caption(im,x,y)
                    im.convert('RGB').save(out/f'{sid}-{int(p*100)}.jpg',quality=91)
                continue
            fingerprint=json.dumps({'scene':s,'voice':meta,'renderer':9,'overall_duration':at},sort_keys=True,ensure_ascii=False)
            cache=out/f'{sid}.cache.json'
            if target.exists() and cache.exists() and cache.read_text()==fingerprint:
                scene_files.append(target);continue
            raw=out/f'{sid}-silent.mp4'
            encoder=subprocess.Popen(['ffmpeg','-hide_banner','-loglevel','error','-y','-f','rawvideo','-pix_fmt','rgb24','-s',f'{W}x{H}','-r',str(FPS),'-i','-','-an','-c:v','libx264','-threads','3','-preset','veryfast','-crf','20','-pix_fmt','yuv420p',str(raw)],stdin=subprocess.PIPE)
            try:
                for frame_number in range(N):
                    t=frame_number/FPS
                    im=draw_scene(s,lang,t,D,footage,(s['start']+t)/at)
                    for a,b,x,y in cues:
                        if a<=t<b:add_caption(im,x,y)
                    encoder.stdin.write(im.convert('RGB').tobytes())
                encoder.stdin.close();assert encoder.wait()==0
            except BaseException:
                encoder.kill();encoder.wait();raise
            # Gentle warmth and consistent speech level; no time stretching of the voice.
            af='highpass=f=75,equalizer=f=180:t=q:w=0.8:g=1.6,acompressor=threshold=0.125:ratio=2.2:attack=12:release=150,loudnorm=I=-17:TP=-1.5:LRA=9,adelay=280|280,apad'
            run(['ffmpeg','-hide_banner','-loglevel','error','-y','-i',str(raw),'-i',s['audio'],'-map','0:v','-map','1:a','-c:v','copy','-af',af,'-c:a','aac','-ar','48000','-ac','2','-b:a','160k','-t',str(D),'-movflags','+faststart',str(target)])
            cache.write_text(fingerprint);scene_files.append(target)
            print(lang,sid,round(D,2),'s',flush=True)
        finally:
            for f in footage:f.close()
    if args.stills:return
    suffix='_intro' if args.preview else (f'_{args.only}' if args.only else '')
    final=BUILD/f'LLM_in_Work_demo_{lang}{suffix}.mp4'
    listing=out/'concat.txt';listing.write_text(''.join("file '"+str(p).replace("'","'\\''")+"'\n" for p in scene_files))
    music=out/'original-score.wav';score(music,at,timeline)
    run(['ffmpeg','-hide_banner','-loglevel','error','-y','-f','concat','-safe','0','-i',str(listing),'-i',str(music),'-filter_complex','[0:v]fps=30[v];[0:a]aresample=async=1:first_pts=0,asplit=2[voice][control];[1:a][control]sidechaincompress=threshold=0.025:ratio=5:attack=15:release=450[bed];[voice][bed]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.93[a]','-map','[v]','-map','[a]','-c:v','libx264','-threads','4','-preset','veryfast','-crf','19','-pix_fmt','yuv420p','-c:a','aac','-ar','48000','-ac','2','-b:a','160k','-t',str(at),'-movflags','+faststart',str(final)])
    (BUILD/f'LLM_in_Work_demo_{lang}{suffix}.srt').write_text('\n\n'.join(f'{i+1}\n{stamp(a)} --> {stamp(b)}\n{text}' for i,(a,b,text) in enumerate(all_cues))+'\n')
    (BUILD/f'timeline-{lang}{suffix}.json').write_text(json.dumps([{k:s[k] for k in ('id','chapter','start','duration','shots')} for s in timeline],ensure_ascii=False,indent=2)+'\n')
    if not args.preview and not args.only:
        bitrate=int((9.0*1024*1024*8)/duration(final)/1000)-64
        web=BUILD/f'LLM_in_Work_demo_{lang}_720p.mp4'
        for n in (1,2):
            run(['ffmpeg','-hide_banner','-loglevel','error','-y','-i',str(final),'-vf','scale=1280:720','-r','24','-c:v','libx264','-threads','4','-preset','fast','-b:v',f'{bitrate}k','-pass',str(n),'-passlogfile',str(out/'web-pass'),*(['-an','-f','null','/dev/null'] if n==1 else ['-c:a','aac','-b:a','64k','-movflags','+faststart',str(web)])])
    print('DONE',final,round(duration(final),2),flush=True)

if __name__=='__main__':main()
