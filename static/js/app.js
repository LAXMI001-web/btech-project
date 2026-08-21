(() => {
  "use strict";

  /* ===================== shared state ===================== */
  const state = {
    threshold: 50,
    history: [],           // {id, thumb, source, label, confidence, time, fakeProb}
    liveRunning: false,
    liveStream: null,
    liveFrameCount: 0,
    liveChart: null,
    liveRollingProbs: [],
    donutChart: null,
    distChart: null,
    usingRealModel: false,
  };
  let historySeq = 0;

  /* ===================== small utils ===================== */
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  function toast(msg, kind = "info", retryFn = null) {
    const el = document.createElement("div");
    el.className = `toast ${kind}`;
    el.textContent = msg;
    if (retryFn) {
      const btn = document.createElement("button");
      btn.textContent = " Retry";
      btn.className = "toast-retry";
      btn.addEventListener("click", () => { el.remove(); retryFn(); });
      el.appendChild(btn);
    }
    $("#toast-container").appendChild(el);
    setTimeout(() => el.remove(), 6000);
  }

  function fmtPct(p) { return `${Math.round(p * 100)}%`; }
  function nowLabel() {
    const d = new Date();
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }

  function labelForProb(fakeProb) {
    return fakeProb * 100 >= state.threshold ? "FAKE" : "REAL";
  }

  /* ===================== tabs ===================== */
  function initTabs() {
    $$(".tab-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        $$(".tab-btn").forEach((b) => b.classList.remove("active"));
        $$(".tab-panel").forEach((p) => p.classList.remove("active"));
        btn.classList.add("active");
        $(`#tab-${btn.dataset.tab}`).classList.add("active");
        if (btn.dataset.tab === "history") renderHistoryCharts();
        if (btn.dataset.tab !== "live" && state.liveRunning) {
          // keep running in background is fine; nothing to stop
        }
      });
    });
  }

  /* ===================== theme ===================== */
  function initTheme() {
    const root = document.documentElement;
    $("#theme-toggle").addEventListener("click", () => {
      const next = root.dataset.theme === "dark" ? "light" : "dark";
      root.dataset.theme = next;
    });
  }

  /* ===================== advanced mode + connectivity ===================== */
  function initAdvancedToggle() {
    $("#advanced-toggle").addEventListener("change", (e) => {
      document.body.classList.toggle("advanced-on", e.target.checked);
    });
  }

  async function pollConnectivity() {
    const badge = $("#conn-badge");
    try {
      const resp = await fetch("/api/health");
      if (!resp.ok) throw new Error();
      const info = await resp.json();
      badge.textContent = `● online (${info.device})`;
      badge.className = "pill pill-online";
    } catch {
      badge.textContent = "● offline";
      badge.className = "pill pill-offline";
    }
  }
  function initConnectivity() {
    pollConnectivity();
    setInterval(pollConnectivity, 15000);
  }

  /* ===================== spectrum strip (signature element) ===================== */
  const SPECTRUM_BARS = 60;
  function initSpectrum() {
    const strip = $("#spectrum-strip");
    for (let i = 0; i < SPECTRUM_BARS; i++) {
      const bar = document.createElement("div");
      bar.className = "bar";
      strip.appendChild(bar);
    }
    idleSpectrum();
  }
  let idleTimer = null;
  function idleSpectrum() {
    clearInterval(idleTimer);
    idleTimer = setInterval(() => {
      $$("#spectrum-strip .bar").forEach((bar) => {
        bar.style.height = `${8 + Math.random() * 22}%`;
      });
    }, 700);
  }
  function driveSpectrum(values, isFake) {
    clearInterval(idleTimer);
    const bars = $$("#spectrum-strip .bar");
    const strip = $("#spectrum-strip");
    strip.classList.toggle("is-fake", !!isFake);
    bars.forEach((bar, i) => {
      const v = values[i % values.length] ?? 0.2;
      bar.style.height = `${8 + v * 85}%`;
    });
    clearTimeout(driveSpectrum._t);
    driveSpectrum._t = setTimeout(idleSpectrum, 6000);
  }

  /* ===================== history ===================== */
  function pushHistory(entry) {
    entry.id = ++historySeq;
    entry.time = nowLabel();
    state.history.unshift(entry);
    renderHistoryTable();
    persistHistory();
  }

  function persistHistory() {
    try { sessionStorage.setItem("fa3clip-history", JSON.stringify(state.history)); } catch { /* storage full/unavailable */ }
  }

  function restoreHistory() {
    try {
      const raw = sessionStorage.getItem("fa3clip-history");
      if (!raw) return;
      state.history = JSON.parse(raw);
      historySeq = Math.max(0, ...state.history.map((h) => h.id || 0));
      renderHistoryTable();
    } catch { /* ignore corrupt storage */ }
  }

  function renderHistoryTable() {
    const body = $("#history-body");
    body.innerHTML = "";
    $("#history-empty").style.display = state.history.length ? "none" : "block";
    for (const h of state.history) {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${h.thumb ? `<img src="${h.thumb}" alt="">` : ""}</td>
        <td>${h.source}</td>
        <td><span class="tag ${h.label.toLowerCase()}">${h.label}</span></td>
        <td>${fmtPct(h.confidence)}</td>
        <td>${h.time}</td>
        <td><button class="icon-btn" data-remove="${h.id}" title="Remove">×</button></td>`;
      body.appendChild(tr);
    }
    $$("[data-remove]").forEach((btn) =>
      btn.addEventListener("click", () => {
        state.history = state.history.filter((h) => h.id != btn.dataset.remove);
        renderHistoryTable();
        renderHistoryCharts();
        persistHistory();
      })
    );
  }

  function renderHistoryCharts() {
    const realCount = state.history.filter((h) => h.label === "REAL").length;
    const fakeCount = state.history.filter((h) => h.label === "FAKE").length;

    const donutCtx = $("#donut-chart");
    if (state.donutChart) state.donutChart.destroy();
    state.donutChart = new Chart(donutCtx, {
      type: "doughnut",
      data: {
        labels: ["Real", "Fake"],
        datasets: [{ data: [realCount, fakeCount], backgroundColor: ["#3DDC97", "#FF5D5D"], borderWidth: 0 }],
      },
      options: {
        plugins: { legend: { labels: { color: "#8992A3" } }, title: { display: true, text: "Real vs Fake (session)", color: "#E7E9EE" } },
      },
    });

    const buckets = [0, 0, 0, 0, 0]; // 0-20,20-40,40-60,60-80,80-100 fake%
    state.history.forEach((h) => {
      const idx = Math.min(4, Math.floor(h.fakeProb * 5));
      buckets[idx]++;
    });
    const distCtx = $("#dist-chart");
    if (state.distChart) state.distChart.destroy();
    state.distChart = new Chart(distCtx, {
      type: "bar",
      data: {
        labels: ["0-20%", "20-40%", "40-60%", "60-80%", "80-100%"],
        datasets: [{ label: "Fake-probability distribution", data: buckets, backgroundColor: "#F5B14C" }],
      },
      options: {
        plugins: { legend: { display: false }, title: { display: true, text: "Fake-probability distribution", color: "#E7E9EE" } },
        scales: {
          x: { ticks: { color: "#8992A3" }, grid: { color: "#242A36" } },
          y: { ticks: { color: "#8992A3", precision: 0 }, grid: { color: "#242A36" } },
        },
      },
    });
  }

  function exportCSV() {
    if (!state.history.length) return toast("Nothing to export yet.");
    const rows = [["source", "label", "confidence", "time"]];
    state.history.forEach((h) => rows.push([h.source, h.label, fmtPct(h.confidence), h.time]));
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    downloadBlob(csv, "fa3clip-history.csv", "text/csv");
  }
  function exportJSON() {
    if (!state.history.length) return toast("Nothing to export yet.");
    downloadBlob(JSON.stringify(state.history, null, 2), "fa3clip-history.json", "application/json");
  }
  function downloadBlob(content, filename, mime) {
    const blob = new Blob([content], { type: mime });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function printReport() {
    if (!state.history.length) return toast("Nothing to report yet.");
    const win = window.open("", "_blank");
    const rows = state.history.map((h) =>
      `<tr><td>${h.source}</td><td>${h.label}</td><td>${fmtPct(h.confidence)}</td><td>${h.time}</td></tr>`
    ).join("");
    win.document.write(`
      <html><head><title>FA3-CLIP Detection Report</title>
      <style>
        body{font-family:sans-serif; padding:24px; color:#111;}
        h1{font-size:1.3rem;} table{width:100%; border-collapse:collapse; margin-top:16px;}
        th,td{border:1px solid #ccc; padding:6px 10px; text-align:left; font-size:0.85rem;}
        th{background:#f2f2f2;}
      </style></head><body>
      <h1>FA3-CLIP Face Attack Detection — Session Report</h1>
      <p>Generated ${new Date().toLocaleString()} · ${state.history.length} item(s) analyzed</p>
      <table><thead><tr><th>Source</th><th>Label</th><th>Confidence</th><th>Time</th></tr></thead>
      <tbody>${rows}</tbody></table>
      </body></html>`);
    win.document.close();
    win.focus();
    win.print();
  }

  function initHistoryControls() {
    $("#export-csv").addEventListener("click", exportCSV);
    $("#export-json").addEventListener("click", exportJSON);
    $("#print-report").addEventListener("click", printReport);
    $("#clear-history").addEventListener("click", () => {
      state.history = [];
      sessionStorage.removeItem("fa3clip-history");
      renderHistoryTable();
      renderHistoryCharts();
      toast("History cleared.");
    });
  }

  /* ===================== analyze tab ===================== */
  function fileToDataURL(file) {
    return new Promise((res) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.readAsDataURL(file);
    });
  }

  function renderEvidenceCard(pred, thumbDataUrl, filename) {
    const label = labelForProb(pred.fake_probability);
    const conf = label === "FAKE" ? pred.fake_probability : pred.real_probability;
    const card = document.createElement("div");
    card.className = "evidence-card";

    const facesHtml = !("faces" in pred) ? "" : (pred.faces.length
      ? `<div class="faces-grid">${pred.faces.map((f, i) =>
          `<span class="face-chip ${f.label.toLowerCase()}">Face ${i + 1}: ${f.label} ${fmtPct(f.label === "FAKE" ? f.fake_probability : f.real_probability)}</span>`
        ).join("")}</div>`
      : `<div class="hint small">No face detected in this image.</div>`);

    const exifEntries = Object.entries(pred.exif || {});
    const exifHtml = exifEntries.length
      ? `<div class="exif-list">${exifEntries.map(([k, v]) => `${k}: ${v}`).join(" · ")}</div>` : "";

    const advancedHtml = `<div class="advanced-block">
        ${pred.fusion_beta != null ? `β (spatial weight): ${pred.fusion_beta}<br>` : ""}
        ${pred.device ? `device: ${pred.device}<br>` : ""}
        ${pred.logits ? `raw logits [fake, real]: [${pred.logits.join(", ")}]` : ""}
      </div>`;

    card.innerHTML = `
      <img src="${thumbDataUrl}" alt="${filename}">
      <div class="evidence-body">
        <div class="evidence-label ${label.toLowerCase()}">
          <span>${label}</span><span class="evidence-conf">${fmtPct(conf)}</span>
        </div>
        <div class="evidence-meta">${filename} · ${pred.inference_ms}ms · ${pred.using_real_model ? "live model" : "demo mode"}</div>
        ${facesHtml}
        ${exifHtml}
        ${advancedHtml}
        ${pred.heatmap_png_base64 ? `<span class="evidence-toggle">Show frequency heatmap</span>
        <div class="evidence-heatmap"><img src="data:image/png;base64,${pred.heatmap_png_base64}" alt="frequency heatmap"></div>` : ""}
        <span class="evidence-toggle copy-summary">Copy summary</span>
      </div>`;
    const toggle = card.querySelector(".evidence-toggle:not(.copy-summary)");
    if (toggle) {
      toggle.addEventListener("click", () => {
        const hm = card.querySelector(".evidence-heatmap");
        hm.classList.toggle("show");
        toggle.textContent = hm.classList.contains("show") ? "Hide frequency heatmap" : "Show frequency heatmap";
      });
    }
    card.querySelector(".copy-summary").addEventListener("click", () => {
      const text = `${filename}: ${label} (${fmtPct(conf)} confidence) — FA3-CLIP ${pred.using_real_model ? "live model" : "demo mode"}`;
      navigator.clipboard?.writeText(text).then(() => toast("Summary copied to clipboard.", "info"));
    });
    return card;
  }

  async function analyzeFiles(fileList) {
    const files = Array.from(fileList).slice(0, 20);
    if (!files.length) return;
    const gallery = $("#results-gallery");
    if (gallery.querySelector(".empty-state")) gallery.innerHTML = "";

    let realN = 0, fakeN = 0, confSum = 0;

    for (const file of files) {
      const thumb = await fileToDataURL(file);
      const form = new FormData();
      form.append("file", file);
      try {
        const resp = await fetch("/api/predict-image", { method: "POST", body: form });
        if (!resp.ok) throw new Error((await resp.json()).detail || "request failed");
        const pred = await resp.json();
        state.usingRealModel = pred.using_real_model;
        updateModePill();

        const label = labelForProb(pred.fake_probability);
        const conf = label === "FAKE" ? pred.fake_probability : pred.real_probability;
        label === "FAKE" ? fakeN++ : realN++;
        confSum += conf;

        gallery.prepend(renderEvidenceCard(pred, thumb, file.name));
        pushHistory({ thumb, source: file.name, label, confidence: conf, fakeProb: pred.fake_probability });
        driveSpectrum(pred.freq_spectrum, label === "FAKE");
        if (label === "FAKE") toast(`Possible fake detected: ${file.name}`, "warn");
      } catch (err) {
        toast(`Failed on ${file.name}: ${err.message}`, "warn", () => analyzeFiles([file]));
      }
    }

    if (files.length > 1) {
      const box = $("#batch-summary");
      box.classList.remove("hidden");
      const avg = files.length ? Math.round((confSum / files.length) * 100) : 0;
      box.innerHTML = `<div><span class="real-count">${realN} real</span></div><div><span class="fake-count">${fakeN} fake</span></div><div>avg confidence ${avg}%</div>`;
    }
  }

  function initAnalyzeTab() {
    const dropzone = $("#dropzone");
    const input = $("#file-input");
    dropzone.addEventListener("click", () => input.click());
    dropzone.addEventListener("dragover", (e) => { e.preventDefault(); dropzone.classList.add("dragover"); });
    dropzone.addEventListener("dragleave", () => dropzone.classList.remove("dragover"));
    dropzone.addEventListener("drop", (e) => {
      e.preventDefault();
      dropzone.classList.remove("dragover");
      analyzeFiles(e.dataTransfer.files);
    });
    input.addEventListener("change", () => analyzeFiles(input.files));

    const slider = $("#threshold-slider");
    slider.addEventListener("input", () => {
      state.threshold = Number(slider.value);
      $("#threshold-value").textContent = `${state.threshold}%`;
    });

    $("#url-analyze").addEventListener("click", () => analyzeUrl());
    $("#url-input").addEventListener("keydown", (e) => { if (e.key === "Enter") analyzeUrl(); });
  }

  async function analyzeUrl() {
    const input = $("#url-input");
    const url = input.value.trim();
    if (!url) return;
    const gallery = $("#results-gallery");
    if (gallery.querySelector(".empty-state")) gallery.innerHTML = "";
    try {
      const resp = await fetch("/api/predict-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      if (!resp.ok) throw new Error((await resp.json()).detail || "request failed");
      const pred = await resp.json();
      state.usingRealModel = pred.using_real_model;
      updateModePill();
      const label = labelForProb(pred.fake_probability);
      const conf = label === "FAKE" ? pred.fake_probability : pred.real_probability;
      gallery.prepend(renderEvidenceCard(pred, url, pred.filename || url));
      pushHistory({ thumb: url, source: pred.filename || url, label, confidence: conf, fakeProb: pred.fake_probability });
      driveSpectrum(pred.freq_spectrum, label === "FAKE");
      input.value = "";
    } catch (err) {
      toast(`Could not analyze URL: ${err.message}`, "warn", () => analyzeUrl());
    }
  }

  function updateModePill() {
    const pill = $("#mode-pill");
    if (state.usingRealModel) {
      pill.textContent = "LIVE MODEL";
      pill.className = "pill pill-live";
    } else {
      pill.textContent = "DEMO MODE";
      pill.className = "pill pill-demo";
    }
  }

  /* ===================== compare tab ===================== */
  const compareState = { a: null, b: null };

  function renderCompareSlot(slot, pred, thumbDataUrl) {
    const label = labelForProb(pred.fake_probability);
    const conf = label === "FAKE" ? pred.fake_probability : pred.real_probability;
    compareState[slot] = { label, conf, fakeProb: pred.fake_probability };
    $(`#compare-result-${slot}`).innerHTML = `
      <img src="${thumbDataUrl}" style="width:100%; border-radius:8px; margin-bottom:8px;">
      <div class="evidence-label ${label.toLowerCase()}" style="color:var(--text)">
        <span>${label}</span><span class="evidence-conf">${fmtPct(conf)}</span>
      </div>`;
    if (compareState.a && compareState.b) renderCompareVerdict();
  }

  function renderCompareVerdict() {
    const { a, b } = compareState;
    const box = $("#compare-verdict");
    box.classList.remove("hidden");
    if (a.label === b.label) {
      box.innerHTML = `Both images were classified <strong>${a.label}</strong> (A: ${fmtPct(a.conf)}, B: ${fmtPct(b.conf)}).`;
    } else {
      box.innerHTML = `Images disagree: A is <strong>${a.label}</strong> (${fmtPct(a.conf)}), B is <strong>${b.label}</strong> (${fmtPct(b.conf)}).`;
    }
  }

  function initCompareTab() {
    $$(".compare-drop").forEach((zone) => {
      const slot = zone.dataset.slot;
      const input = zone.querySelector("input[type=file]");
      zone.addEventListener("click", () => input.click());
      zone.addEventListener("dragover", (e) => { e.preventDefault(); zone.classList.add("dragover"); });
      zone.addEventListener("dragleave", () => zone.classList.remove("dragover"));
      const handle = async (file) => {
        if (!file) return;
        const thumb = await fileToDataURL(file);
        const form = new FormData();
        form.append("file", file);
        try {
          const resp = await fetch("/api/predict-image", { method: "POST", body: form });
          if (!resp.ok) throw new Error((await resp.json()).detail || "request failed");
          const pred = await resp.json();
          renderCompareSlot(slot, pred, thumb);
        } catch (err) {
          toast(`Compare failed: ${err.message}`, "warn", () => handle(file));
        }
      };
      zone.addEventListener("drop", (e) => { e.preventDefault(); zone.classList.remove("dragover"); handle(e.dataTransfer.files[0]); });
      input.addEventListener("change", () => handle(input.files[0]));
    });
  }

  /* ===================== live detection tab ===================== */
  let faceDetector = null;
  function initFaceDetector() {
    if ("FaceDetector" in window) {
      try { faceDetector = new window.FaceDetector({ fastMode: true, maxDetectedFaces: 5 }); } catch { faceDetector = null; }
    }
  }

  function initLiveChart() {
    const ctx = $("#live-chart");
    state.liveChart = new Chart(ctx, {
      type: "line",
      data: {
        labels: [],
        datasets: [{ label: "Fake probability", data: [], borderColor: "#FF5D5D", backgroundColor: "rgba(255,93,93,0.15)", fill: true, tension: 0.25, pointRadius: 0 }],
      },
      options: {
        animation: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { display: false },
          y: { min: 0, max: 1, ticks: { color: "#8992A3", callback: (v) => `${Math.round(v * 100)}%` }, grid: { color: "#242A36" } },
        },
      },
    });
  }

  function pushLiveChartPoint(prob) {
    const c = state.liveChart;
    c.data.labels.push("");
    c.data.datasets[0].data.push(prob);
    if (c.data.labels.length > 60) { c.data.labels.shift(); c.data.datasets[0].data.shift(); }
    c.update("none");
  }

  let liveLoopHandle = null;
  let lastFrameTime = 0;
  let fpsWindow = [];

  async function startLive() {
    try {
      state.liveStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
    } catch (err) {
      toast("Camera access denied or unavailable.");
      return;
    }
    const video = $("#live-video");
    video.srcObject = state.liveStream;
    state.liveRunning = true;
    $("#live-toggle").textContent = "Stop camera";
    $("#live-snapshot").disabled = false;
    $("#live-label").classList.remove("hidden");
    liveLoop();
  }

  function stopLive() {
    state.liveRunning = false;
    if (state.liveStream) state.liveStream.getTracks().forEach((t) => t.stop());
    $("#live-toggle").textContent = "Start camera";
    $("#live-snapshot").disabled = true;
    $("#live-label").classList.add("hidden");
    cancelAnimationFrame(liveLoopHandle);
  }

  async function drawFaceBoxes(video, canvas) {
    if (!$("#live-boxes").checked || !faceDetector) return;
    try {
      const faces = await faceDetector.detect(video);
      const ctx = canvas.getContext("2d");
      ctx.strokeStyle = "#3DDC97";
      ctx.lineWidth = 2;
      faces.forEach((f) => {
        const { x, y, width, height } = f.boundingBox;
        ctx.strokeRect(x, y, width, height);
      });
    } catch { /* face detection best-effort only */ }
  }

  let lastAnalysisAt = 0;
  let liveIntervalMs = 700;

  function beep() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 480;
      osc.connect(gain); gain.connect(ctx.destination);
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      osc.start(); osc.stop(ctx.currentTime + 0.15);
    } catch { /* ignore */ }
  }

  async function liveLoop(ts) {
    if (!state.liveRunning) return;
    const video = $("#live-video");
    const canvas = $("#live-overlay");
    if (video.videoWidth) {
      canvas.width = video.clientWidth;
      canvas.height = video.clientHeight;
      canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
      drawFaceBoxes(video, canvas);

      const now = performance.now();
      if (now - lastAnalysisAt > liveIntervalMs) {
        lastAnalysisAt = now;
        analyzeLiveFrame(video);
      }
    }
    liveLoopHandle = requestAnimationFrame(liveLoop);
  }

  let liveBusy = false;
  async function analyzeLiveFrame(video) {
    if (liveBusy) return;
    liveBusy = true;
    const t0 = performance.now();
    const off = document.createElement("canvas");
    off.width = 224; off.height = 224;
    off.getContext("2d").drawImage(video, 0, 0, 224, 224);
    const dataUrl = off.toDataURL("image/jpeg", 0.82);

    try {
      const resp = await fetch("/api/predict-frame", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: dataUrl }),
      });
      if (!resp.ok) throw new Error("frame inference failed");
      const pred = await resp.json();
      state.usingRealModel = pred.using_real_model;
      updateModePill();

      const label = labelForProb(pred.fake_probability);
      const latency = Math.round(performance.now() - t0);

      $("#live-label").textContent = `${label} · ${fmtPct(label === "FAKE" ? pred.fake_probability : pred.real_probability)}`;
      $("#live-label").className = `live-label ${label.toLowerCase()}`;
      $("#live-meter-fill").style.width = `${pred.fake_probability * 100}%`;
      $("#live-latency").textContent = latency;
      state.liveFrameCount++;
      $("#live-count").textContent = state.liveFrameCount;
      pushLiveChartPoint(pred.fake_probability);
      driveSpectrum(pred.freq_spectrum, label === "FAKE");

      fpsWindow.push(performance.now());
      fpsWindow = fpsWindow.filter((t) => performance.now() - t < 5000);
      $("#live-fps").textContent = (fpsWindow.length / 5).toFixed(1);

      if (label === "FAKE" && $("#live-sound").checked) beep();
      window._lastLiveFrame = { dataUrl, pred, label };
    } catch (err) {
      /* transient network hiccup, ignore for live loop */
    } finally {
      liveBusy = false;
    }
  }

  function saveLiveSnapshot() {
    const snap = window._lastLiveFrame;
    if (!snap) return toast("No frame analyzed yet.");
    pushHistory({
      thumb: snap.dataUrl,
      source: "Live camera",
      label: snap.label,
      confidence: snap.label === "FAKE" ? snap.pred.fake_probability : snap.pred.real_probability,
      fakeProb: snap.pred.fake_probability,
    });
    toast("Snapshot saved to history.", "info");
  }

  function initLiveTab() {
    initFaceDetector();
    initLiveChart();
    $("#live-toggle").addEventListener("click", () => (state.liveRunning ? stopLive() : startLive()));
    $("#live-snapshot").addEventListener("click", saveLiveSnapshot);

    const intervalSlider = $("#live-interval");
    intervalSlider.addEventListener("input", () => {
      liveIntervalMs = Number(intervalSlider.value);
      $("#live-interval-value").textContent = liveIntervalMs;
    });

    document.addEventListener("keydown", (e) => {
      if (e.code === "Space" && state.liveRunning && document.querySelector("#tab-live.active")) {
        e.preventDefault();
        saveLiveSnapshot();
      }
    });
  }

  /* ===================== video tab ===================== */
  function initVideoTab() {
    const input = $("#video-file-input");
    const preview = $("#video-preview");
    const analyzeBtn = $("#video-analyze");
    const fpsSlider = $("#video-fps");

    fpsSlider.addEventListener("input", () => ($("#video-fps-value").textContent = fpsSlider.value));

    input.addEventListener("change", () => {
      const file = input.files[0];
      if (!file) return;
      preview.src = URL.createObjectURL(file);
      preview.hidden = false;
      analyzeBtn.disabled = false;
    });

    analyzeBtn.addEventListener("click", () => analyzeVideo(preview));
  }

  async function analyzeVideo(video) {
    const timeline = $("#video-timeline");
    timeline.innerHTML = "";
    const progress = $("#video-progress");
    const sampleFps = Number($("#video-fps").value);

    await new Promise((res) => {
      if (video.readyState >= 1) return res();
      video.onloadedmetadata = res;
    });
    const duration = video.duration || 0;
    const totalSamples = Math.max(1, Math.floor(duration * sampleFps));
    const step = duration / totalSamples;

    let fakeN = 0, realN = 0;
    for (let i = 0; i < totalSamples; i++) {
      const t = i * step;
      await seekTo(video, t);
      const canvas = document.createElement("canvas");
      canvas.width = 224; canvas.height = 224;
      canvas.getContext("2d").drawImage(video, 0, 0, 224, 224);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.82);

      progress.textContent = `Analyzing frame ${i + 1} / ${totalSamples}…`;
      try {
        const resp = await fetch("/api/predict-frame", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image: dataUrl }),
        });
        const pred = await resp.json();
        const label = labelForProb(pred.fake_probability);
        label === "FAKE" ? fakeN++ : realN++;

        const row = document.createElement("div");
        row.className = "timeline-row";
        row.innerHTML = `<span class="dot ${label.toLowerCase()}"></span><span class="t">${t.toFixed(1)}s</span><span>${label} · ${fmtPct(pred.fake_probability)} fake-prob</span>`;
        timeline.appendChild(row);
        driveSpectrum(pred.freq_spectrum, label === "FAKE");
      } catch {
        /* skip failed frame */
      }
    }
    progress.textContent = `Done — ${totalSamples} frames sampled.`;
    pushHistory({
      thumb: null,
      source: `Video (${totalSamples} frames)`,
      label: fakeN > realN ? "FAKE" : "REAL",
      confidence: Math.max(fakeN, realN) / totalSamples,
      fakeProb: fakeN / totalSamples,
    });
  }

  function seekTo(video, t) {
    return new Promise((res) => {
      video.currentTime = t;
      video.onseeked = () => res();
    });
  }

  /* ===================== model / about tabs ===================== */
  async function loadModelInfo() {
    try {
      const resp = await fetch("/api/model-info");
      const info = await resp.json();
      state.usingRealModel = info.using_real_model;
      updateModePill();
      $("#model-info-body").innerHTML = `
        <dl>
          <dt>Architecture</dt><dd>${info.architecture}</dd>
          <dt>Status</dt><dd>${info.notes}</dd>
          <dt>Checkpoint path</dt><dd>${info.checkpoint_dir}</dd>
          <dt>Device</dt><dd>${info.device}</dd>
          <dt>Parameters</dt><dd>${info.param_count ? info.param_count.toLocaleString() : "—"}</dd>
          <dt>Input size</dt><dd>${info.input_size}×${info.input_size}</dd>
          <dt>Training datasets</dt><dd>${info.datasets.map((d) => `• ${d}`).join("<br>")}</dd>
        </dl>`;
      $("#about-datasets").textContent = info.datasets.join(" · ");

      if (info.using_real_model && typeof info.fusion_beta === "number") {
        $("#fusion-meter-fill").style.width = `${info.fusion_beta * 100}%`;
        $("#fusion-value").textContent = `β = ${info.fusion_beta.toFixed(3)}`;
      } else {
        $("#fusion-value").textContent = "Not available in demo mode — load the real checkpoint to see this.";
      }
    } catch {
      $("#model-info-body").textContent = "Could not reach the backend. Is the server running?";
    }
  }

  /* ===================== boot ===================== */
  document.addEventListener("DOMContentLoaded", () => {
    initTabs();
    initTheme();
    initAdvancedToggle();
    initConnectivity();
    initSpectrum();
    restoreHistory();
    initHistoryControls();
    initAnalyzeTab();
    initCompareTab();
    initLiveTab();
    initVideoTab();
    loadModelInfo();
    renderHistoryCharts();
  });
})();
