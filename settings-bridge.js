(() => {
  'use strict';
  function install(){
    const form=document.querySelector('#settingsForm');
    if(!form)return;
    form.addEventListener('submit',event=>{
      if(event.submitter?.value==='cancel')return;
      const engine=document.querySelector('#engineSelect')?.value;
      if(engine!=='natural')return;
      const lang=document.querySelector('#speechLang')?.value||'es-ES';
      const voice=document.querySelector('#naturalVoice')?.value||'';
      const rate=document.querySelector('#rateInput')?.value||'1';
      const pitch=document.querySelector('#pitchInput')?.value||'1';
      localStorage.setItem('mpbook.engine','natural');
      localStorage.setItem('mpbook.speechLang',lang);
      localStorage.setItem('mpbook.rate',String(rate));
      localStorage.setItem('mpbook.pitch',String(pitch));
      if(voice)localStorage.setItem(`mpbook.naturalVoice.${lang}`,voice);
      const badge=document.querySelector('#engineBadge');
      if(badge)badge.textContent=lang.startsWith('en-')?'Kokoro':'Piper';
    },true);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})();
