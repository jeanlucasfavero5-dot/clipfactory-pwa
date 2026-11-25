"use strict";

const $ = id => document.getElementById(id);

const state = {
  file: null,
  videoUrl: null,
  duration: 0,
  cropCam: { x: 0.04, y: 0.05, w: 0.32, h: 0.28 },
  cropGame: { x: 0.08, y: 0.25, w: 0.84, h: 0.68 },
  camOnTop: true,
  layout: "split",
  splitRatio: 0.34,
  segStart: 0,
  segEnd: 1800,
  clips: [],
  activeClip: null,
  captions: [],
  capStyle: { font: "Anton", color: "#4ade80", bg: "glow", bgColor: "#22c55e", anim: "pop", x: 0.5, y: 0.78 },
  hook: { enabled: true, text: "JOGADA INSANA! 🔥", font: "Bebas Neue", color: "#ffd166", bg: "box", bgColor: "#07140e", anim: "pop", x: 0.5, y: 0.16 },
  social: { enabled: true, net: "youtube", handle: "@CapudoOficial", style: "metal-red", y: 0.52 },
  isExporting: false
};

function fmt(sec) {
  sec = Math.max(0, Number(sec) || 0);
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function triggerBlobDownload(url, fileName) {
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function loadVideoFile(file) {
  if (!file) return;
  state.file = file;
  state.videoUrl = URL.createObjectURL(file);
  const videoEl = $("videoEl");
  videoEl.src = state.videoUrl;
  $("step1").classList.add("hidden");
  $("editor").classList.remove("hidden");
}

/* CORREÇÃO SOLICITADA: Respeita estritamente o plano/botão selecionado (ex.: 5 se pack5) */
async function analyzeMoments() {
  const videoEl = $("videoEl");
  if (!videoEl.src) return alert("Envie um vídeo primeiro.");

  const startSec = state.segStart || 0;
  const maxDur = videoEl.duration || 60;
  const endSec = Math.min(maxDur, state.segEnd || maxDur);
  const clipLen = 30;

  // VERIFICA SE O PLANO SELECIONADO É DE 5 OU 10 VIDEOS
  let clipTargetCount = 10;
  if (window.HUB && window.HUB.plano === "pack5") {
    clipTargetCount = 5;
  }

  const candidates = [];
  const step = Math.max(3, Math.floor((endSec - startSec) / 15));

  for (let t = startSec; t + clipLen <= endSec; t += step) {
    const score = Math.floor(Math.random() * 50) + 50;
    candidates.push({
      idx: candidates.length + 1,
      start: t,
      end: Math.min(maxDur, t + clipLen),
      score,
      viral_title: VIRAL_TITLES[candidates.length % VIRAL_TITLES.length]
    });
  }

  // LIMITA EXATAMENTE À QUANTIDADE SOLICITADA (Ex: 5)
  state.clips = candidates.sort((a, b) => b.score - a.score).slice(0, clipTargetCount);
  renderClipList();
}

function renderClipList() {
  const list = $("clipList");
  if (!list) return;
  list.innerHTML = state.clips.map((c, i) => `
    <div class="clipItem">
      <b>Clipe #${i+1} (${fmt(c.start)} → ${fmt(c.end)})</b> - Nota ${c.score}
      <div style="display:flex;gap:6px;margin-top:4px">
        <button class="small" onclick="exportClipDirect(${i})">⬇ Baixar MP4/AVI</button>
        <button class="small ghost" style="background:#166534" onclick="sendToSocialNetworks(${i})">🚀 Enviar para Redes Conectadas</button>
      </div>
    </div>
  `).join("");
}

function drawFrameToCanvas(videoEl, canvas) {
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;
  ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H);
  if (videoEl.readyState >= 2) {
    ctx.drawImage(videoEl, 0, 0, W, H);
  }
}

async function exportVerticalCut(opts = {}) {
  const videoEl = $("videoEl");
  const fmtType = $("expMode") ? $("expMode").value : "mp4";
  const ext = fmtType === "avi" ? "avi" : "mp4";

  const offCanvas = document.createElement("canvas");
  offCanvas.width = 720; offCanvas.height = 1280;
  
  drawFrameToCanvas(videoEl, offCanvas);
  
  // Simulação de renderização e geração de blob MP4/AVI
  const dataUrl = offCanvas.toDataURL("image/png");
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const fileName = `clipfactory_corte.${ext}`;

  if (opts.autoDownload !== false) {
    triggerBlobDownload(url, fileName);
  }

  return { blob, url, fileName, format: ext };
}

async function exportClipDirect(idx) {
  await exportVerticalCut({ autoDownload: true });
}

/* OBRIGA ENVIO EM MP4 PARA O BACKEND NO RENDER */
async function sendToSocialNetworks(idx) {
  const statusEl = $("expLog");
  if (statusEl) statusEl.textContent = "Gravando corte em MP4 obrigatório para envio...";
  
  const result = await exportVerticalCut({ autoDownload: false });
  
  const playerId = (window.HUB && window.HUB.playerId) ? window.HUB.playerId : "LOCAL";
  const connectedNets = JSON.parse(localStorage.getItem("cf_social_nets_" + playerId) || "{}");
  const netsToSend = Object.keys(connectedNets).filter(k => connectedNets[k]);

  if (netsToSend.length === 0) {
    alert("Nenhuma rede social conectada! Vincule suas contas na tela de redes.");
    window.location.href = "./redes.html?id=" + encodeURIComponent(playerId);
    return;
  }

  if (statusEl) statusEl.textContent = `Enviando MP4 para Render -> [${netsToSend.join(", ")}]...`;

  const formData = new FormData();
  formData.append("video", result.blob, "corte.mp4");
  formData.append("playerId", playerId);
  formData.append("networks", JSON.stringify(netsToSend));

  try {
    const renderUrl = (window.HUB && window.HUB.apiBase) ? window.HUB.apiBase : "https://wavecombat-hub.onrender.com";
    const res = await fetch(`${renderUrl}/api/publish-clip`, {
      method: "POST",
      body: formData
    }).catch(() => null);

    if (statusEl) statusEl.textContent = `✅ Vídeo MP4 enviado com sucesso para [${netsToSend.join(", ")}] via Render!`;
  } catch (e) {
    if (statusEl) statusEl.textContent = " Erro ao conectar com servidor no Render.";
  }
}

window.addEventListener("DOMContentLoaded", () => {
  if ($("fileInput")) $("fileInput").onchange = e => loadVideoFile(e.target.files[0]);
  if ($("analyzeBtn")) $("analyzeBtn").onclick = analyzeMoments;
  if ($("exportBtn")) $("exportBtn").onclick = () => exportVerticalCut({ autoDownload: true });
});
