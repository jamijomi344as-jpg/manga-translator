import os
os.environ["PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK"] = "True"

import uuid
import base64
import logging
import requests as http_requests
from pathlib import Path
from io import BytesIO
from typing import Optional

import cv2
import numpy as np
from PIL import Image

from fastapi import FastAPI, UploadFile, File, HTTPException, Form
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from paddleocr import PaddleOCR
from deep_translator import GoogleTranslator

# ──────────────────────────────────────────────
# Logging
# ──────────────────────────────────────────────
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("manga_translator")

# ──────────────────────────────────────────────
# App & CORS
# ──────────────────────────────────────────────
app = FastAPI(title="MangaType Studio API", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ──────────────────────────────────────────────
# Directories
# ──────────────────────────────────────────────
UPLOAD_DIR = Path("./uploads")
EXPORT_DIR = Path("./exports")
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
EXPORT_DIR.mkdir(parents=True, exist_ok=True)

# ──────────────────────────────────────────────
# OCR Engine (lazy-loaded on first use)
# ──────────────────────────────────────────────
_ocr_engine: Optional[PaddleOCR] = None

def get_ocr_engine() -> PaddleOCR:
    global _ocr_engine
    if _ocr_engine is None:
        logger.info("Initialising PaddleOCR engine …")
        _ocr_engine = PaddleOCR(use_textline_orientation=True, lang="japan")
        logger.info("PaddleOCR ready.")
    return _ocr_engine

# ──────────────────────────────────────────────
# Pydantic models
# ──────────────────────────────────────────────
class OcrRequest(BaseModel):
    image_id: str
    source_lang: str = "ja"
    target_lang: str = "en"

class CleanRequest(BaseModel):
    image_id: str
    regions: list  # list of {x, y, w, h} dicts

class ExportRequest(BaseModel):
    image_id: str
    canvas_data: str   # base64 PNG from Fabric.js
    filename: Optional[str] = None

class TelegramRequest(BaseModel):
    bot_token: str
    chat_id: str
    images: list        # list of base64 PNG strings
    caption: Optional[str] = ""

# ──────────────────────────────────────────────
# Helper utilities
# ──────────────────────────────────────────────
LANG_CODE_MAP = {
    "ja": "japanese",
    "ko": "korean",
    "zh-CN": "chinese (simplified)",
    "zh-TW": "chinese (traditional)",
    "en": "english",
}

def translate_text(text: str, source: str, target: str) -> str:
    try:
        src = "auto" if source == "auto" else source
        translated = GoogleTranslator(source=src, target=target).translate(text)
        return translated or text
    except Exception as exc:
        logger.warning(f"Translation failed: {exc}")
        return text


def decode_base64_image(b64_str: str) -> np.ndarray:
    """Decode a base64 data-URL or raw base64 string to an OpenCV image."""
    if "," in b64_str:
        b64_str = b64_str.split(",", 1)[1]
    img_bytes = base64.b64decode(b64_str)
    nparr = np.frombuffer(img_bytes, np.uint8)
    return cv2.imdecode(nparr, cv2.IMREAD_COLOR)


def encode_image_to_base64(img: np.ndarray) -> str:
    _, buf = cv2.imencode(".png", img)
    return "data:image/png;base64," + base64.b64encode(buf.tobytes()).decode()

# ──────────────────────────────────────────────
# Endpoints
# ──────────────────────────────────────────────

@app.get("/")
async def serve_index():
    return FileResponse("index.html")


@app.post("/api/upload")
async def upload_image(file: UploadFile = File(...)):
    """Accept an image upload, persist it, return a unique image_id."""
    if not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Only image files are accepted.")

    image_id = str(uuid.uuid4())
    suffix = Path(file.filename).suffix or ".png"
    dest = UPLOAD_DIR / f"{image_id}{suffix}"

    content = await file.read()
    dest.write_bytes(content)

    # Also verify we can open it
    try:
        pil_img = Image.open(BytesIO(content))
        width, height = pil_img.size
    except Exception:
        raise HTTPException(status_code=422, detail="Cannot decode uploaded image.")

    logger.info(f"Uploaded: {file.filename} → {dest} ({width}x{height})")
    return JSONResponse({
        "image_id": image_id,
        "filename": file.filename,
        "width": width,
        "height": height,
    })


@app.post("/api/ocr")
async def run_ocr(payload: OcrRequest):
    """Run PaddleOCR on a stored image and return translated text regions."""
    # Find the file
    matches = list(UPLOAD_DIR.glob(f"{payload.image_id}.*"))
    if not matches:
        raise HTTPException(status_code=404, detail="Image not found.")
    img_path = str(matches[0])

    try:
        ocr = get_ocr_engine()
        result = ocr.predict(img_path)
    except Exception as exc:
        logger.error(f"OCR error: {exc}")
        raise HTTPException(status_code=500, detail=f"OCR failed: {exc}")

    regions = []
    try:
        # PaddleOCR 2.x result format: list of page results
        ocr_result = result[0] if result else {}
        rec_texts = ocr_result.get("rec_texts", [])
        rec_scores = ocr_result.get("rec_scores", [])
        rec_polys  = ocr_result.get("rec_polys",  [])

        for idx, (text, score, poly) in enumerate(zip(rec_texts, rec_scores, rec_polys)):
            if not text.strip():
                continue
            translated = translate_text(text, payload.source_lang, payload.target_lang)
            # poly is [[x1,y1],[x2,y2],[x3,y3],[x4,y4]]
            xs = [p[0] for p in poly]
            ys = [p[1] for p in poly]
            regions.append({
                "id": idx,
                "original": text,
                "translated": translated,
                "confidence": round(float(score), 3),
                "bbox": {
                    "x": int(min(xs)),
                    "y": int(min(ys)),
                    "w": int(max(xs) - min(xs)),
                    "h": int(max(ys) - min(ys)),
                },
                "polygon": [[int(p[0]), int(p[1])] for p in poly],
            })
    except Exception as exc:
        logger.error(f"Result parsing error: {exc}")
        raise HTTPException(status_code=500, detail=f"Result parsing failed: {exc}")

    return JSONResponse({"image_id": payload.image_id, "regions": regions})


@app.post("/api/clean")
async def clean_bubbles(payload: CleanRequest):
    """Inpaint selected rectangular regions to erase bubble text."""
    matches = list(UPLOAD_DIR.glob(f"{payload.image_id}.*"))
    if not matches:
        raise HTTPException(status_code=404, detail="Image not found.")

    img = cv2.imread(str(matches[0]))
    if img is None:
        raise HTTPException(status_code=422, detail="Cannot read image.")

    mask = np.zeros(img.shape[:2], dtype=np.uint8)
    for region in payload.regions:
        x, y, w, h = int(region["x"]), int(region["y"]), int(region["w"]), int(region["h"])
        # Add 2px padding
        x1, y1 = max(0, x - 2), max(0, y - 2)
        x2, y2 = min(img.shape[1], x + w + 2), min(img.shape[0], y + h + 2)
        mask[y1:y2, x1:x2] = 255

    cleaned = cv2.inpaint(img, mask, inpaintRadius=7, flags=cv2.INPAINT_TELEA)

    # Overwrite original so downstream exports are clean
    cv2.imwrite(str(matches[0]), cleaned)

    return JSONResponse({"image_id": payload.image_id, "cleaned": encode_image_to_base64(cleaned)})


@app.post("/api/export")
async def export_image(payload: ExportRequest):
    """Save the Fabric.js canvas PNG to the exports directory."""
    try:
        img = decode_base64_image(payload.canvas_data)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Invalid canvas data: {exc}")

    filename = payload.filename or f"export_{payload.image_id}.png"
    # Sanitise filename
    filename = Path(filename).name
    dest = EXPORT_DIR / filename
    cv2.imwrite(str(dest), img)
    logger.info(f"Exported: {dest}")
    return JSONResponse({"path": str(dest), "filename": filename})


@app.post("/api/telegram")
async def send_to_telegram(payload: TelegramRequest):
    """Forward base64-encoded images to a Telegram chat via the Bot API."""
    if not payload.bot_token or not payload.chat_id:
        raise HTTPException(status_code=400, detail="bot_token and chat_id are required.")

    results = []
    api_base = f"https://api.telegram.org/bot{payload.bot_token}"

    for idx, b64img in enumerate(payload.images):
        try:
            img = decode_base64_image(b64img)
            _, buf = cv2.imencode(".png", img)
            img_bytes = BytesIO(buf.tobytes())
            img_bytes.name = f"page_{idx + 1}.png"

            caption = payload.caption if idx == 0 else ""
            resp = http_requests.post(
                f"{api_base}/sendPhoto",
                data={"chat_id": payload.chat_id, "caption": caption},
                files={"photo": (f"page_{idx + 1}.png", img_bytes, "image/png")},
                timeout=30,
            )
            resp_json = resp.json()
            if resp_json.get("ok"):
                results.append({"page": idx + 1, "status": "sent"})
            else:
                results.append({"page": idx + 1, "status": "error", "detail": resp_json.get("description")})
        except Exception as exc:
            results.append({"page": idx + 1, "status": "error", "detail": str(exc)})

    return JSONResponse({"results": results})


# ──────────────────────────────────────────────
# Static file mounts (MUST come after all routes)
# ──────────────────────────────────────────────
if Path("css").exists():
    app.mount("/css",    StaticFiles(directory="css"),    name="css")
if Path("js").exists():
    app.mount("/js",     StaticFiles(directory="js"),     name="js")
if Path("vendor").exists():
    app.mount("/vendor", StaticFiles(directory="vendor"), name="vendor")

# ──────────────────────────────────────────────
# Entry point
# ──────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
