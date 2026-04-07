/**
 * tools.js — Lasso / rubber-band selection for the "Clean Bubble" feature.
 * Uses mouse events on the Fabric canvas to draw a rubber-band rect,
 * then extracts the bounded region for inpainting.
 */

const ToolManager = (() => {
  let _lassoRect   = null;   // Fabric rect overlay while dragging
  let _isDrawing   = false;
  let _startX      = 0;
  let _startY      = 0;
  let _pendingRegion = null; // {x,y,w,h} in image-space, ready to clean

  /* ── Called by AppState when lasso mode is activated ── */
  function activateLasso() {
    const fc = CanvasManager.raw();
    if (!fc) return;
    fc.on('mouse:down', _onDown);
    fc.on('mouse:move', _onMove);
    fc.on('mouse:up',   _onUp);
  }

  function deactivateLasso() {
    const fc = CanvasManager.raw();
    if (!fc) return;
    fc.off('mouse:down', _onDown);
    fc.off('mouse:move', _onMove);
    fc.off('mouse:up',   _onUp);
    _removeLassoRect(fc);
  }

  function _onDown(opt) {
    if (!AppState || AppState.activeTool !== 'lasso') return;
    const fc = CanvasManager.raw();
    const ptr = fc.getPointer(opt.e);
    _startX = ptr.x;
    _startY = ptr.y;
    _isDrawing = true;
    _removeLassoRect(fc);

    _lassoRect = new fabric.Rect({
      left: _startX, top: _startY,
      width: 0, height: 0,
      fill: 'rgba(124,58,237,0.15)',
      stroke: '#7c3aed', strokeWidth: 1.5,
      strokeDashArray: [5, 3],
      selectable: false, evented: false,
      name: '__lasso__',
    });
    fc.add(_lassoRect);
  }

  function _onMove(opt) {
    if (!_isDrawing || !_lassoRect) return;
    const fc  = CanvasManager.raw();
    const ptr = fc.getPointer(opt.e);
    const w   = ptr.x - _startX;
    const h   = ptr.y - _startY;

    _lassoRect.set({
      left:   w < 0 ? ptr.x   : _startX,
      top:    h < 0 ? ptr.y   : _startY,
      width:  Math.abs(w),
      height: Math.abs(h),
    });
    fc.renderAll();
  }

  function _onUp(opt) {
    if (!_isDrawing) return;
    _isDrawing = false;
    const fc  = CanvasManager.raw();
    const ptr = fc.getPointer(opt.e);

    const x = Math.min(_startX, ptr.x);
    const y = Math.min(_startY, ptr.y);
    const w = Math.abs(ptr.x - _startX);
    const h = Math.abs(ptr.y - _startY);

    if (w < 5 || h < 5) {
      _removeLassoRect(fc);
      return;
    }

    // Convert from canvas-space to image-space accounting for zoom/pan
    const zoom = fc.getZoom();
    const vpt  = fc.viewportTransform;

    // Find background image
    const bgObj = fc.getObjects().find(o => o.name === '__background__');
    let imgX = 0, imgY = 0, imgScale = 1;
    if (bgObj) {
      imgX     = bgObj.left;
      imgY     = bgObj.top;
      imgScale = bgObj.scaleX;
    }

    // canvas-space coords relative to bg image origin
    _pendingRegion = {
      x: Math.round((x - imgX) / imgScale),
      y: Math.round((y - imgY) / imgScale),
      w: Math.round(w / imgScale),
      h: Math.round(h / imgScale),
    };

    Toast.show('Region selected. Click "Clean Bubble" to erase.', 'info');
    // Keep dotted rect visible as visual feedback
  }

  function _removeLassoRect(fc) {
    if (_lassoRect) { fc.remove(_lassoRect); _lassoRect = null; }
    const old = fc.getObjects().find(o => o.name === '__lasso__');
    if (old) fc.remove(old);
  }

  /* ── Public: returns {x,y,w,h} or null ── */
  function getPendingRegion() { return _pendingRegion; }
  function clearPendingRegion() {
    _pendingRegion = null;
    const fc = CanvasManager.raw();
    if (fc) _removeLassoRect(fc);
  }

  return { activateLasso, deactivateLasso, getPendingRegion, clearPendingRegion };
})();
