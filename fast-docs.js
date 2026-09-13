(() => {
  'use strict';

  const CHAP_MARK='\u0001';
  const FAST_DB='mpbook-fastdocs';
  const DOCS='docs';
  const META='meta';
  const $=s=>document.querySelector(s);
  const tx=(es,en)=>document.documentElement.lang?.startsWith('en')?en:es;

  function toast(message,ms=3500){
    const el=$('#toast');
    if(!el)return;
    el.textContent=message;
    el.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer=setTimeout(()=>el.classList.remove('show'),ms);
  }

  function openFastDB(){
    return new Promise((resolve,reject)=>{
      const req=indexedDB.open(FAST_DB,1);
      req.onupgradeneeded=()=>{
        const db=req.result;
        if(!db.objectStoreNames.contains(DOCS))db.createObjectStore(DOCS,{keyPath:'id'});
        if(!db.objectStoreNames.contains(META))db.createObjectStore(META,{keyPath:'id'});
      };
      req.onsuccess=()=>resolve(req.result);
      req.onerror=()=>reject(req.error||new Error('Fast library open failed'));
    });
  }

  function chapterCount(raw){
    let n=0,pos=0;
    while((pos=String(raw||'').indexOf(CHAP_MARK,pos))!==-1){n++;pos++;}
    return Math.max(1,n);
  }

  async function putFastDoc(doc){
    const db=await openFastDB();
    try{
      await new Promise((resolve,reject)=>{
        const tx=db.transaction([DOCS,META],'readwrite');
        tx.objectStore(DOCS).put(doc);
        tx.objectStore(META).put({id:doc.id,title:doc.title||'Libro',type:doc.type||'EPUB',updatedAt:doc.updatedAt||Date.now(),chapters:chapterCount(doc.raw)});
        tx.oncomplete=resolve;
        tx.onerror=()=>reject(tx.error||new Error('Fast library save failed'));
        tx.onabort=()=>reject(tx.error||new Error('Fast library save aborted'));
      });
    } finally {try{db.close();}catch{}}
  }

  async function getFastDoc(id){
    const db=await openFastDB();
    try{
      return await new Promise((resolve,reject)=>{
        const req=db.transaction(DOCS,'readonly').objectStore(DOCS).get(id);
        req.onsuccess=()=>resolve(req.result||null);
        req.onerror=()=>reject(req.error||new Error('Fast document read failed'));
      });
    } finally {try{db.close();}catch{}}
  }

  async function listFastMeta(){
    const db=await openFastDB();
    try{
      return await new Promise((resolve,reject)=>{
        const req=db.transaction(META,'readonly').objectStore(META).getAll();
        req.onsuccess=()=>resolve((req.result||[]).sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0)));
        req.onerror=()=>reject(req.error||new Error('Fast library list failed'));
      });
    } finally {try{db.close();}catch{}}
  }

  async function deleteFastDoc(id){
    const db=await openFastDB();
    try{
      await new Promise((resolve,reject)=>{
        const tx=db.transaction([DOCS,META],'readwrite');
        tx.objectStore(DOCS).delete(id);
        tx.objectStore(META).delete(id);
        tx.oncomplete=resolve;
        tx.onerror=()=>reject(tx.error||new Error('Fast library delete failed'));
      });
    } finally {try{db.close();}catch{}}
  }

  function legacyCall(type,payload={}){
    return new Promise((resolve,reject)=>{
      const worker=new Worker('./storage-worker.js?v=17');
      const requestId=1;
      let finished=false;
      const timer=setTimeout(()=>finish(reject,new Error('Legacy library timeout')),30000);
      function finish(fn,value){
        if(finished)return;
        finished=true;clearTimeout(timer);try{worker.terminate();}catch{}fn(value);
      }
      worker.onmessage=e=>{
        const m=e.data||{};if(m.requestId!==requestId)return;
        if(m.type==='result')finish(resolve,m.result);
        else if(m.type==='error')finish(reject,new Error(m.message||'Legacy library error'));
      };
      worker.onerror=e=>finish(reject,new Error(e?.message||'Legacy library worker error'));
      worker.postMessage({type,requestId,...payload});
    });
  }

  function parseCompactEpub(file){
    return file.arrayBuffer().then(buffer=>new Promise((resolve,reject)=>{
      const worker=new Worker('./epub-worker.js?v=17');
      let finished=false;
      const timer=setTimeout(()=>finish(reject,new Error('EPUB timeout')),60000);
      function finish(fn,value){
        if(finished)return;
        finished=true;clearTimeout(timer);try{worker.terminate();}catch{}fn(value);
      }
      worker.onmessage=e=>{
        const m=e.data||{};
        if(m.type==='progress'){
          if(m.value===5||m.value>=90||m.done===m.total)toast(`${tx('Procesando EPUB','Processing EPUB')}… ${m.value||0}%`,2500);
          return;
        }
        if(m.type==='result-compact')finish(resolve,m.doc);
        else if(m.type==='error')finish(reject,new Error(m.message||'EPUB error'));
      };
      worker.onerror=e=>finish(reject,new Error(e?.message||'EPUB worker error'));
      worker.postMessage({type:'parse-compact',buffer,meta:{name:file.name,size:file.size,lastModified:file.lastModified},lang:document.documentElement.lang?.startsWith('en')?'en':'es'},[buffer]);
    }));
  }

  function splitSegments(text,max=680){
    const clean=String(text||'').replace(/\r/g,'').replace(/[ \t]+/g,' ').replace(/\n{3,}/g,'\n\n').trim();
    if(!clean)return[];
    const paras=clean.split(/\n{2,}/).map(x=>x.trim()).filter(Boolean),out=[];
    for(const p of paras){
      if(p.length<=max){out.push(p);continue;}
      const sentences=p.match(/[^.!?。！？]+[.!?。！？]+|[^.!?。！？]+$/g)||[p];
      let cur='';
      for(const raw of sentences){
        const s=raw.trim();if(!s)continue;
        if((cur+' '+s).trim().length<=max)cur=(cur+' '+s).trim();
        else{
          if(cur)out.push(cur);
          if(s.length<=max)cur=s;
          else{for(let i=0;i<s.length;i+=max)out.push(s.slice(i,i+max));cur='';}
        }
      }
      if(cur)out.push(cur);
    }
    return out;
  }

  function rawToBook(doc){
    const raw=String(doc.raw||'');
    const chunks=raw.includes(CHAP_MARK)?raw.split(CHAP_MARK).filter(x=>x.trim()):[raw];
    const chapters=[];
    for(let i=0;i<chunks.length;i++){
      const chunk=chunks[i].trim();if(!chunk)continue;
      let title=`${tx('Capítulo','Chapter')} ${i+1}`,body=chunk;
      const sep=chunk.indexOf('\n\n');
      if(raw.includes(CHAP_MARK)&&sep>=0){title=chunk.slice(0,sep).replace(/[\r\n]+/g,' ').trim()||title;body=chunk.slice(sep+2);}
      const segments=splitSegments(body);
      if(segments.length)chapters.push({title,segments});
    }
    if(!chapters.length)chapters.push({title:doc.title||tx('Libro','Book'),segments:splitSegments(raw)});
    return {id:doc.id,title:doc.title||tx('Libro','Book'),type:doc.type||'EPUB',filename:doc.filename||'',chapters,updatedAt:doc.updatedAt||Date.now()};
  }

  async function openCompactDoc(doc){
    if(!doc?.raw)throw new Error(tx('El libro no contiene texto.','The book contains no text.'));
    const book=rawToBook(doc);
    if(typeof window.MPBookOpenBook!=='function')throw new Error('MPBook reader unavailable');
    window.MPBookCurrentBook=book;
    await window.MPBookOpenBook(book,true);
  }

  async function importEpub(file){
    toast(tx('Procesando EPUB…','Processing EPUB…'),3000);
    try{
      const doc=await parseCompactEpub(file);
      await putFastDoc(doc);
      await openCompactDoc(doc);
      toast(tx('Libro cargado.','Book loaded.'),2200);
    }catch(err){
      console.error('MPBook compact EPUB import failed',err);
      toast(`${tx('No pude abrir este EPUB.','I could not open this EPUB.')} ${String(err?.message||err)}`,7000);
    }finally{
      const input=$('#fileInput');if(input)input.value='';
    }
  }

  async function combinedMeta(){
    let fast=[],legacy=[];
    try{fast=await listFastMeta();}catch{}
    try{legacy=await legacyCall('list');}catch{}
    const map=new Map();
    for(const m of legacy||[])map.set(m.id,{...m,legacy:true});
    for(const m of fast||[])map.set(m.id,{...m,legacy:false});
    return [...map.values()].sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0));
  }

  async function renderFastLibrary(){
    const list=$('#libraryList'),empty=$('#emptyLibrary');if(!list)return;
    list.innerHTML=`<div class="virtual-note">${tx('Cargando biblioteca…','Loading library…')}</div>`;
    const docs=await combinedMeta();
    empty.hidden=docs.length>0;
    list.innerHTML=docs.map(d=>`<div class="library-item" data-id="${String(d.id).replace(/"/g,'&quot;')}"><div><strong></strong><small>${d.type||'EPUB'} · ${d.chapters||0} ${tx('capítulos','chapters')}</small></div><div class="library-item-actions"><button class="tiny-btn open-book" type="button">${tx('Abrir','Open')}</button><button class="tiny-btn delete-book" type="button">${tx('Eliminar','Delete')}</button></div></div>`).join('');
    [...list.querySelectorAll('.library-item')].forEach((row,i)=>{row.querySelector('strong').textContent=docs[i].title||tx('Libro','Book');});
  }

  async function openById(id){
    let doc=await getFastDoc(id);
    if(!doc){
      toast(tx('Migrando libro antiguo…','Migrating old book…'),4000);
      doc=await legacyCall('compact',{id});
      if(doc?.raw)await putFastDoc(doc);
    }
    if(!doc)throw new Error('Book not found');
    await openCompactDoc(doc);
  }

  document.addEventListener('change',event=>{
    if(event.target?.id!=='fileInput')return;
    const file=event.target.files?.[0];
    if(!file?.name?.toLowerCase().endsWith('.epub'))return;
    event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();
    importEpub(file);
  },true);

  document.addEventListener('drop',event=>{
    const file=event.dataTransfer?.files?.[0];
    if(!file?.name?.toLowerCase().endsWith('.epub'))return;
    event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();
    $('#dropZone')?.classList.remove('dragover');
    importEpub(file);
  },true);

  document.addEventListener('click',event=>{
    if(event.target?.closest?.('#libraryBtn')){
      event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();
      renderFastLibrary().then(()=>$('#libraryDialog')?.showModal()).catch(err=>toast(String(err?.message||err),6000));
      return;
    }
    const open=event.target?.closest?.('#libraryList .open-book');
    if(open){
      const row=open.closest('.library-item');if(!row)return;
      event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();
      open.disabled=true;
      openById(row.dataset.id).then(()=>{try{$('#libraryDialog')?.close();}catch{}toast(tx('Libro abierto.','Book opened.'),1800);}).catch(err=>toast(`${tx('No pude abrir el libro.','I could not open the book.')} ${String(err?.message||err)}`,7000)).finally(()=>open.disabled=false);
      return;
    }
    const del=event.target?.closest?.('#libraryList .delete-book');
    if(del){
      const row=del.closest('.library-item');if(!row)return;
      event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();
      if(!confirm(tx('¿Eliminar este libro de la biblioteca?','Delete this book from the library?')))return;
      Promise.allSettled([deleteFastDoc(row.dataset.id),legacyCall('delete',{id:row.dataset.id})]).then(renderFastLibrary);
    }
  },true);
})();