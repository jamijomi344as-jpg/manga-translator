/**
 * api.js — Backend API client with mock fallback
 * All calls gracefully degrade when no backend is available.
 */

const API_BASE = window.MANGA_API_BASE || 'http://localhost:8000';

const Api = {
  _headers() {
    return { 'Content-Type': 'application/json' };
  },

  async _post(path, body) {
    const r = await fetch(API_BASE + path, {
      method: 'POST',
      headers: this._headers(),
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`API ${path} failed: ${r.status}`);
    return r.json();
  },

  async _postForm(path, formData) {
    const r = await fetch(API_BASE + path, { method: 'POST', body: formData });
    if (!r.ok) throw new Error(`API ${path} failed: ${r.status}`);
    return r.json();
  },

  /** Upload a raw page image → returns { page_id, url } */
  async uploadPage(file) {
    const fd = new FormData();
    fd.append('file', file);
    try {
      return await this._postForm('/api/upload', fd);
    } catch (e) {
      // mock fallback
      console.warn('[API mock] upload', e.message);
      return { page_id: 'mock_' + Date.now(), url: URL.createObjectURL(file) };
    }
  },

  /**
   * OCR a region of the image.
   * @param {string} pageId
   * @param {{ x, y, w, h }} region  – canvas coords
   * @returns {Promise<Array<{ text, bbox }>>}
   */
  async ocrRegion(pageId, region) {
    try {
      return await this._post('/api/ocr', { page_id: pageId, region });
    } catch (e) {
      console.warn('[API mock] ocr', e.message);
      // Return plausible mock data
      return [
        { text: '…やめろ！', bbox: { x: 30, y: 20, w: 120, h: 40 } },
        { text: 'なにをする気だ', bbox: { x: 30, y: 70, w: 150, h: 40 } },
      ];
    }
  },

  /** Full-page OCR */
  async ocrPage(pageId) {
    try {
      return await this._post('/api/ocr/full', { page_id: pageId });
    } catch (e) {
      console.warn('[API mock] ocr/full', e.message);
      return [
        { text: 'ちょっと待て！', bbox: { x: 40, y: 30, w: 130, h: 38 } },
        { text: '俺はただ…', bbox: { x: 60, y: 90, w: 100, h: 38 } },
        { text: 'お前を守りたかっただけだ', bbox: { x: 20, y: 200, w: 200, h: 38 } },
      ];
    }
  },

  /**
   * Inpaint (clean) a bubble region.
   * Returns a BLOB URL of the patched image.
   */
  async cleanBubble(pageId, region) {
    try {
      const fd = new FormData();
      fd.append('page_id', pageId);
      fd.append('region', JSON.stringify(region));
      const r = await fetch(API_BASE + '/api/clean', { method: 'POST', body: fd });
      if (!r.ok) throw new Error(r.status);
      const blob = await r.blob();
      return URL.createObjectURL(blob);
    } catch (e) {
      console.warn('[API mock] clean', e.message);
      return null; // caller handles null → show message
    }
  },

  /**
   * Translate text via backend (DeepL).
   * @param {string} text
   * @param {string} sourceLang  e.g. 'JA'
   * @param {string} targetLang  e.g. 'EN'
   */
  async translate(text, sourceLang = 'JA', targetLang = 'EN') {
    try {
      return await this._post('/api/translate', { text, source_lang: sourceLang, target_lang: targetLang });
    } catch (e) {
      console.warn('[API mock] translate', e.message);
      // Plausible mock translations
      const mocks = {
        'ちょっと待て！':         'Wait a moment!',
        '俺はただ…':             'I just…',
        'お前を守りたかっただけだ': 'All I wanted was to protect you.',
        '…やめろ！':             '...Stop!',
        'なにをする気だ':         'What are you planning to do?',
      };
      return { translated_text: mocks[text] || `[Translation of: ${text}]` };
    }
  },

  /**
   * Publish pages to Telegram.
   * @param {string} botToken
   * @param {string} channelId
   * @param {string[]} imageDataUrls
   * @param {string} caption
   */
  async publishTelegram(botToken, channelId, imageDataUrls, caption = '') {
    try {
      return await this._post('/api/telegram', {
        bot_token: botToken,
        channel_id: channelId,
        images: imageDataUrls,
        caption,
      });
    } catch (e) {
      console.warn('[API mock] telegram', e.message);
      throw e; // surface real errors
    }
  },
};

window.Api = Api;

