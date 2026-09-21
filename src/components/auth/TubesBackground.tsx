import { useEffect, useRef, useState } from 'react';
import type TubesCursorFn from 'threejs-components/build/cursors/tubes1.min.js';

type TubesApp = ReturnType<typeof TubesCursorFn>;

// Curated brand-palette combinations (violet/purple/cyan/magenta) — click
// cycles between these instead of fully random RGB, so the background can
// never drift off-brand no matter how many times it's clicked.
const PALETTES: { tubes: string[]; lights: string[] }[] = [
  { tubes: ['#8B32FF', '#64378B', '#00DFDF'], lights: ['#8B32FF', '#00DFDF', '#A559FF', '#64378B'] },
  { tubes: ['#A559FF', '#F0386B', '#00DFDF'], lights: ['#A559FF', '#F0386B', '#00DFDF', '#8B32FF'] },
  { tubes: ['#64378B', '#8B32FF', '#F0386B'], lights: ['#64378B', '#8B32FF', '#F0386B', '#00DFDF'] },
  { tubes: ['#00DFDF', '#8B32FF', '#A559FF'], lights: ['#00DFDF', '#8B32FF', '#A559FF', '#F0386B'] },
];

/**
 * Dark, cursor-reactive 3D tubes background (threejs-components' tubes1
 * cursor effect) for the public auth pages, recolored to the brand palette.
 * Lazy-loaded (code-split) so the ~750KB effect never blocks the page's
 * initial render, and skipped entirely under prefers-reduced-motion — the
 * plain bg-navy on the parent shell is the fallback in both cases (before
 * load, and permanently for reduced motion).
 */
export function TubesBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const appRef = useRef<TubesApp | null>(null);
  const paletteIndex = useRef(0);
  const [reducedMotion] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );

  useEffect(() => {
    if (reducedMotion || !canvasRef.current) return;
    let cancelled = false;

    void import('threejs-components/build/cursors/tubes1.min.js').then(({ default: TubesCursor }) => {
      if (cancelled || !canvasRef.current) return;
      const palette = PALETTES[0];
      appRef.current = TubesCursor(canvasRef.current, {
        tubes: { colors: palette.tubes, lights: { intensity: 200, colors: palette.lights } },
      });
    });

    return () => {
      cancelled = true;
      appRef.current?.dispose();
      appRef.current = null;
    };
  }, [reducedMotion]);

  function handleClick() {
    if (!appRef.current) return;
    paletteIndex.current = (paletteIndex.current + 1) % PALETTES.length;
    const palette = PALETTES[paletteIndex.current];
    appRef.current.tubes.setColors(palette.tubes);
    appRef.current.tubes.setLightsColors(palette.lights);
  }

  if (reducedMotion) return null;

  return (
    <canvas
      ref={canvasRef}
      onClick={handleClick}
      // The library's bloom pass composites an opaque black backdrop instead
      // of true canvas transparency — mix-blend-mode: screen is the standard
      // fix: black contributes nothing under "screen", so the navy page
      // background shows through wherever the scene is black, while bright
      // tube/glow pixels blend on top additively, unaffected.
      className="absolute inset-0 block h-full w-full cursor-pointer mix-blend-screen"
      style={{ touchAction: 'none' }}
      aria-hidden
    />
  );
}
