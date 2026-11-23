/* ============================================================
   Integração Hub WaveCombat — Supabase (assinaturas + creditos_videos + carteira_diamantes)
   v0.021: Correção da coluna updated_at + durações exatas de 30s e 60s
   ============================================================ */
"use strict";

const SUPABASE_URL = "https://ipqjeacdfiomcxfuixdj.supabase.co";
const SUPABASE_KEY = "sb_publishable_EWW84q_43YbOvMwB_Rua-A_X465PbLP";

const PLANOS = {
  pack5:  { label: "5 clipes",          custo: 100,  n: 5,  desc: "+5 vídeos avulsos" },
  pack10: { label: "10 clipes",         custo: 200,  n: 10, desc: "+10 vídeos avulsos" },
  weekly: { label: "Assinatura 7 dias", custo: 1000, n: 20, desc: "20 clipes/dia · 7 dias" },
};

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function normalizeIsoDate(val) {
  if (!val) return "";
  return String(val).trim().slice(0, 10);
}

function isMissingColumnError(err, colName = "updated_at") {
  const msg = String(err?.message || err || "").toLowerCase();
  return msg.includes("column") && msg.includes(colName.toLowerCase());
}

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

function resolveInitialDurationSec() {
  const fromUrl = Number(new URLSearchParams(window.location.search).get("dur"));
  if (fromUrl === 60 || fromUrl === 30) return fromUrl;
  try {
    const saved = Number(localStorage.getItem("cf_clip_duration"));
    if (saved === 60 || saved === 30) return saved;
  } catch (e) {}
  return 30;
}

const HUB = {
  playerId: resolveInitialPlayerId(),
  apiBase: new URLSearchParams(window.location.search).get("api") || "https://clipfactory-api.onrender.com",
  supabase: null,
  nick: null,
  diamantes: null,
  sub: null,
  extraCredits: {
    videos_restantes: 0,
    videos_comprados_total: 0,
    tableAvailable: true
  },
  plano: new URLSearchParams(window.location.search).get("plano") || "pack5",
  duracao: resolveInitialDurationSec(),
  deferredInstallPrompt: null,
};

function setClipDurationSec(sec) {
  const validDur = Number(sec) === 60 ? 60 : 30;
  HUB.duracao = validDur;
  try { localStorage.setItem("cf_clip_duration", String(validDur)); } catch (e) {}
  if (typeof state !== "undefined") {
    state.clipDuration = validDur;
    if (state.activeClip) {
      const maxDur = (typeof resolveVideoDuration === "function")
        ? resolveVideoDuration(document.getElementById("videoEl"))
        : (state.duration || 60);
      state.activeClip.end = Math.min(maxDur, state.activeClip.start + validDur);
      if (typeof updateTimeline === "function") updateTimeline();
    }
  }
  document.querySelectorAll(".durBtn").forEach(b => {
    const active = Number(b.dataset.dur) === validDur;
    b.classList.toggle("sel", active);
    b.style.borderColor = active ? "var(--accent)" : "var(--border)";
  });
  updateHubButton();
}

function getSupabase() {
  if (!HUB.supabase && window.supabase) {
    HUB.supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  }
  return HUB.supabase;
}

function getAvailableVideosSummary() {
  const hasWeekly = !!(HUB.sub && HUB.sub.ativa);
  const dailyLimit = Number(HUB.sub?.limite_diario || 20);
  const todayStr = todayIsoDate();
  const usedToday = normalizeIsoDate(HUB.sub?.dia_uso) === todayStr ? Number(HUB.sub?.clipes_hoje || 0) : 0;
  const dailyRemaining = hasWeekly ? Math.max(0, dailyLimit - usedToday) : 0;

  const extraRemaining = Math.max(0, Number(HUB.extraCredits?.videos_restantes || 0));
  const extraTotal = Math.max(0, Number(HUB.extraCredits?.videos_comprados_total || 0));

  const totalRemaining = dailyRemaining + extraRemaining;
  const totalCapacity = (hasWeekly ? dailyLimit : 0) + Math.max(extraRemaining, extraTotal);

  const label = totalCapacity > 0
    ? `${totalRemaining}/${totalCapacity}`
    : `0/0`;

  return {
    hasWeekly,
    dailyLimit,
    usedToday,
    dailyRemaining,
    extraRemaining,
    extraTotal,
    totalAvailable: totalRemaining,
    totalCapacity,
    label
  };
}

function setupPwaInstall() {
  const btn = document.getElementById("installPwaBtn");
  if (!btn) return;

  window.addEventListener("beforeinstallprompt", e => {
    e.preventDefault();
    HUB.deferredInstallPrompt = e;
    btn.classList.remove("hidden");
  });

  btn.addEventListener("click", async () => {
    if (HUB.deferredInstallPrompt) {
      HUB.deferredInstallPrompt.prompt();
      await HUB.deferredInstallPrompt.userChoice.catch(() => null);
      HUB.deferredInstallPrompt = null;
    } else {
      alert("Para instalar no celular: toque no menu do navegador (⋮) e escolha 'Instalar aplicativo' ou 'Adicionar à tela inicial'.");
    }
  });

  window.addEventListener("appinstalled", () => {
    HUB.deferredInstallPrompt = null;
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
    bar.innerHTML = `<span style="color:var(--muted)">🔓 Modo local — entre com sua conta do Hub para sincronizar diamantes e vídeos disponíveis.</span>`;
    return;
  }

  const saldo = HUB.diamantes === null ? "…" : `💎 <b style="color:#ffd166">${HUB.diamantes}</b>`;
  const vids = getAvailableVideosSummary();
  bar.innerHTML = `
    <span>👤 <b>${HUB.nick ?? "carregando…"}</b> <span style="color:var(--muted)">(ID ${HUB.playerId})</span></span>
    <span style="margin-left:auto;display:flex;align-items:center;gap:10px;flex-wrap:wrap">
      <span>${saldo} diamantes</span>
      <span>🎬 <b id="walletVideosCount" style="color:#4ade80">${vids.label}</b> vídeos disponíveis</span>
      <a href="https://wavecombat-hub.onrender.com/#inicio" target="_blank" rel="noopener" class="ghost small" style="text-decoration:none;padding:4px 9px;border-radius:8px;border:1px solid var(--border);color:#ffd166;font-weight:800">+ Diamantes</a>
      <button type="button" class="ghost small" id="walletRefresh" title="Sincronizar com Supabase">↻</button>
    </span>
    ${msg ? `<div style="width:100%;margin-top:4px;color:${kind === "err" ? "var(--bad)" : "var(--good)"}">${msg}</div>` : ""}`;

  const refBtn = document.getElementById("walletRefresh");
  if (refBtn) {
    refBtn.onclick = async () => {
      await syncAllAccountStateFromSupabase();
      renderWalletBar("🔄 Saldo sincronizado com a nuvem.", "ok");
    };
  }
}

async function loadWallet() {
  if (!HUB.playerId) return;
  try {
    const sb = getSupabase();
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

async function loadExtraCredits() {
  if (!HUB.playerId) return;
  try {
    const sb = getSupabase();
    const { data, error } = await sb
      .from("creditos_videos")
      .select("videos_restantes, videos_comprados_total")
      .eq("id_jogador", HUB.playerId)
      .maybeSingle();

    if (error) {
      HUB.extraCredits.tableAvailable = false;
      return;
    }
    HUB.extraCredits.tableAvailable = true;
    HUB.extraCredits.videos_restantes = Number(data?.videos_restantes || 0);
    HUB.extraCredits.videos_comprados_total = Number(data?.videos_comprados_total || 0);
    renderWalletBar();
  } catch (e) {
    HUB.extraCredits.tableAvailable = false;
  }
}

async function fetchSubscriptionFromSupabase() {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("assinaturas")
    .select("*")
    .eq("id_jogador", HUB.playerId)
    .order("fim", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return { ativa: false, limite_diario: 20, clipes_hoje: 0, dia_uso: todayIsoDate() };

  const now = Date.now();
  const fimMs = data.fim ? new Date(data.fim).getTime() : 0;
  const ativa = fimMs > now;
  const todayStr = todayIsoDate();
  const rowDay = normalizeIsoDate(data.dia_uso);
  const clipesHoje = (rowDay === todayStr) ? Number(data.clipes_hoje || 0) : 0;

  return {
    ativa,
    inicio: data.inicio,
    fim: data.fim,
    limite_diario: Number(data.limite_diario || 20),
    clipes_hoje: clipesHoje,
    dia_uso: todayStr,
    raw: data
  };
}

async function syncAllAccountStateFromSupabase() {
  if (!HUB.playerId) return;
  await loadWallet();
  HUB.sub = await fetchSubscriptionFromSupabase();
  await loadExtraCredits();
  await refreshPremiumPanel();
  updateHubButton();
}

async function updateAssinaturaRowSafe(sb, valuesObj) {
  let res = await sb
    .from("assinaturas")
    .update({ ...valuesObj, updated_at: new Date().toISOString() })
    .eq("id_jogador", HUB.playerId);

  if (res.error && isMissingColumnError(res.error, "updated_at")) {
    res = await sb
      .from("assinaturas")
      .update(valuesObj)
      .eq("id_jogador", HUB.playerId);
  }
  return res;
}

async function upsertAssinaturaRowSafe(sb, valuesObj) {
  let res = await sb
    .from("assinaturas")
    .upsert({ ...valuesObj, updated_at: new Date().toISOString() }, { onConflict: "id_jogador" });

  if (res.error && isMissingColumnError(res.error, "updated_at")) {
    res = await sb
      .from("assinaturas")
      .upsert(valuesObj, { onConflict: "id_jogador" });
  }
  return res;
}

async function addExtraCreditsToSupabase(qty) {
  const sb = getSupabase();
  const { data: fresh } = await sb
    .from("creditos_videos")
    .select("videos_restantes, videos_comprados_total")
    .eq("id_jogador", HUB.playerId)
    .maybeSingle();

  const nextRem = Number(fresh?.videos_restantes || 0) + qty;
  const nextTot = Number(fresh?.videos_comprados_total || 0) + qty;

  const basePayload = {
    id_jogador: HUB.playerId,
    videos_restantes: nextRem,
    videos_comprados_total: nextTot
  };

  let { error } = await sb
    .from("creditos_videos")
    .upsert({ ...basePayload, updated_at: new Date().toISOString() }, { onConflict: "id_jogador" });

  if (error && isMissingColumnError(error, "updated_at")) {
    const retry = await sb
      .from("creditos_videos")
      .upsert(basePayload, { onConflict: "id_jogador" });
    error = retry.error;
  }

  if (error) throw new Error("Erro ao salvar vídeos na nuvem: " + error.message);

  HUB.extraCredits.videos_restantes = nextRem;
  HUB.extraCredits.videos_comprados_total = nextTot;
  renderWalletBar();
}

window.checkCanDownloadVideos = async function(neededCount = 1) {
  if (!HUB.playerId) return true;
  await syncAllAccountStateFromSupabase();
  const vids = getAvailableVideosSummary();
  if (vids.totalAvailable >= neededCount) {
    return true;
  }
  alert(
    `Você possui ${vids.label} vídeos disponíveis para download (necessário: ${neededCount}).\n\n` +
    `Adquira a Assinatura 7 dias (20 vídeos/dia) ou um pacote adicional (+5 ou +10 vídeos) usando seus diamantes.`
  );
  return false;
};

async function consumeOneVideoFromCloud() {
  const sb = getSupabase();

  try {
    const { data: rpcData, error: rpcErr } = await sb.rpc("consumir_video_download", {
      p_id_jogador: HUB.playerId
    });
    if (!rpcErr && rpcData) {
      if (rpcData.ok) {
        return { ok: true, origem: rpcData.origem };
      }
      if (rpcData.motivo === "sem_saldo_videos") {
        throw new Error("Sem vídeos disponíveis para baixar. Compre um pacote adicional ou ative a assinatura semanal.");
      }
    }
  } catch (e) {
    if (e.message && e.message.includes("Sem vídeos disponíveis")) throw e;
  }

  const freshSub = await fetchSubscriptionFromSupabase();
  const todayStr = todayIsoDate();
  if (freshSub.ativa && freshSub.clipes_hoje < freshSub.limite_diario) {
    const nextUsed = freshSub.clipes_hoje + 1;
    const { error: upSubErr } = await updateAssinaturaRowSafe(sb, {
      clipes_hoje: nextUsed,
      dia_uso: todayStr
    });
    if (upSubErr) throw new Error("Falha ao registrar uso na nuvem: " + upSubErr.message);
    return { ok: true, origem: "assinatura" };
  }

  const { data: freshCred, error: readCredErr } = await sb
    .from("creditos_videos")
    .select("videos_restantes")
    .eq("id_jogador", HUB.playerId)
    .maybeSingle();
  if (readCredErr) throw new Error("Falha ao consultar saldo de vídeos: " + readCredErr.message);

  const curRem = Number(freshCred?.videos_restantes || 0);
  if (curRem > 0) {
    const nextRem = curRem - 1;
    const { error: upCredErr } = await sb
      .from("creditos_videos")
      .update({ videos_restantes: nextRem })
      .eq("id_jogador", HUB.playerId)
      .eq("videos_restantes", curRem);
    if (upCredErr) throw new Error("Falha ao descontar vídeo na nuvem: " + upCredErr.message);
    return { ok: true, origem: "avulso" };
  }

  throw new Error("Sem vídeos disponíveis para baixar. Adquira um pacote adicional ou assine o plano semanal.");
}

window.refundOneVideoToCloud = async function(origem) {
  if (!HUB.playerId || !origem) return;
  const sb = getSupabase();
  try {
    const { error } = await sb.rpc("estornar_video_download", {
      p_id_jogador: HUB.playerId,
      p_origem: origem
    });
    if (!error) {
      await syncAllAccountStateFromSupabase();
      return;
    }
  } catch (e) {}

  try {
    if (origem === "assinatura") {
      const s = await fetchSubscriptionFromSupabase();
      if (s.clipes_hoje > 0) {
        await updateAssinaturaRowSafe(sb, { clipes_hoje: s.clipes_hoje - 1 });
      }
    } else if (origem === "avulso") {
      const { data } = await sb.from("creditos_videos")
        .select("videos_restantes")
        .eq("id_jogador", HUB.playerId)
        .maybeSingle();
      await sb.from("creditos_videos")
        .update({ videos_restantes: Number(data?.videos_restantes || 0) + 1 })
        .eq("id_jogador", HUB.playerId);
    }
    await syncAllAccountStateFromSupabase();
  } catch (e) {}
};

window.authorizeClipDownload = async function(clip, count = 1) {
  if (!HUB.playerId) return { ok: true, consumedOrigins: [] };
  const consumedOrigins = [];
  try {
    const needed = Math.max(1, Number(count) || 1);
    for (let i = 0; i < needed; i++) {
      const res = await consumeOneVideoFromCloud();
      consumedOrigins.push(res.origem);
    }
    await syncAllAccountStateFromSupabase();
    const vids = getAvailableVideosSummary();
    renderWalletBar(`🎬 ${needed} vídeo(s) descontado(s). Saldo atual: ${vids.label} disponíveis.`, "ok");
    return { ok: true, consumedOrigins };
  } catch (err) {
    for (const orig of consumedOrigins) {
      await window.refundOneVideoToCloud(orig);
    }
    alert("❌ " + err.message);
    return { ok: false, consumedOrigins: [] };
  }
};

async function injectPremiumPanel(col) {
  if (!HUB.playerId || document.getElementById("premiumPanel")) return;
  const card = document.createElement("div");
  card.className = "card";
  card.id = "premiumPanel";
  card.innerHTML = `
    <div class="card-h"><h2>⭐ Assinatura semanal & vídeos disponíveis</h2><button type="button" class="collapse-btn">▾</button></div>
    <div class="card-body"><div id="premiumBody" class="signal">carregando…</div></div>`;
  col.prepend(card);
  if (typeof initCollapsibleCards === "function") initCollapsibleCards();
  await refreshPremiumPanel();
}

async function refreshPremiumPanel() {
  const body = document.getElementById("premiumBody");
  if (!body || !HUB.playerId) return;
  try {
    const s = await fetchSubscriptionFromSupabase();
    HUB.sub = s;
    const vids = getAvailableVideosSummary();

    if (!s.ativa) {
      body.innerHTML = `
        <div class="stat">
          <div><b>${vids.label}</b>vídeos disponíveis</div>
          <div><b>${HUB.diamantes ?? 0}</b>💎 saldo</div>
          <div><b>7 dias</b>inativo</div>
        </div>
        <p class="signal">O desconto acontece <b>somente quando o download é concluído sem erros</b>. Assine 7 dias (20 vídeos/dia) ou compre pacotes adicionais.</p>
        <div class="row" style="gap:8px;margin-top:8px">
          <button type="button" class="ghost small" id="buyPack5Btn" style="flex:1">+5 vídeos (💎 100)</button>
          <button type="button" class="ghost small" id="buyPack10Btn" style="flex:1">+10 vídeos (💎 200)</button>
        </div>
        <button type="button" id="renovarWeeklyBtn" style="width:100%;margin-top:8px">⭐ Assinar 7 dias · 20/dia (💎 ${PLANOS.weekly.custo})</button>`;
      body.querySelector("#buyPack5Btn").onclick = () => buyExtraPack("pack5");
      body.querySelector("#buyPack10Btn").onclick = () => buyExtraPack("pack10");
      body.querySelector("#renovarWeeklyBtn").onclick = subscribeWeekly;
      renderWalletBar();
      return;
    }

    const fim = new Date(s.fim);
    const dias = Math.max(0, Math.ceil((fim - Date.now()) / 86400000));
    body.innerHTML = `
      <span class="badgePremium">⭐ ASSINATURA 7 DIAS ATIVA</span>
      <div class="stat">
        <div><b>${vids.label}</b>total disponível</div>
        <div><b>${vids.dailyRemaining}/${vids.dailyLimit}</b>cota hoje</div>
        <div><b>${vids.extraRemaining}</b>avulso extra</div>
      </div>
      <p class="signal">Válida por <b>${dias} dia(s)</b> até <b>${fim.toLocaleDateString("pt-BR")} ${fim.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</b>. Se ocorrer erro na exportação, nenhum vídeo é descontado.</p>
      <div class="row" style="gap:8px;margin-top:6px">
        <button type="button" class="ghost small" id="buyPack5Btn" style="flex:1">+5 vídeos (💎 100)</button>
        <button type="button" class="ghost small" id="buyPack10Btn" style="flex:1">+10 vídeos (💎 200)</button>
      </div>
      <button type="button" id="renovarWeeklyBtn" style="width:100%;margin-top:8px">🔄 Renovar assinatura +7 dias (💎 ${PLANOS.weekly.custo})</button>`;
    body.querySelector("#buyPack5Btn").onclick = () => buyExtraPack("pack5");
    body.querySelector("#buyPack10Btn").onclick = () => buyExtraPack("pack10");
    body.querySelector("#renovarWeeklyBtn").onclick = subscribeWeekly;
    renderWalletBar();
  } catch (e) {
    body.innerHTML = `<span style="color:var(--muted)">Não foi possível consultar assinatura (${e.message}).</span>`;
  }
}

async function buyExtraPack(packKey) {
  const pack = PLANOS[packKey] || PLANOS.pack10;
  if (!confirm(`Comprar ${pack.label} (+${pack.n} vídeos disponíveis) por 💎 ${pack.custo}?`)) return;
  try {
    await debitDiamonds(pack.custo, pack.label);
    try {
      await addExtraCreditsToSupabase(pack.n);
    } catch (saveErr) {
      await refundDiamonds(pack.custo, "Estorno por falha ao salvar pacote");
      throw saveErr;
    }
    await syncAllAccountStateFromSupabase();
    const vids = getAvailableVideosSummary();
    renderWalletBar(`✅ +${pack.n} vídeos adicionados! Saldo atual: ${vids.label} disponíveis.`, "ok");
  } catch (e) {
    renderWalletBar("❌ " + e.message, "err");
  }
}

async function debitDiamonds(cost, reasonLabel) {
  const sb = getSupabase();
  const { data: wData, error: wErr } = await sb
    .from("carteira_diamantes")
    .select("diamantes")
    .eq("id_jogador", HUB.playerId)
    .maybeSingle();
  if (wErr) throw new Error(wErr.message);

  const current = Number(wData?.diamantes ?? 0);
  if (current < cost) {
    throw new Error(`Saldo insuficiente (${current} 💎). Compre diamantes no Hub (${reasonLabel}: ${cost} 💎).`);
  }

  const nextBalance = current - cost;
  const { error: upErr } = await sb
    .from("carteira_diamantes")
    .update({ diamantes: nextBalance })
    .eq("id_jogador", HUB.playerId);
  if (upErr) throw new Error(upErr.message);

  HUB.diamantes = nextBalance;
  renderWalletBar(`💎 -${cost} (${reasonLabel})`, "ok");
  return { prevBalance: current, nextBalance };
}

async function refundDiamonds(amount, reasonLabel) {
  if (!amount || amount <= 0) return;
  try {
    const sb = getSupabase();
    const { data: wData } = await sb
      .from("carteira_diamantes")
      .select("diamantes")
      .eq("id_jogador", HUB.playerId)
      .maybeSingle();
    const current = Number(wData?.diamantes ?? HUB.diamantes ?? 0);
    const restored = current + amount;
    await sb
      .from("carteira_diamantes")
      .update({ diamantes: restored })
      .eq("id_jogador", HUB.playerId);
    HUB.diamantes = restored;
    renderWalletBar(`💎 +${amount} devolvidos (${reasonLabel})`, "ok");
  } catch (e) {
    console.error("refund:", e);
  }
}

async function subscribeWeekly() {
  if (!confirm(`Ativar/renovar a assinatura semanal (7 dias · 20 vídeos/dia) por 💎 ${PLANOS.weekly.custo}?`)) return;
  const cost = PLANOS.weekly.custo;
  try {
    await debitDiamonds(cost, "Assinatura 7 dias");

    const sb = getSupabase();
    const freshSub = await fetchSubscriptionFromSupabase();
    const now = new Date();
    const baseMs = (freshSub && freshSub.ativa && new Date(freshSub.fim).getTime() > now.getTime())
      ? new Date(freshSub.fim).getTime()
      : now.getTime();
    const newFim = new Date(baseMs + 7 * 86400000);
    const todayStr = todayIsoDate();

    const payload = {
      id_jogador: HUB.playerId,
      inicio: now.toISOString(),
      fim: newFim.toISOString(),
      limite_diario: 20,
      clipes_hoje: normalizeIsoDate(freshSub?.dia_uso) === todayStr ? (freshSub?.clipes_hoje || 0) : 0,
      dia_uso: todayStr
    };

    const { error: upErr } = await upsertAssinaturaRowSafe(sb, payload);

    if (upErr) {
      await refundDiamonds(cost, "Erro ao salvar assinatura");
      throw new Error(upErr.message);
    }

    await syncAllAccountStateFromSupabase();
    const vids = getAvailableVideosSummary();
    renderWalletBar(`⭐ Assinatura 7 dias ativa! Saldo atual: ${vids.label} vídeos disponíveis.`, "ok");
  } catch (e) {
    renderWalletBar("❌ " + e.message, "err");
  }
}

function injectHubCard() {
  if (!HUB.playerId) return;
  const col = document.getElementById("hubDrawerContainer") || document.querySelector("#editor > div:last-child");
  if (!col || document.getElementById("hubCard")) return;
  const placeholder = document.getElementById("hubDrawerPlaceholder");
  if (placeholder) placeholder.remove();
  injectPremiumPanel(col);
  const card = document.createElement("div");
  card.className = "card";
  card.id = "hubCard";
  card.innerHTML = `
    <div class="card-h"><h2>💎 Hub WaveCombat — pacotes & geração</h2><button type="button" class="collapse-btn">▾</button></div>
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
        <button type="button" class="ghost small durBtn" data-dur="30" style="flex:1">⏱ 30 segundos</button>
        <button type="button" class="ghost small durBtn" data-dur="60" style="flex:1">⏱ 60 segundos</button>
      </div>
      <div class="row" style="margin-top:10px;gap:8px">
        <button type="button" id="hubStartBtn" style="flex:1">🎬 Gerar cortes (sem desconto ao gerar)</button>
        <button type="button" class="ghost small" id="hubBuySelectedBtn" style="flex:0 0 auto">💎 Comprar pacote</button>
      </div>
      <div id="hubJobInfo" class="signal" style="margin-top:8px"></div>
    </div>`;
  col.appendChild(card);
  if (typeof initCollapsibleCards === "function") initCollapsibleCards();

  card.querySelectorAll(".planCard").forEach(pc => pc.onclick = () => {
    HUB.plano = pc.dataset.plan;
    card.querySelectorAll(".planCard").forEach(x => x.style.borderColor = "var(--border)");
    pc.style.borderColor = "var(--accent)";
    updateHubButton();
  });
  card.querySelector(`.planCard[data-plan="${HUB.plano}"]`).style.borderColor = "var(--accent)";
  card.querySelectorAll(".durBtn").forEach(b => b.onclick = () => {
    setClipDurationSec(Number(b.dataset.dur));
  });
  setClipDurationSec(HUB.duracao);
  document.getElementById("hubStartBtn").onclick = startHubJob;
  document.getElementById("hubBuySelectedBtn").onclick = () => {
    if (HUB.plano === "weekly") subscribeWeekly();
    else buyExtraPack(HUB.plano);
  };
  updateHubButton();
}

function planoSel() { return PLANOS[HUB.plano] || PLANOS.pack5; }

function updateHubButton() {
  const btn = document.getElementById("hubStartBtn");
  const buyBtn = document.getElementById("hubBuySelectedBtn");
  if (buyBtn) {
    buyBtn.textContent = `💎 Comprar ${planoSel().label} (${planoSel().custo})`;
  }
  if (!btn) return;
  const hasSource = !!(typeof state !== "undefined" && state.file);
  btn.disabled = !hasSource;
  if (!hasSource) {
    btn.textContent = "🎬 Envie um vídeo primeiro";
  } else {
    btn.textContent = `🎬 Gerar cortes de ${HUB.duracao}s (cobra só ao baixar sem erro)`;
  }
}

async function startHubJob() {
  const info = document.getElementById("hubJobInfo");
  const btn = document.getElementById("hubStartBtn");
  try {
    btn.disabled = true;
    info.innerHTML = `▸ Gerando sugestões de clipes de ${HUB.duracao}s na janela ${fmt(state.segStart)} → ${fmt(state.segEnd)}…`;
    if (typeof analyzeMoments === "function") {
      await analyzeMoments();
    }
    info.innerHTML = `▸ Clipes prontos (${HUB.duracao}s)! Use <b>Visualizar</b> ou <b>Baixar</b> (desconta 1 vídeo somente após exportar sem erro).`;
    btn.disabled = false;
    updateHubButton();
  } catch (e) {
    info.innerHTML = `<span style="color:var(--bad)">✖ ${e.message}</span>`;
    btn.disabled = false;
    updateHubButton();
  }
}

window.addEventListener("DOMContentLoaded", async () => {
  setupPwaInstall();
  renderWalletBar();
  if (!HUB.playerId) return;
  await syncAllAccountStateFromSupabase();
  const obs = new MutationObserver(() => {
    const ed = document.getElementById("editor");
    if (ed && !ed.classList.contains("hidden")) injectHubCard();
  });
  obs.observe(document.body, { subtree: true, attributes: true, attributeFilter: ["class"] });
});
