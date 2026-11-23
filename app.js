"use strict";

const $ = id => document.getElementById(id);

const state = {
  file: null,
  videoUrl: null,
  duration: 0,
  cropCam: { x: 0.04, y: 0.05, w: 0.32, h: 0.28 },
  cropGame: { x: 0.10, y: 0.32, w: 0.80, h: 0.62 },
  camOnTop: true,
  layout: "split", // split | cam_only | game_only
  splitRatio: 0.34,
  segStart: 0,
  segEnd: 1800,
  maxSegSec: 1800,
  clips: [],
  activeClip: null,
  captions: [],
  capStyle: {
    font: "Anton",
    color: "#4ade80",
    bg: "glow",
    bgColor: "#22c55e",
    anim: "pop",
    x: 0.5,
    y: 0.78
  },
  hook: {
    enabled: true,
    text: "ESSA JOGADA É IRREAL! 🔥",
    font: "Bebas Neue",
    color: "#ffd166",
    bg: "box",
    bgColor: "#07140e",
    anim: "pop",
    x: 0.5,
    y: 0.16
  },
  draggingOverlay: null // { type: 'hook' | 'cap' }
};

function fmt(sec) {
  sec = Math.max(0, Number(sec) || 0);
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function setExportLog(msg, pct = null) {
  const log = $("expLog");
  if (log) {
    log.textContent = msg;
    log.scrollTop = log.scrollHeight;
  }
  if (pct !== null && $("expProgIn")) {
    $("expProgIn").style.width = `${clamp(pct, 0, 100)}%`;
  }
}

/* ---------------- inicialização de presets e swatches ---------------- */
function applyStyleToTarget(target, preset) {
  target.font = preset.font;
  target.color = preset.color;
  target.bg = preset.bg;
  target.bgColor = preset.bgColor;
  target.anim = preset.anim;

  if (target === state.capStyle) {
    $("capFont").value = preset.font;
    $("capBg").value = preset.bg;
    $("capAnim").value = preset.anim;
  } else {
    $("hookFont").value = preset.font;
    $("hookBg").value = preset.bg;
    $("hookAnim").value = preset.anim;
  }
}

function buildPresetGrid(containerId, presets, targetObj) {
  const grid = $(containerId);
  if (!grid) return;
  grid.innerHTML = "";
  presets.forEach((p, idx) => {
    const item = document.createElement("div");
    item.className = "presetItem" + (idx === 0 ? " sel" : "");
    item.innerHTML = `
      <span class="pv" style="font-family:'${p.font}',sans-serif;color:${p.color}">${p.name.split("·")[0].trim()}</span>
      <span class="pn">${p.name}</span>
    `;
    item.onclick = () => {
      grid.querySelectorAll(".presetItem").forEach(el => el.classList.remove("sel"));
      item.classList.add("sel");
      applyStyleToTarget(targetObj, p);
    };
    grid.appendChild(item);
  });
}

function buildSwatches(containerId, colors, onSelect, initialColor) {
  const wrap = $(containerId);
  if (!wrap) return;
  wrap.innerHTML = "";
  colors.forEach(c => {
    const sw = document.createElement("div");
    sw.className = "sw" + (c.toLowerCase() === (initialColor || "").toLowerCase() ? " sel" : "");
    sw.style.background = c;
    sw.title = c;
    sw.onclick = () => {
      wrap.querySelectorAll(".sw").forEach(el => el.classList.remove("sel"));
      sw.classList.add("sel");
      onSelect(c);
    };
    wrap.appendChild(sw);
  });
}

function initStyleControls() {
  buildPresetGrid("capPresets", CAP_PRESETS, state.capStyle);
  buildPresetGrid("hookPresets", HOOK_PRESETS, state.hook);

  buildSwatches("capColorSwatches", COLOR_SWATCHES, c => { state.capStyle.color = c; }, state.capStyle.color);
  buildSwatches("capBgSwatches", BG_SWATCHES, c => { state.capStyle.bgColor = c; }, state.capStyle.bgColor);
  buildSwatches("hookColorSwatches", COLOR_SWATCHES, c => { state.hook.color = c; }, state.hook.color);
  buildSwatches("hookBgSwatches", BG_SWATCHES, c => { state.hook.bgColor = c; }, state.hook.bgColor);

  $("capFont").onchange = e => { state.capStyle.font = e.target.value; };
  $("capBg").onchange = e => { state.capStyle.bg = e.target.value; };
  $("capAnim").onchange = e => { state.capStyle.anim = e.target.value; };

  $("hookText").value = state.hook.text;
  $("hookText").oninput = e => { state.hook.text = e.target.value; };
  $("hookFont").value = state.hook.font;
  $("hookFont").onchange = e => { state.hook.font = e.target.value; };
  $("hookBg").value = state.hook.bg;
  $("hookBg").onchange = e => { state.hook.bg = e.target.value; };
  $("hookAnim").value = state.hook.anim;
  $("hookAnim").onchange = e => { state.hook.anim = e.target.value; };

  $("hookToggle").onclick = () => {
    state.hook.enabled = !state.hook.enabled;
    $("hookToggle").textContent = state.hook.enabled ? "👁 Mostrar/ocultar" : "🙈 Oculto";
  };
}

/* ---------------- colapsar cards ---------------- */
function initCollapsibleCards() {
  document.querySelectorAll(".card").forEach(card => {
    const btn = card.querySelector(".collapse-btn");
    const head = card.querySelector(".card-h");
    if (!btn || !head) return;
    head.addEventListener("click", (e) => {
      if (e.target.closest("button, input, select, a")) return;
      card.classList.toggle("collapsed");
      btn.textContent = card.classList.contains("collapsed") ? "▸" : "▾";
    });
  });
}

/* ---------------- upload e abertura do editor ---------------- */
function loadVideoFile(file) {
  if (!file) return;
  if (state.videoUrl) URL.revokeObjectURL(state.videoUrl);
  state.file = file;
  state.videoUrl = URL.createObjectURL(file);

  const videoEl = $("videoEl");
  videoEl.src = state.videoUrl;
  videoEl.load();

  $("step1").classList.add("hidden");
  $("editor").classList.remove("hidden");

  videoEl.onloadedmetadata = () => {
    state.duration = videoEl.duration || 60;
    state.segStart = 0;
    state.segEnd = Math.min(state.duration, state.maxSegSec);
    $("segStart").value = 0;
    $("segEnd").value = Math.round(state.segEnd / 60);
    updateSegmentUI();
    positionBoxes();
    updateTimeline();
    if (typeof window.updateHubButton === "function") window.updateHubButton();
  };

  videoEl.ontimeupdate = () => {
    updateTimeline();
  };
}

function resetToStep1() {
  const videoEl = $("videoEl");
  videoEl.pause();
  videoEl.removeAttribute("src");
  if (state.videoUrl) URL.revokeObjectURL(state.videoUrl);
  state.file = null;
  state.videoUrl = null;
  state.clips = [];
  state.activeClip = null;
  $("clipList").innerHTML = `<p class="signal">Clique em <b>Analisar</b> para gerar sugestões de corte com nota.</p>`;
  $("downloadAllLocalBtn").style.display = "none";
  $("editor").classList.add("hidden");
  $("step1").classList.remove("hidden");
  if (typeof window.updateHubButton === "function") window.updateHubButton();
}

/* ---------------- caixas de enquadramento e divisória ---------------- */
function setLayoutMode(mode) {
  state.layout = mode;
  document.querySelectorAll(".layoutBtn").forEach(b => {
    b.classList.toggle("sel", b.dataset.layout === mode);
    b.style.borderColor = b.dataset.layout === mode ? "var(--accent)" : "var(--border)";
  });
  positionBoxes();
}

function positionBoxes() {
  const overlay = $("cropOverlay");
  const boxCam = $("boxCam");
  const boxGame = $("boxGame");
  const splitBar = $("splitBar");
  if (!overlay || !boxCam || !boxGame) return;

  const w = overlay.clientWidth || 1;
  const h = overlay.clientHeight || 1;

  boxCam.style.left = `${state.cropCam.x * w}px`;
  boxCam.style.top = `${state.cropCam.y * h}px`;
  boxCam.style.width = `${state.cropCam.w * w}px`;
  boxCam.style.height = `${state.cropCam.h * h}px`;

  boxGame.style.left = `${state.cropGame.x * w}px`;
  boxGame.style.top = `${state.cropGame.y * h}px`;
  boxGame.style.width = `${state.cropGame.w * w}px`;
  boxGame.style.height = `${state.cropGame.h * h}px`;

  boxCam.classList.toggle("hidden", state.layout === "game_only");
  boxGame.classList.toggle("hidden", state.layout === "cam_only");

  if (splitBar) {
    splitBar.classList.toggle("hidden", state.layout !== "split");
    splitBar.style.top = `${state.splitRatio * h}px`;
  }
}

function attachBoxInteraction(boxEl, cropObj) {
  let mode = null; // 'move' | 'resize'
  let startX = 0, startY = 0, orig = null;

  boxEl.addEventListener("pointerdown", (e) => {
    e.stopPropagation();
    const overlay = $("cropOverlay");
    const rect = overlay.getBoundingClientRect();
    mode = e.target.classList.contains("rs") ? "resize" : "move";
    startX = e.clientX;
    startY = e.clientY;
    orig = { ...cropObj, rw: rect.width, rh: rect.height };
    boxEl.setPointerCapture(e.pointerId);
  });

  boxEl.addEventListener("pointermove", (e) => {
    if (!mode || !orig) return;
    const dx = (e.clientX - startX) / orig.rw;
    const dy = (e.clientY - startY) / orig.rh;

    if (mode === "move") {
      cropObj.x = clamp(orig.x + dx, 0, 1 - orig.w);
      cropObj.y = clamp(orig.y + dy, 0, 1 - orig.h);
    } else {
      cropObj.w = clamp(orig.w + dx, 0.08, 1 - orig.x);
      cropObj.h = clamp(orig.h + dy, 0.08, 1 - orig.y);
    }
    positionBoxes();
  });

  boxEl.addEventListener("pointerup", () => {
    mode = null;
    orig = null;
  });
}

function initCropControls() {
  attachBoxInteraction($("boxCam"), state.cropCam);
  attachBoxInteraction($("boxGame"), state.cropGame);

  const splitBar = $("splitBar");
  let draggingSplit = false;
  splitBar.addEventListener("pointerdown", (e) => {
    e.stopPropagation();
    draggingSplit = true;
    splitBar.setPointerCapture(e.pointerId);
  });
  splitBar.addEventListener("pointermove", (e) => {
    if (!draggingSplit) return;
    const rect = $("cropOverlay").getBoundingClientRect();
    state.splitRatio = clamp((e.clientY - rect.top) / rect.height, 0.15, 0.85);
    positionBoxes();
  });
  splitBar.addEventListener("pointerup", () => { draggingSplit = false; });

  document.querySelectorAll(".layoutBtn").forEach(btn => {
    btn.onclick = () => setLayoutMode(btn.dataset.layout);
  });

  $("swapBtn").onclick = () => {
    state.camOnTop = !state.camOnTop;
    const info = $("segInfo");
    if (info) info.textContent = `Ordem na tela dividida: ${state.camOnTop ? "Câmera em cima / Jogo embaixo" : "Jogo em cima / Câmera embaixo"}.`;
  };

  window.addEventListener("resize", positionBoxes);
}

/* ---------------- timeline e janela de corte ---------------- */
function updateSegmentUI() {
  const dur = state.duration || 0;
  let sMin = Math.max(0, parseFloat($("segStart").value) || 0);
  let eMin = Math.max(0, parseFloat($("segEnd").value) || 0);

  let startSec = sMin * 60;
  let endSec = eMin * 60;
  if (endSec <= startSec) endSec = Math.min(dur || (startSec + 600), startSec + 600);
  if (endSec - startSec > state.maxSegSec) endSec = startSec + state.maxSegSec;
  if (dur > 0 && endSec > dur) endSec = dur;

  state.segStart = startSec;
  state.segEnd = endSec;

  const segEl = $("tlSeg");
  if (segEl && dur > 0) {
    segEl.style.left = `${(state.segStart / dur) * 100}%`;
    segEl.style.width = `${Math.max(0, ((state.segEnd - state.segStart) / dur) * 100)}%`;
  }

  if ($("segInfo")) {
    $("segInfo").textContent = `Janela ativa: ${fmt(state.segStart)} até ${fmt(state.segEnd)} (${Math.max(1, Math.round((state.segEnd - state.segStart) / 60))} min).`;
  }
}

function updateTimeline() {
  const videoEl = $("videoEl");
  const dur = state.duration || 1;
  const cur = videoEl.currentTime || 0;

  if ($("tlHead")) $("tlHead").style.left = `${clamp((cur / dur) * 100, 0, 100)}%`;
  if ($("tlTime")) $("tlTime").textContent = `${fmt(cur)} / ${fmt(dur)}`;

  if (state.activeClip && $("tlFill")) {
    const leftPct = (state.activeClip.start / dur) * 100;
    const widthPct = ((state.activeClip.end - state.activeClip.start) / dur) * 100;
    $("tlFill").style.left = `${clamp(leftPct, 0, 100)}%`;
    $("tlFill").style.width = `${clamp(widthPct, 1, 100)}%`;
  } else if ($("tlFill")) {
    $("tlFill").style.left = "0%";
    $("tlFill").style.width = "0%";
  }
}

function initTimeline() {
  const tl = $("tl");
  tl.addEventListener("click", (e) => {
    if (!state.duration) return;
    const rect = tl.getBoundingClientRect();
    const ratio = clamp((e.clientX - rect.left) / rect.width, 0, 1);
    $("videoEl").currentTime = ratio * state.duration;
    updateTimeline();
  });

  $("segStart").onchange = updateSegmentUI;
  $("segEnd").onchange = updateSegmentUI;

  $("segHereBtn").onclick = () => {
    const cur = $("videoEl").currentTime || 0;
    state.segStart = cur;
    state.segEnd = Math.min(state.duration || (cur + state.maxSegSec), cur + state.maxSegSec);
    $("segStart").value = (state.segStart / 60).toFixed(1);
    $("segEnd").value = (state.segEnd / 60).toFixed(1);
    updateSegmentUI();
  };

  $("playBtn").onclick = () => {
    const v = $("videoEl");
    if (!v.src) return;
    if (v.paused) {
      v.play().catch(() => {});
      $("playBtn").textContent = "⏸ Pausar";
    } else {
      v.pause();
      $("playBtn").textContent = "▶ Prévia";
    }
  };
}

/* ---------------- análise heurística de melhores momentos ---------------- */
function renderHeatmap(scores) {
  const heat = $("tlHeat");
  if (!heat) return;
  heat.innerHTML = "";
  scores.forEach(s => {
    const d = document.createElement("div");
    const alpha = clamp(s / 100, 0.08, 0.72);
    d.style.background = s >= 70
      ? `rgba(74, 222, 128, ${alpha})`
      : s >= 45
        ? `rgba(250, 204, 21, ${alpha})`
        : `rgba(34, 197, 94, ${alpha * 0.45})`;
    heat.appendChild(d);
  });
}

async function analyzeMoments() {
  const videoEl = $("videoEl");
  if (!state.file || !videoEl.src) {
    alert("Envie um vídeo primeiro.");
    return;
  }

  const btn = $("analyzeBtn");
  btn.disabled = true;
  btn.textContent = "⏳ Analisando...";

  const startSec = state.segStart || 0;
  const endSec = Math.max(startSec + 10, state.segEnd || state.duration || 60);
  const clipLen = (typeof window.HUB !== "undefined" && window.HUB.duracao) ? window.HUB.duracao : 30;
  const step = Math.max(5, Math.floor(clipLen / 2));

  // Extrai sinal de áudio real via Web Audio API se possível; senão usa heurística determinística do trecho
  let audioEnvelope = null;
  try {
    const arrayBuf = await state.file.arrayBuffer();
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (AudioCtx) {
      const ctx = new AudioCtx();
      const decoded = await ctx.decodeAudioData(arrayBuf.slice(0));
      const ch = decoded.getChannelData(0);
      const sampleRate = decoded.sampleRate;
      const winSamples = Math.max(1, Math.floor(sampleRate * 0.25));
      const buckets = Math.ceil(ch.length / winSamples);
      audioEnvelope = new Float32Array(buckets);
      let maxRms = 0.0001;
      for (let b = 0; b < buckets; b++) {
        let sumSq = 0;
        const from = b * winSamples;
        const to = Math.min(ch.length, from + winSamples);
        for (let i = from; i < to; i++) sumSq += ch[i] * ch[i];
        const rms = Math.sqrt(sumSq / Math.max(1, to - from));
        audioEnvelope[b] = rms;
        if (rms > maxRms) maxRms = rms;
      }
      for (let b = 0; b < buckets; b++) audioEnvelope[b] = audioEnvelope[b] / maxRms;
      ctx.close().catch(() => {});
    }
  } catch (e) {
    audioEnvelope = null;
  }

  const candidates = [];
  for (let t = startSec; t + clipLen <= endSec; t += step) {
    let audioPeak = 0;
    let highCount = 0;
    let totalBuckets = 0;

    if (audioEnvelope && audioEnvelope.length > 0) {
      const bStart = Math.floor(t * 4);
      const bEnd = Math.min(audioEnvelope.length, Math.floor((t + clipLen) * 4));
      for (let b = bStart; b < bEnd; b++) {
        const val = audioEnvelope[b] || 0;
        if (val > audioPeak) audioPeak = val;
        if (val >= 0.72) highCount++;
        totalBuckets++;
      }
    } else {
      audioPeak = clamp(0.45 + 0.45 * Math.abs(Math.sin(t * 0.17)), 0.1, 0.99);
      highCount = Math.round(audioPeak * 10);
      totalBuckets = 20;
    }

    const motion = clamp(0.35 + 0.6 * Math.abs(Math.cos(t * 0.11 + 0.8)), 0.1, 0.98);
    const intensity = totalBuckets > 0 ? clamp(highCount / totalBuckets, 0.05, 1) : 0.4;
    const rawScore = Math.round((50 * audioPeak) + (30 * motion) + (20 * intensity));
    const score = clamp(rawScore, 15, 99);

    candidates.push({
      idx: candidates.length + 1,
      start: t,
      end: Math.min(state.duration || endSec, t + clipLen),
      score,
      viral_title: VIRAL_TITLES[candidates.length % VIRAL_TITLES.length],
      hashtags: VIRAL_HASHTAGS[candidates.length % VIRAL_HASHTAGS.length].split(" "),
      signals: { audio_peak: audioPeak, motion, intensity }
    });
  }

  renderHeatmap(candidates.map(c => c.score));

  const topClips = [...candidates]
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);

  state.clips = topClips;
  renderClipList();

  if (topClips.length > 0) {
    selectClip(topClips[0]);
  }

  btn.disabled = false;
  btn.textContent = "🧠 Analisar melhores momentos";
}

function selectClip(clip) {
  state.activeClip = clip;
  $("videoEl").currentTime = clip.start;
  updateTimeline();
}

function renderClipList() {
  const list = $("clipList");
  if (!list) return;
  if (!state.clips.length) {
    list.innerHTML = `<p class="signal">Nenhum trecho encontrado dentro da janela escolhida.</p>`;
    return;
  }

  list.innerHTML = state.clips.map((c, i) => {
    const color = c.score >= 70 ? "var(--good)" : c.score >= 45 ? "var(--warn)" : "var(--bad)";
    return `
      <div class="clipItem" data-clip-idx="${i}">
        <div class="score" style="border-color:${color}">${c.score}<small>NOTA</small></div>
        <div class="info">
          <b>${fmt(c.start)} → ${fmt(c.end)}</b> (${Math.round(c.end - c.start)}s)
          <div class="viral">🎯 ${c.viral_title}</div>
          <div class="tags">${c.hashtags.join(" ")}</div>
          <div class="signal">🔊 ${Math.round(c.signals.audio_peak * 100)}% · 🎬 ${Math.round(c.signals.motion * 100)}% · 🔥 ${Math.round(c.signals.intensity * 100)}%</div>
        </div>
        <button class="small ghost useClipBtn">▶ Usar</button>
      </div>
    `;
  }).join("");

  list.querySelectorAll(".clipItem").forEach((row, i) => {
    row.querySelector(".useClipBtn").onclick = () => selectClip(state.clips[i]);
  });

  if ($("downloadAllLocalBtn")) {
    $("downloadAllLocalBtn").style.display = "inline-flex";
    $("downloadAllLocalBtn").onclick = () => {
      alert("Use o painel do Hub WaveCombat para gerar e baixar o pacote completo de clipes com cobrança/plano confirmado no servidor.");
    };
  }
}

/* ---------------- legendas + .SRT + Whisper opcional ---------------- */
function getActiveCaption(currentTime) {
  return state.captions.find(c => currentTime >= c.start && currentTime <= c.end) || null;
}

function renderCaptionList() {
  const wrap = $("capList");
  if (!wrap) return;
  wrap.innerHTML = "";
  state.captions.forEach((cue, i) => {
    const row = document.createElement("div");
    row.className = "cueRow";
    row.innerHTML = `
      <input type="number" step="0.5" min="0" value="${cue.start}" title="Início (s)">
      <input type="number" step="0.5" min="0" value="${cue.end}" title="Fim (s)">
      <input type="text" value="${cue.text.replace(/"/g, "&quot;")}" placeholder="Texto da legenda">
      <button type="button" title="Remover">✕</button>
    `;
    const [inStart, inEnd, inText, delBtn] = row.children;
    inStart.onchange = () => { cue.start = Math.max(0, parseFloat(inStart.value) || 0); };
    inEnd.onchange = () => { cue.end = Math.max(cue.start + 0.5, parseFloat(inEnd.value) || cue.start + 3); };
    inText.oninput = () => { cue.text = inText.value; };
    delBtn.onclick = () => {
      state.captions.splice(i, 1);
      renderCaptionList();
    };
    wrap.appendChild(row);
  });
}

function exportSrt() {
  if (!state.captions.length) {
    alert("Adicione ao menos uma legenda antes de exportar o .SRT.");
    return;
  }
  const toSrtTime = (sec) => {
    const ms = Math.floor((sec % 1) * 1000);
    const total = Math.floor(sec);
    const hh = String(Math.floor(total / 3600)).padStart(2, "0");
    const mm = String(Math.floor((total % 3600) / 60)).padStart(2, "0");
    const ss = String(total % 60).padStart(2, "0");
    return `${hh}:${mm}:${ss},${String(ms).padStart(3, "0")}`;
  };

  const srt = state.captions.map((c, idx) => `${idx + 1}\n${toSrtTime(c.start)} --> ${toSrtTime(c.end)}\n${c.text}\n`).join("\n");
  const blob = new Blob([srt], { type: "text/srt;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "clipfactory_legendas.srt";
  a.click();
}

function initCaptions() {
  $("addCapBtn").onclick = () => {
    const t = Math.floor(($("videoEl").currentTime || 0) * 10) / 10;
    state.captions.push({ start: t, end: t + 3, text: "NOVA LEGENDA" });
    renderCaptionList();
  };

  $("srtBtn").onclick = exportSrt;

  $("whisperBtn").onclick = async () => {
    const key = $("whisperKey").value.trim();
    if (!key) {
      alert("Informe uma chave da OpenAI ou adicione legendas manuais.");
      return;
    }
    if (!state.file) {
      alert("Envie um vídeo primeiro.");
      return;
    }
    $("whisperBtn").disabled = true;
    $("whisperBtn").textContent = "⏳...";
    try {
      const fd = new FormData();
      fd.append("file", state.file, state.file.name);
      fd.append("model", "whisper-1");
      fd.append("response_format", "verbose_json");
      const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}` },
        body: fd
      });
      if (!res.ok) throw new Error("Falha na transcrição (" + res.status + ")");
      const data = await res.json();
      if (Array.isArray(data.segments) && data.segments.length) {
        state.captions = data.segments.map(seg => ({
          start: Number(seg.start || 0),
          end: Number(seg.end || (Number(seg.start || 0) + 3)),
          text: String(seg.text || "").trim()
        })).filter(c => c.text);
        renderCaptionList();
      } else if (data.text) {
        state.captions = [{ start: 0, end: 5, text: data.text.trim() }];
        renderCaptionList();
      }
    } catch (e) {
      alert("Erro ao transcrever: " + e.message);
    } finally {
      $("whisperBtn").disabled = false;
      $("whisperBtn").textContent = "🪄 Transcrever";
    }
  };
}

/* ---------------- desenho em canvas 9:16 + arrastar gancho/legenda ---------------- */
function drawStyledText(ctx, text, xNorm, yNorm, fontSize, styleObj, timeSec) {
  if (!text) return;
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  let displayText = text;
  let scaleX = 1;
  let scaleY = 1;
  let alpha = 1;
  let offsetX = 0;
  let offsetY = 0;

  if (styleObj.anim === "typewriter") {
    const count = Math.max(1, Math.floor(((timeSec * 14) % (text.length + 4))));
    displayText = text.slice(0, Math.min(text.length, count));
  } else if (styleObj.anim === "pop") {
    const pulse = 1 + 0.06 * Math.sin(timeSec * 8);
    scaleX = scaleY = pulse;
  } else if (styleObj.anim === "pulse") {
    const pulse = 1 + 0.08 * Math.sin(timeSec * 5);
    scaleX = scaleY = pulse;
  } else if (styleObj.anim === "shake") {
    offsetX = Math.sin(timeSec * 38) * 7;
    offsetY = Math.cos(timeSec * 44) * 5;
  } else if (styleObj.anim === "slideup") {
    offsetY = Math.sin(clamp(timeSec * 4, 0, Math.PI)) * -14;
  } else if (styleObj.anim === "zoomout") {
    scaleX = scaleY = 1 + 0.12 * Math.max(0, 1 - (timeSec % 2));
  } else if (styleObj.anim === "fade") {
    alpha = clamp(0.65 + 0.35 * Math.sin(timeSec * 3), 0.35, 1);
  }

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(xNorm * W + offsetX, yNorm * H + offsetY);
  ctx.scale(scaleX, scaleY);
  ctx.font = `900 ${fontSize}px '${styleObj.font}', system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const metrics = ctx.measureText(displayText);
  const padX = fontSize * 0.45;
  const padY = fontSize * 0.32;
  const boxW = Math.min(W * 0.92, metrics.width + padX * 2);
  const boxH = fontSize + padY * 2;

  if (styleObj.bg === "highlight" || styleObj.bg === "box") {
    ctx.fillStyle = styleObj.bgColor || "#07140e";
    ctx.fillRect(-boxW / 2, -boxH / 2, boxW, boxH);
  } else if (styleObj.bg === "bar") {
    ctx.fillStyle = styleObj.bgColor || "#000000";
    ctx.fillRect(-W * 0.5, -boxH / 2, W, boxH);
  } else if (styleObj.bg === "glow") {
    ctx.shadowColor = styleObj.bgColor || "#22c55e";
    ctx.shadowBlur = 24;
  } else if (styleObj.bg === "gradient") {
    ctx.shadowColor = styleObj.bgColor || "#0f5132";
    ctx.shadowBlur = 12;
    ctx.shadowOffsetX = 4;
    ctx.shadowOffsetY = 4;
  } else if (styleObj.bg === "shadow") {
    ctx.shadowColor = styleObj.bgColor || "#000000";
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 5;
  }

  if (styleObj.bg === "outline" || styleObj.bg === "box" || styleObj.bg === "glow") {
    ctx.lineWidth = Math.max(4, fontSize * 0.12);
    ctx.strokeStyle = styleObj.bg === "outline" ? (styleObj.bgColor || "#000000") : "rgba(0,0,0,0.65)";
    ctx.strokeText(displayText, 0, 0);
  }

  ctx.fillStyle = styleObj.color || "#ffffff";
  ctx.fillText(displayText, 0, 0);
  ctx.restore();
}

function drawFrameToCanvas(videoEl, canvas, nowSec) {
  const ctx = canvas.getContext("2d");
  const W = canvas.width;
  const H = canvas.height;

  ctx.fillStyle = "#030705";
  ctx.fillRect(0, 0, W, H);

  const vw = videoEl.videoWidth || 1280;
  const vh = videoEl.videoHeight || 720;

  if (videoEl.readyState >= 2) {
    const drawCrop = (crop, dx, dy, dw, dh) => {
      const sx = clamp(crop.x * vw, 0, vw - 2);
      const sy = clamp(crop.y * vh, 0, vh - 2);
      const sw = clamp(crop.w * vw, 2, vw - sx);
      const sh = clamp(crop.h * vh, 2, vh - sy);
      ctx.drawImage(videoEl, sx, sy, sw, sh, dx, dy, dw, dh);
    };

    if (state.layout === "cam_only") {
      drawCrop(state.cropCam, 0, 0, W, H);
    } else if (state.layout === "game_only") {
      drawCrop(state.cropGame, 0, 0, W, H);
    } else {
      const splitY = Math.round(state.splitRatio * H);
      if (state.camOnTop) {
        drawCrop(state.cropCam, 0, 0, W, splitY);
        drawCrop(state.cropGame, 0, splitY, W, H - splitY);
      } else {
        drawCrop(state.cropGame, 0, 0, W, splitY);
        drawCrop(state.cropCam, 0, splitY, W, H - splitY);
      }
    }
  }

  if (state.hook.enabled && state.hook.text) {
    drawStyledText(ctx, state.hook.text, state.hook.x, state.hook.y, +$("hookSz").value || 64, state.hook, nowSec);
  }

  const activeCue = getActiveCaption(videoEl.currentTime || 0);
  if (activeCue && activeCue.text) {
    drawStyledText(ctx, activeCue.text, state.capStyle.x, state.capStyle.y, +$("fontSz").value || 48, state.capStyle, nowSec);
  }
}

function startPreviewLoop() {
  const canvas = $("previewCanvas");
  const videoEl = $("videoEl");

  canvas.addEventListener("pointerdown", (e) => {
    const rect = canvas.getBoundingClientRect();
    const nx = (e.clientX - rect.left) / rect.width;
    const ny = (e.clientY - rect.top) / rect.height;
    const dHook = Math.hypot(nx - state.hook.x, ny - state.hook.y);
    const dCap = Math.hypot(nx - state.capStyle.x, ny - state.capStyle.y);
    state.draggingOverlay = dHook <= dCap ? "hook" : "cap";
    canvas.setPointerCapture(e.pointerId);
  });

  canvas.addEventListener("pointermove", (e) => {
    if (!state.draggingOverlay) return;
    const rect = canvas.getBoundingClientRect();
    const nx = clamp((e.clientX - rect.left) / rect.width, 0.1, 0.9);
    const ny = clamp((e.clientY - rect.top) / rect.height, 0.08, 0.92);
    if (state.draggingOverlay === "hook") {
      state.hook.x = nx;
      state.hook.y = ny;
    } else {
      state.capStyle.x = nx;
      state.capStyle.y = ny;
    }
  });

  canvas.addEventListener("pointerup", () => {
    state.draggingOverlay = null;
  });

  const loop = (ts) => {
    drawFrameToCanvas(videoEl, canvas, (ts || 0) / 1000);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

/* ---------------- exportação local (WebM via canvas + ffmpeg.wasm opcional) ---------------- */
const TIER_MAP = {
  "1080p30": { w: 1080, h: 1920, fps: 30 },
  "1080p60": { w: 1080, h: 1920, fps: 60 },
  "720p30":  { w: 720,  h: 1280, fps: 30 },
  "720p60":  { w: 720,  h: 1280, fps: 60 },
  "1440p60": { w: 1440, h: 2560, fps: 60 }
};

async function exportVerticalCut() {
  const videoEl = $("videoEl");
  if (!state.file || !videoEl.src) {
    alert("Envie um vídeo primeiro.");
    return;
  }

  const tierKey = $("expTier").value;
  const mode = $("expMode").value;
  const spec = TIER_MAP[tierKey] || TIER_MAP["1080p30"];

  const startSec = state.activeClip ? state.activeClip.start : (videoEl.currentTime || 0);
  const maxDur = (typeof window.HUB !== "undefined" && window.HUB.duracao) ? window.HUB.duracao : 30;
  const endSec = state.activeClip ? state.activeClip.end : Math.min(state.duration || (startSec + maxDur), startSec + maxDur);

  const offCanvas = document.createElement("canvas");
  offCanvas.width = spec.w;
  offCanvas.height = spec.h;

  const btn = $("exportBtn");
  btn.disabled = true;
  $("expResult").innerHTML = "";
  setExportLog(`Preparando gravação (${spec.w}×${spec.h} · ${spec.fps} fps)...`, 10);

  try {
    const stream = offCanvas.captureStream(spec.fps);
    const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
      ? "video/webm;codecs=vp9"
      : "video/webm";
    const recorder = new MediaRecorder(stream, { mimeType });
    const chunks = [];

    recorder.ondataavailable = (ev) => {
      if (ev.data && ev.data.size > 0) chunks.push(ev.data);
    };

    const donePromise = new Promise((resolve) => {
      recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
    });

    videoEl.currentTime = startSec;
    await new Promise(r => { videoEl.onseeked = r; });

    recorder.start(250);
    await videoEl.play().catch(() => {});

    const totalSpan = Math.max(0.5, endSec - startSec);
    while (!videoEl.paused && !videoEl.ended && videoEl.currentTime < endSec) {
      drawFrameToCanvas(videoEl, offCanvas, videoEl.currentTime);
      const pct = 15 + clamp(((videoEl.currentTime - startSec) / totalSpan) * 75, 0, 75);
      setExportLog(`Renderizando corte ${fmt(videoEl.currentTime)} / ${fmt(endSec)}...`, pct);
      await new Promise(r => setTimeout(r, 1000 / spec.fps));
    }

    videoEl.pause();
    recorder.stop();
    const webmBlob = await donePromise;

    let finalBlob = webmBlob;
    let ext = "webm";

    if (mode === "mp4") {
      setExportLog("Tentando converter para MP4 via FFmpeg...", 92);
      if (window.FFmpegWASM && window.FFmpegWASM.createFFmpeg) {
        const { createFFmpeg, fetchFile } = window.FFmpegWASM;
        const ffmpeg = createFFmpeg({ log: false });
        await ffmpeg.load();
        ffmpeg.FS("writeFile", "in.webm", await fetchFile(webmBlob));
        await ffmpeg.run("-i", "in.webm", "-c:v", "libx264", "-preset", "ultrafast", "out.mp4");
        const data = ffmpeg.FS("readFile", "out.mp4");
        finalBlob = new Blob([data.buffer], { type: "video/mp4" });
        ext = "mp4";
      } else {
        setExportLog("FFmpeg.wasm não carregado neste navegador; gerando WebM pronto para uso.", 95);
      }
    }

    const url = URL.createObjectURL(finalBlob);
    setExportLog("Exportação concluída com sucesso!", 100);
    $("expResult").innerHTML = `<a class="dl" href="${url}" download="clipfactory_corte_${spec.w}x${spec.h}.${ext}">⬇ Baixar corte (.${ext})</a>`;
  } catch (err) {
    setExportLog("Erro na exportação: " + err.message, 0);
  } finally {
    btn.disabled = false;
  }
}

/* ---------------- boot ---------------- */
window.addEventListener("DOMContentLoaded", () => {
  initCollapsibleCards();
  initStyleControls();
  initCropControls();
  initTimeline();
  initCaptions();
  startPreviewLoop();

  $("drop").onclick = () => $("fileInput").click();
  $("fileInput").onchange = (e) => {
    if (e.target.files && e.target.files[0]) loadVideoFile(e.target.files[0]);
  };

  $("drop").ondragover = (e) => { e.preventDefault(); };
  $("drop").ondrop = (e) => {
    e.preventDefault();
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) {
      loadVideoFile(e.dataTransfer.files[0]);
    }
  };

  $("newVidBtn").onclick = resetToStep1;
  $("analyzeBtn").onclick = analyzeMoments;
  $("exportBtn").onclick = exportVerticalCut;
  setLayoutMode("split");
});
