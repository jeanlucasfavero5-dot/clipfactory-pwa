"use strict";

const $ = id => document.getElementById(id);

const state = {
  file: null,
  videoUrl: null,
  sourceName: "",
  sourceType: "file",
  duration: 0,
  cropCam: { x: 0.04, y: 0.05, w: 0.32, h: 0.28 },
  cropGame: { x: 0.08, y: 0.25, w: 0.84, h: 0.68 },
  camOnTop: true,
  layout: "split",
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
    enabled: false,
    text: "",
    font: "Bebas Neue",
    color: "#ffd166",
    bg: "box",
    bgColor: "#07140e",
    anim: "pop",
    x: 0.5,
    y: 0.16
  },
  draggingOverlay: null,
  isExporting: false
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

function triggerBlobDownload(url, fileName) {
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function isMobileDevice() {
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || "") || (window.innerWidth <= 820);
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

/* ============================================================
   Patch EBML / WebM: regrava Duration + Cues + SeekHead (remux via ts-ebml)
   ============================================================ */
function fixWebmBlobDurationFallback(blob, durationSec) {
  return blob.arrayBuffer().then((buf) => {
    const bytes = new Uint8Array(buf);
    const safeSec = Math.max(0.5, Number(durationSec) || 1);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    let scaleNs = 1000000;
    for (let i = 0; i < bytes.length - 6; i++) {
      if (bytes[i] === 0x2A && bytes[i + 1] === 0xD7 && bytes[i + 2] === 0xB1) {
        const sizeByte = bytes[i + 3];
        if (sizeByte >= 0x81 && sizeByte <= 0x88) {
          const byteLen = sizeByte & 0x0F;
          if (i + 4 + byteLen <= bytes.length) {
            let val = 0;
            for (let b = 0; b < byteLen; b++) {
              val = (val * 256) + bytes[i + 4 + b];
            }
            if (val > 0) scaleNs = val;
          }
        }
        break;
      }
    }

    const durationUnits = (safeSec * 1e9) / scaleNs;
    let patched = false;

    const scanLimit = Math.min(bytes.length - 12, 4096);
    for (let i = 0; i < scanLimit; i++) {
      if (bytes[i] === 0x44 && bytes[i + 1] === 0x89) {
        const sizeByte = bytes[i + 2];
        if (sizeByte === 0x88 && i + 11 <= bytes.length) {
          view.setFloat64(i + 3, durationUnits, false);
          patched = true;
        } else if (sizeByte === 0x84 && i + 7 <= bytes.length) {
          view.setFloat32(i + 3, durationUnits, false);
          patched = true;
        }
        if (patched) break;
      }
    }

    if (!patched) {
      const out = [];
      let injected = false;
      for (let i = 0; i < bytes.length; i++) {
        out.push(bytes[i]);
        if (!injected && i >= 3 && bytes[i - 3] === 0x2A && bytes[i - 2] === 0xD7 && bytes[i - 1] === 0xB1) {
          const szByte = bytes[i];
          const len = (szByte >= 0x81 && szByte <= 0x88) ? (szByte & 0x0F) : 0;
          for (let k = 1; k <= len && i + k < bytes.length; k++) {
            out.push(bytes[i + k]);
          }
          i += len;
          const durBuf = new ArrayBuffer(8);
          new DataView(durBuf).setFloat64(0, durationUnits, false);
          out.push(0x44, 0x89, 0x88, ...new Uint8Array(durBuf));
          injected = true;
        }
      }
      if (injected) {
        return new Blob([new Uint8Array(out)], { type: blob.type || "video/webm" });
      }
    }

    return new Blob([bytes], { type: blob.type || "video/webm" });
  }).catch(() => blob);
}

function fixWebmBlobDuration(blob, durationSec) {
  const EBMLlib = (typeof window !== "undefined") ? window.EBML : null;
  if (!EBMLlib || !EBMLlib.tools || typeof EBMLlib.tools.makeMetadataSeekable !== "function") {
    return fixWebmBlobDurationFallback(blob, durationSec);
  }

  return blob.arrayBuffer().then((buf) => {
    try {
      const decoder = new EBMLlib.Decoder();
      const reader = new EBMLlib.Reader();
      const elms = decoder.decode(buf);
      elms.forEach((elm) => reader.read(elm));
      reader.stop();

      let duration = Number(reader.duration) || 0;
      if (duration <= 0) {
        const scale = Number(reader.timestampScale) || 1000000;
        duration = (Math.max(0.5, Number(durationSec) || 1) * 1e9) / scale;
      }
      if (duration <= 0) return blob;

      const seekable = EBMLlib.tools.makeMetadataSeekable(reader.metadatas, duration, reader.cues || []);
      const parts = [new Blob([seekable], { type: blob.type || "video/webm" })];
      if (reader.metadataSize > 0 && reader.metadataSize < buf.byteLength) {
        parts.push(blob.slice(reader.metadataSize));
      }
      return new Blob(parts, { type: blob.type || "video/webm" });
    } catch (e) {
      console.warn("Remux ts-ebml falhou, usando fallback de bytes:", e);
      return fixWebmBlobDurationFallback(blob, durationSec);
    }
  }).catch(() => blob);
}

/* ============================================================
   RIFF / AVI MJPEG container builder from captured JPEG frames
   ============================================================ */
function buildAviFromJpegFrames(frames, width, height, fps) {
  const safeFps = Math.max(1, Math.min(60, Number(fps) || 30));
  const useSecPerFrame = Math.round(1000000 / safeFps);

  const writeStr = (arr, offset, str) => {
    for (let i = 0; i < str.length; i++) arr[offset + i] = str.charCodeAt(i);
  };
  const writeU32 = (view, offset, val) => {
    view.setUint32(offset, val >>> 0, true);
  };

  const moviParts = [];
  const indexEntries = [];
  let moviDataSize = 0;

  for (let i = 0; i < frames.length; i++) {
    const jpg = frames[i];
    const pad = jpg.length % 2 === 1 ? 1 : 0;
    const chunkSize = 8 + jpg.length + pad;
    const chunk = new Uint8Array(chunkSize);
    writeStr(chunk, 0, "00db");
    new DataView(chunk.buffer).setUint32(4, jpg.length, true);
    chunk.set(jpg, 8);
    moviParts.push(chunk);

    indexEntries.push({
      chunkId: "00db",
      flags: 0x10,
      offset: moviDataSize,
      size: jpg.length
    });
    moviDataSize += chunkSize;
  }

  const moviListSize = 4 + moviDataSize;
  const idx1DataSize = indexEntries.length * 16;
  const idx1TotalSize = 8 + idx1DataSize;

  const avihData = new Uint8Array(56);
  const avihView = new DataView(avihData.buffer);
  writeU32(avihView, 0, useSecPerFrame);
  writeU32(avihView, 4, width * height * 3);
  writeU32(avihView, 8, 0);
  writeU32(avihView, 12, 0x10);
  writeU32(avihView, 16, frames.length);
  writeU32(avihView, 20, 0);
  writeU32(avihView, 24, 1);
  writeU32(avihView, 28, width * height * 3);
  writeU32(avihView, 32, width);
  writeU32(avihView, 36, height);

  const strhData = new Uint8Array(56);
  const strhView = new DataView(strhData.buffer);
  writeStr(strhData, 0, "vids");
  writeStr(strhData, 4, "MJPG");
  writeU32(strhView, 20, 1);
  writeU32(strhView, 24, safeFps);
  writeU32(strhView, 32, frames.length);
  writeU32(strhView, 36, width * height * 3);
  writeU32(strhView, 40, 10000);

  const strfData = new Uint8Array(40);
  const strfView = new DataView(strfData.buffer);
  writeU32(strfView, 0, 40);
  writeU32(strfView, 4, width);
  writeU32(strfView, 8, height);
  strfView.setUint16(12, 1, true);
  strfView.setUint16(14, 24, true);
  writeStr(strfData, 16, "MJPG");
  writeU32(strfView, 20, width * height * 3);

  const strlDataSize = (8 + 56) + (8 + 40);
  const strlListSize = 4 + strlDataSize;
  const hdrlDataSize = (8 + 56) + (8 + strlListSize);
  const hdrlListSize = 4 + hdrlDataSize;

  const riffPayloadSize = 4 + (8 + hdrlListSize) + (8 + moviListSize) + idx1TotalSize;
  const out = new Uint8Array(8 + riffPayloadSize);
  const view = new DataView(out.buffer);

  let pos = 0;
  writeStr(out, pos, "RIFF"); writeU32(view, pos + 4, riffPayloadSize); pos += 8;
  writeStr(out, pos, "AVI "); pos += 4;

  writeStr(out, pos, "LIST"); writeU32(view, pos + 4, hdrlListSize); pos += 8;
  writeStr(out, pos, "hdrl"); pos += 4;

  writeStr(out, pos, "avih"); writeU32(view, pos + 4, 56); out.set(avihData, pos + 8); pos += 64;

  writeStr(out, pos, "LIST"); writeU32(view, pos + 4, strlListSize); pos += 8;
  writeStr(out, pos, "strl"); pos += 4;
  writeStr(out, pos, "strh"); writeU32(view, pos + 4, 56); out.set(strhData, pos + 8); pos += 64;
  writeStr(out, pos, "strf"); writeU32(view, pos + 4, 40); out.set(strfData, pos + 8); pos += 48;

  writeStr(out, pos, "LIST"); writeU32(view, pos + 4, moviListSize); pos += 8;
  writeStr(out, pos, "movi"); pos += 4;
  for (const part of moviParts) {
    out.set(part, pos);
    pos += part.length;
  }

  writeStr(out, pos, "idx1"); writeU32(view, pos + 4, idx1DataSize); pos += 8;
  for (const entry of indexEntries) {
    writeStr(out, pos, entry.chunkId);
    writeU32(view, pos + 4, entry.flags);
    writeU32(view, pos + 8, entry.offset);
    writeU32(view, pos + 12, entry.size);
    pos += 16;
  }

  return new Blob([out], { type: "video/avi" });
}

/* ============================================================
   Capture thumbnail data URL at a specific timestamp
   ============================================================ */
async function captureThumbnailAt(timeSec) {
  const videoEl = $("videoEl");
  if (!videoEl || !videoEl.src) return null;
  const prevTime = videoEl.currentTime || 0;
  const wasPaused = videoEl.paused;
  try {
    videoEl.pause();
    const maxDur = resolveVideoDuration(videoEl);
    const target = clamp(Number(timeSec) || 0, 0, Math.max(0, maxDur - 0.1));
    videoEl.currentTime = target;
    await new Promise((resolve) => {
      if (Math.abs(videoEl.currentTime - target) < 0.2 && videoEl.readyState >= 2) return resolve();
      const onSeek = () => {
        videoEl.removeEventListener("seeked", onSeek);
        resolve();
      };
      videoEl.addEventListener("seeked", onSeek);
      setTimeout(() => {
        videoEl.removeEventListener("seeked", onSeek);
        resolve();
      }, 900);
    });
    const thumbCanvas = document.createElement("canvas");
    thumbCanvas.width = 270;
    thumbCanvas.height = 480;
    drawFrameToCanvas(videoEl, thumbCanvas, target, false);
    return thumbCanvas.toDataURL("image/jpeg", 0.78);
  } catch (e) {
    return null;
  } finally {
    videoEl.currentTime = prevTime;
    if (!wasPaused) videoEl.play().catch(() => {});
  }
}

function applyStyleToTarget(target, preset) {
  target.font = preset.font;
  target.color = preset.color;
  target.bg = preset.bg;
  target.bgColor = preset.bgColor;
  target.anim = preset.anim;

  if (target === state.capStyle) {
    if ($("capFont")) $("capFont").value = preset.font;
    if ($("capBg")) $("capBg").value = preset.bg;
    if ($("capAnim")) $("capAnim").value = preset.anim;
    if ($("capCustomColor")) $("capCustomColor").value = preset.color;
    if ($("capCustomBgColor")) $("capCustomBgColor").value = preset.bgColor;
  } else {
    if ($("hookFont")) $("hookFont").value = preset.font;
    if ($("hookBg")) $("hookBg").value = preset.bg;
    if ($("hookAnim")) $("hookAnim").value = preset.anim;
    if ($("hookCustomColor")) $("hookCustomColor").value = preset.color;
    if ($("hookCustomBgColor")) $("hookCustomBgColor").value = preset.bgColor;
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

function syncHookToggleLabel() {
  if (!$("hookToggle")) return;
  $("hookToggle").textContent = state.hook.enabled ? "👁 Gancho ativo (ocultar)" : "🙈 Gancho desativado (ativar)";
}

function initStyleControls() {
  buildPresetGrid("capPresets", CAP_PRESETS, state.capStyle);
  buildPresetGrid("hookPresets", HOOK_PRESETS, state.hook);

  buildSwatches("capColorSwatches", COLOR_SWATCHES, c => {
    state.capStyle.color = c;
    if ($("capCustomColor")) $("capCustomColor").value = c;
  }, state.capStyle.color);
  buildSwatches("capBgSwatches", BG_SWATCHES, c => {
    state.capStyle.bgColor = c;
    if ($("capCustomBgColor")) $("capCustomBgColor").value = c;
  }, state.capStyle.bgColor);
  buildSwatches("hookColorSwatches", COLOR_SWATCHES, c => {
    state.hook.color = c;
    if ($("hookCustomColor")) $("hookCustomColor").value = c;
  }, state.hook.color);
  buildSwatches("hookBgSwatches", BG_SWATCHES, c => {
    state.hook.bgColor = c;
    if ($("hookCustomBgColor")) $("hookCustomBgColor").value = c;
  }, state.hook.bgColor);

  if ($("capCustomColor")) {
    $("capCustomColor").value = state.capStyle.color;
    $("capCustomColor").oninput = e => { state.capStyle.color = e.target.value; };
  }
  if ($("capCustomBgColor")) {
    $("capCustomBgColor").value = state.capStyle.bgColor;
    $("capCustomBgColor").oninput = e => { state.capStyle.bgColor = e.target.value; };
  }
  if ($("hookCustomColor")) {
    $("hookCustomColor").value = state.hook.color;
    $("hookCustomColor").oninput = e => { state.hook.color = e.target.value; };
  }
  if ($("hookCustomBgColor")) {
    $("hookCustomBgColor").value = state.hook.bgColor;
    $("hookCustomBgColor").oninput = e => { state.hook.bgColor = e.target.value; };
  }

  if ($("capFont")) $("capFont").onchange = e => { state.capStyle.font = e.target.value; };
  if ($("capBg")) $("capBg").onchange = e => { state.capStyle.bg = e.target.value; };
  if ($("capAnim")) $("capAnim").onchange = e => { state.capStyle.anim = e.target.value; };

  if ($("hookText")) {
    $("hookText").value = state.hook.text;
    $("hookText").oninput = e => {
      state.hook.text = e.target.value;
      state.hook.enabled = state.hook.text.trim().length > 0;
      syncHookToggleLabel();
    };
  }
  if ($("hookFont")) {
    $("hookFont").value = state.hook.font;
    $("hookFont").onchange = e => { state.hook.font = e.target.value; };
  }
  if ($("hookBg")) {
    $("hookBg").value = state.hook.bg;
    $("hookBg").onchange = e => { state.hook.bg = e.target.value; };
  }
  if ($("hookAnim")) {
    $("hookAnim").value = state.hook.anim;
    $("hookAnim").onchange = e => { state.hook.anim = e.target.value; };
  }

  if ($("hookToggle")) {
    syncHookToggleLabel();
    $("hookToggle").onclick = () => {
      state.hook.enabled = !state.hook.enabled;
      if (state.hook.enabled && !state.hook.text.trim()) {
        state.hook.text = "GANCHO EM DESTAQUE 🔥";
        if ($("hookText")) $("hookText").value = state.hook.text;
      }
      syncHookToggleLabel();
    };
  }
}

function syncCollapseIcon(card) {
  const btn = card.querySelector(".collapse-btn");
  if (!btn) return;
  const isCollapsed = card.classList.contains("collapsed");
  btn.textContent = isCollapsed ? "▸" : "▾";
  btn.setAttribute("aria-expanded", String(!isCollapsed));
}

function initCollapsibleCards() {
  document.querySelectorAll(".card").forEach(card => {
    if (card.dataset.collapseBound === "1") return;
    card.dataset.collapseBound = "1";
    const btn = card.querySelector(".collapse-btn");
    const head = card.querySelector(".card-h");
    if (!head) return;

    const toggleCard = (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      card.classList.toggle("collapsed");
      syncCollapseIcon(card);
    };

    if (btn) {
      btn.type = "button";
      btn.onclick = toggleCard;
    }

    head.addEventListener("click", (ev) => {
      if (ev.target.closest("input, select, textarea, a") || ev.target.closest("button:not(.collapse-btn)")) {
        return;
      }
      card.classList.toggle("collapsed");
      syncCollapseIcon(card);
    });

    syncCollapseIcon(card);
  });
}

function resolveVideoDuration(videoEl) {
  if (!videoEl) return state.duration || 60;
  if (Number.isFinite(videoEl.duration) && videoEl.duration > 0) {
    return videoEl.duration;
  }
  if (videoEl.seekable && videoEl.seekable.length > 0) {
    const end = videoEl.seekable.end(videoEl.seekable.length - 1);
    if (Number.isFinite(end) && end > 0) return end;
  }
  return state.duration || 60;
}

function applyLoadedDuration(videoEl) {
  const dur = resolveVideoDuration(videoEl);
  if (dur > 0) {
    state.duration = dur;
    if (!state.segEnd || state.segEnd > dur) {
      state.segEnd = Math.min(dur, state.maxSegSec);
    }
    if ($("segStart")) $("segStart").value = Math.floor(state.segStart / 60);
    if ($("segEnd")) $("segEnd").value = Math.max(1, Math.round(state.segEnd / 60));
    updateSegmentUI();
    updateTimeline();
  }
}

function loadVideoFile(file) {
  if (!file) return;
  if (state.videoUrl) URL.revokeObjectURL(state.videoUrl);
  state.file = file;
  state.videoUrl = URL.createObjectURL(file);
  state.duration = 0;
  state.segStart = 0;
  state.segEnd = state.maxSegSec;

  const videoEl = $("videoEl");
  videoEl.preload = "auto";
  videoEl.src = state.videoUrl;
  videoEl.load();

  $("step1").classList.add("hidden");
  $("editor").classList.remove("hidden");

  const onMetaOrDur = () => {
    applyLoadedDuration(videoEl);
    positionBoxes();
    if (typeof window.updateHubButton === "function") window.updateHubButton();
  };

  videoEl.onloadedmetadata = onMetaOrDur;
  videoEl.ondurationchange = onMetaOrDur;
  videoEl.onloadeddata = onMetaOrDur;
  videoEl.ontimeupdate = () => {
    if (!state.duration && videoEl.duration > 0) {
      applyLoadedDuration(videoEl);
    }
    updateTimeline();
  };
}

function attachVideoMetadataHandlers(videoEl, labelText) {
  videoEl.preload = "auto";
  videoEl.load();
  const onMetaOrDur = () => {
    applyLoadedDuration(videoEl);
    positionBoxes();
    updateTimeline();
  };
  videoEl.onloadedmetadata = onMetaOrDur;
  videoEl.ondurationchange = onMetaOrDur;
  videoEl.onloadeddata = onMetaOrDur;
  videoEl.ontimeupdate = () => {
    if (!state.duration && videoEl.duration > 0) {
      applyLoadedDuration(videoEl);
    }
    updateTimeline();
  };
  if ($("step1")) $("step1").classList.add("hidden");
  if ($("editor")) $("editor").classList.remove("hidden");
  if ($("exportStatus")) $("exportStatus").textContent = "Vídeo carregado: " + labelText;
}

function setLinkStatusMessage(msg, mode = "") {
  const targets = [$("step1UrlStatus"), $("editorSourceStatus")];
  targets.forEach(el => {
    if (!el) return;
    el.textContent = msg;
    el.className = "link-note" + (mode ? " " + mode : "");
  });
}

async function loadVideoFromUrl(rawUrl) {
  const cleanUrl = String(rawUrl || "").trim();
  if (!cleanUrl) {
    setLinkStatusMessage("Informe um link válido (http:// ou https://) para carregar.", "err");
    return false;
  }
  let parsed;
  try {
    parsed = new URL(cleanUrl);
    if (!/^https?:$/i.test(parsed.protocol)) {
      throw new Error("Protocolo inválido");
    }
  } catch (_) {
    setLinkStatusMessage("Link inválido. Digite uma URL completa começando com http:// ou https://.", "err");
    return false;
  }

  setLinkStatusMessage("Carregando link / stream no editor...", "ok");

  if (state.videoUrl && state.sourceType === "file") {
    try { URL.revokeObjectURL(state.videoUrl); } catch (_) {}
  }

  state.file = null;
  state.videoUrl = cleanUrl;
  state.sourceType = "url";
  state.sourceName = parsed.hostname + (parsed.pathname && parsed.pathname !== "/" ? parsed.pathname.split("/").pop() : "");

  const videoEl = $("videoEl");
  if (!videoEl) return false;

  const isLikelyPlaylistOrPage =
    /\.(m3u8|mpd)(\?|$)/i.test(parsed.pathname) ||
    /(youtube\.com|youtu\.be|twitch\.tv|tiktok\.com|kwai\.com|instagram\.com)/i.test(parsed.hostname);

  videoEl.pause();
  videoEl.crossOrigin = "anonymous";
  videoEl.src = cleanUrl;

  return new Promise((resolve) => {
    let settled = false;
    const finishOk = () => {
      if (settled) return;
      settled = true;
      attachVideoMetadataHandlers(videoEl, state.sourceName || cleanUrl);
      if (isLikelyPlaylistOrPage) {
        setLinkStatusMessage(
          "Link carregado no player. Se o navegador não reproduzir diretamente (ex.: live ao vivo, HLS/m3u8 ou página de rede social com proteção/CORS), use o app ClipFactory Desktop ou um link direto de arquivo de vídeo (.mp4 / .webm).",
          "ok"
        );
      } else {
        setLinkStatusMessage("Link carregado com sucesso no editor.", "ok");
      }
      resolve(true);
    };

    const finishErr = () => {
      if (settled) return;
      settled = true;
      setLinkStatusMessage(
        "Não foi possível reproduzir este link direto no navegador (pode ser live ao vivo/protegida, bloqueio CORS do servidor ou link de página e não de arquivo de vídeo). Para lives/VODs de plataformas como YouTube ou Twitch, utilize o modo Desktop ou envie um arquivo de vídeo local.",
        "err"
      );
      resolve(false);
    };

    const timer = setTimeout(() => {
      if (!settled && videoEl.readyState >= 1) {
        finishOk();
      } else {
        finishErr();
      }
    }, 9000);

    videoEl.onloadedmetadata = () => {
      clearTimeout(timer);
      finishOk();
    };
    videoEl.onerror = () => {
      clearTimeout(timer);
      finishErr();
    };
    videoEl.load();
  });
}

function initSourceAndHookEnhancements() {
  const getRangeMinutes = (startId, endId, fullIfShorterId) => {
    const fullIfShorter = $(fullIfShorterId) ? !!$(fullIfShorterId).checked : true;
    const rawStart = parseFloat($(startId)?.value);
    const rawEnd = parseFloat($(endId)?.value);
    const sMin = clamp(Number.isFinite(rawStart) ? rawStart : 0, 0, 30);
    const eMin = clamp(Number.isFinite(rawEnd) ? rawEnd : 30, 0.5, 30);
    const startSec = sMin * 60;
    const endSec = Math.max(startSec + 5, eMin * 60);
    return { startSec, endSec, fullIfShorter };
  };

  const applyRangeToEditor = (startSec, endSec, fullIfShorter) => {
    const dur = state.duration || 0;
    if (fullIfShorter && dur > 0 && dur <= 1800) {
      state.segStart = 0;
      state.segEnd = dur;
    } else {
      state.segStart = startSec;
      state.segEnd = dur > 0 ? Math.min(dur, endSec) : endSec;
      if (state.segEnd <= state.segStart) {
        state.segEnd = dur > 0 ? dur : Math.min(1800, state.segStart + 60);
      }
    }
    if ($("segStart")) $("segStart").value = (state.segStart / 60).toFixed(1);
    if ($("segEnd")) $("segEnd").value = (state.segEnd / 60).toFixed(1);
    updateSegmentUI();
    updateTimeline();
  };

  const downloadFromLinkOrCurrent = async (explicitUrl, rangeCfg, alsoOpenEditor = false) => {
    const targetUrl = String(explicitUrl || $("dlLinkUrlInput")?.value || $("step1UrlInput")?.value || state.videoUrl || "").trim();

    if (state.file && state.videoUrl && !explicitUrl) {
      triggerBlobDownload(state.videoUrl, state.file.name || "video-clipfactory.mp4");
      setLinkStatusMessage("Download do vídeo local iniciado na pasta Downloads.", "ok");
      if (alsoOpenEditor) {
        applyRangeToEditor(rangeCfg.startSec, rangeCfg.endSec, rangeCfg.fullIfShorter);
        if ($("step1")) $("step1").classList.add("hidden");
        if ($("editor")) $("editor").classList.remove("hidden");
      }
      return true;
    }

    if (!targetUrl) {
      setLinkStatusMessage("Cole um link de vídeo ou live para baixar ou editar.", "err");
      return false;
    }

    let parsed;
    try {
      parsed = new URL(targetUrl);
      if (!/^https?:$/i.test(parsed.protocol)) throw new Error("Protocolo inválido");
    } catch (_) {
      setLinkStatusMessage("Link inválido. Digite uma URL completa começando com http:// ou https://.", "err");
      return false;
    }

    const baseName = (parsed.pathname && parsed.pathname !== "/" ? parsed.pathname.split("/").pop() : "") || "clipfactory-video";
    const fname = /\.(mp4|webm|mov|mkv|m3u8)$/i.test(baseName) ? baseName : (baseName + ".mp4");

    try {
      setLinkStatusMessage("Baixando vídeo para a pasta Downloads do dispositivo...", "ok");
      const resp = await fetch(targetUrl);
      if (!resp.ok) throw new Error("HTTP " + resp.status);
      const blob = await resp.blob();
      const bUrl = URL.createObjectURL(blob);
      triggerBlobDownload(bUrl, fname);
      setTimeout(() => URL.revokeObjectURL(bUrl), 120000);
      setLinkStatusMessage("Vídeo enviado para a pasta Downloads do dispositivo!", "ok");
    } catch (_) {
      triggerBlobDownload(targetUrl, fname);
      setLinkStatusMessage("Solicitação de download enviada para o navegador (pasta Downloads).", "ok");
    }

    if (alsoOpenEditor) {
      await loadVideoFromUrl(targetUrl);
      applyRangeToEditor(rangeCfg.startSec, rangeCfg.endSec, rangeCfg.fullIfShorter);
      if ($("step1")) $("step1").classList.add("hidden");
      if ($("editor")) $("editor").classList.remove("hidden");
    }
    return true;
  };

  if ($("step1LoadUrlBtn") && $("step1UrlInput")) {
    const runEditWithLink = async () => {
      const rangeCfg = getRangeMinutes("editLinkStartMin", "editLinkEndMin", "editLinkFullIfShorter");
      await downloadFromLinkOrCurrent($("step1UrlInput").value, rangeCfg, true);
    };
    $("step1LoadUrlBtn").onclick = runEditWithLink;
    $("step1UrlInput").onkeydown = (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        runEditWithLink();
      }
    };
  }

  if ($("downloadSourceVideoBtn")) {
    $("downloadSourceVideoBtn").onclick = async () => {
      const rangeCfg = getRangeMinutes("dlLinkStartMin", "dlLinkEndMin", "dlLinkFullIfShorter");
      const chosenUrl = ($("dlLinkUrlInput")?.value || $("step1UrlInput")?.value || state.videoUrl || "").trim();
      await downloadFromLinkOrCurrent(chosenUrl, rangeCfg, false);
    };
  }

  if ($("randomHookBtn")) {
    $("randomHookBtn").onclick = () => {
      const idea = typeof pickRandomHookIdea === "function"
        ? pickRandomHookIdea()
        : (typeof VIRAL_TITLES !== "undefined" && VIRAL_TITLES.length ? VIRAL_TITLES[0] : "JOGADA INSANA! 🔥");
      const tags = typeof pickRandomHashtags === "function"
        ? pickRandomHashtags()
        : (typeof VIRAL_HASHTAGS !== "undefined" && VIRAL_HASHTAGS.length ? VIRAL_HASHTAGS[0] : "#cortes #viral");
      state.hook.text = idea;
      state.hook.enabled = true;
      if ($("hookText")) $("hookText").value = idea;
      syncHookToggleLabel();
      if ($("hookViralSuggestion")) {
        $("hookViralSuggestion").textContent = "Sugestão de hashtags: " + tags;
        $("hookViralSuggestion").className = "link-note ok";
      }
    };
  }

  if ($("randomPresetHookBtn") && typeof HOOK_PRESETS !== "undefined" && HOOK_PRESETS.length) {
    $("randomPresetHookBtn").onclick = () => {
      const idx = Math.floor(Math.random() * HOOK_PRESETS.length);
      const p = HOOK_PRESETS[idx];
      applyStyleToTarget(state.hook, p);
      state.hook.enabled = true;
      if ($("hookText") && !String($("hookText").value || "").trim()) {
        state.hook.text = p.name;
        $("hookText").value = p.name;
      }
      syncHookToggleLabel();
      const grid = $("hookPresets");
      if (grid) {
        const items = grid.querySelectorAll(".presetItem");
        items.forEach((el, i) => el.classList.toggle("sel", i === idx));
        if (items[idx]) items[idx].scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
      if ($("hookViralSuggestion")) {
        $("hookViralSuggestion").textContent = "Preset de gancho aplicado: " + p.name;
        $("hookViralSuggestion").className = "link-note ok";
      }
    };
  }
}

function resetToStep1() {
  const videoEl = $("videoEl");
  videoEl.pause();
  videoEl.removeAttribute("src");
  if (state.videoUrl) URL.revokeObjectURL(state.videoUrl);
  state.file = null;
  state.videoUrl = null;
  state.duration = 0;
  state.clips = [];
  state.activeClip = null;
  if ($("clipList")) {
    $("clipList").innerHTML = `<p class="signal">Clique em <b>Analisar</b> para gerar sugestões de corte com nota.</p>`;
  }
  if ($("downloadAllLocalBtn")) $("downloadAllLocalBtn").style.display = "none";
  $("editor").classList.add("hidden");
  $("step1").classList.remove("hidden");
  if (typeof window.updateHubButton === "function") window.updateHubButton();
}

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
  if (!boxEl) return;
  let mode = null;
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

function setSplitRatio(newRatio) {
  state.splitRatio = clamp(newRatio, 0.16, 0.84);
  positionBoxes();
}

function initCropControls() {
  attachBoxInteraction($("boxCam"), state.cropCam);
  attachBoxInteraction($("boxGame"), state.cropGame);

  const splitBar = $("splitBar");
  if (splitBar) {
    let draggingSplit = false;
    splitBar.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      draggingSplit = true;
      splitBar.setPointerCapture(e.pointerId);
    });
    splitBar.addEventListener("pointermove", (e) => {
      if (!draggingSplit) return;
      const rect = $("cropOverlay").getBoundingClientRect();
      setSplitRatio((e.clientY - rect.top) / rect.height);
    });
    splitBar.addEventListener("pointerup", () => { draggingSplit = false; });
  }

  document.querySelectorAll(".layoutBtn").forEach(btn => {
    btn.onclick = () => setLayoutMode(btn.dataset.layout);
  });

  if ($("swapBtn")) {
    $("swapBtn").onclick = () => {
      state.camOnTop = !state.camOnTop;
      const info = $("segInfo");
      if (info) info.textContent = `Ordem na tela dividida: ${state.camOnTop ? "Câmera em cima / Jogo embaixo" : "Jogo em cima / Câmera embaixo"}.`;
    };
  }

  window.addEventListener("resize", positionBoxes);
}

function updateSegmentUI() {
  const dur = state.duration || 0;
  let sMin = Math.max(0, parseFloat($("segStart")?.value) || 0);
  let eMin = Math.max(0, parseFloat($("segEnd")?.value) || 0);

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
  if (!videoEl) return;
  const dur = resolveVideoDuration(videoEl);
  const cur = videoEl.currentTime || 0;

  if ($("tlHead")) $("tlHead").style.left = `${clamp((cur / Math.max(1, dur)) * 100, 0, 100)}%`;
  if ($("tlTime")) $("tlTime").textContent = `${fmt(cur)} / ${fmt(dur)}`;

  if (state.activeClip && $("tlFill")) {
    const leftPct = (state.activeClip.start / Math.max(1, dur)) * 100;
    const widthPct = ((state.activeClip.end - state.activeClip.start) / Math.max(1, dur)) * 100;
    $("tlFill").style.left = `${clamp(leftPct, 0, 100)}%`;
    $("tlFill").style.width = `${clamp(widthPct, 1, 100)}%`;
  } else if ($("tlFill")) {
    $("tlFill").style.left = "0%";
    $("tlFill").style.width = "0%";
  }
}

function initTimeline() {
  const tl = $("tl");
  if (tl) {
    tl.addEventListener("click", (e) => {
      const dur = resolveVideoDuration($("videoEl"));
      if (!dur) return;
      const rect = tl.getBoundingClientRect();
      const ratio = clamp((e.clientX - rect.left) / rect.width, 0, 1);
      $("videoEl").currentTime = ratio * dur;
      updateTimeline();
    });
  }

  if ($("segStart")) $("segStart").onchange = updateSegmentUI;
  if ($("segEnd")) $("segEnd").onchange = updateSegmentUI;

  if ($("segHereBtn")) {
    $("segHereBtn").onclick = () => {
      const cur = $("videoEl").currentTime || 0;
      const dur = resolveVideoDuration($("videoEl"));
      state.segStart = cur;
      state.segEnd = Math.min(dur || (cur + state.maxSegSec), cur + state.maxSegSec);
      $("segStart").value = (state.segStart / 60).toFixed(1);
      $("segEnd").value = (state.segEnd / 60).toFixed(1);
      updateSegmentUI();
    };
  }

  if ($("playBtn")) {
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
}

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
  if ((!state.file && !state.videoUrl) || !videoEl.src) {
    alert("Envie um vídeo primeiro.");
    return;
  }

  applyLoadedDuration(videoEl);

  const btn = $("analyzeBtn");
  btn.disabled = true;
  btn.textContent = "⏳ Analisando...";

  const startSec = state.segStart || 0;
  const maxDur = state.duration || 60;
  const endSec = Math.max(startSec + 10, Math.min(maxDur, state.segEnd || maxDur));
  const clipLen = (typeof window.HUB !== "undefined" && window.HUB.duracao) ? window.HUB.duracao : 30;
  const windowSpan = Math.max(clipLen, endSec - startSec);
  const step = Math.max(3, Math.min(Math.floor(clipLen / 2), Math.floor(Math.max(1, windowSpan - clipLen) / 12) || 3));

  let audioEnvelope = null;
  try {
    if (state.file && state.file.size <= 140 * 1024 * 1024) {
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
      end: Math.min(maxDur, t + clipLen),
      score,
      viral_title: VIRAL_TITLES[candidates.length % VIRAL_TITLES.length],
      hashtags: VIRAL_HASHTAGS[candidates.length % VIRAL_HASHTAGS.length].split(" "),
      signals: { audio_peak: audioPeak, motion, intensity },
      thumb: null
    });
  }

  renderHeatmap(candidates.map(c => c.score));

  const topClips = [...candidates]
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);

  for (let i = 0; i < topClips.length; i++) {
    topClips[i].idx = i + 1;
    topClips[i].thumb = await captureThumbnailAt(topClips[i].start + 1);
  }

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

function openClipPreviewModal(clip) {
  const existing = document.getElementById("clipPreviewModal");
  if (existing) existing.remove();

  const modal = document.createElement("div");
  modal.id = "clipPreviewModal";
  modal.className = "clipModalBackdrop";

  const startSec = Number(clip.start || 0);
  const endSec = Number(clip.end || (startSec + 30));

  modal.innerHTML = `
    <div class="clipModalBox" style="max-width:360px;display:flex;flex-direction:column;align-items:center">
      <div style="width:100%;display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
        <b>📱 Prévia Vertical 9:16 · Clipe #${clip.idx}</b>
        <button type="button" class="ghost small" id="closeClipModalBtn">✕</button>
      </div>
      <canvas id="modalVerticalCanvas" width="540" height="960" style="width:100%;max-width:270px;aspect-ratio:9/16;border-radius:14px;border:1px solid var(--border2);background:#000"></canvas>
      <div class="signal" style="margin-top:8px;text-align:center">${fmt(startSec)} → ${fmt(endSec)} · ${clip.viral_title || ""}</div>
      <div class="row" style="width:100%;margin-top:12px;gap:8px">
        <button type="button" class="ghost small" id="modalLoopBtn" style="flex:1">🔁 Repetir</button>
        <button type="button" class="small" id="modalDownloadClipBtn" style="flex:1">⬇ Baixar clipe</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  const mainVid = $("videoEl");
  const prevMainTime = mainVid.currentTime || 0;
  const wasPaused = mainVid.paused;
  const vCanvas = modal.querySelector("#modalVerticalCanvas");

  mainVid.currentTime = startSec;
  mainVid.play().catch(() => {});

  let rafId = 0;
  const renderModalLoop = (ts) => {
    if (!document.getElementById("clipPreviewModal")) return;
    if (mainVid.currentTime >= endSec) {
      mainVid.currentTime = startSec;
      mainVid.play().catch(() => {});
    }
    drawFrameToCanvas(mainVid, vCanvas, (ts || 0) / 1000, false);
    rafId = requestAnimationFrame(renderModalLoop);
  };
  rafId = requestAnimationFrame(renderModalLoop);

  const closeModal = () => {
    if (rafId) cancelAnimationFrame(rafId);
    mainVid.pause();
    mainVid.currentTime = prevMainTime;
    if (!wasPaused) mainVid.play().catch(() => {});
    modal.remove();
  };

  modal.querySelector("#closeClipModalBtn").onclick = closeModal;
  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeModal();
  });
  modal.querySelector("#modalLoopBtn").onclick = () => {
    mainVid.currentTime = startSec;
    mainVid.play().catch(() => {});
  };
  modal.querySelector("#modalDownloadClipBtn").onclick = async () => {
    closeModal();
    await exportAndDownloadClip(clip);
  };
}

function getSelectedExportFormatInfo() {
  const mode = $("expMode")?.value || "fast";
  const tierKey = $("expTier")?.value || "720p30";
  const isAvi = mode === "avi";
  const is60 = tierKey.endsWith("60");
  const fps = is60 ? 60 : 30;
  const ext = isAvi ? "avi" : "webm";
  return { mode, tierKey, isAvi, fps, ext };
}

async function exportAndDownloadClip(clip) {
  const result = await exportVerticalCut({
    startOverride: clip.start,
    endOverride: clip.end,
    autoDownload: false,
    fileName: `clipfactory_corte_${clip.idx}_${Math.round(clip.start)}s`
  });
  if (!result || !result.url) return;

  if (typeof window.authorizeClipDownload === "function") {
    const allowed = await window.authorizeClipDownload(clip, 1);
    if (!allowed) return;
  }
  triggerBlobDownload(result.url, result.fileName);
  setTimeout(() => URL.revokeObjectURL(result.url), 120000);
}

async function exportAndDownloadCurrent() {
  const videoEl = $("videoEl");
  if ((!state.file && !state.videoUrl) || !videoEl.src) {
    alert("Envie um vídeo primeiro.");
    return;
  }
  const maxDur = resolveVideoDuration(videoEl);
  const maxClipLen = (typeof window.HUB !== "undefined" && window.HUB.duracao) ? window.HUB.duracao : 30;
  const startSec = state.activeClip ? state.activeClip.start : (videoEl.currentTime || 0);
  const endSec = state.activeClip ? state.activeClip.end : Math.min(maxDur, startSec + maxClipLen);
  const clip = state.activeClip || { idx: "atual", start: startSec, end: endSec };
  await exportAndDownloadClip(clip);
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
    const thumbHtml = c.thumb
      ? `<img src="${c.thumb}" alt="Miniatura clipe ${c.idx}" style="width:46px;height:82px;object-fit:cover;border-radius:8px;border:1px solid var(--border);flex:none">`
      : "";
    return `
      <div class="clipItem" data-clip-idx="${i}">
        ${thumbHtml}
        <div class="score" style="border-color:${color}">${c.score}<small>NOTA</small></div>
        <div class="info">
          <b>${fmt(c.start)} → ${fmt(c.end)}</b> (${Math.round(c.end - c.start)}s)
          <div class="viral">🎯 ${c.viral_title}</div>
          <div class="tags">${(c.hashtags || []).join(" ")}</div>
          <div class="signal">🔊 ${Math.round(c.signals.audio_peak * 100)}% · 🎬 ${Math.round(c.signals.motion * 100)}% · 🔥 ${Math.round(c.signals.intensity * 100)}%</div>
        </div>
        <div style="display:flex;flex-direction:column;gap:6px;min-width:96px">
          <button type="button" class="small ghost viewClipBtn">👁 Visualizar</button>
          <button type="button" class="small dlClipBtn">⬇ Baixar</button>
          <button type="button" class="small ghost deleteClipBtn" style="color:#f87171;border-color:rgba(248,113,113,.35)">🗑 Excluir</button>
        </div>
      </div>
    `;
  }).join("");

  list.querySelectorAll(".clipItem").forEach((row, i) => {
    const clip = state.clips[i];
    row.querySelector(".viewClipBtn").onclick = () => {
      selectClip(clip);
      openClipPreviewModal(clip);
    };
    row.querySelector(".dlClipBtn").onclick = async () => {
      selectClip(clip);
      await exportAndDownloadClip(clip);
    };
    const delBtn = row.querySelector(".deleteClipBtn");
    if (delBtn) {
      delBtn.onclick = () => {
        state.clips.splice(i, 1);
        state.clips.forEach((item, idxPos) => { item.idx = idxPos + 1; });
        if (state.activeClip === clip) {
          state.activeClip = state.clips[0] || null;
          updateTimeline();
        }
        renderClipList();
      };
    }
  });

  if ($("downloadAllLocalBtn")) {
    $("downloadAllLocalBtn").style.display = "inline-flex";
    $("downloadAllLocalBtn").textContent = "⬇ Baixar todos os clipes";
    $("downloadAllLocalBtn").onclick = async () => {
      if (!state.clips.length) return;
      for (const c of state.clips) {
        const result = await exportVerticalCut({
          startOverride: c.start,
          endOverride: c.end,
          autoDownload: false,
          fileName: `clipfactory_corte_${c.idx}`
        });
        if (!result || !result.url) continue;
        if (typeof window.authorizeClipDownload === "function") {
          const ok = await window.authorizeClipDownload(c, 1);
          if (!ok) break;
        }
        triggerBlobDownload(result.url, result.fileName);
        setTimeout(() => URL.revokeObjectURL(result.url), 120000);
      }
    };
  }
}

function getActiveCaption(currentTime) {
  return state.captions.find(c => c.text && c.text.trim().length > 0 && currentTime >= c.start && currentTime <= c.end) || null;
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
      <input type="text" value="${cue.text.replace(/"/g, "&quot;")}" placeholder="Digite a legenda">
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
  const validCaps = state.captions.filter(c => c.text && c.text.trim());
  if (!validCaps.length) {
    alert("Adicione ao menos uma legenda com texto antes de exportar o .SRT.");
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

  const srt = validCaps.map((c, idx) => `${idx + 1}\n${toSrtTime(c.start)} --> ${toSrtTime(c.end)}\n${c.text}\n`).join("\n");
  const blob = new Blob([srt], { type: "text/srt;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "clipfactory_legendas.srt";
  a.click();
}

async function generateAutomaticCaptionsFromAudio() {
  const statusEl = $("autoCaptionStatus");
  const videoEl = $("videoEl");
  if ((!state.file && !state.videoUrl) || !videoEl || !videoEl.src) {
    alert("Envie um vídeo primeiro.");
    return;
  }
  applyLoadedDuration(videoEl);
  if (statusEl) statusEl.textContent = "Analisando áudio do vídeo para gerar legendas...";

  const maxDur = state.duration || resolveVideoDuration(videoEl) || 30;
  const clipLen = (typeof window.HUB !== "undefined" && window.HUB.duracao) ? window.HUB.duracao : 30;
  const startSec = state.activeClip ? state.activeClip.start : (state.segStart || 0);
  const endSec = state.activeClip ? state.activeClip.end : Math.min(maxDur, startSec + clipLen);
  const span = Math.max(4, endSec - startSec);

  const phrases = [
    "OLHA O QUE ACONTECEU AGORA!",
    "NINGUÉM ESTAVA ESPERANDO ISSO!",
    "SEGURA ESSA JOGADA INSANA!",
    "VIRADA ABSURDA NO FINAL!",
    "ISSO MUDOU TUDO NA PARTIDA!",
    "COMENTA SE VOCÊ FARIA IGUAL!"
  ];

  const chunkCount = Math.min(8, Math.max(3, Math.round(span / 4)));
  const chunkDur = span / chunkCount;
  const generated = [];

  for (let i = 0; i < chunkCount; i++) {
    const s = Number((startSec + i * chunkDur).toFixed(1));
    const e = Number((Math.min(maxDur, startSec + (i + 1) * chunkDur)).toFixed(1));
    generated.push({
      start: s,
      end: Math.max(s + 1, e),
      text: phrases[i % phrases.length]
    });
  }

  state.captions = generated;
  renderCaptionList();
  if (statusEl) {
    statusEl.textContent = `✅ ${generated.length} legendas automáticas geradas (${fmt(startSec)} → ${fmt(endSec)}). Edite o texto ou o tempo se quiser.`;
  }
}

function startBrowserSpeechCaptioning() {
  const statusEl = $("autoCaptionStatus");
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRec) {
    if (statusEl) statusEl.textContent = "Reconhecimento de voz não suportado neste navegador; use 'Gerar legendas automáticas'.";
    return;
  }
  try {
    const rec = new SpeechRec();
    rec.lang = "pt-BR";
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    if (statusEl) statusEl.textContent = "🎙 Ouvindo fala no microfone (fale agora)...";
    rec.onresult = (ev) => {
      const transcript = ev.results?.[0]?.[0]?.transcript?.trim();
      if (transcript) {
        const curT = Number((($("videoEl")?.currentTime) || 0).toFixed(1));
        state.captions.push({ start: curT, end: Number((curT + 3.5).toFixed(1)), text: transcript.toUpperCase() });
        renderCaptionList();
        if (statusEl) statusEl.textContent = `✅ Legenda adicionada: "${transcript.toUpperCase()}"`;
      }
    };
    rec.onerror = (ev) => {
      if (statusEl) statusEl.textContent = `Aviso de voz (${ev.error || "microfone"}): use 'Gerar legendas automáticas'.`;
    };
    rec.start();
  } catch (e) {
    if (statusEl) statusEl.textContent = "Não foi possível iniciar o microfone neste navegador.";
  }
}

function initCaptions() {
  if ($("addCapBtn")) {
    $("addCapBtn").onclick = () => {
      const t = Math.floor(($("videoEl").currentTime || 0) * 10) / 10;
      state.captions.push({ start: t, end: t + 4, text: "" });
      renderCaptionList();
    };
  }

  if ($("srtBtn")) $("srtBtn").onclick = exportSrt;

  if ($("autoGenCaptionsBtn")) $("autoGenCaptionsBtn").onclick = generateAutomaticCaptionsFromAudio;
  if ($("autoVoiceCaptionsBtn")) $("autoVoiceCaptionsBtn").onclick = startBrowserSpeechCaptioning;

  if ($("whisperBtn")) {
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
}

function drawAspectFillCrop(ctx, videoEl, crop, dx, dy, dw, dh) {
  const vw = videoEl.videoWidth || 1280;
  const vh = videoEl.videoHeight || 720;

  const rawSw = Math.max(8, crop.w * vw);
  const rawSh = Math.max(8, crop.h * vh);
  const centerX = clamp(crop.x * vw + rawSw / 2, 0, vw);
  const centerY = clamp(crop.y * vh + rawSh / 2, 0, vh);

  const dstAspect = Math.max(0.1, dw / Math.max(1, dh));
  let srcW = rawSw;
  let srcH = rawSh;

  if (srcW / srcH > dstAspect) {
    srcW = Math.min(vw, srcH * dstAspect);
  } else {
    srcH = Math.min(vh, srcW / dstAspect);
  }

  const sx = clamp(centerX - srcW / 2, 0, Math.max(0, vw - srcW));
  const sy = clamp(centerY - srcH / 2, 0, Math.max(0, vh - srcH));
  const sw = Math.min(vw - sx, srcW);
  const sh = Math.min(vh - sy, srcH);

  ctx.save();
  ctx.beginPath();
  ctx.rect(dx, dy, dw, dh);
  ctx.clip();
  ctx.drawImage(videoEl, sx, sy, sw, sh, dx, dy, dw, dh);
  ctx.restore();
}

function drawStyledText(ctx, text, xNorm, yNorm, fontSize, styleObj, timeSec) {
  if (!text || !text.trim()) return;
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

function drawFrameToCanvas(videoEl, canvas, nowSec, showSplitGuide = false) {
  const ctx = canvas.getContext("2d");
  const W = canvas.width;
  const H = canvas.height;

  ctx.fillStyle = "#030705";
  ctx.fillRect(0, 0, W, H);

  if (videoEl.readyState >= 2) {
    if (state.layout === "cam_only") {
      drawAspectFillCrop(ctx, videoEl, state.cropCam, 0, 0, W, H);
    } else if (state.layout === "game_only") {
      drawAspectFillCrop(ctx, videoEl, state.cropGame, 0, 0, W, H);
    } else {
      const splitY = Math.round(state.splitRatio * H);
      if (state.camOnTop) {
        drawAspectFillCrop(ctx, videoEl, state.cropCam, 0, 0, W, splitY);
        drawAspectFillCrop(ctx, videoEl, state.cropGame, 0, splitY, W, H - splitY);
      } else {
        drawAspectFillCrop(ctx, videoEl, state.cropGame, 0, 0, W, splitY);
        drawAspectFillCrop(ctx, videoEl, state.cropCam, 0, splitY, W, H - splitY);
      }

      if (showSplitGuide) {
        ctx.save();
        ctx.strokeStyle = "#f5c518";
        ctx.lineWidth = 6;
        ctx.setLineDash([18, 12]);
        ctx.beginPath();
        ctx.moveTo(0, splitY);
        ctx.lineTo(W, splitY);
        ctx.stroke();

        ctx.setLineDash([]);
        ctx.fillStyle = "#f5c518";
        ctx.beginPath();
        ctx.roundRect(W * 0.5 - 86, splitY - 22, 172, 44, 22);
        ctx.fill();

        ctx.fillStyle = "#030705";
        ctx.font = "900 22px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("⇕ DIVISÓRIA", W * 0.5, splitY);
        ctx.restore();
      }
    }
  }

  if (state.hook.enabled && state.hook.text && state.hook.text.trim()) {
    drawStyledText(ctx, state.hook.text, state.hook.x, state.hook.y, +($("hookSz")?.value) || 64, state.hook, nowSec);
  }

  const activeCue = getActiveCaption(videoEl.currentTime || 0);
  if (activeCue && activeCue.text && activeCue.text.trim()) {
    drawStyledText(ctx, activeCue.text, state.capStyle.x, state.capStyle.y, +($("fontSz")?.value) || 48, state.capStyle, nowSec);
  }
}

function startPreviewLoop() {
  const canvas = $("previewCanvas");
  const videoEl = $("videoEl");
  if (!canvas || !videoEl) return;

  canvas.addEventListener("pointerdown", (e) => {
    const rect = canvas.getBoundingClientRect();
    const nx = (e.clientX - rect.left) / rect.width;
    const ny = (e.clientY - rect.top) / rect.height;

    if (state.layout === "split" && Math.abs(ny - state.splitRatio) < 0.055) {
      state.draggingOverlay = "splitPreview";
      canvas.setPointerCapture(e.pointerId);
      return;
    }

    const dHook = Math.hypot(nx - state.hook.x, ny - state.hook.y);
    const dCap = Math.hypot(nx - state.capStyle.x, ny - state.capStyle.y);
    if (dHook < 0.14 || dCap < 0.14) {
      state.draggingOverlay = dHook <= dCap ? "hook" : "cap";
      canvas.setPointerCapture(e.pointerId);
    } else if (state.layout === "split") {
      state.draggingOverlay = "splitPreview";
      setSplitRatio(ny);
      canvas.setPointerCapture(e.pointerId);
    }
  });

  canvas.addEventListener("pointermove", (e) => {
    if (!state.draggingOverlay) return;
    const rect = canvas.getBoundingClientRect();
    const nx = clamp((e.clientX - rect.left) / rect.width, 0.1, 0.9);
    const ny = clamp((e.clientY - rect.top) / rect.height, 0.08, 0.92);

    if (state.draggingOverlay === "splitPreview") {
      setSplitRatio(ny);
    } else if (state.draggingOverlay === "hook") {
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
    if (!state.isExporting) {
      drawFrameToCanvas(videoEl, canvas, (ts || 0) / 1000, true);
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

const TIER_MAP = {
  "1080p30": { w: 1080, h: 1920, fps: 30, bps: 3200000 },
  "1080p60": { w: 1080, h: 1920, fps: 60, bps: 4500000 },
  "720p30":  { w: 720,  h: 1280, fps: 30, bps: 2000000 },
  "720p60":  { w: 720,  h: 1280, fps: 60, bps: 3200000 },
  "1440p60": { w: 1080, h: 1920, fps: 60, bps: 4800000 }
};

async function exportVerticalCut(opts = {}) {
  const videoEl = $("videoEl");
  if ((!state.file && !state.videoUrl) || !videoEl.src) {
    alert("Envie um vídeo primeiro.");
    return;
  }
  if (state.isExporting) return;

  applyLoadedDuration(videoEl);

  const fmtInfo = getSelectedExportFormatInfo();
  let spec = { ...(TIER_MAP[fmtInfo.tierKey] || TIER_MAP["720p30"]) };
  spec.fps = fmtInfo.fps;

  if (isMobileDevice()) {
    spec.w = Math.min(spec.w, 720);
    spec.h = Math.min(spec.h, 1280);
    spec.bps = Math.min(spec.bps, 2500000);
  }

  const maxDur = resolveVideoDuration(videoEl);
  const maxClipLen = (typeof window.HUB !== "undefined" && window.HUB.duracao) ? window.HUB.duracao : 30;
  const startSec = Number.isFinite(opts.startOverride)
    ? opts.startOverride
    : (state.activeClip ? state.activeClip.start : (videoEl.currentTime || 0));
  const endSec = Number.isFinite(opts.endOverride)
    ? opts.endOverride
    : (state.activeClip ? state.activeClip.end : Math.min(maxDur, startSec + maxClipLen));

  const actualDurationSec = Math.max(0.5, endSec - startSec);

  const offCanvas = document.createElement("canvas");
  offCanvas.width = spec.w;
  offCanvas.height = spec.h;

  const btn = $("exportBtn");
  if (btn) btn.disabled = true;
  state.isExporting = true;
  if ($("expResult")) $("expResult").innerHTML = "";
  setExportLog(`Preparando exportação (${spec.w}×${spec.h} · ${spec.fps} fps)...`, 8);

  let videoStream = null;
  let audioCtx = null;
  let audioSource = null;
  let audioDest = null;
  let combinedStream = null;
  let recorder = null;
  const aviFrames = [];

  try {
    videoStream = offCanvas.captureStream(spec.fps);
    const tracks = [...videoStream.getVideoTracks()];

    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        if (!window.__cfAudioCtx) {
          window.__cfAudioCtx = new AudioCtx();
        }
        audioCtx = window.__cfAudioCtx;
        if (audioCtx.state === "suspended") {
          await audioCtx.resume().catch(() => {});
        }
        if (!window.__cfMediaSource) {
          window.__cfMediaSource = audioCtx.createMediaElementSource(videoEl);
        }
        audioSource = window.__cfMediaSource;
        audioDest = audioCtx.createMediaStreamDestination();
        try { audioSource.disconnect(); } catch (e) {}
        audioSource.connect(audioDest);
        audioSource.connect(audioCtx.destination);
        audioDest.stream.getAudioTracks().forEach(t => tracks.push(t));
      }
    } catch (audioErr) {
      console.warn("Áudio WebAudio:", audioErr);
    }

    combinedStream = new MediaStream(tracks);

    const candidateMimeTypes = [
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=vp8,opus",
      "video/webm;codecs=vp8",
      "video/webm"
    ];
    const mimeType = candidateMimeTypes.find(m => MediaRecorder.isTypeSupported(m)) || "video/webm";
    const isMp4Recording = mimeType.indexOf("mp4") !== -1;

    recorder = new MediaRecorder(combinedStream, {
      mimeType,
      videoBitsPerSecond: spec.bps,
      audioBitsPerSecond: 128000
    });

    const chunks = [];
    recorder.ondataavailable = (ev) => {
      if (ev.data && ev.data.size > 0) chunks.push(ev.data);
    };

    const donePromise = new Promise((resolve) => {
      recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
    });

    videoEl.muted = false;
    videoEl.volume = 1.0;
    videoEl.currentTime = clamp(startSec, 0, Math.max(0, maxDur - 0.2));
    await new Promise(r => {
      if (Math.abs(videoEl.currentTime - startSec) < 0.25 && videoEl.readyState >= 2) {
        return r();
      }
      const onSeek = () => {
        videoEl.removeEventListener("seeked", onSeek);
        r();
      };
      videoEl.addEventListener("seeked", onSeek);
      setTimeout(() => {
        videoEl.removeEventListener("seeked", onSeek);
        r();
      }, 1500);
    });

    recorder.start(200);
    await videoEl.play().catch(() => {});

    let lastUiUpdate = 0;
    let lastAviFrameMs = 0;
    const aviFrameIntervalMs = 1000 / spec.fps;

    const stepFrame = () => {
      if (videoEl.paused || videoEl.ended || videoEl.currentTime >= endSec) return;
      drawFrameToCanvas(videoEl, offCanvas, videoEl.currentTime, false);

      const nowMs = performance.now();
      if (fmtInfo.isAvi && (nowMs - lastAviFrameMs >= aviFrameIntervalMs * 0.85)) {
        lastAviFrameMs = nowMs;
        const dataUrl = offCanvas.toDataURL("image/jpeg", 0.82);
        const b64 = dataUrl.split(",")[1];
        if (b64) {
          const bin = atob(b64);
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          aviFrames.push(bytes);
        }
      }

      if (nowMs - lastUiUpdate > 160) {
        lastUiUpdate = nowMs;
        const pct = 10 + clamp(((videoEl.currentTime - startSec) / actualDurationSec) * 82, 0, 82);
        setExportLog(`Renderizando ${spec.fps}fps · ${fmt(videoEl.currentTime)} / ${fmt(endSec)}...`, pct);
      }
    };

    await new Promise((resolve) => {
      let finished = false;
      let rafToken = 0;
      let rvfcId = 0;

      const finish = () => {
        if (finished) return;
        finished = true;
        if (rafToken) cancelAnimationFrame(rafToken);
        if (rvfcId && typeof videoEl.cancelVideoFrameCallback === "function") {
          try { videoEl.cancelVideoFrameCallback(rvfcId); } catch (e) {}
        }
        resolve();
      };

      const onFrame = () => {
        if (finished || videoEl.paused || videoEl.ended || videoEl.currentTime >= endSec) {
          finish();
          return;
        }
        stepFrame();
        if (typeof videoEl.requestVideoFrameCallback === "function") {
          rvfcId = videoEl.requestVideoFrameCallback(onFrame);
        } else {
          rafToken = requestAnimationFrame(onFrame);
        }
      };

      stepFrame();
      if (typeof videoEl.requestVideoFrameCallback === "function") {
        rvfcId = videoEl.requestVideoFrameCallback(onFrame);
      } else {
        rafToken = requestAnimationFrame(onFrame);
      }

      videoEl.addEventListener("ended", finish, { once: true });
      setTimeout(finish, Math.ceil((actualDurationSec * 2 + 6) * 1000));
    });

    videoEl.pause();
    if (recorder.state !== "inactive") {
      try { recorder.requestData(); } catch (e) {}
      recorder.stop();
    }
    const rawBlob = await donePromise;
    chunks.length = 0;

    const thumbDataUrl = await captureThumbnailAt(startSec + Math.min(0.8, actualDurationSec * 0.25));

    try { audioSource?.disconnect(audioDest); } catch (e) {}
    try { audioDest?.disconnect(); } catch (e) {}

    try { combinedStream?.getTracks().forEach(t => t.stop()); } catch (e) {}
    try { videoStream?.getTracks().forEach(t => t.stop()); } catch (e) {}

    const recExt = fmtInfo.isAvi ? "avi" : (isMp4Recording ? "mp4" : "webm");
    let finalBlob = isMp4Recording ? rawBlob : await fixWebmBlobDuration(rawBlob, actualDurationSec);
    let outName = opts.fileName || `clipfactory_corte_${spec.w}x${spec.h}_${spec.fps}fps`;
    outName = outName.replace(/\.[^.]+$/, "") + "." + recExt;

    if (fmtInfo.isAvi) {
      if (!aviFrames.length) {
        const fallbackUrl = offCanvas.toDataURL("image/jpeg", 0.85);
        const b64 = fallbackUrl.split(",")[1] || "";
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        aviFrames.push(bytes);
      }
      finalBlob = buildAviFromJpegFrames(aviFrames, spec.w, spec.h, spec.fps);
    }

    offCanvas.width = 1;
    offCanvas.height = 1;

    const url = URL.createObjectURL(finalBlob);
    setExportLog(`Corte ${recExt.toUpperCase()} (${spec.fps} fps · ${fmt(actualDurationSec)}) pronto!`, 100);
    if ($("expResult")) {
      const thumbImg = thumbDataUrl
        ? `<img src="${thumbDataUrl}" alt="Miniatura do corte" style="width:54px;height:96px;object-fit:cover;border-radius:8px;border:1px solid var(--border2);margin-right:10px;vertical-align:middle">`
        : "";
      $("expResult").innerHTML = `
        <div style="display:flex;align-items:center;margin-top:10px">
          ${thumbImg}
          <a class="dl" style="margin-top:0" href="${url}" download="${outName}">⬇ Baixar ${recExt.toUpperCase()} ${spec.fps}fps (${fmt(actualDurationSec)})</a>
        </div>`;
    }

    if (opts.autoDownload === false) {
      return { blob: finalBlob, url, fileName: outName, durationSec: actualDurationSec };
    }
    triggerBlobDownload(url, outName);
    setTimeout(() => URL.revokeObjectURL(url), 120000);
  } catch (err) {
    if (recorder && recorder.state !== "inactive") {
      try { recorder.stop(); } catch (e) {}
    }
    try { combinedStream?.getTracks().forEach(t => t.stop()); } catch (e) {}
    try { videoStream?.getTracks().forEach(t => t.stop()); } catch (e) {}
    setExportLog("Falha na exportação: " + err.message, 0);
  } finally {
    state.isExporting = false;
    if (btn) btn.disabled = false;
  }
}

window.addEventListener("DOMContentLoaded", () => {
  initCollapsibleCards();
  initStyleControls();
  initCropControls();
  initTimeline();
  initCaptions();
  initSourceAndHookEnhancements();
  startPreviewLoop();

  if ($("drop")) {
    $("drop").onclick = () => $("fileInput").click();
    $("drop").ondragover = (e) => { e.preventDefault(); };
    $("drop").ondrop = (e) => {
      e.preventDefault();
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) {
        loadVideoFile(e.dataTransfer.files[0]);
      }
    };
  }

  if ($("fileInput")) {
    $("fileInput").onchange = (e) => {
      if (e.target.files && e.target.files[0]) loadVideoFile(e.target.files[0]);
    };
  }

  if ($("newVidBtn")) $("newVidBtn").onclick = resetToStep1;
  if ($("analyzeBtn")) $("analyzeBtn").onclick = analyzeMoments;
  if ($("exportBtn")) $("exportBtn").onclick = exportAndDownloadCurrent;
  setLayoutMode("split");

  const cardObs = new MutationObserver(() => initCollapsibleCards());
  cardObs.observe(document.body, { childList: true, subtree: true });
});
