# FA3-CLIP Face Attack Detector

A web app for telling real faces from deepfakes/spoofs, built directly around
your FA3-CLIP model (CLIP ViT-B/32 + FFT high-frequency branch + learned
spatial/frequency fusion + live/fake prompt learning).

## Run it

```bash
cd deepfake-detector
python -m venv .venv
 && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn app:app --reload --port 8000
```


Open **http://localhost:8000**. Camera access for Live Detection requires
`localhost` or HTTPS (a browser security requirement) — both work out of the box.

## Load your trained model

1. Copy your 5 checkpoint files into `checkpoints/fa3_artifact_faces/`:
   `fa3_model.pt`, `fa3_config.json`, `processor_config.json`, `tokenizer.json`, `tokenizer_config.json`
   (this matches the folder from your training run exactly).
2. `pip install -r requirements.txt` already includes `torch` and `transformers` — no extra steps needed.
3. Restart the server. The header pill flips from `DEMO MODE` to `LIVE MODEL`, and the
   Model tab will show your real parameter count, device (CPU/GPU), and the model's
   learned spatial/frequency fusion balance (β).

`fa3_model.pt` is ~580MB — if you deploy this anywhere, use Git LFS or object storage
rather than committing it directly.

To point at a different checkpoint folder without touching code:
```bash
export FA3_CHECKPOINT_DIR=/path/to/another/checkpoint/folder
uvicorn app:app --port 8000

```

`model/fa3_model.py` is your exact training-time architecture, copied in as-is —
don't edit its internals or the checkpoint won't load. `model/inference.py` is the
thin serving wrapper around it (preprocessing, EXIF, face cropping, heatmap
rendering) — that's the file to touch for anything about *how* predictions are
served, not what the model itself does.

## What's included (50 features)

**Analyze**
1. Drag-and-drop image upload
2. Click-to-browse upload
3. Batch upload (up to 20 images at once)
4. Image-by-URL analysis (paste a link, server fetches and analyzes it)
5. Per-image REAL/FAKE evidence card with confidence
6. Adjustable decision threshold (client-side re-labels instantly, no re-inference)
7. FFT high-frequency heatmap — the model's *own* high-pass filter input, visualized
8. Batch summary (real/fake counts, average confidence)
9. Multi-face detection within a single image (OpenCV cascade)
10. Per-face cropping and independent FA3-CLIP prediction per face
11. "No face detected" flag when appropriate
12. EXIF metadata viewer (camera make/model, software, timestamp)
13. Copy result summary to clipboard
14. Retry button on failed uploads/URLs

**Compare**
15. Side-by-side two-image comparison
16. Agreement/disagreement verdict between the two results

**Live detection**
17. Real-time webcam analysis
18. Face bounding-box overlay (browser FaceDetector API where supported)
19. Live confidence meter
20. Rolling fake-probability chart (last 60 frames)
21. FPS / per-frame latency / frame-count stats
22. Adjustable analysis interval (200ms–2000ms slider)
23. Optional audio alert on FAKE
24. Snapshot-to-history capture
25. Keyboard shortcut (Space) to snapshot while live

**Video**
26. Video file upload with adjustable sample rate
27. Client-side frame extraction (no full video ever uploaded)
28. Per-frame results timeline

**History**
29. Session detection log with thumbnails
30. Real vs Fake donut chart
31. Fake-probability distribution chart
32. CSV export
33. JSON export
34. Printable / save-as-PDF session report
35. Clear history
36. History persists across page refresh (sessionStorage)
37. Per-row delete

**Model & About**
38. Model info panel (architecture, checkpoint path, device, parameter count)
39. Live spatial/frequency fusion balance gauge (the model's learned β)
40. Static architecture diagram (spatial branch / frequency branch / fusion / prompts)
41. Advanced mode toggle — raw logits, β, device, EXIF shown inline on every result
42. About panel explaining spatial+frequency fusion and attack-agnostic prompts
43. Backend connectivity badge (polls every 15s, shows device)
44. DEMO MODE / LIVE MODEL status badge, always visible

**Elsewhere**
45. Dark/light theme toggle
46. Toast notifications on fake detections and errors
47. Fully responsive layout (mobile-friendly)
48. Drag-over visual feedback on all dropzones
49. File type/size validation with inline error messages
50. Reactive frequency-spectrum strip across the top of the page, driven by each
    image's real high-frequency energy profile

## Notes on demo mode

If `checkpoints/fa3_artifact_faces/` is empty (or `torch`/`transformers` aren't
installed), `FA3ClipDetector._predict_demo()` computes a real block-wise DCT
high-frequency energy map and Laplacian noise variance from the uploaded
image — not your trained weights, but real signal processing — so every
screen in the app is exercised with real numbers instead of hardcoded values
while you get the checkpoint in place.
