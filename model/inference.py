"""
FA3-CLIP inference wrapper.
=============================================================================
Loads the real checkpoint from checkpoints/fa3_artifact_faces/ (fa3_model.pt
+ fa3_config.json + the CLIPProcessor files) using model/fa3_model.py, which
is your exact training-time architecture. If that folder isn't present (or
torch/transformers aren't installed), the app falls back to DEMO MODE: a
transparent, deterministic frequency/noise heuristic so every screen still
works end-to-end. The UI always shows which mode is active.
=============================================================================
"""

from __future__ import annotations

import base64
import hashlib
import io
import os
import time
from dataclasses import dataclass, field
from typing import Optional

import numpy as np
from PIL import Image, ExifTags
import cv2

CHECKPOINT_DIR = os.environ.get("FA3_CHECKPOINT_DIR", "checkpoints/fa3_artifact_faces")
INPUT_SIZE = 224

# Edit with your three actual dataset names for the Model / About tabs.
DATASET_NAMES = [
    "Dataset A (edit in model/inference.py)",
    "Dataset B (edit in model/inference.py)",
    "Dataset C (edit in model/inference.py)",
]

_FACE_CASCADE_PATH = cv2.data.haarcascades + "haarcascade_frontalface_default.xml"


@dataclass
class Prediction:
    label: str
    fake_probability: float
    real_probability: float
    inference_ms: float
    using_real_model: bool
    freq_spectrum: list = field(default_factory=list)
    heatmap_png_base64: Optional[str] = None
    faces: list = field(default_factory=list)
    exif: dict = field(default_factory=dict)
    fusion_beta: Optional[float] = None
    device: Optional[str] = None
    logits: Optional[list] = None


def _extract_exif(pil_image: Image.Image) -> dict:
    try:
        raw = pil_image.getexif()
        if not raw:
            return {}
        tag_map = {ExifTags.TAGS.get(k, str(k)): v for k, v in raw.items()}
        keep = {}
        for k in ("Make", "Model", "Software", "DateTime", "ImageWidth", "ImageLength", "Orientation"):
            if k in tag_map:
                keep[k] = str(tag_map[k])
        return keep
    except Exception:
        return {}


def _detect_faces(bgr: np.ndarray) -> list:
    try:
        cascade = cv2.CascadeClassifier(_FACE_CASCADE_PATH)
        gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
        boxes = cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=5, minSize=(48, 48))
        return [[int(x), int(y), int(w), int(h)] for (x, y, w, h) in boxes]
    except Exception:
        return []


class FA3ClipDetector:
    def __init__(self, checkpoint_dir: str = CHECKPOINT_DIR):
        self.checkpoint_dir = checkpoint_dir
        self.using_real_model = False
        self.model = None
        self.processor = None
        self.torch = None
        self.device = "cpu"
        self.param_count = None
        self._try_load()

    def _try_load(self) -> None:
        if not os.path.isdir(self.checkpoint_dir):
            print(
                f"[FA3-CLIP] No checkpoint folder at {self.checkpoint_dir}. Running in DEMO MODE. "
                "Copy your fa3_artifact_faces/ folder there (or set FA3_CHECKPOINT_DIR) to load the real model."
            )
            return
        try:
            import torch
            from .fa3_model import load_model

            model, processor = load_model(self.checkpoint_dir)
            self.device = "cuda" if torch.cuda.is_available() else "cpu"
            model = model.to(self.device)
            model.eval()

            self.torch = torch
            self.model = model
            self.processor = processor
            self.param_count = sum(p.numel() for p in model.parameters())
            self.using_real_model = True
            print(f"[FA3-CLIP] Loaded real checkpoint from {self.checkpoint_dir} on {self.device} "
                  f"({self.param_count:,} params)")
        except ModuleNotFoundError as exc:
            print(f"[FA3-CLIP] {exc}. Install torch/transformers (see requirements.txt) to use the real "
                  "model. Running in DEMO MODE.")
        except Exception as exc:  # pragma: no cover
            print(f"[FA3-CLIP] Failed to load checkpoint: {exc}. Running in DEMO MODE.")

    # ------------------------------------------------------------------
    # REAL MODEL PATH
    # ------------------------------------------------------------------
    def _fft_heatmap(self, pixel_values) -> str:
        from .fa3_model import FA3CLIPForImageClassification
        with self.torch.no_grad():
            hp = FA3CLIPForImageClassification._high_pass_map(pixel_values)[0]
        mag = hp.abs().mean(dim=0).cpu().numpy()
        mag = (mag - mag.min()) / (mag.ptp() + 1e-6)
        return self._colorize(mag)

    @staticmethod
    def _colorize(mag_0_1: np.ndarray) -> str:
        heat = cv2.resize(mag_0_1, (INPUT_SIZE, INPUT_SIZE), interpolation=cv2.INTER_CUBIC)
        heat_color = cv2.applyColorMap((np.clip(heat, 0, 1) * 255).astype(np.uint8), cv2.COLORMAP_TURBO)
        ok, buf = cv2.imencode(".png", heat_color)
        return base64.b64encode(buf.tobytes()).decode("ascii") if ok else ""

    def _predict_real(self, pil_image: Image.Image) -> Prediction:
        t0 = time.time()
        rgb = pil_image.convert("RGB")
        inputs = self.processor(images=rgb, return_tensors="pt")
        inputs = {k: v.to(self.device) for k, v in inputs.items()}

        with self.torch.no_grad():
            outputs = self.model(**inputs)
            logits = outputs.logits[0]
            probs = self.torch.softmax(logits, dim=-1).cpu().numpy()

        fake_prob = float(probs[self.model.config.label2id["fake"]])
        real_prob = float(probs[self.model.config.label2id["real"]])
        label = "FAKE" if fake_prob >= real_prob else "REAL"
        beta = float(self.torch.sigmoid(self.model.fusion_logit).item())

        heatmap_b64 = self._fft_heatmap(inputs["pixel_values"])

        with self.torch.no_grad():
            from .fa3_model import FA3CLIPForImageClassification
            hp = FA3CLIPForImageClassification._high_pass_map(inputs["pixel_values"])[0]
            row_profile = hp.abs().mean(dim=0).mean(dim=1).cpu().numpy()
        row_profile = (row_profile - row_profile.min()) / (row_profile.ptp() + 1e-6)
        buckets = np.array_split(row_profile, 40)
        spectrum = [float(np.clip(b.mean(), 0, 1)) for b in buckets]

        return Prediction(
            label=label,
            fake_probability=round(fake_prob, 4),
            real_probability=round(real_prob, 4),
            inference_ms=round((time.time() - t0) * 1000, 1),
            using_real_model=True,
            freq_spectrum=spectrum,
            heatmap_png_base64=heatmap_b64,
            exif=_extract_exif(pil_image),
            fusion_beta=round(beta, 4),
            device=self.device,
            logits=[round(float(x), 4) for x in logits.cpu().numpy().tolist()],
        )

    # ------------------------------------------------------------------
    # DEMO-MODE HEURISTIC (real signal processing, not a trained model)
    # ------------------------------------------------------------------
    @staticmethod
    def _dct_energy_map(gray: np.ndarray) -> np.ndarray:
        h, w = gray.shape
        block = 8
        h2, w2 = (h // block) * block, (w // block) * block
        gray = gray[:h2, :w2].astype(np.float32)
        energy = np.zeros((h2 // block, w2 // block), dtype=np.float32)
        for by in range(0, h2, block):
            for bx in range(0, w2, block):
                patch = gray[by:by + block, bx:bx + block]
                d = cv2.dct(patch)
                mask = np.ones_like(d)
                mask[:2, :2] = 0
                energy[by // block, bx // block] = np.sum(np.abs(d * mask))
        return energy

    def _predict_demo(self, pil_image: Image.Image) -> Prediction:
        t0 = time.time()
        img = pil_image.convert("RGB").resize((INPUT_SIZE, INPUT_SIZE))
        arr = np.array(img)
        gray = cv2.cvtColor(arr, cv2.COLOR_RGB2GRAY)

        energy = self._dct_energy_map(gray)
        energy_norm = (energy - energy.min()) / (energy.ptp() + 1e-6)

        noise = cv2.Laplacian(gray, cv2.CV_64F)
        noise_var = float(np.var(noise))
        energy_var = float(np.var(energy_norm))
        seed = int(hashlib.sha256(arr.tobytes()).hexdigest(), 16) % (10 ** 6)
        rng = np.random.default_rng(seed)
        jitter = rng.uniform(-0.05, 0.05)

        raw = 0.5 + jitter + (energy_var - 0.05) * 3.0 + (noise_var / 20000.0 - 0.15)
        fake_prob = float(np.clip(raw, 0.02, 0.98))
        real_prob = 1.0 - fake_prob
        label = "FAKE" if fake_prob >= 0.5 else "REAL"

        row_profile = energy_norm.mean(axis=1)
        buckets = np.array_split(row_profile, min(40, len(row_profile)) or 1)
        spectrum = [float(np.clip(b.mean(), 0, 1)) for b in buckets]
        while len(spectrum) < 40:
            spectrum.append(spectrum[-1] if spectrum else 0.0)

        return Prediction(
            label=label,
            fake_probability=round(fake_prob, 4),
            real_probability=round(real_prob, 4),
            inference_ms=round((time.time() - t0) * 1000, 1),
            using_real_model=False,
            freq_spectrum=spectrum[:40],
            heatmap_png_base64=self._colorize(cv2.resize(energy_norm, (INPUT_SIZE, INPUT_SIZE))),
            exif=_extract_exif(pil_image),
        )

    # ------------------------------------------------------------------
    def predict(self, image_bytes: bytes, detect_faces: bool = False) -> dict:
        pil_image = Image.open(io.BytesIO(image_bytes))
        pred = self._predict_real(pil_image) if self.using_real_model else self._predict_demo(pil_image)
        result = pred.__dict__.copy()
        del result["faces"]  # only present in the response when detect_faces=True below

        if detect_faces:
            bgr = cv2.cvtColor(np.array(pil_image.convert("RGB")), cv2.COLOR_RGB2BGR)
            boxes = _detect_faces(bgr)
            faces = []
            for (x, y, w, h) in boxes:
                pad = int(0.15 * max(w, h))
                x0, y0 = max(0, x - pad), max(0, y - pad)
                x1, y1 = min(bgr.shape[1], x + w + pad), min(bgr.shape[0], y + h + pad)
                crop = pil_image.convert("RGB").crop((x0, y0, x1, y1))
                face_pred = self._predict_real(crop) if self.using_real_model else self._predict_demo(crop)
                faces.append({
                    "bbox": [int(x0), int(y0), int(x1 - x0), int(y1 - y0)],
                    "label": face_pred.label,
                    "fake_probability": face_pred.fake_probability,
                    "real_probability": face_pred.real_probability,
                })
            result["faces"] = faces
        return result


_detector: Optional[FA3ClipDetector] = None


def get_detector() -> FA3ClipDetector:
    global _detector
    if _detector is None:
        _detector = FA3ClipDetector()
    return _detector
