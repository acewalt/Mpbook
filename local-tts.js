const LOCAL_ENGINE = 'natural';
const KOKORO_MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';
const KOKORO_CDN = 'https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/+esm';
const PIPER_CDN = 'https://cdn.jsdelivr.net/npm/@mintplex-labs/piper-tts-web@1.0.5/+esm';

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

const lang = () => document.documentElement.lang?.startsWith('en') ? 'en' : 'es';
const tx = (es,en) => lang() === 'en' ? en : es;
const $ = (s) => document.querySelector(s);

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
function currentRate(){ return Number($('#rateInput')?.value || localStorage.getItem('mpbook.rate') || 1); }
function currentText(){ return $('.segment.active')?.textContent?.trim() || ''; }
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

function stopLocal(){
  runtime.serial++;
  if(runtime.audio){
    runtime.audio.onended = null;
    runtime.audio.onerror = null;
    runtime.audio.pause();
    runtime.audio.removeAttribute('src');
    runtime.audio.load?.();
  }
  runtime.audio = null;
  if(runtime.url){ URL.revokeObjectURL(runtime.url); runtime.url = null; }
  setPlaying(false);
  status('');
}

function localVoiceMode(speechLang=currentSpeechLang()){
  return speechLang.startsWith('en-') ? 'kokoro' : 'piper';
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
    const key = localVoiceMode(locale) === 'kokoro' ? 'mpbook.kokoroVoice' : `mpbook.piperVoice.${locale}`;
    const saved = localStorage.getItem(key);
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

async function makeNaturalBlob(text, locale, voice){
  if(locale.startsWith('en-')){
    const tts = await loadKokoro();
    status(tx('Generando voz…','Generating voice…'));
    const out = await tts.generate(text, { voice, speed: currentRate() });
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
  const locale = useFormValues ? currentSpeechLang() : (localStorage.getItem('mpbook.speechLang') || currentSpeechLang());
  const voiceSelect = $('#naturalVoice');
  let voice = voiceSelect?.value || '';
  if(!useFormValues){
    const key = locale.startsWith('en-') ? 'mpbook.kokoroVoice' : `mpbook.piperVoice.${locale}`;
    voice = localStorage.getItem(key) || voice;
  }
  if(!voice){
    await populateNaturalVoices();
    voice = $('#naturalVoice')?.value || '';
  }
  if(!voice){ setPlaying(false); return toast(tx('No hay una voz local disponible para ese idioma.','No local voice is available for that language.')); }
  try{
    const blob = await makeNaturalBlob(text, locale, voice);
    if(mySerial !== runtime.serial) return;
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    runtime.url = url;
    runtime.audio = audio;
    if(!locale.startsWith('en-')) audio.playbackRate = currentRate();
    audio.onended = ()=>{
      cleanupAudio();
      if(autoNext && hasNext()){
        setPlaying(false);
        $('#nextBtn')?.click();
        setTimeout(()=>speakNatural(currentText(), true, false), 40);
      }else{
        setPlaying(false);
        status('');
      }
    };
    audio.onerror = ()=>{ cleanupAudio(); setPlaying(false); toast(tx('No se pudo reproducir la voz local.','Could not play the local voice.')); };
    status(tx('Reproduciendo localmente','Playing locally'));
    await audio.play();
  }catch(err){
    console.error(err);
    if(mySerial === runtime.serial){
      setPlaying(false);
      status('');
      toast(`${tx('Error de voz local','Local voice error')}: ${err?.message || err}` , 6000);
    }
  }
}

function stopAudioOnly(){
  if(runtime.audio){
    runtime.audio.onended = null;
    runtime.audio.onerror = null;
    runtime.audio.pause();
  }
  runtime.audio = null;
  if(runtime.url){ URL.revokeObjectURL(runtime.url); runtime.url = null; }
}

function cleanupAudio(){ stopAudioOnly(); }

function ensureUI(){
  const engine = $('#engineSelect');
  if(!engine || engine.querySelector(`option[value="${LOCAL_ENGINE}"]`)) return;
  const option = document.createElement('option');
  option.value = LOCAL_ENGINE;
  option.textContent = tx('Natural local (gratis)','Natural local (free)');
  engine.insertBefore(option, engine.querySelector('option[value="openai"]'));

  const grid = engine.closest('.form-grid');
  const browserRow = $('#browserVoiceRow');
  if(grid && browserRow){
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
  if(!badge) return;
  if(currentEngine() === LOCAL_ENGINE){
    const wanted = currentSpeechLang().startsWith('en-') ? 'Kokoro' : 'Piper';
    if(badge.textContent !== wanted) badge.textContent = wanted;
  }
}

function saveNaturalVoice(){
  if($('#engineSelect')?.value !== LOCAL_ENGINE) return;
  const locale = currentSpeechLang();
  const voice = $('#naturalVoice')?.value;
  if(!voice) return;
  const key = locale.startsWith('en-') ? 'mpbook.kokoroVoice' : `mpbook.piperVoice.${locale}`;
  localStorage.setItem(key, voice);
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
  speechLang?.addEventListener('change', ()=>{
    if(engine?.value === LOCAL_ENGINE) populateNaturalVoices();
  });
  settingsBtn?.addEventListener('click', ()=>setTimeout(()=>{ syncRows(); if(engine?.value===LOCAL_ENGINE) populateNaturalVoices(); }, 0));
  settingsForm?.addEventListener('submit', ()=>{
    saveNaturalVoice();
    setTimeout(updateEngineBadge, 0);
  });

  playBtn?.addEventListener('click', e=>{
    if(currentEngine() !== LOCAL_ENGINE) return;
    e.preventDefault(); e.stopImmediatePropagation();
    if(runtime.playing) stopLocal();
    else speakNatural(currentText(), true, false);
  }, true);

  testBtn?.addEventListener('click', e=>{
    if(engine?.value !== LOCAL_ENGINE) return;
    e.preventDefault(); e.stopImmediatePropagation();
    saveNaturalVoice();
    const phrase = currentSpeechLang().startsWith('en-')
      ? 'Hello. This is a natural local voice test for MPBook.'
      : 'Hola. Esta es una prueba de voz natural local de MPBook.';
    if(runtime.playing) stopLocal();
    speakNatural(phrase, false, true);
  }, true);

  for(const sel of ['#chapterSelect','#segmentSelect','#readerText']){
    $(sel)?.addEventListener(sel === '#readerText' ? 'click' : 'change', ()=>{ if(runtime.playing) stopLocal(); }, true);
  }
  $('#backBtn')?.addEventListener('click', ()=>{ if(runtime.playing) stopLocal(); }, true);

  for(const id of ['#prevBtn','#nextBtn']){
    $(id)?.addEventListener('click', ()=>{
      if(currentEngine() !== LOCAL_ENGINE || !runtime.playing) return;
      stopLocal();
      setTimeout(()=>speakNatural(currentText(), true, false), 60);
    }, true);
  }

  const badge = $('#engineBadge');
  if(badge) new MutationObserver(updateEngineBadge).observe(badge,{childList:true});

  new MutationObserver(()=>{
    const option = engine?.querySelector(`option[value="${LOCAL_ENGINE}"]`);
    if(option) option.textContent = tx('Natural local (gratis)','Natural local (free)');
    const label = $('#naturalVoiceRow > span');
    if(label) label.textContent = tx('Voz natural local','Local natural voice');
    syncNaturalNote();
  }).observe(document.documentElement,{attributes:true,attributeFilter:['lang']});

  if(currentEngine() === LOCAL_ENGINE && engine) engine.value = LOCAL_ENGINE;
  syncRows();
  updateEngineBadge();
}

if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, {once:true});
else install();
