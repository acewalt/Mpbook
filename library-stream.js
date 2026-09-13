(() => {
  'use strict';

  const $ = s => document.querySelector(s);
  const tx = (es,en) => document.documentElement.lang?.startsWith('en') ? en : es;
  let busy=false;

  function toast(message,ms=5000){
    const el=$('#toast');
    if(!el)return;
    el.textContent=message;
    el.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer=setTimeout(()=>el.classList.remove('show'),ms);
  }

  function streamBook(id){
    return new Promise((resolve,reject)=>{
      const worker=new Worker('./storage-worker.js?v=16');
      const requestId=1;
      let book=null,received=0,total=0,done=false;
      const finish=(fn,value)=>{
        if(done)return;
        done=true;
        try{worker.terminate();}catch{}
        fn(value);
      };
      const timer=setTimeout(()=>finish(reject,new Error(tx('La apertura tardó demasiado.','Opening timed out.'))),120000);
      const end=(fn,value)=>{clearTimeout(timer);finish(fn,value);};

      worker.onerror=e=>end(reject,new Error(e?.message||'Storage worker error'));
      worker.onmessage=e=>{
        const m=e.data||{};
        if(m.requestId!==requestId)return;
        if(m.type==='error'){
          end(reject,new Error(m.message||'Book read failed'));
          return;
        }
        if(m.type==='stream-meta'){
          total=Number(m.meta?.chapterCount||0);
          book={
            id:m.meta.id,
            title:m.meta.title,
            type:m.meta.type,
            filename:m.meta.filename||'',
            updatedAt:m.meta.updatedAt||0,
            chapters:new Array(total)
          };
          toast(`${tx('Abriendo libro','Opening book')}… 0/${total}`,10000);
          return;
        }
        if(m.type==='stream-chapter'){
          if(!book)return;
          book.chapters[m.index]=m.chapter;
          received++;
          if(received===1 || received===total || received%4===0){
            const pct=total?Math.round(received*100/total):0;
            toast(`${tx('Abriendo libro','Opening book')}… ${received}/${total} · ${pct}%`,10000);
          }
          return;
        }
        if(m.type==='stream-end'){
          if(!book)return end(reject,new Error('Missing book metadata'));
          book.chapters=book.chapters.filter(Boolean);
          end(resolve,book);
        }
      };
      worker.postMessage({type:'stream',requestId,id});
    });
  }

  async function openStreamed(row){
    if(busy)return;
    busy=true;
    const button=row.querySelector('.open-book');
    if(button)button.disabled=true;
    try{
      const book=await streamBook(row.dataset.id);
      if(typeof window.MPBookOpenBook!=='function') throw new Error('MPBook reader unavailable');
      await window.MPBookOpenBook(book,true);
      toast(tx('Libro abierto.','Book opened.'),2500);
    }catch(err){
      console.error('MPBook streamed library open failed',err);
      toast(`${tx('No pude abrir el libro.','I could not open the book.')} ${String(err?.message||err)}`,7000);
    }finally{
      busy=false;
      if(button)button.disabled=false;
    }
  }

  // Capture phase intentionally takes ownership before app-v2's legacy library
  // handler can request the whole IndexedDB object in one structured-clone.
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
})();