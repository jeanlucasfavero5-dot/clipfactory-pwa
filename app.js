"use strict";

const API_RENDER_URL = "https://clipfactory-serv.onrender.com";
const SUPABASE_URL = "https://ipqjeacdfiomcxfuixdj.supabase.co";

let currentUser = null;
let userDiamonds = 0;
let currentClips = [];
let selectedClipIndex = null;
let userConnections = [];
let isSendingClip = false;
let canvasAnimId = null;

const $ = (id) => document.getElementById(id);

document.addEventListener("DOMContentLoaded", async () => {
  ensureSession();
  bindEvents();
  await refreshWalletAndConnections();
  registerServiceWorker();
});

function ensureSession() {
  const raw = localStorage.getItem("clipfactory_user");
  if (!raw) {
    window.location.href = "./login.html";
    return;
  }
  try {
    currentUser = JSON.parse(raw);
  } catch (_) {
    window.location.href = "./login.html";
    return;
  }
  if (!currentUser || !currentUser.id_jogador) {
    window.location.href = "./login.html";
    return;
  }
  $("userNick").textContent = currentUser.nick || currentUser.id_jogador;
}

async function refreshWalletAndConnections() {
  if (!currentUser) return;
  userDiamonds = await window.ClipWallet.getBalance(currentUser.id_jogador);
  $("userDiamonds").textContent = userDiamonds;
  await fetchSocialConnections();
}

async function fetchSocialConnections() {
  if (!currentUser) return;
  const localKey = `clipfactory_social_${currentUser.id_jogador}`;
  const anonKey = localStorage.getItem("clipfactory_sb_anon_key") || "";

  let loaded = null;
  if (anonKey) {
    try {
      const url = `${SUPABASE_URL}/rest/v1/conexoes_sociais?id_jogador=eq.${encodeURIComponent(currentUser.id_jogador)}&select=*`;
      const resp = await fetch(url, {
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${anonKey}`
        }
      });
      if (resp.ok) {
        const rows = await resp.json();
        if (Array.isArray(rows)) loaded = rows;
      }
    } catch (_) {}
  }

  if (!loaded) {
    const savedLocal = localStorage.getItem(localKey);
    if (savedLocal) {
      try {
        loaded = JSON.parse(savedLocal);
      } catch (_) {}
    }
  }

  if (!Array.isArray(loaded) || loaded.length === 0) {
    loaded = window.ClipPresets.PROVIDERS.map((p) => ({
      id_jogador: currentUser.id_jogador,
      provedor: p.id,
      status: "desconectado",
      conta_nome: null
    }));
  }

  userConnections = loaded;
  localStorage.setItem(localKey, JSON.stringify(userConnections));
}

function bindEvents() {
  const dropZone = $("dropZone");
  const fileInput = $("fileInput");

  dropZone.addEventListener("click", () => fileInput.click());
  dropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropZone.style.borderColor = "var(--acc)";
  });
  dropZone.addEventListener("dragleave", () => {
    dropZone.style.borderColor = "var(--border)";
  });
  dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropZone.style.borderColor = "var(--border)";
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileSelected(e.dataTransfer.files[0]);
    }
  });

  fileInput.addEventListener("change", (e) => {
    if (e.target.files && e.target.files[0]) {
      handleFileSelected(e.target.files[0]);
    }
  });

  $("processBtn").addEventListener("click", generateClipsList);
  $("openManageSocialBtn").addEventListener("click", openManageSocialModal);
  $("closeSocialModal").addEventListener("click", () => $("socialModal").classList.remove("active"));
  $("closeSendModal").addEventListener("click", () => {
    if (!isSendingClip) $("sendModal").classList.remove("active");
  });
  $("confirmSendBtn").addEventListener("click", executeSingleClipSend);

  $("logoutBtn").addEventListener("click", () => {
    localStorage.removeItem("clipfactory_user");
    window.location.href = "./login.html";
  });
}

function handleFileSelected(file) {
  const vid = $("previewVideo");
  const canvas = $("previewCanvas");
  const objectUrl = URL.createObjectURL(file);

  vid.src = objectUrl;
  vid.style.display = "block";
  canvas.style.display = "block";
  vid.load();

  vid.onplay = () => startCanvasLoop(vid, canvas);
  vid.onpause = () => stopCanvasLoop();
  vid.onended = () => stopCanvasLoop();

  const mb = (file.size / (1024 * 1024)).toFixed(2);
  $("statusMessage").textContent = `Arquivo selecionado: ${file.name} (${mb} MB)`;
}

function startCanvasLoop(vid, canvas) {
  stopCanvasLoop();
  const ctx = canvas.getContext("2d");
  const render = () => {
    if (vid.paused || vid.ended) return;
    ctx.drawImage(vid, 0, 0, canvas.width, canvas.height);
    canvasAnimId = requestAnimationFrame(render);
  };
  canvasAnimId = requestAnimationFrame(render);
}

function stopCanvasLoop() {
  if (canvasAnimId !== null) {
    cancelAnimationFrame(canvasAnimId);
    canvasAnimId = null;
  }
}

function generateClipsList() {
  const planKey = $("planSelect").value;
  const planCfg = window.ClipPresets.PLANS[planKey] || window.ClipPresets.PLANS.pack5;
  const linkVal = $("linkInput").value.trim();
  const fileVal = $("fileInput").files[0];

  if (!fileVal && !linkVal) {
    $("statusMessage").textContent = "Selecione um vídeo ou informe um link antes de gerar cortes.";
    return;
  }

  const total = planCfg.count;
  const duration = Number.isFinite($("previewVideo").duration) && $("previewVideo").duration > 0
    ? $("previewVideo").duration
    : total * 15;
  const sliceLen = Math.max(5, Math.floor(duration / total));

  currentClips = Array.from({ length: total }, (_, i) => {
    const startSec = i * sliceLen;
    const endSec = Math.min(Math.floor(duration), startSec + sliceLen);
    return {
      id: `clip_${Date.now()}_${i + 1}`,
      title: `Corte #${i + 1}`,
      startSec,
      endSec,
      score: 72 + ((i * 5) % 24)
    };
  });

  renderClipsList();
}

function renderClipsList() {
  const list = $("clipsList");
  list.innerHTML = "";

  if (!currentClips.length) {
    $("statusMessage").textContent = "Nenhum corte gerado no momento.";
    return;
  }

  $("statusMessage").textContent = `${currentClips.length} corte(s) gerado(s). Envio unitário: 1 vídeo por vez (50 diamantes).`;

  currentClips.forEach((clip, idx) => {
    const card = document.createElement("div");
    card.className = "clip-card";
    card.innerHTML = `
      <div class="clip-header">
        <div>
          <b>#${idx + 1} — ${escapeHtml(clip.title)}</b>
          <div class="clip-meta">Trecho: ${clip.startSec}s até ${clip.endSec}s • Destaque ${clip.score}/100</div>
        </div>
        <span style="color: var(--gold); font-weight: 700; font-size: 12px;">50 💎</span>
      </div>
      <div class="clip-actions">
        <button type="button" class="btn btn-secondary" style="flex: 1;" onclick="previewClipSegment(${idx})">▶ Prévia</button>
        <button type="button" class="btn" style="flex: 2;" onclick="openSendModal(${idx})">🚀 Enviar para Redes</button>
      </div>
    `;
    list.appendChild(card);
  });
}

window.previewClipSegment = function (idx) {
  const clip = currentClips[idx];
  const vid = $("previewVideo");
  if (!clip || !vid || !vid.src) return;
  vid.currentTime = clip.startSec;
  vid.play().catch(() => {});
};

// Abre a tela de envio para redes sociais apenas ao clicar para enviar (1 vídeo por vez)
window.openSendModal = async function (idx) {
  if (isSendingClip) return;
  const clip = currentClips[idx];
  if (!clip) return;

  selectedClipIndex = idx;
  await fetchSocialConnections();

  $("clipTitleInput").value = clip.title;
  $("clipHashtagsInput").value = "#clipfactory #gaming #shorts";

  const listEl = $("sendSocialList");
  listEl.innerHTML = "";

  window.ClipPresets.PROVIDERS.forEach((p) => {
    const conn = userConnections.find((c) => c.provedor === p.id && c.status === "conectado");
    const isConnected = !!conn;

    const row = document.createElement("div");
    row.className = "social-item";
    row.innerHTML = `
      <div>
        <b>${escapeHtml(p.name)}</b>
        <div style="font-size: 11px; color: ${isConnected ? "#4ade80" : "var(--muted)"};">
          ${isConnected ? `Conectado (${escapeHtml(conn.conta_nome || "Conta ativa")})` : "Não conectado"}
        </div>
      </div>
      <input type="checkbox" class="toggle-checkbox" value="${p.id}" ${isConnected ? "checked" : "disabled"}>
    `;
    listEl.appendChild(row);
  });

  $("sendFormContent").style.display = "block";
  $("sendLoader").style.display = "none";
  $("confirmSendBtn").disabled = false;
  $("sendModal").classList.add("active");
};

async function openManageSocialModal() {
  await fetchSocialConnections();
  const listEl = $("manageSocialList");
  listEl.innerHTML = "";

  window.ClipPresets.PROVIDERS.forEach((p) => {
    const conn = userConnections.find((c) => c.provedor === p.id && c.status === "conectado");
    const isConnected = !!conn;

    const row = document.createElement("div");
    row.className = "social-item";
    row.innerHTML = `
      <div>
        <b>${escapeHtml(p.name)}</b>
        <div style="font-size: 11px; color: var(--muted);">
          ${isConnected ? `Conectado • ${escapeHtml(conn.conta_nome || "Conta")}` : "Desconectado"}
        </div>
      </div>
      <button type="button" class="btn ${isConnected ? "btn-secondary" : ""}" style="width: auto; padding: 7px 12px; font-size: 12px;" onclick="toggleProviderConnection('${p.id}', ${isConnected})">
        ${isConnected ? "Desconectar" : "Conectar"}
      </button>
    `;
    listEl.appendChild(row);
  });

  $("socialModal").classList.add("active");
}

window.toggleProviderConnection = async function (providerId, currentlyConnected) {
  const localKey = `clipfactory_social_${currentUser.id_jogador}`;
  const providerObj = window.ClipPresets.PROVIDERS.find((x) => x.id === providerId);
  const label = providerObj ? providerObj.name : providerId;

  let nextStatus = "conectado";
  let accountName = `${currentUser.nick || currentUser.id_jogador} (${label})`;

  if (currentlyConnected) {
    nextStatus = "desconectado";
    accountName = null;
  } else {
    const typed = prompt(`Nome ou identificação da conta para ${label}:`, accountName);
    if (typed === null) return;
    accountName = typed.trim() || accountName;
  }

  const idx = userConnections.findIndex((c) => c.provedor === providerId);
  const updatedEntry = {
    id_jogador: currentUser.id_jogador,
    provedor: providerId,
    status: nextStatus,
    conta_nome: accountName,
    updated_at: new Date().toISOString()
  };

  if (idx >= 0) userConnections[idx] = { ...userConnections[idx], ...updatedEntry };
  else userConnections.push(updatedEntry);

  localStorage.setItem(localKey, JSON.stringify(userConnections));

  const anonKey = localStorage.getItem("clipfactory_sb_anon_key") || "";
  if (anonKey) {
    try {
      await fetch(`${SUPABASE_URL}/rest/v1/conexoes_sociais?on_conflict=id_jogador,provedor`, {
        method: "POST",
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${anonKey}`,
          "Content-Type": "application/json",
          Prefer: "resolution=merge-duplicates,return=representation"
        },
        body: JSON.stringify(updatedEntry)
      });
    } catch (_) {}
  }

  await openManageSocialModal();
};

async function executeSingleClipSend() {
  if (isSendingClip || selectedClipIndex === null) return;

  const clip = currentClips[selectedClipIndex];
  if (!clip) return;

  const cost = window.ClipPresets.SEND_COST_DIAMONDS || 50;
  userDiamonds = await window.ClipWallet.getBalance(currentUser.id_jogador);
  $("userDiamonds").textContent = userDiamonds;

  if (userDiamonds < cost) {
    alert(`Saldo insuficiente! Você precisa de ${cost} diamantes para enviar este vídeo.`);
    return;
  }

  const selectedNetworks = Array.from(
    document.querySelectorAll("#sendSocialList .toggle-checkbox:checked")
  ).map((el) => el.value);

  if (!selectedNetworks.length) {
    alert("Ative pelo menos uma rede social conectada para enviar este vídeo.");
    return;
  }

  const editedTitle = ($("clipTitleInput").value || "").trim() || clip.title;
  const hashtags = ($("clipHashtagsInput").value || "").trim();

  clip.title = editedTitle;
  renderClipsList();

  const fileInput = $("fileInput");
  const chosenFile = fileInput.files && fileInput.files[0] ? fileInput.files[0] : null;
  const isMp4 = chosenFile && (chosenFile.type === "video/mp4" || /\.mp4$/i.test(chosenFile.name || ""));

  if (!isMp4) {
    alert("O envio para redes exige um arquivo de vídeo no formato MP4 (.mp4).");
    return;
  }

  isSendingClip = true;
  $("confirmSendBtn").disabled = true;
  $("sendFormContent").style.display = "none";
  $("sendLoader").style.display = "flex";
  $("sendLoaderSub").textContent = `Enviando "${editedTitle}" para ${selectedNetworks.join(", ")}...`;

  const formData = new FormData();
  formData.append("playerId", currentUser.id_jogador);
  formData.append("title", editedTitle);
  formData.append("hashtags", hashtags);
  formData.append("networks", JSON.stringify(selectedNetworks));
  formData.append("video", chosenFile, chosenFile.name);

  try {
    const resp = await fetch(`${API_RENDER_URL}/api/publish-clip`, {
      method: "POST",
      body: formData
    });
    const data = await resp.json().catch(() => ({}));

    if (!resp.ok || !data.ok) {
      throw new Error(data.error || `Falha no envio (${resp.status})`);
    }

    const debit = await window.ClipWallet.debitDiamonds(currentUser.id_jogador, cost);
    if (!debit.ok) {
      throw new Error(debit.error || "Não foi possível debitar os 50 diamantes.");
    }

    userDiamonds = debit.balance;
    $("userDiamonds").textContent = userDiamonds;

    $("sendLoaderSub").textContent = "Concluído! Fechando tela de envio...";
    setTimeout(() => {
      isSendingClip = false;
      $("confirmSendBtn").disabled = false;
      $("sendLoader").style.display = "none";
      $("sendFormContent").style.display = "block";
      $("sendModal").classList.remove("active");
    }, 650);
  } catch (err) {
    isSendingClip = false;
    $("confirmSendBtn").disabled = false;
    $("sendLoader").style.display = "none";
    $("sendFormContent").style.display = "block";
    alert(`Erro ao enviar vídeo: ${err.message || "Falha na comunicação com o servidor"}`);
  }
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
}

function escapeHtml(str) {
  return String(str || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
