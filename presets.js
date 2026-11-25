"use strict";

const CAP_PRESETS = [
  { name: "Neon · Pop", font: "Anton", color: "#4ade80", bg: "glow", bgColor: "#22c55e", anim: "pop" },
  { name: "Ouro · Pulse", font: "Bebas Neue", color: "#ffd166", bg: "highlight", bgColor: "#07140e", anim: "pulse" },
  { name: "Impacto · Shake", font: "Anton", color: "#ffffff", bg: "bar", bgColor: "#e11d48", anim: "shake" },
  { name: "Clean · Slide", font: "Montserrat", color: "#38bdf8", bg: "gradient", bgColor: "#0f5132", anim: "slideup" }
];

const HOOK_PRESETS = [
  { name: "Caixa · Pop", font: "Bebas Neue", color: "#ffd166", bg: "box", bgColor: "#07140e", anim: "pop" },
  { name: "Rasgado · Shake", font: "Anton", color: "#ffffff", bg: "box", bgColor: "#e11d48", anim: "shake" },
  { name: "Faixa · Pulse", font: "Bebas Neue", color: "#4ade80", bg: "bar", bgColor: "#07140e", anim: "pulse" },
  { name: "Brilho · Zoom", font: "Anton", color: "#38bdf8", bg: "glow", bgColor: "#22c55e", anim: "zoomout" }
];

const COLOR_SWATCHES = ["#ffffff", "#ffd166", "#4ade80", "#38bdf8", "#f87171", "#f472b6"];
const BG_SWATCHES = ["#07140e", "#22c55e", "#e11d48", "#111827", "#0f172a", "#78350f"];

const VIRAL_TITLES = [
  "JOGADA INSANA! 🔥",
  "NINGUÉM ESPERAVA ISSO!",
  "CLUTCH ABSURDO NO FINAL!",
  "OLHA O QUE ELE FEZ AQUI!",
  "VIRADA IMPOSSÍVEL!"
];

const VIRAL_HASHTAGS = [
  "#cortes #viral #gaming",
  "#gameplay #clipfactory #shorts",
  "#highlights #fyp #reels",
  "#jogada #aovivo #cortesviral"
];

function pickRandomHookIdea() {
  return VIRAL_TITLES[Math.floor(Math.random() * VIRAL_TITLES.length)];
}

function pickRandomHashtags() {
  return VIRAL_HASHTAGS[Math.floor(Math.random() * VIRAL_HASHTAGS.length)];
}
