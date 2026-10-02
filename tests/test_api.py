import io
from fastapi.testclient import TestClient
from PIL import Image
from app import app

client = TestClient(app)

def test_health():
    r = client.get("/api/health")
    assert r.status_code == 200 and r.json()["status"] == "ok"

def test_home_page():
    assert client.get("/").status_code == 200

def test_predict_image():
    buf = io.BytesIO()
    Image.new("RGB", (224, 224), (120, 90, 60)).save(buf, "PNG")
    r = client.post("/api/predict-image", files={"file": ("t.png", buf.getvalue(), "image/png")})
    assert r.status_code == 200

def test_metrics():
    client.get("/api/health")
    assert b"http_requests_total" in client.get("/metrics").content
