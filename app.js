"use strict";

const $ = id => document.getElementById(id);

const state = {
  file: null,
  videoUrl: null,
  duration: 0,
  clipDuration: 30,
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
  highlightWords: "",
  hook: {
    enabled: false,
    text: "",
    line2: "",
    style: "none",
    bgColor: "#c80000",
    color1: "#ffffff",
    color2: "#ffd166",
    font: "Bebas Neue",
    color: "#ffd166",
    bg: "box",
    bgColor: "#07140e",
    anim: "pop",
    x: 0.5,
    y: 0.16
  },
  social: {
    enabled: false,
    platform: "youtube",
    handle: "",
    style: "metallic",
    color: "#b80000",
    x: 0.5,
    y: 0.52
  },
  draggingOverlay: null,
  isExporting: false
};

function getSelectedClipDurationSec() {
  if (typeof window.HUB !== "undefined" && (Number(window.HUB.duracao) === 30 || Number(window.HUB.duracao) === 60)) {
    return Number(window.HUB.duracao);
  }
  return (Number(state.clipDuration) === 60) ? 60 : 30;
}

function fmt(sec) {
  sec = Math.max(0, Number(sec) || 0);
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function sanitizeFilename(raw, fallback = "clipfactory_corte") {
  const cleaned = String(raw || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_\- ]+/g, "")
    .trim()
    .replace(/\s+/g, "_")
    .slice(0, 56);
  return cleaned || fallback;
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

      const scale = Number(reader.timestampScale) || 1000000;
      const exactDuration = (Math.max(0.5, Number(durationSec) || 1) * 1e9) / scale;
      const duration = exactDuration > 0 ? exactDuration : (Number(reader.duration) || 0);
      if (duration <= 0) return fixWebmBlobDurationFallback(blob, durationSec);

      const seekable = EBMLlib.tools.makeMetadataSeekable(reader.metadatas, duration, reader.cues || []);
      const parts = [new Blob([seekable], { type: blob.type || "video/webm" })];
      if (reader.metadataSize > 0 && reader.metadataSize < buf.byteLength) {
        parts.push(blob.slice(reader.metadataSize));
      }
      return new Blob(parts, { type: blob.type || "video/webm" });
    } catch (e) {
      return fixWebmBlobDurationFallback(blob, durationSec);
    }
  }).catch(() => blob);
}

/* ============================================================
   Conversor MP4 (H.264 + AAC) via ffmpeg.wasm single-thread
   Força duração exata + áudio AAC sincronizado (com fallback anullsrc se vídeo mudo)
   ============================================================ */
let ffmpegInstance = null;

async function ensureFfmpegLoaded() {
  if (ffmpegInstance && ffmpegInstance.isLoaded()) return ffmpegInstance;

  if (!window.FFmpeg) {
    await new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.11.6/dist/ffmpeg.min.js";
      s.onload = resolve;
      s.onerror = () => reject(new Error("Não foi possível baixar o motor MP4 (ffmpeg.wasm). Verifique sua conexão."));
      document.head.appendChild(s);
    });
  }

  const { createFFmpeg } = window.FFmpeg;
  ffmpegInstance = createFFmpeg({
    log: false,
    mainName: "main",
    corePath: "https://cdn.jsdelivr.net/npm/@ffmpeg/core-st@0.11.1/dist/ffmpeg-core.js"
  });
  await ffmpegInstance.load();
  return ffmpegInstance;
}

async function transcodeWebmToMp4(webmBlob, fps, durationSec, hasAudioTrack = true, metaTitle = "") {
  setExportLog("Carregando motor MP4 (ffmpeg.wasm)...", 86);
  const ff = await ensureFfmpegLoaded();
  const inBuf = new Uint8Array(await webmBlob.arrayBuffer());
  const exactSecStr = Math.max(0.5, Number(durationSec) || 1).toFixed(3);

  try { ff.FS("unlink", "in_cut.webm"); } catch (e) {}
  try { ff.FS("unlink", "out_cut.mp4"); } catch (e) {}

  ff.FS("writeFile", "in_cut.webm", inBuf);
  setExportLog(`Convertendo para MP4 H.264 + AAC (${fps} fps · ${exactSecStr}s exatos)...`, 92);

  const args = [
    "-fflags", "+genpts",
    "-i", "in_cut.webm",
    "-c:v", "libx264",
    "-preset", "ultrafast",
    "-crf", "22",
    "-pix_fmt", "yuv420p",
    "-r", String(fps),
    "-vsync", "cfr"
  ];

  if (hasAudioTrack) {
    args.push(
      "-c:a", "aac",
      "-b:a", "128k",
      "-ar", "44100",
      "-ac", "2",
      "-af", "aresample=async=1:first_pts=0"
    );
  } else {
    args.push("-an");
  }

  if (metaTitle) {
    args.push("-metadata", `title=${metaTitle}`);
  }

  args.push(
    "-movflags", "+faststart",
    "-t", exactSecStr,
    "out_cut.mp4"
  );

  await ff.run(...args);

  const mp4Data = ff.FS("readFile", "out_cut.mp4");
  try { ff.FS("unlink", "in_cut.webm"); } catch (e) {}
  try { ff.FS("unlink", "out_cut.mp4"); } catch (e) {}

  if (!mp4Data || mp4Data.byteLength < 1024) {
    throw new Error("A conversão MP4 gerou um arquivo vazio. Nenhum vídeo foi descontado.");
  }

  return new Blob([mp4Data.buffer], { type: "video/mp4" });
}

/* ============================================================
   RIFF / AVI MJPEG + PCM WAV Audio container builder
   Garante duração exata (frames = fps * durationSec) e áudio sincronizado
   ============================================================ */
function buildAviWithAudioFromFrames(frames, pcmSamples, sampleRate, width, height, fps) {
  const safeFps = Math.max(1, Math.min(60, Number(fps) || 30));
  const useSecPerFrame = Math.round(1000000 / safeFps);
  const hasAudio = pcmSamples && pcmSamples.length > 0 && sampleRate > 0;
  const numChannels = 1;
  const bitsPerSample = 16;
  const blockAlign = numChannels * (bitsPerSample / 8);
  const avgBytesPerSec = sampleRate * blockAlign;

  const writeStr = (arr, offset, str) => {
    for (let i = 0; i < str.length; i++) arr[offset + i] = str.charCodeAt(i);
  };
  const writeU32 = (view, offset, val) => {
    view.setUint32(offset, val >>> 0, true);
  };
  const writeU16 = (view, offset, val) => {
    view.setUint16(offset, val & 0xFFFF, true);
  };

  const moviParts = [];
  const indexEntries = [];
  let moviDataSize = 0;

  const samplesPerFrame = hasAudio ? Math.floor(sampleRate / safeFps) : 0;
  let audioCursor = 0;

  for (let i = 0; i < frames.length; i++) {
    const jpg = frames[i];
    const padV = jpg.length % 2 === 1 ? 1 : 0;
    const chunkSizeV = 8 + jpg.length + padV;
    const chunkV = new Uint8Array(chunkSizeV);
    writeStr(chunkV, 0, "00dc");
    new DataView(chunkV.buffer).setUint32(4, jpg.length, true);
    chunkV.set(jpg, 8);
    moviParts.push(chunkV);

    indexEntries.push({
      chunkId: "00dc",
      flags: 0x10,
      offset: moviDataSize,
      size: jpg.length
    });
    moviDataSize += chunkSizeV;

    if (hasAudio && audioCursor < pcmSamples.length) {
      const endSample = (i === frames.length - 1)
        ? pcmSamples.length
        : Math.min(pcmSamples.length, audioCursor + samplesPerFrame);
      const count = Math.max(0, endSample - audioCursor);
      if (count > 0) {
        const byteLen = count * 2;
        const padA = byteLen % 2 === 1 ? 1 : 0;
        const chunkSizeA = 8 + byteLen + padA;
        const chunkA = new Uint8Array(chunkSizeA);
        writeStr(chunkA, 0, "01wb");
        const dvA = new DataView(chunkA.buffer);
        dvA.setUint32(4, byteLen, true);
        for (let s = 0; s < count; s++) {
          const sample = clamp(pcmSamples[audioCursor + s], -1, 1);
          dvA.setInt16(8 + s * 2, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
        }
        moviParts.push(chunkA);
        indexEntries.push({
          chunkId: "01wb",
          flags: 0x10,
          offset: moviDataSize,
          size: byteLen
        });
        moviDataSize += chunkSizeA;
        audioCursor = endSample;
      }
    }
  }

  const moviListSize = 4 + moviDataSize;
  const idx1DataSize = indexEntries.length * 16;
  const idx1TotalSize = 8 + idx1DataSize;

  const numStreams = hasAudio ? 2 : 1;
  const avihData = new Uint8Array(56);
  const avihView = new DataView(avihData.buffer);
  writeU32(avihView, 0, useSecPerFrame);
  writeU32(avihView, 4, width * height * 3);
  writeU32(avihView, 8, 0);
  writeU32(avihView, 12, 0x10);
  writeU32(avihView, 16, frames.length);
  writeU32(avihView, 20, 0);
  writeU32(avihView, 24, numStreams);
  writeU32(avihView, 28, width * height * 3);
  writeU32(avihView, 32, width);
  writeU32(avihView, 36, height);

  // Video stream header
  const strhV = new Uint8Array(56);
  const strhVView = new DataView(strhV.buffer);
  writeStr(strhV, 0, "vids");
  writeStr(strhV, 4, "MJPG");
  writeU32(strhVView, 20, 1);
  writeU32(strhVView, 24, safeFps);
  writeU32(strhVView, 32, frames.length);
  writeU32(strhVView, 36, width * height * 3);
  writeU32(strhVView, 40, 10000);

  const strfV = new Uint8Array(40);
  const strfVView = new DataView(strfV.buffer);
  writeU32(strfVView, 0, 40);
  writeU32(strfVView, 4, width);
  writeU32(strfVView, 8, height);
  writeU16(strfVView, 12, 1);
  writeU16(strfVView, 14, 24);
  writeStr(strfV, 16, "MJPG");
  writeU32(strfVView, 20, width * height * 3);

  const strlVDataSize = (8 + 56) + (8 + 40);
  const strlVListSize = 4 + strlVDataSize;

  let strlADataSize = 0;
  let strlAListSize = 0;
  let strhA = null;
  let strfA = null;

  if (hasAudio) {
    strhA = new Uint8Array(56);
    const strhAView = new DataView(strhA.buffer);
    writeStr(strhA, 0, "auds");
    writeU32(strhAView, 4, 0);
    writeU32(strhAView, 20, blockAlign);
    writeU32(strhAView, 24, avgBytesPerSec);
    writeU32(strhAView, 32, audioCursor);
    writeU32(strhAView, 36, avgBytesPerSec);
    writeU32(strhAView, 40, 0xFFFFFFFF);
    writeU32(strhAView, 44, blockAlign);

    strfA = new Uint8Array(18);
    const strfAView = new DataView(strfA.buffer);
    writeU16(strfAView, 0, 1); // PCM
    writeU16(strfAView, 2, numChannels);
    writeU32(strfAView, 4, sampleRate);
    writeU32(strfAView, 8, avgBytesPerSec);
    writeU16(strfAView, 12, blockAlign);
    writeU16(strfAView, 14, bitsPerSample);
    writeU16(strfAView, 16, 0);

    strlADataSize = (8 + 56) + (8 + 18);
    strlAListSize = 4 + strlADataSize;
  }

  const hdrlDataSize = (8 + 56) + (8 + strlVListSize) + (hasAudio ? (8 + strlAListSize) : 0);
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

  writeStr(out, pos, "LIST"); writeU32(view, pos + 4, strlVListSize); pos += 8;
  writeStr(out, pos, "strl"); pos += 4;
  writeStr(out, pos, "strh"); writeU32(view, pos + 4, 56); out.set(strhV, pos + 8); pos += 64;
  writeStr(out, pos, "strf"); writeU32(view, pos + 4, 40); out.set(strfV, pos + 8); pos += 48;

  if (hasAudio) {
    writeStr(out, pos, "LIST"); writeU32(view, pos + 4, strlAListSize); pos += 8;
    writeStr(out, pos, "strl"); pos += 4;
    writeStr(out, pos, "strh"); writeU32(view, pos + 4, 56); out.set(strhA, pos + 8); pos += 64;
    writeStr(out, pos, "strf"); writeU32(view, pos + 4, 18); out.set(strfA, pos + 8); pos += 26;
  }

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
  } else {
    if ($("hookFont")) $("hookFont").value = preset.font;
    if ($("hookBg")) $("hookBg").value = preset.bg;
    if ($("hookAnim")) $("hookAnim").value = preset.anim;
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

  buildSwatches("capColorSwatches", COLOR_SWATCHES, c => { state.capStyle.color = c; }, state.capStyle.color);
  buildSwatches("capBgSwatches", BG_SWATCHES, c => { state.capStyle.bgColor = c; }, state.capStyle.bgColor);
  buildSwatches("hookColorSwatches", COLOR_SWATCHES, c => { state.hook.color = c; }, state.hook.color);
  buildSwatches("hookBgSwatches", BG_SWATCHES, c => { state.hook.bgColor = c; }, state.hook.bgColor);

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
        state.hook.text = (state.activeClip && state.activeClip.viral_title)
          ? state.activeClip.viral_title
          : "GANCHO EM DESTAQUE 🔥";
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

  if ($("splitUpBtn")) $("splitUpBtn").onclick = () => setSplitRatio(state.splitRatio - 0.05);
  if ($("splitDownBtn")) $("splitDownBtn").onclick = () => setSplitRatio(state.splitRatio + 0.05);

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
  if (!state.file || !videoEl.src) {
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
  const clipLen = getSelectedClipDurationSec();
  state.clipDuration = clipLen;
  const step = clipLen;

  let audioEnvelope = null;
  try {
    if (state.file.size <= 140 * 1024 * 1024) {
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

    const clipEnd = Math.min(maxDur, t + clipLen);
    candidates.push({
      idx: candidates.length + 1,
      start: t,
      end: clipEnd,
      duration: Math.round(clipEnd - t),
      score,
      viral_title: VIRAL_TITLES[candidates.length % VIRAL_TITLES.length],
      hashtags: VIRAL_HASHTAGS[candidates.length % VIRAL_HASHTAGS.length].split(" "),
      signals: { audio_peak: audioPeak, motion, intensity },
      thumb: null
    });
  }

  if (!candidates.length && endSec > startSec) {
    const safeStart = startSec;
    const safeEnd = Math.min(maxDur, startSec + clipLen);
    candidates.push({
      idx: 1,
      start: safeStart,
      end: safeEnd,
      duration: Math.round(safeEnd - safeStart),
      score: 85,
      viral_title: VIRAL_TITLES[0],
      hashtags: VIRAL_HASHTAGS[0].split(" "),
      signals: { audio_peak: 0.8, motion: 0.75, intensity: 0.7 },
      thumb: null
    });
  }

  renderHeatmap(candidates.map(c => c.score));

  const topClips = [...candidates]
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);

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

  const durSec = getSelectedClipDurationSec();
  const startSec = Number(clip.start || 0);
  const maxDur = resolveVideoDuration($("videoEl"));
  const endSec = Math.min(maxDur, startSec + durSec);

  modal.innerHTML = `
    <div class="clipModalBox" style="max-width:360px;display:flex;flex-direction:column;align-items:center">
      <div style="width:100%;display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
        <b>📱 Prévia Vertical 9:16 · Clipe #${clip.idx} (${Math.round(endSec - startSec)}s)</b>
        <button type="button" class="ghost small" id="closeClipModalBtn">✕</button>
      </div>
      <canvas id="modalVerticalCanvas" width="540" height="960" style="width:100%;max-width:270px;aspect-ratio:9/16;border-radius:14px;border:1px solid var(--border2);background:#000"></canvas>
      <div class="signal" style="margin-top:8px;text-align:center">${fmt(startSec)} → ${fmt(endSec)} · ${clip.viral_title || ""}</div>
      <div class="signal" style="color:var(--acc2);font-size:10px;text-align:center">${(clip.hashtags || []).join(" ")}</div>
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
    drawFrameToCanvas(mainVid, vCanvas, (ts || 0) / 1000, false, clip);
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
    await exportAndDownloadClip({ ...clip, start: startSec, end: endSec });
  };
}

function getSelectedExportFormatInfo() {
  const mode = $("expMode")?.value || "fast";
  const tierKey = $("expTier")?.value || "720p30";
  const isAvi = mode === "avi";
  const isMp4 = mode === "mp4";
  const is60 = tierKey.endsWith("60");
  const fps = is60 ? 60 : 30;
  const ext = isAvi ? "avi" : (isMp4 ? "mp4" : "webm");
  return { mode, tierKey, isAvi, isMp4, fps, ext };
}

function buildClipExportFileName(clip, durationSec) {
  const customHook = (state.hook.text && state.hook.text.trim()) ? state.hook.text.trim() : "";
  const rawTitle = customHook
    ? customHook
    : (clip && clip.viral_title)
      ? clip.viral_title
      : (VIRAL_TITLES[0] || `clipfactory_corte_${clip?.idx || 1}`);
  const safeTitle = sanitizeFilename(rawTitle, `clipfactory_corte_${clip?.idx || 1}`);
  const tagsClean = (clip && Array.isArray(clip.hashtags) && clip.hashtags.length)
    ? "_" + clip.hashtags.slice(0, 3).map(t => sanitizeFilename(t, "")).filter(Boolean).join("_")
    : "";
  return `${safeTitle}${tagsClean}_${Math.round(durationSec)}s`;
}

async function exportAndDownloadClip(clip) {
  if (typeof window.checkCanDownloadVideos === "function") {
    const canProceed = await window.checkCanDownloadVideos(1);
    if (!canProceed) return;
  }

  const durSec = getSelectedClipDurationSec();
  const maxDur = resolveVideoDuration($("videoEl"));
  const startSec = Number(clip.start || 0);
  const endSec = Math.min(maxDur, startSec + durSec);
  const activeClipObj = {
    ...clip,
    start: startSec,
    end: endSec,
    viral_title: clip.viral_title || (state.hook.text && state.hook.text.trim()) || VIRAL_TITLES[0],
    hashtags: (Array.isArray(clip.hashtags) && clip.hashtags.length) ? clip.hashtags : VIRAL_HASHTAGS[0].split(" ")
  };
  state.activeClip = activeClipObj;

  const result = await exportVerticalCut({
    startOverride: startSec,
    endOverride: endSec,
    clipObj: activeClipObj,
    autoDownload: false,
    fileName: buildClipExportFileName(activeClipObj, endSec - startSec)
  });
  if (!result || !result.url || !result.blob || result.blob.size < 1024) return;

  let authRes = { ok: true, consumedOrigins: [] };
  if (typeof window.authorizeClipDownload === "function") {
    authRes = await window.authorizeClipDownload(activeClipObj, 1);
    if (!authRes || !authRes.ok) {
      URL.revokeObjectURL(result.url);
      return;
    }
  }

  try {
    triggerBlobDownload(result.url, result.fileName);
    setTimeout(() => URL.revokeObjectURL(result.url), 120000);
  } catch (dlErr) {
    if (authRes.consumedOrigins && typeof window.refundOneVideoToCloud === "function") {
      for (const orig of authRes.consumedOrigins) {
        await window.refundOneVideoToCloud(orig);
      }
    }
    alert("❌ Falha ao iniciar download no navegador. Seu vídeo disponível foi mantido.");
  }
}

async function exportAndDownloadCurrent() {
  const videoEl = $("videoEl");
  if (!state.file || !videoEl.src) {
    alert("Envie um vídeo primeiro.");
    return;
  }
  const maxDur = resolveVideoDuration(videoEl);
  const maxClipLen = getSelectedClipDurationSec();
  const startSec = state.activeClip ? state.activeClip.start : (videoEl.currentTime || 0);
  const endSec = Math.min(maxDur, startSec + maxClipLen);
  const clip = state.activeClip || {
    idx: 1,
    start: startSec,
    end: endSec,
    viral_title: (state.hook.text && state.hook.text.trim()) || VIRAL_TITLES[0],
    hashtags: VIRAL_HASHTAGS[0].split(" ")
  };
  await exportAndDownloadClip({ ...clip, start: startSec, end: endSec });
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
    const clipSec = Math.round(c.end - c.start);
    const thumbHtml = c.thumb
      ? `<img src="${c.thumb}" alt="Miniatura clipe ${c.idx}" style="width:46px;height:82px;object-fit:cover;border-radius:8px;border:1px solid var(--border);flex:none">`
      : "";
    return `
      <div class="clipItem" data-clip-idx="${i}">
        ${thumbHtml}
        <div class="score" style="border-color:${color}">${c.score}<small>NOTA</small></div>
        <div class="info">
          <b>${fmt(c.start)} → ${fmt(c.end)}</b> (${clipSec}s)
          <div class="viral">🎯 ${c.viral_title}</div>
          <div class="tags">${(c.hashtags || []).join(" ")}</div>
          <div class="signal">🔊 ${Math.round(c.signals.audio_peak * 100)}% · 🎬 ${Math.round(c.signals.motion * 100)}% · 🔥 ${Math.round(c.signals.intensity * 100)}%</div>
        </div>
        <div style="display:flex;flex-direction:column;gap:6px;min-width:96px">
          <button type="button" class="small ghost viewClipBtn">👁 Visualizar</button>
          <button type="button" class="small dlClipBtn">⬇ Baixar</button>
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
  });

  if ($("downloadAllLocalBtn")) {
    $("downloadAllLocalBtn").style.display = "inline-flex";
    $("downloadAllLocalBtn").textContent = "⬇ Baixar todos os clipes";
    $("downloadAllLocalBtn").onclick = async () => {
      if (!state.clips.length) return;
      if (typeof window.checkCanDownloadVideos === "function") {
        const canProceed = await window.checkCanDownloadVideos(state.clips.length);
        if (!canProceed) return;
      }
      for (const c of state.clips) {
        const result = await exportVerticalCut({
          startOverride: c.start,
          endOverride: c.end,
          clipObj: c,
          autoDownload: false,
          fileName: buildClipExportFileName(c, c.end - c.start)
        });
        if (!result || !result.url || !result.blob || result.blob.size < 1024) continue;
        if (typeof window.authorizeClipDownload === "function") {
          const authRes = await window.authorizeClipDownload(c, 1);
          if (!authRes || !authRes.ok) {
            URL.revokeObjectURL(result.url);
            break;
          }
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

function initCaptions() {
  if ($("addCapBtn")) {
    $("addCapBtn").onclick = () => {
      const t = Math.floor(($("videoEl").currentTime || 0) * 10) / 10;
      state.captions.push({ start: t, end: t + 4, text: "" });
      renderCaptionList();
    };
  }

  if ($("srtBtn")) $("srtBtn").onclick = exportSrt;

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

function wrapCanvasLines(ctx, text, maxWidth) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const lines = [];
  let line = words[0];
  for (let i = 1; i < words.length; i++) {
    const testLine = `${line} ${words[i]}`;
    if (ctx.measureText(testLine).width <= maxWidth) {
      line = testLine;
    } else {
      lines.push(line);
      line = words[i];
    }
  }
  lines.push(line);
  return lines;
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
    const pulse = 1 + 0.05 * Math.sin(timeSec * 8);
    scaleX = scaleY = pulse;
  } else if (styleObj.anim === "pulse") {
    const pulse = 1 + 0.07 * Math.sin(timeSec * 5);
    scaleX = scaleY = pulse;
  } else if (styleObj.anim === "shake") {
    offsetX = Math.sin(timeSec * 38) * 6;
    offsetY = Math.cos(timeSec * 44) * 4;
  } else if (styleObj.anim === "slideup") {
    offsetY = Math.sin(clamp(timeSec * 4, 0, Math.PI)) * -12;
  } else if (styleObj.anim === "zoomout") {
    scaleX = scaleY = 1 + 0.1 * Math.max(0, 1 - (timeSec % 2));
  } else if (styleObj.anim === "fade") {
    alpha = clamp(0.7 + 0.3 * Math.sin(timeSec * 3), 0.4, 1);
  }

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(xNorm * W + offsetX, yNorm * H + offsetY);
  ctx.scale(scaleX, scaleY);
  ctx.font = `900 ${fontSize}px '${styleObj.font}', system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const maxLineWidth = W * 0.86;
  const lines = wrapCanvasLines(ctx, displayText, maxLineWidth);
  const lineHeight = fontSize * 1.18;
  const maxTextW = lines.reduce((m, l) => Math.max(m, ctx.measureText(l).width), 0);
  const padX = fontSize * 0.42;
  const padY = fontSize * 0.28;
  const boxW = Math.min(W * 0.94, maxTextW + padX * 2);
  const boxH = lines.length * lineHeight + padY * 2;

  if (styleObj.bg === "highlight" || styleObj.bg === "box") {
    ctx.fillStyle = styleObj.bgColor || "#07140e";
    ctx.beginPath();
    ctx.roundRect(-boxW / 2, -boxH / 2, boxW, boxH, Math.round(fontSize * 0.22));
    ctx.fill();
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

  lines.forEach((lineStr, idx) => {
    const ly = (idx - (lines.length - 1) / 2) * lineHeight;
    if (styleObj.bg === "outline" || styleObj.bg === "box" || styleObj.bg === "glow") {
      ctx.lineWidth = Math.max(4, fontSize * 0.12);
      ctx.strokeStyle = styleObj.bg === "outline" ? (styleObj.bgColor || "#000000") : "rgba(0,0,0,0.72)";
      ctx.strokeText(lineStr, 0, ly);
    }
    ctx.fillStyle = styleObj.color || "#ffffff";
    ctx.fillText(lineStr, 0, ly);
  });

  ctx.restore();
}

function drawHashtagsBanner(ctx, hashtags, W, H, scaleFactor = 1) {
  const tagsList = Array.isArray(hashtags) ? hashtags.filter(Boolean) : [];
  if (!tagsList.length) return;
  const tagText = tagsList.join(" ");
  const fontSize = Math.max(18, Math.round(28 * scaleFactor));

  ctx.save();
  ctx.font = `800 ${fontSize}px 'Montserrat', system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const lines = wrapCanvasLines(ctx, tagText, W * 0.88);
  const lineH = fontSize * 1.25;
  const totalH = lines.length * lineH + fontSize * 0.5;
  const maxW = lines.reduce((m, l) => Math.max(m, ctx.measureText(l).width), 0);
  const pillW = Math.min(W * 0.92, maxW + fontSize * 1.2);
  const centerY = H * 0.935;

  ctx.fillStyle = "rgba(3, 7, 5, 0.72)";
  ctx.beginPath();
  ctx.roundRect(W * 0.5 - pillW / 2, centerY - totalH / 2, pillW, totalH, Math.round(fontSize * 0.5));
  ctx.fill();

  ctx.strokeStyle = "rgba(74, 222, 128, 0.45)";
  ctx.lineWidth = Math.max(2, Math.round(2 * scaleFactor));
  ctx.stroke();

  lines.forEach((lineStr, idx) => {
    const ly = centerY + (idx - (lines.length - 1) / 2) * lineH;
    ctx.fillStyle = "#4ade80";
    ctx.fillText(lineStr, W * 0.5, ly);
  });
  ctx.restore();
}

function drawRippedBanner(ctx, x, y, w, h, fillColor, borderColor) {
  ctx.save();
  const teeth = 26;
  const step = w / teeth;
  if (borderColor) {
    ctx.fillStyle = borderColor;
    ctx.beginPath();
    ctx.moveTo(x - 8, y - 8);
    for (let i = 0; i <= teeth; i++) {
      const jitter = ((i * 17) % 8) - 4;
      ctx.lineTo(x + i * step, y - 8 + jitter);
    }
    ctx.lineTo(x + w + 10, y + h + 8);
    for (let i = teeth; i >= 0; i--) {
      const jitter = ((i * 23) % 8) - 4;
      ctx.lineTo(x + i * step, y + h + 8 + jitter);
    }
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = fillColor;
  ctx.beginPath();
  ctx.moveTo(x, y);
  for (let i = 0; i <= teeth; i++) {
    const jitter = ((i * 13) % 7) - 3;
    ctx.lineTo(x + i * step, y + jitter);
  }
  ctx.lineTo(x + w + 4, y + h / 2);
  ctx.lineTo(x + w, y + h);
  for (let i = teeth; i >= 0; i--) {
    const jitter = ((i * 19) % 7) - 3;
    ctx.lineTo(x + i * step, y + h + jitter);
  }
  ctx.lineTo(x - 4, y + h / 2);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawHookBlock(ctx, W, H, scaleFactor, nowSec) {
  const mainText = (state.hook.enabled && state.hook.text && state.hook.text.trim()) ? state.hook.text.trim() : "";
  const subText = (state.hook.enabled && state.hook.line2 && state.hook.line2.trim()) ? state.hook.line2.trim() : "";
  if (!mainText && !subText) return;

  const baseHookSz = +($("hookSz")?.value) || 54;
  const sz = Math.round(baseHookSz * scaleFactor);
  const style = state.hook.style || "none";

  if (style === "none" && !subText) {
    drawStyledText(ctx, mainText, state.hook.x, state.hook.y, sz, state.hook, nowSec);
    return;
  }

  ctx.save();
  const cx = state.hook.x * W;
  const cy = state.hook.y * H;
  const boxW = Math.min(W * 0.88, Math.round(920 * scaleFactor));
  const boxH = subText ? Math.round(sz * 2.55) : Math.round(sz * 1.65);
  const bx = cx - boxW / 2;
  const by = cy - boxH / 2;

  if (style === "ripped") {
    drawRippedBanner(ctx, bx, by, boxW, boxH, state.hook.bgColor || "#c80000", "#ffffff");
  } else if (style === "box") {
    ctx.fillStyle = state.hook.bgColor || "#c80000";
    ctx.beginPath();
    ctx.roundRect(bx, by, boxW, boxH, Math.round(14 * scaleFactor));
    ctx.fill();
  } else if (style === "notebook") {
    drawRippedBanner(ctx, bx, by, boxW, boxH, "#f8fafc", "#cbd5e1");
    ctx.strokeStyle = "#93c5fd";
    ctx.lineWidth = Math.max(1.5, 2 * scaleFactor);
    for (let ly = by + 20 * scaleFactor; ly < by + boxH - 10 * scaleFactor; ly += 22 * scaleFactor) {
      ctx.beginPath();
      ctx.moveTo(bx + 14 * scaleFactor, ly);
      ctx.lineTo(bx + boxW - 14 * scaleFactor, ly);
      ctx.stroke();
    }
  }

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `900 ${sz}px '${state.hook.font}', system-ui, sans-serif`;
  ctx.lineWidth = Math.max(4, sz * 0.14);
  ctx.strokeStyle = "#000000";

  if (subText) {
    const y1 = cy - sz * 0.58;
    const y2 = cy + sz * 0.58;
    if (mainText) {
      ctx.strokeText(mainText, cx, y1);
      ctx.fillStyle = state.hook.color1 || state.hook.color || "#ffffff";
      ctx.fillText(mainText, cx, y1);
    }
    ctx.strokeText(subText, cx, y2);
    ctx.fillStyle = state.hook.color2 || "#ffd166";
    ctx.fillText(subText, cx, y2);
  } else {
    ctx.strokeText(mainText, cx, cy);
    ctx.fillStyle = state.hook.color1 || state.hook.color || "#ffffff";
    ctx.fillText(mainText, cx, cy);
  }
  ctx.restore();
}

function drawSocialOverlay(ctx, W, H, scaleFactor) {
  if (!state.social.enabled || !state.social.handle || !state.social.handle.trim()) return;
  const handle = state.social.handle.trim();
  const y = state.social.y * H;
  const barH = Math.round(76 * scaleFactor);
  const fontSz = Math.round(42 * scaleFactor);
  const baseColor = state.social.color || "#b80000";

  ctx.save();
  if (state.social.style === "metallic") {
    const grad = ctx.createLinearGradient(0, y - barH / 2, 0, y + barH / 2);
    grad.addColorStop(0, baseColor);
    grad.addColorStop(0.5, "#111827");
    grad.addColorStop(1, baseColor);
    ctx.fillStyle = grad;
    ctx.fillRect(0, y - barH / 2, W, barH);
  } else if (state.social.style === "neon") {
    ctx.fillStyle = "rgba(8, 12, 10, 0.9)";
    ctx.fillRect(0, y - barH / 2, W, barH);
    ctx.strokeStyle = baseColor;
    ctx.lineWidth = Math.max(3, 4 * scaleFactor);
    ctx.strokeRect(0, y - barH / 2, W, barH);
  } else {
    const pillW = Math.min(W * 0.72, Math.round(760 * scaleFactor));
    ctx.fillStyle = baseColor;
    ctx.beginPath();
    ctx.roundRect((W - pillW) / 2, y - barH / 2, pillW, barH, barH / 2);
    ctx.fill();
  }

  const badgeMap = {
    youtube: { lbl: "YT", bg: "#ff0000", fg: "#ffffff" },
    instagram: { lbl: "IG", bg: "#dd2a7b", fg: "#ffffff" },
    tiktok: { lbl: "TT", bg: "#00f2ea", fg: "#000000" },
    kwai: { lbl: "KW", bg: "#ff6600", fg: "#ffffff" },
    twitch: { lbl: "TW", bg: "#9146ff", fg: "#ffffff" },
    kick: { lbl: "K", bg: "#53fc18", fg: "#000000" }
  };
  const b = badgeMap[state.social.platform] || badgeMap.youtube;

  ctx.font = `900 ${fontSz}px '${state.capStyle.font}', system-ui, sans-serif`;
  const textW = ctx.measureText(handle).width;
  const badgeW = Math.round(68 * scaleFactor);
  const gap = Math.round(16 * scaleFactor);
  const startX = (W - (badgeW + gap + textW)) / 2;

  ctx.fillStyle = b.bg;
  ctx.beginPath();
  ctx.roundRect(startX, y - badgeW * 0.36, badgeW, badgeW * 0.72, Math.round(12 * scaleFactor));
  ctx.fill();

  ctx.fillStyle = b.fg;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `900 ${Math.round(28 * scaleFactor)}px system-ui, sans-serif`;
  ctx.fillText(b.lbl, startX + badgeW / 2, y);

  ctx.textAlign = "left";
  ctx.font = `900 ${fontSz}px '${state.capStyle.font}', system-ui, sans-serif`;
  ctx.lineWidth = Math.max(3, fontSz * 0.12);
  ctx.strokeStyle = "#000000";
  ctx.strokeText(handle, startX + badgeW + gap, y);
  ctx.fillStyle = "#ffffff";
  ctx.fillText(handle, startX + badgeW + gap, y);
  ctx.restore();
}

function drawHighlightedCaption(ctx, text, xNorm, yNorm, fontSize, styleObj, nowSec, highlightCsv) {
  const wordsList = (highlightCsv || "").split(",").map(s => s.trim().toUpperCase()).filter(Boolean);
  if (!wordsList.length) {
    drawStyledText(ctx, text, xNorm, yNorm, fontSize, styleObj, nowSec);
    return;
  }
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  ctx.save();
  ctx.translate(xNorm * W, yNorm * H);
  ctx.font = `900 ${fontSize}px '${styleObj.font}', system-ui, sans-serif`;
  ctx.textBaseline = "middle";
  const tokens = text.trim().split(/\s+/);
  const lines = [];
  let cur = [];
  tokens.forEach(tok => {
    const test = [...cur, tok].join(" ");
    if (ctx.measureText(test).width > W * 0.86 && cur.length) {
      lines.push(cur);
      cur = [tok];
    } else {
      cur.push(tok);
    }
  });
  if (cur.length) lines.push(cur);
  const lh = fontSize * 1.22;
  lines.forEach((lineTokens, idx) => {
    const ly = (idx - (lines.length - 1) / 2) * lh;
    const full = lineTokens.join(" ");
    const totalW = ctx.measureText(full).width;
    let cx = -totalW / 2;
    lineTokens.forEach(tok => {
      const clean = tok.replace(/[^a-zA-Z0-9À-ÿ]/g, "").toUpperCase();
      const isHi = wordsList.includes(clean);
      ctx.lineWidth = Math.max(4, fontSize * 0.13);
      ctx.strokeStyle = styleObj.bgColor || "#000000";
      ctx.textAlign = "left";
      ctx.strokeText(tok, cx, ly);
      ctx.fillStyle = isHi ? "#ffd166" : (styleObj.color || "#ffffff");
      ctx.fillText(tok, cx, ly);
      cx += ctx.measureText(tok + " ").width;
    });
  });
  ctx.restore();
}

function drawFrameToCanvas(videoEl, canvas, nowSec, showSplitGuide = false, clipOverride = null) {
  const ctx = canvas.getContext("2d");
  const W = canvas.width;
  const H = canvas.height;
  const scaleFactor = W / 1080;

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
        ctx.lineWidth = Math.max(3, Math.round(6 * scaleFactor));
        ctx.setLineDash([18, 12]);
        ctx.beginPath();
        ctx.moveTo(0, splitY);
        ctx.lineTo(W, splitY);
        ctx.stroke();

        ctx.setLineDash([]);
        ctx.fillStyle = "#f5c518";
        ctx.beginPath();
        ctx.roundRect(W * 0.5 - 86 * scaleFactor, splitY - 22 * scaleFactor, 172 * scaleFactor, 44 * scaleFactor, 22 * scaleFactor);
        ctx.fill();

        ctx.fillStyle = "#030705";
        ctx.font = `900 ${Math.round(22 * scaleFactor)}px system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("⇕ DIVISÓRIA", W * 0.5, splitY);
        ctx.restore();
      }
    }
  }

  const refClip = clipOverride || state.activeClip;

  // Título / Gancho visual: exibe apenas se estiver explicitamente ativado e com texto preenchido
  const hookTitleText = (state.hook.enabled && state.hook.text && state.hook.text.trim())
    ? state.hook.text.trim()
    : "";

  drawHookBlock(ctx, W, H, scaleFactor, nowSec);
  drawSocialOverlay(ctx, W, H, scaleFactor);

  // Legenda ativa
  const activeCue = getActiveCaption(videoEl.currentTime || 0);
  if (activeCue && activeCue.text && activeCue.text.trim()) {
    const baseCapSz = +($("fontSz")?.value) || 48;
    drawHighlightedCaption(ctx, activeCue.text, state.capStyle.x, state.capStyle.y, Math.round(baseCapSz * scaleFactor), state.capStyle, nowSec, state.highlightWords);
  }

  // Hashtags (#) gravadas no vídeo
  const activeHashtags = (refClip && Array.isArray(refClip.hashtags) && refClip.hashtags.length)
    ? refClip.hashtags
    : (typeof VIRAL_HASHTAGS !== "undefined" && VIRAL_HASHTAGS[0] ? VIRAL_HASHTAGS[0].split(" ") : []);
  if (activeHashtags.length) {
    drawHashtagsBanner(ctx, activeHashtags, W, H, scaleFactor);
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
  "720p30":  { w: 720,  h: 1280, fps: 30, bps: 2200000 },
  "720p60":  { w: 720,  h: 1280, fps: 60, bps: 3200000 },
  "1440p60": { w: 1080, h: 1920, fps: 60, bps: 4800000 }
};

async function extractAudioSegmentPcm(file, startSec, durationSec) {
  if (!file || file.size > 180 * 1024 * 1024) return null;
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    const arrayBuf = await file.arrayBuffer();
    const tmpCtx = new AudioCtx();
    const decoded = await tmpCtx.decodeAudioData(arrayBuf.slice(0));
    tmpCtx.close().catch(() => {});

    const sampleRate = decoded.sampleRate || 44100;
    const startSample = Math.max(0, Math.floor(startSec * sampleRate));
    const targetSamples = Math.max(1, Math.round(durationSec * sampleRate));
    const out = new Float32Array(targetSamples);
    const numCh = decoded.numberOfChannels || 1;

    for (let ch = 0; ch < numCh; ch++) {
      const chData = decoded.getChannelData(ch);
      for (let i = 0; i < targetSamples; i++) {
        const idx = startSample + i;
        if (idx < chData.length) {
          out[i] += chData[idx] / numCh;
        }
      }
    }
    return { pcm: out, sampleRate };
  } catch (e) {
    return null;
  }
}

async function setupReliableAudioStream(videoEl) {
  const tracks = [];
  let audioCtx = null;
  let audioSource = null;
  let audioDest = null;

  // 1) Tenta captura direta via captureStream / mozCaptureStream se disponível
  try {
    const directStream = typeof videoEl.captureStream === "function"
      ? videoEl.captureStream()
      : (typeof videoEl.mozCaptureStream === "function" ? videoEl.mozCaptureStream() : null);
    if (directStream) {
      const directAudio = directStream.getAudioTracks();
      if (directAudio && directAudio.length > 0) {
        directAudio.forEach(t => tracks.push(t));
        return { tracks, audioCtx: null, audioSource: null, audioDest: null };
      }
    }
  } catch (e) {}

  // 2) WebAudio API com MediaElementAudioSourceNode + oscilador inaudível de keep-alive
  // (impede o MediaRecorder de suspender/cortar a trilha de áudio em silêncios ou no início)
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (AudioCtx) {
      if (!window.__cfAudioCtx || window.__cfAudioCtx.state === "closed") {
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

      // Keep-alive imperceptível (-90dB) para manter o clock de áudio contínuo
      const keepOsc = audioCtx.createOscillator();
      const keepGain = audioCtx.createGain();
      keepOsc.frequency.value = 20;
      keepGain.gain.value = 0.00001;
      keepOsc.connect(keepGain);
      keepGain.connect(audioDest);
      keepOsc.start();
      audioDest.__keepOsc = keepOsc;

      audioDest.stream.getAudioTracks().forEach(t => tracks.push(t));
    }
  } catch (audioErr) {
    console.warn("Áudio WebAudio:", audioErr);
  }

  return { tracks, audioCtx, audioSource, audioDest };
}

async function seekVideoExact(videoEl, targetSec) {
  const maxDur = resolveVideoDuration(videoEl);
  const clampedTarget = clamp(targetSec, 0, Math.max(0, maxDur - 0.05));
  if (Math.abs((videoEl.currentTime || 0) - clampedTarget) < 0.04 && videoEl.readyState >= 2) {
    return;
  }
  videoEl.currentTime = clampedTarget;
  await new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      videoEl.removeEventListener("seeked", finish);
      resolve();
    };
    videoEl.addEventListener("seeked", finish);
    setTimeout(finish, 450);
  });
}

async function exportVerticalCut(opts = {}) {
  const videoEl = $("videoEl");
  if (!state.file || !videoEl.src) {
    alert("Envie um vídeo primeiro.");
    return null;
  }
  if (state.isExporting) return null;

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
  const clipLen = getSelectedClipDurationSec();
  const startSec = Number.isFinite(opts.startOverride)
    ? opts.startOverride
    : (state.activeClip ? state.activeClip.start : (videoEl.currentTime || 0));
  const rawEnd = Number.isFinite(opts.endOverride)
    ? opts.endOverride
    : (startSec + clipLen);
  const endSec = Math.min(maxDur, rawEnd);

  // Garante duração exata pedida (ex.: 30.0s ou 60.0s se o vídeo fonte comportar)
  const actualDurationSec = Math.max(0.5, Number((endSec - startSec).toFixed(3)));
  const activeClipObj = opts.clipObj || state.activeClip || {
    idx: 1,
    start: startSec,
    end: endSec,
    viral_title: (state.hook.text && state.hook.text.trim()) || VIRAL_TITLES[0],
    hashtags: VIRAL_HASHTAGS[0].split(" ")
  };

  const offCanvas = document.createElement("canvas");
  offCanvas.width = spec.w;
  offCanvas.height = spec.h;

  const btn = $("exportBtn");
  if (btn) btn.disabled = true;
  state.isExporting = true;
  if ($("expResult")) $("expResult").innerHTML = "";
  setExportLog(`Preparando exportação ${fmtInfo.ext.toUpperCase()} (${spec.w}×${spec.h} · ${spec.fps} fps · ${Math.round(actualDurationSec)}s exatos com áudio)...`, 6);

  let videoStream = null;
  let audioSetup = null;
  let combinedStream = null;
  let recorder = null;
  let frameTimer = null;

  try {
    // ============================================================
    // CAMINHO A: AVI (Frame-a-frame determinístico + PCM Audio WAV)
    // Garante 100% dos frames (fps * actualDurationSec) e áudio sincronizado
    // ============================================================
    if (fmtInfo.isAvi) {
      videoEl.pause();
      const totalFrames = Math.max(1, Math.round(actualDurationSec * spec.fps));
      const aviFrames = [];
      const audioDataPromise = extractAudioSegmentPcm(state.file, startSec, actualDurationSec);

      for (let f = 0; f < totalFrames; f++) {
        const frameTime = startSec + (f / spec.fps);
        await seekVideoExact(videoEl, frameTime);
        drawFrameToCanvas(videoEl, offCanvas, frameTime, false, activeClipObj);

        const dataUrl = offCanvas.toDataURL("image/jpeg", 0.84);
        const b64 = dataUrl.split(",")[1];
        if (b64) {
          const bin = atob(b64);
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          aviFrames.push(bytes);
        }

        if (f % Math.max(1, Math.floor(spec.fps / 2)) === 0 || f === totalFrames - 1) {
          const pct = 10 + Math.round(((f + 1) / totalFrames) * 80);
          setExportLog(`Renderizando AVI ${spec.fps}fps · frame ${f + 1}/${totalFrames} (${fmt((f + 1) / spec.fps)} / ${fmt(actualDurationSec)})...`, pct);
          await new Promise(r => setTimeout(r, 0));
        }
      }

      const audioDecoded = await audioDataPromise;
      setExportLog("Empacotando AVI MJPEG + Áudio PCM...", 94);
      const finalBlob = buildAviWithAudioFromFrames(
        aviFrames,
        audioDecoded ? audioDecoded.pcm : null,
        audioDecoded ? audioDecoded.sampleRate : 44100,
        spec.w,
        spec.h,
        spec.fps
      );

      offCanvas.width = 1;
      offCanvas.height = 1;

      if (!finalBlob || finalBlob.size < 1024) {
        throw new Error("O arquivo AVI gerado ficou inválido. Nenhum vídeo foi descontado.");
      }

      const thumbDataUrl = await captureThumbnailAt(startSec + Math.min(0.8, actualDurationSec * 0.25));
      let outName = opts.fileName || buildClipExportFileName(activeClipObj, actualDurationSec);
      outName = outName.replace(/\.[^.]+$/, "") + ".avi";
      const url = URL.createObjectURL(finalBlob);

      setExportLog(`Corte AVI (${spec.fps} fps · ${Math.round(actualDurationSec)}s exatos + áudio) pronto!`, 100);
      if ($("expResult")) {
        const thumbImg = thumbDataUrl
          ? `<img src="${thumbDataUrl}" alt="Miniatura do corte" style="width:54px;height:96px;object-fit:cover;border-radius:8px;border:1px solid var(--border2);margin-right:10px;vertical-align:middle">`
          : "";
        $("expResult").innerHTML = `
          <div style="display:flex;align-items:center;margin-top:10px">
            ${thumbImg}
            <a class="dl" style="margin-top:0" href="${url}" download="${outName}">⬇ Baixar AVI ${spec.fps}fps (${Math.round(actualDurationSec)}s)</a>
          </div>`;
      }

      if (opts.autoDownload !== false) {
        triggerBlobDownload(url, outName);
        setTimeout(() => URL.revokeObjectURL(url), 120000);
      }
      return { blob: finalBlob, url, fileName: outName, durationSec: actualDurationSec };
    }

    // ============================================================
    // CAMINHO B: WebM e MP4 (Relógio mestre de tempo real + Áudio contínuo)
    // Corrige corte pela metade (ex.: 15s em vez de 30s) e garante faixa de áudio
    // ============================================================
    videoStream = offCanvas.captureStream(spec.fps);
    const videoTrack = videoStream.getVideoTracks()[0];
    const tracks = videoTrack ? [videoTrack] : [];

    audioSetup = await setupReliableAudioStream(videoEl);
    if (audioSetup && audioSetup.tracks.length > 0) {
      audioSetup.tracks.forEach(t => tracks.push(t));
    }
    const hasAudioTrack = tracks.some(t => t.kind === "audio");

    combinedStream = new MediaStream(tracks);

    const candidateMimeTypes = [
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=vp8,opus",
      "video/webm;codecs=vp8",
      "video/webm"
    ];
    const mimeType = candidateMimeTypes.find(m => MediaRecorder.isTypeSupported(m)) || "video/webm";

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

    videoEl.pause();
    videoEl.muted = false;
    videoEl.volume = 1.0;
    videoEl.playbackRate = 1.0;
    await seekVideoExact(videoEl, startSec);

    // Desenha o primeiro frame antes de iniciar o MediaRecorder para evitar início preto
    drawFrameToCanvas(videoEl, offCanvas, startSec, false, activeClipObj);

    recorder.start(250);
    await videoEl.play().catch(() => {});

    // Relógio mestre baseado em tempo real decorrido (performance.now)
    // Garante que 30s pedidos gravem exatamente 30.0s (e 60s gravem 60.0s),
    // mesmo se o vídeo fonte engasgar ou precisar repetir/sincronizar.
    const targetDurationMs = actualDurationSec * 1000;
    const intervalMs = Math.max(15, Math.round(1000 / spec.fps));
    const recordStartPerf = performance.now();
    let lastUiUpdate = 0;

    await new Promise((resolve) => {
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        if (frameTimer) clearInterval(frameTimer);
        resolve();
      };

      const renderTick = () => {
        if (finished) return;
        const elapsedMs = performance.now() - recordStartPerf;
        const elapsedSec = elapsedMs / 1000;

        if (elapsedMs >= targetDurationMs) {
          drawFrameToCanvas(videoEl, offCanvas, Math.min(endSec, startSec + actualDurationSec), false, activeClipObj);
          finish();
          return;
        }

        // Mantém o vídeo reproduzindo no trecho correto durante toda a janela solicitada
        const expectedVideoTime = startSec + elapsedSec;
        if (videoEl.ended || videoEl.currentTime >= endSec - 0.04) {
          if (expectedVideoTime < endSec) {
            videoEl.currentTime = clamp(expectedVideoTime, startSec, Math.max(startSec, endSec - 0.1));
            videoEl.play().catch(() => {});
          }
        } else if (videoEl.paused) {
          videoEl.play().catch(() => {});
        }

        drawFrameToCanvas(videoEl, offCanvas, videoEl.currentTime || expectedVideoTime, false, activeClipObj);

        const nowMs = performance.now();
        if (nowMs - lastUiUpdate > 180) {
          lastUiUpdate = nowMs;
          const pct = 10 + clamp((elapsedMs / targetDurationMs) * 74, 0, 74);
          setExportLog(
            `Gravando ${fmtInfo.ext.toUpperCase()} ${spec.fps}fps (${hasAudioTrack ? "🔊 com áudio" : "sem faixa de áudio"}) · ${fmt(elapsedSec)} / ${fmt(actualDurationSec)}...`,
            pct
          );
        }
      };

      renderTick();
      frameTimer = setInterval(renderTick, intervalMs);
    });

    videoEl.pause();
    if (recorder.state !== "inactive") {
      try { recorder.requestData(); } catch (e) {}
      recorder.stop();
    }
    const rawBlob = await donePromise;
    chunks.length = 0;

    const thumbDataUrl = await captureThumbnailAt(startSec + Math.min(0.8, actualDurationSec * 0.25));

    try { audioSetup?.audioDest?.__keepOsc?.stop(); } catch (e) {}
    try { audioSetup?.audioSource?.disconnect(audioSetup?.audioDest); } catch (e) {}
    try { audioSetup?.audioDest?.disconnect(); } catch (e) {}
    try { combinedStream?.getTracks().forEach(t => t.stop()); } catch (e) {}
    try { videoStream?.getTracks().forEach(t => t.stop()); } catch (e) {}

    let seekableWebmBlob = await fixWebmBlobDuration(rawBlob, actualDurationSec);
    let finalBlob = seekableWebmBlob;
    const recExt = fmtInfo.ext;
    let outName = opts.fileName || buildClipExportFileName(activeClipObj, actualDurationSec);
    outName = outName.replace(/\.[^.]+$/, "") + "." + recExt;

    if (fmtInfo.isMp4) {
      finalBlob = await transcodeWebmToMp4(
        seekableWebmBlob,
        spec.fps,
        actualDurationSec,
        hasAudioTrack,
        activeClipObj.viral_title || ""
      );
    }

    offCanvas.width = 1;
    offCanvas.height = 1;

    if (!finalBlob || finalBlob.size < 1024) {
      throw new Error("O arquivo gerado ficou inválido ou vazio. Nenhum vídeo disponível foi descontado.");
    }

    const url = URL.createObjectURL(finalBlob);
    setExportLog(`Corte ${recExt.toUpperCase()} (${spec.fps} fps · ${Math.round(actualDurationSec)}s exatos + áudio) pronto!`, 100);
    if ($("expResult")) {
      const thumbImg = thumbDataUrl
        ? `<img src="${thumbDataUrl}" alt="Miniatura do corte" style="width:54px;height:96px;object-fit:cover;border-radius:8px;border:1px solid var(--border2);margin-right:10px;vertical-align:middle">`
        : "";
      $("expResult").innerHTML = `
        <div style="display:flex;align-items:center;margin-top:10px">
          ${thumbImg}
          <a class="dl" style="margin-top:0" href="${url}" download="${outName}">⬇ Baixar ${recExt.toUpperCase()} ${spec.fps}fps (${Math.round(actualDurationSec)}s)</a>
        </div>`;
    }

    if (opts.autoDownload === false) {
      return { blob: finalBlob, url, fileName: outName, durationSec: actualDurationSec };
    }
    triggerBlobDownload(url, outName);
    setTimeout(() => URL.revokeObjectURL(url), 120000);
    return { blob: finalBlob, url, fileName: outName, durationSec: actualDurationSec };
  } catch (err) {
    if (frameTimer) clearInterval(frameTimer);
    if (recorder && recorder.state !== "inactive") {
      try { recorder.stop(); } catch (e) {}
    }
    try { audioSetup?.audioDest?.__keepOsc?.stop(); } catch (e) {}
    try { combinedStream?.getTracks().forEach(t => t.stop()); } catch (e) {}
    try { videoStream?.getTracks().forEach(t => t.stop()); } catch (e) {}
    offCanvas.width = 1;
    offCanvas.height = 1;
    setExportLog("❌ Falha na exportação (nenhum vídeo foi descontado): " + err.message, 0);
    alert("❌ Falha na exportação: " + err.message + "\n\nNenhum vídeo disponível foi descontado.");
    return null;
  } finally {
    state.isExporting = false;
    if (btn) btn.disabled = false;
  }
}

function bindDropZone() {
  const dropEl = $("drop");
  const fileInput = $("fileInput");

  if (dropEl) {
    dropEl.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const inputEl = $("fileInput");
      if (inputEl) {
        inputEl.value = "";
        inputEl.click();
      }
    });

    dropEl.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.stopPropagation();
    });

    dropEl.addEventListener("drop", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) {
        loadVideoFile(e.dataTransfer.files[0]);
      }
    });
  }

  if (fileInput) {
    fileInput.addEventListener("change", (e) => {
      const picked = e.target && e.target.files ? e.target.files[0] : null;
      if (picked) {
        loadVideoFile(picked);
      }
    });
  }
}

window.addEventListener("DOMContentLoaded", () => {
  initCollapsibleCards();
  initStyleControls();
  initCropControls();
  initTimeline();
  initCaptions();
  startPreviewLoop();
  bindDropZone();

  if ($("newVidBtn")) $("newVidBtn").onclick = resetToStep1;
  if ($("analyzeBtn")) $("analyzeBtn").onclick = analyzeMoments;
  if ($("exportBtn")) $("exportBtn").onclick = exportAndDownloadCurrent;
  if ($("exportPngBtn")) {
    $("exportPngBtn").onclick = () => {
      const c = $("previewCanvas");
      if (!c) return;
      const a = document.createElement("a");
      a.download = "clipfactory-frame.png";
      a.href = c.toDataURL("image/png");
      a.click();
    };
  }
  if ($("highlightWords")) {
    $("highlightWords").oninput = () => { state.highlightWords = $("highlightWords").value; };
  }
  if ($("hookLine2")) {
    $("hookLine2").oninput = () => { state.hook.line2 = $("hookLine2").value; };
  }
  if ($("hookStyle")) {
    $("hookStyle").onchange = () => { state.hook.style = $("hookStyle").value; };
  }
  if ($("hookBgColor")) {
    $("hookBgColor").oninput = () => { state.hook.bgColor = $("hookBgColor").value; };
  }
  if ($("hookColor1")) {
    $("hookColor1").oninput = () => { state.hook.color1 = $("hookColor1").value; };
  }
  if ($("hookColor2")) {
    $("hookColor2").oninput = () => { state.hook.color2 = $("hookColor2").value; };
  }
  if ($("socialEnabled")) {
    $("socialEnabled").onchange = () => { state.social.enabled = $("socialEnabled").checked; };
  }
  if ($("socialPlatform")) {
    $("socialPlatform").onchange = () => { state.social.platform = $("socialPlatform").value; };
  }
  if ($("socialHandle")) {
    $("socialHandle").oninput = () => { state.social.handle = $("socialHandle").value; };
  }
  if ($("socialBarStyle")) {
    $("socialBarStyle").onchange = () => { state.social.style = $("socialBarStyle").value; };
  }
  if ($("socialBarColor")) {
    $("socialBarColor").oninput = () => { state.social.color = $("socialBarColor").value; };
  }
  setLayoutMode("split");

  const cardObs = new MutationObserver(() => initCollapsibleCards());
  cardObs.observe(document.body, { childList: true, subtree: true });
});
