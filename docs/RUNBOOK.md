# RUNBOOK - FA3-CLIP Deepfake Detector (commands + screenshots)
Run on Ubuntu / WSL2 with Docker. Port 8000, health endpoint /api/health, metrics /metrics.
The Docker image uses requirements-ci.txt (no torch) so it builds fast and runs in DEMO MODE. This is fine for the DevOps demo.

## Step 0 - Local check
    pip install -r requirements-ci.txt
    pytest -v                          # SCREENSHOT: 4 passed
    uvicorn app:app --port 8000        # http://localhost:8000 and http://localhost:8000/metrics

## Step 1 - GitHub Actions
Push to GitHub -> Actions tab. SCREENSHOT: test, build-and-push, deploy all green.
If build-and-push fails: Settings -> Actions -> General -> Workflow permissions -> Read and write.
Submit: .github/workflows/ci-cd.yml + docs/pipeline_diagram.png

## Step 2 - Ansible
    sudo apt update && sudo apt install -y ansible
    cd ansible
    ansible-playbook -i inventory.ini playbook.yml --ask-become-pass   # SCREENSHOT: failed=0
    ansible-playbook -i inventory.ini playbook.yml --ask-become-pass   # 2nd run changed=0 (SCREENSHOT)
    id fa3-clip-detector ; ls -l /opt/fa3-clip-detector                # SCREENSHOT

## Step 3 - Docker + Kubernetes
    docker build -t fa3-clip-detector:1.0.0 --build-arg APP_VERSION=1.0.0 .
    docker build -t fa3-clip-detector:2.0.0 --build-arg APP_VERSION=2.0.0 .
    minikube start
    minikube image load fa3-clip-detector:1.0.0
    minikube image load fa3-clip-detector:2.0.0
    kubectl apply -f k8s/
    kubectl get pods,svc                                    # SCREENSHOT
    minikube service fa3-clip-detector-svc --url            # open in browser -> app UI (SCREENSHOT)

Rolling update:
    kubectl set image deployment/fa3-clip-detector fa3-clip-detector=fa3-clip-detector:2.0.0
    kubectl rollout status deployment/fa3-clip-detector     # SCREENSHOT
    kubectl rollout history deployment/fa3-clip-detector
Rollback:
    kubectl rollout undo deployment/fa3-clip-detector
    kubectl rollout status deployment/fa3-clip-detector     # SCREENSHOT
(kind: `kind load docker-image <image>` and `kubectl port-forward svc/fa3-clip-detector-svc 8080:80`)

## Step 4 - Prometheus + Grafana
    cd monitoring
    docker compose up -d --build
    # traffic (use the app UI too: upload a few images):
    for i in $(seq 1 100); do curl -s localhost:8000/api/health > /dev/null; done
    for i in $(seq 1 20);  do curl -s localhost:8000/api/error-test > /dev/null; done
- http://localhost:9090/targets -> fa3-clip-detector UP        # SCREENSHOT
- http://localhost:3000 (admin/admin) -> Dashboards -> "FA3-CLIP Detector Dashboard"   # SCREENSHOT (uptime, latency, error rate)

## Step 5 - Report
docs/DevOps_CA2_Reflection.pptx + docs/REPORT.md. Add your screenshots to screenshots/.

## Step 6 - Bonus
Register on a DevOps challenge (e.g. Devpost "Life After Code"), screenshot to step6-bonus/.

## Submit
    git add . && git commit -m "DevOps CA2: CI/CD, Ansible, Docker/K8s, monitoring" && git push origin main
Then push/copy the same folders to the course repo: https://github.com/aditisharmas11/DevOps-CA2_2023_27
