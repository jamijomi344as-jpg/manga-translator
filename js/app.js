/**
 * app.js — Main application entry point.
 *   • AppState global
 *   • Toast system
 *   • File upload & page management
 *   • Toolbar tool switching
 *   • OCR & Clean Bubble wiring
 */

/* ═══════════════════════════════════════════════════════════ STATE */
const AppState = {
  pages:          [],  // [{id, file, filename, dataUrl, serverImageId}]
  currentPageIdx: -1,
  activeTool:     'select',
  get currentPage()    { return this.pages[this.currentPageIdx] || null; },
  get currentImageId() { return this.currentPage ? this.currentPage.serverImageId : null; },
};

/* ═══════════════════════════════════════════════════════════ TOAST */
const Toast = (() => {
  const container = () => document.getElementById('toast-container');

  function show(message, type = 'info', duration = 3500) {
    const toast = document.createElement('div');
    toast.className = `toast toast--${type}`;
    toast.innerHTML = `<span class="toast__dot"></span><span>${message}</span>`;
    container().appendChild(toast);

    setTimeout(() => {
      toast.classList.add('out');
      setTimeout(() => toast.remove(), 220);
    }, duration);
  }

  return { show };
})();

/* ═══════════════════════════════════════════════════════════ PAGE MANAGER */
const PageManager = (() => {

  function init() {
    document.getElementById('file-upload').addEventListener('change', _onFilesSelected);
  }

  async function _onFilesSelected(e) {
    const files = Array.from(e.target.files);
    if (!files.length) return;

    for (const file of files) {
      if (file.type === 'application/pdf') {
        await _addPdfFile(file);
      } else if (file.type.startsWith('image/')) {
        await _addPage(file);
      } else {
        Toast.show(`Skipped "${file.name}" (unsupported type: ${file.type || 'unknown'}).`, 'warning');
      }
    }
    // Reset so the same file(s) can be re-selected
    e.target.value = '';
  }

  /**
   * Parse a PDF file entirely in the browser with PDF.js.
   * Each page is rendered at 2× scale to an offscreen <canvas>,
   * converted to a PNG Blob, wrapped in a File, then fed through
   * the normal _addPage() → API.upload() pipeline.
   */
  async function _addPdfFile(file) {
    if (typeof pdfjsLib === 'undefined') {
      Toast.show('PDF.js not loaded — check your internet connection (CDN).', 'error');
      return;
    }

    Toast.show(`Parsing PDF: ${file.name}…`, 'info', 2000);

    let pdf;
    try {
      const arrayBuffer = await file.arrayBuffer();
      pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    } catch (err) {
      Toast.show(`Failed to parse PDF "${file.name}": ${err.message}`, 'error');
      return;
    }

    const total = pdf.numPages;
    Toast.show(`PDF has ${total} page(s). Rendering…`, 'info', 2500);

    for (let pageNum = 1; pageNum <= total; pageNum++) {
      try {
        const page       = await pdf.getPage(pageNum);
        const SCALE      = 2.0;                                    // 2× for high-quality output
        const viewport   = page.getViewport({ scale: SCALE });
        const offscreen  = document.createElement('canvas');
        offscreen.width  = viewport.width;
        offscreen.height = viewport.height;
        const ctx        = offscreen.getContext('2d');

        await page.render({ canvasContext: ctx, viewport }).promise;

        // Convert the offscreen canvas to a Blob (PNG)
        const blob = await new Promise((res) => offscreen.toBlob(res, 'image/png'));
        if (!blob) {
          Toast.show(`Page ${pageNum} of "${file.name}" could not be rendered.`, 'warning');
          continue;
        }

        const baseName   = file.name.replace(/\.pdf$/i, '');
        const pageFile   = new File([blob], `${baseName}_p${pageNum}.png`, { type: 'image/png' });
        await _addPage(pageFile);

        // Auto-select the first page of the PDF
        if (pageNum === 1) {
          _selectPage(AppState.pages.length - 1);
        }
      } catch (err) {
        Toast.show(`Error rendering page ${pageNum}: ${err.message}`, 'error');
      }
    }

    Toast.show(`✓ Imported ${total} page(s) from "${file.name}"`, 'success');
  }

  async function _addPage(file) {
    // Read as data URL for preview
    const dataUrl = await _readFileAsDataUrl(file);

    // Create page entry (without server ID yet)
    const page = {
      id: Date.now() + Math.random(),
      file,
      filename: file.name,
      dataUrl,
      serverImageId: null,
    };
    AppState.pages.push(page);
    _renderPageList();

    // Upload to server in background
    try {
      const res = await API.upload(file);
      page.serverImageId = res.image_id;
      Toast.show(`Uploaded: ${file.name}`, 'success');
      _renderPageList();
    } catch (err) {
      Toast.show(`Upload failed: ${err.message}`, 'error');
    }
  }

  function _renderPageList() {
    const list    = document.getElementById('page-list');
    const empty   = document.getElementById('page-list-empty');
    list.innerHTML = '';

    if (AppState.pages.length === 0) {
      empty.style.display = 'flex';
      return;
    }
    empty.style.display = 'none';

    AppState.pages.forEach((page, idx) => {
      const li = document.createElement('li');
      li.className = 'page-list__item' + (idx === AppState.currentPageIdx ? ' active' : '');
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', idx === AppState.currentPageIdx ? 'true' : 'false');
      li.innerHTML = `
        <img src="${page.dataUrl}" alt="${_escHtml(page.filename)}" loading="lazy" />
        <span class="page-label">${_escHtml(page.filename)}</span>
        <button class="page-remove" data-idx="${idx}" title="Remove page" aria-label="Remove page">✕</button>
      `;
      li.addEventListener('click', (e) => {
        if (e.target.classList.contains('page-remove')) return;
        _selectPage(idx);
      });
      li.querySelector('.page-remove').addEventListener('click', (e) => {
        e.stopPropagation();
        _removePage(idx);
      });
      list.appendChild(li);
    });
  }

  function _selectPage(idx) {
    AppState.currentPageIdx = idx;
    _renderPageList();
    const page = AppState.pages[idx];
    CanvasManager.loadImage(page.dataUrl, { filename: page.filename });
    document.getElementById('status-text').textContent = page.filename;
    document.getElementById('export-filename').value = page.filename.replace(/\.[^.]+$/, '');
    if (typeof PanelManager !== 'undefined') PanelManager.refreshLayers();
  }

  function _removePage(idx) {
    AppState.pages.splice(idx, 1);
    if (AppState.currentPageIdx >= AppState.pages.length) {
      AppState.currentPageIdx = AppState.pages.length - 1;
    }
    _renderPageList();
    if (AppState.pages.length === 0) {
      document.getElementById('canvas-placeholder').classList.remove('hidden');
    } else if (AppState.currentPageIdx >= 0) {
      _selectPage(AppState.currentPageIdx);
    }
  }

  function _readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload  = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('FileReader error'));
      reader.readAsDataURL(file);
    });
  }

  function _escHtml(str) {
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  return { init };
})();

/* ═══════════════════════════════════════════════════════════ TOOLBAR */
const ToolbarManager = (() => {
  const TOOLS = ['select','pan','text','lasso'];

  function init() {
    // Tool buttons
    TOOLS.forEach(tool => {
      const btn = document.getElementById(`tool-${tool}`);
      if (!btn) return;
      btn.addEventListener('click', () => _activateTool(tool));
    });

    // Zoom controls
    document.getElementById('btn-zoom-in').addEventListener('click',    () => CanvasManager.zoomIn());
    document.getElementById('btn-zoom-out').addEventListener('click',   () => CanvasManager.zoomOut());
    document.getElementById('btn-zoom-reset').addEventListener('click', () => CanvasManager.zoomReset());

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      // Skip if user is typing in an input
      if (['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)) return;
      switch (e.key.toLowerCase()) {
        case 'v': _activateTool('select'); break;
        case 'h': _activateTool('pan');    break;
        case 't': _activateTool('text');   break;
        case 'l': _activateTool('lasso');  break;
        case '+': case '=': CanvasManager.zoomIn();    break;
        case '-':             CanvasManager.zoomOut();   break;
        case '0':             CanvasManager.zoomReset(); break;
        case 'delete': case 'backspace':
          CanvasManager.removeActiveObject(); break;
      }
    });

    // OCR button (topbar)
    document.getElementById('btn-run-ocr').addEventListener('click', _runOcr);

    // OCR button (panel)
    document.getElementById('btn-ocr-panel').addEventListener('click', _runOcr);

    // Clean Bubble button
    document.getElementById('btn-clean-bubble').addEventListener('click', _cleanBubble);
  }

  function _activateTool(tool) {
    // Deactivate lasso if switching away
    if (AppState.activeTool === 'lasso' && tool !== 'lasso') {
      ToolManager.deactivateLasso();
      ToolManager.clearPendingRegion();
    }

    AppState.activeTool = tool;
    CanvasManager.setMode(tool);

    TOOLS.forEach(t => {
      const btn = document.getElementById(`tool-${t}`);
      if (btn) btn.classList.toggle('active', t === tool);
    });

    if (tool === 'lasso') ToolManager.activateLasso();

    const labels = { select:'Select', pan:'Pan', text:'Add Text', lasso:'Lasso Select' };
    document.getElementById('status-text').textContent = labels[tool] || tool;
  }

  async function _runOcr() {
    const imageId = AppState.currentImageId;
    if (!imageId) {
      Toast.show('Please upload and select a page first.', 'warning');
      return;
    }
    const srcLang = document.getElementById('src-lang').value;
    const tgtLang = document.getElementById('tgt-lang').value;

    try {
      showProgress('Running OCR & Translation…');
      const res = await API.ocr(imageId, srcLang, tgtLang);
      if (typeof PanelManager !== 'undefined') PanelManager.renderOcrResults(res.regions);

      // Switch to OCR panel
      document.querySelector('[data-panel="ocr"]').click();
      Toast.show(`Found ${res.regions.length} text region(s).`, 'success');
    } catch (err) {
      Toast.show(`OCR Error: ${err.message}`, 'error');
    } finally {
      hideProgress();
    }
  }

  async function _cleanBubble() {
    const imageId = AppState.currentImageId;
    if (!imageId) {
      Toast.show('No image loaded.', 'warning');
      return;
    }

    // Check for a lasso-selected region
    let region = ToolManager.getPendingRegion();

    // Fallback: use the active Fabric object's bounding box
    if (!region) {
      const obj = CanvasManager.getActiveObject();
      if (obj) {
        const bgObj = CanvasManager.raw().getObjects().find(o => o.name === '__background__');
        const scale = bgObj ? bgObj.scaleX : 1;
        const bLeft = bgObj ? bgObj.left   : 0;
        const bTop  = bgObj ? bgObj.top    : 0;
        region = {
          x: Math.round((obj.left  - bLeft)  / scale),
          y: Math.round((obj.top   - bTop)   / scale),
          w: Math.round((obj.width  * (obj.scaleX || 1)) / scale),
          h: Math.round((obj.height * (obj.scaleY || 1)) / scale),
        };
      }
    }

    if (!region || region.w < 5 || region.h < 5) {
      Toast.show('Use the Lasso tool to select a bubble region first.', 'warning');
      return;
    }

    try {
      showProgress('Cleaning bubble…');
      const res = await API.clean(imageId, [region]);
      CanvasManager.replaceBackground(res.cleaned);
      ToolManager.clearPendingRegion();
      Toast.show('Bubble cleaned successfully!', 'success');

      // Update stored dataUrl
      const page = AppState.currentPage;
      if (page) page.dataUrl = res.cleaned;
    } catch (err) {
      Toast.show(`Clean failed: ${err.message}`, 'error');
    } finally {
      hideProgress();
    }
  }

  return { init };
})();

/* ═══════════════════════════════════════════════════════════ BOOT */
document.addEventListener('DOMContentLoaded', () => {
  // ── Configure PDF.js worker (must be done before any getDocument call) ──
  if (typeof pdfjsLib !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  }

  // Check for Fabric.js
  if (typeof fabric === 'undefined') {
    document.getElementById('canvas-placeholder').innerHTML = `
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
      <p style="color:#ef4444">Fabric.js not found!<br/>Download it from <a href="https://fabricjs.com" target="_blank" style="color:#7c3aed">fabricjs.com</a><br/>and save as <code>vendor/fabric.min.js</code>.</p>
    `;
  }

  CanvasManager.init();
  PanelManager.init();
  PageManager.init();
  ToolbarManager.init();

  Toast.show('MangaType Studio ready!', 'info', 2500);
});
