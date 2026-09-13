const dec = new TextDecoder();

function u16(dv,o){ return dv.getUint16(o,true); }
function u32(dv,o){ return dv.getUint32(o,true); }

function attr(tag,name){
  const m=tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`,'i'));
  return m ? m[1] : '';
}

function normalizePath(base,href){
  if(/^https?:/i.test(href)) return href;
  const parts=(base?base.split('/').slice(0,-1):[]).concat(String(href||'').split('/'));
  const out=[];
  for(const p of parts){ if(!p||p==='.') continue; if(p==='..') out.pop(); else out.push(p); }
  return out.join('/');
}

function decodeEntities(text){
  const named={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '};
  return String(text||'').replace(/&(#x?[0-9a-f]+|[a-z]+);/gi,(m,k)=>{
    const key=k.toLowerCase();
    if(key[0]==='#'){
      const hex=key[1]==='x';
      const n=parseInt(key.slice(hex?2:1),hex?16:10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return Object.prototype.hasOwnProperty.call(named,key) ? named[key] : m;
  });
}

function stripMarkup(html){
  let s=String(html||'');
  s=s.replace(/<!--[^]*?-->/g,' ')
    .replace(/<(script|style|nav|aside|svg|form|noscript)\b[^>]*>[^]*?<\/\1\s*>/gi,' ')
    .replace(/<br\s*\/?\s*>/gi,'\n')
    .replace(/<\/(?:p|div|li|blockquote|h[1-6]|section|article|tr)>/gi,'\n\n')
    .replace(/<[^>]+>/g,' ');
  return decodeEntities(s).replace(/\u00a0/g,' ').replace(/[ \t]+/g,' ').replace(/\n[ \t]+/g,'\n').replace(/\n{3,}/g,'\n\n').trim();
}

function firstHeading(html){
  const m=String(html||'').match(/<(h1|h2|h3|title)\b[^>]*>([^]*?)<\/\1\s*>/i);
  return m ? stripMarkup(m[2]).replace(/\s+/g,' ').trim() : '';
}

function splitSegments(text,max=680){
  const clean=String(text||'').replace(/\r/g,'').replace(/[ \t]+/g,' ').replace(/\n{3,}/g,'\n\n').trim();
  if(!clean) return [];
  const paras=clean.split(/\n{2,}/).map(x=>x.trim()).filter(Boolean);
  const out=[];
  for(const p of paras){
    if(p.length<=max){ out.push(p); continue; }
    const sentences=p.match(/[^.!?。！？]+[.!?。！？]+|[^.!?。！？]+$/g) || [p];
    let cur='';
    for(const s0 of sentences){
      const s=s0.trim(); if(!s) continue;
      if((cur+' '+s).trim().length<=max) cur=(cur+' '+s).trim();
      else {
        if(cur) out.push(cur);
        if(s.length<=max) cur=s;
        else { for(let i=0;i<s.length;i+=max) out.push(s.slice(i,i+max)); cur=''; }
      }
    }
    if(cur) out.push(cur);
  }
  return out;
}

async function unzipEntries(buffer){
  const bytes=new Uint8Array(buffer), dv=new DataView(buffer); let eocd=-1;
  for(let i=bytes.length-22;i>=Math.max(0,bytes.length-66000);i--){ if(u32(dv,i)===0x06054b50){ eocd=i; break; } }
  if(eocd<0) throw new Error('ZIP EOCD not found');
  const total=u16(dv,eocd+10), cdOffset=u32(dv,eocd+16); let p=cdOffset; const files=new Map();
  if(total>20000) throw new Error('EPUB has too many ZIP entries');
  for(let n=0;n<total;n++){
    if(p+46>bytes.length || u32(dv,p)!==0x02014b50) throw new Error('Bad central directory');
    const method=u16(dv,p+10), compSize=u32(dv,p+20), nameLen=u16(dv,p+28), extraLen=u16(dv,p+30), commentLen=u16(dv,p+32), local=u32(dv,p+42);
    const name=dec.decode(bytes.slice(p+46,p+46+nameLen));
    const localNameLen=u16(dv,local+26), localExtraLen=u16(dv,local+28), start=local+30+localNameLen+localExtraLen;
    files.set(name,{method,start,size:compSize});
    p+=46+nameLen+extraLen+commentLen;
  }
  async function read(path){
    const f=files.get(path); if(!f) throw new Error('Missing '+path);
    const data=bytes.slice(f.start,f.start+f.size);
    if(f.method===0) return data;
    if(f.method!==8) throw new Error('Unsupported ZIP method '+f.method);
    if(typeof DecompressionStream!=='function') throw new Error('DecompressionStream unavailable');
    const stream=new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  return {files,read};
}

async function parseEpub(file,lang='es'){
  const zip=await unzipEntries(await file.arrayBuffer());
  const containerText=dec.decode(await zip.read('META-INF/container.xml'));
  const rootMatch=containerText.match(/<rootfile\b[^>]*\bfull-path\s*=\s*["']([^"']+)["']/i);
  const rootfile=rootMatch?.[1];
  if(!rootfile) throw new Error('No OPF');

  const opfText=dec.decode(await zip.read(rootfile));
  const titleMatch=opfText.match(/<(?:dc:)?title\b[^>]*>([^]*?)<\/(?:dc:)?title\s*>/i);
  const title=(titleMatch?stripMarkup(titleMatch[1]):'').trim() || file.name.replace(/\.epub$/i,'');

  const manifest=new Map();
  for(const m of opfText.matchAll(/<item\b[^>]*>/gi)){
    const tag=m[0], id=attr(tag,'id'), href=attr(tag,'href');
    if(id&&href) manifest.set(id,{href,media:attr(tag,'media-type')||''});
  }
  const spine=[];
  for(const m of opfText.matchAll(/<itemref\b[^>]*>/gi)){
    const idref=attr(m[0],'idref'); if(idref) spine.push(idref);
  }
  if(spine.length>5000) throw new Error('EPUB spine is too large');

  const chapters=[];
  for(let i=0;i<spine.length;i++){
    const item=manifest.get(spine[i]); if(!item?.href) continue;
    const path=normalizePath(rootfile,item.href.split('#')[0]);
    if(!zip.files.has(path)) continue;
    let html='';
    try{ html=dec.decode(await zip.read(path)); }catch{ continue; }
    if(html.length>12_000_000) continue;
    const text=stripMarkup(html);
    if(!text) continue;
    const chTitle=firstHeading(html) || `${lang==='en'?'Chapter':'Capítulo'} ${chapters.length+1}`;
    const segments=splitSegments(text);
    if(segments.length) chapters.push({title:chTitle,segments});
    if(i%8===0) self.postMessage({type:'progress',value:Math.round((i+1)*100/Math.max(1,spine.length))});
  }
  if(!chapters.length) throw new Error('No readable chapters');
  return {id:`epub:${file.name}:${file.size}:${file.lastModified}`,title,type:'EPUB',filename:file.name,chapters,updatedAt:Date.now()};
}

self.addEventListener('message',async event=>{
  const msg=event.data||{};
  if(msg.type!=='parse') return;
  try{
    const book=await parseEpub(msg.file,msg.lang||'es');
    self.postMessage({type:'result',book});
  }catch(err){
    self.postMessage({type:'error',message:String(err?.message||err),stack:err?.stack||''});
  }
});
