(() => {
  'use strict';

  // Keep hidden form sections truly hidden even when other form CSS sets display.
  const style = document.createElement('style');
  style.textContent = '[hidden]{display:none!important}.virtual-note{color:var(--muted);font-family:Inter,ui-sans-serif,sans-serif;font-size:.82rem;padding:8px 12px}';
  document.head.appendChild(style);

  const $ = s => document.querySelector(s);
  const tx = (es,en) => document.documentElement.lang?.startsWith('en') ? en : es;

  function saveNaturalSettings(event){
    const engine = $('#engineSelect')?.value || 'browser';
    if(engine !== 'natural') return false;

    // Stop the form's original submit handler before it can call renderReader().
    // Re-rendering a large EPUB while closing the dialog was the source of the freeze.
    event?.preventDefault?.();
    event?.stopPropagation?.();
    event?.stopImmediatePropagation?.();

    const lang = $('#speechLang')?.value || 'es-ES';
    const voice = $('#naturalVoice')?.value || '';
    const rate = Number($('#rateInput')?.value || 1);
    const pitch = Number($('#pitchInput')?.value || 1);

    localStorage.setItem('mpbook.engine','natural');
    localStorage.setItem('mpbook.speechLang',lang);
    localStorage.setItem('mpbook.rate',String(rate));
    localStorage.setItem('mpbook.pitch',String(pitch));
    if(voice) localStorage.setItem(`mpbook.naturalVoice.${lang}`,voice);

    const badge = $('#engineBadge');
    if(badge) badge.textContent = lang.startsWith('en-') ? 'Kokoro' : 'Piper';

    const dialog = $('#settingsDialog');
    if(dialog?.open) dialog.close('default');

    const toast = $('#toast');
    if(toast){
      toast.textContent = tx('Ajustes guardados.','Settings saved.');
      toast.classList.add('show');
      clearTimeout(window.__mpbookSafeSaveToast);
      window.__mpbookSafeSaveToast = setTimeout(()=>toast.classList.remove('show'),2400);
    }
    return true;
  }

  // Intercept the actual button click in capture phase. This happens before the
  // browser creates the form submit event and is more reliable on iOS Safari.
  document.addEventListener('click', event => {
    const button = event.target?.closest?.('#saveSettingsBtn');
    if(!button) return;
    saveNaturalSettings(event);
  }, true);

  // Backup for keyboard submit / Enter / browsers that bypass the click path.
  const settingsForm = $('#settingsForm');
  if(settingsForm){
    settingsForm.addEventListener('submit', event => {
      if(event.submitter?.value === 'cancel') return;
      saveNaturalSettings(event);
    }, true);
  }

  // app.js keeps its own in-memory settings object. Natural TTS reads the saved
  // values from localStorage, so restore them every time the dialog opens.
  $('#settingsBtn')?.addEventListener('click', () => {
    setTimeout(() => {
      if(localStorage.getItem('mpbook.engine') !== 'natural') return;
      const engine = $('#engineSelect');
      const lang = $('#speechLang');
      const savedLang = localStorage.getItem('mpbook.speechLang') || 'es-ES';
      const rate = $('#rateInput');
      const savedRate = localStorage.getItem('mpbook.rate');

      if(engine){
        engine.value = 'natural';
        engine.dispatchEvent(new Event('change',{bubbles:true}));
      }
      if(lang){
        lang.value = savedLang;
        lang.dispatchEvent(new Event('change',{bubbles:true}));
      }
      if(rate && savedRate){
        rate.value = savedRate;
        rate.dispatchEvent(new Event('input',{bubbles:true}));
      }
    }, 0);
  });

  // Virtualize very large chapter rendering. app.js can build thousands of
  // fragment <p> strings; only keep a small window around the active fragment.
  const reader = document.getElementById('readerText');
  if(!reader) return;

  const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
  if(!descriptor?.set || !descriptor?.get) return;
  const nativeSet = descriptor.set;
  const nativeGet = descriptor.get;
  const WINDOW = 32;

  Object.defineProperty(reader, 'innerHTML', {
    configurable: true,
    enumerable: true,
    get(){ return nativeGet.call(this); },
    set(value){
      const html = String(value ?? '');
      const marker = 'data-segment=';
      let count = 0, pos = 0;
      while((pos = html.indexOf(marker,pos)) !== -1){ count++; pos += marker.length; }

      if(count <= 140){
        this.dataset.virtualTotal = String(count);
        nativeSet.call(this, html);
        return;
      }

      const re = /<p class="segment[^>]*data-segment="(\d+)"[^>]*>[\s\S]*?<\/p>/g;
      const rows = [];
      let active = 0, match;
      while((match = re.exec(html))){
        const index = Number(match[1]);
        if(match[0].includes(' active')) active = index;
        rows.push({index,html:match[0]});
      }
      if(!rows.length){ nativeSet.call(this,html); return; }

      const start = Math.max(0,active-WINDOW);
      const end = Math.min(rows.length,active+WINDOW+1);
      const en = document.documentElement.lang?.startsWith('en');
      const before = start>0 ? `<div class="virtual-note">${en?`Showing ${start+1}–${end} of ${rows.length} fragments`:`Mostrando fragmentos ${start+1}–${end} de ${rows.length}`}</div>` : '';
      const after = end<rows.length ? `<div class="virtual-note">${en?'Use Next/Previous or the fragment selector to continue':'Usa Siguiente/Anterior o el selector de fragmento para continuar'}</div>` : '';

      this.dataset.virtualTotal = String(rows.length);
      nativeSet.call(this,before+rows.slice(start,end).map(r=>r.html).join('')+after);
    }
  });
})();