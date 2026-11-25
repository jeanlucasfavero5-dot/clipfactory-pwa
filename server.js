import express from "express";
import cors from "cors";
import multer from "multer";
import { createClient } from "@supabase/supabase-js";

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 150 * 1024 * 1024 } // até 150 MB
});

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase =
  supabaseUrl && supabaseServiceKey
    ? createClient(supabaseUrl, supabaseServiceKey)
    : null;

app.use(
  cors({
    origin: process.env.ALLOWED_ORIGIN || "*",
    methods: ["GET", "POST", "OPTIONS"]
  })
);
app.use(express.json());

function isMp4File(file) {
  if (!file) return false;
  return file.mimetype === "video/mp4" || /\.mp4$/i.test(file.originalname || "");
}

function isTokenExpiredOrExpiring(expiresAt, bufferSec = 120) {
  if (!expiresAt) return false;
  const expMs = new Date(expiresAt).getTime();
  if (!Number.isFinite(expMs)) return false;
  return Date.now() + bufferSec * 1000 >= expMs;
}

/**
 * Renova o access_token caso esteja expirado/a vencer e atualiza a tabela conexoes_sociais.
 * Preencha os endpoints OAuth de cada provedor quando configurar as credenciais.
 */
async function ensureValidConnection(conn) {
  if (!conn.access_token && conn.provedor !== "kwai") {
    throw new Error(`Token ausente para ${conn.provedor}`);
  }

  if (!isTokenExpiredOrExpiring(conn.expires_at)) {
    return conn;
  }

  if (!conn.refresh_token) {
    if (supabase) {
      await supabase
        .from("conexoes_sociais")
        .update({ status: "expirado", updated_at: new Date().toISOString() })
        .eq("id_jogador", conn.id_jogador)
        .eq("provedor", conn.provedor);
    }
    throw new Error(`Sessão expirada em ${conn.provedor}. Reconecte a conta.`);
  }

  let tokenEndpoint = "";
  let body = null;
  let headers = { "Content-Type": "application/x-www-form-urlencoded" };

  if (conn.provedor === "youtube") {
    tokenEndpoint = "https://oauth2.googleapis.com/token";
    body = new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID || "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET || "",
      refresh_token: conn.refresh_token,
      grant_type: "refresh_token"
    });
  } else if (conn.provedor === "tiktok") {
    tokenEndpoint = "https://open.tiktokapis.com/v2/oauth/token/";
    body = new URLSearchParams({
      client_key: process.env.TIKTOK_CLIENT_KEY || "",
      client_secret: process.env.TIKTOK_CLIENT_SECRET || "",
      refresh_token: conn.refresh_token,
      grant_type: "refresh_token"
    });
  } else if (conn.provedor === "instagram" || conn.provedor === "facebook") {
    // Meta long-lived / refresh flow conforme app configurado
    const params = new URLSearchParams({
      grant_type: "fb_exchange_token",
      client_id: process.env.META_APP_ID || "",
      client_secret: process.env.META_APP_SECRET || "",
      fb_exchange_token: conn.access_token
    });
    tokenEndpoint = `https://graph.facebook.com/v21.0/oauth/access_token?${params.toString()}`;
  } else {
    return conn;
  }

  const resp = await fetch(tokenEndpoint, {
    method: body ? "POST" : "GET",
    headers,
    body: body ? body.toString() : undefined
  });

  const data = await resp.json().catch(() => ({}));
  const newAccessToken = data.access_token || data.data?.access_token;

  if (!resp.ok || !newAccessToken) {
    if (supabase) {
      await supabase
        .from("conexoes_sociais")
        .update({ status: "expirado", updated_at: new Date().toISOString() })
        .eq("id_jogador", conn.id_jogador)
        .eq("provedor", conn.provedor);
    }
    throw new Error(`Falha ao renovar token de ${conn.provedor}`);
  }

  const expiresInSec = Number(data.expires_in || data.data?.expires_in || 3600);
  const newExpiresAt = new Date(Date.now() + expiresInSec * 1000).toISOString();
  const newRefreshToken = data.refresh_token || data.data?.refresh_token || conn.refresh_token;

  if (supabase) {
    await supabase
      .from("conexoes_sociais")
      .update({
        access_token: newAccessToken,
        refresh_token: newRefreshToken,
        expires_at: newExpiresAt,
        status: "conectado",
        updated_at: new Date().toISOString()
      })
      .eq("id_jogador", conn.id_jogador)
      .eq("provedor", conn.provedor);
  }

  return {
    ...conn,
    access_token: newAccessToken,
    refresh_token: newRefreshToken,
    expires_at: newExpiresAt
  };
}

/**
 * YouTube Data API v3 - Resumable upload de vídeo MP4
 */
async function publishToYouTube(conn, file, meta) {
  const active = await ensureValidConnection(conn);

  if (!process.env.ENABLE_LIVE_SOCIAL_PUBLISH) {
    return {
      provider: "youtube",
      status: "ready_or_simulated",
      account: active.conta_nome || null,
      detail: "Validação OK (ative ENABLE_LIVE_SOCIAL_PUBLISH='true' após configurar credenciais OAuth do YouTube)"
    };
  }

  const metadata = {
    snippet: {
      title: String(meta.title || "Corte ClipFactory").slice(0, 100),
      description: `${meta.title || ""} ${meta.hashtags || ""}`.trim().slice(0, 4900),
      categoryId: "20" // Gaming
    },
    status: {
      privacyStatus: "public",
      selfDeclaredMadeForKids: false
    }
  };

  const initResp = await fetch(
    "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${active.access_token}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": "video/mp4",
        "X-Upload-Content-Length": String(file.size)
      },
      body: JSON.stringify(metadata)
    }
  );

  const uploadUrl = initResp.headers.get("location");
  if (!initResp.ok || !uploadUrl) {
    const errText = await initResp.text().catch(() => "");
    throw new Error(`YouTube init falhou (${initResp.status}): ${errText.slice(0, 200)}`);
  }

  const uploadResp = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${active.access_token}`,
      "Content-Type": "video/mp4",
      "Content-Length": String(file.size)
    },
    body: file.buffer
  });

  const uploaded = await uploadResp.json().catch(() => ({}));
  if (!uploadResp.ok || !uploaded.id) {
    throw new Error(`YouTube upload falhou (${uploadResp.status})`);
  }

  return {
    provider: "youtube",
    status: "published",
    account: active.conta_nome || null,
    videoId: uploaded.id,
    url: `https://www.youtube.com/shorts/${uploaded.id}`
  };
}

/**
 * TikTok Content Posting API - Direct Post (FILE_UPLOAD)
 */
async function publishToTikTok(conn, file, meta) {
  const active = await ensureValidConnection(conn);

  if (!process.env.ENABLE_LIVE_SOCIAL_PUBLISH) {
    return {
      provider: "tiktok",
      status: "ready_or_simulated",
      account: active.conta_nome || null,
      detail: "Validação OK (ative ENABLE_LIVE_SOCIAL_PUBLISH='true' após configurar credenciais do TikTok)"
    };
  }

  const caption = `${meta.title || "Corte ClipFactory"} ${meta.hashtags || ""}`.trim().slice(0, 2200);

  const initResp = await fetch("https://open.tiktokapis.com/v2/post/publish/video/init/", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${active.access_token}`,
      "Content-Type": "application/json; charset=UTF-8"
    },
    body: JSON.stringify({
      post_info: {
        title: caption,
        privacy_level: "PUBLIC_TO_EVERYONE",
        disable_duet: false,
        disable_comment: false,
        disable_stitch: false
      },
      source_info: {
        source: "FILE_UPLOAD",
        video_size: file.size,
        chunk_size: file.size,
        total_chunk_count: 1
      }
    })
  });

  const initData = await initResp.json().catch(() => ({}));
  const uploadUrl = initData?.data?.upload_url;
  const publishId = initData?.data?.publish_id;

  if (!initResp.ok || !uploadUrl) {
    throw new Error(
      `TikTok init falhou: ${initData?.error?.message || `HTTP ${initResp.status}`}`
    );
  }

  const putResp = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": "video/mp4",
      "Content-Length": String(file.size),
      "Content-Range": `bytes 0-${file.size - 1}/${file.size}`
    },
    body: file.buffer
  });

  if (!putResp.ok) {
    throw new Error(`TikTok upload de bytes falhou (HTTP ${putResp.status})`);
  }

  return {
    provider: "tiktok",
    status: "processing",
    account: active.conta_nome || null,
    publishId: publishId || null
  };
}

/**
 * Meta Graph API - Instagram Reels
 * Exige IG_USER_ID e vídeo acessível por URL pública ou fluxo de upload Meta.
 */
async function publishToInstagram(conn, file, meta) {
  const active = await ensureValidConnection(conn);

  if (!process.env.ENABLE_LIVE_SOCIAL_PUBLISH) {
    return {
      provider: "instagram",
      status: "ready_or_simulated",
      account: active.conta_nome || null,
      detail: "Validação OK (ative ENABLE_LIVE_SOCIAL_PUBLISH='true' após configurar Meta Graph API)"
    };
  }

  const igUserId = meta.igUserId || process.env.META_IG_USER_ID;
  const videoUrl = meta.videoUrl; // URL pública temporária do MP4 se exigido pela Graph API

  if (!igUserId || !videoUrl) {
    throw new Error("Instagram exige igUserId e videoUrl pública acessível pela Meta Graph API");
  }

  const caption = `${meta.title || "Corte ClipFactory"} ${meta.hashtags || ""}`.trim().slice(0, 2200);

  const createResp = await fetch(`https://graph.facebook.com/v21.0/${igUserId}/media`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      media_type: "REELS",
      video_url: videoUrl,
      caption,
      access_token: active.access_token
    })
  });

  const created = await createResp.json().catch(() => ({}));
  if (!createResp.ok || !created.id) {
    throw new Error(`Instagram container falhou: ${created?.error?.message || `HTTP ${createResp.status}`}`);
  }

  const pubResp = await fetch(`https://graph.facebook.com/v21.0/${igUserId}/media_publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      creation_id: created.id,
      access_token: active.access_token
    })
  });

  const published = await pubResp.json().catch(() => ({}));
  if (!pubResp.ok || !published.id) {
    throw new Error(`Instagram publish falhou: ${published?.error?.message || `HTTP ${pubResp.status}`}`);
  }

  return {
    provider: "instagram",
    status: "published",
    account: active.conta_nome || null,
    mediaId: published.id
  };
}

/**
 * Meta Graph API - Facebook Page Video
 */
async function publishToFacebook(conn, file, meta) {
  const active = await ensureValidConnection(conn);

  if (!process.env.ENABLE_LIVE_SOCIAL_PUBLISH) {
    return {
      provider: "facebook",
      status: "ready_or_simulated",
      account: active.conta_nome || null,
      detail: "Validação OK (ative ENABLE_LIVE_SOCIAL_PUBLISH='true' após configurar Meta Graph API)"
    };
  }

  const pageId = meta.fbPageId || process.env.META_FB_PAGE_ID;
  if (!pageId) {
    throw new Error("Facebook exige fbPageId ou META_FB_PAGE_ID configurado");
  }

  const form = new FormData();
  form.append("access_token", active.access_token);
  form.append("title", String(meta.title || "Corte ClipFactory").slice(0, 255));
  form.append("description", `${meta.title || ""} ${meta.hashtags || ""}`.trim());
  form.append("source", new Blob([file.buffer], { type: "video/mp4" }), file.originalname || "clip.mp4");

  const resp = await fetch(`https://graph.facebook.com/v21.0/${pageId}/videos`, {
    method: "POST",
    body: form
  });

  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || !data.id) {
    throw new Error(`Facebook upload falhou: ${data?.error?.message || `HTTP ${resp.status}`}`);
  }

  return {
    provider: "facebook",
    status: "published",
    account: active.conta_nome || null,
    videoId: data.id
  };
}

/**
 * Kwai: sem API pública aberta padrão para envio direto de terceiros;
 * retorna share_ready para o PWA acionar o compartilhamento nativo do MP4.
 */
async function publishToKwai(conn) {
  return {
    provider: "kwai",
    status: "share_ready",
    account: conn.conta_nome || null,
    message: "Pronto para compartilhar o MP4 no dispositivo"
  };
}

const PUBLISHERS = {
  youtube: publishToYouTube,
  tiktok: publishToTikTok,
  instagram: publishToInstagram,
  facebook: publishToFacebook,
  kwai: publishToKwai
};

app.post("/api/publish-clip", upload.single("video"), async (req, res) => {
  try {
    if (!supabase) {
      return res.status(500).json({
        ok: false,
        error: "SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY não configurados no Render"
      });
    }

    const playerId = String(req.body.playerId || "").trim();
    if (!playerId) {
      return res.status(400).json({ ok: false, error: "playerId obrigatório" });
    }

    if (!req.file || !isMp4File(req.file)) {
      return res.status(400).json({ ok: false, error: "O envio para redes exige arquivo MP4" });
    }

    let requestedNets = [];
    try {
      const parsed = JSON.parse(req.body.networks || "[]");
      if (Array.isArray(parsed)) {
        requestedNets = parsed.map((n) => String(n).toLowerCase());
      }
    } catch (_) {}

    const { data: rows, error: dbErr } = await supabase
      .from("conexoes_sociais")
      .select("id_jogador, provedor, status, conta_nome, access_token, refresh_token, expires_at")
      .eq("id_jogador", playerId)
      .eq("status", "conectado");

    if (dbErr) {
      return res
        .status(500)
        .json({ ok: false, error: "Erro ao consultar conexões: " + dbErr.message });
    }

    const activeConns = (rows || []).filter(
      (r) => requestedNets.length === 0 || requestedNets.includes(r.provedor)
    );

    if (!activeConns.length) {
      return res.status(400).json({
        ok: false,
        error: "Nenhuma rede conectada encontrada para este jogador"
      });
    }

    const meta = {
      title: req.body.title || "Corte ClipFactory",
      hashtags: req.body.hashtags || "",
      igUserId: req.body.igUserId || "",
      fbPageId: req.body.fbPageId || "",
      videoUrl: req.body.videoUrl || ""
    };

    const settled = await Promise.allSettled(
      activeConns.map((conn) => {
        const fn = PUBLISHERS[conn.provedor];
        if (!fn) {
          return Promise.reject(new Error(`Provedor não suportado: ${conn.provedor}`));
        }
        return fn(conn, req.file, meta);
      })
    );

    const results = settled.map((item, idx) => {
      const provider = activeConns[idx].provedor;
      if (item.status === "fulfilled") {
        return { provider, ok: true, ...item.value };
      }
      return {
        provider,
        ok: false,
        status: "failed",
        error: item.reason?.message || "Falha ao enviar para a rede"
      };
    });

    return res.status(200).json({
      ok: true,
      playerId,
      fileName: req.file.originalname,
      sizeBytes: req.file.size,
      results
    });
  } catch (err) {
    return res
      .status(500)
      .json({ ok: false, error: err.message || "Erro interno no servidor" });
  }
});

app.get("/health", (_, res) => res.status(200).json({ ok: true }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`ClipFactory API rodando na porta ${PORT}`));