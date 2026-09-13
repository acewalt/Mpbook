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
      const worker=new Worker('./storage-worker.js?v=18');
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

  /* EPUB reader: intentionally mirrors the original app's simple flow.
     Read ZIP -> flatten XHTML into plain text -> open immediately.
     No TTS/model work happens here. */
  function zipDirectory(buffer){
    const dv=new DataView(buffer),bytes=new Uint8Array(buffer);
    let eocd=-1;
    for(let i=buffer.byteLength-22;i>=Math.max(0,buffer.byteLength-65557);i--){
      if(dv.getUint32(i,true)===0x06054b50){eocd=i;break;}
    }
    if(eocd<0)throw new Error(tx('EPUB/ZIP inválido.','Invalid EPUB/ZIP.'));
    const count=dv.getUint16(eocd+10,true);
    let offset=dv.getUint32(eocd+16,true);
    const map=new Map();
    for(let i=0;i<count;i++){
      if(offset+46>buffer.byteLength||dv.getUint32(offset,true)!==0x02014b50)break;
      const method=dv.getUint16(offset+10,true);
      const size=dv.getUint32(offset+20,true);
      const nameLen=dv.getUint16(offset+28,true);
      const extraLen=dv.getUint16(offset+30,true);
      const commentLen=dv.getUint16(offset+32,true);
      const local=dv.getUint32(offset+42,true);
      const name=new TextDecoder().decode(bytes.subarray(offset+46,offset+46+nameLen));
      map.set(name,{method,size,local});
      offset+=46+nameLen+extraLen+commentLen;
    }
    return map;
  }

  async function zipRead(buffer,entry){
    const dv=new DataView(buffer);
    const localName=dv.getUint16(entry.local+26,true);
    const localExtra=dv.getUint16(entry.local+28,true);
    const start=entry.local+30+localName+localExtra;
    const packed=new Uint8Array(buffer,start,entry.size);
    if(entry.method===0)return packed;
    if(entry.method!==8)throw new Error(tx('Método ZIP no compatible.','Unsupported ZIP compression.'));
    if(!('DecompressionStream' in window))throw new Error(tx('Este navegador no puede descomprimir EPUB.','This browser cannot decompress EPUB.'));
    const stream=new Blob([packed]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  function normalizePath(path){
    const out=[];
    for(const raw of decodeURIComponent(String(path||'')).split('/')){
      if(!raw||raw==='.')continue;
      if(raw==='..')out.pop();else out.push(raw);
    }
    return out.join('/');
  }

  function htmlToPlain(html){
    const doc=new DOMParser().parseFromString(html,'text/html');
    if(!doc.body)return'';
    doc.body.querySelectorAll('script,style,nav,aside,figure,table,sup,svg,form,noscript').forEach(n=>n.remove());
    const out=[];
    const nodes=doc.body.querySelectorAll('h1,h2,h3,h4,h5,h6,p,blockquote,li,div,td');
    for(const el of nodes){
      if(el.querySelector('h1,h2,h3,h4,h5,h6,p,blockquote,li,div'))continue;
      let text=(el.textContent||'').replace(/\s+/g,' ').trim();
      if(!text)continue;
      if(/^H[1-6]$/.test(el.tagName)){
        text=text.replace(/[.!?。！？]$/,'')+'.';
        if(/^H[12]$/.test(el.tagName))text=CHAP_MARK+text;
      }
      out.push(text);
    }
    if(!out.length){
      const text=(doc.body.textContent||'').replace(/\s+/g,' ').trim();
      if(text)out.push(text);
    }
    return out.join('\n\n');
  }

  async function epubToCompactDoc(file){
    const buffer=await file.arrayBuffer();
    const entries=zipDirectory(buffer);
    const decoder=new TextDecoder();
    const readText=async path=>{
      const entry=entries.get(path);
      if(!entry)return null;
      return decoder.decode(await zipRead(buffer,entry));
    };

    const container=await readText('META-INF/container.xml');
    if(!container)throw new Error(tx('Falta container.xml.','Missing container.xml.'));
    const root=(container.match(/full-path\s*=\s*["']([^"']+)["']/i)||[])[1];
    if(!root)throw new Error(tx('No encontré el archivo OPF.','OPF file not found.'));
    const opfText=await readText(root);
    if(!opfText)throw new Error(tx('No pude leer el OPF.','Could not read OPF.'));

    const opf=new DOMParser().parseFromString(opfText,'application/xml');
    const title=(opf.getElementsByTagNameNS('*','title')[0]?.textContent||'').trim()||file.name.replace(/\.epub$/i,'');
    const manifest={};
    for(const item of opf.querySelectorAll('manifest > item')){
      const id=item.getAttribute('id'),href=item.getAttribute('href');
      if(id&&href)manifest[id]=href;
    }
    const refs=[...opf.querySelectorAll('spine > itemref')]
      .map(x=>manifest[x.getAttribute('idref')])
      .filter(Boolean);
    if(!refs.length)throw new Error(tx('El EPUB no tiene contenido de lectura.','The EPUB has no readable spine.'));

    const base=root.includes('/')?root.slice(0,root.lastIndexOf('/')+1):'';
    const parts=[];
    for(const href of refs){
      const path=normalizePath(base+href.replace(/#.*$/,''));
      const html=await readText(path);
      if(!html)continue;
      const plain=htmlToPlain(html);
      if(plain)parts.push(plain);
    }
    const raw=parts.join('\n\n').trim();
    if(!raw)throw new Error(tx('El EPUB no contiene texto legible.','The EPUB contains no readable text.'));
    return {
      id:`epub:${file.name}:${file.size}:${file.lastModified}`,
      title,
      type:'EPUB',
      filename:file.name,
      raw,
      plain:true,
      updatedAt:Date.now()
    };
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
      if(raw.includes(CHAP_MARK)&&sep>=0){
        title=chunk.slice(0,sep).replace(/[\r\n]+/g,' ').replace(/[.]$/,'').trim()||title;
        body=chunk.slice(sep+2);
      }
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
    const dropTitle=$('#dropZone strong');
    const oldText=dropTitle?.textContent||'';
    if(dropTitle)dropTitle.textContent=file.name;
    try{
      const doc=await epubToCompactDoc(file);
      // Open first, exactly like the original flow. Persistence happens afterwards.
      await openCompactDoc(doc);
      putFastDoc(doc).catch(err=>console.warn('MPBook background library save failed',err));
      toast(tx('Libro cargado.','Book loaded.'),1800);
    }catch(err){
      console.error('MPBook EPUB import failed',err);
      if(dropTitle)dropTitle.textContent=oldText;
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
    const docs=await combinedMeta();
    empty.hidden=docs.length>0;
    list.innerHTML=docs.map(d=>`<div class="library-item" data-id="${String(d.id).replace(/"/g,'&quot;')}"><div><strong></strong><small>${d.type||'EPUB'} · ${d.chapters||0} ${tx('capítulos','chapters')}</small></div><div class="library-item-actions"><button class="tiny-btn open-book" type="button">${tx('Abrir','Open')}</button><button class="tiny-btn delete-book" type="button">${tx('Eliminar','Delete')}</button></div></div>`).join('');
    [...list.querySelectorAll('.library-item')].forEach((row,i)=>{row.querySelector('strong').textContent=docs[i].title||tx('Libro','Book');});
  }

  async function openById(id){
    let doc=await getFastDoc(id);
    if(!doc){
      doc=await legacyCall('compact',{id});
      if(doc?.raw)putFastDoc(doc).catch(()=>{});
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
      openById(row.dataset.id)
        .then(()=>{try{$('#libraryDialog')?.close();}catch{}})
        .catch(err=>toast(`${tx('No pude abrir el libro.','I could not open the book.')} ${String(err?.message||err)}`,7000))
        .finally(()=>open.disabled=false);
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