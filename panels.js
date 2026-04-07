/**
 * panels.js — Right panel logic
 * Manages: Style panel, OCR/Translation panel, Layers, Exports
 */

const PanelManager = (() => {

  // ── Current text style state ───────────────────────
  const style = {
    fontFamily:  'Bangers',
    fontSize:    22,
    fill:        '#000000',
    stroke:      '#ffffff',
    strokeWidth: 0,
    textAlign:   'center',
    fontWeight:  'normal',
    fontStyle:   'normal',
  };

  let activeObj = null;

  // ── Panel switching ────────────────────────────────
  function init() {
    document.querySelectorAll('.panel-tab').forEach(tab => {
      tab.addEventListener('click', () => switchPanel(tab.dataset.panel));
    });

    initStylePanel();
    initOCRPanel();
    initExportPanel();
  }

  function switchPanel(name) {
    document.querySelectorAll('.panel-tab').forEach(t => t.classList.toggle('active', t.dataset.panel === name));
    document.querySelectorAll('.panel-content').forEach(p => p.classList.toggle('active', p.id === 'panel-' + name));
  }

  // ── Style Panel ────────────────────────────────────
  function initStylePanel() {
    // Font family
    const fontSel = document.getElementById('font-family');
    fontSel?.addEventListener('change', () => applyStyle('fontFamily', fontSel.value));

    // Font size
    const fontSizeInput = document.getElementById('font-size');
    const fontSizeVal   = document.getElementById('font-size-val');
    fontSizeInput?.addEventListener('input', () => {
      const v = parseInt(fontSizeInput.value);
      fontSizeVal.textContent = v;
      applyStyle('fontSize', v);
    });

    // Text color
    const colorPick = document.getElementById('text-color');
    colorPick?.addEventListener('input', () => applyStyle('fill', colorPick.value));

    // Stroke color
    const strokeColorPick = document.getElementById('stroke-color');
    strokeColorPick?.addEventListener('input', () => applyStyle('stroke', strokeColorPick.value));

    // Stroke width
    const strokeW    = document.getElementById('stroke-width');
    const strokeWVal = document.getElementById('stroke-width-val');
    strokeW?.addEventListener('input', () => {
      const v = parseInt(strokeW.value);
      strokeWVal.textContent = v;
      applyStyle('strokeWidth', v);
    });

    // Text align
    document.querySelectorAll('[data-align]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('[data-align]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        applyStyle('textAlign', btn.dataset.align);
      });
    });

    // Bold / italic
    document.getElementById('btn-bold')?.addEventListener('click', () => {
      const cur = activeObj?.fontWeight === 'bold' ? 'normal' : 'bold';
      applyStyle('fontWeight', cur);
      document.getElementById('btn-bold').classList.toggle('active', cur === 'bold');
    });

    document.getElementById('btn-italic')?.addEventListener('click', () => {
      const cur = activeObj?.fontStyle === 'italic' ? 'normal' : 'italic';
      applyStyle('fontStyle', cur);
      document.getElementById('btn-italic').classList.toggle('active', cur === 'italic');
    });

    updatePreview();
  }

  function applyStyle(prop, value) {
    style[prop] = value;
    if (activeObj) {
      activeObj.set(prop, value);
      CanvasEngine.getFabric().renderAll();
    }
    updatePreview();
  }

  function updatePreview() {
    const preview = document.getElementById('text-preview');
    if (!preview) return;
    preview.style.fontFamily  = style.fontFamily;
    preview.style.fontSize    = style.fontSize + 'px';
    preview.style.color       = style.fill;
    preview.style.webkitTextStroke = style.strokeWidth > 0
      ? `${style.strokeWidth}px ${style.stroke}` : '';
    preview.style.textAlign   = style.textAlign;
    preview.style.fontWeight  = style.fontWeight;
    preview.style.fontStyle   = style.fontStyle;
    preview.textContent       = preview.textContent || 'Sample Text';
  }

  function onTextObjectSelected(obj) {
    activeObj = obj;
    switchPanel('style');

    // Sync controls to object properties
    const setV = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
    setV('font-family',    obj.fontFamily  || 'Bangers');
    setV('font-size',      obj.fontSize    || 22);
    setV('text-color',     obj.fill        || '#000000');
    setV('stroke-color',   obj.stroke      || '#ffffff');
    setV('stroke-width',   obj.strokeWidth || 0);

    const fsvEl = document.getElementById('font-size-val');
    if (fsvEl) fsvEl.textContent = obj.fontSize || 22;
    const swvEl = document.getElementById('stroke-width-val');
    if (swvEl) swvEl.textContent = obj.strokeWidth || 0;

    // Align buttons
    document.querySelectorAll('[data-align]').forEach(b =>
      b.classList.toggle('active', b.dataset.align === (obj.textAlign || 'center'))
    );

    // Bold/italic
    document.getElementById('btn-bold')?.classList.toggle('active', obj.fontWeight === 'bold');
    document.getElementById('btn-italic')?.classList.toggle('active', obj.fontStyle === 'italic');

    updatePreview();
  }

  function onObjectDeselected() {
    activeObj = null;
  }

  function getTextStyle() { return { ...style }; }

  // ── OCR Panel ──────────────────────────────────────
  function initOCRPanel() {
    document.getElementById('btn-ocr-page')?.addEventListener('click', runFullOCR);
    document.getElementById('btn-translate-all')?.addEventListener('click', translateAll);
    document.getElementById('btn-place-all')?.addEventListener('click', placeAllTranslations);
  }

  async function runFullOCR() {
    const pageData = CanvasEngine.getPageData();
    if (!pageData) { Toast.show('No page loaded', 'error'); return; }

    const btn = document.getElementById('btn-ocr-page');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Extracting…';

    try {
      const results = await Api.ocrPage(pageData.id);
      renderOCRResults(results);
      Toast.show(`Found ${results.length} text regions`, 'success');
    } catch (e) {
      Toast.show('OCR failed: ' + e.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Extract Text (OCR)';
    }
  }

  function renderOCRResults(regions) {
    const container = document.getElementById('ocr-results');
    container.innerHTML = '';

    regions.forEach((reg, i) => {
      const item = document.createElement('div');
      item.className = 'ocr-item';
      item.dataset.idx = i;
      item.innerHTML = `
        <p class="ocr-original">${escapeHtml(reg.text)}</p>
        <textarea class="ocr-translation" placeholder="Enter translation…" rows="2"></textarea>
        <div class="ocr-item-actions">
          <button class="mini-btn" data-action="auto">Auto-translate</button>
          <button class="mini-btn accent" data-action="place">Place Text</button>
        </div>`;

      // bind translate button
      item.querySelector('[data-action="auto"]').addEventListener('click', async (e) => {
        const btn = e.target;
        btn.textContent = '…';
        btn.disabled = true;
        try {
          const res = await Api.translate(reg.text);
          item.querySelector('.ocr-translation').value = res.translated_text;
        } catch(err) {
          Toast.show('Translation failed', 'error');
        } finally {
          btn.textContent = 'Auto-translate';
          btn.disabled = false;
        }
      });

      // bind place button
      item.querySelector('[data-action="place"]').addEventListener('click', () => {
        const translated = item.querySelector('.ocr-translation').value.trim();
        if (!translated) { Toast.show('Enter a translation first', 'error'); return; }
        placeTranslation(translated, reg.bbox);
      });

      container.appendChild(item);
    });
  }

  async function translateAll() {
    const items = document.querySelectorAll('.ocr-item');
    if (!items.length) { Toast.show('Run OCR first', 'error'); return; }

    const btn = document.getElementById('btn-translate-all');
    btn.disabled = true;

    let count = 0;
    for (const item of items) {
      const original = item.querySelector('.ocr-original').textContent;
      try {
        const res = await Api.translate(original);
        item.querySelector('.ocr-translation').value = res.translated_text;
        count++;
      } catch (ignored) {}
    }

    btn.disabled = false;
    Toast.show(`Translated ${count} items`, 'success');
  }

  function placeTranslation(text, bbox) {
    if (!bbox) {
      CanvasEngine.addTextBox(null, null, text);
      return;
    }
    const pd = CanvasEngine.getPageData();
    const scale = pd ? pd.scale : 1;
    CanvasEngine.addTextBox(bbox.x * scale, bbox.y * scale, text);
    Toast.show('Text placed on canvas', 'success');
  }

  function placeAllTranslations() {
    const items = document.querySelectorAll('.ocr-item');
    let placed = 0;
    items.forEach(item => {
      const text = item.querySelector('.ocr-translation').value.trim();
      if (text) { CanvasEngine.addTextBox(null, null, text); placed++; }
    });
    Toast.show(`Placed ${placed} text boxes`, placed > 0 ? 'success' : 'info');
  }

  // ── Export Panel ───────────────────────────────────
  function initExportPanel() {
    document.getElementById('export-png')?.addEventListener('click', exportPNG);
    document.getElementById('export-pdf')?.addEventListener('click', exportPDF);
    document.getElementById('export-tg')?.addEventListener('click', exportTelegram);
  }

  function exportPNG() {
    const pd = CanvasEngine.getPageData();
    if (!pd) { Toast.show('No page loaded', 'error'); return; }

    const dataUrl = CanvasEngine.exportDataURL('png');
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `manga-page-${Date.now()}.png`;
    a.click();
    Toast.show('Page exported as PNG', 'success');
  }

  async function exportPDF() {
    const pages = AppState.getPages();
    if (!pages.length) { Toast.show('No pages to export', 'error'); return; }

    Toast.show('Generating PDF…', 'info');
    try {
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF({ unit: 'px', compress: true });
      let first = true;

      for (const page of pages) {
        const dataUrl = page.dataUrl || CanvasEngine.exportDataURL('jpeg', 0.92);
        const img = await loadImageDimensions(dataUrl);
        const w = img.width, h = img.height;

        if (!first) doc.addPage([w, h]);
        else doc.internal.pageSize = { width: w, height: h };
        doc.addImage(dataUrl, 'JPEG', 0, 0, w, h);
        first = false;
      }

      doc.save(`manga-export-${Date.now()}.pdf`);
      Toast.show('PDF exported!', 'success');
    } catch(e) {
      Toast.show('PDF export failed: ' + e.message, 'error');
    }
  }

  async function exportTelegram() {
    const token  = document.getElementById('tg-bot-token')?.value.trim();
    const channel = document.getElementById('tg-channel')?.value.trim();
    const caption = document.getElementById('tg-caption')?.value.trim();

    if (!token || !channel) { Toast.show('Enter Bot Token and Channel ID', 'error'); return; }

    const pages = AppState.getPages();
    if (!pages.length) { Toast.show('No pages to publish', 'error'); return; }

    const btn = document.getElementById('export-tg');
    btn.innerHTML = '<span class="spinner"></span> Publishing…';
    btn.disabled = true;

    try {
      const dataUrls = pages.map(p => p.dataUrl || CanvasEngine.exportDataURL('jpeg', 0.9));
      await Api.publishTelegram(token, channel, dataUrls, caption);
      Toast.show('Published to Telegram!', 'success');
    } catch(e) {
      Toast.show('Telegram publish failed: ' + e.message, 'error');
    } finally {
      btn.innerHTML = Toolbar.ICONS.telegram + ' Publish to Telegram';
      btn.disabled = false;
    }
  }

  function loadImageDimensions(src) {
    return new Promise(res => {
      const img = new Image();
      img.onload = () => res(img);
      img.src = src;
    });
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  return {
    init,
    switchPanel,
    getTextStyle,
    onTextObjectSelected,
    onObjectDeselected,
    renderOCRResults,
    exportPNG,
    exportPDF,
  };
})();

window.PanelManager = PanelManager;

