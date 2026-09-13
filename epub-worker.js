'use strict';

const dec = new TextDecoder();
const DB_NAME='mpbook-library';
const STORE='books';

function u16(dv,o){ return dv.getUint16(o,true); }
function u32(dv,o){ return dv.getUint32(o,true); }

function openDB(){
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open(DB_NAME,1);
    req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains(STORE))req.result.createObjectStore(STORE,{keyPath:'id'});};
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error||new Error('IndexedDB open failed'));
  });
}
async function saveBook(book){
  const db=await openDB();
  try{
    await new Promise((resolve,reject)=>{
      const tx=db.transaction(STORE,'readwrite');
      tx.objectStore(STORE).put(book);
      tx.oncomplete=()=>resolve();
      tx.onerror=()=>reject(tx.error||new Error('Book save failed'));
      tx.onabort=()=>reject(tx.error||new Error('Book save aborted'));
    });
  } finally {try{db.close();}catch{}}
}

function normalizePath(base, href){
  if(/^https?:/i.test(href)) return href;
  const baseParts = base ? base.split('/').slice(0,-1) : [];
  const parts = baseParts.concat(String(href||'').split('/'));
  const out=[];
  for(const p0 of parts){
    const p = p0.trim();
    if(!p || p==='.') continue;
    if(p==='..') out.pop(); else out.push(p);
  }
  return out.join('/');
}

function decodeEntities(text){
  return String(text||'')
    .replace(/&#x([0-9a-f]+);/gi,(_,h)=>{try{return String.fromCodePoint(parseInt(h,16));}catch{return ' ';}})
    .replace(/&#(\d+);/g,(_,d)=>{try{return String.fromCodePoint(parseInt(d,10));}catch{return ' ';}})
    .replace(/&nbsp;|&#160;/gi,' ')
    .replace(/&amp;/gi,'&')
    .replace(/&lt;/gi,'<')
    .replace(/&gt;/gi,'>')
    .replace(/&quot;/gi,'"')
    .replace(/&apos;|&#39;/gi,"'")
    .replace(/&[a-z][a-z0-9]+;/gi,' ');
}

function stripTags(html){
  return decodeEntities(String(html||'')
    .replace(/<br\s*\/?\s*>/gi,'\n')
    .replace(/<[^>]+>/g,' '))
    .replace(/\u00a0/g,' ')
    .replace(/[ \t]+/g,' ')
    .replace(/\s*\n\s*/g,'\n')
    .trim();
}

function attrMap(source){
  const out={};
  const re=/([\w:-]+)\s*=\s*(["'])([\s\S]*?)\2/g;
  let m;
  while((m=re.exec(source))) out[m[1].toLowerCase()] = decodeEntities(m[3]);
  return out;
}

function splitSegments(text,max=680){
  const clean=String(text||'').replace(/\r/g,'').replace(/[ \t]+/g,' ').replace(/\n{3,}/g,'\n\n').trim();
  if(!clean) return [];
  const paras=clean.split(/\n{2,}/).map(x=>x.trim()).filter(Boolean);
  const out=[];
  for(const p of paras){
    if(p.length<=max){out.push(p);continue;}
    const sentences=p.match(/[^.!?。！？]+[.!?。！？]+|[^.!?。！？]+$/g)||[p];
    let cur='';
    for(const s0 of sentences){
      const s=s0.trim(); if(!s)continue;
      if((cur+' '+s).trim().length<=max) cur=(cur+' '+s).trim();
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

async function unzipEntries(buffer){
  const bytes=new Uint8Array(buffer), dv=new DataView(buffer); let eocd=-1;
  for(let i=bytes.length-22;i>=Math.max(0,bytes.length-66000);i--){
    if(u32(dv,i)===0x06054b50){eocd=i;break;}
  }
  if(eocd<0) throw new Error('ZIP EOCD not found');
  const total=u16(dv,eocd+10), cdOffset=u32(dv,eocd+16); let p=cdOffset; const files=new Map();
  for(let n=0;n<total;n++){
    if(p+46>dv.byteLength || u32(dv,p)!==0x02014b50) throw new Error('Bad central directory');
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
    if(typeof DecompressionStream!=='function') throw new Error('DecompressionStream unavailable');
    const stream=new Blob([f.data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  return {files,read};
}

function extractRootfile(xml){
  const m=String(xml||'').match(/<rootfile\b[^>]*\bfull-path\s*=\s*(["'])(.*?)\1/i);
  return m ? decodeEntities(m[2]).trim() : '';
}

function extractTitle(opf, fallback){
  const m=String(opf||'').match(/<(?:dc:)?title\b[^>]*>([\s\S]*?)<\/(?:dc:)?title>/i);
  const title=m?stripTags(m[1]):'';
  return title||fallback;
}

function parseManifest(opf){
  const map=new Map();
  const manifestSection=(String(opf).match(/<manifest\b[^>]*>([\s\S]*?)<\/manifest>/i)||[])[1]||String(opf);
  const re=/<item\b([^>]*?)\/?\s*>/gi; let m;
  while((m=re.exec(manifestSection))){
    const a=attrMap(m[1]);
    if(a.id&&a.href) map.set(a.id,{href:a.href,media:a['media-type']||''});
  }
  return map;
}

function parseSpine(opf){
  const spineSection=(String(opf).match(/<spine\b[^>]*>([\s\S]*?)<\/spine>/i)||[])[1]||String(opf);
  const ids=[]; const re=/<itemref\b([^>]*?)\/?\s*>/gi; let m;
  while((m=re.exec(spineSection))){const a=attrMap(m[1]);if(a.idref)ids.push(a.idref);}
  return ids;
}

function htmlToChapter(html, fallbackTitle){
  let clean=String(html||'')
    .replace(/<(script|style|nav|aside|svg|form|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,' ')
    .replace(/<!--([\s\S]*?)-->/g,' ');
  const titleMatch=clean.match(/<h[1-3]\b[^>]*>([\s\S]*?)<\/h[1-3]\s*>/i) || clean.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i);
  const title=titleMatch?stripTags(titleMatch[1]):fallbackTitle;
  const blocks=[]; const re=/<(h[1-6]|p|li|blockquote)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi; let m;
  while((m=re.exec(clean))){
    const txt=stripTags(m[2]);
    if(txt) blocks.push(txt);
  }
  let text=blocks.join('\n\n');
  if(!text){
    const body=(clean.match(/<body\b[^>]*>([\s\S]*?)<\/body\s*>/i)||[])[1]||clean;
    text=stripTags(body);
  }
  return {title:title||fallbackTitle,text};
}

async function parseEpub(buffer, meta, lang){
  const zip=await unzipEntries(buffer);
  postMessage({type:'progress',stage:'zip',value:5});
  const container=dec.decode(await zip.read('META-INF/container.xml'));
  const rootfile=extractRootfile(container);
  if(!rootfile) throw new Error('No OPF');
  const opfText=dec.decode(await zip.read(rootfile));
  const fallbackName=String(meta.name||'Libro').replace(/\.epub$/i,'');
  const title=extractTitle(opfText,fallbackName);
  const manifest=parseManifest(opfText);
  const spine=parseSpine(opfText);
  if(!spine.length) throw new Error('No spine');
  const chapters=[];
  for(let i=0;i<spine.length;i++){
    const item=manifest.get(spine[i]);
    if(item?.href){
      const path=normalizePath(rootfile,item.href.split('#')[0]);
      if(zip.files.has(path)){
        try{
          const html=dec.decode(await zip.read(path));
          const fallback=`${lang==='en'?'Chapter':'Capítulo'} ${chapters.length+1}`;
          const parsed=htmlToChapter(html,fallback);
          const segments=splitSegments(parsed.text);
          if(segments.length) chapters.push({title:parsed.title||fallback,segments});
        }catch{}
      }
    }
    if(i%2===0 || i===spine.length-1){
      const pct=10+Math.round(((i+1)/spine.length)*84);
      postMessage({type:'progress',stage:'chapters',value:pct,done:i+1,total:spine.length});
    }
  }
  if(!chapters.length) throw new Error('No readable chapters');
  const book={id:`epub:${meta.name}:${meta.size}:${meta.lastModified}`,title,type:'EPUB',filename:meta.name,chapters,updatedAt:Date.now()};
  postMessage({type:'progress',stage:'saving',value:96,done:spine.length,total:spine.length});
  await saveBook(book);
  postMessage({type:'progress',stage:'saving',value:99,done:spine.length,total:spine.length});
  return book;
}

self.onmessage=async event=>{
  const msg=event.data||{};
  if(msg.type!=='parse') return;
  try{
    const book=await parseEpub(msg.buffer,msg.meta||{},msg.lang||'es');
    postMessage({type:'result',book});
  }catch(err){
    postMessage({type:'error',message:String(err?.message||err)});
  }
};
