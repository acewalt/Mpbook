(() => {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const enc = new TextEncoder();
  const dec = new TextDecoder();

  const I18N = {
    es: {
      subtitle:'EPUB a audiolibro', library:'Biblioteca', voiceSettings:'Ajustes de voz', theme:'Tema', heroTitle:'Convierte tus libros en audio.', heroText:'Abre un EPUB, Markdown o TXT. El libro se procesa localmente en tu navegador y puedes escucharlo con la voz del sistema o con OpenAI.', dropTitle:'Suelta tu libro aquí', dropText:'o toca para elegir un archivo', or:'o', quickText:'Texto rápido', pasteTitle:'Pega texto para escucharlo', pastePlaceholder:'Pega aquí el texto que quieres convertir en audio...', loadText:'Cargar texto', home:'Inicio', exportAudio:'Exportar audio', chapter:'Capítulo', segment:'Fragmento', previous:'Anterior', play:'Reproducir', next:'Siguiente', audio:'Audio', engine:'Motor de voz', browserVoice:'Navegador (gratis)', speechLanguage:'Idioma de lectura', voice:'Voz', keyPrivacy:'La clave se guarda solo en este navegador.', model:'Modelo', speed:'Velocidad', pitch:'Tono', testVoice:'Probar voz', save:'Guardar', emptyLibrary:'Todavía no has cargado ningún libro.', export:'Exportar', exportOpenAIOnly:'La exportación usa OpenAI y genera un MP3 con los fragmentos del libro.', cancel:'Cancelar', startExport:'Generar MP3', textBook:'Texto pegado', segments:'fragmentos', chapters:'capítulos', loaded:'Libro cargado', badFile:'No pude leer ese archivo.', unsupported:'Formato no compatible.', needText:'Pega algún texto primero.', settingsSaved:'Ajustes guardados.', needKey:'Añade tu OpenAI API key en Ajustes de voz.', voiceError:'No se pudo generar el audio.', emptyChapter:'Este capítulo no contiene texto legible.', libraryOpened:'Libro abierto desde la biblioteca.', remove:'Eliminar', open:'Abrir', processing:'Procesando…', exporting:'Generando audio', exportDone:'MP3 generado.', exportCancelled:'Exportación cancelada.', browserExport:'Para exportar a MP3 selecciona OpenAI en Ajustes de voz.', epubError:'No pude interpretar este EPUB. Puede estar protegido con DRM o usar una estructura no compatible.', testPhrase:'Hola. Esta es una prueba de voz de MPBook.', dragHint:'Suelta para abrir el libro', ready:'Listo', deleteConfirm:'¿Eliminar este libro de la biblioteca?', noVoices:'No hay voces compatibles disponibles.', noBook:'Carga un libro primero.'
    },
    en: {
      subtitle:'EPUB to audiobook', library:'Library', voiceSettings:'Voice settings', theme:'Theme', heroTitle:'Turn your books into audio.', heroText:'Open an EPUB, Markdown or TXT file. The book is processed locally in your browser and can be read with the system voice or OpenAI.', dropTitle:'Drop your book here', dropText:'or tap to choose a file', or:'or', quickText:'Quick text', pasteTitle:'Paste text to listen', pastePlaceholder:'Paste the text you want to turn into audio...', loadText:'Load text', home:'Home', exportAudio:'Export audio', chapter:'Chapter', segment:'Segment', previous:'Previous', play:'Play', next:'Next', audio:'Audio', engine:'Voice engine', browserVoice:'Browser (free)', speechLanguage:'Reading language', voice:'Voice', keyPrivacy:'The key is stored only in this browser.', model:'Model', speed:'Speed', pitch:'Pitch', testVoice:'Test voice', save:'Save', emptyLibrary:'You have not loaded any books yet.', export:'Export', exportOpenAIOnly:'Export uses OpenAI and creates an MP3 from the book segments.', cancel:'Cancel', startExport:'Generate MP3', textBook:'Pasted text', segments:'segments', chapters:'chapters', loaded:'Book loaded', badFile:'I could not read that file.', unsupported:'Unsupported format.', needText:'Paste some text first.', settingsSaved:'Settings saved.', needKey:'Add your OpenAI API key in Voice settings.', voiceError:'Audio could not be generated.', emptyChapter:'This chapter has no readable text.', libraryOpened:'Book opened from the library.', remove:'Delete', open:'Open', processing:'Processing…', exporting:'Generating audio', exportDone:'MP3 generated.', exportCancelled:'Export cancelled.', browserExport:'Select OpenAI in Voice settings to export MP3.', epubError:'I could not parse this EPUB. It may be DRM-protected or use an unsupported structure.', testPhrase:'Hello. This is an MPBook voice test.', dragHint:'Drop to open the book', ready:'Ready', deleteConfirm:'Delete this book from the library?', noVoices:'No compatible voices are available.', noBook:'Load a book first.'
    }
  };

  const state = {
    uiLang: localStorage.getItem('mpbook.uiLang') || 'es',
    book: null,
    chapter: 0,
    segment: 0,
    playing: false,
    audio: null,
    exportAbort: false,
    settings: {
      engine: localStorage.getItem('mpbook.engine') || 'browser',
      speechLang: localStorage.getItem('mpbook.speechLang') || 'es-ES',
      browserVoice: localStorage.getItem('mpbook.browserVoice') || '',
      openaiKey: localStorage.getItem('mpbook.openaiKey') || '',
      openaiModel: localStorage.getItem('mpbook.openaiModel') || 'gpt-4o-mini-tts',
      openaiVoice: localStorage.getItem('mpbook.openaiVoice') || 'alloy',
      rate: Number(localStorage.getItem('mpbook.rate') || 1),
      pitch: Number(localStorage.getItem('mpbook.pitch') || 1)
    }
  };

  function t(k){ return I18N[state.uiLang][k] || k; }
  function toast(msg){ const el=$('#toast'); el.textContent=msg; el.classList.add('show'); clearTimeout(toast.timer); toast.timer=setTimeout(()=>el.classList.remove('show'),2400); }
  function escapeHtml(v){ return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function safeName(v){ return (v || 'mpbook').replace(/[\\/:*?"<>|]+/g,'-').replace(/\s+/g,' ').trim().slice(0,100); }

  function applyLanguage(){
    document.documentElement.lang = state.uiLang;
    $$('[data-i18n]').forEach(el=>{ const k=el.dataset.i18n; if(I18N[state.uiLang][k]) el.textContent=t(k); });
    $$('[data-i18n-placeholder]').forEach(el=>el.placeholder=t(el.dataset.i18nPlaceholder));
    $$('[data-i18n-title]').forEach(el=>el.title=t(el.dataset.i18nTitle));
    $('#langBtn').textContent = state.uiLang === 'es' ? 'EN' : 'ES';
    if(state.book) renderReader(false);
    renderLibrary();
  }

  $('#langBtn').addEventListener('click',()=>{ state.uiLang = state.uiLang === 'es' ? 'en' : 'es'; localStorage.setItem('mpbook.uiLang',state.uiLang); applyLanguage(); });
  $('#themeBtn').addEventListener('click',()=>{ document.body.classList.toggle('light'); localStorage.setItem('mpbook.theme',document.body.classList.contains('light')?'light':'dark'); });
  if(localStorage.getItem('mpbook.theme')==='light') document.body.classList.add('light');

  // IndexedDB library
  const DB_NAME='mpbook-library', STORE='books';
  function openDB(){ return new Promise((resolve,reject)=>{ const req=indexedDB.open(DB_NAME,1); req.onupgradeneeded=()=>{ if(!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE,{keyPath:'id'}); }; req.onsuccess=()=>resolve(req.result); req.onerror=()=>reject(req.error); }); }
  async function dbPut(book){ const db=await openDB(); return new Promise((resolve,reject)=>{ const tx=db.transaction(STORE,'readwrite'); tx.objectStore(STORE).put(book); tx.oncomplete=()=>resolve(); tx.onerror=()=>reject(tx.error); }); }
  async function dbGet(id){ const db=await openDB(); return new Promise((resolve,reject)=>{ const r=db.transaction(STORE).objectStore(STORE).get(id); r.onsuccess=()=>resolve(r.result); r.onerror=()=>reject(r.error); }); }
  async function dbAll(){ const db=await openDB(); return new Promise((resolve,reject)=>{ const r=db.transaction(STORE).objectStore(STORE).getAll(); r.onsuccess=()=>resolve(r.result.sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0))); r.onerror=()=>reject(r.error); }); }
  async function dbDelete(id){ const db=await openDB(); return new Promise((resolve,reject)=>{ const tx=db.transaction(STORE,'readwrite'); tx.objectStore(STORE).delete(id); tx.oncomplete=()=>resolve(); tx.onerror=()=>reject(tx.error); }); }

  function splitSegments(text,max=680){
    const clean=String(text||'').replace(/\r/g,'').replace(/[ \t]+/g,' ').replace(/\n{3,}/g,'\n\n').trim();
    if(!clean) return [];
    const paras=clean.split(/\n{2,}/).map(x=>x.trim()).filter(Boolean);
    const out=[];
    for(const p of paras){
      if(p.length<=max){ out.push(p); continue; }
      const sentences=p.match(/[^.!?。！？]+[.!?。！？]+|[^.!?。！？]+$/g) || [p];
      let cur='';
      for(const s0 of sentences){ const s=s0.trim(); if(!s) continue; if((cur+' '+s).trim().length<=max){ cur=(cur+' '+s).trim(); } else { if(cur) out.push(cur); if(s.length<=max) cur=s; else { for(let i=0;i<s.length;i+=max) out.push(s.slice(i,i+max)); cur=''; } } }
      if(cur) out.push(cur);
    }
    return out;
  }

  function chapterizeMarkdown(text){
    const lines=String(text).replace(/\r/g,'').split('\n');
    const chapters=[]; let title=t('textBook'), buf=[];
    const flush=()=>{ const body=buf.join('\n').trim(); if(body) chapters.push({title,segments:splitSegments(body)}); buf=[]; };
    for(const line of lines){ const m=line.match(/^#{1,3}\s+(.+)/); if(m){ flush(); title=m[1].trim(); } else buf.push(line); }
    flush();
    if(!chapters.length) chapters.push({title:t('textBook'),segments:splitSegments(text)});
    return chapters;
  }

  function normalizePath(base,href){
    if(/^https?:/i.test(href)) return href;
    const parts=(base?base.split('/').slice(0,-1):[]).concat(href.split('/'));
    const out=[]; for(const p of parts){ if(!p||p==='.') continue; if(p==='..') out.pop(); else out.push(p); }
    return out.join('/');
  }

  function u16(dv,o){ return dv.getUint16(o,true); }
  function u32(dv,o){ return dv.getUint32(o,true); }
  async function unzipEntries(buffer){
    const bytes=new Uint8Array(buffer), dv=new DataView(buffer); let eocd=-1;
    for(let i=bytes.length-22;i>=Math.max(0,bytes.length-66000);i--){ if(u32(dv,i)===0x06054b50){ eocd=i; break; } }
    if(eocd<0) throw new Error('ZIP EOCD not found');
    const total=u16(dv,eocd+10), cdOffset=u32(dv,eocd+16); let p=cdOffset; const files=new Map();
    for(let n=0;n<total;n++){
      if(u32(dv,p)!==0x02014b50) throw new Error('Bad central directory');
      const method=u16(dv,p+10), compSize=u32(dv,p+20), nameLen=u16(dv,p+28), extraLen=u16(dv,p+30), commentLen=u16(dv,p+32), local=u32(dv,p+42);
      const name=dec.decode(bytes.slice(p+46,p+46+nameLen));
      const localNameLen=u16(dv,local+26), localExtraLen=u16(dv,local+28), start=local+30+localNameLen+localExtraLen;
      files.set(name,{method,data:bytes.slice(start,start+compSize)});
      p+=46+nameLen+extraLen+commentLen;
    }
    async function read(path){
      const f=files.get(path); if(!f) throw new Error('Missing '+path);
      if(f.method===0) return f.data;
      if(f.method!==8) throw new Error('Unsupported ZIP method '+f.method);
      const stream=new Blob([f.data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    }
    return {files,read};
  }

  async function parseEpub(file){
    const zip=await unzipEntries(await file.arrayBuffer());
    const parser=new DOMParser();
    const container=parser.parseFromString(dec.decode(await zip.read('META-INF/container.xml')),'application/xml');
    const rootfile=container.querySelector('rootfile')?.getAttribute('full-path');
    if(!rootfile) throw new Error('No OPF');
    const opf=parser.parseFromString(dec.decode(await zip.read(rootfile)),'application/xml');
    const title=opf.querySelector('metadata > title, metadata > dc\\:title, dc\\:title')?.textContent?.trim() || file.name.replace(/\.epub$/i,'');
    const manifest=new Map();
    opf.querySelectorAll('manifest item').forEach(item=>manifest.set(item.getAttribute('id'),{href:item.getAttribute('href'),media:item.getAttribute('media-type')||''}));
    const spine=[...opf.querySelectorAll('spine itemref')].map(x=>x.getAttribute('idref')).filter(Boolean);
    const chapters=[];
    for(const id of spine){
      const item=manifest.get(id); if(!item?.href) continue;
      const path=normalizePath(rootfile,item.href.split('#')[0]); if(!zip.files.has(path)) continue;
      let html=''; try{ html=dec.decode(await zip.read(path)); }catch{ continue; }
      const doc=parser.parseFromString(html,'text/html');
      doc.querySelectorAll('script,style,nav,aside,svg,form,noscript').forEach(x=>x.remove());
      let chTitle=doc.querySelector('h1,h2,h3,title')?.textContent?.replace(/\s+/g,' ').trim() || '';
      const blocks=[...doc.body.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li,blockquote')].map(el=>el.textContent.replace(/\s+/g,' ').trim()).filter(Boolean);
      const text=(blocks.length?blocks:[doc.body.textContent]).join('\n\n').replace(/\u00a0/g,' ').trim();
      if(!text) continue;
      if(!chTitle) chTitle=`${t('chapter')} ${chapters.length+1}`;
      chapters.push({title:chTitle,segments:splitSegments(text)});
    }
    if(!chapters.length) throw new Error('No readable chapters');
    return {id:`epub:${file.name}:${file.size}:${file.lastModified}`,title,type:'EPUB',filename:file.name,chapters,updatedAt:Date.now()};
  }

  async function parseFile(file){
    const name=file.name.toLowerCase();
    if(name.endsWith('.epub')) return parseEpub(file);
    if(name.endsWith('.md')||name.endsWith('.markdown')){ const text=await file.text(); return {id:`md:${file.name}:${file.size}:${file.lastModified}`,title:file.name.replace(/\.(md|markdown)$/i,''),type:'MD',filename:file.name,chapters:chapterizeMarkdown(text),updatedAt:Date.now()}; }
    if(name.endsWith('.txt')){ const text=await file.text(); return {id:`txt:${file.name}:${file.size}:${file.lastModified}`,title:file.name.replace(/\.txt$/i,''),type:'TXT',filename:file.name,chapters:[{title:file.name.replace(/\.txt$/i,''),segments:splitSegments(text)}],updatedAt:Date.now()}; }
    throw new Error(t('unsupported'));
  }

  async function loadBook(book,fromLibrary=false){
    stopPlayback(); state.book=book; state.chapter=Number(localStorage.getItem(`mpbook.progress.${book.id}.chapter`)||0); state.segment=Number(localStorage.getItem(`mpbook.progress.${book.id}.segment`)||0);
    if(state.chapter>=book.chapters.length) state.chapter=0;
    if(state.segment>=book.chapters[state.chapter].segments.length) state.segment=0;
    $('#welcomeView').hidden=true; $('#readerView').hidden=false; $('#player').hidden=false; renderReader(true); updateMediaSession();
    if(!fromLibrary){ book.updatedAt=Date.now(); await dbPut(book); }
  }

  function renderReader(scroll=true){
    if(!state.book) return;
    const b=state.book, ch=b.chapters[state.chapter];
    $('#fileTypeLabel').textContent=b.type; $('#bookTitle').textContent=b.title;
    const total=b.chapters.reduce((n,c)=>n+c.segments.length,0); $('#bookStats').textContent=`${b.chapters.length} ${t('chapters')} · ${total} ${t('segments')}`;
    $('#chapterSelect').innerHTML=b.chapters.map((c,i)=>`<option value="${i}" ${i===state.chapter?'selected':''}>${escapeHtml(c.title)}</option>`).join('');
    $('#segmentSelect').innerHTML=ch.segments.map((_,i)=>`<option value="${i}" ${i===state.segment?'selected':''}>${i+1} / ${ch.segments.length}</option>`).join('');
    $('#readerText').innerHTML=ch.segments.length?ch.segments.map((s,i)=>`<p class="segment ${i<state.segment?'done':''} ${i===state.segment?'active':''}" data-segment="${i}">${escapeHtml(s)}</p>`).join(''):`<p>${t('emptyChapter')}</p>`;
    const passed=b.chapters.slice(0,state.chapter).reduce((n,c)=>n+c.segments.length,0)+state.segment, pct=total?Math.round((passed/Math.max(1,total-1))*100):0;
    $('#progressBar').style.width=`${Math.min(100,pct)}%`; $('#progressText').textContent=`${Math.min(100,pct)}%`;
    $('#nowTitle').textContent=b.title; $('#nowChapter').textContent=ch.title; $('#engineBadge').textContent=state.settings.engine==='browser'?t('browserVoice').replace(/\s*\(.+\)/,''):'OpenAI';
    if(scroll) setTimeout(()=>$('.segment.active')?.scrollIntoView({block:'center',behavior:'smooth'}),80);
    saveProgress();
  }

  function saveProgress(){ if(!state.book) return; localStorage.setItem(`mpbook.progress.${state.book.id}.chapter`,state.chapter); localStorage.setItem(`mpbook.progress.${state.book.id}.segment`,state.segment); }
  $('#chapterSelect').addEventListener('change',e=>{ stopPlayback(); state.chapter=Number(e.target.value); state.segment=0; renderReader(true); updateMediaSession(); });
  $('#segmentSelect').addEventListener('change',e=>{ stopPlayback(); state.segment=Number(e.target.value); renderReader(true); });
  $('#readerText').addEventListener('click',e=>{ const p=e.target.closest('[data-segment]'); if(!p)return; stopPlayback(); state.segment=Number(p.dataset.segment); renderReader(false); });
  $('#backBtn').addEventListener('click',()=>{ stopPlayback(); $('#readerView').hidden=true; $('#player').hidden=true; $('#welcomeView').hidden=false; });

  async function handleFile(file){
    if(!file)return; toast(t('processing'));
    try{ const book=await parseFile(file); await loadBook(book); toast(t('loaded')); }catch(err){ console.error(err); toast(file.name.toLowerCase().endsWith('.epub')?t('epubError'):(err.message||t('badFile'))); }
  }
  $('#fileInput').addEventListener('change',e=>handleFile(e.target.files?.[0]));
  const dz=$('#dropZone');
  ['dragenter','dragover'].forEach(ev=>dz.addEventListener(ev,e=>{e.preventDefault();dz.classList.add('dragover');}));
  ['dragleave','drop'].forEach(ev=>dz.addEventListener(ev,e=>{e.preventDefault();dz.classList.remove('dragover');}));
  dz.addEventListener('drop',e=>handleFile(e.dataTransfer.files?.[0]));
  $('#loadTextBtn').addEventListener('click',async()=>{ const text=$('#pasteInput').value.trim(); if(!text)return toast(t('needText')); const book={id:`paste:${Date.now()}`,title:t('textBook'),type:'TXT',filename:'text.txt',chapters:chapterizeMarkdown(text),updatedAt:Date.now()}; await loadBook(book); toast(t('loaded')); });

  function populateVoices(){
    const voices=speechSynthesis.getVoices(), lang=state.settings.speechLang.toLowerCase().split('-')[0], filtered=voices.filter(v=>v.lang.toLowerCase().startsWith(lang));
    const list=filtered.length?filtered:voices; $('#browserVoice').innerHTML=list.map(v=>`<option value="${escapeHtml(v.name)}">${escapeHtml(v.name)} · ${escapeHtml(v.lang)}</option>`).join('');
    if(state.settings.browserVoice && list.some(v=>v.name===state.settings.browserVoice)) $('#browserVoice').value=state.settings.browserVoice;
  }
  speechSynthesis.addEventListener?.('voiceschanged',populateVoices); setTimeout(populateVoices,100);

  function syncSettingsUI(){
    $('#engineSelect').value=state.settings.engine; $('#speechLang').value=state.settings.speechLang; $('#openaiKey').value=state.settings.openaiKey; $('#openaiModel').value=state.settings.openaiModel; $('#openaiVoice').value=state.settings.openaiVoice; $('#rateInput').value=state.settings.rate; $('#pitchInput').value=state.settings.pitch; $('#rateOutput').value=`${state.settings.rate.toFixed(2)}×`; $('#pitchOutput').value=state.settings.pitch.toFixed(2); populateVoices(); syncEngineRows();
  }
  function syncEngineRows(){ const open=$('#engineSelect').value==='openai'; $('#apiKeyRow').hidden=!open; $('#modelRow').hidden=!open; $('#openaiVoiceRow').hidden=!open; $('#browserVoiceRow').hidden=open; $('#pitchRow').hidden=open; }
  $('#engineSelect').addEventListener('change',syncEngineRows); $('#speechLang').addEventListener('change',()=>{state.settings.speechLang=$('#speechLang').value;populateVoices();});
  $('#rateInput').addEventListener('input',e=>$('#rateOutput').value=`${Number(e.target.value).toFixed(2)}×`); $('#pitchInput').addEventListener('input',e=>$('#pitchOutput').value=Number(e.target.value).toFixed(2));
  $('#settingsBtn').addEventListener('click',()=>{syncSettingsUI();$('#settingsDialog').showModal();});
  $('#settingsForm').addEventListener('submit',e=>{ if(e.submitter?.value==='cancel') return; state.settings.engine=$('#engineSelect').value; state.settings.speechLang=$('#speechLang').value; state.settings.browserVoice=$('#browserVoice').value; state.settings.openaiKey=$('#openaiKey').value.trim(); state.settings.openaiModel=$('#openaiModel').value; state.settings.openaiVoice=$('#openaiVoice').value; state.settings.rate=Number($('#rateInput').value); state.settings.pitch=Number($('#pitchInput').value); Object.entries(state.settings).forEach(([k,v])=>localStorage.setItem('mpbook.'+k,String(v))); renderReader(false); toast(t('settingsSaved')); });
  $('#testVoiceBtn').addEventListener('click',()=>speakText(t('testPhrase'),false));

  function currentText(){ return state.book?.chapters?.[state.chapter]?.segments?.[state.segment] || ''; }
  function setPlayIcon(){ $('#playBtn').textContent=state.playing?'❚❚':'▶'; $('#playBtn').title=state.playing?t('cancel'):t('play'); }
  function stopPlayback(){ state.playing=false; speechSynthesis.cancel(); if(state.audio){ state.audio.pause(); state.audio.src=''; state.audio=null; } setPlayIcon(); }

  function browserSpeak(text,autonext=true){
    speechSynthesis.cancel(); const u=new SpeechSynthesisUtterance(text); u.lang=state.settings.speechLang; u.rate=state.settings.rate; u.pitch=state.settings.pitch;
    const voices=speechSynthesis.getVoices(); const selected=voices.find(v=>v.name===state.settings.browserVoice) || voices.find(v=>v.lang.toLowerCase().startsWith(state.settings.speechLang.toLowerCase().split('-')[0])); if(selected)u.voice=selected;
    u.onend=()=>{ if(state.playing&&autonext) advance(1,true); else{state.playing=false;setPlayIcon();} }; u.onerror=e=>{ if(e.error!=='canceled')toast(t('voiceError')); state.playing=false;setPlayIcon(); };
    state.playing=true; setPlayIcon(); speechSynthesis.speak(u);
  }

  async function openaiBlob(text){
    if(!state.settings.openaiKey) throw new Error(t('needKey'));
    const r=await fetch('https://api.openai.com/v1/audio/speech',{method:'POST',headers:{'Authorization':`Bearer ${state.settings.openaiKey}`,'Content-Type':'application/json'},body:JSON.stringify({model:state.settings.openaiModel,voice:state.settings.openaiVoice,input:text,response_format:'mp3',speed:Math.max(.25,Math.min(4,state.settings.rate))})});
    if(!r.ok){ let msg=`OpenAI ${r.status}`; try{ const j=await r.json(); msg=j.error?.message||msg; }catch{} throw new Error(msg); }
    return r.blob();
  }
  async function openaiSpeak(text,autonext=true){
    try{ state.playing=true;setPlayIcon(); const blob=await openaiBlob(text); if(!state.playing)return; const a=new Audio(URL.createObjectURL(blob)); state.audio=a; a.onended=()=>{ URL.revokeObjectURL(a.src); state.audio=null; if(state.playing&&autonext)advance(1,true); else{state.playing=false;setPlayIcon();} }; a.onerror=()=>{state.playing=false;setPlayIcon();toast(t('voiceError'));}; await a.play(); }
    catch(err){ state.playing=false;setPlayIcon();toast(err.message||t('voiceError')); }
  }
  function speakText(text,autonext=true){ if(!text)return; return state.settings.engine==='openai'?openaiSpeak(text,autonext):browserSpeak(text,autonext); }
  function advance(dir,keepPlaying=false){
    if(!state.book)return; const ch=state.book.chapters[state.chapter]; let c=state.chapter,s=state.segment+dir;
    if(s>=ch.segments.length){ c++;s=0; } if(s<0){ c--; if(c>=0)s=Math.max(0,state.book.chapters[c].segments.length-1); }
    if(c<0||c>=state.book.chapters.length){ stopPlayback(); return; }
    state.chapter=c;state.segment=s;renderReader(true);updateMediaSession(); if(keepPlaying)speakText(currentText(),true);
  }
  $('#playBtn').addEventListener('click',()=>{ if(!state.book)return toast(t('noBook')); if(state.playing)stopPlayback(); else speakText(currentText(),true); });
  $('#prevBtn').addEventListener('click',()=>{const was=state.playing;stopPlayback();advance(-1,was);}); $('#nextBtn').addEventListener('click',()=>{const was=state.playing;stopPlayback();advance(1,was);});

  function updateMediaSession(){
    if(!('mediaSession' in navigator)||!state.book)return;
    try{ navigator.mediaSession.metadata=new MediaMetadata({title:state.book.title,artist:state.book.chapters[state.chapter]?.title||'MPBook',album:'MPBook'}); navigator.mediaSession.setActionHandler('play',()=>speakText(currentText(),true)); navigator.mediaSession.setActionHandler('pause',stopPlayback); navigator.mediaSession.setActionHandler('previoustrack',()=>advance(-1,false)); navigator.mediaSession.setActionHandler('nexttrack',()=>advance(1,false)); }catch{}
  }

  // Library
  async function renderLibrary(){
    if(!$('#libraryList'))return; let books=[]; try{books=await dbAll();}catch{}
    $('#emptyLibrary').hidden=books.length>0; $('#libraryList').innerHTML=books.map(b=>`<div class="library-item" data-id="${escapeHtml(b.id)}"><div><strong>${escapeHtml(b.title)}</strong><small>${escapeHtml(b.type)} · ${b.chapters?.length||0} ${t('chapters')}</small></div><div class="library-item-actions"><button class="tiny-btn open-book" type="button">${t('open')}</button><button class="tiny-btn delete-book" type="button">${t('remove')}</button></div></div>`).join('');
  }
  $('#libraryBtn').addEventListener('click',async()=>{await renderLibrary();$('#libraryDialog').showModal();}); $('#closeLibraryBtn').addEventListener('click',()=>$('#libraryDialog').close());
  $('#libraryList').addEventListener('click',async e=>{ const row=e.target.closest('.library-item'); if(!row)return; if(e.target.closest('.open-book')){const b=await dbGet(row.dataset.id);if(b){$('#libraryDialog').close();await loadBook(b,true);toast(t('libraryOpened'));}} if(e.target.closest('.delete-book')){if(confirm(t('deleteConfirm'))){await dbDelete(row.dataset.id);renderLibrary();}} });

  // OpenAI MP3 export. Concatenated MP3 byte streams are widely supported by modern players.
  $('#exportBtn').addEventListener('click',()=>{ if(!state.book)return toast(t('noBook')); $('#exportBar').style.width='0%';$('#exportStatus').textContent='0%';$('#exportDialog').showModal(); });
  $('#closeExportBtn').addEventListener('click',()=>$('#exportDialog').close()); $('#cancelExportBtn').addEventListener('click',()=>{state.exportAbort=true;$('#exportDialog').close();});
  $('#startExportBtn').addEventListener('click',async()=>{
    if(state.settings.engine!=='openai'){toast(t('browserExport'));return;} if(!state.settings.openaiKey){toast(t('needKey'));return;}
    const all=state.book.chapters.flatMap(c=>c.segments); if(!all.length)return;
    state.exportAbort=false; $('#startExportBtn').disabled=true; const parts=[];
    try{
      for(let i=0;i<all.length;i++){
        if(state.exportAbort)throw new Error(t('exportCancelled'));
        $('#exportStatus').textContent=`${t('exporting')} ${i+1}/${all.length}`; $('#exportBar').style.width=`${Math.round((i/all.length)*100)}%`;
        parts.push(await openaiBlob(all[i]));
      }
      const blob=new Blob(parts,{type:'audio/mpeg'}), url=URL.createObjectURL(blob), a=document.createElement('a'); a.href=url;a.download=`${safeName(state.book.title)}.mp3`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),5000); $('#exportBar').style.width='100%';$('#exportStatus').textContent='100%';toast(t('exportDone'));
    }catch(err){toast(err.message||t('voiceError'));}
    finally{$('#startExportBtn').disabled=false;}
  });

  applyLanguage(); syncSettingsUI(); renderLibrary();
  if('serviceWorker' in navigator) window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));
})();
