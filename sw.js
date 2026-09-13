const CACHE='mpbook-v8';
const ASSETS=[
  './',
  './index.html',
  './styles.css',
  './performance.js?v=8',
  './export-audio.js?v=8',
  './app.js?v=8',
  './local-tts.js?v=8',
  './tts-worker.js?v=8',
  './manifest.webmanifest',
  './icon.svg'
];

self.addEventListener('install',event=>event.waitUntil(
  caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())
));

self.addEventListener('activate',event=>event.waitUntil((async()=>{
  const keys=await caches.keys();
  await Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)));
  await self.clients.claim();
})()));

self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET') return;
  const url=new URL(event.request.url);
  if(url.origin!==self.location.origin) return;

  const isCode=event.request.mode==='navigate' || /\.(?:js|mjs|html|webmanifest)$/i.test(url.pathname);
  if(isCode){
    event.respondWith((async()=>{
      try{
        const response=await fetch(event.request,{cache:'no-store'});
        if(response?.ok){
          const copy=response.clone();
          event.waitUntil(caches.open(CACHE).then(c=>c.put(event.request,copy)));
        }
        return response;
      }catch{
        return (await caches.match(event.request)) || (event.request.mode==='navigate' ? await caches.match('./index.html') : Response.error());
      }
    })());
    return;
  }

  event.respondWith((async()=>{
    const cached=await caches.match(event.request);
    if(cached) return cached;
    try{
      const response=await fetch(event.request);
      if(response?.ok){const copy=response.clone();event.waitUntil(caches.open(CACHE).then(c=>c.put(event.request,copy)));}
      return response;
    }catch{return Response.error();}
  })());
});
