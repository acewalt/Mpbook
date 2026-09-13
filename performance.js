(() => {
  // The base stylesheet gives every settings label display:grid. In Chromium
  // that can make elements with the `hidden` attribute remain visible.
  // Force the HTML hidden contract so Browser / Natural / OpenAI controls do
  // not overlap or fight each other when switching engines.
  const style = document.createElement('style');
  style.textContent = '[hidden]{display:none!important}.virtual-note{color:var(--muted);font-family:Inter,ui-sans-serif,sans-serif;font-size:.82rem;padding:8px 12px}';
  document.head.appendChild(style);

  const reader = document.getElementById('readerText');
  if (!reader) return;

  const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
  if (!descriptor?.set || !descriptor?.get) return;
  const nativeSet = descriptor.set;
  const nativeGet = descriptor.get;
  const WINDOW = 32;

  Object.defineProperty(reader, 'innerHTML', {
    configurable: true,
    enumerable: true,
    get() { return nativeGet.call(this); },
    set(value) {
      const html = String(value ?? '');
      const marker = 'data-segment=';
      let count = 0, pos = 0;
      while ((pos = html.indexOf(marker, pos)) !== -1) { count++; pos += marker.length; }

      // Small chapters are rendered normally. Large chapters are virtualized so
      // thousands of paragraphs do not freeze the browser on every next/previous step.
      if (count <= 140) {
        this.dataset.virtualTotal = String(count);
        nativeSet.call(this, html);
        return;
      }

      const re = /<p class="segment[^>]*data-segment="(\d+)"[^>]*>[\s\S]*?<\/p>/g;
      const rows = [];
      let active = 0, match;
      while ((match = re.exec(html))) {
        const index = Number(match[1]);
        if (match[0].includes(' active')) active = index;
        rows.push({ index, html: match[0] });
      }

      if (!rows.length) {
        nativeSet.call(this, html);
        return;
      }

      const start = Math.max(0, active - WINDOW);
      const end = Math.min(rows.length, active + WINDOW + 1);
      const lang = document.documentElement.lang?.startsWith('en') ? 'en' : 'es';
      const before = start > 0
        ? `<div class="virtual-note">${lang === 'en' ? `Showing ${start + 1}–${end} of ${rows.length} fragments` : `Mostrando fragmentos ${start + 1}–${end} de ${rows.length}`}</div>`
        : '';
      const after = end < rows.length
        ? `<div class="virtual-note">${lang === 'en' ? 'Use Next/Previous or the fragment selector to continue' : 'Usa Siguiente/Anterior o el selector de fragmento para continuar'}</div>`
        : '';

      this.dataset.virtualTotal = String(rows.length);
      nativeSet.call(this, before + rows.slice(start, end).map(r => r.html).join('') + after);
    }
  });
})();