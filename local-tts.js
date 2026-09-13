const LOCAL_ENGINE = 'natural';
const KOKORO_MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';
const KOKORO_CDN = 'https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/+esm';
// This fork uses ONNX Runtime 1.22 and replaces the broken Cloudflare WASM URLs.
const PIPER_CDN = 'https://cdn.jsdelivr.net/npm/@realtimex/piper-tts-web@1.1.1/+esm';

const KOKORO_VOICES = {
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

const uiLang = () => document.documentElement.lang?.startsWith('en') ? 'en' : 'es';
const tx = (es,en) => uiLang() === 'en' ? en : es;
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

const runtime = {
  playing: false,
  audio: null,
  url: null,
  serial: 0,
  kokoro: null,
  kokoroPromise: null,
  piper: null,
  piperPromise: null,
  piperVoices: null,
  piperVoicesPromise: null,
  exporting: false,
  exportAbort: false,
};

function toast(message, ms=3500){
  const el = $('#toast');
  if(!el) return;
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(()=>el.classList.remove('show'), ms);
}

function status(message){
  const el = $('#naturalStatus');
  if(el) el.textContent = message || '';
}

function pct(progress){
  if(Number.isFinite(progress?.progress)) return Math.max(0, Math.min(100, Math.round(progress.progress)));
  if(progress?.total && Number.isFinite(progress?.loaded)) return Math.max(0, Math.min(100, Math.round(progress.loaded * 100 / progress.total)));
  return null;
}

function currentEngine(){ return localStorage.getItem('mpbook.engine') || 'browser'; }
function currentSpeechLang(){ return $('#speechLang')?.value || localStorage.getItem('mpbook.speechLang') || 'es-ES'; }
function savedSpeechLang(){ return localStorage.getItem('mpbook.speechLang') || currentSpeechLang(); }
function currentRate(){ return Number($('#rateInput')?.value || localStorage.getItem('mpbook.rate') || 1); }
function savedRate(){ return Number(localStorage.getItem('mpbook.rate') || currentRate() || 1); }
function currentText(){ return $('.segment.active')?.textContent?.trim() || ''; }
function safeName(v){ return (v || 'MPBook').replace(/[\\/:*?"<>|]+/g,'-').replace(/\s+/g,' ').trim().slice(0,120); }

function hasNext(){
  const chapter = $('#chapterSelect'), segment = $('#segmentSelect');
  if(!chapter || !segment) return false;
  return segment.selectedIndex < segment.options.length - 1 || chapter.selectedIndex < chapter.options.length - 1;
}

function setPlaying(on){
  runtime.playing = on;
  const btn = $('#playBtn');
  if(btn){
    btn.textContent = on ? '❚❚' : '▶';
    btn.title = on ? tx('Detener','Stop') : tx('Reproducir','Play');
  }
}

function stopAudioOnly(){
  if(runtime.audio){
    runtime.audio.onended = null;
    runtime.audio.onerror = null;
    runtime.audio.pause();
    runtime.audio.removeAttribute('src');
    runtime.audio.load?.();
  }
  runtime.audio = null;
  if(runtime.url){ URL.revokeObjectURL(runtime.url); runtime.url = null; }
}

function stopLocal(){
  runtime.serial++;
  stopAudioOnly();
  setPlaying(false);
  status('');
}

function localVoiceMode(locale=currentSpeechLang()){
  return locale.startsWith('en-') ? 'kokoro' : 'piper';
}

function voiceStorageKey(locale){
  return localVoiceMode(locale) === 'kokoro' ? `mpbook.kokoroVoice.${locale}` : `mpbook.piperVoice.${locale}`;
}

async function loadKokoro(){
  if(runtime.kokoro) return runtime.kokoro;
  if(runtime.kokoroPromise) return runtime.kokoroPromise;
  runtime.kokoroPromise = (async()=>{
    status(tx('Preparando Kokoro…','Preparing Kokoro…'));
    toast(tx('La primera vez se descargará el modelo natural.','The natural voice model will download on first use.'), 5000);
    const { KokoroTTS } = await import(KOKORO_CDN);
    const tts = await KokoroTTS.from_pretrained(KOKORO_MODEL, {
      dtype: 'q8',
      device: 'wasm',
      progress_callback: p => {
        const n = pct(p);
        status(n == null ? tx('Descargando modelo…','Downloading model…') : `${tx('Descargando modelo','Downloading model')}… ${n}%`);
      }
    });
    runtime.kokoro = tts;
    status(tx('Kokoro listo · funciona localmente','Kokoro ready · runs locally'));
    return tts;
  })().catch(err=>{ runtime.kokoroPromise=null; throw err; });
  return runtime.kokoroPromise;
}

async function loadPiper(){
  if(runtime.piper) return runtime.piper;
  if(runtime.piperPromise) return runtime.piperPromise;
  runtime.piperPromise = import(PIPER_CDN).then(mod=>{
    runtime.piper = mod;
    return mod;
  }).catch(err=>{ runtime.piperPromise=null; throw err; });
  return runtime.piperPromise;
}

async function piperCatalog(){
  if(runtime.piperVoices) return runtime.piperVoices;
  if(runtime.piperVoicesPromise) return runtime.piperVoicesPromise;
  runtime.piperVoicesPromise = (async()=>{
    status(tx('Cargando catálogo de voces…','Loading voice catalog…'));
    const piper = await loadPiper();
    const raw = await piper.voices();
    runtime.piperVoices = raw || {};
    status('');
    return runtime.piperVoices;
  })().catch(err=>{ runtime.piperVoicesPromise=null; throw err; });
  return runtime.piperVoicesPromise;
}

function piperLocalePrefix(locale){ return locale.replace('-','_') + '-'; }

async function voiceOptions(locale=currentSpeechLang()){
  if(locale.startsWith('en-')){
    const set = KOKORO_VOICES[locale] || KOKORO_VOICES['en-US'];
    return set.map(([id,label])=>({id,label,provider:'kokoro'}));
  }
  const catalog = await piperCatalog();
  const prefix = piperLocalePrefix(locale);
  const entries = Array.isArray(catalog)
    ? catalog.map(v=>[v.key || v.id || v.voiceId, v])
    : Object.entries(catalog);
  return entries
    .filter(([id])=>String(id || '').startsWith(prefix))
    .map(([id,meta])=>{
      const name = meta?.name || String(id).replace(prefix,'').replace(/-/g,' ');
      const quality = meta?.quality ? ` · ${meta.quality}` : '';
      return {id:String(id),label:`${name}${quality}`,provider:'piper'};
    });
}

async function populateNaturalVoices(){
  const select = $('#naturalVoice');
  if(!select) return;
  const locale = currentSpeechLang();
  select.disabled = true;
  select.innerHTML = `<option>${tx('Cargando voces…','Loading voices…')}</option>`;
  try{
    const options = await voiceOptions(locale);
    if(!options.length){
      select.innerHTML = `<option value="">${tx('No hay voz local para este idioma','No local voice for this language')}</option>`;
      return;
    }
    select.innerHTML = options.map(v=>`<option value="${v.id}">${v.label}</option>`).join('');
    const saved = localStorage.getItem(voiceStorageKey(locale));
    if(saved && options.some(v=>v.id===saved)) select.value = saved;
  }catch(err){
    console.error(err);
    select.innerHTML = `<option value="">${tx('No se pudieron cargar las voces','Could not load voices')}</option>`;
    status(tx('Error cargando el motor local','Local engine loading error'));
  }finally{
    select.disabled = false;
    syncNaturalNote();
  }
}

function syncNaturalNote(){
  const note = $('#naturalNote');
  if(!note) return;
  const locale = currentSpeechLang();
  if(locale.startsWith('en-')){
    note.textContent = tx('Kokoro · voz neuronal local. La primera vez descarga el modelo y después queda en caché.', 'Kokoro · local neural voice. The model downloads on first use and is cached afterwards.');
  }else{
    note.textContent = tx('Piper · voz neuronal local. La primera vez descarga la voz seleccionada y la guarda en el dispositivo.', 'Piper · local neural voice. The selected voice downloads on first use and is stored on the device.');
  }
}

function syncRows(){
  const engine = $('#engineSelect');
  if(!engine) return;
  const natural = engine.value === LOCAL_ENGINE;
  const browserRow = $('#browserVoiceRow');
  const pitchRow = $('#pitchRow');
  const localRow = $('#naturalVoiceRow');
  if(localRow) localRow.hidden = !natural;
  if(natural){
    if(browserRow) browserRow.hidden = true;
    if(pitchRow) pitchRow.hidden = true;
    populateNaturalVoices();
  }
}

async function makeNaturalBlob(text, locale, voice, rate=currentRate()){
  if(locale.startsWith('en-')){
    const tts = await loadKokoro();
    status(tx('Generando voz…','Generating voice…'));
    const out = await tts.generate(text, { voice, speed: rate });
    return out.toBlob();
  }
  const piper = await loadPiper();
  status(tx('Preparando voz local…','Preparing local voice…'));
  const blob = await piper.predict({ text, voiceId: voice }, p=>{
    const n = pct(p);
    if(n != null) status(`${tx('Descargando voz','Downloading voice')}… ${n}%`);
  });
  return blob;
}

async function speakNatural(text, autoNext=true, useFormValues=false){
  if(!text) return;
  const mySerial = ++runtime.serial;
  stopAudioOnly();
  setPlaying(true);
  const locale = useFormValues ? currentSpeechLang() : savedSpeechLang();
  let voice = useFormValues ? ($('#naturalVoice')?.value || '') : (localStorage.getItem(voiceStorageKey(locale)) || $('#naturalVoice')?.value || '');
  if(!voice){
    await populateNaturalVoices();
    voice = $('#naturalVoice')?.value || '';
  }
  if(!voice){ setPlaying(false); return toast(tx('No hay una voz local disponible para ese idioma.','No local voice is available for that language.')); }
  try{
    const rate = useFormValues ? currentRate() : savedRate();
    const blob = await makeNaturalBlob(text, locale, voice, rate);
    if(mySerial !== runtime.serial) return;
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    runtime.url = url;
    runtime.audio = audio;
    // Piper does not expose a synthesis-speed parameter in this wrapper, so playbackRate applies it at playback time.
    if(!locale.startsWith('en-')) audio.playbackRate = rate;
    audio.onended = ()=>{
      stopAudioOnly();
      if(autoNext && hasNext()){
        setPlaying(false);
        $('#nextBtn')?.click();
        setTimeout(()=>speakNatural(currentText(), true, false), 50);
      }else{
        setPlaying(false);
        status('');
      }
    };
    audio.onerror = ()=>{ stopAudioOnly(); setPlaying(false); toast(tx('No se pudo reproducir la voz local.','Could not play the local voice.')); };
    status(tx('Reproduciendo localmente','Playing locally'));
    await audio.play();
  }catch(err){
    console.error(err);
    if(mySerial === runtime.serial){
      setPlaying(false);
      status('');
      const raw = String(err?.message || err);
      const msg = raw.includes('available backend') || raw.includes('onnxruntime')
        ? tx('No se pudo iniciar el motor local. Recarga la página para usar la versión corregida del motor WASM.', 'The local engine could not start. Reload the page to use the corrected WASM engine.')
        : raw;
      toast(`${tx('Error de voz local','Local voice error')}: ${msg}`, 7000);
    }
  }
}

function ensureUI(){
  const engine = $('#engineSelect');
  if(!engine) return;
  if(!engine.querySelector(`option[value="${LOCAL_ENGINE}"]`)){
    const option = document.createElement('option');
    option.value = LOCAL_ENGINE;
    option.textContent = tx('Natural local (gratis)','Natural local (free)');
    engine.insertBefore(option, engine.querySelector('option[value="openai"]'));
  }

  const browserRow = $('#browserVoiceRow');
  if(browserRow && !$('#naturalVoiceRow')){
    const label = document.createElement('label');
    label.id = 'naturalVoiceRow';
    label.className = 'wide';
    label.hidden = true;
    label.innerHTML = `<span>${tx('Voz natural local','Local natural voice')}</span><select id="naturalVoice"></select><small id="naturalNote"></small><small id="naturalStatus" style="display:block;margin-top:.4rem"></small>`;
    browserRow.insertAdjacentElement('afterend', label);
  }
}

function updateEngineBadge(){
  const badge = $('#engineBadge');
  if(!badge || currentEngine() !== LOCAL_ENGINE) return;
  const wanted = savedSpeechLang().startsWith('en-') ? 'Kokoro' : 'Piper';
  if(badge.textContent !== wanted) badge.textContent = wanted;
}

function saveNaturalVoice(){
  if($('#engineSelect')?.value !== LOCAL_ENGINE) return;
  const locale = currentSpeechLang();
  const voice = $('#naturalVoice')?.value;
  if(voice) localStorage.setItem(voiceStorageKey(locale), voice);
}

function syncExportUI(){
  const info = $('#exportInfo');
  const start = $('#startExportBtn');
  if(!info || !start) return;
  if(currentEngine() === LOCAL_ENGINE){
    info.textContent = tx(
      'La voz natural se generará completamente en tu dispositivo. El resultado se exportará como WAV. En libros largos puede tardar bastante.',
      'The natural voice is generated entirely on your device. The result is exported as WAV. Long books can take a while.'
    );
    start.textContent = tx('Generar WAV','Generate WAV');
  }else{
    info.textContent = tx(
      'La exportación con OpenAI genera un MP3 con los fragmentos del libro.',
      'OpenAI export creates an MP3 from the book segments.'
    );
    start.textContent = tx('Generar MP3','Generate MP3');
  }
}

function collectBookSegments(){
  const chapterSelect = $('#chapterSelect');
  const segmentSelect = $('#segmentSelect');
  if(!chapterSelect) return [];
  const originalChapter = chapterSelect.value;
  const originalSegment = segmentSelect?.value || '0';
  const chapters = [];
  stopLocal();
  for(let i=0;i<chapterSelect.options.length;i++){
    chapterSelect.value = String(i);
    chapterSelect.dispatchEvent(new Event('change',{bubbles:true}));
    const title = chapterSelect.options[i]?.textContent?.trim() || `${tx('Capítulo','Chapter')} ${i+1}`;
    const segments = $$('#readerText .segment').map(p=>p.textContent.trim()).filter(Boolean);
    if(segments.length) chapters.push({title,segments});
  }
  chapterSelect.value = originalChapter;
  chapterSelect.dispatchEvent(new Event('change',{bubbles:true}));
  if(segmentSelect){
    segmentSelect.value = originalSegment;
    segmentSelect.dispatchEvent(new Event('change',{bubbles:true}));
  }
  return chapters;
}

function fourCC(view, offset){
  return String.fromCharCode(view.getUint8(offset),view.getUint8(offset+1),view.getUint8(offset+2),view.getUint8(offset+3));
}

async function readWav(blob){
  const buffer = await blob.arrayBuffer();
  const view = new DataView(buffer);
  if(buffer.byteLength < 44 || fourCC(view,0)!=='RIFF' || fourCC(view,8)!=='WAVE') throw new Error(tx('El motor devolvió audio WAV inválido.','The engine returned invalid WAV audio.'));
  let fmt = null, dataOffset = -1, dataSize = 0, p = 12;
  while(p + 8 <= buffer.byteLength){
    const id = fourCC(view,p);
    const size = view.getUint32(p+4,true);
    if(id === 'fmt ' && size >= 16){
      fmt = {
        audioFormat:view.getUint16(p+8,true),
        channels:view.getUint16(p+10,true),
        sampleRate:view.getUint32(p+12,true),
        bitsPerSample:view.getUint16(p+22,true)
      };
    }else if(id === 'data'){
      dataOffset = p + 8;
      dataSize = Math.min(size, buffer.byteLength-dataOffset);
      break;
    }
    p += 8 + size + (size & 1);
  }
  if(!fmt || dataOffset < 0) throw new Error(tx('No se encontró audio PCM dentro del WAV.','No PCM audio was found inside the WAV.'));
  return { ...fmt, data:new Uint8Array(buffer,dataOffset,dataSize) };
}

function makeWavHeader(fmt, dataBytes){
  const out = new ArrayBuffer(44);
  const v = new DataView(out);
  const write = (o,s)=>{ for(let i=0;i<s.length;i++) v.setUint8(o+i,s.charCodeAt(i)); };
  const bytesPerSample = fmt.bitsPerSample / 8;
  const blockAlign = fmt.channels * bytesPerSample;
  const byteRate = fmt.sampleRate * blockAlign;
  write(0,'RIFF'); v.setUint32(4,36+dataBytes,true); write(8,'WAVE');
  write(12,'fmt '); v.setUint32(16,16,true); v.setUint16(20,fmt.audioFormat,true);
  v.setUint16(22,fmt.channels,true); v.setUint32(24,fmt.sampleRate,true); v.setUint32(28,byteRate,true);
  v.setUint16(32,blockAlign,true); v.setUint16(34,fmt.bitsPerSample,true);
  write(36,'data'); v.setUint32(40,dataBytes,true);
  return new Uint8Array(out);
}

function sameFormat(a,b){
  return a.audioFormat===b.audioFormat && a.channels===b.channels && a.sampleRate===b.sampleRate && a.bitsPerSample===b.bitsPerSample;
}

async function createWavSink(){
  if(navigator.storage?.getDirectory){
    try{
      const root = await navigator.storage.getDirectory();
      const tempName = `mpbook-export-${Date.now()}.wav`;
      const handle = await root.getFileHandle(tempName,{create:true});
      const writable = await handle.createWritable();
      await writable.truncate(0);
      await writable.write(new Uint8Array(44));
      let position = 44;
      return {
        async write(bytes){ await writable.write({type:'write',position,data:bytes}); position += bytes.byteLength; },
        async finish(header){ await writable.write({type:'write',position:0,data:header}); await writable.close(); const file=await handle.getFile(); try{ await root.removeEntry(tempName); }catch{} return file; },
        async abort(){ try{ await writable.abort(); }catch{} try{ await root.removeEntry(tempName); }catch{} }
      };
    }catch(err){ console.warn('OPFS export fallback',err); }
  }
  const parts = [new Uint8Array(44)];
  return {
    async write(bytes){ parts.push(bytes); },
    async finish(header){ parts[0]=header; return new Blob(parts,{type:'audio/wav'}); },
    async abort(){ parts.length=0; }
  };
}

function silenceBytes(fmt, milliseconds=120){
  const bytesPerSample = fmt.bitsPerSample / 8;
  const count = Math.floor(fmt.sampleRate * milliseconds / 1000) * fmt.channels * bytesPerSample;
  const bytes = new Uint8Array(count);
  if(fmt.audioFormat===1 && fmt.bitsPerSample===8) bytes.fill(128);
  return bytes;
}

function downloadBlob(blob, filename){
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),15000);
}

async function exportNaturalBook(){
  if(runtime.exporting) return;
  const chapters = collectBookSegments();
  const items = chapters.flatMap((c,ci)=>c.segments.map((text,si)=>({text,ci,si})));
  if(!items.length) return toast(tx('No hay texto para exportar.','There is no text to export.'));

  const locale = savedSpeechLang();
  let voice = localStorage.getItem(voiceStorageKey(locale)) || $('#naturalVoice')?.value || '';
  if(!voice){
    await populateNaturalVoices();
    voice = $('#naturalVoice')?.value || '';
  }
  if(!voice) return toast(tx('Selecciona una voz natural primero.','Select a natural voice first.'));

  runtime.exporting = true;
  runtime.exportAbort = false;
  const button = $('#startExportBtn');
  const bar = $('#exportBar');
  const label = $('#exportStatus');
  if(button) button.disabled = true;
  let sink = null;
  try{
    sink = await createWavSink();
    let fmt = null;
    let dataBytes = 0;
    const rate = savedRate();
    for(let i=0;i<items.length;i++){
      if(runtime.exportAbort) throw new Error(tx('Exportación cancelada.','Export cancelled.'));
      const percent = Math.round(i * 100 / items.length);
      if(bar) bar.style.width = `${percent}%`;
      if(label) label.textContent = `${tx('Generando','Generating')} ${i+1}/${items.length} · ${percent}%`;
      status(`${tx('Exportando audiolibro','Exporting audiobook')} · ${i+1}/${items.length}`);
      const blob = await makeNaturalBlob(items[i].text, locale, voice, rate);
      const wav = await readWav(blob);
      if(!fmt) fmt = {audioFormat:wav.audioFormat,channels:wav.channels,sampleRate:wav.sampleRate,bitsPerSample:wav.bitsPerSample};
      else if(!sameFormat(fmt,wav)) throw new Error(tx('La voz cambió de formato durante la exportación.','The voice audio format changed during export.'));
      await sink.write(wav.data);
      dataBytes += wav.data.byteLength;
      if(i < items.length-1){
        const gap = silenceBytes(fmt,120);
        await sink.write(gap);
        dataBytes += gap.byteLength;
      }
      if(dataBytes > 0xFFFFFF00) throw new Error(tx('El audiolibro supera el límite de 4 GB del formato WAV.','The audiobook exceeds the 4 GB WAV format limit.'));
    }
    const header = makeWavHeader(fmt,dataBytes);
    const file = await sink.finish(header);
    sink = null;
    downloadBlob(file, `${safeName($('#bookTitle')?.textContent || 'MPBook')}.wav`);
    if(bar) bar.style.width='100%';
    if(label) label.textContent='100%';
    status('');
    toast(tx('Audiolibro WAV generado.','WAV audiobook generated.'),5000);
  }catch(err){
    console.error(err);
    if(sink) await sink.abort();
    status('');
    toast(err?.message || tx('No se pudo exportar el audio.','Could not export audio.'),7000);
  }finally{
    runtime.exporting=false;
    if(button) button.disabled=false;
  }
}

function install(){
  ensureUI();
  const engine = $('#engineSelect');
  const speechLang = $('#speechLang');
  const settingsForm = $('#settingsForm');
  const settingsBtn = $('#settingsBtn');
  const playBtn = $('#playBtn');
  const testBtn = $('#testVoiceBtn');

  engine?.addEventListener('change', ()=>setTimeout(syncRows));
  speechLang?.addEventListener('change', ()=>{ if(engine?.value === LOCAL_ENGINE) populateNaturalVoices(); });
  settingsBtn?.addEventListener('click', ()=>setTimeout(()=>{ syncRows(); if(engine?.value===LOCAL_ENGINE) populateNaturalVoices(); },0));
  settingsForm?.addEventListener('submit', ()=>{ saveNaturalVoice(); setTimeout(updateEngineBadge,0); });

  playBtn?.addEventListener('click', e=>{
    if(currentEngine() !== LOCAL_ENGINE) return;
    e.preventDefault(); e.stopImmediatePropagation();
    if(runtime.playing) stopLocal(); else speakNatural(currentText(),true,false);
  },true);

  testBtn?.addEventListener('click', e=>{
    if(engine?.value !== LOCAL_ENGINE) return;
    e.preventDefault(); e.stopImmediatePropagation();
    saveNaturalVoice();
    const phrase = currentSpeechLang().startsWith('en-')
      ? 'Hello. This is a natural local voice test for MPBook.'
      : 'Hola. Esta es una prueba de voz natural local de MPBook.';
    if(runtime.playing) stopLocal();
    speakNatural(phrase,false,true);
  },true);

  for(const sel of ['#chapterSelect','#segmentSelect','#readerText']){
    $(sel)?.addEventListener(sel==='#readerText'?'click':'change', ()=>{ if(runtime.playing) stopLocal(); },true);
  }
  $('#backBtn')?.addEventListener('click', ()=>{ if(runtime.playing) stopLocal(); },true);

  for(const id of ['#prevBtn','#nextBtn']){
    $(id)?.addEventListener('click', ()=>{
      if(currentEngine() !== LOCAL_ENGINE || !runtime.playing) return;
      stopLocal();
      setTimeout(()=>speakNatural(currentText(),true,false),60);
    },true);
  }

  $('#exportBtn')?.addEventListener('click', ()=>setTimeout(syncExportUI,0));
  $('#startExportBtn')?.addEventListener('click', e=>{
    if(currentEngine() !== LOCAL_ENGINE) return;
    e.preventDefault(); e.stopImmediatePropagation();
    exportNaturalBook();
  },true);
  $('#cancelExportBtn')?.addEventListener('click', e=>{
    if(!runtime.exporting) return;
    runtime.exportAbort=true;
    e.preventDefault(); e.stopImmediatePropagation();
    $('#exportDialog')?.close();
  },true);
  $('#closeExportBtn')?.addEventListener('click', ()=>{ if(runtime.exporting) runtime.exportAbort=true; },true);

  const badge = $('#engineBadge');
  if(badge) new MutationObserver(updateEngineBadge).observe(badge,{childList:true});
  new MutationObserver(()=>{
    const option = engine?.querySelector(`option[value="${LOCAL_ENGINE}"]`);
    if(option) option.textContent = tx('Natural local (gratis)','Natural local (free)');
    const label = $('#naturalVoiceRow > span');
    if(label) label.textContent = tx('Voz natural local','Local natural voice');
    syncNaturalNote();
    syncExportUI();
  }).observe(document.documentElement,{attributes:true,attributeFilter:['lang']});

  if(currentEngine() === LOCAL_ENGINE && engine) engine.value = LOCAL_ENGINE;
  syncRows();
  syncExportUI();
  updateEngineBadge();
}

if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded',install,{once:true});
else install();
