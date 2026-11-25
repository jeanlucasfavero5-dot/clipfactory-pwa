/* Integration Hub WaveCombat v0.031 */
"use strict";

const SUPABASE_URL = "https://ipqjeacdfiomcxfuixdj.supabase.co";
const SUPABASE_KEY = "sb_publishable_EWW84q_43YbOvMwB_Rua-A_X465PbLP";

const PLANOS = {
  pack5:  { label: "5 clipes",          custo: 100,  n: 5,  desc: "+5 vídeos avulsos" },
  pack10: { label: "10 clipes",         custo: 200,  n: 10, desc: "+10 vídeos avulsos" },
  weekly: { label: "Assinatura 7 dias", custo: 1000, n: 20, desc: "20 clipes/dia · 7 dias" },
};

function resolveInitialPlayerId() {
  const fromUrl = new URLSearchParams(window.location.search).get("id");
  if (fromUrl) return String(fromUrl);
  try {
    const raw = sessionStorage.getItem("cf_session_user");
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.id_jogador) return String(parsed.id_jogador);
    }
  } catch (e) {}
  return "LOCAL";
}

const HUB = {
  playerId: resolveInitialPlayerId(),
  apiBase: new URLSearchParams(window.location.search).get("api") || "https://wavecombat-hub.onrender.com",
  supabase: null,
  nick: null,
  diamantes: 0,
  extraCredits: { videos_restantes: 5 },
  plano: "pack5"
};

window.authorizeClipDownload = async function(clip, count = 1) {
  return true;
};
