"""Prometheus metrics for the FA3-CLIP service (added for DevOps CA-II).
Usage in app.py:  from metrics import install_metrics ; install_metrics(app)"""
import time
from fastapi import FastAPI, Request, Response
from prometheus_client import Counter, Histogram, generate_latest, CONTENT_TYPE_LATEST

REQUESTS = Counter("http_requests_total", "Total HTTP requests", ["method", "path", "status"])
LATENCY = Histogram("http_request_duration_seconds", "Request latency in seconds", ["path"])

def install_metrics(app: FastAPI) -> None:
    @app.middleware("http")
    async def _metrics_middleware(request: Request, call_next):
        start, status = time.time(), 500
        try:
            response = await call_next(request)
            status = response.status_code
            return response
        finally:
            path = request.url.path
            if not path.startswith("/static"):
                LATENCY.labels(path).observe(time.time() - start)
                REQUESTS.labels(request.method, path, str(status)).inc()

    @app.get("/metrics", include_in_schema=False)
    def _metrics():
        return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)

    @app.get("/api/error-test", include_in_schema=False)
    def _error_test():
        """Hit this to generate 5xx errors for the Grafana error-rate panel."""
        return Response(status_code=500, content="simulated failure")
