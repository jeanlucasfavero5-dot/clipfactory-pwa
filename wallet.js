/* ============================================================
   Integração Hub WaveCombat — Supabase + Carteira de Diamantes + PWA
   Planos: 5 clipes 💎100 · 10 clipes 💎200 · Assinatura 7 dias 💎1000 (20 clipes/dia)
   Duração dos clipes: 30s ou 60s. Preços e cobrança SEMPRE confirmados no backend.
   ============================================================ */
"use strict";

const SUPABASE_URL = "https://ipqjeacdfiomcxfuixdj.supabase.co";
const SUPABASE_KEY = "sb_publishable_EWW84q_43YbOvMwB_Rua-A_X465PbLP";

const PLANOS = {
  pack5:  { label: "5 clipes",          custo: 100,  n: 5,  desc: "cortes avulsos" },
  pack10: { label: "10 clipes",         custo: 200,  n: 10, desc: "cortes avulsos" },
  weekly: { label: "Assinatura 7 dias", custo: 1000, n: 20, desc: "20 clipes/dia · 2K 60fps" },
};

function resolveInitialPlayerId() {
  const fromUrl = new URLSearchParams(window.location.search).get("id");
  if (fromUrl) return String(fromUrl);
  try {
    const raw = sessionStorage.getItem("cf_session_user");
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.id_jogador && parsed.id_jogador !== "LOCAL") {
        return String(parsed.id_jogador);
      }
    }
  } catch (e) {}
  return null;
}

const HUB = {
  playerId: resolveInitialPlayerId(),
  apiBase: new URLSearchParams(window.location.search).get("api") || "https://clipfactory-api.onrender.com",
  supabase: null,
  nick: null,
  diamantes: null,
  plano: new URLSearchParams(window.location.search).get("plano") || "pack5",
  duracao: 30,
  activeJobId: null,
  activeJobStatus: null,
  pollTimer: null,
  deferredInstallPrompt: null,
};

function setupPwaInstall() {
  const btn = document.getElementById("installPwaBtn");
  if (!btn) return;

  window.addEventListener("beforeinstallprompt", e => {
    e.preventDefault();
    HUB.deferredInstallPrompt = e;
    btn.classList.remove("hidden");
  });

  btn.addEventListener("click", async () => {
    if (!HUB.deferredInstallPrompt) return;
    HUB.deferredInstallPrompt.prompt();
    await HUB.deferredInstallPrompt.userChoice.catch(() => null);
    HUB.deferredInstallPrompt = null;
    btn.classList.add("hidden");
  });

  window.addEventListener("appinstalled", () => {
    HUB.deferredInstallPrompt = null;
    btn.classList.add("hidden");
    renderWalletBar("📲 ClipFactory instalado no dispositivo!", "ok");
  });
}

function renderWalletBar(msg, kind) {
  let bar = document.getElementById("walletBar");
  if (!bar) {
    bar = document.createElement("div");
    bar.id = "walletBar";
    const header = document.querySelector("header");
    if (header) header.after(bar);
  }
  if (!bar) return;

  if (!HUB.playerId) {
    bar.innerHTML = `<span style="color:var(--muted)">🔓 Modo local — sem jogador do Hub (?id= na URL ou sessão). A cobrança em diamantes só funciona integrado ao Hub.</span>`;
    return;
  }

  const saldo = HUB.diamantes === null ? "…" : `💎 <b style="color:#ffd166">${HUB.diamantes}</b>`;
  bar.innerHTML = `
    <span>👤 <b>${HUB.nick ?? "carregando…"}</b> <span style="color:var(--muted)">(ID ${HUB.playerId})</span></span>
    <span style="margin-left:auto">${saldo} diamantes
      <button class="ghost small" id="walletRefresh" style="margin-left:8px">↻</button></span>
    ${msg ? `<span style="color:${kind === "err" ? "var(--bad)" : "var(--good)"}">${msg}</span>` : ""}`;
  document.getElementById("walletRefresh").onclick = loadWallet;
}

async function loadWallet() {
  if (!HUB.playerId) return;
  try {
    HUB.supabase = HUB.supabase || window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    const sb = HUB.supabase;
    const [u, w] = await Promise.all([
      sb.from("usuarios").select("nick").eq("id_jogador", HUB.playerId).maybeSingle(),
      sb.from("carteira_diamantes").select("diamantes").eq("id_jogador", HUB.playerId).maybeSingle(),
    ]);
    if (u.error || w.error) throw new Error(u.error?.message || w.error?.message);
    HUB.nick = u.data?.nick ?? `Jogador ${HUB.playerId}`;
    HUB.diamantes = Number(w.data?.diamantes ?? 0);
    renderWalletBar();
    updateHubButton();
  } catch (e) {
    console.error("wallet:", e);
    renderWalletBar("⚠️ Erro ao carregar carteira: " + e.message, "err");
  }
}

async function injectPremiumPanel(col) {
  if (!HUB.playerId || document.getElementById("premiumPanel")) return;
  const card = document.createElement("div");
  card.className = "card";
  card.id = "premiumPanel";
  card.innerHTML = `
    <div class="card-h"><h2>⭐ Meu plano semanal</h2><button class="collapse-btn">▾</button></div>
    <div class="card-body"><div id="premiumBody" class="signal">carregando…</div></div>`;
  col.prepend(card);
  card.querySelector(".card-h").addEventListener("click", (e) => {
    if (e.target.closest("button")) return;
    card.classList.toggle("collapsed");
    card.querySelector(".collapse-btn").textContent = card.classList.contains("collapsed") ? "▸" : "▾";
  });
  await refreshPremiumPanel();
}

async function refreshPremiumPanel() {
  const body = document.getElementById("premiumBody");
  if (!body || !HUB.playerId) return;
  try {
    const r = await fetch(`${HUB.apiBase}/api/subscription?id_jogador=${encodeURIComponent(HUB.playerId)}`);
    const s = await r.json();
    if (!s.ativa) {
      body.innerHTML = `<p class="signal">Nenhum plano semanal ativo. Ative para ter <b>20 clipes/dia por 7 dias</b>, <b>2K 60 fps</b> e downloads liberados.</p>
        <button id="renovarWeeklyBtn" style="width:100%;margin-top:8px">⭐ Ativar 7 dias (💎 ${PLANOS.weekly.custo})</button>`;
      body.querySelector("#renovarWeeklyBtn").onclick = subscribeWeekly;
      return;
    }
    const fim = new Date(s.fim);
    const dias = Math.max(0, Math.ceil((fim - Date.now()) / 86400000));
    const restantes = Math.max(0, s.limite_diario - (s.clipes_hoje || 0));
    body.innerHTML = `
      <span class="badgePremium">⭐ PREMIUM ATIVO</span>
      <div class="stat">
        <div><b>${restantes}</b>clipes disponíveis hoje</div>
        <div><b>${dias}</b>dias restantes</div>
        <div><b>${s.clipes_hoje || 0}/${s.limite_diario}</b>usados hoje</div>
      </div>
      <p class="signal">Plano válido até <b>${fim.toLocaleDateString("pt-BR")} ${fim.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</b>.</p>
      <button id="renovarWeeklyBtn" style="width:100%">🔄 Renovar +7 dias (💎 ${PLANOS.weekly.custo})</button>`;
    body.querySelector("#renovarWeeklyBtn").onclick = subscribeWeekly;
  } catch (e) {
    body.innerHTML = `<span style="color:var(--muted)">Assinatura indisponível no momento (${e.message}).</span>`;
  }
}

async function subscribeWeekly() {
  if (!confirm(`Ativar/renovar o plano semanal por 💎 ${PLANOS.weekly.custo}? A cobrança é feita no servidor.`)) return;
  try {
    const r = await fetch(`${HUB.apiBase}/api/subscribe/weekly`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id_jogador: HUB.playerId }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.detail || "Falha ao ativar");
    renderWalletBar("⭐ Plano semanal ativo!", "ok");
    refreshPremiumPanel();
    loadWallet();
    document.getElementById("hubCard")?.remove();
    injectHubCard();
  } catch (e) {
    renderWalletBar("❌ " + e.message, "err");
  }
}

function injectHubCard() {
  if (!HUB.playerId) return;
  const col = document.querySelector("#editor > div:last-child");
  if (!col || document.getElementById("hubCard")) return;
  injectPremiumPanel(col);
  const card = document.createElement("div");
  card.className = "card";
  card.id = "hubCard";
  card.innerHTML = `
    <div class="card-h"><h2>💎 Hub WaveCombat — escolha seu plano</h2><button class="collapse-btn">▾</button></div>
    <div class="card-body">
      <div id="planCards" style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin:8px 0">
        ${Object.entries(PLANOS).map(([k, p]) => `
          <div class="planCard" data-plan="${k}" style="cursor:pointer;border:1px solid var(--border);border-radius:12px;padding:10px;text-align:center;background:var(--panel2)">
            <div style="font-weight:800;font-size:13px">${k === "weekly" ? "⭐" : "🎬"} ${p.label}</div>
            <div style="font-size:18px;font-weight:900;color:#ffd166;margin:4px 0">💎 ${p.custo}</div>
            <div class="signal">${p.desc}</div>
          </div>`).join("")}
      </div>
      <label>Duração de cada clipe</label>
      <div class="row" style="gap:8px">
        <button class="ghost small durBtn" data-dur="30" style="flex:1">⏱ 30 segundos</button>
        <button class="ghost small durBtn" data-dur="60" style="flex:1">⏱ 60 segundos</button>
      </div>
      <div class="row" style="margin-top:10px">
        <button id="hubStartBtn" style="flex:1">🎬 Iniciar cortes</button>
        <button class="ghost small" id="hubJobStatusBtn" style="flex:0 0 auto">🔄 Status</button>
      </div>
      <div id="hubJobInfo" class="signal" style="margin-top:8px"></div>
      <div id="hubClips" style="margin-top:8px"></div>
    </div>`;
  col.insertBefore(card, col.children[1] || null);

  card.querySelector(".card-h").addEventListener("click", e => {
    if (e.target.closest("#hubStartBtn,#hubJobStatusBtn,button")) return;
    card.classList.toggle("collapsed");
    card.querySelector(".collapse-btn").textContent = card.classList.contains("collapsed") ? "▸" : "▾";
  });
  card.querySelectorAll(".planCard").forEach(pc => pc.onclick = () => {
    HUB.plano = pc.dataset.plan;
    card.querySelectorAll(".planCard").forEach(x => x.style.borderColor = "var(--border)");
    pc.style.borderColor = "var(--accent)";
    updateHubButton();
  });
  card.querySelector(`.planCard[data-plan="${HUB.plano}"]`).style.borderColor = "var(--accent)";
  card.querySelectorAll(".durBtn").forEach(b => b.onclick = () => {
    HUB.duracao = +b.dataset.dur;
    card.querySelectorAll(".durBtn").forEach(x => x.style.borderColor = "var(--border)");
    b.style.borderColor = "var(--accent)";
    updateHubButton();
  });
  card.querySelector(`.durBtn[data-dur="${HUB.duracao}"]`).style.borderColor = "var(--accent)";
  document.getElementById("hubStartBtn").onclick = startHubJob;
  document.getElementById("hubJobStatusBtn").onclick = () => HUB.activeJobId && pollJob(HUB.activeJobId);
  updateHubButton();
}

function planoSel() { return PLANOS[HUB.plano] || PLANOS.pack5; }

function updateHubButton() {
  const btn = document.getElementById("hubStartBtn");
  if (!btn) return;
  const hasSource = !!(typeof state !== "undefined" && state.file);
  const already = HUB.activeJobId && ["processing", "queued"].includes(HUB.activeJobStatus || "");
  btn.disabled = !hasSource || !!already;
  btn.textContent = already
    ? "⏳ Job em andamento…"
    : hasSource ? `🎬 Gerar ${planoSel().n} clipes de ${HUB.duracao}s (💎 ${planoSel().custo})` : "🎬 Envie um vídeo primeiro";
}

async function startHubJob() {
  const info = document.getElementById("hubJobInfo");
  const btn = document.getElementById("hubStartBtn");
  try {
    btn.disabled = true;
    info.innerHTML = "▸ Verificando saldo e criando job… (a cobrança é confirmada no servidor antes de processar)";

    const body = {
      cam_region: state.cropCam,
      game_region: state.cropGame,
      cam_on_top: state.camOnTop,
      layout: state.layout,
      split_ratio: state.splitRatio,
      segment_start: state.segStart || null,
      segment_end: state.segEnd || null,
      top_n: planoSel().n,
      plan: HUB.plano,
      clip_duration: HUB.duracao,
      hook: {
        text: state.hook.text, font: state.hook.font, color: state.hook.color,
        size: +document.getElementById("hookSz").value, style: state.hook.bg, bg_color: state.hook.bgColor,
        x: state.hook.x, y: state.hook.y
      },
      cap_style: {
        font: state.capStyle.font, color: state.capStyle.color,
        size: +document.getElementById("fontSz").value, style: state.capStyle.bg, bg_color: state.capStyle.bgColor,
        x: state.capStyle.x, y: state.capStyle.y
      },
    };

    const fd = new FormData();
    fd.append("file", state.file, state.file.name);
    fd.append("id_jogador", HUB.playerId);
    fd.append("plan", HUB.plano);
    fd.append("clip_duration", String(HUB.duracao));
    fd.append("hook", JSON.stringify(body.hook));
    fd.append("params", JSON.stringify(body));
    const res = await fetch(`${HUB.apiBase}/api/jobs/upload`, { method: "POST", body: fd });

    if (res.status === 402) {
      const j = await res.json().catch(() => ({}));
      renderWalletBar("❌ Saldo insuficiente de diamantes", "err");
      info.innerHTML = `<span style="color:var(--bad)">❌ ${j.detail || "Saldo insuficiente para o plano escolhido."}</span>`;
      btn.disabled = false;
      return;
    }
    if (!res.ok) throw new Error("API " + res.status + ": " + (await res.text()).slice(0, 200));

    const job = await res.json();
    HUB.activeJobId = job.id;
    HUB.activeJobStatus = job.status;
    info.innerHTML = `▸ Job <b>${job.id}</b> criado — plano ${planoSel().label} (💎 ${planoSel().custo}).`;
    loadWallet();
    pollJob(job.id);
  } catch (e) {
    console.error(e);
    info.innerHTML = `<span style="color:var(--bad)">✖ ${e.message}</span>`;
    btn.disabled = false;
  }
}

async function pollJob(id) {
  const info = document.getElementById("hubJobInfo");
  const clipsEl = document.getElementById("hubClips");
  clearTimeout(HUB.pollTimer);
  const tick = async () => {
    try {
      const r = await fetch(`${HUB.apiBase}/api/jobs/${id}`);
      if (!r.ok) throw new Error("API " + r.status);
      const j = await r.json();
      HUB.activeJobStatus = j.status;
      const pct = Math.round((j.progress || 0) * 100);
      info.innerHTML = `▸ Job <b>${id}</b> — ${j.status} · ${j.stage || ""} · ${pct}%` +
        (j.error ? ` <span style="color:var(--bad)">${j.error}</span>` : "");
      if (j.status === "done") {
        await renderHubClips(id, clipsEl);
        loadWallet();
        refreshPremiumPanel();
        updateHubButton();
        return;
      }
      if (j.status === "failed") {
        info.innerHTML += " — <span style='color:var(--warn)'>💎 devolvido automaticamente.</span>";
        loadWallet();
        refreshPremiumPanel();
        updateHubButton();
        return;
      }
    } catch (e) {
      info.innerHTML = `<span style="color:var(--bad)">✖ Falha ao consultar job: ${e.message}</span>`;
      updateHubButton();
      return;
    }
    HUB.pollTimer = setTimeout(tick, 3000);
  };
  tick();
}

async function authorizeDownload(jobId, all) {
  const r = await fetch(`${HUB.apiBase}/api/jobs/${jobId}/authorize-download`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id_jogador: HUB.playerId, tier: all ? "all" : "pack", clip_idxs: [] }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.detail || "Falha na autorização de download");
  loadWallet(); refreshPremiumPanel();
  return j;
}

function triggerDownload(url, name) {
  const a = document.createElement("a");
  a.href = url; a.download = name || "";
  a.target = "_blank"; a.rel = "noopener";
  document.body.appendChild(a); a.click(); a.remove();
}

async function renderHubClips(id, clipsEl) {
  const rc = await fetch(`${HUB.apiBase}/api/jobs/${id}/clips`).then(r => r.json());
  const clips = rc.clips || [];
  const rows = clips.map(c => {
    const url = c.download_url.startsWith("http") ? c.download_url : HUB.apiBase + c.download_url;
    return `
      <div class="clipItem">
        <div class="score" style="border-color:${c.score >= 70 ? "var(--good)" : c.score >= 45 ? "var(--warn)" : "var(--bad)"}">${c.score}<small>NOTA</small></div>
        <div class="info"><b>${fmt(c.start)} → ${fmt(c.end)}</b> (${Math.round(c.end - c.start)}s)
          <div class="viral">🎯 ${c.viral_title || ""}</div>
          <div class="tags">${(c.hashtags || []).join(" ")}</div>
          <div class="signal">🔊 ${(c.signals.audio_peak * 100) | 0}% · 🎬 ${(c.signals.motion * 100) | 0}% · 🔥 ${(c.signals.intensity * 100) | 0}%</div></div>
        <button class="small dlOne" data-url="${url}" data-name="clipe_${c.idx}.mp4">⬇</button>
      </div>`;
  }).join("") || "<p class='signal'>Nenhum clipe gerado.</p>";
  clipsEl.innerHTML = rows + `
    <div class="row" style="gap:8px">
      <button class="ghost small" id="dlAllHubBtn" style="flex:1">⬇ Baixar todos (cobra o plano 1×)</button>
    </div>`;
  clipsEl.querySelectorAll(".dlOne").forEach(b => b.onclick = async () => {
    try { await authorizeDownload(id, false); } catch (e) { alert(e.message); return; }
    triggerDownload(b.dataset.url, b.dataset.name);
  });
  const allBtn = clipsEl.querySelector("#dlAllHubBtn");
  if (allBtn) allBtn.onclick = async () => {
    try { await authorizeDownload(id, true); } catch (e) { alert(e.message); return; }
    triggerDownload(`${HUB.apiBase}/api/jobs/${id}/download-all.zip`, `clipes_${id}.zip`);
  };
}

window.addEventListener("DOMContentLoaded", () => {
  setupPwaInstall();
  renderWalletBar();
  if (!HUB.playerId) return;
  loadWallet();
  refreshPremiumPanel();
  const obs = new MutationObserver(() => {
    const ed = document.getElementById("editor");
    if (ed && !ed.classList.contains("hidden")) injectHubCard();
  });
  obs.observe(document.body, { subtree: true, attributes: true, attributeFilter: ["class"] });
});
