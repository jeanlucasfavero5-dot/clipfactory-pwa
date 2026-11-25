"use strict";

window.ClipWallet = (() => {
  const SUPABASE_URL = "https://ipqjeacdfiomcxfuixdj.supabase.co";

  function getHeaders() {
    const anonKey = localStorage.getItem("clipfactory_sb_anon_key") || "";
    if (!anonKey) return null;
    return {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
      "Content-Type": "application/json",
      Prefer: "return=representation"
    };
  }

  async function getBalance(playerId) {
    const fallbackKey = `clipfactory_diamonds_${playerId}`;
    const localSaved = localStorage.getItem(fallbackKey);
    let balance = localSaved !== null ? Number(localSaved) : 250;
    if (!Number.isFinite(balance)) balance = 250;

    const headers = getHeaders();
    if (!headers || !playerId) {
      localStorage.setItem(fallbackKey, String(balance));
      return balance;
    }

    try {
      const url = `${SUPABASE_URL}/rest/v1/carteira_diamantes?id_jogador=eq.${encodeURIComponent(playerId)}&select=saldo`;
      const resp = await fetch(url, { headers });
      if (resp.ok) {
        const rows = await resp.json();
        if (Array.isArray(rows) && rows.length > 0 && typeof rows[0].saldo === "number") {
          balance = rows[0].saldo;
          localStorage.setItem(fallbackKey, String(balance));
        }
      }
    } catch (_) {}

    return balance;
  }

  async function debitDiamonds(playerId, amount) {
    const cost = Number(amount || 50);
    const current = await getBalance(playerId);
    if (current < cost) {
      return { ok: false, error: "Saldo insuficiente de diamantes.", balance: current };
    }

    const nextBalance = current - cost;
    const fallbackKey = `clipfactory_diamonds_${playerId}`;
    localStorage.setItem(fallbackKey, String(nextBalance));

    const headers = getHeaders();
    if (headers && playerId) {
      try {
        const url = `${SUPABASE_URL}/rest/v1/carteira_diamantes?id_jogador=eq.${encodeURIComponent(playerId)}`;
        await fetch(url, {
          method: "PATCH",
          headers,
          body: JSON.stringify({ saldo: nextBalance, updated_at: new Date().toISOString() })
        });
      } catch (_) {}
    }

    return { ok: true, balance: nextBalance };
  }

  return { getBalance, debitDiamonds };
})();
