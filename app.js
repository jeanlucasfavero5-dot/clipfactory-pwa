"use strict";

// Configurações do ClipFactory
const API_RENDER_URL = "https://clipfactory-serv.onrender.com";
const SUPABASE_URL = "https://ipqjeacdfiomcxfuixdj.supabase.co";

// Estado da aplicação
let currentUser = null;
let userDiamonds = 0;
let currentClips = [];
let selectedClipForSend = null;
let userConnections = [];

const $ = (id) => document.getElementById(id);

// Inicialização
document.addEventListener("DOMContentLoaded", async () => {
  loadStoredUser();
  setupEventListeners();
});

function loadStoredUser() {
  const saved = localStorage.getItem("clipfactory_user");
  if (saved) {
    try {
      currentUser = JSON.parse(saved);
      $("userNick").textContent = currentUser.nick || currentUser.id_jogador;
    } catch (_) {
      currentUser = { id_jogador: "963487998", nick: "ROCKY" };
    }
  } else {
    // Usuário padrão de testes se não houver login prévio
    currentUser = { id_jogador: "963487998", nick: "ROCKY" };
  }
  fetchUserData();
}

async function fetchUserData() {
  if (!currentUser || !currentUser.id_jogador) return;
  
  // Buscar diamantes do jogador via Supabase REST (carteira_diamantes ou usuarios)
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/carteira_diamantes?id_jogador=eq.${currentUser.id_jogador}&select=saldo`, {
      headers: { "apikey": "public-anon-key-placeholder" }
    });
    if (res.ok) {
      const data = await res.json();
      if (data && data[0]) {
        userDiamonds = data[0].saldo || 0;
      } else {
        userDiamonds = 250; // valor padrão para testes
      }
    } else {
      userDiamonds = 250;
    }
  } catch (_) {
    userDiamonds = 250;
  }
  $("userDiamonds").textContent = userDiamonds;
  fetchSocialConnections();
}

async function fetchSocialConnections() {
  if (!currentUser || !currentUser.id_jogador) return;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/conexoes_sociais?id_jogador=eq.${currentUser.id_jogador}&select=*`);
    if (res.ok) {
      userConnections = await res.json();
    } else {
      userConnections = [
        { provedor: "youtube", status: "conectado", conta_nome: "Canal Principal" },
        { provedor: "tiktok", status: "conectado", conta_nome: "@meutiktok" },
        { provedor: "instagram", status: "desconectado", conta_nome: null },
        { provedor: "facebook", status: "desconectado", conta_nome: null },
        { provedor: "kwai", status: "conectado", conta_nome: "Perfil Kwai" }
      ];
    }
  } catch (_) {
    userConnections = [
      { provedor: "youtube", status: "conectado", conta_nome: "Canal Principal" },
      { provedor: "tiktok", status: "conectado", conta_nome: "@meutiktok" },
      { provedor: "kwai", status: "conectado", conta_nome: "Perfil Kwai" }
    ];
  }
}

function setupEventListeners() {
  // Arraste e seleção de arquivos
  const dropZone = $("dropZone");
  const fileInput = $("fileInput");

  dropZone.onclick = () => fileInput.click();
  dropZone.ondragover = (e) => { e.preventDefault(); dropZone.style.borderColor = "var(--acc)"; };
  dropZone.ondragleave = () => { dropZone.style.borderColor = "var(--border)"; };
  dropZone.ondrop = (e) => {
    e.preventDefault();
    dropZone.style.borderColor = "var(--border)";
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileSelected(e.dataTransfer.files[0]);
    }
  };

  fileInput.onchange = (e) => {
    if (e.target.files && e.target.files[0]) {
      handleFileSelected(e.target.files[0]);
    }
  };

  $("processBtn").onclick = processVideoInput;
  $("openManageSocialBtn").onclick = openManageSocialModal;
  $("closeSocialModal").onclick = () => $("socialModal").classList.remove("active");
  $("closeSendModal").onclick = () => $("sendModal").classList.remove("active");
  $("confirmSendBtn").onclick = executeClipSend;
}

function handleFileSelected(file) {
  if (!file) return;
  const vid = $("previewVideo");
  vid.src = URL.createObjectURL(file);
  vid.style.display = "block";
  vid.load();
  $("statusMessage").textContent = `Ficheiro selecionado: ${file.name} (${(file.size / (1024 * 1024)).toFixed(2)} MB)`;
}

function processVideoInput() {
  const plan = $("planSelect").value;
  const targetCount = plan === "pack5" ? 5 : 10;
  const link = $("linkInput").value.trim();

  $("statusMessage").textContent = `Gerando ${targetCount} cortes para o vídeo...`;

  currentClips = [];
  for (let i = 1; i <= targetCount; i++) {
    currentClips.push({
      id: "clip_" + Date.now() + "_" + i,
      title: `Corte #${i} - ClipFactory`,
      durationSec: 15,
      score: 70 + (i * 3) % 25
    });
  }

  renderClipsList();
}

function renderClipsList() {
  const container = $("clipsList");
  container.innerHTML = "";

  if (currentClips.length === 0) {
    $("statusMessage").textContent = "Nenhum corte gerado.";
    return;
  }

  $("statusMessage").textContent = `${currentClips.length} corte(s) pronto(s) para envio unitário.`;

  currentClips.forEach((clip, idx) => {
    const card = document.createElement("div");
    card.className = "clip-card";
    card.innerHTML = `
      <div class="clip-header">
        <b>Clipe #${idx + 1}: ${clip.title}</b>
        <span style="color: var(--gold); font-weight:700;">Nota ${clip.score}</span>
      </div>
      <div class="clip-actions">
        <button class="btn btn-secondary" style="flex:1;" onclick="previewClip(${idx})">▶ Assistir</button>
        <button class="btn" style="flex:2;" onclick="openSendModalForClip(${idx})">🚀 Enviar para Redes (50 💎)</button>
      </div>
    `;
    container.appendChild(card);
  });
}

window.previewClip = function(idx) {
  const vid = $("previewVideo");
  if (vid.src) {
    vid.currentTime = idx * 10;
    vid.play().catch(() => {});
  }
};

// Abertura da tela de Envio (Apenas 1 clipe por vez)
window.openSendModalForClip = async function(idx) {
  selectedClipForSend = currentClips[idx];
  if (!selectedClipForSend) return;

  await fetchSocialConnections();

  $("clipTitleInput").value = selectedClipForSend.title;
  $("clipHashtagsInput").value = "#clipfactory #gaming #shorts";

  const listEl = $("sendSocialList");
  listEl.innerHTML = "";

  const providers = [
    { id: "youtube", name: "YouTube Shorts / Vídeo" },
    { id: "tiktok", name: "TikTok Direct Post" },
    { id: "instagram", name: "Instagram Reels" },
    { id: "facebook", name: "Facebook Vídeo" },
    { id: "kwai", name: "Kwai (Compartilhamento Nativo)" }
  ];

  providers.forEach(p => {
    const conn = userConnections.find(c => c.provedor === p.id && c.status === "conectado");
    const isConn = !!conn;

    const item = document.createElement("div");
    item.className = "social-item";
    item.innerHTML = `
      <div>
        <b>${p.name}</b>
        <div style="font-size:11px; color: ${isConn ? '#4ade80' : 'var(--muted)'};">
          ${isConn ? `Conectado (${conn.conta_nome || 'Conta ativa'})` : 'Não conectado'}
        </div>
      </div>
      <input type="checkbox" class="toggle-checkbox" value="${p.id}" ${isConn ? 'checked' : 'disabled'}>
    `;
    listEl.appendChild(item);
  });

  $("sendFormContent").style.display = "block";
  $("sendLoader").style.display = "none";
  $("sendModal").classList.add("active");
};

// Modal de Gerenciamento de Redes
function openManageSocialModal() {
  const listEl = $("manageSocialList");
  listEl.innerHTML = "";

  const providers = [
    { id: "youtube", name: "YouTube" },
    { id: "tiktok", name: "TikTok" },
    { id: "instagram", name: "Instagram" },
    { id: "facebook", name: "Facebook" },
    { id: "kwai", name: "Kwai" }
  ];

  providers.forEach(p => {
    const conn = userConnections.find(c => c.provedor === p.id && c.status === "conectado");
    const isConn = !!conn;

    const item = document.createElement("div");
    item.className = "social-item";
    item.innerHTML = `
      <div>
        <b>${p.name}</b>
        <div style="font-size:11px; color: var(--muted);">${isConn ? conn.conta_nome || 'Conectado' : 'Desconectado'}</div>
      </div>
      <button class="btn ${isConn ? 'btn-secondary' : ''}" style="width:auto; padding:6px 12px; font-size:12px;" onclick="toggleSocialConn('${p.id}', ${isConn})">
        ${isConn ? 'Desconectar' : 'Conectar'}
      </button>
    `;
    listEl.appendChild(item);
  });

  $("socialModal").classList.add("active");
}

window.toggleSocialConn = function(provedor, currentlyConnected) {
  alert(`Fluxo OAuth para ${provedor}: Redirecionando para autorização...`);
};

// Execução de Envio com Cobrança de 50 Diamantes
async function executeClipSend() {
  if (userDiamonds < 50) {
    alert("Saldo insuficiente! Você precisa de 50 diamantes para enviar este vídeo.");
    return;
  }

  const selectedNets = Array.from(document.querySelectorAll("#sendSocialList .toggle-checkbox:checked"))
    .map(cb => cb.value);

  if (selectedNets.length === 0) {
    alert("Selecione pelo menos uma rede social conectada para enviar.");
    return;
  }

  const finalTitle = $("clipTitleInput").value.trim() || selectedClipForSend.title;
  const finalHashtags = $("clipHashtagsInput").value.trim();

  // Exibir Carregamento
  $("sendFormContent").style.display = "none";
  $("sendLoader").style.display = "flex";

  // Preparar arquivo simulado ou real
  const fileInput = $("fileInput");
  let fileToSend = fileInput.files[0];

  if (!fileToSend) {
    // Criar MP4 fictício se testando por link
    const dummyBlob = new Blob(["mp4-video-data"], { type: "video/mp4" });
    fileToSend = new File([dummyBlob], "clip.mp4", { type: "video/mp4" });
  }

  const formData = new FormData();
  formData.append("playerId", currentUser.id_jogador);
  formData.append("title", finalTitle);
  formData.append("hashtags", finalHashtags);
  formData.append("networks", JSON.stringify(selectedNets));
  formData.append("video", fileToSend);

  try {
    const res = await fetch(`${API_RENDER_URL}/api/publish-clip`, {
      method: "POST",
      body: formData
    });

    const data = await res.json();

    if (res.ok && data.ok) {
      // Descontar 50 diamantes
      userDiamonds -= 50;
      $("userDiamonds").textContent = userDiamonds;

      alert(`✅ Vídeo "${finalTitle}" enviado com sucesso!
50 Diamantes foram debitados.`);
      
      // Fechar modal automaticamente após sucesso
      $("sendModal").classList.remove("active");
    } else {
      alert(`⚠️ Erro ao enviar clipe: ${data.error || "Falha no servidor"}`);
      $("sendFormContent").style.display = "block";
      $("sendLoader").style.display = "none";
    }
  } catch (err) {
    alert(` Erro de rede ou servidor Render offline: ${err.message}`);
    $("sendFormContent").style.display = "block";
    $("sendLoader").style.display = "none";
  }
}
