# MangaType Studio — FastAPI Backend
# File: backend_main.py
# Run: uvicorn backend_main:app --reload --host 0.0.0.0 --port 8000
#
# Required packages:
#   pip install fastapi uvicorn python-multipart pillow opencv-python-headless
#               paddleocr paddlepaddle deep-translator requests

import os
os.environ["PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK"] = "True"

import io
import uuid
import json
import base64
import requests
from pathlib import Path
from typing import List, Optional

import cv2
import numpy as np
from PIL import Image

from fastapi import FastAPI, File, Form, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse
from pydantic import BaseModel

from paddleocr import PaddleOCR
from deep_translator import GoogleTranslator

# ── In-memory page store (use Redis/DB in production) ──────────────────────
PAGE_STORE: dict[str, np.ndarray] = {}
UPLOAD_DIR = Path("./uploads")
UPLOAD_DIR.mkdir(exist_ok=True)

app = FastAPI(title="MangaType Studio API", version="2.0.0")

# Allow all origins during development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Initialise OCR engine once at startup ──────────────────────────────────
# lang="ch" covers Chinese + Japanese (shares kanji characters).
# For pure Japanese, use lang="japan".
# The engine downloads ~500MB of model files on first run.
print("[OCR] Initialising PaddleOCR engine (v2 API)…")
# PaddleOCR API: use_textline_orientation, lang are supported.
ocr_engine = PaddleOCR(use_textline_orientation=True, lang="japan")
print("[OCR] Engine ready ✓")


# ════════════════════════════════════════════════
#  PYDANTIC MODELS
# ════════════════════════════════════════════════

class Region(BaseModel):
    x: float
    y: float
    w: float
    h: float


class OCRRequest(BaseModel):
    page_id: str
    region: Optional[Region] = None


class TranslateRequest(BaseModel):
    text: str
    source_lang: str = "auto"
    target_lang: str = "en"


class ExportRequest(BaseModel):
    image_base64: str
    filename: Optional[str] = None


class TelegramRequest(BaseModel):
    bot_token: str
    channel_id: str
    images: List[str]   # base64 data URLs
    caption: str = ""


# ════════════════════════════════════════════════
#  HELPERS
# ════════════════════════════════════════════════

def _decode_upload(contents: bytes) -> np.ndarray:
    """Decode raw image bytes → BGR ndarray. Raises HTTP 400 on failure."""
    nparr = np.frombuffer(contents, np.uint8)
    img   = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if img is None:
        raise HTTPException(status_code=400, detail="Cannot decode image — unsupported format or corrupted file.")
    return img


def _get_page(page_id: str) -> np.ndarray:
    if page_id not in PAGE_STORE:
        raise HTTPException(status_code=404, detail=f"Page '{page_id}' not found in session store.")
    return PAGE_STORE[page_id]


def _ndarray_to_pil(arr: np.ndarray) -> Image.Image:
    return Image.fromarray(cv2.cvtColor(arr, cv2.COLOR_BGR2RGB))


def _pil_to_bytes(img: Image.Image, fmt: str = "PNG") -> bytes:
    buf = io.BytesIO()
    img.save(buf, format=fmt)
    return buf.getvalue()


def _run_paddle_ocr(img_bgr: np.ndarray) -> list[dict]:
    """
    Run PaddleOCR on a BGR image.
    Returns list of { text, confidence, bbox: {x, y, w, h} }.
    """
    rgb     = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)
    results = ocr_engine.ocr(rgb, cls=True)

    output = []
    for line in (results[0] or []):
        quad, (text, confidence) = line
        # quad = [[x1,y1],[x2,y2],[x3,y3],[x4,y4]]
        xs = [p[0] for p in quad]
        ys = [p[1] for p in quad]
        output.append({
            "text":       text.strip(),
            "confidence": round(float(confidence), 3),
            "bbox": {
                "x": round(min(xs), 1),
                "y": round(min(ys), 1),
                "w": round(max(xs) - min(xs), 1),
                "h": round(max(ys) - min(ys), 1),
            },
        })
    return output


def _translate_text(text: str, target_lang: str) -> str:
    """Translate a single string using GoogleTranslator. Returns original on failure."""
    if not text.strip():
        return text
    try:
        return GoogleTranslator(source="auto", target=target_lang.lower()).translate(text)
    except Exception as exc:
        print(f"[Translate] Warning: '{text[:30]}' → {exc}")
        return text   # fall back to original rather than crashing


# ════════════════════════════════════════════════
#  ENDPOINTS
# ════════════════════════════════════════════════

# ── Health check ─────────────────────────────────────────────────────────
@app.get("/api/health")
def health():
    return {"status": "ok", "engine": "PaddleOCR", "version": "2.0.0"}


# ── 1. Upload Page ────────────────────────────────────────────────────────
@app.post("/api/upload")
async def upload_page(file: UploadFile = File(...)):
    """
    Accept a raw manga page image.
    Returns { page_id, url }.
    """
    contents = await file.read()
    img_bgr  = _decode_upload(contents)

    page_id  = str(uuid.uuid4())
    PAGE_STORE[page_id] = img_bgr

    # Persist to disk
    out_path = UPLOAD_DIR / f"{page_id}.png"
    cv2.imwrite(str(out_path), img_bgr)

    return {"page_id": page_id, "url": f"/api/pages/{page_id}"}


# ── 2. Serve stored page ──────────────────────────────────────────────────
@app.get("/api/pages/{page_id}")
def get_page_image(page_id: str):
    img = _get_page(page_id)
    pil = _ndarray_to_pil(img)
    return StreamingResponse(io.BytesIO(_pil_to_bytes(pil)), media_type="image/png")


# ── 3. Main OCR endpoint (image + target_lang via FormData) ───────────────
@app.post("/api/ocr")
async def ocr_page(
    file: UploadFile = File(..., description="The manga page image to OCR"),
    target_lang: str = Form("en", description="Target translation language, e.g. 'uz', 'en', 'ru'"),
):
    """
    PRIMARY OCR ENDPOINT — used directly by the frontend.

    Accepts:
        file        — image file (PNG / JPEG / WebP)
        target_lang — BCP-47 language code for translation output

    Returns JSON array:
    [
      {
        "text":        "原文",
        "confidence":  0.987,
        "translated":  "Original text in target language",
        "bbox":        { "x": 10, "y": 20, "w": 120, "h": 40 }
      },
      …
    ]
    """
    contents = await file.read()
    if not contents:
        raise HTTPException(status_code=400, detail="Empty file received.")

    img_bgr = _decode_upload(contents)

    # Run OCR
    ocr_results = _run_paddle_ocr(img_bgr)

    if not ocr_results:
        return []   # No text detected — return empty array, not an error

    # Batch-translate all detected texts in one pass
    # (Translate each one individually since GoogleTranslator handles one string at a time)
    print(f"[OCR] Detected {len(ocr_results)} regions. Translating to '{target_lang}'…")
    for item in ocr_results:
        item["translated"] = _translate_text(item["text"], target_lang)

    print(f"[OCR] Done. Returning {len(ocr_results)} results.")
    return ocr_results


# ── 4. Full-page OCR by page_id (legacy JSON endpoint) ────────────────────
@app.post("/api/ocr/full")
def ocr_full_page(req: OCRRequest):
    """
    OCR using a previously uploaded page_id.
    Returns list of { text, confidence, bbox }.
    """
    img     = _get_page(req.page_id)
    results = _run_paddle_ocr(img)
    return results


# ── 5. Region OCR ────────────────────────────────────────────────────────
@app.post("/api/ocr/region")
def ocr_region(req: OCRRequest):
    """OCR on a sub-region of a previously uploaded page."""
    img = _get_page(req.page_id)
    if req.region:
        r  = req.region
        x, y, w, h = int(r.x), int(r.y), int(r.w), int(r.h)
        img = img[y:y+h, x:x+w]
    return _run_paddle_ocr(img)


# ── 6. Clean / Inpaint Bubble ─────────────────────────────────────────────
@app.post("/api/clean")
async def clean_bubble(page_id: str = Form(...), region: str = Form(...)):
    """
    Erase text from a speech bubble using cv2 inpainting (Telea method).
    `region` is a JSON string: { "x": …, "y": …, "w": …, "h": … }
    Returns the modified page image as PNG.
    """
    r   = Region(**json.loads(region))
    img = _get_page(page_id).copy()

    x, y, w, h = int(r.x), int(r.y), int(r.w), int(r.h)
    crop        = img[y:y+h, x:x+w]

    # Build mask — detect dark ink on lighter bubble background
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    _, mask = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)

    # Dilate to cover anti-aliasing fringe
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    mask   = cv2.dilate(mask, kernel, iterations=2)

    inpainted        = cv2.inpaint(crop, mask, inpaintRadius=4, flags=cv2.INPAINT_TELEA)
    img[y:y+h, x:x+w] = inpainted
    PAGE_STORE[page_id] = img

    pil = _ndarray_to_pil(img)
    return StreamingResponse(io.BytesIO(_pil_to_bytes(pil)), media_type="image/png")


# ── 7. Translate ──────────────────────────────────────────────────────────
@app.post("/api/translate")
def translate_text(req: TranslateRequest):
    """Single-text translation via GoogleTranslator (deep-translator)."""
    translated = _translate_text(req.text, req.target_lang)
    return {"translated_text": translated}


# ── 8. Direct Local Export ────────────────────────────────────────────────
@app.post("/api/export")
async def export_page_local(req: ExportRequest):
    """
    Saves a base64 image directly to the local machine at /home/mohinur/tarjima mangalar/
    """
    export_dir = Path("/home/mohinur/tarjima mangalar/")
    export_dir.mkdir(parents=True, exist_ok=True)
    
    name = req.filename if req.filename else f"manga_export_{uuid.uuid4().hex[:8]}.png"
    if not name.lower().endswith(".png"):
        name += ".png"
        
    out_path = export_dir / name
    
    if "," in req.image_base64:
        _, b64data = req.image_base64.split(",", 1)
    else:
        b64data = req.image_base64
        
    img_bytes = base64.b64decode(b64data)
    out_path.write_bytes(img_bytes)
    
    return {"status": "ok", "path": str(out_path)}


# ── 9. Publish to Telegram ────────────────────────────────────────────────
@app.post("/api/telegram")
async def publish_telegram(req: TelegramRequest):
    """
    Send compiled pages to a Telegram channel via Bot API.
    Images arrive as base64 data-URLs.
    """
    TG_BASE = f"https://api.telegram.org/bot{req.bot_token}"
    errors  = []

    for i, data_url in enumerate(req.images):
        try:
            _, b64data = data_url.split(",", 1)
            img_bytes  = base64.b64decode(b64data)
            caption    = req.caption if i == 0 else f"Page {i + 1}"

            r = requests.post(
                f"{TG_BASE}/sendPhoto",
                data={"chat_id": req.channel_id, "caption": caption},
                files={"photo": (f"page{i+1}.png", img_bytes, "image/png")},
                timeout=30,
            )
            r.raise_for_status()
        except Exception as exc:
            errors.append(f"Page {i + 1}: {exc}")

    if errors:
        raise HTTPException(status_code=500, detail="; ".join(errors))

    return {"status": "ok", "pages_sent": len(req.images)}
if __name__ == "__main__":
    import uvicorn
    print("🚀 Manga Translator serveri ishga tushdi! http://localhost:8000 manziliga kiring.")
    uvicorn.run(app, host="0.0.0.0", port=8000)


# ════════════════════════════════════════════════
#  RUN (dev)
#  uvicorn backend_main:app --reload --host 0.0.0.0 --port 8000
# ════════════════════════════════════════════════

