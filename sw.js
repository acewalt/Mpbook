const CACHE='mpbook-v4';
const ASSETS=['./','./index.html','./styles.css','./app.js','./local-tts.js','./manifest.webmanifest','./icon.svg'];

self.addEventListener('install',event=>event.waitUntil(
  caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())
));

self.addEventListener('activate',event=>event.waitUntil((async()=>{
  const keys=await caches.keys();
  await Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)));
  await self.clients.claim();
  const clients=await self.clients.matchAll({type:'window',includeUncontrolled:true});
  for(const client of clients){
    try{ await client.navigate(client.url); }catch{}
  }
})()));

self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET') return;
  const url=new URL(event.request.url);

  if(url.origin!==self.location.origin) return;

  const isCode=/\.(?:js|mjs|html|webmanifest)$/i.test(url.pathname) || event.request.mode==='navigate';

  if(isCode){
    event.respondWith((async()=>{
      try{
        const response=await fetch(event.request,{cache:'no-store'});
        if(response && response.ok){
          const copy=response.clone();
          event.waitUntil(caches.open(CACHE).then(c=>c.put(event.request,copy)));
        }
        return response;
      }catch{
        const cached=await caches.match(event.request);
        if(cached) return cached;
        if(event.request.mode==='navigate') return caches.match('./index.html');
        return Response.error();
      }
    })());
    return;
  }

  event.respondWith((async()=>{
    const cached=await caches.match(event.request);
    const network=fetch(event.request).then(response=>{
      if(response && response.ok){
        const copy=response.clone();
        event.waitUntil(caches.open(CACHE).then(c=>c.put(event.request,copy)));
      }
      return response;
    }).catch(()=>null);
    return cached || await network || Response.error();
  })());
});
