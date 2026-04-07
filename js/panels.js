/**
 * panels.js — Right-panel UI logic:
 *   • Tab switching
 *   • Style panel → apply styles to active Fabric object
 *   • OCR panel → render OCR result cards
 *   • Layers panel → render layer list
 *   • Export panel → PNG / PDF / Server / Telegram
 */

const PanelManager = (() => {

  /* ── Tab switching ── */
  function initTabs() {
    document.querySelectorAll('.panel-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.panel-tab').forEach(t => { t.classList.remove('active'); t.setAttribute('aria-selected','false'); });
        document.querySelectorAll('.panel-body').forEach(p => p.classList.remove('active'));
        tab.classList.add('active');
        tab.setAttribute('aria-selected', 'true');
        const panelId = 'panel-' + tab.dataset.panel;
        document.getElementById(panelId).classList.add('active');
      });
    });
  }

  /* ── STYLE PANEL ── */
  function initStylePanel() {
    // Bold / Italic / Underline toggles
    document.querySelectorAll('.style-toggle').forEach((btn) => {
      btn.addEventListener('click', () => btn.classList.toggle('active'));
    });

    // Alignment buttons
    document.querySelectorAll('.align-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.align-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });

    // Apply style button
    document.getElementById('btn-apply-style').addEventListener('click', () => {
      const obj = CanvasManager.getActiveObject();
      if (!obj || obj.type !== 'textbox') {
        Toast.show('Select a text box first.', 'warning');
        return;
      }
      const styles = getTextStyles();
      obj.set({
        fontFamily:      styles.fontFamily,
        fontSize:        styles.fontSize,
        fontWeight:      styles.fontWeight,
        fontStyle:       styles.fontStyle,
        underline:       styles.underline,
        textAlign:       styles.textAlign,
        fill:            styles.fill,
        backgroundColor: styles.backgroundColor,
        stroke:          styles.stroke,
        strokeWidth:     styles.strokeWidth,
        shadow:          styles.shadow,
      });
      CanvasManager.raw().renderAll();
      Toast.show('Style applied.', 'success');
    });

    // Delete selected
    document.getElementById('btn-delete-obj').addEventListener('click', () => {
      const obj = CanvasManager.getActiveObject();
      if (!obj || obj.name === '__background__') {
        Toast.show('Nothing selected.', 'warning');
        return;
      }
      CanvasManager.removeActiveObject();
      Toast.show('Object deleted.', 'info');
    });
  }

  /** Collect current style panel values into an object */
  function getTextStyles() {
    const fontFamily = document.getElementById('font-family').value;
    const fontSize   = parseInt(document.getElementById('font-size').value, 10) || 18;
    const isBold     = document.getElementById('btn-bold').classList.contains('active');
    const isItalic   = document.getElementById('btn-italic').classList.contains('active');
    const isUnder    = document.getElementById('btn-underline').classList.contains('active');
    const textColor  = document.getElementById('text-color').value;
    const bgColor    = document.getElementById('bg-color').value;
    const bgOpacity  = parseFloat(document.getElementById('bg-opacity').value);
    const strokeClr  = document.getElementById('stroke-color').value;
    const strokeW    = parseInt(document.getElementById('stroke-width').value, 10) || 0;
    const hasShadow  = document.getElementById('shadow-toggle').checked;
    const alignBtn   = document.querySelector('.align-btn.active');
    const textAlign  = alignBtn ? alignBtn.dataset.align : 'left';

    // Convert hex + opacity to rgba for backgroundColor
    const r = parseInt(bgColor.slice(1,3),16);
    const g = parseInt(bgColor.slice(3,5),16);
    const b = parseInt(bgColor.slice(5,7),16);
    const bgRgba = bgOpacity > 0 ? `rgba(${r},${g},${b},${bgOpacity})` : 'transparent';

    return {
      fontFamily,
      fontSize,
      fontWeight:      isBold   ? 'bold'   : 'normal',
      fontStyle:       isItalic ? 'italic' : 'normal',
      underline:       isUnder,
      textAlign,
      fill:            textColor,
      backgroundColor: bgRgba,
      stroke:          strokeW > 0 ? strokeClr : null,
      strokeWidth:     strokeW,
      shadow:          hasShadow
                         ? new fabric.Shadow({ color: 'rgba(0,0,0,0.6)', blur: 6, offsetX: 2, offsetY: 2 })
                         : null,
    };
  }

  /* ── OCR RESULTS ── */
  function renderOcrResults(regions) {
    const container = document.getElementById('ocr-results');
    container.innerHTML = '';

    if (!regions || regions.length === 0) {
      container.innerHTML = '<p class="ocr-results__empty">No text detected.</p>';
      return;
    }

    regions.forEach((region) => {
      const card = document.createElement('div');
      card.className = 'ocr-card';
      card.innerHTML = `
        <span class="ocr-card__lang-badge">OCR</span>
        <p class="ocr-card__original">${_escHtml(region.original)}</p>
        <p class="ocr-card__translated">${_escHtml(region.translated)}</p>
        <span class="ocr-card__score">Confidence: ${(region.confidence * 100).toFixed(1)}%</span>
        <div class="ocr-card__actions">
          <button class="ocr-card__btn" data-action="place" title="Place translated text on canvas">Place</button>
          <button class="ocr-card__btn" data-action="copy"  title="Copy translation to clipboard">Copy</button>
        </div>
      `;

      // Place button
      card.querySelector('[data-action="place"]').addEventListener('click', () => {
        const styles = getTextStyles();
        const { x, y, w, h } = region.bbox;
        const bgObj   = _getBackground();
        let left = 100, top = 100;
        if (bgObj) {
          left = bgObj.left + x * bgObj.scaleX;
          top  = bgObj.top  + y * bgObj.scaleY;
        }
        CanvasManager.addTextBox(region.translated, left, top, styles);
        Toast.show('Text placed on canvas.', 'success');
      });

      // Copy button
      card.querySelector('[data-action="copy"]').addEventListener('click', () => {
        navigator.clipboard.writeText(region.translated).then(() => Toast.show('Copied!', 'info'));
      });

      container.appendChild(card);
    });
  }

  function _getBackground() {
    const fc = CanvasManager.raw();
    if (!fc) return null;
    return fc.getObjects().find(o => o.name === '__background__') || null;
  }

  /* ── LAYERS PANEL ── */
  function refreshLayers() {
    const list   = document.getElementById('layer-list');
    const layers = CanvasManager.getLayers();
    list.innerHTML = '';

    if (layers.length === 0) {
      list.innerHTML = '<li style="color:var(--text-muted);font-size:.72rem;padding:.5rem;">No objects yet.</li>';
      return;
    }

    const fc = CanvasManager.raw();
    const active = fc ? fc.getActiveObject() : null;

    [...layers].reverse().forEach((obj, i) => {
      const li  = document.createElement('li');
      li.className = 'layer-item' + (obj === active ? ' active' : '');

      const icon = obj.type === 'textbox'
        ? `<svg class="layer-item__icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg>`
        : `<svg class="layer-item__icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>`;

      const name = obj.name || `${obj.type} ${i + 1}`;
      li.innerHTML = `${icon}<span class="layer-item__name">${_escHtml(name)}</span><span class="layer-item__type">${obj.type}</span>`;

      li.addEventListener('click', () => {
        if (fc) {
          fc.setActiveObject(obj);
          fc.renderAll();
        }
        refreshLayers();
      });
      list.appendChild(li);
    });
  }

  /* ── EXPORT PANEL ── */
  function initExportPanel() {
    // PNG download
    document.getElementById('btn-export-png').addEventListener('click', () => {
      const dataUrl = CanvasManager.exportPNG();
      if (!dataUrl) { Toast.show('Canvas is empty.', 'warning'); return; }
      const name = _exportName('png');
      _triggerDownload(dataUrl, name);
      Toast.show(`Exported as ${name}`, 'success');
    });

    // PDF download
    document.getElementById('btn-export-pdf').addEventListener('click', async () => {
      if (typeof window.jspdf === 'undefined' && typeof jsPDF === 'undefined') {
        Toast.show('jsPDF not loaded. Add vendor/jspdf.umd.min.js.', 'error');
        return;
      }
      const dataUrl = CanvasManager.exportPNG();
      if (!dataUrl) { Toast.show('Canvas is empty.', 'warning'); return; }

      const { jsPDF: _jsPDF } = window.jspdf || {};
      const PDF = _jsPDF || jsPDF;
      const img = new Image();
      img.src = dataUrl;
      await new Promise(r => { img.onload = r; });
      const pdf = new PDF({ orientation: img.width > img.height ? 'l' : 'p', unit: 'px', format: [img.width, img.height] });
      pdf.addImage(dataUrl, 'PNG', 0, 0, img.width, img.height);
      const name = _exportName('pdf');
      pdf.save(name);
      Toast.show(`Exported as ${name}`, 'success');
    });

    // Save to server
    document.getElementById('btn-export-server').addEventListener('click', async () => {
      const imageId = AppState.currentImageId;
      if (!imageId) { Toast.show('No image loaded.', 'warning'); return; }
      const dataUrl = CanvasManager.exportPNG();
      if (!dataUrl) { Toast.show('Canvas is empty.', 'warning'); return; }
      const name = _exportName('png');
      try {
        showProgress('Saving to server…');
        const res = await API.exportToServer(imageId, dataUrl, name);
        Toast.show(`Saved: ${res.filename}`, 'success');
      } catch (e) {
        Toast.show(e.message, 'error');
      } finally {
        hideProgress();
      }
    });

    // Telegram
    document.getElementById('btn-telegram').addEventListener('click', async () => {
      const token  = document.getElementById('tg-bot-token').value.trim();
      const chatId = document.getElementById('tg-chat-id').value.trim() || '@dunxuauniverse';
      const caption = document.getElementById('tg-caption').value.trim();
      const scope   = document.querySelector('input[name="tg-scope"]:checked').value;

      if (!token)  { Toast.show('Enter a Telegram Bot Token.', 'warning'); return; }
      if (!chatId) { Toast.show('Enter a chat/channel ID.', 'warning'); return; }

      let images = [];
      if (scope === 'all') {
        images = AppState.pages.map(p => p.dataUrl);
      } else {
        const dataUrl = CanvasManager.exportPNG();
        if (!dataUrl) { Toast.show('Canvas is empty.', 'warning'); return; }
        images = [dataUrl];
      }

      try {
        showProgress('Sending to Telegram…');
        const res = await API.sendTelegram(token, chatId, images, caption);
        const ok  = res.results.filter(r => r.status === 'sent').length;
        const err = res.results.filter(r => r.status === 'error').length;
        if (err === 0)      Toast.show(`${ok} page(s) sent ✓`, 'success');
        else if (ok === 0)  Toast.show(`All pages failed. Check token/chat ID.`, 'error');
        else                Toast.show(`${ok} sent, ${err} failed.`, 'warning');
      } catch (e) {
        Toast.show(e.message, 'error');
      } finally {
        hideProgress();
      }
    });

    // Refresh layers button
    document.getElementById('btn-refresh-layers').addEventListener('click', refreshLayers);
  }

  /* ── Helpers ── */
  function _exportName(ext) {
    const base = document.getElementById('export-filename').value.trim() || 'manga_page';
    return `${base}.${ext}`;
  }

  function _triggerDownload(dataUrl, filename) {
    const a = document.createElement('a');
    a.href = dataUrl; a.download = filename;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
  }

  function _escHtml(str) {
    return String(str)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }

  /* ── Public init ── */
  function init() {
    initTabs();
    initStylePanel();
    initExportPanel();
  }

  return { init, renderOcrResults, refreshLayers, getTextStyles };
})();

/* ─── Progress overlay helpers (global scope for use across modules) ─── */
function showProgress(label = 'Processing…') {
  document.getElementById('progress-label').textContent = label;
  document.getElementById('progress-overlay').classList.remove('hidden');
}
function hideProgress() {
  document.getElementById('progress-overlay').classList.add('hidden');
}
