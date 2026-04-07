/**
 * tools.js — Tool mode management + clean-bubble lasso tool
 */

const Tools = (() => {

  let currentTool = 'select';

  // For the rectangular "clean" selection
  let isDrawing   = false;
  let startX = 0, startY = 0;
  let selOverlay  = null;

  const TOOLS = ['select', 'text', 'clean'];

  function init() {
    selOverlay = document.getElementById('selection-overlay');

    document.querySelectorAll('[data-tool]').forEach(btn => {
      btn.addEventListener('click', () => setTool(btn.dataset.tool));
    });

    // Set up canvas mouse events for clean tool
    const area = document.getElementById('canvas-area');
    area.addEventListener('mousedown', onMouseDown);
    area.addEventListener('mousemove', onMouseMove);
    area.addEventListener('mouseup',   onMouseUp);
  }

  function setTool(name) {
    if (!TOOLS.includes(name)) return;
    currentTool = name;

    // Update toolbar button states
    document.querySelectorAll('[data-tool]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tool === name);
    });

    CanvasEngine.setToolMode(name);

    // Update cursor hint in status bar
    const hints = {
      select: 'Select & move objects',
      text:   'Click on canvas to place a text box',
      clean:  'Draw a rectangle over the speech bubble to clean it',
    };
    StatusBar.setMessage(hints[name] || '');
  }

  function getTool() { return currentTool; }

  // ── Canvas mouse for text + clean tool ─────────────
  function onMouseDown(e) {
    if (currentTool === 'clean') {
      const pos = getRelativePos(e);
      startX = pos.x; startY = pos.y;
      isDrawing = true;
      selOverlay.style.cssText = `display:block;left:${startX}px;top:${startY}px;width:0;height:0`;
    }
  }

  function onMouseMove(e) {
    if (!isDrawing || currentTool !== 'clean') return;
    const pos = getRelativePos(e);
    const x = Math.min(pos.x, startX), y = Math.min(pos.y, startY);
    const w = Math.abs(pos.x - startX), h = Math.abs(pos.y - startY);
    selOverlay.style.cssText = `display:block;left:${x}px;top:${y}px;width:${w}px;height:${h}px`;
  }

  async function onMouseUp(e) {
    if (currentTool === 'text') {
      // Only fire if click was directly on canvas-area (not on Fabric canvas)
      if (e.target.tagName === 'CANVAS') return; // Fabric handles canvas clicks
      return;
    }

    if (!isDrawing || currentTool !== 'clean') return;
    isDrawing = false;

    const pos = getRelativePos(e);
    const x = Math.min(pos.x, startX), y = Math.min(pos.y, startY);
    const w = Math.abs(pos.x - startX), h = Math.abs(pos.y - startY);

    selOverlay.style.display = 'none';

    if (w < 10 || h < 10) { StatusBar.setMessage('Selection too small'); return; }

    await triggerClean({ x, y, w, h });
  }

  function getRelativePos(e) {
    const rect = document.getElementById('canvas-area').getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  async function triggerClean(region) {
    const pd = CanvasEngine.getPageData();
    if (!pd) { Toast.show('No page loaded', 'error'); return; }

    StatusBar.setMessage('Cleaning bubble… (sending to backend)');
    Toast.show('Cleaning speech bubble…', 'info');

    try {
      const cleanUrl = await Api.cleanBubble(pd.id, region);

      if (cleanUrl) {
        // Backend returned a cleaned image — reload it
        await CanvasEngine.loadImage(cleanUrl, pd.id);
        Toast.show('Bubble cleaned!', 'success');
      } else {
        // Mock mode: draw a white rectangle over the selection
        const fabricCanvas = CanvasEngine.getFabric();
        const zoom = CanvasEngine.getZoom();
        const wrapperRect = document.getElementById('canvas-wrapper').getBoundingClientRect();
        const areaRect    = document.getElementById('canvas-area').getBoundingClientRect();

        const relX = (region.x - (wrapperRect.left - areaRect.left)) / zoom;
        const relY = (region.y - (wrapperRect.top  - areaRect.top )) / zoom;
        const relW = region.w / zoom;
        const relH = region.h / zoom;

        const rect = new fabric.Rect({
          left: relX, top: relY,
          width: relW, height: relH,
          fill: '#ffffff',
          selectable: false, evented: false,
          name: 'clean_patch_' + Date.now(),
        });
        fabricCanvas.add(rect);
        fabricCanvas.sendToBack(rect);

        // Send background to very back
        const bg = fabricCanvas.getObjects().find(o => o.name === '__background__');
        if (bg) fabricCanvas.sendToBack(bg);

        fabricCanvas.renderAll();
        Toast.show('Applied mock clean (connect backend for real inpainting)', 'info');
      }
    } catch(err) {
      Toast.show('Clean failed: ' + err.message, 'error');
    }

    StatusBar.setMessage('');
  }

  return { init, setTool, getTool };
})();

window.Tools = Tools;

