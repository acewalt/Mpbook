const LOCAL_ENGINE = 'natural';

const VOICES = {
  'es-MX': [
    ['es_MX-claude-high', 'Claude · alta calidad'],
    ['es_MX-ald-medium', 'ALD · calidad media']
  ],
  'es-ES': [
    ['es_ES-davefx-medium', 'DaveFX · calidad media'],
    ['es_ES-sharvard-medium', 'Sharvard · calidad media'],
    ['es_ES-mls_10246-low', 'MLS 10246 · ligera'],
    ['es_ES-mls_9972-low', 'MLS 9972 · ligera'],
    ['es_ES-carlfm-x_low', 'CarlFM · muy ligera']
  ],
  'en-US': [
    ['af_heart','Heart · Female'], ['af_bella','Bella · Female'], ['af_nicole','Nicole · Female'],
    ['af_sarah','Sarah · Female'], ['af_kore','Kore · Female'], ['af_aoede','Aoede · Female'],
    ['af_alloy','Alloy · Female'], ['af_nova','Nova · Female'], ['af_river','River · Female'],
    ['af_jessica','Jessica · Female'], ['af_sky','Sky · Female'], ['am_michael','Michael · Male'],
    ['am_fenrir','Fenrir · Male'], ['am_liam','Liam · Male'], ['am_eric','Eric · Male'],
    ['am_puck','Puck · Male'], ['am_onyx','Onyx · Male'], ['am_echo','Echo · Male'],
    ['am_adam','Adam · Male'], ['am_santa','Santa · Male']
  ],
  'en-GB': [
    ['bf_emma','Emma · Female'], ['bf_alice','Alice · Female'], ['bf_isabella','Isabella · Female'],
    ['bf_lily','Lily · Female'], ['bm_george','George · Male'], ['bm_fable','Fable · Male'],
    ['bm_daniel','Daniel · Male'], ['bm_lewis','Lewis · Male']
  ]
};

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const uiLang = () => document.documentElement.lang?.startsWith('en') ? 'en' : 'es';
const tx = (es,en) => uiLang() === 'en' ? en : es;

const runtime = {
  worker: null,
  nextRequestId: 1,
  pending: new Map(),
  playing: false,
  generating: false,
  audio: null,
  audioUrl: null,
  exporting: false,
  exportAbort: false
};

function toast(message, ms=4200){
  const el = $('#toast');
  if(!el) return;
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(()=>el.classList.remove('show'), ms);
}

function status(message=''){
  const el = $('#naturalStatus');
  if(el) el.textContent = message;
}

function currentEngine(){ return localStorage.getItem('mpbook.engine') || 'browser'; }
function currentLocale(){ return $('#speechLang')?.value || localStorage.getItem('mpbook.speechLang') || 'es-ES'; }
function savedLocale(){ return localStorage.getItem('mpbook.speechLang') || currentLocale(); }
function currentRate(){ return Number($('#rateInput')?.value || localStorage.getItem('mpbook.rate') || 1); }
function savedRate(){ return Number(localStorage.getItem('mpbook.rate') || 1); }
function currentText(){ return $('.segment.active')?.textContent?.trim() || ''; }
function safeName(v){ return (v || 'MPBook').replace(/[\\/:*?"<>|]+/g,'-').replace(/\s+/g,' ').trim().slice(0,120); }
function providerFor(locale){ return locale.startsWith('en-') ? 'kokoro' : locale.startsWith('es-') ? 'piper' : null; }
function voiceKey(locale){ return `mpbook.naturalVoice.${locale}`; }

function setPlaying(on){
  runtime.playing = on;
  const btn = $('#playBtn');
  if(btn){
    btn.textContent = on ? '❚❚' : '▶';
    btn.title = on ? tx('Detener','Stop') : tx('Reproducir','Play');
  }
}

function stopAudio(){
  if(runtime.audio){
    runtime.audio.onended = null;
    runtime.audio.onerror = null;
    runtime.audio.pause();
    runtime.audio.removeAttribute('src');
    try{ runtime.audio.load(); }catch{}
  }
  runtime.audio = null;
  if(runtime.audioUrl){ URL.revokeObjectURL(runtime.audioUrl); runtime.audioUrl = null; }
}

function killWorker(reason='cancelled'){
  if(runtime.worker){ runtime.worker.terminate(); runtime.worker = null; }
  for(const [,p] of runtime.pending){ p.reject(new Error(reason)); }
  runtime.pending.clear();
  runtime.generating = false;
}

function stopLocal(cancelGeneration=true){
  stopAudio();
  if(cancelGeneration && runtime.generating) killWorker('cancelled');
  setPlaying(false);
  if(!runtime.exporting) status('');
}

function stageText(stage, value){
  if(stage === 'loading-engine') return tx('Cargando motor local…','Loading local engine…');
  if(stage === 'loading-model') return tx('Preparando modelo natural…','Preparing natural model…');
  if(stage === 'loading-voice') return tx('Preparando voz…','Preparing voice…');
  if(stage === 'downloading') return value == null
    ? tx('Descargando modelo de voz…','Downloading voice model…')
    : `${tx('Descargando modelo de voz','Downloading voice model')}… ${value}%`;
  if(stage === 'synthesizing') return tx('Generando audio…','Generating audio…');
  return '';
}

function ensureWorker(){
  if(runtime.worker) return runtime.worker;
  const worker = new Worker('./tts-worker.js?v=6', { type:'module' });
  worker.onmessage = event => {
    const msg = event.data || {};
    const p = runtime.pending.get(msg.id);
    if(!p) return;
    if(msg.type === 'progress'){
      p.onProgress?.(msg.stage, msg.value);
      return;
    }
    runtime.pending.delete(msg.id);
    runtime.generating = runtime.pending.size > 0;
    if(msg.type === 'result') p.resolve(msg.blob);
    else if(msg.type === 'error') p.reject(new Error(msg.message || 'Local TTS error'));
  };
  worker.onerror = event => {
    const message = event?.message || tx('El motor local se cerró inesperadamente.','The local engine stopped unexpectedly.');
    for(const [,p] of runtime.pending) p.reject(new Error(message));
    runtime.pending.clear();
    runtime.generating = false;
    worker.terminate();
    if(runtime.worker === worker) runtime.worker = null;
  };
  runtime.worker = worker;
  return worker;
}

function synthBlob(text, locale, voice, rate, onProgress){
  const provider = providerFor(locale);
  if(!provider) return Promise.reject(new Error(tx('Este idioma todavía no tiene voz natural local.','This language does not have a local natural voice yet.')));
  const id = runtime.nextRequestId++;
  runtime.generating = true;
  return new Promise((resolve,reject)=>{
    runtime.pending.set(id,{resolve,reject,onProgress});
    ensureWorker().postMessage({type:'synthesize',id,provider,text,voice,rate});
  });
}

function optionsFor(locale){ return VOICES[locale] || []; }

function populateNaturalVoices(){
  const select = $('#naturalVoice');
  if(!select) return;
  const locale = currentLocale();
  const options = optionsFor(locale);
  const previous = localStorage.getItem(voiceKey(locale));

  if(!options.length){
    select.disabled = true;
    select.innerHTML = `<option value="">${tx('Sin voz natural local para este idioma','No local natural voice for this language')}</option>`;
    syncNaturalNote();
    return;
  }

  select.disabled = false;
  select.innerHTML = options.map(([id,label])=>`<option value="${id}">${label}</option>`).join('');
  if(previous && options.some(([id])=>id===previous)) select.value = previous;
  else select.value = options[0][0];
  syncNaturalNote();
}

function syncNaturalNote(){
  const note = $('#naturalNote');
  if(!note) return;
  const locale = currentLocale();
  if(locale.startsWith('en-')){
    note.textContent = tx(
      'Kokoro · voz neuronal local. Se descarga al usarla por primera vez. La síntesis corre en segundo plano para no congelar la página.',
      'Kokoro · local neural voice. It downloads on first use. Synthesis runs in the background so the page stays responsive.'
    );
  }else if(locale.startsWith('es-')){
    note.textContent = tx(
      'Piper · voz neuronal local. Se descarga al usarla por primera vez. La síntesis corre en segundo plano para no congelar la página.',
      'Piper · local neural voice. It downloads on first use. Synthesis runs in the background so the page stays responsive.'
    );
  }else{
    note.textContent = tx('Usa Navegador u OpenAI para este idioma.','Use Browser or OpenAI for this language.');
  }
}

function syncRows(){
  const engine = $('#engineSelect')?.value || 'browser';
  const natural = engine === LOCAL_ENGINE;
  const browser = engine === 'browser';
  const openai = engine === 'openai';

  if($('#naturalVoiceRow')) $('#naturalVoiceRow').hidden = !natural;
  if($('#browserVoiceRow')) $('#browserVoiceRow').hidden = !browser;
  if($('#apiKeyRow')) $('#apiKeyRow').hidden = !openai;
  if($('#modelRow')) $('#modelRow').hidden = !openai;
  if($('#openaiVoiceRow')) $('#openaiVoiceRow').hidden = !openai;
  if($('#pitchRow')) $('#pitchRow').hidden = !browser;

  if(natural) populateNaturalVoices();
}

function saveNaturalVoice(){
  if($('#engineSelect')?.value !== LOCAL_ENGINE) return;
  const voice = $('#naturalVoice')?.value;
  if(voice) localStorage.setItem(voiceKey(currentLocale()), voice);
}

function updateEngineBadge(){
  const badge = $('#engineBadge');
  if(!badge || currentEngine() !== LOCAL_ENGINE) return;
  badge.textContent = savedLocale().startsWith('en-') ? 'Kokoro' : 'Piper';
}

function hasNext(){
  const chapters = $('#chapterSelect');
  const segments = $('#segmentSelect');
  if(!chapters || !segments) return false;
  return segments.selectedIndex < segments.options.length-1 || chapters.selectedIndex < chapters.options.length-1;
}

async function speakNatural(text, autoNext=true, fromForm=false){
  if(!text) return;
  const locale = fromForm ? currentLocale() : savedLocale();
  const options = optionsFor(locale);
  let voice = fromForm ? ($('#naturalVoice')?.value || '') : (localStorage.getItem(voiceKey(locale)) || '');
  if(!voice && options.length) voice = options[0][0];
  if(!voice) return toast(tx('No hay una voz natural local disponible para ese idioma.','No local natural voice is available for that language.'));

  stopAudio();
  setPlaying(true);
  const rate = fromForm ? currentRate() : savedRate();
  status(tx('Iniciando voz natural…','Starting natural voice…'));

  try{
    const blob = await synthBlob(text, locale, voice, rate, (stage,value)=>status(stageText(stage,value)));
    if(!runtime.playing || runtime.exporting) return;
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    runtime.audioUrl = url;
    runtime.audio = audio;
    if(locale.startsWith('es-')) audio.playbackRate = rate;
    audio.onended = ()=>{
      stopAudio();
      if(autoNext && hasNext()){
        setPlaying(false);
        $('#nextBtn')?.click();
        setTimeout(()=>speakNatural(currentText(),true,false),60);
      }else{
        setPlaying(false);
        status('');
      }
    };
    audio.onerror = ()=>{
      stopAudio(); setPlaying(false); status('');
      toast(tx('El navegador no pudo reproducir el audio generado.','The browser could not play the generated audio.'));
    };
    status(tx('Reproduciendo','Playing'));
    await audio.play();
  }catch(err){
    if(String(err?.message||err)==='cancelled') return;
    console.error(err);
    setPlaying(false);
    status('');
    toast(`${tx('Error de voz local','Local voice error')}: ${String(err?.message || err)}`,7000);
  }
}

async function getCurrentBook(){
  const title = $('#bookTitle')?.textContent?.trim();
  if(!title) return null;
  try{
    const db = await new Promise((resolve,reject)=>{
      const r=indexedDB.open('mpbook-library',1);
      r.onsuccess=()=>resolve(r.result); r.onerror=()=>reject(r.error);
    });
    const books = await new Promise((resolve,reject)=>{
      const r=db.transaction('books').objectStore('books').getAll();
      r.onsuccess=()=>resolve(r.result||[]); r.onerror=()=>reject(r.error);
    });
    return books.filter(b=>b.title===title).sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0))[0] || null;
  }catch(err){ console.warn('MPBook export DB lookup failed',err); return null; }
}

async function collectBookChapters(){
  const book = await getCurrentBook();
  if(book?.chapters?.length) return book.chapters.map(c=>({title:c.title,segments:(c.segments||[]).filter(Boolean)}));
  const segments = $$('#readerText .segment').map(p=>p.textContent.trim()).filter(Boolean);
  return segments.length ? [{title:$('#nowChapter')?.textContent||'Chapter',segments}] : [];
}

function fourCC(v,o){ return String.fromCharCode(v.getUint8(o),v.getUint8(o+1),v.getUint8(o+2),v.getUint8(o+3)); }
async function readWav(blob){
  const buffer=await blob.arrayBuffer(), view=new DataView(buffer);
  if(buffer.byteLength<44 || fourCC(view,0)!=='RIFF' || fourCC(view,8)!=='WAVE') throw new Error(tx('El motor devolvió audio WAV inválido.','The engine returned invalid WAV audio.'));
  let fmt=null,dataOffset=-1,dataSize=0,p=12;
  while(p+8<=buffer.byteLength){
    const id=fourCC(view,p), size=view.getUint32(p+4,true);
    if(id==='fmt ' && size>=16) fmt={audioFormat:view.getUint16(p+8,true),channels:view.getUint16(p+10,true),sampleRate:view.getUint32(p+12,true),bitsPerSample:view.getUint16(p+22,true)};
    else if(id==='data'){dataOffset=p+8;dataSize=Math.min(size,buffer.byteLength-dataOffset);break;}
    p+=8+size+(size&1);
  }
  if(!fmt||dataOffset<0) throw new Error(tx('No se encontró PCM dentro del WAV.','No PCM audio was found in the WAV.'));
  return {...fmt,data:new Uint8Array(buffer,dataOffset,dataSize)};
}
function sameFormat(a,b){return a.audioFormat===b.audioFormat&&a.channels===b.channels&&a.sampleRate===b.sampleRate&&a.bitsPerSample===b.bitsPerSample;}
function wavHeader(fmt,dataBytes){
  const out=new ArrayBuffer(44),v=new DataView(out),w=(o,s)=>{for(let i=0;i<s.length;i++)v.setUint8(o+i,s.charCodeAt(i));};
  const bps=fmt.bitsPerSample/8,align=fmt.channels*bps,rate=fmt.sampleRate*align;
  w(0,'RIFF');v.setUint32(4,36+dataBytes,true);w(8,'WAVE');w(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,fmt.audioFormat,true);v.setUint16(22,fmt.channels,true);v.setUint32(24,fmt.sampleRate,true);v.setUint32(28,rate,true);v.setUint16(32,align,true);v.setUint16(34,fmt.bitsPerSample,true);w(36,'data');v.setUint32(40,dataBytes,true);return new Uint8Array(out);
}
function silence(fmt,ms=100){
  const n=Math.floor(fmt.sampleRate*ms/1000)*fmt.channels*(fmt.bitsPerSample/8),b=new Uint8Array(n);
  if(fmt.audioFormat===1&&fmt.bitsPerSample===8)b.fill(128);return b;
}
function download(blob,name){const u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),15000);}

function syncExportUI(){
  const info=$('#exportInfo'),start=$('#startExportBtn'); if(!info||!start)return;
  if(currentEngine()===LOCAL_ENGINE){
    info.textContent=tx('La voz natural se generará localmente en segundo plano y se exportará como WAV. Un libro muy largo puede tardar bastante.','The natural voice will be generated locally in the background and exported as WAV. A very long book can take a while.');
    start.textContent=tx('Generar WAV','Generate WAV');
  }else{
    info.textContent=tx('La exportación con OpenAI genera un MP3.','OpenAI export creates an MP3.');
    start.textContent=tx('Generar MP3','Generate MP3');
  }
}

async function exportNaturalBook(){
  if(runtime.exporting) return;
  const chapters=await collectBookChapters();
  const items=chapters.flatMap(c=>c.segments.map(text=>({text,chapter:c.title})));
  if(!items.length) return toast(tx('No hay texto para exportar.','There is no text to export.'));

  const locale=savedLocale(), options=optionsFor(locale);
  let voice=localStorage.getItem(voiceKey(locale)) || options[0]?.[0] || '';
  if(!voice) return toast(tx('Selecciona una voz natural primero.','Select a natural voice first.'));

  runtime.exporting=true; runtime.exportAbort=false; stopAudio(); setPlaying(false);
  const btn=$('#startExportBtn'),bar=$('#exportBar'),label=$('#exportStatus'); if(btn)btn.disabled=true;
  const parts=[new Uint8Array(44)]; let fmt=null,dataBytes=0;
  try{
    for(let i=0;i<items.length;i++){
      if(runtime.exportAbort) throw new Error(tx('Exportación cancelada.','Export cancelled.'));
      const pct=Math.round(i*100/items.length);
      if(bar)bar.style.width=`${pct}%`;
      if(label)label.textContent=`${tx('Generando','Generating')} ${i+1}/${items.length} · ${pct}%`;
      const blob=await synthBlob(items[i].text,locale,voice,savedRate(),(stage,value)=>status(`${tx('Exportando','Exporting')} ${i+1}/${items.length} · ${stageText(stage,value)}`));
      const wav=await readWav(blob);
      if(!fmt)fmt={audioFormat:wav.audioFormat,channels:wav.channels,sampleRate:wav.sampleRate,bitsPerSample:wav.bitsPerSample};
      else if(!sameFormat(fmt,wav))throw new Error(tx('El formato de audio cambió durante la exportación.','Audio format changed during export.'));
      parts.push(wav.data);dataBytes+=wav.data.byteLength;
      if(i<items.length-1){const gap=silence(fmt);parts.push(gap);dataBytes+=gap.byteLength;}
      if(dataBytes>0xFFFFFF00)throw new Error(tx('El WAV supera el límite de 4 GB. Exporta un libro más corto.','The WAV exceeds the 4 GB limit. Export a shorter book.'));
    }
    parts[0]=wavHeader(fmt,dataBytes);
    const out=new Blob(parts,{type:'audio/wav'});
    download(out,`${safeName($('#bookTitle')?.textContent||'MPBook')}.wav`);
    if(bar)bar.style.width='100%';if(label)label.textContent='100%';status('');toast(tx('Audiolibro WAV generado.','WAV audiobook generated.'),5000);
  }catch(err){
    if(String(err?.message||err)!=='cancelled')toast(String(err?.message||err),7000);
    status('');
  }finally{runtime.exporting=false;if(btn)btn.disabled=false;}
}

function install(){
  const engine=$('#engineSelect'),lang=$('#speechLang'),form=$('#settingsForm');
  if(!engine||!lang||!form)return;

  if(!engine.querySelector('option[value="natural"]')){
    const o=document.createElement('option');o.value='natural';o.textContent=tx('Natural local (gratis)','Natural local (free)');engine.insertBefore(o,engine.querySelector('option[value="openai"]'));
  }
  if(!$('#naturalVoiceRow')){
    const row=document.createElement('label');row.id='naturalVoiceRow';row.className='wide';row.hidden=true;row.innerHTML=`<span>${tx('Voz natural local','Local natural voice')}</span><select id="naturalVoice"></select><small id="naturalNote"></small><small id="naturalStatus" style="display:block;margin-top:.4rem"></small>`;$('#browserVoiceRow')?.insertAdjacentElement('afterend',row);
  }

  if(currentEngine()===LOCAL_ENGINE)engine.value=LOCAL_ENGINE;
  syncRows(); updateEngineBadge(); syncExportUI();

  engine.addEventListener('change',()=>setTimeout(syncRows,0));
  lang.addEventListener('change',()=>{if(engine.value===LOCAL_ENGINE)populateNaturalVoices();});
  $('#settingsBtn')?.addEventListener('click',()=>setTimeout(()=>{syncRows();if(engine.value===LOCAL_ENGINE)populateNaturalVoices();},0));
  form.addEventListener('submit',()=>{saveNaturalVoice();setTimeout(()=>{syncRows();updateEngineBadge();},0);});

  $('#playBtn')?.addEventListener('click',e=>{
    if(currentEngine()!==LOCAL_ENGINE)return;
    e.preventDefault();e.stopImmediatePropagation();
    if(runtime.playing)stopLocal(true);else speakNatural(currentText(),true,false);
  },true);

  $('#testVoiceBtn')?.addEventListener('click',e=>{
    if(engine.value!==LOCAL_ENGINE)return;
    e.preventDefault();e.stopImmediatePropagation();saveNaturalVoice();
    const phrase=currentLocale().startsWith('en-')?'Hello. This is a natural local voice test for MPBook.':'Hola. Esta es una prueba de voz natural local de MPBook.';
    if(runtime.playing)stopLocal(true);speakNatural(phrase,false,true);
  },true);

  for(const id of ['#chapterSelect','#segmentSelect','#readerText','#backBtn']){
    $(id)?.addEventListener(id==='#readerText'||id==='#backBtn'?'click':'change',()=>{if(runtime.playing)stopLocal(true);},true);
  }
  for(const id of ['#prevBtn','#nextBtn']){
    $(id)?.addEventListener('click',()=>{
      if(currentEngine()!==LOCAL_ENGINE||!runtime.playing)return;
      stopLocal(true);setTimeout(()=>speakNatural(currentText(),true,false),80);
    },true);
  }

  $('#exportBtn')?.addEventListener('click',()=>setTimeout(syncExportUI,0));
  $('#startExportBtn')?.addEventListener('click',e=>{
    if(currentEngine()!==LOCAL_ENGINE)return;
    e.preventDefault();e.stopImmediatePropagation();exportNaturalBook();
  },true);
  $('#cancelExportBtn')?.addEventListener('click',e=>{
    if(!runtime.exporting)return;runtime.exportAbort=true;killWorker('cancelled');e.preventDefault();e.stopImmediatePropagation();$('#exportDialog')?.close();
  },true);
  $('#closeExportBtn')?.addEventListener('click',()=>{if(runtime.exporting){runtime.exportAbort=true;killWorker('cancelled');}},true);

  const badge=$('#engineBadge');if(badge)new MutationObserver(updateEngineBadge).observe(badge,{childList:true});
  new MutationObserver(()=>{
    const opt=engine.querySelector('option[value="natural"]');if(opt)opt.textContent=tx('Natural local (gratis)','Natural local (free)');
    const label=$('#naturalVoiceRow > span');if(label)label.textContent=tx('Voz natural local','Local natural voice');
    syncNaturalNote();syncExportUI();
  }).observe(document.documentElement,{attributes:true,attributeFilter:['lang']});
}

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
