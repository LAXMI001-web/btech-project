"""
FA3-CLIP Deepfake Detector — backend
Run with:  uvicorn app:app --reload --port 8000
"""
import base64
import time
from urllib.parse import urlparse

import requests
from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from model.inference import DATASET_NAMES, get_detector

app = FastAPI(title="FA3-CLIP Deepfake Detector")
app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

MAX_UPLOAD_BYTES = 12 * 1024 * 1024  # 12 MB
ALLOWED_CONTENT_TYPES = {"image/jpeg", "image/png", "image/webp"}


@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})


@app.get("/api/model-info")
async def model_info():
    d = get_detector()
    fusion_beta = None
    if d.using_real_model:
        fusion_beta = float(d.torch.sigmoid(d.model.fusion_logit).item())
    return {
        "architecture": "FA3-CLIP (CLIP ViT-B/32 + FFT high-frequency branch + spatial/frequency fusion + live/fake prompt learning)",
        "using_real_model": d.using_real_model,
        "checkpoint_dir": d.checkpoint_dir,
        "device": d.device,
        "param_count": d.param_count,
        "fusion_beta": round(fusion_beta, 4) if fusion_beta is not None else None,
        "datasets": DATASET_NAMES,
        "input_size": 224,
        "notes": (
            f"Serving predictions from the loaded FA3-CLIP checkpoint on {d.device}."
            if d.using_real_model
            else "Running in DEMO MODE with a placeholder heuristic — no checkpoint loaded."
        ),
    }


def _validate_upload(content_type: str, data: bytes):
    if len(data) == 0:
        raise HTTPException(400, "Empty file.")
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(400, "File too large (12MB max).")
    if content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(400, f"Unsupported file type: {content_type}")


@app.post("/api/predict-image")
async def predict_image(file: UploadFile = File(...)):
    data = await file.read()
    _validate_upload(file.content_type, data)
    detector = get_detector()
    try:
        result = detector.predict(data, detect_faces=True)
    except Exception as exc:
        raise HTTPException(500, f"Inference failed: {exc}")
    result["filename"] = file.filename
    return JSONResponse(result)


@app.post("/api/predict-batch")
async def predict_batch(files: list[UploadFile] = File(...)):
    if len(files) > 20:
        raise HTTPException(400, "Max 20 files per batch.")
    detector = get_detector()
    results = []
    for file in files:
        data = await file.read()
        try:
            _validate_upload(file.content_type, data)
            item = detector.predict(data, detect_faces=False)
            item["filename"] = file.filename
            item["error"] = None
        except HTTPException as exc:
            item = {"filename": file.filename, "error": exc.detail}
        results.append(item)
    return JSONResponse({"results": results})


@app.post("/api/predict-url")
async def predict_url(request: Request):
    """Fetch a remote image by URL and analyze it."""
    body = await request.json()
    url = (body.get("url") or "").strip()
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise HTTPException(400, "Provide a valid http(s) image URL.")
    try:
        resp = requests.get(url, timeout=8, stream=True, headers={"User-Agent": "FA3-CLIP-Detector/1.0"})
        resp.raise_for_status()
        content_type = resp.headers.get("content-type", "").split(";")[0].strip()
        data = resp.content
    except requests.RequestException as exc:
        raise HTTPException(400, f"Could not fetch URL: {exc}")
    _validate_upload(content_type or "image/jpeg", data)
    detector = get_detector()
    result = detector.predict(data, detect_faces=True)
    result["filename"] = url.split("/")[-1] or url
    return JSONResponse(result)


@app.post("/api/predict-frame")
async def predict_frame(request: Request):
    """Used by the live webcam loop. Accepts {"image": "data:image/jpeg;base64,..."}."""
    body = await request.json()
    data_url = body.get("image", "")
    if "," in data_url:
        data_url = data_url.split(",", 1)[1]
    try:
        raw = base64.b64decode(data_url)
    except Exception:
        raise HTTPException(400, "Invalid base64 image payload.")
    if len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(400, "Frame too large.")
    detector = get_detector()
    t0 = time.time()
    result = detector.predict(raw, detect_faces=False)
    result["round_trip_ms"] = round((time.time() - t0) * 1000, 1)
    return JSONResponse(result)


@app.get("/api/health")
async def health():
    d = get_detector()
    return {"status": "ok", "using_real_model": d.using_real_model, "device": d.device}
