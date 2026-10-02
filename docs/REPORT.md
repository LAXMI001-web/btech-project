# DevOps CA-II Report - FA3-CLIP Deepfake Detector

## 1. Architecture
BTech final-year project: a FastAPI web app serving an FA3-CLIP deepfake image detector (single, batch, URL and live-frame prediction). GitHub Actions tests and builds a Docker image, Kubernetes runs 3 replicas behind a NodePort service, Ansible prepares the host runtime, and Prometheus + Grafana monitor the app via a /metrics endpoint. See architecture_diagram.png.

## 2. Pipeline flow
Push/PR -> checkout -> pytest (4 API tests) -> docker build -> push to GHCR -> validate and apply Kubernetes manifests. See pipeline_diagram.png.

## 3. Tools
GitHub Actions, Ansible, Docker, Kubernetes (RollingUpdate + rollback), Prometheus, Grafana.

## 4. Challenges
- The trained checkpoint (~580 MB) cannot go into git or the image, so containers run in demo mode and the real checkpoint is mounted as a volume.
- torch is very large, so a lightweight requirements-ci.txt keeps CI and Docker builds fast.
- The model needs time to start, so readiness/liveness probes use initial delays.
- Local images had to be loaded into minikube (imagePullPolicy: IfNotPresent).
- GHCR push needed workflow write permissions.

## 5. Lessons learned
- Separate heavy model artifacts from the code and image.
- Rolling updates + rollback give zero-downtime releases.
- Latency percentiles and error rate expose problems early.
- Config as code (YAML, playbooks, dashboard JSON) makes the setup reproducible.
