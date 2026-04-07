/**
 * app.js — Bootstrap, state management, page list, toolbar, toasts, status bar
 */

// ════════════════════════════════════════════════
//  APP STATE
// ════════════════════════════════════════════════
const AppState = (() => {
  let pages = [];       // [{ id, src, thumb, name, dataUrl }]
  let currentPageIdx = -1;

  function addPage(file, src) {
    const id = 'page_' + Date.now() + '_' + Math.random().toString(36).slice(2);
    const page = { id, src, thumb: src, name: file.name, dataUrl: null };
    pages.push(page);
    return page;
  }

  function getPages()          { return pages; }
  function getCurrentPage()    { return pages[currentPageIdx] || null; }
  function getCurrentIndex()   { return currentPageIdx; }
  function setCurrentIndex(i)  { currentPageIdx = i; }
  function removePage(idx)     { pages.splice(idx, 1); if (currentPageIdx >= pages.length) currentPageIdx = pages.length - 1; }
  function updateDataUrl(idx, dataUrl) { if (pages[idx]) pages[idx].dataUrl = dataUrl; }

  return { addPage, getPages, getCurrentPage, getCurrentIndex, setCurrentIndex, removePage, updateDataUrl };
})();

window.AppState = AppState;

// ════════════════════════════════════════════════
//  TOAST NOTIFICATIONS
// ════════════════════════════════════════════════
const Toast = (() => {
  const icons = {
    success: `<svg class="toast-icon" width="16" height="16" fill="none" stroke="#10b981" stroke-width="2" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>`,
    error:   `<svg class="toast-icon" width="16" height="16" fill="none" stroke="#ef4444" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`,
    info:    `<svg class="toast-icon" width="16" height="16" fill="none" stroke="#3b82f6" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
  };

  function show(message, type = 'info', duration = 3200) {
    const container = document.getElementById('toast-container');
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = (icons[type] || '') + `<span>${message}</span>`;
    container.appendChild(el);
    requestAnimationFrame(() => { requestAnimationFrame(() => { el.classList.add('show'); }); });
    setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => el.remove(), 350);
    }, duration);
  }

  return { show };
})();

window.Toast = Toast;

// ════════════════════════════════════════════════
//  STATUS BAR
// ════════════════════════════════════════════════
const StatusBar = (() => {
  function setMessage(msg) {
    const el = document.getElementById('status-msg');
    if (el) el.textContent = msg || '';
  }

  function updateCoords(x, y) {
    const el = document.getElementById('stat-coords');
    if (el) el.textContent = `${Math.round(x)}, ${Math.round(y)}`;
  }

  function updateObjectCount() {
    const fab = CanvasEngine.getFabric();
    const el  = document.getElementById('stat-objects');
    if (el && fab) {
      const count = fab.getObjects().filter(o => o.name !== '__background__').length;
      el.textContent = count;
    }
  }

  return { setMessage, updateCoords, updateObjectCount };
})();

window.StatusBar = StatusBar;

// ════════════════════════════════════════════════
//  TOOLBAR
// ════════════════════════════════════════════════
const Toolbar = (() => {
  const ICONS = {
    telegram: `<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221l-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12l-6.871 4.326-2.962-.924c-.643-.204-.657-.643.136-.953l11.57-4.461c.537-.194 1.006.131.833.94z"/></svg>`,
  };

  function init() {
    // Zoom
    document.getElementById('btn-zoom-in' )?.addEventListener('click', () => CanvasEngine.zoomIn());
    document.getElementById('btn-zoom-out')?.addEventListener('click', () => CanvasEngine.zoomOut());
    document.getElementById('btn-zoom-fit')?.addEventListener('click', () => CanvasEngine.zoomFit());
    document.getElementById('btn-zoom-100')?.addEventListener('click', () => CanvasEngine.zoomReset());

    // Undo / redo (placeholder — full undo stack via fabric history plugin would be added)
    document.getElementById('btn-undo')?.addEventListener('click', () => Toast.show('Undo (full history coming soon)', 'info'));
    document.getElementById('btn-redo')?.addEventListener('click', () => Toast.show('Redo (full history coming soon)', 'info'));

    // Delete selected
    document.getElementById('btn-delete')?.addEventListener('click', () => CanvasEngine.deleteSelected());

    // Duplicate
    document.getElementById('btn-duplicate')?.addEventListener('click', () => CanvasEngine.duplicateSelected());

    // Clear texts
    document.getElementById('btn-clear-text')?.addEventListener('click', () => {
      if (confirm('Remove all text layers from this page?')) {
        CanvasEngine.clearTextLayers();
        Toast.show('All text layers removed', 'info');
      }
    });

    // Save snapshot (dataUrl on current page)
    document.getElementById('btn-save')?.addEventListener('click', saveSnapshot);

    // Upload input
    document.getElementById('file-upload-input')?.addEventListener('change', handleFileUpload);

    // Drag & drop onto sidebar upload zone
    const dropZone = document.getElementById('sidebar-upload');
    setupDropZone(dropZone, handleFiles);

    // Also drag & drop onto canvas area
    const canvasArea = document.getElementById('canvas-area');
    setupDropZone(canvasArea, handleFiles);
  }

  function setupDropZone(el, handler) {
    if (!el) return;
    el.addEventListener('dragover', (e) => { e.preventDefault(); el.classList.add('drag-highlight'); });
    el.addEventListener('dragleave', () => el.classList.remove('drag-highlight'));
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      el.classList.remove('drag-highlight');
      const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
      if (files.length) handler(files);
    });
  }

  async function handleFileUpload(e) {
    const files = Array.from(e.target.files);
    if (files.length) handleFiles(files);
    e.target.value = ''; // reset for re-upload
  }

  async function handleFiles(files) {
    for (const file of files) {
      const src = URL.createObjectURL(file);
      const page = AppState.addPage(file, src);

      try {
        const apiResult = await Api.uploadPage(file);
        page.id = apiResult.page_id;
      } catch(e) {
        // stay with local id
      }

      renderPagesList();

      // Auto-switch to first uploaded page
      if (AppState.getPages().length === 1) {
        await switchToPage(0);
      }
    }
    Toast.show(`Added ${files.length} page(s)`, 'success');
  }

  function renderPagesList() {
    const list = document.getElementById('pages-list');
    list.innerHTML = '';
    const pages = AppState.getPages();
    const currentIdx = AppState.getCurrentIndex();

    pages.forEach((page, i) => {
      const thumb = document.createElement('div');
      thumb.className = 'page-thumb' + (i === currentIdx ? ' active' : '');
      thumb.innerHTML = `
        <img src="${page.thumb}" alt="Page ${i+1}" loading="lazy">
        <div class="page-thumb-label">Page ${i+1}</div>
        <button class="page-remove" title="Remove page">✕</button>`;

      thumb.addEventListener('click', (e) => {
        if (e.target.classList.contains('page-remove')) {
          e.stopPropagation();
          AppState.removePage(i);
          renderPagesList();
          if (AppState.getPages().length > 0) switchToPage(Math.min(i, AppState.getPages().length - 1));
          else showEmptyState();
          return;
        }
        switchToPage(i);
      });

      list.appendChild(thumb);
    });

    // Update page indicator
    document.getElementById('page-current').textContent = (currentIdx + 1) || 0;
    document.getElementById('page-total').textContent   = pages.length;
  }

  async function switchToPage(idx) {
    // Save current page's canvas snapshot
    const prevIdx = AppState.getCurrentIndex();
    if (prevIdx >= 0) {
      const dataUrl = CanvasEngine.exportDataURL('jpeg', 0.92);
      AppState.updateDataUrl(prevIdx, dataUrl);
    }

    AppState.setCurrentIndex(idx);
    const page = AppState.getPages()[idx];
    if (!page) return;

    // Load image
    await CanvasEngine.loadImage(page.src, page.id);
    renderPagesList();

    StatusBar.setMessage(`Page ${idx + 1} of ${AppState.getPages().length}`);
  }

  function showEmptyState() {
    document.getElementById('canvas-empty').classList.remove('hidden');
  }

  function saveSnapshot() {
    const idx = AppState.getCurrentIndex();
    if (idx < 0) { Toast.show('No page loaded', 'error'); return; }
    const dataUrl = CanvasEngine.exportDataURL('jpeg', 0.95);
    AppState.updateDataUrl(idx, dataUrl);
    Toast.show('Snapshot saved', 'success');
  }

  return { init, ICONS, renderPagesList, switchToPage };
})();

window.Toolbar = Toolbar;

// ════════════════════════════════════════════════
//  CANVAS TEXT CLICK HANDLER
// ════════════════════════════════════════════════
function setupCanvasTextClick() {
  const fabricCanvas = CanvasEngine.getFabric();

  // When tool is "text" and user left-clicks on empty canvas area → add text box
  fabricCanvas.on('mouse:down', (opt) => {
    if (Tools.getTool() !== 'text') return;

    const target = opt.target;
    if (target && target.type === 'i-text') {
      // Clicked an existing text box → let fabric handle
      return;
    }

    const pointer = fabricCanvas.getPointer(opt.e);
    CanvasEngine.addTextBox(pointer.x, pointer.y, 'Translation text');

    StatusBar.setMessage('Text box added — double-click to edit');
    StatusBar.updateObjectCount();
  });

  // Track mouse coords in status bar
  fabricCanvas.on('mouse:move', (opt) => {
    const p = fabricCanvas.getPointer(opt.e);
    StatusBar.updateCoords(p.x, p.y);
  });

  fabricCanvas.on('object:modified', () => StatusBar.updateObjectCount());
  fabricCanvas.on('object:added',    () => StatusBar.updateObjectCount());
  fabricCanvas.on('object:removed',  () => StatusBar.updateObjectCount());
}

// ════════════════════════════════════════════════
//  INIT
// ════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  // Init canvas
  const canvasEl = document.getElementById('main-canvas');
  CanvasEngine.init(canvasEl);

  // Init modules
  PanelManager.init();
  Tools.init();
  Toolbar.init();
  setupCanvasTextClick();

  // Upload CTA button
  document.getElementById('canvas-upload-btn')?.addEventListener('click', () => {
    document.getElementById('file-upload-input').click();
  });

  // Sidebar upload trigger
  document.getElementById('sidebar-upload')?.addEventListener('click', () => {
    document.getElementById('file-upload-input').click();
  });

  // Initial state
  Toolbar.renderPagesList();
  StatusBar.setMessage('Ready — upload a manga page to get started');

  console.log('[MangaTypesetter] App initialized ✓');
});

