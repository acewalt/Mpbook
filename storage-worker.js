'use strict';

const DB_NAME='mpbook-library';
const STORE='books';

function openDB(){
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open(DB_NAME,1);
    req.onupgradeneeded=()=>{
      if(!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE,{keyPath:'id'});
    };
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error||new Error('IndexedDB open failed'));
  });
}

async function listBooks(){
  const db=await openDB();
  try{
    return await new Promise((resolve,reject)=>{
      const tx=db.transaction(STORE,'readonly');
      const store=tx.objectStore(STORE);
      const out=[];
      const req=store.openCursor();
      req.onsuccess=()=>{
        const cursor=req.result;
        if(!cursor){
          out.sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0));
          resolve(out);
          return;
        }
        const b=cursor.value||{};
        out.push({
          id:b.id,
          title:b.title||'Libro',
          type:b.type||'EPUB',
          chapters:Array.isArray(b.chapters)?b.chapters.length:0,
          updatedAt:b.updatedAt||0
        });
        cursor.continue();
      };
      req.onerror=()=>reject(req.error||new Error('Library list failed'));
    });
  } finally { try{db.close();}catch{} }
}

async function getBook(id){
  const db=await openDB();
  try{
    return await new Promise((resolve,reject)=>{
      const req=db.transaction(STORE,'readonly').objectStore(STORE).get(id);
      req.onsuccess=()=>resolve(req.result||null);
      req.onerror=()=>reject(req.error||new Error('Book read failed'));
    });
  } finally { try{db.close();}catch{} }
}

async function streamBook(id,requestId){
  // IndexedDB clones the legacy large object inside this worker, not on the UI thread.
  // We then transfer one chapter per task so the browser UI never receives one huge
  // structured-clone payload at once.
  const book=await getBook(id);
  if(!book){
    postMessage({requestId,type:'error',message:'Book not found'});
    return;
  }
  const chapters=Array.isArray(book.chapters)?book.chapters:[];
  const meta={
    id:book.id,
    title:book.title||'Libro',
    type:book.type||'EPUB',
    filename:book.filename||'',
    updatedAt:book.updatedAt||0,
    chapterCount:chapters.length,
    totalSegments:chapters.reduce((n,c)=>n+(Array.isArray(c?.segments)?c.segments.length:0),0)
  };
  postMessage({requestId,type:'stream-meta',meta});
  for(let i=0;i<chapters.length;i++){
    const c=chapters[i]||{};
    // Copy only the fields the reader needs and send a single chapter at a time.
    postMessage({
      requestId,
      type:'stream-chapter',
      index:i,
      chapter:{title:c.title||`Capítulo ${i+1}`,segments:Array.isArray(c.segments)?c.segments:[]}
    });
    if(i%3===2) await new Promise(r=>setTimeout(r,0));
  }
  postMessage({requestId,type:'stream-end'});
}

async function putBook(book){
  const db=await openDB();
  try{
    return await new Promise((resolve,reject)=>{
      const tx=db.transaction(STORE,'readwrite');
      tx.objectStore(STORE).put(book);
      tx.oncomplete=()=>resolve(true);
      tx.onerror=()=>reject(tx.error||new Error('Book save failed'));
      tx.onabort=()=>reject(tx.error||new Error('Book save aborted'));
    });
  } finally { try{db.close();}catch{} }
}

async function deleteBook(id){
  const db=await openDB();
  try{
    return await new Promise((resolve,reject)=>{
      const tx=db.transaction(STORE,'readwrite');
      tx.objectStore(STORE).delete(id);
      tx.oncomplete=()=>resolve(true);
      tx.onerror=()=>reject(tx.error||new Error('Book delete failed'));
    });
  } finally { try{db.close();}catch{} }
}

self.onmessage=async event=>{
  const msg=event.data||{};
  const id=msg.requestId;
  try{
    if(msg.type==='stream'){
      await streamBook(msg.id,id);
      return;
    }
    let result=null;
    if(msg.type==='list') result=await listBooks();
    else if(msg.type==='get') result=await getBook(msg.id);
    else if(msg.type==='put') result=await putBook(msg.book);
    else if(msg.type==='delete') result=await deleteBook(msg.id);
    else throw new Error('Unknown storage request');
    postMessage({requestId:id,type:'result',result});
  }catch(err){
    postMessage({requestId:id,type:'error',message:String(err?.message||err)});
  }
};