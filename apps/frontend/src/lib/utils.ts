import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function applyThemeTransition(duration = 250) {
  if (typeof document === "undefined") return;

  const root = document.documentElement;
  root.classList.add("theme-transitioning");

  window.setTimeout(() => {
    root.classList.remove("theme-transitioning");
  }, duration);
}

interface ThemeAnimationOptions {
  duration?: number;
  reverse?: boolean;
  x?: number;
  y?: number;
}

// Bangun keyframe clip-path berbentuk ZIGZAG bersudut halus (rounded).
// reverse === true  → wipe kiri→kanan, gigi menjorok ke kanan (">")
// reverse === false → wipe kanan→kiri, gigi menjorok ke kiri ("<")
// Tiap gigi pake cosine bell → puncaknya rounded (sopan, gak lancip).
// peaks, kedalaman, & lebar tiap gigi di-randomize di dalam sini, jadi
// tiap klik bentuknya beda-beda: ada yg pendek/panjang, kecil/besar.
function zigzagClipPath(
  reverse: boolean,
  peaks: number,
  options: { depthMin?: number; depthMax?: number; samples?: number } = {},
) {
  const n = Math.max(1, Math.round(peaks));
  const depthMin = options.depthMin ?? 7;
  const depthMax = options.depthMax ?? 26;
  const samples = options.samples ?? 10;

  const rand = (min: number, max: number) => min + Math.random() * (max - min);

  // Lebar tiap gigi diacak lalu dinormalisasi → ada gigi sempit & gigi lebar.
  const widthsRaw = Array.from({ length: n }, () => 0.5 + Math.random());
  const widthSum = widthsRaw.reduce((a, b) => a + b, 0);
  const widths = widthsRaw.map((w) => (w / widthSum) * 100);

  // Kedalaman tiap gigi diacak → ada gigi pendek & gigi panjang.
  const humpDepth = Array.from({ length: n }, () => rand(depthMin, depthMax));

  // Posisi-y mulai tiap gigi (kumulatif).
  const yStarts: number[] = [];
  {
    let acc = 0;
    for (let k = 0; k < n; k++) {
      yStarts.push(acc);
      acc += widths[k];
    }
  }

  let leftFrom: number, leftTo: number;
  let baseFrom: number, baseTo: number;
  if (reverse) {
    leftFrom = -100;
    leftTo = 0;
    baseFrom = -50;
    baseTo = 100;
  } else {
    leftFrom = 200;
    leftTo = 100;
    baseFrom = 150;
    baseTo = 0;
  }
  const sign = reverse ? 1 : -1;

  // Sample titik edge dari y=0 → y=100. Offset tiap titik = depth*gigi *
  // cosine bell → puncak rounded mulus.
  const edgePts: { y: number; offset: number }[] = [];
  for (let k = 0; k < n; k++) {
    const y0 = yStarts[k];
    const y1 = k === n - 1 ? 100 : yStarts[k + 1];
    const d = humpDepth[k];
    for (let s = 0; s < samples; s++) {
      const t = s / samples;
      const bump = 0.5 - 0.5 * Math.cos(2 * Math.PI * t);
      edgePts.push({ y: y0 + t * (y1 - y0), offset: sign * d * bump });
    }
  }
  edgePts.push({ y: 100, offset: 0 });

  const from: string[] = [];
  const to: string[] = [];
  const push = (fx: number, tx: number, y: number) => {
    from.push(`${fx.toFixed(2)}% ${y.toFixed(2)}%`);
    to.push(`${tx.toFixed(2)}% ${y.toFixed(2)}%`);
  };

  if (reverse) {
    // revealed = kiri edge: corner-top → edge(top→bottom) → corner-bottom
    push(leftFrom, leftTo, 0);
    for (const pt of edgePts) {
      push(baseFrom + pt.offset, baseTo + pt.offset, pt.y);
    }
    push(leftFrom, leftTo, 100);
  } else {
    // revealed = kanan edge: edge-top → corner kanan → edge-bottom → edge(naik)
    push(baseFrom, baseTo, 0);
    push(leftFrom, leftTo, 0);
    push(leftFrom, leftTo, 100);
    push(baseFrom, baseTo, 100);
    for (let i = edgePts.length - 2; i >= 1; i--) {
      const pt = edgePts[i];
      push(baseFrom + pt.offset, baseTo + pt.offset, pt.y);
    }
  }

  return {
    from: `polygon(${from.join(", ")})`,
    to: `polygon(${to.join(", ")})`,
  };
}

export async function animateThemeChange(
  updateTheme: () => Promise<void> | void,
  options: ThemeAnimationOptions = {},
) {
  if (typeof document === "undefined" || typeof window === "undefined") {
    await updateTheme();
    return;
  }

  const reverse = options.reverse ?? false;
  const prefersReducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;

  // Fallback: tanpa View Transitions API → cuma transisi warna CSS.
  if (
    prefersReducedMotion ||
    typeof document.startViewTransition !== "function"
  ) {
    applyThemeTransition(320);
    await updateTheme();
    return;
  }

  // updateTheme jalan synchronously di dalam callback VTA, browser nangkap
  // snapshot old (sebelum) & new (sesudah swap).
  const transition = document.startViewTransition(() => {
    updateTheme();
  });

  try {
    await transition.ready;
  } catch {
    // Transition di-skip (e.g. tab di-background). Tema udah terswap.
    return;
  }

  const duration = 680;
  const easing = "cubic-bezier(0.83, 0, 0.17, 1)";

  // Zigzag wipe: tema baru nyapu dengan leading edge bergerigi. Jumlah gigi
  // diacak tiap klik (2..12) biar gak monoton.
  const peaks = 2 + Math.floor(Math.random() * 11);
  const zigzag = zigzagClipPath(reverse, peaks);
  document.documentElement.animate(
    { clipPath: [zigzag.from, zigzag.to] },
    {
      duration,
      easing,
      pseudoElement: "::view-transition-new(root)",
    },
  );

  // Page press: snapshot halaman ke-scale membesar (zoom IN) biar kerasa
  // "mendekat/nge-punch" ke arah user pas klik. Di pseudo-element group
  // karena page asli di-hide selama VTA jalan.
  document.documentElement.animate(
    [
      { transform: "scale(1)" },
      { transform: "scale(1.035)", offset: 0.4 },
      { transform: "scale(0.996)", offset: 0.72 },
      { transform: "scale(1)" },
    ],
    {
      duration,
      easing,
      pseudoElement: "::view-transition-group(root)",
    },
  );

  await transition.finished;
}
