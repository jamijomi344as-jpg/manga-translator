/**
 * canvas.js — Fabric.js canvas engine
 * Handles: image display, text box creation, drag/resize,
 * selection rectangle (for clean tool), zoom/pan.
 */

const CanvasEngine = (() => {
  let fabricCanvas = null;
  let currentPageData = null; // { id, src, imageObj }
  let zoom = 1.0;
  const ZOOM_MIN = 0.2;
  const ZOOM_MAX = 4.0;

  // Selection rectangle state (for clean tool)
  let selRect = { active: false, startX: 0, startY: 0 };

  // ── Helpers ────────────────────────────────────────
  function getCanvasCoords(e) {
    const rect = fabricCanvas.upperCanvasEl.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / zoom,
      y: (e.clientY - rect.top) / zoom,
    };
  }

  // ── Init ───────────────────────────────────────────
  function init(canvasEl) {
    fabricCanvas = new fabric.Canvas(canvasEl, {
      selection: true,
      preserveObjectStacking: true,
      fireRightClick: true,
      stopContextMenu: true,
    });

    fabricCanvas.setWidth(canvasEl.offsetWidth || 900);
    fabricCanvas.setHeight(canvasEl.offsetHeight || 700);

    // Object selection events → update style panel
    fabricCanvas.on('selection:created', onSelect);
    fabricCanvas.on('selection:updated', onSelect);
    fabricCanvas.on('selection:cleared', () => {
      PanelManager.onObjectDeselected();
      updateLayersPanel();
    });

    fabricCanvas.on('object:modified', () => updateLayersPanel());
    fabricCanvas.on('object:added', () => updateLayersPanel());
    fabricCanvas.on('object:removed', () => updateLayersPanel());

    // Keyboard shortcuts
    document.addEventListener('keydown', handleKeyboard);

    // Pinch/wheel zoom
    setupZoom();

    return fabricCanvas;
  }

  function setupZoom() {
    const wrapper = document.getElementById('canvas-area');

    wrapper.addEventListener('wheel', (e) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.08 : 0.08;
      setZoom(zoom + delta);
    }, { passive: false });
  }

  function setZoom(value, center = false) {
    zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, value));
    document.getElementById('canvas-wrapper').style.transform = `scale(${zoom})`;
    document.getElementById('zoom-display').textContent = Math.round(zoom * 100) + '%';
  }

  function zoomIn()  { setZoom(zoom + 0.15); }
  function zoomOut() { setZoom(zoom - 0.15); }
  function zoomFit() {
    if (!currentPageData) return;
    const area = document.getElementById('canvas-area');
    const zx = area.clientWidth  / fabricCanvas.width;
    const zy = area.clientHeight / fabricCanvas.height;
    setZoom(Math.min(zx, zy) * 0.9);
  }
  function zoomReset() { setZoom(1.0); }

  // ── Load Image ─────────────────────────────────────
  function loadImage(src, pageId) {
    return new Promise((resolve) => {
      document.getElementById('canvas-empty').classList.add('hidden');

      fabric.Image.fromURL(src, (img) => {
        // Size canvas to image
        const maxW = document.getElementById('canvas-area').clientWidth  * 0.9;
        const maxH = document.getElementById('canvas-area').clientHeight * 0.9;
        const scale = Math.min(maxW / img.width, maxH / img.height, 1);

        fabricCanvas.setWidth(img.width   * scale);
        fabricCanvas.setHeight(img.height * scale);

        img.set({
          scaleX: scale, scaleY: scale,
          selectable: false,
          evented: false,
          name: '__background__',
        });

        // Remove old background
        const old = fabricCanvas.getObjects().find(o => o.name === '__background__');
        if (old) fabricCanvas.remove(old);

        fabricCanvas.add(img);
        fabricCanvas.sendToBack(img);
        fabricCanvas.renderAll();

        currentPageData = { id: pageId, src, imageObj: img, scale };
        zoomFit();
        updateLayersPanel();
        resolve(img);
      }, { crossOrigin: 'anonymous' });
    });
  }

  // ── Add Text Box ───────────────────────────────────
  function addTextBox(x, y, text = 'Click to edit', opts = {}) {
    const styleState = PanelManager.getTextStyle();

    const tx = new fabric.IText(text, {
      left: x || fabricCanvas.width / 2 - 80,
      top:  y || fabricCanvas.height / 2 - 20,
      fontFamily:  opts.fontFamily  || styleState.fontFamily  || 'Bangers',
      fontSize:    opts.fontSize    || styleState.fontSize     || 22,
      fill:        opts.fill        || styleState.fill         || '#000000',
      stroke:      opts.stroke      || styleState.stroke       || '',
      strokeWidth: opts.strokeWidth || styleState.strokeWidth  || 0,
      textAlign:   opts.textAlign   || styleState.textAlign    || 'center',
      fontWeight:  opts.fontWeight  || styleState.fontWeight   || 'normal',
      fontStyle:   opts.fontStyle   || styleState.fontStyle    || 'normal',
      lineHeight:  1.15,
      padding:     6,
      borderColor: '#7c3aed',
      cornerColor: '#a78bfa',
      cornerSize:  8,
      cornerStyle: 'circle',
      transparentCorners: false,
      name: 'textbox_' + Date.now(),
    });

    fabricCanvas.add(tx);
    fabricCanvas.setActiveObject(tx);
    tx.enterEditing();
    tx.selectAll();
    fabricCanvas.renderAll();
    return tx;
  }

  // ── Remove selected ────────────────────────────────
  function deleteSelected() {
    const active = fabricCanvas.getActiveObjects();
    active.forEach(o => {
      if (o.name !== '__background__') fabricCanvas.remove(o);
    });
    fabricCanvas.discardActiveObject();
    fabricCanvas.renderAll();
    updateLayersPanel();
  }

  // ── Duplicate selected ─────────────────────────────
  function duplicateSelected() {
    const active = fabricCanvas.getActiveObject();
    if (!active || active.name === '__background__') return;
    active.clone((cloned) => {
      cloned.set({ left: active.left + 15, top: active.top + 15, name: 'textbox_' + Date.now() });
      fabricCanvas.add(cloned);
      fabricCanvas.setActiveObject(cloned);
      fabricCanvas.renderAll();
    });
  }

  // ── Clear all text ─────────────────────────────────
  function clearTextLayers() {
    fabricCanvas.getObjects()
      .filter(o => o.name !== '__background__')
      .forEach(o => fabricCanvas.remove(o));
    fabricCanvas.renderAll();
    updateLayersPanel();
  }

  // ── Export canvas as Data URL ──────────────────────
  function exportDataURL(format = 'png', quality = 1) {
    fabricCanvas.discardActiveObject();
    fabricCanvas.renderAll();
    return fabricCanvas.toDataURL({ format, quality, multiplier: 1 });
  }

  // ── Selection events ───────────────────────────────
  function onSelect(e) {
    const obj = e.selected?.[0] || fabricCanvas.getActiveObject();
    if (obj && obj.type === 'i-text') {
      PanelManager.onTextObjectSelected(obj);
    }
    updateLayersPanel();
  }

  // ── Keyboard ───────────────────────────────────────
  function handleKeyboard(e) {
    const active = fabricCanvas?.getActiveObject();
    if (active?.isEditing) return; // don't intercept while typing

    if (e.key === 'Delete' || e.key === 'Backspace') deleteSelected();
    if (e.key === 'd' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); duplicateSelected(); }
    if (e.key === 'Escape') fabricCanvas?.discardActiveObject().renderAll();

    // Arrow nudge
    if (active && ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)) {
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      if (e.key === 'ArrowLeft')  active.set('left', active.left - step);
      if (e.key === 'ArrowRight') active.set('left', active.left + step);
      if (e.key === 'ArrowUp')    active.set('top', active.top - step);
      if (e.key === 'ArrowDown')  active.set('top', active.top + step);
      active.setCoords();
      fabricCanvas.renderAll();
    }
  }

  // ── Tool Mode ─────────────────────────────────────
  function setToolMode(mode) {
    switch(mode) {
      case 'select':
        fabricCanvas.defaultCursor = 'default';
        fabricCanvas.isDrawingMode = false;
        break;
      case 'text':
        fabricCanvas.defaultCursor = 'text';
        fabricCanvas.isDrawingMode = false;
        break;
      case 'clean':
        fabricCanvas.defaultCursor = 'crosshair';
        fabricCanvas.isDrawingMode = false;
        fabricCanvas.selection = false;
        break;
      default:
        fabricCanvas.defaultCursor = 'default';
        fabricCanvas.selection = true;
    }
  }

  // ── Layers panel sync ─────────────────────────────
  function updateLayersPanel() {
    const list = document.getElementById('layers-list');
    if (!list) return;
    const objs = fabricCanvas.getObjects().filter(o => o.name !== '__background__').reverse();
    list.innerHTML = '';

    if (!objs.length) {
      list.innerHTML = '<p class="text-muted" style="text-align:center;padding:16px;">No text layers yet</p>';
      return;
    }

    const activeObj = fabricCanvas.getActiveObject();

    objs.forEach((obj, i) => {
      const label = obj.text ? obj.text.substring(0, 22) + (obj.text.length > 22 ? '…' : '') : 'Object';
      const isActive = obj === activeObj;

      const item = document.createElement('div');
      item.className = 'layer-item' + (isActive ? ' active' : '');
      item.innerHTML = `
        <svg class="layer-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="4 7 4 4 20 4 20 7"></polyline><line x1="9" y1="20" x2="15" y2="20"></line><line x1="12" y1="4" x2="12" y2="20"></line>
        </svg>
        <span class="layer-name">${escapeHtml(label)}</span>
        <div class="layer-actions">
          <button class="layer-vis-btn" title="Toggle visibility" data-idx="${i}">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle>
            </svg>
          </button>
          <button class="layer-vis-btn" title="Delete" data-del="${i}" style="color:var(--danger)">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14H6L5 6"></path>
            </svg>
          </button>
        </div>`;

      item.addEventListener('click', (e) => {
        if (e.target.closest('[data-del]')) {
          fabricCanvas.remove(obj);
          fabricCanvas.renderAll();
          updateLayersPanel();
          return;
        }
        if (e.target.closest('[data-idx]')) {
          obj.visible = !obj.visible;
          fabricCanvas.renderAll();
          return;
        }
        fabricCanvas.setActiveObject(obj);
        fabricCanvas.renderAll();
        PanelManager.onTextObjectSelected(obj);
        updateLayersPanel();
      });

      list.appendChild(item);
    });
  }

  function getFabric()    { return fabricCanvas; }
  function getPageData()  { return currentPageData; }
  function getZoom()      { return zoom; }

  function escapeHtml(str) {
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  return {
    init, loadImage,
    addTextBox, deleteSelected, duplicateSelected, clearTextLayers,
    exportDataURL,
    setToolMode, updateLayersPanel,
    zoomIn, zoomOut, zoomFit, zoomReset, setZoom, getZoom,
    getFabric, getPageData,
  };
})();

window.CanvasEngine = CanvasEngine;

