(() => {
  'use strict';

  const $ = s => document.querySelector(s);
  const uiLang = () => document.documentElement.lang?.startsWith('en') ? 'en' : 'es';
  const tx = (es,en) => uiLang() === 'en' ? en : es;

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

  const state = {
    worker: null,
    pending: new Map(),
    nextId: 1,
    running: false,
    abort: false
  };

  function toast(message, ms=5000){
    const el = $('#toast');
    if(!el) return;
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(()=>el.classList.remove('show'), ms);
  }

  function locale(){ return localStorage.getItem('mpbook.speechLang') || $('#speechLang')?.value || 'es-ES'; }
  function providerFor(loc){ return loc.startsWith('en-') ? 'kokoro' : loc.startsWith('es-') ? 'piper' : null; }
  function naturalVoice(loc){
    const saved = localStorage.getItem(`mpbook.naturalVoice.${loc}`);
    const opts = VOICES[loc] || [];
    return saved && opts.some(([id])=>id===saved) ? saved : (opts[0]?.[0] || '');
  }
  function naturalVoiceLabel(loc, voice){ return (VOICES[loc] || []).find(([id])=>id===voice)?.[1] || voice; }
  function safeName(v){ return (v || 'MPBook').replace(/[\\/:*?"<>|]+/g,'-').replace(/\s+/g,' ').trim().slice(0,120); }
  function rate(){ return Number(localStorage.getItem('mpbook.rate') || 1); }

  function ensureWorker(){
    if(state.worker) return state.worker;
    const worker = new Worker('./tts-worker.js?v=15', {type:'module'});
    worker.onmessage = e => {
      const msg = e.data || {};
      const p = state.pending.get(msg.id);
      if(!p) return;
      if(msg.type === 'progress'){
        p.progress?.(msg.stage, msg.value);
        return;
      }
      state.pending.delete(msg.id);
      if(msg.type === 'result') p.resolve(msg.blob);
      else p.reject(new Error(msg.message || 'Local TTS error'));
    };
    worker.onerror = e => {
      const error = new Error(e?.message || tx('El motor local se cerró inesperadamente.','The local engine stopped unexpectedly.'));
      for(const [,p] of state.pending) p.reject(error);
      state.pending.clear();
      try{ worker.terminate(); }catch{}
      if(state.worker === worker) state.worker = null;
    };
    state.worker = worker;
    return worker;
  }

  function killWorker(){
    if(state.worker){ try{state.worker.terminate();}catch{} state.worker=null; }
    for(const [,p] of state.pending) p.reject(new Error('cancelled'));
    state.pending.clear();
  }

  function synth(text, loc, voice, progress){
    const provider = providerFor(loc);
    if(!provider) return Promise.reject(new Error(tx('Ese idioma no tiene voz natural local para exportar.','That language has no local natural voice for export.')));
    const id = state.nextId++;
    return new Promise((resolve,reject)=>{
      state.pending.set(id,{resolve,reject,progress});
      ensureWorker().postMessage({type:'synthesize',id,provider,text,voice,rate:rate()});
    });
  }

  async function currentBook(){
    if(window.MPBookCurrentBook?.chapters?.length) return window.MPBookCurrentBook;
    const title = $('#bookTitle')?.textContent?.trim();
    if(!title) return null;
    try{
      const db = await new Promise((resolve,reject)=>{
        const req=indexedDB.open('mpbook-library',1);
        req.onsuccess=()=>resolve(req.result); req.onerror=()=>reject(req.error);
      });
      const books = await new Promise((resolve,reject)=>{
        const req=db.transaction('books').objectStore('books').getAll();
        req.onsuccess=()=>resolve(req.result||[]); req.onerror=()=>reject(req.error);
      });
      return books.filter(b=>b.title===title).sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0))[0] || null;
    }catch(err){
      console.warn('MPBook export lookup failed',err);
      return null;
    }
  }

  async function exportItems(){
    const book = await currentBook();
    if(!book?.chapters?.length) return [];
    const scope = $('#exportScope')?.value || 'book';
    let chapters = book.chapters;
    if(scope === 'chapter'){
      const index = Number($('#chapterSelect')?.value || 0);
      chapters = book.chapters[index] ? [book.chapters[index]] : [];
    }
    return chapters.flatMap((c,ci)=>(c.segments||[]).filter(Boolean).map((text,si)=>({text,chapter:c.title,ci,si})));
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
      p += 8 + size + (size&1);
    }
    if(!fmt || dataOffset<0) throw new Error(tx('No se encontró PCM dentro del WAV.','No PCM audio was found in the WAV.'));
    return {...fmt,data:new Uint8Array(buffer,dataOffset,dataSize)};
  }
  function sameFormat(a,b){ return a.audioFormat===b.audioFormat && a.channels===b.channels && a.sampleRate===b.sampleRate && a.bitsPerSample===b.bitsPerSample; }
  function wavHeader(fmt,dataBytes){
    const out=new ArrayBuffer(44),v=new DataView(out),w=(o,s)=>{for(let i=0;i<s.length;i++)v.setUint8(o+i,s.charCodeAt(i));};
    const bps=fmt.bitsPerSample/8,align=fmt.channels*bps,byteRate=fmt.sampleRate*align;
    w(0,'RIFF');v.setUint32(4,36+dataBytes,true);w(8,'WAVE');w(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,fmt.audioFormat,true);v.setUint16(22,fmt.channels,true);v.setUint32(24,fmt.sampleRate,true);v.setUint32(28,byteRate,true);v.setUint16(32,align,true);v.setUint16(34,fmt.bitsPerSample,true);w(36,'data');v.setUint32(40,dataBytes,true);return new Uint8Array(out);
  }
  function silence(fmt,ms=100){
    const n=Math.floor(fmt.sampleRate*ms/1000)*fmt.channels*(fmt.bitsPerSample/8),b=new Uint8Array(n);
    if(fmt.audioFormat===1&&fmt.bitsPerSample===8)b.fill(128);
    return b;
  }

  async function createSink(){
    if(navigator.storage?.getDirectory){
      try{
        const root=await navigator.storage.getDirectory();
        const temp=`mpbook-export-${Date.now()}.wav`;
        const handle=await root.getFileHandle(temp,{create:true});
        const writable=await handle.createWritable();
        await writable.truncate(0); await writable.write(new Uint8Array(44));
        let pos=44;
        return {
          async write(bytes){ await writable.write({type:'write',position:pos,data:bytes}); pos+=bytes.byteLength; },
          async finish(header){ await writable.write({type:'write',position:0,data:header}); await writable.close(); const file=await handle.getFile(); try{await root.removeEntry(temp);}catch{} return file; },
          async abort(){ try{await writable.abort();}catch{} try{await root.removeEntry(temp);}catch{} }
        };
      }catch(err){ console.warn('OPFS export fallback',err); }
    }
    const parts=[new Uint8Array(44)];
    return {async write(bytes){parts.push(bytes);},async finish(header){parts[0]=header;return new Blob(parts,{type:'audio/wav'});},async abort(){parts.length=0;}};
  }

  function download(blob,name){
    const url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),20000);
  }

  function stageLabel(stage,value){
    if(stage==='loading-engine') return tx('cargando motor','loading engine');
    if(stage==='loading-model') return tx('cargando modelo','loading model');
    if(stage==='loading-voice') return tx('cargando voz','loading voice');
    if(stage==='downloading') return value==null?tx('descargando','downloading'):`${tx('descargando','downloading')} ${value}%`;
    if(stage==='synthesizing') return tx('generando','generating');
    return stage || '';
  }

  function updateProgress(i,total,detail=''){
    const pct=Math.max(0,Math.min(100,Math.round(i*100/Math.max(1,total))));
    if($('#exportBar')) $('#exportBar').style.width=`${pct}%`;
    if($('#exportStatus')) $('#exportStatus').textContent = total ? `${i}/${total} · ${pct}%${detail?` · ${detail}`:''}` : `${pct}%`;
  }

  function syncExportUI(){
    const method=$('#exportEngine')?.value || 'natural';
    const loc=locale();
    const voice=naturalVoice(loc);
    const info=$('#exportInfo'),start=$('#startExportBtn');
    if(method==='natural'){
      if(info) info.textContent = providerFor(loc)
        ? `${tx('Generación local, sin API.','Local generation, no API.')} ${tx('Idioma','Language')}: ${loc}. ${tx('Voz','Voice')}: ${naturalVoiceLabel(loc,voice)}. ${tx('El libro completo puede tardar bastante.','A full book can take a long time.')}`
        : tx('Este idioma no tiene motor natural local. Cambia el idioma en Ajustes de voz o usa OpenAI.','This language has no local natural engine. Change the language in Voice settings or use OpenAI.');
      if(start) start.textContent=tx('Generar WAV','Generate WAV');
    }else{
      if(info) info.textContent=tx('Exporta con OpenAI a MP3 usando la API key guardada en Ajustes de voz.','Export with OpenAI to MP3 using the API key saved in Voice settings.');
      if(start) start.textContent=tx('Generar MP3','Generate MP3');
    }
  }

  async function exportNatural(){
    const items=await exportItems();
    if(!items.length) throw new Error(tx('No hay texto para exportar.','There is no text to export.'));
    const loc=locale(), voice=naturalVoice(loc);
    if(!providerFor(loc) || !voice) throw new Error(tx('No hay una voz natural local disponible para este idioma.','No local natural voice is available for this language.'));

    const sink=await createSink();
    let fmt=null,dataBytes=0;
    try{
      for(let i=0;i<items.length;i++){
        if(state.abort) throw new Error('cancelled');
        updateProgress(i,items.length,tx('preparando','preparing'));
        const blob=await synth(items[i].text,loc,voice,(stage,value)=>updateProgress(i,items.length,stageLabel(stage,value)));
        const wav=await readWav(blob);
        if(!fmt) fmt={audioFormat:wav.audioFormat,channels:wav.channels,sampleRate:wav.sampleRate,bitsPerSample:wav.bitsPerSample};
        else if(!sameFormat(fmt,wav)) throw new Error(tx('El formato del audio cambió durante la exportación.','The audio format changed during export.'));
        await sink.write(wav.data); dataBytes+=wav.data.byteLength;
        if(i<items.length-1){const gap=silence(fmt);await sink.write(gap);dataBytes+=gap.byteLength;}
        if(dataBytes>0xFFFFFF00) throw new Error(tx('El archivo supera el límite de 4 GB de WAV.','The file exceeds the 4 GB WAV limit.'));
        updateProgress(i+1,items.length);
      }
      const out=await sink.finish(wavHeader(fmt,dataBytes));
      const scope=$('#exportScope')?.value==='chapter' ? `-${safeName($('#chapterSelect')?.selectedOptions?.[0]?.textContent||'capitulo')}` : '';
      download(out,`${safeName($('#bookTitle')?.textContent||'MPBook')}${scope}.wav`);
    }catch(err){
      await sink.abort();
      throw err;
    }
  }

  async function openaiBlob(text){
    const key=localStorage.getItem('mpbook.openaiKey') || '';
    if(!key) throw new Error(tx('Falta la OpenAI API key. Guárdala primero en Ajustes de voz.','OpenAI API key is missing. Save it first in Voice settings.'));
    const model=localStorage.getItem('mpbook.openaiModel') || 'gpt-4o-mini-tts';
    const voice=localStorage.getItem('mpbook.openaiVoice') || 'alloy';
    const res=await fetch('https://api.openai.com/v1/audio/speech',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({model,voice,input:text,response_format:'mp3',speed:Math.max(.25,Math.min(4,rate()))})});
    if(!res.ok){let msg=`OpenAI ${res.status}`;try{const j=await res.json();msg=j.error?.message||msg;}catch{}throw new Error(msg);}
    return res.blob();
  }

  async function exportOpenAI(){
    const items=await exportItems();
    if(!items.length) throw new Error(tx('No hay texto para exportar.','There is no text to export.'));
    const parts=[];
    for(let i=0;i<items.length;i++){
      if(state.abort) throw new Error('cancelled');
      updateProgress(i,items.length,tx('generando MP3','generating MP3'));
      parts.push(await openaiBlob(items[i].text));
      updateProgress(i+1,items.length);
    }
    const scope=$('#exportScope')?.value==='chapter' ? `-${safeName($('#chapterSelect')?.selectedOptions?.[0]?.textContent||'chapter')}` : '';
    download(new Blob(parts,{type:'audio/mpeg'}),`${safeName($('#bookTitle')?.textContent||'MPBook')}${scope}.mp3`);
  }

  async function startExport(){
    if(state.running) return;
    state.running=true;state.abort=false;
    const btn=$('#startExportBtn');if(btn)btn.disabled=true;
    updateProgress(0,0);
    try{
      speechSynthesis?.cancel?.();
      if(($('#exportEngine')?.value||'natural')==='openai') await exportOpenAI();
      else await exportNatural();
      updateProgress(1,1);
      toast(tx('Audiolibro generado.','Audiobook generated.'),5000);
    }catch(err){
      const msg=String(err?.message||err);
      if(msg!=='cancelled') toast(msg,7000);
    }finally{
      state.running=false;
      if(btn)btn.disabled=false;
    }
  }

  function cancelExport(){
    if(!state.running) return;
    state.abort=true;
    killWorker();
  }

  function install(){
    const dialog=$('#exportDialog');
    if(!dialog) return;

    const info=$('#exportInfo');
    if(info && !$('#exportOptions')){
      const wrap=document.createElement('div');
      wrap.id='exportOptions';
      wrap.className='form-grid';
      wrap.style.marginBottom='1rem';
      wrap.innerHTML=`
        <label><span id="exportEngineLabel">${tx('Motor de exportación','Export engine')}</span><select id="exportEngine"><option value="natural">${tx('Natural local (gratis) · WAV','Natural local (free) · WAV')}</option><option value="openai">OpenAI · MP3</option></select></label>
        <label><span id="exportScopeLabel">${tx('Alcance','Scope')}</span><select id="exportScope"><option value="book">${tx('Libro completo','Full book')}</option><option value="chapter">${tx('Capítulo actual','Current chapter')}</option></select></label>`;
      info.insertAdjacentElement('beforebegin',wrap);
    }

    $('#exportBtn')?.addEventListener('click',()=>{
      const preferred=(localStorage.getItem('mpbook.engine')==='openai')?'openai':'natural';
      if($('#exportEngine')) $('#exportEngine').value=preferred;
      updateProgress(0,0);syncExportUI();
    },true);
    $('#exportEngine')?.addEventListener('change',syncExportUI);

    $('#startExportBtn')?.addEventListener('click',e=>{
      e.preventDefault();e.stopImmediatePropagation();startExport();
    },true);
    $('#cancelExportBtn')?.addEventListener('click',()=>cancelExport(),true);
    $('#closeExportBtn')?.addEventListener('click',()=>cancelExport(),true);

    new MutationObserver(()=>{
      if($('#exportEngineLabel')) $('#exportEngineLabel').textContent=tx('Motor de exportación','Export engine');
      if($('#exportScopeLabel')) $('#exportScopeLabel').textContent=tx('Alcance','Scope');
      const engine=$('#exportEngine'),scope=$('#exportScope');
      if(engine){engine.options[0].textContent=tx('Natural local (gratis) · WAV','Natural local (free) · WAV');engine.options[1].textContent='OpenAI · MP3';}
      if(scope){scope.options[0].textContent=tx('Libro completo','Full book');scope.options[1].textContent=tx('Capítulo actual','Current chapter');}
      syncExportUI();
    }).observe(document.documentElement,{attributes:true,attributeFilter:['lang']});

    syncExportUI();
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',install,{once:true});
  else install();
})();