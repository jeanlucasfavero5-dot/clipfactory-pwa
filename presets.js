"use strict";

const COLOR_SWATCHES = [
  "#ffffff", "#ffd166", "#22c55e", "#4ade80", "#38bdf8",
  "#60a5fa", "#f97316", "#ef4444", "#ec4899", "#a855f7",
  "#000000", "#07140e"
];

const BG_SWATCHES = [
  "#000000", "#07140e", "#0f5132", "#146c43", "#198754",
  "#1e3a8a", "#7f1d1d", "#78350f", "#4c1d95", "#ffffff"
];

const CAP_PRESETS = [
  { name: "Neon Verde", font: "Anton", color: "#4ade80", bg: "glow", bgColor: "#22c55e", anim: "pop" },
  { name: "Ouro Impacto", font: "Bebas Neue", color: "#ffd166", bg: "outline", bgColor: "#000000", anim: "pop" },
  { name: "Karaoke Esmeralda", font: "Montserrat", color: "#ffffff", bg: "karaoke", bgColor: "#198754", anim: "pulse" },
  { name: "Caixa Escura", font: "Archivo Black", color: "#e9fff2", bg: "box", bgColor: "#07140e", anim: "slideup" }
];

const HOOK_PRESETS = CAP_PRESETS.map((p, i) => ({
  ...p,
  name: `Gancho ${i + 1} · ${p.name}`
}));

const VIRAL_TITLES = [
  "ESSA JOGADA NINGUÉM ESPERAVA! 😱🔥",
  "OLHA O QUE ACONTECEU NESSE FINAL INSANO!",
  "CLUTCH ABSURDO NO ÚLTIMO SEGUNDO!",
  "COMO VIRAR O JOGO QUANDO TUDO PARECE PERDIDO"
];

const VIRAL_HASHTAGS = [
  "#cortes #gameplay #clipfactory #fy #viral",
  "#shorts #reels #gamer #highlight #clutch"
];

function pickRandomHookIdea() {
  return VIRAL_TITLES[Math.floor(Math.random() * VIRAL_TITLES.length)];
}

function pickRandomHashtags() {
  return VIRAL_HASHTAGS[Math.floor(Math.random() * VIRAL_HASHTAGS.length)];
}
