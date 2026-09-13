(() => {
  'use strict';

  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const esc = v => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  const I18N={
    es:{subtitle:'EPUB a audiolibro',library:'Biblioteca',voiceSettings:'Ajustes de voz',theme:'Tema',heroTitle:'Convierte tus libros en audio.',heroText:'Abre un EPUB, Markdown o TXT. El libro se procesa localmente en tu navegador y puedes escucharlo con la voz del sistema, una voz natural local o con OpenAI.',dropTitle:'Suelta tu libro aquí',dropText:'o toca para elegir un archivo',or:'o',quickText:'Texto rápido',pasteTitle:'Pega texto para escucharlo',pastePlaceholder:'Pega aquí el texto que quieres convertir en audio...',loadText:'Cargar texto',home:'Inicio',exportAudio:'Exportar audio',chapter:'Capítulo',segment:'Fragmento',previous:'Anterior',play:'Reproducir',next:'Siguiente',audio:'Audio',engine:'Motor de voz',browserVoice:'Navegador (gratis)',speechLanguage:'Idioma de lectura',voice:'Voz',keyPrivacy:'La clave se guarda solo en este navegador.',model:'Modelo',speed:'Velocidad',pitch:'Tono',testVoice:'Probar voz',save:'Guardar',emptyLibrary:'Todavía no has cargado ningún libro.',export:'Exportar',cancel:'Cancelar',textBook:'Texto pegado',segments:'fragmentos',chapters:'capítulos',loaded:'Libro cargado',badFile:'No pude leer ese archivo.',unsupported:'Formato no compatible.',needText:'Pega algún texto primero.',settingsSaved:'Ajustes guardados.',needKey:'Añade tu OpenAI API key en Ajustes de voz.',voiceError:'No se pudo generar el audio.',emptyChapter:'Este capítulo no contiene texto legible.',libraryOpened:'Libro abierto desde la biblioteca.',remove:'Eliminar',open:'Abrir',processing:'Procesando…',epubError:'No pude interpretar este EPUB. Puede estar protegido con DRM o usar una estructura no compatible.',testPhrase:'Hola. Esta es una prueba de voz de MPBook.',deleteConfirm:'¿Eliminar este libro de la biblioteca?',noVoices:'No hay voces compatibles disponibles.',noBook:'Carga un libro primero.',loadingBook:'Abriendo libro…'},
    en:{subtitle:'EPUB to audiobook',library:'Library',voiceSettings:'Voice settings',theme:'Theme',heroTitle:'Turn your books into audio.',heroText:'Open an EPUB, Markdown or TXT file. The book is processed locally in your browser and can be read with a system voice, a local natural voice, or OpenAI.',dropTitle:'Drop your book here',dropText:'or tap to choose a file',or:'or',quickText:'Quick text',pasteTitle:'Paste text to listen',pastePlaceholder:'Paste the text you want to turn into audio...',loadText:'Load text',home:'Home',exportAudio:'Export audio',chapter:'Chapter',segment:'Segment',previous:'Previous',play:'Play',next:'Next',audio:'Audio',engine:'Voice engine',browserVoice:'Browser (free)',speechLanguage:'Reading language',voice:'Voice',keyPrivacy:'The key is stored only in this browser.',model:'Model',speed:'Speed',pitch:'Pitch',testVoice:'Test voice',save:'Save',emptyLibrary:'You have not loaded any books yet.',export:'Export',cancel:'Cancel',textBook:'Pasted text',segments:'segments',chapters:'chapters',loaded:'Book loaded',badFile:'I could not read that file.',unsupported:'Unsupported format.',needText:'Paste some text first.',settingsSaved:'Settings saved.',needKey:'Add your OpenAI API key in Voice settings.',voiceError:'Audio could not be generated.',emptyChapter:'This chapter has no readable text.',libraryOpened:'Book opened from library.',remove:'Delete',open:'Open',processing:'Processing…',epubError:'I could not parse this EPUB. It may be DRM-protected or use an unsupported structure.',testPhrase:'Hello. This is an MPBook voice test.',deleteConfirm:'Delete this book from the library?',noVoices:'No compatible voices are available.',noBook:'Load a book first.',loadingBook:'Opening book…'}
  };

  const state={
    uiLang:localStorage.getItem('mpbook.uiLang')||'es',
    book:null,
    chapter:0,
    segment:0,
    totalSegments:0,
    chapterStarts:[],
    playing:false,
    audio:null,
    storageWorker:null,
    storageReq:1,
    storagePending:new Map()
  };

  function t(k){return I18N[state.uiLang]?.[k]||k;}
  function toast(msg,ms=2600){const el=$('#toast');if(!el)return;el.textContent=msg;el.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.remove('show'),ms);}
  function currentEngine(){return localStorage.getItem('mpbook.engine')||'browser';}
  function currentLocale(){return localStorage.getItem('mpbook.speechLang')||'es-ES';}
  function currentRate(){return Number(localStorage.getItem('mpbook.rate')||1);}
  function currentPitch(){return Number(localStorage.getItem('mpbook.pitch')||1);}

  function storage(){
    if(state.storageWorker) return state.storageWorker;
    const w=new Worker('./storage-worker.js?v=14');
    w.onmessage=e=>{
      const m=e.data||{}, p=state.storagePending.get(m.requestId);
      if(!p)return;
      state.storagePending.delete(m.requestId);
      if(m.type==='result')p.resolve(m.result);else p.reject(new Error(m.message||'Storage worker error'));
    };
    w.onerror=e=>{
      const err=new Error(e?.message||'Storage worker stopped');
      for(const [,p] of state.storagePending)p.reject(err);
      state.storagePending.clear();
      try{w.terminate();}catch{}
      if(state.storageWorker===w)state.storageWorker=null;
    };
    state.storageWorker=w;
    return w;
  }
  function storageCall(type,payload={}){
    const requestId=state.storageReq++;
    return new Promise((resolve,reject)=>{
      state.storagePending.set(requestId,{resolve,reject});
      storage().postMessage({type,requestId,...payload});
    });
  }

  function computeBookIndex(){
    state.chapterStarts=[];
    let n=0;
    for(const c of state.book?.chapters||[]){state.chapterStarts.push(n);n+=(c.segments||[]).length;}
    state.totalSegments=n;
  }

  function saveProgress(){
    if(!state.book)return;
    localStorage.setItem(`mpbook.progress.${state.book.id}.chapter`,String(state.chapter));
    localStorage.setItem(`mpbook.progress.${state.book.id}.segment`,String(state.segment));
  }

  function setSelectOptions(select,items,value){
    const frag=document.createDocumentFragment();
    for(const item of items){const o=document.createElement('option');o.value=String(item.value);o.textContent=item.label;if(item.disabled)o.disabled=true;frag.appendChild(o);}
    select.replaceChildren(frag);
    select.value=String(value);
  }

  function renderReader(scroll=false){
    const b=state.book;if(!b)return;
    const ch=b.chapters[state.chapter]||{title:t('chapter'),segments:[]};
    const segs=ch.segments||[];
    if(state.segment>=segs.length)state.segment=Math.max(0,segs.length-1);

    $('#fileTypeLabel').textContent=b.type||'EPUB';
    $('#bookTitle').textContent=b.title||'Libro';
    $('#bookStats').textContent=`${b.chapters.length} ${t('chapters')} · ${state.totalSegments} ${t('segments')}`;

    setSelectOptions($('#chapterSelect'),b.chapters.map((c,i)=>({value:i,label:c.title||`${t('chapter')} ${i+1}`})),state.chapter);

    const n=segs.length;
    let start=0,end=n;
    if(n>240){start=Math.max(0,state.segment-100);end=Math.min(n,state.segment+101);}
    const segItems=[];
    if(start>0)segItems.push({value:'x1',label:`… 1–${start}`,disabled:true});
    for(let i=start;i<end;i++)segItems.push({value:i,label:`${i+1} / ${n}`});
    if(end<n)segItems.push({value:'x2',label:`… ${end+1}–${n}`,disabled:true});
    setSelectOptions($('#segmentSelect'),segItems,state.segment);

    const reader=$('#readerText');
    if(!n){reader.innerHTML=`<p>${esc(t('emptyChapter'))}</p>`;}
    else{
      const lo=Math.max(0,state.segment-2), hi=Math.min(n,state.segment+3);
      const html=[];
      if(lo>0)html.push(`<div class="virtual-note">${state.uiLang==='en'?`Showing ${lo+1}–${hi} of ${n}`:`Mostrando ${lo+1}–${hi} de ${n}`}</div>`);
      for(let i=lo;i<hi;i++)html.push(`<p class="segment ${i<state.segment?'done':''} ${i===state.segment?'active':''}" data-segment="${i}">${esc(segs[i])}</p>`);
      if(hi<n)html.push(`<div class="virtual-note">${state.uiLang==='en'?'Use Next/Previous to continue':'Usa Siguiente/Anterior para continuar'}</div>`);
      reader.innerHTML=html.join('');
    }

    const passed=(state.chapterStarts[state.chapter]||0)+state.segment;
    const pct=state.totalSegments>1?Math.round(passed*100/(state.totalSegments-1)):0;
    $('#progressBar').style.width=`${Math.min(100,pct)}%`;
    $('#progressText').textContent=`${Math.min(100,pct)}%`;
    $('#nowTitle').textContent=b.title||'MPBook';
    $('#nowChapter').textContent=ch.title||'';
    const eng=currentEngine();$('#engineBadge').textContent=eng==='natural'?(currentLocale().startsWith('en-')?'Kokoro':'Piper'):eng==='openai'?'OpenAI':t('browserVoice').replace(/\s*\(.+\)/,'');
    saveProgress();
    if(scroll)requestAnimationFrame(()=>$('.segment.active')?.scrollIntoView({block:'center',behavior:'auto'}));
  }

  function stopPlayback(){
    state.playing=false;
    try{speechSynthesis.cancel();}catch{}
    if(state.audio){try{state.audio.pause();URL.revokeObjectURL(state.audio.src);}catch{}state.audio=null;}
    $('#playBtn').textContent='▶';
  }
  function setPlaying(on){state.playing=on;$('#playBtn').textContent=on?'❚❚':'▶';}
  function currentText(){return state.book?.chapters?.[state.chapter]?.segments?.[state.segment]||'';}

  function browserSpeak(text,auto=true){
    stopPlayback();
    const u=new SpeechSynthesisUtterance(text);u.lang=currentLocale();u.rate=currentRate();u.pitch=currentPitch();
    const saved=localStorage.getItem('mpbook.browserVoice')||'';
    const voices=speechSynthesis.getVoices();
    u.voice=voices.find(v=>v.name===saved)||voices.find(v=>v.lang.toLowerCase().startsWith(currentLocale().slice(0,2).toLowerCase()))||null;
    u.onend=()=>{if(state.playing&&auto)advance(1,true);else setPlaying(false);};
    u.onerror=e=>{if(e.error!=='canceled')toast(t('voiceError'));setPlaying(false);};
    setPlaying(true);speechSynthesis.speak(u);
  }

  async function openaiBlob(text){
    const key=localStorage.getItem('mpbook.openaiKey')||'';if(!key)throw new Error(t('needKey'));
    const model=localStorage.getItem('mpbook.openaiModel')||'gpt-4o-mini-tts';
    const voice=localStorage.getItem('mpbook.openaiVoice')||'alloy';
    const r=await fetch('https://api.openai.com/v1/audio/speech',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({model,voice,input:text,response_format:'mp3',speed:Math.max(.25,Math.min(4,currentRate()))})});
    if(!r.ok){let m=`OpenAI ${r.status}`;try{const j=await r.json();m=j.error?.message||m;}catch{}throw new Error(m);}return r.blob();
  }
  async function openaiSpeak(text,auto=true){
    stopPlayback();setPlaying(true);
    try{const blob=await openaiBlob(text);if(!state.playing)return;const url=URL.createObjectURL(blob),a=new Audio(url);state.audio=a;a.onended=()=>{URL.revokeObjectURL(url);state.audio=null;if(state.playing&&auto)advance(1,true);else setPlaying(false);};a.onerror=()=>{setPlaying(false);toast(t('voiceError'));};await a.play();}
    catch(err){setPlaying(false);toast(err.message||t('voiceError'),6000);}
  }
  function speak(text,auto=true){const e=currentEngine();if(e==='openai')return openaiSpeak(text,auto);if(e==='browser')return browserSpeak(text,auto);}

  function advance(dir,keep=false){
    if(!state.book)return;
    let c=state.chapter,s=state.segment+dir;
    const cur=state.book.chapters[c];
    if(s>=(cur.segments||[]).length){c++;s=0;}
    if(s<0){c--;if(c>=0)s=Math.max(0,(state.book.chapters[c].segments||[]).length-1);}
    if(c<0||c>=state.book.chapters.length){stopPlayback();return;}
    state.chapter=c;state.segment=s;renderReader(true);updateMediaSession();if(keep&&currentEngine()!=='natural')speak(currentText(),true);
  }

  function updateMediaSession(){
    if(!('mediaSession'in navigator)||!state.book)return;
    try{navigator.mediaSession.metadata=new MediaMetadata({title:state.book.title,artist:state.book.chapters[state.chapter]?.title||'MPBook',album:'MPBook'});navigator.mediaSession.setActionHandler('play',()=>{if(currentEngine()!=='natural')speak(currentText(),true);});navigator.mediaSession.setActionHandler('pause',stopPlayback);navigator.mediaSession.setActionHandler('previoustrack',()=>advance(-1,false));navigator.mediaSession.setActionHandler('nexttrack',()=>advance(1,false));}catch{}
  }

  async function openBook(book,fromLibrary=true){
    if(!book?.chapters?.length)throw new Error('Invalid book');
    stopPlayback();state.book=book;computeBookIndex();
    state.chapter=Number(localStorage.getItem(`mpbook.progress.${book.id}.chapter`)||0);
    state.segment=Number(localStorage.getItem(`mpbook.progress.${book.id}.segment`)||0);
    if(state.chapter<0||state.chapter>=book.chapters.length)state.chapter=0;
    if(state.segment<0||state.segment>=(book.chapters[state.chapter].segments||[]).length)state.segment=0;
    $('#libraryDialog')?.open&&$('#libraryDialog').close();
    $('#welcomeView').hidden=true;$('#readerView').hidden=false;$('#player').hidden=false;
    renderReader(false);updateMediaSession();
    window.MPBookCurrentBook=book;
    if(!fromLibrary){book.updatedAt=Date.now();storageCall('put',{book}).catch(err=>console.warn('Library save failed',err));}
  }
  window.MPBookOpenBook=openBook;

  function splitSegments(text,max=680){
    const clean=String(text||'').replace(/\r/g,'').replace(/[ \t]+/g,' ').replace(/\n{3,}/g,'\n\n').trim();if(!clean)return[];
    const paras=clean.split(/\n{2,}/).map(x=>x.trim()).filter(Boolean),out=[];
    for(const p of paras){if(p.length<=max){out.push(p);continue;}const sentences=p.match(/[^.!?。！？]+[.!?。！？]+|[^.!?。！？]+$/g)||[p];let cur='';for(const raw of sentences){const s=raw.trim();if(!s)continue;if((cur+' '+s).trim().length<=max)cur=(cur+' '+s).trim();else{if(cur)out.push(cur);if(s.length<=max)cur=s;else{for(let i=0;i<s.length;i+=max)out.push(s.slice(i,i+max));cur='';}}}if(cur)out.push(cur);}return out;
  }
  function chapterize(text){const segs=splitSegments(text);return[{title:t('textBook'),segments:segs}];}

  function parseEpubWorker(file){
    return file.arrayBuffer().then(buffer=>new Promise((resolve,reject)=>{
      const worker=new Worker('./epub-worker.js?v=14');let done=false;
      const timer=setTimeout(()=>finish(reject,new Error('EPUB worker timeout')),120000);
      const finish=(fn,val)=>{if(done)return;done=true;clearTimeout(timer);try{worker.terminate();}catch{}fn(val);};
      worker.onmessage=e=>{const m=e.data||{};if(m.type==='progress'){const tail=m.total?` · ${m.done}/${m.total}`:'';toast(`${state.uiLang==='en'?'Processing EPUB':'Procesando EPUB'}… ${m.value||0}%${tail}`,5000);return;}if(m.type==='result')finish(resolve,m.book);else if(m.type==='error')finish(reject,new Error(m.message||'EPUB error'));};
      worker.onerror=e=>finish(reject,new Error(e?.message||'EPUB worker error'));
      worker.postMessage({type:'parse',buffer,meta:{name:file.name,size:file.size,lastModified:file.lastModified},lang:state.uiLang},[buffer]);
    }));
  }

  async function handleFile(file){
    if(!file)return;toast(t('processing'),5000);
    try{
      const name=file.name.toLowerCase();let book;
      if(name.endsWith('.epub')){book=await parseEpubWorker(file);await openBook(book,true);}
      else if(name.endsWith('.md')||name.endsWith('.markdown')||name.endsWith('.txt')){const text=await file.text();book={id:`${name.endsWith('.txt')?'txt':'md'}:${file.name}:${file.size}:${file.lastModified}`,title:file.name.replace(/\.(txt|md|markdown)$/i,''),type:name.endsWith('.txt')?'TXT':'MD',filename:file.name,chapters:chapterize(text),updatedAt:Date.now()};await openBook(book,false);}
      else throw new Error(t('unsupported'));
      toast(t('loaded'));
    }catch(err){console.error(err);toast(file.name.toLowerCase().endsWith('.epub')?`${t('epubError')} ${err.message||''}`:(err.message||t('badFile')),7000);}
    finally{if($('#fileInput'))$('#fileInput').value='';}
  }

  async function renderLibrary(){
    const list=$('#libraryList'),empty=$('#emptyLibrary');if(!list)return;
    list.innerHTML=`<div class="virtual-note">${state.uiLang==='en'?'Loading library…':'Cargando biblioteca…'}</div>`;
    try{
      const books=await storageCall('list');empty.hidden=books.length>0;
      list.innerHTML=books.map(b=>`<div class="library-item" data-id="${esc(b.id)}"><div><strong>${esc(b.title)}</strong><small>${esc(b.type)} · ${b.chapters||0} ${t('chapters')}</small></div><div class="library-item-actions"><button class="tiny-btn open-book" type="button">${t('open')}</button><button class="tiny-btn delete-book" type="button">${t('remove')}</button></div></div>`).join('');
    }catch(err){console.error(err);list.innerHTML=`<div class="virtual-note">${esc(err.message||'Library error')}</div>`;}
  }

  function populateVoices(){
    const select=$('#browserVoice');if(!select)return;
    const lang=$('#speechLang')?.value||currentLocale(),voices=speechSynthesis.getVoices(),base=lang.slice(0,2).toLowerCase(),filtered=voices.filter(v=>v.lang.toLowerCase().startsWith(base)),arr=filtered.length?filtered:voices;
    select.innerHTML=arr.map(v=>`<option value="${esc(v.name)}">${esc(v.name)} · ${esc(v.lang)}</option>`).join('');
    const saved=localStorage.getItem('mpbook.browserVoice')||'';if(saved&&arr.some(v=>v.name===saved))select.value=saved;
  }
  function syncEngineRows(){
    const e=$('#engineSelect')?.value||'browser',browser=e==='browser',natural=e==='natural',open=e==='openai';
    $('#browserVoiceRow').hidden=!browser;$('#naturalVoiceRow').hidden=!natural;$('#apiKeyRow').hidden=!open;$('#modelRow').hidden=!open;$('#openaiVoiceRow').hidden=!open;$('#pitchRow').hidden=!browser;
  }
  function syncSettingsUI(){
    $('#engineSelect').value=currentEngine();$('#speechLang').value=currentLocale();$('#openaiKey').value=localStorage.getItem('mpbook.openaiKey')||'';$('#openaiModel').value=localStorage.getItem('mpbook.openaiModel')||'gpt-4o-mini-tts';$('#openaiVoice').value=localStorage.getItem('mpbook.openaiVoice')||'alloy';$('#rateInput').value=currentRate();$('#pitchInput').value=currentPitch();$('#rateOutput').value=`${currentRate().toFixed(2)}×`;$('#pitchOutput').value=currentPitch().toFixed(2);populateVoices();syncEngineRows();
  }

  function applyLanguage(){
    document.documentElement.lang=state.uiLang;
    $$('[data-i18n]').forEach(el=>{const k=el.dataset.i18n;if(I18N[state.uiLang]?.[k])el.textContent=t(k);});
    $$('[data-i18n-placeholder]').forEach(el=>el.placeholder=t(el.dataset.i18nPlaceholder));
    $$('[data-i18n-title]').forEach(el=>el.title=t(el.dataset.i18nTitle));
    $('#langBtn').textContent=state.uiLang==='es'?'EN':'ES';
    if(state.book)renderReader(false);
  }

  $('#langBtn').addEventListener('click',()=>{state.uiLang=state.uiLang==='es'?'en':'es';localStorage.setItem('mpbook.uiLang',state.uiLang);applyLanguage();});
  $('#themeBtn').addEventListener('click',()=>{document.body.classList.toggle('light');localStorage.setItem('mpbook.theme',document.body.classList.contains('light')?'light':'dark');});
  if(localStorage.getItem('mpbook.theme')==='light')document.body.classList.add('light');

  $('#fileInput').addEventListener('change',e=>handleFile(e.target.files?.[0]));
  const dz=$('#dropZone');
  ['dragenter','dragover'].forEach(ev=>dz.addEventListener(ev,e=>{e.preventDefault();dz.classList.add('dragover');}));
  ['dragleave','drop'].forEach(ev=>dz.addEventListener(ev,e=>{e.preventDefault();dz.classList.remove('dragover');}));
  dz.addEventListener('drop',e=>handleFile(e.dataTransfer?.files?.[0]));
  $('#loadTextBtn').addEventListener('click',async()=>{const text=$('#pasteInput').value.trim();if(!text)return toast(t('needText'));const book={id:`paste:${Date.now()}`,title:t('textBook'),type:'TXT',filename:'text.txt',chapters:chapterize(text),updatedAt:Date.now()};await openBook(book,false);toast(t('loaded'));});

  $('#backBtn').addEventListener('click',()=>{stopPlayback();$('#readerView').hidden=true;$('#player').hidden=true;$('#welcomeView').hidden=false;});
  $('#chapterSelect').addEventListener('change',e=>{stopPlayback();state.chapter=Number(e.target.value);state.segment=0;renderReader(true);updateMediaSession();});
  $('#segmentSelect').addEventListener('change',e=>{const v=Number(e.target.value);if(!Number.isFinite(v))return;stopPlayback();state.segment=v;renderReader(true);});
  $('#readerText').addEventListener('click',e=>{const p=e.target.closest('[data-segment]');if(!p)return;stopPlayback();state.segment=Number(p.dataset.segment);renderReader(false);});
  $('#prevBtn').addEventListener('click',()=>{const was=state.playing;stopPlayback();advance(-1,was);});
  $('#nextBtn').addEventListener('click',()=>{const was=state.playing;stopPlayback();advance(1,was);});
  $('#playBtn').addEventListener('click',()=>{if(!state.book)return toast(t('noBook'));if(currentEngine()==='natural')return;if(state.playing)stopPlayback();else speak(currentText(),true);});

  $('#libraryBtn').addEventListener('click',async()=>{await renderLibrary();$('#libraryDialog').showModal();});
  $('#closeLibraryBtn').addEventListener('click',()=>$('#libraryDialog').close());
  $('#libraryList').addEventListener('click',async e=>{
    const row=e.target.closest('.library-item');if(!row)return;
    if(e.target.closest('.open-book')){
      toast(t('loadingBook'),5000);
      try{const b=await storageCall('get',{id:row.dataset.id});if(b){$('#libraryDialog').close();await openBook(b,true);toast(t('libraryOpened'));}}catch(err){console.error(err);toast(err.message||t('badFile'),7000);}
    }else if(e.target.closest('.delete-book')){
      if(confirm(t('deleteConfirm'))){await storageCall('delete',{id:row.dataset.id});await renderLibrary();}
    }
  });

  speechSynthesis.addEventListener?.('voiceschanged',populateVoices);setTimeout(populateVoices,120);
  $('#settingsBtn').addEventListener('click',()=>{syncSettingsUI();$('#settingsDialog').showModal();});
  $('#engineSelect').addEventListener('change',syncEngineRows);
  $('#speechLang').addEventListener('change',()=>{if($('#engineSelect').value==='browser')populateVoices();});
  $('#rateInput').addEventListener('input',e=>$('#rateOutput').value=`${Number(e.target.value).toFixed(2)}×`);
  $('#pitchInput').addEventListener('input',e=>$('#pitchOutput').value=Number(e.target.value).toFixed(2));
  $('#settingsForm').addEventListener('submit',e=>{
    if(e.submitter?.value==='cancel')return;
    const engine=$('#engineSelect').value;if(engine==='natural')return;
    localStorage.setItem('mpbook.engine',engine);localStorage.setItem('mpbook.speechLang',$('#speechLang').value);localStorage.setItem('mpbook.browserVoice',$('#browserVoice').value||'');localStorage.setItem('mpbook.openaiKey',$('#openaiKey').value.trim());localStorage.setItem('mpbook.openaiModel',$('#openaiModel').value);localStorage.setItem('mpbook.openaiVoice',$('#openaiVoice').value);localStorage.setItem('mpbook.rate',$('#rateInput').value);localStorage.setItem('mpbook.pitch',$('#pitchInput').value);toast(t('settingsSaved'));if(state.book)renderReader(false);
  });
  $('#testVoiceBtn').addEventListener('click',()=>{if($('#engineSelect').value==='natural')return;const engine=$('#engineSelect').value;const prev=localStorage.getItem('mpbook.engine');localStorage.setItem('mpbook.engine',engine);if(engine==='browser')browserSpeak(t('testPhrase'),false);else openaiSpeak(t('testPhrase'),false);if(prev)localStorage.setItem('mpbook.engine',prev);});

  applyLanguage();syncSettingsUI();
  window.MPBookApp={openBook,get book(){return state.book;},get chapter(){return state.chapter;},get segment(){return state.segment;}};

  if('serviceWorker'in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));
})();
