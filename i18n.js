(() => {
  'use strict';

  const STORAGE_KEY = 'mpbook.uiLanguage';
  let uiLang = localStorage.getItem(STORAGE_KEY) === 'en' ? 'en' : 'es';
  let applying = false;

  const T = [
    ['Audiobook｜有聲書', 'MPBook · Audiolibro', 'MPBook · Audiobook'],
    ['EPUB / Markdown 朗讀 · 雲端高音質', 'Lectura de EPUB / Markdown · voces de alta calidad', 'EPUB / Markdown reading · high-quality voices'],
    ['選檔', 'Archivo', 'File'],
    ['貼上文字', 'Pegar texto', 'Paste text'],
    ['書庫', 'Biblioteca', 'Library'],
    ['重點', 'Destacados', 'Highlights'],
    ['點此選檔，或拖曳檔案進來', 'Toca para elegir un archivo o arrástralo aquí', 'Click to choose a file or drag it here'],
    ['支援 .epub（建議，書籍首選）/ .md / .txt', 'Compatible con .epub (recomendado para libros) / .md / .txt', 'Supports .epub (recommended for books) / .md / .txt'],
    ['還沒有紀錄。載入過的文件會自動存進書庫，並記住聽到第幾段。', 'Aún no hay libros. Los documentos cargados se guardan automáticamente y recuerdan tu progreso.', 'No books yet. Loaded documents are saved automatically and remember your progress.'],
    ['下載 .md', 'Descargar .md', 'Download .md'],
    ['複製', 'Copiar', 'Copy'],
    ['還沒有重點。播放時按播放列的「標記」鈕，或直接在段落文字上選取一段按「標重點」。', 'Aún no hay destacados. Durante la reproducción pulsa «Marcar», o selecciona texto de un fragmento y pulsa «Destacar».', 'No highlights yet. While playing, press “Mark”, or select text in a segment and press “Highlight”.'],
    ['載入並切段', 'Cargar y dividir', 'Load and split'],
    ['清空', 'Limpiar', 'Clear'],
    ['章節（點選跳播）', 'Capítulos (selecciona para saltar)', 'Chapters (select to jump)'],
    ['匯出音檔', 'Exportar audio', 'Export audio'],
    ['畫重點兩條路：播放中按底部的「標記」鈕，記住現在唸到的句子；或直接在下面的段落文字上拖選一段，點跳出來的「標重點」。標過的重點點一下可以寫筆記。', 'Puedes destacar de dos formas: durante la reproducción pulsa «Marcar» para guardar la frase actual, o selecciona texto en un fragmento y pulsa «Destacar». Toca un destacado para añadir una nota.', 'You can highlight in two ways: while playing, press “Mark” to save the current sentence, or select text in a segment and press “Highlight”. Tap a highlight to add a note.'],
    ['載入一本 EPUB 或一份 Markdown，就能開始聽。', 'Carga un EPUB o un Markdown para empezar a escuchar.', 'Load an EPUB or Markdown file to start listening.'],
    ['準備中……', 'Preparando…', 'Preparing…'],
    ['待機', 'En espera', 'Idle'],
    ['載入中', 'Cargando', 'Loading'],
    ['播放中', 'Reproduciendo', 'Playing'],
    ['暫停', 'Pausado', 'Paused'],
    ['錯誤', 'Error', 'Error'],
    ['標記', 'Marcar', 'Mark'],
    ['標重點', 'Destacar', 'Highlight'],
    ['語音設定', 'Ajustes de voz', 'Voice settings'],
    ['語音引擎', 'Motor de voz', 'Voice engine'],
    ['OpenAI（雲端高音質，需 API key）', 'OpenAI (alta calidad en la nube, requiere API key)', 'OpenAI (high-quality cloud voice, API key required)'],
    ['Google Cloud（每月 100 萬字元免費，需 API key）', 'Google Cloud (1 millón de caracteres gratis al mes, requiere API key)', 'Google Cloud (1 million characters free per month, API key required)'],
    ['Azure（台灣腔音色最齊，需 key＋region）', 'Azure (amplia selección de voces, requiere key + región)', 'Azure (wide voice selection, key + region required)'],
    ['Gemini（AI Studio key 直接用，有免費層）', 'Gemini (usa una clave de AI Studio, tiene nivel gratuito)', 'Gemini (uses an AI Studio key, free tier available)'],
    ['瀏覽器內建（免費，免 key）', 'Navegador (gratis, sin key)', 'Browser (free, no key)'],
    ['自然語音（Hugging Face · Kokoro）', 'Voces naturales (Hugging Face · Kokoro)', 'Natural voices (Hugging Face · Kokoro)'],
    ['語系', 'Idioma', 'Language'],
    ['自動偵測', 'Detección automática', 'Auto detect'],
    ['中文（台灣）', 'Chino (Taiwán)', 'Chinese (Taiwan)'],
    ['中文（通用）', 'Chino (general)', 'Chinese (general)'],
    ['英文', 'Inglés', 'English'],
    ['西班牙文', 'Español', 'Spanish'],
    ['日文', 'Japonés', 'Japanese'],
    ['韓文', 'Coreano', 'Korean'],
    ['聲色', 'Tipo de voz', 'Voice type'],
    ['不指定', 'Sin preferencia', 'Any'],
    ['女聲', 'Voz femenina', 'Female'],
    ['男聲', 'Voz masculina', 'Male'],
    ['語系與聲色會篩選下面的音色清單。Google／Azure 有各語系專屬音色；OpenAI／Gemini 的音色多語通用、自動跟著文本語言（OpenAI 口音可靠語氣指示）；瀏覽器引擎篩系統語音。', 'El idioma y el tipo de voz filtran las voces disponibles. Google y Azure tienen voces por idioma; OpenAI y Gemini son multilingües y siguen el idioma del texto; el navegador usa las voces instaladas en el sistema.', 'Language and voice type filter the available voices. Google and Azure provide language-specific voices; OpenAI and Gemini are multilingual and follow the text language; the browser uses installed system voices.'],
    ['OpenAI API Key（只存在本機，不會上傳）', 'OpenAI API Key (solo se guarda en este dispositivo)', 'OpenAI API Key (stored only on this device)'],
    ['Google Cloud API Key（只存在本機，不會上傳）', 'Google Cloud API Key (solo se guarda en este dispositivo)', 'Google Cloud API Key (stored only on this device)'],
    ['Gemini API Key（AI Studio 取得，只存在本機）', 'Gemini API Key (de AI Studio, solo se guarda localmente)', 'Gemini API Key (from AI Studio, stored locally only)'],
    ['Region（資源區域）', 'Región', 'Region'],
    ['模型', 'Modelo', 'Model'],
    ['音色', 'Voz', 'Voice'],
    ['語氣指示（僅 gpt-4o-mini-tts，可留空）', 'Instrucciones de estilo (solo gpt-4o-mini-tts, opcional)', 'Style instructions (gpt-4o-mini-tts only, optional)'],
    ['播放時由你的瀏覽器直連所選引擎的 API，內容不經過任何中間伺服器；各家 key 分開記住，切換引擎不用重填。', 'Durante la reproducción, tu navegador se conecta directamente a la API elegida. El contenido no pasa por servidores intermedios y cada clave se guarda por separado.', 'During playback, your browser connects directly to the selected API. Content does not pass through an intermediary server, and each key is remembered separately.'],
    ['系統語音', 'Voz del sistema', 'System voice'],
    ['用手機作業系統內建的語音，免費、可離線，但中文自然度視機型而定。', 'Usa las voces integradas del sistema. Es gratis y puede funcionar sin conexión; la calidad depende del dispositivo.', 'Uses built-in system voices. It is free and can work offline; quality depends on the device.'],
    ['Kokoro 自然語音會在第一次播放時自動從 Hugging Face 載入模型並快取在瀏覽器，不需要安裝語音或 API key。之後會直接使用瀏覽器快取。', 'Las voces naturales se cargan automáticamente desde Hugging Face la primera vez y quedan en caché en el navegador. No necesitas instalar voces ni usar una API key. Después se reutiliza la caché local.', 'Natural voices load automatically from Hugging Face the first time and are cached in the browser. No voice installation or API key is required. Later uses reuse the local cache.'],
    ['每段最長字數自動配（依引擎）', 'Longitud máxima automática por fragmento (según el motor)', 'Automatic maximum segment length (based on engine)'],
    ['自動配會依所選引擎與模型抓單次請求的甜蜜點（換引擎不用自己記數字）；取消勾選可手動指定。數字越大朗讀越連貫、接縫越少，但首段等待越久。', 'El ajuste automático elige una longitud adecuada según el motor y el modelo. Desmárcalo para definirla manualmente. Fragmentos más largos reducen cortes, pero tardan más en empezar.', 'Automatic mode chooses a suitable length for the selected engine and model. Uncheck it to set the value manually. Longer segments reduce joins but take longer to start.'],
    ['跳過程式碼區塊不朗讀', 'Omitir bloques de código al leer', 'Skip code blocks while reading'],
    ['快取已合成語音（重播 / 重開省 API 費用）', 'Guardar audio sintetizado en caché (ahorra uso de API al repetir o reabrir)', 'Cache synthesized audio (saves API usage on replay/reopen)'],
    ['完成', 'Listo', 'Done'],
    ['清空語音快取', 'Borrar caché de voz', 'Clear voice cache'],
    ['寫一點筆記（可留空）……', 'Escribe una nota (opcional)…', 'Write a note (optional)…'],
    ['儲存', 'Guardar', 'Save'],
    ['刪除重點', 'Eliminar destacado', 'Delete highlight'],
    ['關閉', 'Cerrar', 'Close'],
    ['開始匯出', 'Iniciar exportación', 'Start export'],
    ['取消', 'Cancelar', 'Cancel'],
    ['計算費用與檔案大小中……', 'Calculando coste y tamaño del archivo…', 'Calculating cost and file size…'],
    ['取消中……', 'Cancelando…', 'Cancelling…'],
    ['全部朗讀完畢', 'Lectura terminada', 'Reading finished'],
    ['先載入文件', 'Primero carga un documento', 'Load a document first'],
    ['瀏覽器內建引擎不提供音訊資料，匯出請改用雲端引擎', 'El motor del navegador no genera un archivo de audio. Para exportar, usa un motor en la nube.', 'The browser engine does not provide audio data. Use a cloud engine to export.'],
    ['完成，已開始下載。', 'Listo. La descarga ha comenzado.', 'Done. The download has started.'],
    ['匯出完成', 'Exportación completada', 'Export complete'],
    ['匯出失敗', 'Error al exportar', 'Export failed'],
    ['已聽完', 'Completado', 'Finished'],
    ['全文', 'Texto completo', 'Full text'],
    ['未命名', 'Sin título', 'Untitled'],
    ['未命名文件', 'Documento sin título', 'Untitled document'],
    ['切換外觀', 'Cambiar apariencia', 'Change appearance'],
    ['加到主畫面', 'Añadir a la pantalla de inicio', 'Add to home screen'],
    ['播放速度（點一下回 1.0×）', 'Velocidad de reproducción (toca para volver a 1.0×)', 'Playback speed (tap to reset to 1.0×)'],
    ['標記現在唸到的句子', 'Marcar la frase que se está leyendo', 'Mark the sentence currently being read'],
    ['減速', 'Reducir velocidad', 'Slow down'],
    ['上一段', 'Fragmento anterior', 'Previous segment'],
    ['播放/暫停', 'Reproducir/pausar', 'Play/pause'],
    ['下一段', 'Fragmento siguiente', 'Next segment'],
    ['加速', 'Aumentar velocidad', 'Speed up'],
    ['刪除紀錄', 'Eliminar registro', 'Delete record']
  ];

  const reverse = new Map();
  for (const row of T) {
    reverse.set(row[0], row);
    reverse.set(row[1], row);
    reverse.set(row[2], row);
  }

  function target(row) { return uiLang === 'es' ? row[1] : row[2]; }

  function translateExact(text) {
    const row = reverse.get(text);
    return row ? target(row) : null;
  }

  function translateRuntime(text) {
    if (!text) return text;
    const exact = translateExact(text);
    if (exact !== null) return exact;

    let m;
    if ((m = text.match(/^(\d+)\s*段$/)) || (m = text.match(/^(\d+)\s*(?:fragmentos|segments)$/i))) {
      return uiLang === 'es' ? `${m[1]} fragmentos` : `${m[1]} segments`;
    }
    if ((m = text.match(/^(\d+)\s*字$/)) || (m = text.match(/^(\d+)\s*(?:caracteres|characters)$/i))) {
      return uiLang === 'es' ? `${m[1]} caracteres` : `${m[1]} characters`;
    }
    if ((m = text.match(/^第\s*(\d+)\s*\/\s*(\d+)\s*段$/)) || (m = text.match(/^(?:Fragmento|Segment)\s+(\d+)\s*\/\s*(\d+)$/i))) {
      return uiLang === 'es' ? `Fragmento ${m[1]} / ${m[2]}` : `Segment ${m[1]} / ${m[2]}`;
    }
    if ((m = text.match(/^聽到\s*(\d+)\s*\/\s*(\d+)\s*段（(\d+)%）$/)) || (m = text.match(/^(?:Escuchado|Heard)\s*(\d+)\s*\/\s*(\d+)\s*(?:fragmentos|segments)\s*\((\d+)%\)$/i))) {
      return uiLang === 'es' ? `Escuchado ${m[1]} / ${m[2]} fragmentos (${m[3]}%)` : `Heard ${m[1]} / ${m[2]} segments (${m[3]}%)`;
    }
    if ((m = text.match(/^上次聽到第\s*(\d+)\s*段，按播放從那裡繼續$/)) || (m = text.match(/^(?:La última vez llegaste al fragmento|Last time you reached segment)\s*(\d+).*$/i))) {
      return uiLang === 'es' ? `La última vez llegaste al fragmento ${m[1]}. Pulsa reproducir para continuar.` : `Last time you reached segment ${m[1]}. Press play to continue.`;
    }
    if ((m = text.match(/^已切成\s*(\d+)\s*段，按播放開始$/)) || (m = text.match(/^(?:Dividido en|Split into)\s*(\d+)\s*(?:fragmentos|segments).*$/i))) {
      return uiLang === 'es' ? `Dividido en ${m[1]} fragmentos. Pulsa reproducir para empezar.` : `Split into ${m[1]} segments. Press play to start.`;
    }
    if ((m = text.match(/^章節\s*(\d+)$/)) || (m = text.match(/^(?:Capítulo|Chapter)\s*(\d+)$/i))) {
      return uiLang === 'es' ? `Capítulo ${m[1]}` : `Chapter ${m[1]}`;
    }
    if ((m = text.match(/^筆記：(.*)$/)) || (m = text.match(/^(?:Nota|Note):\s*(.*)$/i))) {
      return uiLang === 'es' ? `Nota: ${m[1]}` : `Note: ${m[1]}`;
    }
    if ((m = text.match(/^已複製\s*(\d+)\s*則重點，可直接貼進筆記軟體$/))) {
      return uiLang === 'es' ? `Se copiaron ${m[1]} destacados. Puedes pegarlos en tu app de notas.` : `Copied ${m[1]} highlights. You can paste them into your notes app.`;
    }
    if ((m = text.match(/^請先在「語音設定」填入?\s*(.+?)\s*的 API Key$/))) {
      return uiLang === 'es' ? `Introduce primero la API Key de ${m[1]} en «Ajustes de voz».` : `Enter the ${m[1]} API Key in “Voice settings” first.`;
    }
    if ((m = text.match(/^刪除「(.+)」的書庫紀錄？（語音快取不受影響）$/))) {
      return uiLang === 'es' ? `¿Eliminar «${m[1]}» de la biblioteca? La caché de voz no se eliminará.` : `Delete “${m[1]}” from the library? The voice cache will not be affected.`;
    }

    return text;
  }

  function translateOptionText(text) {
    let out = translateRuntime(text);
    if (out !== text) return out;
    const rules = uiLang === 'es' ? [
      [/（中性）/g, ' (neutral)'], [/（明亮女聲）/g, ' (femenina brillante)'], [/（柔和女聲）/g, ' (femenina suave)'],
      [/（活潑女聲）/g, ' (femenina expresiva)'], [/（溫和女聲）/g, ' (femenina cálida)'], [/（沉穩男聲）/g, ' (masculina serena)'],
      [/（低沉男聲）/g, ' (masculina grave)'], [/（敘事感）/g, ' (narrativa)'], [/（最新，可給語氣）/g, ' (más reciente, admite estilo)'],
      [/台灣女聲/g, 'Voz femenina de Taiwán'], [/台灣男聲/g, 'Voz masculina de Taiwán'], [/最省/g, 'económica']
    ] : [
      [/（中性）/g, ' (neutral)'], [/（明亮女聲）/g, ' (bright female)'], [/（柔和女聲）/g, ' (soft female)'],
      [/（活潑女聲）/g, ' (expressive female)'], [/（溫和女聲）/g, ' (warm female)'], [/（沉穩男聲）/g, ' (calm male)'],
      [/（低沉男聲）/g, ' (deep male)'], [/（敘事感）/g, ' (narrative)'], [/（最新，可給語氣）/g, ' (latest, supports style)'],
      [/台灣女聲/g, 'Taiwan female voice'], [/台灣男聲/g, 'Taiwan male voice'], [/最省/g, 'economical']
    ];
    for (const [re, rep] of rules) out = out.replace(re, rep);
    return out;
  }

  function isProtected(node) {
    const el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    if (!el) return false;
    return !!el.closest('#segList, #markQuote, .lib-title, textarea, input, [contenteditable="true"]');
  }

  function translateTextNode(node) {
    if (!node || node.nodeType !== Node.TEXT_NODE || isProtected(node)) return;
    const value = node.nodeValue;
    const trimmed = value.trim();
    if (!trimmed) return;
    const translated = translateRuntime(trimmed);
    if (translated === trimmed) return;
    const leading = value.match(/^\s*/)?.[0] || '';
    const trailing = value.match(/\s*$/)?.[0] || '';
    node.nodeValue = leading + translated + trailing;
  }

  function translateAttributes(el) {
    if (!(el instanceof Element)) return;
    for (const attr of ['title', 'placeholder', 'aria-label']) {
      if (!el.hasAttribute(attr)) continue;
      const current = el.getAttribute(attr);
      const translated = translateRuntime(current);
      if (translated !== current) el.setAttribute(attr, translated);
    }
  }

  function translateTree(root) {
    if (!root) return;
    if (root.nodeType === Node.ELEMENT_NODE) {
      const el = root;
      if (el.closest('#segList, #markQuote, .lib-title')) return;
      translateAttributes(el);
      if (el.tagName === 'OPTION') {
        const next = translateOptionText(el.textContent.trim());
        if (next !== el.textContent.trim()) el.textContent = next;
        return;
      }
    }
    if (root.nodeType === Node.TEXT_NODE) {
      translateTextNode(root);
      return;
    }
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (node.nodeType === Node.TEXT_NODE) translateTextNode(node);
      else {
        translateAttributes(node);
        if (node.tagName === 'OPTION' && !node.closest('#chapterSel')) {
          const next = translateOptionText(node.textContent.trim());
          if (next !== node.textContent.trim()) node.textContent = next;
        }
      }
    }
  }

  function updateCounters() {
    const segCount = document.querySelector('#segCount');
    if (segCount) {
      const n = (segCount.textContent.match(/\d+/) || [])[0];
      if (n != null) segCount.textContent = uiLang === 'es' ? `${n} fragmentos` : `${n} segments`;
    }
    const chars = document.querySelector('#segChars');
    if (chars) {
      const n = (chars.textContent.match(/\d+/) || [])[0];
      if (n != null) chars.textContent = uiLang === 'es' ? `${n} caracteres` : `${n} characters`;
    }
  }

  function updateNowText() {
    const now = document.querySelector('#nowText');
    if (!now) return;
    const first = now.querySelector('b');
    if (first) {
      const m = first.textContent.match(/(?:第\s*)?(\d+)\s*\/\s*(\d+)(?:\s*段)?|(?:Fragmento|Segment)\s+(\d+)\s*\/\s*(\d+)/i);
      if (m) {
        const a = m[1] || m[3], b = m[2] || m[4];
        first.textContent = uiLang === 'es' ? `Fragmento ${a} / ${b}` : `Segment ${a} / ${b}`;
      }
    } else {
      const translated = translateRuntime(now.textContent.trim());
      if (translated !== now.textContent.trim()) now.textContent = translated;
    }
  }

  function updateDynamic() {
    updateCounters();
    updateNowText();
    ['#statusText', '#exportInfo', '#exportStatus', '#toast', '#libEmpty', '#marksEmpty', '#emptyState', '#dropzone strong'].forEach(sel => {
      const el = document.querySelector(sel);
      if (!el || !el.textContent.trim()) return;
      const next = translateRuntime(el.textContent.trim());
      if (next !== el.textContent.trim()) el.textContent = next;
    });
    document.querySelectorAll('.lib-sub').forEach(el => {
      if (el.closest('#marksList') && !/^筆記：|^Nota:|^Note:/i.test(el.textContent.trim())) return;
      const next = translateRuntime(el.textContent.trim());
      if (next !== el.textContent.trim()) el.textContent = next;
    });
    document.querySelectorAll('select:not(#chapterSel) option').forEach(opt => {
      const next = translateOptionText(opt.textContent.trim());
      if (next !== opt.textContent.trim()) opt.textContent = next;
    });
  }

  function ensureButton() {
    let btn = document.querySelector('#uiLangBtn');
    if (!btn) {
      btn = document.createElement('button');
      btn.id = 'uiLangBtn';
      btn.type = 'button';
      btn.className = 'icon-btn';
      btn.style.fontWeight = '700';
      btn.style.fontSize = '14px';
      btn.style.letterSpacing = '.4px';
      const header = document.querySelector('header');
      const install = document.querySelector('#installBtn');
      if (header) header.insertBefore(btn, install || null);
      btn.addEventListener('click', () => {
        uiLang = uiLang === 'es' ? 'en' : 'es';
        localStorage.setItem(STORAGE_KEY, uiLang);
        applyLanguage();
      });
    }
    btn.textContent = uiLang === 'es' ? 'EN' : 'ES';
    btn.title = uiLang === 'es' ? 'Switch to English' : 'Cambiar a español';
    btn.setAttribute('aria-label', btn.title);
  }

  function applyLanguage() {
    if (applying) return;
    applying = true;
    try {
      document.documentElement.lang = uiLang;
      document.title = uiLang === 'es' ? 'MPBook · Audiolibro' : 'MPBook · Audiobook';
      const appleTitle = document.querySelector('meta[name="apple-mobile-web-app-title"]');
      if (appleTitle) appleTitle.content = 'MPBook';
      ensureButton();
      translateTree(document.body);
      updateDynamic();
    } finally {
      applying = false;
    }
  }

  const nativeConfirm = window.confirm.bind(window);
  window.confirm = message => nativeConfirm(translateRuntime(String(message)));

  let scheduled = false;
  const observer = new MutationObserver(records => {
    if (applying) return;
    for (const rec of records) {
      if (rec.target?.nodeType === Node.ELEMENT_NODE && rec.target.closest?.('#segList, #markQuote, .lib-title')) continue;
      if (rec.type === 'childList') {
        for (const node of rec.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE && node.closest?.('#segList, #markQuote, .lib-title')) continue;
          translateTree(node);
        }
      } else if (rec.type === 'characterData') {
        translateTextNode(rec.target);
      }
    }
    if (!scheduled) {
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        applying = true;
        try { updateDynamic(); } finally { applying = false; }
      });
    }
  });

  applyLanguage();
  observer.observe(document.body, {subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['title', 'placeholder', 'aria-label']});
})();
