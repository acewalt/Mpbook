(() => {
  'use strict';

  // Keep hidden form sections truly hidden even when other form CSS sets display.
  const style = document.createElement('style');
  style.textContent = '[hidden]{display:none!important}.virtual-note{color:var(--muted);font-family:Inter,ui-sans-serif,sans-serif;font-size:.82rem;padding:8px 12px}';
  document.head.appendChild(style);

  const $ = s => document.querySelector(s);
  const tx = (es,en) => document.documentElement.lang?.startsWith('en') ? en : es;

  function showToast(message, ms=5000){
    const toast = $('#toast');
    if(!toast) return;
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(window.__mpbookPerfToast);
    window.__mpbookPerfToast = setTimeout(()=>toast.classList.remove('show'),ms);
  }

  function saveNaturalSettings(event){
    const engine = $('#engineSelect')?.value || 'browser';
    if(engine !== 'natural') return false;

    event?.preventDefault?.();
    event?.stopPropagation?.();
    event?.stopImmediatePropagation?.();

    const lang = $('#speechLang')?.value || 'es-ES';
    const voice = $('#naturalVoice')?.value || '';
    const rate = Number($('#rateInput')?.value || 1);
    const pitch = Number($('#pitchInput')?.value || 1);

    localStorage.setItem('mpbook.engine','natural');
    localStorage.setItem('mpbook.speechLang',lang);
    localStorage.setItem('mpbook.rate',String(rate));
    localStorage.setItem('mpbook.pitch',String(pitch));
    if(voice) localStorage.setItem(`mpbook.naturalVoice.${lang}`,voice);

    const badge = $('#engineBadge');
    if(badge) badge.textContent = lang.startsWith('en-') ? 'Kokoro' : 'Piper';

    const dialog = $('#settingsDialog');
    if(dialog?.open) dialog.close('default');
    showToast(tx('Ajustes guardados.','Settings saved.'),2400);
    return true;
  }

  document.addEventListener('click', event => {
    const button = event.target?.closest?.('#saveSettingsBtn');
    if(!button) return;
    saveNaturalSettings(event);
  }, true);

  const settingsForm = $('#settingsForm');
  if(settingsForm){
    settingsForm.addEventListener('submit', event => {
      if(event.submitter?.value === 'cancel') return;
      saveNaturalSettings(event);
    }, true);
  }

  $('#settingsBtn')?.addEventListener('click', () => {
    setTimeout(() => {
      if(localStorage.getItem('mpbook.engine') !== 'natural') return;
      const engine = $('#engineSelect');
      const lang = $('#speechLang');
      const savedLang = localStorage.getItem('mpbook.speechLang') || 'es-ES';
      const rate = $('#rateInput');
      const savedRate = localStorage.getItem('mpbook.rate');

      if(engine){ engine.value='natural'; engine.dispatchEvent(new Event('change',{bubbles:true})); }
      if(lang){ lang.value=savedLang; lang.dispatchEvent(new Event('change',{bubbles:true})); }
      if(rate && savedRate){ rate.value=savedRate; rate.dispatchEvent(new Event('input',{bubbles:true})); }
    }, 0);
  });

  // Parse EPUB files in a dedicated Worker before app.js sees them.
  function dbPutBook(book){
    return new Promise((resolve,reject)=>{
      const req=indexedDB.open('mpbook-library',1);
      req.onupgradeneeded=()=>{
        if(!req.result.objectStoreNames.contains('books')) req.result.createObjectStore('books',{keyPath:'id'});
      };
      req.onerror=()=>reject(req.error);
      req.onsuccess=()=>{
        const db=req.result;
        const tx=db.transaction('books','readwrite');
        tx.objectStore('books').put(book);
        tx.oncomplete=()=>{try{db.close();}catch{} resolve();};
        tx.onerror=()=>{try{db.close();}catch{} reject(tx.error);};
      };
    });
  }

  function parseEpubWorker(file){
    return file.arrayBuffer().then(buffer=>new Promise((resolve,reject)=>{
      const worker=new Worker('./epub-worker.js?v=13');
      let done=false;
      const finish=(fn,value)=>{
        if(done) return;
        done=true;
        clearTimeout(timer);
        try{worker.terminate();}catch{}
        fn(value);
      };
      const timer=setTimeout(()=>finish(reject,new Error('EPUB worker timeout')),120000);
      worker.onmessage=e=>{
        const msg=e.data||{};
        if(msg.type==='progress'){
          const tail=msg.total?` · ${msg.done}/${msg.total}`:'';
          showToast(`${tx('Procesando EPUB','Processing EPUB')}… ${msg.value||0}%${tail}`,5000);
          return;
        }
        if(msg.type==='result') finish(resolve,msg.book);
        else if(msg.type==='error') finish(reject,new Error(msg.message||'EPUB worker error'));
      };
      worker.onerror=e=>finish(reject,new Error(e?.message||'EPUB worker error'));
      worker.postMessage({
        type:'parse',
        buffer,
        meta:{name:file.name,size:file.size,lastModified:file.lastModified},
        lang:document.documentElement.lang?.startsWith('en')?'en':'es'
      },[buffer]);
    }));
  }

  async function openStoredBook(id){
    const libraryBtn=$('#libraryBtn');
    if(!libraryBtn) throw new Error('Library unavailable');
    libraryBtn.click();
    const deadline=Date.now()+7000;
    while(Date.now()<deadline){
      await new Promise(r=>setTimeout(r,60));
      const row=[...document.querySelectorAll('#libraryList .library-item')].find(el=>el.dataset.id===id);
      const open=row?.querySelector('.open-book');
      if(open){ open.click(); return; }
    }
    throw new Error('Parsed book was saved but could not be opened');
  }

  let epubBusy=false;
  async function handleEpubOffMain(file){
    if(epubBusy || !file) return;
    epubBusy=true;
    showToast(tx('Procesando EPUB en segundo plano…','Processing EPUB in the background…'),5000);
    try{
      const book=await parseEpubWorker(file);
      await dbPutBook(book);
      await openStoredBook(book.id);
      showToast(tx('Libro cargado.','Book loaded.'),2600);
    }catch(err){
      console.error('MPBook EPUB worker path failed',err);
      showToast(`${tx('No pude abrir este EPUB.','I could not open this EPUB.')} ${String(err?.message||err)}`,7000);
    }finally{
      epubBusy=false;
      const input=$('#fileInput');
      if(input) input.value='';
    }
  }

  const fileInput=$('#fileInput');
  if(fileInput){
    fileInput.addEventListener('change',event=>{
      const file=event.target?.files?.[0];
      if(!file?.name?.toLowerCase().endsWith('.epub')) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      handleEpubOffMain(file);
    },true);
  }

  const dropZone=$('#dropZone');
  if(dropZone){
    dropZone.addEventListener('drop',event=>{
      const file=event.dataTransfer?.files?.[0];
      if(!file?.name?.toLowerCase().endsWith('.epub')) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      dropZone.classList.remove('dragover');
      handleEpubOffMain(file);
    },true);
  }

  const reader = document.getElementById('readerText');
  if(!reader) return;

  const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
  if(!descriptor?.set || !descriptor?.get) return;
  const nativeSet = descriptor.set;
  const nativeGet = descriptor.get;
  const WINDOW = 32;

  Object.defineProperty(reader, 'innerHTML', {
    configurable: true,
    enumerable: true,
    get(){ return nativeGet.call(this); },
    set(value){
      const html = String(value ?? '');
      const marker = 'data-segment=';
      let count = 0, pos = 0;
      while((pos = html.indexOf(marker,pos)) !== -1){ count++; pos += marker.length; }

      if(count <= 140){
        this.dataset.virtualTotal = String(count);
        nativeSet.call(this, html);
        return;
      }

      const re = /<p class="segment[^>]*data-segment="(\d+)"[^>]*>[\s\S]*?<\/p>/g;
      const rows = [];
      let active = 0, match;
      while((match = re.exec(html))){
        const index = Number(match[1]);
        if(match[0].includes(' active')) active = index;
        rows.push({index,html:match[0]});
      }
      if(!rows.length){ nativeSet.call(this,html); return; }

      const start = Math.max(0,active-WINDOW);
      const end = Math.min(rows.length,active+WINDOW+1);
      const en = document.documentElement.lang?.startsWith('en');
      const before = start>0 ? `<div class="virtual-note">${en?`Showing ${start+1}–${end} of ${rows.length} fragments`:`Mostrando fragmentos ${start+1}–${end} de ${rows.length}`}</div>` : '';
      const after = end<rows.length ? `<div class="virtual-note">${en?'Use Next/Previous or the fragment selector to continue':'Usa Siguiente/Anterior o el selector de fragmento para continuar'}</div>` : '';

      this.dataset.virtualTotal = String(rows.length);
      nativeSet.call(this,before+rows.slice(start,end).map(r=>r.html).join('')+after);
    }
  });
})();