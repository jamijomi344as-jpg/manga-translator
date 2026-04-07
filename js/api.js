/**
 * api.js — All fetch calls to the FastAPI backend.
 * Relative base URL so production on Render.com works without changes.
 */
const API_BASE = '';

const API = {
  /**
   * Upload an image file. Returns { image_id, filename, width, height }.
   * @param {File} file
   * @returns {Promise<Object>}
   */
  async upload(file) {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch(`${API_BASE}/api/upload`, { method: 'POST', body: form });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || 'Upload failed');
    }
    return res.json();
  },

  /**
   * Run OCR + translation on a stored image.
   * @param {string} imageId
   * @param {string} sourceLang  e.g. "ja"
   * @param {string} targetLang  e.g. "en"
   * @returns {Promise<{image_id:string, regions:Array}>}
   */
  async ocr(imageId, sourceLang = 'ja', targetLang = 'en') {
    const res = await fetch(`${API_BASE}/api/ocr`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_id: imageId, source_lang: sourceLang, target_lang: targetLang }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || 'OCR failed');
    }
    return res.json();
  },

  /**
   * Inpaint regions to clean speech-bubble text.
   * @param {string} imageId
   * @param {Array<{x,y,w,h}>} regions
   * @returns {Promise<{image_id:string, cleaned:string}>}  cleaned is a data-URL PNG
   */
  async clean(imageId, regions) {
    const res = await fetch(`${API_BASE}/api/clean`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_id: imageId, regions }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || 'Clean failed');
    }
    return res.json();
  },

  /**
   * Save canvas PNG to the server exports/ directory.
   * @param {string} imageId
   * @param {string} canvasData  base64 data-URL PNG
   * @param {string} filename
   * @returns {Promise<{path:string, filename:string}>}
   */
  async exportToServer(imageId, canvasData, filename) {
    const res = await fetch(`${API_BASE}/api/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_id: imageId, canvas_data: canvasData, filename }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || 'Export failed');
    }
    return res.json();
  },

  /**
   * Send images to a Telegram channel/chat via bot API.
   * @param {string} botToken
   * @param {string} chatId
   * @param {string[]} images  array of base64 data-URL PNGs
   * @param {string} caption
   * @returns {Promise<{results:Array}>}
   */
  async sendTelegram(botToken, chatId, images, caption = '') {
    const res = await fetch(`${API_BASE}/api/telegram`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bot_token: botToken, chat_id: chatId, images, caption }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || 'Telegram export failed');
    }
    return res.json();
  },
};
