// Render code-native promotional diagrams with the existing project icons.
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('../../LLM_in_PDF/node_modules/playwright-core');
const root=path.resolve(__dirname,'../..');
function graphic(slug,wide){
 const green=slug==='overleaf',accent=green?'#97f0c3':'#b8b1ff',bg=green?'#0b332c':'#22184a';
 const title=green?'LLM_in_Overleaf':'LLM_in_PDF';
 const terminal=`<rect x="0" y="0" width="178" height="124" rx="16" fill="#112124" stroke="${accent}" stroke-width="2"/><circle cx="20" cy="20" r="4" fill="${accent}"/><circle cx="34" cy="20" r="4" fill="#667b83"/><circle cx="48" cy="20" r="4" fill="#667b83"/><path d="M22 53l13 11-13 11m26 0h42" stroke="${accent}" stroke-width="5" fill="none"/><rect x="22" y="96" width="90" height="4" rx="2" fill="#718c91"/>`;
 const doc=`<rect x="0" y="0" width="192" height="228" rx="18" fill="#fcfcf6"/><rect x="22" y="24" width="82" height="8" rx="4" fill="#83978d"/><rect x="22" y="52" width="147" height="6" rx="3" fill="#c7d2cb"/><rect x="15" y="75" width="162" height="76" rx="8" fill="${green?'#d7f5e5':'#e7e3ff'}" stroke="${green?'#17975a':'#7963de'}" stroke-width="2"/><rect x="28" y="91" width="117" height="6" rx="3" fill="${green?'#c67272':'#a198cf'}"/><rect x="28" y="112" width="133" height="6" rx="3" fill="${green?'#139264':'#6451b5'}"/><rect x="28" y="133" width="86" height="5" rx="2" fill="${green?'#139264':'#6451b5'}"/><rect x="22" y="176" width="146" height="5" rx="2" fill="#c7d2cb"/><rect x="22" y="194" width="102" height="5" rx="2" fill="#c7d2cb"/>`;
 const diagram=`<g transform="translate(0,57)">${terminal}</g><path d="M189 115 C232 115 216 44 258 44" fill="none" stroke="${accent}" stroke-width="5"/><path d="M246 34l15 10-15 10" fill="none" stroke="${accent}" stroke-width="5"/><g transform="translate(280,0)">${doc}</g><circle cx="430" cy="209" r="26" fill="${accent}"/><path d="${green?'M417 209l9 9 17-20':'M420 200h20v14h-12l-8 6z'}" fill="none" stroke="${bg}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`;
 return `<!doctype html><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;background:${bg};color:#fbfff9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;overflow:hidden}svg{display:block}h1{letter-spacing:-1.5px;margin:0;font-weight:650}</style>${wide?`<div style="position:absolute;left:72px;top:62px;font-size:29px;color:${accent};font-weight:600">${title}</div><h1 style="position:absolute;left:72px;top:143px;font-size:66px;line-height:1.13">${green?'Your agent.<br>In your workflow.':'Read papers.<br>Ask in Chrome.'}</h1><div style="position:absolute;left:75px;top:346px;font-size:25px;color:${accent}">Claude Code · Codex</div><div style="position:absolute;left:75px;top:409px;font-size:23px;color:#c4d0d0">${green?'Select. Review. Apply.':'Local PDFs · arXiv · Selected passages'}</div><svg width="570" height="360" viewBox="-15 -35 510 300" style="position:absolute;left:770px;top:98px">${diagram}</svg>`:`<div style="height:65px;padding:24px 24px 0;font-size:28px;font-weight:650;letter-spacing:-.8px;color:${accent}">${title}</div><svg width="392" height="200" viewBox="-5 -12 490 245" style="margin:0 24px">${diagram}</svg>`}`;
}
(async()=>{
 const browser=await chromium.launch({channel:'chromium',headless:true});
 try{
  for(const slug of ['overleaf','pdf']){
   const dest=path.join(__dirname,slug,'assets');fs.mkdirSync(dest,{recursive:true});
   const project=slug==='overleaf'?'LLM_in_Overleaf':'LLM_in_PDF';
   fs.copyFileSync(path.join(root,project,'extension/icons/icon128.png'),path.join(dest,'icon-128.png'));
   for(const [wide,width,height,name] of [[false,440,280,'small-promo-440x280.png'],[true,1400,560,'marquee-1400x560.png']]){
    const page=await browser.newPage({viewport:{width,height},deviceScaleFactor:1});
    await page.setContent(graphic(slug,wide));
    await page.evaluate(()=>document.fonts.ready);
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    await page.screenshot({path:path.join(dest,name)});
    await page.close();
   }
  }
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
