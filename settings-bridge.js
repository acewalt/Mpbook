(() => {
  'use strict';

  const $=s=>document.querySelector(s);
  const tx=(es,en)=>document.documentElement.lang?.startsWith('en')?en:es;

  function toast(message,ms=5000){
    const el=$('#toast');
    if(!el)return;
    el.textContent=message;
    el.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer=setTimeout(()=>el.classList.remove('show'),ms);
  }

  function installSettings(){
    const form=$('#settingsForm');
    if(!form)return;
    form.addEventListener('submit',event=>{
      if(event.submitter?.value==='cancel')return;
      const engine=$('#engineSelect')?.value;
      if(engine!=='natural')return;
      const lang=$('#speechLang')?.value||'es-ES';
      const voice=$('#naturalVoice')?.value||'';
      const rate=$('#rateInput')?.value||'1';
      const pitch=$('#pitchInput')?.value||'1';
      localStorage.setItem('mpbook.engine','natural');
      localStorage.setItem('mpbook.speechLang',lang);
      localStorage.setItem('mpbook.rate',String(rate));
      localStorage.setItem('mpbook.pitch',String(pitch));
      if(voice)localStorage.setItem(`mpbook.naturalVoice.${lang}`,voice);
      const badge=$('#engineBadge');
      if(badge)badge.textContent=lang.startsWith('en-')?'Kokoro':'Piper';
    },true);
  }

  let opening=false;
  function streamBook(id){
    return new Promise((resolve,reject)=>{
      const worker=new Worker('./storage-worker.js?v=16');
      const requestId=1;
      let book=null,received=0,total=0,finished=false;
      const timer=setTimeout(()=>finish(reject,new Error(tx('La apertura tardó demasiado.','Opening timed out.'))),120000);
      function finish(fn,value){
        if(finished)return;
        finished=true;
        clearTimeout(timer);
        try{worker.terminate();}catch{}
        fn(value);
      }
      worker.onerror=e=>finish(reject,new Error(e?.message||'Storage worker error'));
      worker.onmessage=e=>{
        const m=e.data||{};
        if(m.requestId!==requestId)return;
        if(m.type==='error')return finish(reject,new Error(m.message||'Book read failed'));
        if(m.type==='stream-meta'){
          total=Number(m.meta?.chapterCount||0);
          book={id:m.meta.id,title:m.meta.title,type:m.meta.type,filename:m.meta.filename||'',updatedAt:m.meta.updatedAt||0,chapters:new Array(total)};
          toast(`${tx('Abriendo libro','Opening book')}… 0/${total}`,10000);
          return;
        }
        if(m.type==='stream-chapter'){
          if(!book)return;
          book.chapters[m.index]=m.chapter;
          received++;
          if(received===1||received===total||received%4===0){
            const pct=total?Math.round(received*100/total):0;
            toast(`${tx('Abriendo libro','Opening book')}… ${received}/${total} · ${pct}%`,10000);
          }
          return;
        }
        if(m.type==='stream-end'){
          if(!book)return finish(reject,new Error('Missing book metadata'));
          book.chapters=book.chapters.filter(Boolean);
          finish(resolve,book);
        }
      };
      worker.postMessage({type:'stream',requestId,id});
    });
  }

  async function openStreamed(row){
    if(opening)return;
    opening=true;
    const button=row.querySelector('.open-book');
    if(button)button.disabled=true;
    try{
      const book=await streamBook(row.dataset.id);
      if(typeof window.MPBookOpenBook!=='function')throw new Error('MPBook reader unavailable');
      // Yield once before mounting the reader so painting can finish after the last chunk.
      await new Promise(r=>setTimeout(r,0));
      await window.MPBookOpenBook(book,true);
      toast(tx('Libro abierto.','Book opened.'),2500);
    }catch(err){
      console.error('MPBook streamed library open failed',err);
      toast(`${tx('No pude abrir el libro.','I could not open the book.')} ${String(err?.message||err)}`,7000);
    }finally{
      opening=false;
      if(button)button.disabled=false;
    }
  }

  function installLibraryStream(){
    // Capture phase prevents app-v2 from executing its old `storageCall("get")`,
    // which sends the complete book to the UI thread in one structured clone.
    document.addEventListener('click',event=>{
      const button=event.target?.closest?.('#libraryList .open-book');
      if(!button)return;
      const row=button.closest('.library-item');
      if(!row?.dataset?.id)return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      openStreamed(row);
    },true);
  }

  function install(){installSettings();installLibraryStream();}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})();
