FROM python:3.11-slim
ARG APP_VERSION=1.0.0
ENV APP_VERSION=${APP_VERSION} PYTHONUNBUFFERED=1
RUN apt-get update && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 && rm -rf /var/lib/apt/lists/*
WORKDIR /srv
COPY requirements-ci.txt .
RUN pip install --no-cache-dir -r requirements-ci.txt
COPY app.py metrics.py ./
COPY model ./model
COPY static ./static
COPY templates ./templates
EXPOSE 8000
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
