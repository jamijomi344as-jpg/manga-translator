/**
 * canvas.js — Fabric.js canvas initialisation, pan, zoom, image loading.
 */

const CanvasManager = (() => {
  let _canvas = null;
  let _isPanning = false;
  let _lastPosX = 0;
  let _lastPosY = 0;
  let _bgImage = null;

  /** Initialise the Fabric canvas on #main-canvas */
  function init() {
    if (typeof fabric === 'undefined') {
      console.error('Fabric.js not loaded. Place vendor/fabric.min.js.');
      return;
    }
    const container = document.getElementById('canvas-container');
    const w = container.clientWidth  || 900;
    const h = container.clientHeight || 700;

    _canvas = new fabric.Canvas('main-canvas', {
      width: w,
      height: h,
      backgroundColor: '#1a1a2e',
      selection: true,
      preserveObjectStacking: true,
    });

    _bindEvents();
    _bindResize();
    console.info('[Canvas] Fabric.js canvas ready.');
  }

  /* ── Public: Load an image URL as background ── */
  function loadImage(dataUrl, meta) {
    if (!_canvas) return;
    fabric.Image.fromURL(dataUrl, (img) => {
      const scale = Math.min(
        (_canvas.width  * 0.9) / img.width,
        (_canvas.height * 0.9) / img.height
      );
      img.scale(scale);
      img.set({
        left: (_canvas.width  - img.width  * scale) / 2,
        top:  (_canvas.height - img.height * scale) / 2,
        selectable: false,
        evented: false,
        hasBorders: false,
        hasControls: false,
        name: '__background__',
      });

      // Remove old background
      const old = _canvas.getObjects().find(o => o.name === '__background__');
      if (old) _canvas.remove(old);

      _canvas.add(img);
      _canvas.sendToBack(img);
      _bgImage = img;
      _canvas.renderAll();
      document.getElementById('canvas-placeholder').classList.add('hidden');
    });
  }

  /* ── Replace background with a cleaned version ── */
  function replaceBackground(dataUrl) {
    if (!_canvas) return;
    fabric.Image.fromURL(dataUrl, (img) => {
      const scale = _bgImage ? _bgImage.scaleX : 1;
      const left  = _bgImage ? _bgImage.left  : 0;
      const top   = _bgImage ? _bgImage.top   : 0;
      img.set({ left, top, selectable: false, evented: false, hasBorders: false, hasControls: false, name: '__background__' });
      img.scale(scale);
      if (_bgImage) _canvas.remove(_bgImage);
      _canvas.add(img);
      _canvas.sendToBack(img);
      _bgImage = img;
      _canvas.renderAll();
    });
  }

  /* ── Add a text box at a given canvas coordinate ── */
  function addTextBox(text = 'Translation', left = 100, top = 100, styles = {}) {
    if (!_canvas) return null;
    const tb = new fabric.Textbox(text, {
      left, top,
      width: 180,
      fontSize: styles.fontSize || 18,
      fontFamily: styles.fontFamily || 'Inter',
      fill: styles.fill || '#ffffff',
      backgroundColor: styles.backgroundColor || 'transparent',
      textAlign: styles.textAlign || 'center',
      fontWeight: styles.fontWeight || 'normal',
      fontStyle: styles.fontStyle || 'normal',
      underline: styles.underline || false,
      stroke: styles.stroke || null,
      strokeWidth: styles.strokeWidth || 0,
      shadow: styles.shadow || null,
      editable: true,
      splitByGrapheme: false,
      name: `text_${Date.now()}`,
    });
    _canvas.add(tb);
    _canvas.setActiveObject(tb);
    _canvas.renderAll();
    return tb;
  }

  /* ── Export canvas as PNG data URL ── */
  function exportPNG() {
    if (!_canvas) return null;
    return _canvas.toDataURL({ format: 'png', multiplier: 1 });
  }

  /* ── Get all non-background objects for layers panel ── */
  function getLayers() {
    if (!_canvas) return [];
    return _canvas.getObjects().filter(o => o.name !== '__background__');
  }

  /* ── Get active object ── */
  function getActiveObject() {
    return _canvas ? _canvas.getActiveObject() : null;
  }

  /* ── Remove active object ── */
  function removeActiveObject() {
    if (!_canvas) return;
    const obj = _canvas.getActiveObject();
    if (obj && obj.name !== '__background__') {
      _canvas.remove(obj);
      _canvas.discardActiveObject();
      _canvas.renderAll();
    }
  }

  /* ── Set canvas interaction mode ── */
  function setMode(mode) {
    if (!_canvas) return;
    _canvas.isDrawingMode = false;
    if (mode === 'pan') {
      _canvas.defaultCursor = 'grab';
      _canvas.selection = false;
      _canvas.forEachObject(o => { o.selectable = (o.name === '__background__') ? false : false; });
    } else if (mode === 'select') {
      _canvas.defaultCursor = 'default';
      _canvas.selection = true;
      _canvas.forEachObject(o => { if (o.name !== '__background__') o.selectable = true; });
    } else if (mode === 'text') {
      _canvas.defaultCursor = 'text';
      _canvas.selection = false;
    } else if (mode === 'lasso') {
      _canvas.defaultCursor = 'crosshair';
      _canvas.selection = false;
    }
  }

  /* ── Zoom ── */
  function zoomIn()    { _setZoom(_canvas.getZoom() * 1.15); }
  function zoomOut()   { _setZoom(_canvas.getZoom() / 1.15); }
  function zoomReset() { _setZoom(1); _canvas.absolutePan({ x: 0, y: 0 }); }

  function _setZoom(z) {
    if (!_canvas) return;
    z = Math.min(Math.max(z, 0.1), 10);
    _canvas.setZoom(z);
    _canvas.renderAll();
    document.getElementById('zoom-label').textContent = Math.round(z * 100) + '%';
  }

  /* ── Return the raw Fabric canvas (for tools.js) ── */
  function raw() { return _canvas; }

  /* ── Internal event binding ── */
  function _bindEvents() {
    _canvas.on('mouse:down', (opt) => {
      if (AppState && AppState.activeTool === 'pan') {
        _isPanning = true;
        _canvas.defaultCursor = 'grabbing';
        const e = opt.e;
        _lastPosX = e.clientX;
        _lastPosY = e.clientY;
      }
      if (AppState && AppState.activeTool === 'text' && !opt.target) {
        const ptr = _canvas.getPointer(opt.e);
        const styles = PanelManager ? PanelManager.getTextStyles() : {};
        CanvasManager.addTextBox('Type here…', ptr.x, ptr.y, styles);
      }
    });

    _canvas.on('mouse:move', (opt) => {
      if (_isPanning && AppState && AppState.activeTool === 'pan') {
        const e = opt.e;
        const vpt = _canvas.viewportTransform;
        vpt[4] += e.clientX - _lastPosX;
        vpt[5] += e.clientY - _lastPosY;
        _canvas.requestRenderAll();
        _lastPosX = e.clientX;
        _lastPosY = e.clientY;
      }
    });

    _canvas.on('mouse:up', () => {
      _isPanning = false;
      if (AppState && AppState.activeTool === 'pan') _canvas.defaultCursor = 'grab';
    });

    _canvas.on('mouse:wheel', (opt) => {
      const delta = opt.e.deltaY;
      let zoom = _canvas.getZoom();
      zoom *= 0.999 ** delta;
      _setZoom(zoom);
      opt.e.preventDefault();
      opt.e.stopPropagation();
    });

    // Object selection → update layers panel
    _canvas.on('selection:created', () => { if (typeof PanelManager !== 'undefined') PanelManager.refreshLayers(); });
    _canvas.on('selection:updated', () => { if (typeof PanelManager !== 'undefined') PanelManager.refreshLayers(); });
    _canvas.on('object:added',   () => { if (typeof PanelManager !== 'undefined') PanelManager.refreshLayers(); });
    _canvas.on('object:removed', () => { if (typeof PanelManager !== 'undefined') PanelManager.refreshLayers(); });
  }

  function _bindResize() {
    const container = document.getElementById('canvas-container');
    const ro = new ResizeObserver(() => {
      if (!_canvas) return;
      _canvas.setWidth(container.clientWidth);
      _canvas.setHeight(container.clientHeight);
      _canvas.renderAll();
    });
    ro.observe(container);
  }

  return {
    init, loadImage, replaceBackground,
    addTextBox, exportPNG, getLayers, getActiveObject, removeActiveObject,
    setMode, zoomIn, zoomOut, zoomReset, raw,
  };
})();
