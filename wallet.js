/* ============================================================
   Integração Hub WaveCombat — Supabase (assinaturas + creditos_videos + carteira_diamantes)
   v0.011: Desconto garantido na carteira de vídeos no download + normalização de dia_uso
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
  sub: null,
  extraCredits: {
    videos_restantes: 0,
    videos_comprados_total: 0,
    tableAvailable: true
  },
  plano: new URLSearchParams(window.location.search).get("plano") || "pack5",
  duracao: 30,
  deferredInstallPrompt: null,
};

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

  const totalAvailable = dailyRemaining + extraRemaining;
  const parts = [];
  if (hasWeekly) {
    parts.push(`${dailyRemaining}/${dailyLimit} hoje`);
  }
  if (extraRemaining > 0 || extraTotal > 0 || !hasWeekly) {
    const denom = extraTotal > 0 ? extraTotal : Math.max(extraRemaining, 10);
    parts.push(`${extraRemaining}/${denom} avulso`);
  }

  return {
    hasWeekly,
    dailyLimit,
    usedToday,
    dailyRemaining,
    extraRemaining,
    extraTotal,
    totalAvailable,
    label: parts.join(" + ")
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
    bar.innerHTML = `<span style="color:var(--muted)">🔓 Modo local — sem jogador do Hub (?id= na URL ou sessão).</span>`;
    return;
  }

  const saldo = HUB.diamantes === null ? "…" : `💎 <b style="color:#ffd166">${HUB.diamantes}</b>`;
  const vids = getAvailableVideosSummary();
  bar.innerHTML = `
    <span>👤 <b>${HUB.nick ?? "carregando…"}</b> <span style="color:var(--muted)">(ID ${HUB.playerId})</span></span>
    <span style="margin-left:auto;display:flex;align-items:center;gap:10px;flex-wrap:wrap">
      <span>${saldo} diamantes</span>
      <span>🎬 <b id="walletVideosCount" style="color:#4ade80">${vids.label}</b> disponíveis p/ baixar</span>
      <button type="button" class="ghost small" id="walletRefresh">↻</button>
    </span>
    ${msg ? `<div style="width:100%;margin-top:4px;color:${kind === "err" ? "var(--bad)" : "var(--good)"}">${msg}</div>` : ""}`;

  const refBtn = document.getElementById("walletRefresh");
  if (refBtn) {
    refBtn.onclick = async () => {
      await loadWallet();
      await loadExtraCredits();
      await refreshPremiumPanel();
      updateHubButton();
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

async function addExtraCreditsToSupabase(qty) {
  HUB.extraCredits.videos_restantes = Number(HUB.extraCredits.videos_restantes || 0) + qty;
  HUB.extraCredits.videos_comprados_total = Number(HUB.extraCredits.videos_comprados_total || 0) + qty;
  renderWalletBar();

  if (!HUB.extraCredits.tableAvailable) return;
  try {
    const sb = getSupabase();
    const payload = {
      id_jogador: HUB.playerId,
      videos_restantes: HUB.extraCredits.videos_restantes,
      videos_comprados_total: HUB.extraCredits.videos_comprados_total,
      updated_at: new Date().toISOString()
    };
    const { error } = await sb.from("creditos_videos").upsert(payload, { onConflict: "id_jogador" });
    if (error) console.warn("creditos_videos upsert:", error.message);
  } catch (e) {
    console.warn("creditos_videos:", e);
  }
}

async function consumeOneVideoCreditForDownload() {
  const todayStr = todayIsoDate();
  const hasWeekly = !!(HUB.sub && HUB.sub.ativa);
  const dailyLimit = Number(HUB.sub?.limite_diario || 20);
  let usedToday = normalizeIsoDate(HUB.sub?.dia_uso) === todayStr ? Number(HUB.sub?.clipes_hoje || 0) : 0;

  if (hasWeekly && usedToday < dailyLimit) {
    usedToday += 1;
    HUB.sub.clipes_hoje = usedToday;
    HUB.sub.dia_uso = todayStr;
    HUB.sub.limite_diario = dailyLimit;

    const sb = getSupabase();
    const { error } = await sb
      .from("assinaturas")
      .update({
        clipes_hoje: usedToday,
        dia_uso: todayStr,
        updated_at: new Date().toISOString()
      })
      .eq("id_jogador", HUB.playerId);

    if (error) {
      console.warn("Erro ao atualizar cota diária:", error.message);
    }

    const remToday = Math.max(0, dailyLimit - usedToday);
    renderWalletBar(`🎬 1 vídeo descontado da cota diária (${remToday}/${dailyLimit} restantes hoje)`, "ok");
    return true;
  }

  if (Number(HUB.extraCredits.videos_restantes || 0) > 0) {
    const nextRem = Math.max(0, Number(HUB.extraCredits.videos_restantes) - 1);
    HUB.extraCredits.videos_restantes = nextRem;
    if (HUB.extraCredits.tableAvailable) {
      const sb = getSupabase();
      await sb
        .from("creditos_videos")
        .update({ videos_restantes: nextRem, updated_at: new Date().toISOString() })
        .eq("id_jogador", HUB.playerId);
    }
    renderWalletBar(`🎬 1 vídeo avulso descontado (${nextRem}/${Math.max(nextRem, HUB.extraCredits.videos_comprados_total)} restantes)`, "ok");
    return true;
  }

  return false;
}

window.authorizeClipDownload = async function(clip, count = 1) {
  if (!HUB.playerId) return true;
  try {
    const freshSub = await fetchSubscriptionFromSupabase();
    const todayStr = todayIsoDate();
    if (HUB.sub && HUB.sub.ativa && freshSub.ativa && normalizeIsoDate(HUB.sub.dia_uso) === todayStr) {
      HUB.sub.clipes_hoje = Math.max(Number(HUB.sub.clipes_hoje || 0), Number(freshSub.clipes_hoje || 0));
      HUB.sub.dia_uso = todayStr;
    } else {
      HUB.sub = freshSub;
    }
    await loadExtraCredits();

    let remainingNeeded = Math.max(1, Number(count) || 1);
    while (remainingNeeded > 0) {
      const usedQuotaOrCredit = await consumeOneVideoCreditForDownload();
      if (!usedQuotaOrCredit) {
        const unitCost = 20;
        await debitDiamonds(unitCost, `Download de clipe #${clip?.idx || ""}`);
      }
      remainingNeeded--;
    }
    await refreshPremiumPanel();
    return true;
  } catch (err) {
    alert("❌ " + err.message);
    return false;
  }
};

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

async function injectPremiumPanel(col) {
  if (!HUB.playerId || document.getElementById("premiumPanel")) return;
  const card = document.createElement("div");
  card.className = "card";
  card.id = "premiumPanel";
  card.innerHTML = `
    <div class="card-h"><h2>⭐ Assinatura semanal & cota diária</h2><button type="button" class="collapse-btn">▾</button></div>
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
    if (HUB.sub && normalizeIsoDate(HUB.sub.dia_uso) === todayIsoDate()) {
      s.clipes_hoje = Math.max(Number(s.clipes_hoje || 0), Number(HUB.sub.clipes_hoje || 0));
    }
    HUB.sub = s;
    const vids = getAvailableVideosSummary();

    if (!s.ativa) {
      body.innerHTML = `
        <div class="stat">
          <div><b>${vids.extraRemaining}/${Math.max(vids.extraRemaining, vids.extraTotal || 0)}</b>avulsos p/ baixar</div>
          <div><b>${HUB.diamantes ?? 0}</b>💎 saldo</div>
          <div><b>7 dias</b>inativo</div>
        </div>
        <p class="signal">O desconto acontece <b>somente no download</b>. Assinatura dura <b>7 dias</b> com cota diária de <b>20 vídeos/dia</b> (ou compre pacotes avulsos).</p>
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
        <div><b>${vids.dailyRemaining}/${vids.dailyLimit}</b>hoje (20/dia)</div>
        <div><b>${vids.extraRemaining}/${Math.max(vids.extraRemaining, vids.extraTotal)}</b>avulso extra</div>
        <div><b>${dias}</b>dias restantes</div>
      </div>
      <p class="signal">Assinatura válida por 7 dias até <b>${fim.toLocaleDateString("pt-BR")} ${fim.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</b> — cota de <b>20 vídeos por dia</b> (renovada diariamente).</p>
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
  if (!confirm(`Comprar ${pack.label} (+${pack.n} vídeos para download) por 💎 ${pack.custo}?`)) return;
  try {
    await debitDiamonds(pack.custo, pack.label);
    await addExtraCreditsToSupabase(pack.n);
    renderWalletBar(`✅ +${pack.n} vídeos adicionados para download!`, "ok");
    await refreshPremiumPanel();
    updateHubButton();
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
    throw new Error(`Saldo insuficiente (${current} 💎). Necessário: ${cost} 💎 (${reasonLabel}).`);
  }

  const nextBalance = current - cost;
  const { error: upErr } = await sb
    .from("carteira_diamantes")
    .update({ diamantes: nextBalance, updated_at: new Date().toISOString() })
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
      .update({ diamantes: restored, updated_at: new Date().toISOString() })
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
    const now = new Date();
    const baseMs = (HUB.sub && HUB.sub.ativa && new Date(HUB.sub.fim).getTime() > now.getTime())
      ? new Date(HUB.sub.fim).getTime()
      : now.getTime();
    const newFim = new Date(baseMs + 7 * 86400000);
    const todayStr = todayIsoDate();

    const payload = {
      id_jogador: HUB.playerId,
      inicio: now.toISOString(),
      fim: newFim.toISOString(),
      limite_diario: 20,
      clipes_hoje: normalizeIsoDate(HUB.sub?.dia_uso) === todayStr ? (HUB.sub?.clipes_hoje || 0) : 0,
      dia_uso: todayStr,
      updated_at: now.toISOString()
    };

    const { data: existing } = await sb
      .from("assinaturas")
      .select("id_jogador")
      .eq("id_jogador", HUB.playerId)
      .maybeSingle();

    const res = existing
      ? await sb.from("assinaturas").update(payload).eq("id_jogador", HUB.playerId)
      : await sb.from("assinaturas").upsert(payload, { onConflict: "id_jogador" });

    if (res.error) {
      await refundDiamonds(cost, "Erro ao salvar assinatura");
      throw new Error(res.error.message);
    }

    renderWalletBar("⭐ Assinatura 7 dias ativa (20 vídeos/dia)!", "ok");
    await refreshPremiumPanel();
    await loadWallet();
    updateHubButton();
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
        <button type="button" id="hubStartBtn" style="flex:1">🎬 Gerar cortes (cobrança só no download)</button>
        <button type="button" class="ghost small" id="hubBuySelectedBtn" style="flex:0 0 auto">💎 Comprar pacote</button>
      </div>
      <div id="hubJobInfo" class="signal" style="margin-top:8px"></div>
      <div id="hubClips" style="margin-top:8px"></div>
    </div>`;
  col.insertBefore(card, col.children[1] || null);
  if (typeof initCollapsibleCards === "function") initCollapsibleCards();

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
    btn.textContent = `🎬 Gerar cortes de ${HUB.duracao}s (grátis p/ gerar · cobra só ao baixar)`;
  }
}

async function startHubJob() {
  const info = document.getElementById("hubJobInfo");
  const btn = document.getElementById("hubStartBtn");

  try {
    btn.disabled = true;
    info.innerHTML = `▸ Gerando sugestões de clipes de ${HUB.duracao}s na janela ${fmt(state.segStart)} → ${fmt(state.segEnd)} (nenhum desconto ao gerar)…`;

    if (typeof analyzeMoments === "function") {
      await analyzeMoments();
    }

    info.innerHTML = `▸ Clipes prontos! Use <b>Visualizar</b> para ver o preview vertical 9:16 e <b>Baixar</b> para exportar.`;
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
  await loadWallet();
  await loadExtraCredits();
  await refreshPremiumPanel();
  const obs = new MutationObserver(() => {
    const ed = document.getElementById("editor");
    if (ed && !ed.classList.contains("hidden")) injectHubCard();
  });
  obs.observe(document.body, { subtree: true, attributes: true, attributeFilter: ["class"] });
});
