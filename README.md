# MangaType Studio 🎌

> **Full-Stack Manga · Donghua · Manhwa Translator & Typesetter**  
> Powered by PaddleOCR + Google Translate · Served by FastAPI · Designed for Render.com

---

## Features

| Feature | Details |
|---|---|
| 📤 Upload | Multi-image upload with instant preview |
| 🔍 OCR | PaddleOCR (Japanese/Korean/Chinese) with confidence scores |
| 🌐 Translate | Auto-translate via `deep-translator` (GoogleTranslator) |
| 🎨 Typeset | Fabric.js canvas — add, style, and position text boxes |
| 🧹 Clean Bubble | Lasso-select a speech bubble → OpenCV `inpaint` erases text |
| 💾 Export | PNG download, PDF (jsPDF), or save to server |
| 📨 Telegram | Send pages directly to any Telegram channel via Bot API |

---

## Project Structure

```
manga_translator/
├── backend_main.py     ← FastAPI app (OCR, translate, clean, export, Telegram)
├── requirements.txt    ← Python dependencies
├── index.html          ← Single-page frontend
├── README.md
├── css/
│   └── style.css       ← Dark theme, glassmorphism, animations
├── js/
│   ├── api.js          ← fetch wrappers for all API endpoints
│   ├── app.js          ← AppState, Toast, PageManager, ToolbarManager
│   ├── canvas.js       ← Fabric.js canvas manager
│   ├── panels.js       ← Right-panel UI (Style, OCR, Layers, Export)
│   └── tools.js        ← Lasso/rubber-band selection tool
└── vendor/             ← ⚠️  You must populate this folder manually:
    ├── fabric.min.js
    └── jspdf.umd.min.js
```

---

## Quick Start (Local)

```bash
# 1. Create & activate virtual environment
python -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate

# 2. Install dependencies
pip install -r requirements.txt

# 3. Download vendor JS files
mkdir -p vendor
curl -L https://cdnjs.cloudflare.com/ajax/libs/fabric.js/5.3.1/fabric.min.js   -o vendor/fabric.min.js
curl -L https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js   -o vendor/jspdf.umd.min.js

# 4. Run
python backend_main.py
```

Open **http://localhost:8000** in your browser.

---

## Render.com Deployment

1. Push this folder to a GitHub repository.
2. Create a new **Web Service** on [render.com](https://render.com).
3. Set:
   - **Build Command:** `pip install -r requirements.txt`
   - **Start Command:** `python backend_main.py`
   - **Environment:** Python 3.10+
4. Add an environment variable if needed: `PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK=True`
5. In your shell/build script, also download the vendor files:
   ```bash
   mkdir -p vendor && \
   curl -L https://cdnjs.cloudflare.com/ajax/libs/fabric.js/5.3.1/fabric.min.js -o vendor/fabric.min.js && \
   curl -L https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js  -o vendor/jspdf.umd.min.js
   ```

> **Tip:** Add the `vendor/` JS downloads as part of your Render build command so they are always present.

---

## Keyboard Shortcuts

| Key | Action |
|---|---|
| `V` | Select / Move tool |
| `H` | Pan tool |
| `T` | Add text box |
| `L` | Lasso selection |
| `+` / `=` | Zoom in |
| `-` | Zoom out |
| `0` | Reset zoom |
| `Delete` / `Backspace` | Delete selected object |

---

## API Reference

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/upload` | Upload an image; returns `image_id` |
| POST | `/api/ocr` | Run OCR + translate; returns `regions[]` |
| POST | `/api/clean` | Inpaint regions; returns cleaned image |
| POST | `/api/export` | Save canvas PNG to `./exports/` |
| POST | `/api/telegram` | Forward pages to Telegram via Bot API |

---

## Credits

- [PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR) — OCR engine  
- [deep-translator](https://github.com/nidhaloff/deep-translator) — Translation  
- [Fabric.js](http://fabricjs.com/) — Canvas editing  
- [jsPDF](https://github.com/parallax/jsPDF) — PDF generation  
- [FastAPI](https://fastapi.tiangolo.com/) — Backend framework  
