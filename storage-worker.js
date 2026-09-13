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
