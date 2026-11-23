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
  { name: "Caixa Escura", font: "Archivo Black", color: "#e9fff2", bg: "box", bgColor: "#07140e", anim: "slideup" },
  { name: "Faixa Turbo", font: "Anton", color: "#ffffff", bg: "highlight", bgColor: "#146c43", anim: "slideup" },
  { name: "Barra Clássica", font: "Poppins", color: "#ffffff", bg: "bar", bgColor: "#000000", anim: "fade" },
  { name: "HQ Gamer", font: "Bangers", color: "#ffd166", bg: "outline", bgColor: "#000000", anim: "shake" },
  { name: "Arcade Luck", font: "Luckiest Guy", color: "#4ade80", bg: "shadow", bgColor: "#000000", anim: "pop" },
  { name: "Marker Rua", font: "Permanent Marker", color: "#ffffff", bg: "glow", bgColor: "#16a34a", anim: "typewriter" },
  { name: "Righteous Neon", font: "Righteous", color: "#38bdf8", bg: "glow", bgColor: "#2563eb", anim: "pulse" },
  { name: "Oswald Limpo", font: "Oswald", color: "#e9fff2", bg: "outline", bgColor: "#07140e", anim: "fade" },
  { name: "Gradiente Elite", font: "Montserrat", color: "#ffffff", bg: "gradient", bgColor: "#0f5132", anim: "zoomout" },
  { name: "Alerta Vermelho", font: "Anton", color: "#ffffff", bg: "highlight", bgColor: "#991b1b", anim: "shake" },
  { name: "Fogo Laranja", font: "Bebas Neue", color: "#fed7aa", bg: "box", bgColor: "#7c2d12", anim: "pop" },
  { name: "Cyber Roxo", font: "Righteous", color: "#f3e8ff", bg: "glow", bgColor: "#7e22ce", anim: "pulse" },
  { name: "Rosa Clash", font: "Luckiest Guy", color: "#fce7f3", bg: "outline", bgColor: "#831843", anim: "pop" },
  { name: "Ciano Rush", font: "Archivo Black", color: "#e0f2fe", bg: "bar", bgColor: "#0c4a6e", anim: "slideup" },
  { name: "Sombra Dupla", font: "Montserrat", color: "#ffd166", bg: "gradient", bgColor: "#000000", anim: "fade" },
  { name: "Digitação Clip", font: "Poppins", color: "#86efac", bg: "box", bgColor: "#030705", anim: "typewriter" },
  { name: "Zoom Pro", font: "Anton", color: "#ffffff", bg: "outline", bgColor: "#000000", anim: "zoomout" },
  { name: "Pulseira Verde", font: "Oswald", color: "#bbf7d0", bg: "highlight", bgColor: "#0f5132", anim: "pulse" },
  { name: "Estouro HQ", font: "Bangers", color: "#ffffff", bg: "box", bgColor: "#146c43", anim: "pop" },
  { name: "Noite Dark", font: "Montserrat", color: "#e9fff2", bg: "bar", bgColor: "#07140e", anim: "fade" },
  { name: "Dourado Luxo", font: "Bebas Neue", color: "#fde047", bg: "gradient", bgColor: "#14532d", anim: "slideup" },
  { name: "Tremor Clutch", font: "Archivo Black", color: "#fca5a5", bg: "outline", bgColor: "#000000", anim: "shake" },
  { name: "Brilho Esmeralda", font: "Righteous", color: "#6ee7b7", bg: "glow", bgColor: "#059669", anim: "pop" },
  { name: "Linha Direta", font: "Poppins", color: "#ffffff", bg: "outline", bgColor: "#000000", anim: "none" },
  { name: "Karaoke Ouro", font: "Montserrat", color: "#fef08a", bg: "karaoke", bgColor: "#78350f", anim: "pulse" },
  { name: "Karaoke Ciano", font: "Montserrat", color: "#bae6fd", bg: "karaoke", bgColor: "#1e3a8a", anim: "pulse" },
  { name: "Karaoke Roxo", font: "Montserrat", color: "#e9d5ff", bg: "karaoke", bgColor: "#4c1d95", anim: "pulse" },
  { name: "Placa Verde", font: "Bebas Neue", color: "#030705", bg: "highlight", bgColor: "#4ade80", anim: "pop" },
  { name: "Placa Amarela", font: "Anton", color: "#030705", bg: "highlight", bgColor: "#ffd166", anim: "pop" },
  { name: "Placa Branca", font: "Archivo Black", color: "#030705", bg: "highlight", bgColor: "#ffffff", anim: "slideup" },
  { name: "Foco Total", font: "Oswald", color: "#ffffff", bg: "shadow", bgColor: "#000000", anim: "zoomout" },
  { name: "Squad Highlight", font: "Luckiest Guy", color: "#ffd166", bg: "box", bgColor: "#07140e", anim: "pop" },
  { name: "Solo Carry", font: "Bangers", color: "#4ade80", bg: "shadow", bgColor: "#000000", anim: "shake" },
  { name: "Tempo Real", font: "Poppins", color: "#e9fff2", bg: "bar", bgColor: "#146c43", anim: "typewriter" },
  { name: "Cortes Top", font: "Anton", color: "#86efac", bg: "outline", bgColor: "#07140e", anim: "slideup" },
  { name: "Tropa Ativa", font: "Righteous", color: "#ffffff", bg: "gradient", bgColor: "#198754", anim: "pop" },
  { name: "Radar Viral", font: "Bebas Neue", color: "#38bdf8", bg: "box", bgColor: "#030705", anim: "pulse" },
  { name: "Reflexo Rápido", font: "Archivo Black", color: "#fde047", bg: "outline", bgColor: "#000000", anim: "zoomout" },
  { name: "Zero Erro", font: "Montserrat", color: "#4ade80", bg: "bar", bgColor: "#030705", anim: "fade" },
  { name: "Mira Certa", font: "Oswald", color: "#ffffff", bg: "glow", bgColor: "#22c55e", anim: "pop" },
  { name: "Final épico", font: "Anton", color: "#ffd166", bg: "gradient", bgColor: "#7f1d1d", anim: "zoomout" },
  { name: "Selo Capudo", font: "Permanent Marker", color: "#4ade80", bg: "outline", bgColor: "#000000", anim: "pop" },
  { name: "Wave Neon", font: "Righteous", color: "#22c55e", bg: "box", bgColor: "#07140e", anim: "pulse" },
  { name: "Curto e Grosso", font: "Bebas Neue", color: "#ffffff", bg: "highlight", bgColor: "#0f5132", anim: "slideup" },
  { name: "Puro Hype", font: "Luckiest Guy", color: "#f97316", bg: "outline", bgColor: "#000000", anim: "shake" },
  { name: "Calma na Partida", font: "Poppins", color: "#dcfce7", bg: "shadow", bgColor: "#000000", anim: "fade" },
  { name: "Resenha da Live", font: "Montserrat", color: "#ffd166", bg: "bar", bgColor: "#07140e", anim: "typewriter" },
  { name: "Corte Cirúrgico", font: "Archivo Black", color: "#ffffff", bg: "glow", bgColor: "#146c43", anim: "pop" },
  { name: "Modo Turbo", font: "Anton", color: "#4ade80", bg: "gradient", bgColor: "#030705", anim: "zoomout" }
];

const HOOK_PRESETS = CAP_PRESETS.map((p, i) => ({
  ...p,
  name: `Gancho ${i + 1} · ${p.name}`
}));

const VIRAL_TITLES = [
  "ESSA JOGADA NINGUÉM ESPERAVA! 😱🔥",
  "OLHA O QUE ACONTECEU NESSE FINAL INSANO!",
  "CLUTCH ABSURDO NO ÚLTIMO SEGUNDO!",
  "COMO VIRAR O JOGO QUANDO TUDO PARECE PERDIDO",
  "O MOMENTO MAIS LOUCO DA PARTIDA INTEIRA",
  "REAÇÃO PURA! NÃO DEU NEM TEMPO DE PISCAR",
  "ISSO AQUI DEVIA SER PROIBIDO NA RANKED!"
];

const VIRAL_HASHTAGS = [
  "#cortes #gameplay #clipfactory #fy #viral",
  "#shorts #reels #gamer #highlight #clutch",
  "#fps #battleRoyale #live #capcut #fyp",
  "#jogada #proplayer #gaming #esports #viralizou"
];