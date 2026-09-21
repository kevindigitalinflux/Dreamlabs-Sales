import { useEffect, useState } from 'react';

/**
 * Big violet bubbles (same skin as the flask's own bubbles) that float
 * upward while growing until they cover the viewport, then continue
 * floating up while shrinking away again — used as a wipe transition
 * between the splash loader and the login screen. `mode="cover"` rises
 * them in from the bottom; `mode="reveal"` starts already covering and
 * keeps floating them up and out, fading them away to expose whatever
 * renders underneath.
 */

interface Spot {
  x: number;
  y: number;
  delay: number;
}

// Anchored low in the viewport so the rise reads clearly, spread across the
// width so together they guarantee full coverage at the grown scale below
// regardless of aspect ratio, while the stagger reads as bubbles rather than
// one flat wipe.
const SPOTS: Spot[] = [
  { x: 50, y: 92, delay: 0 },
  { x: 24, y: 88, delay: 110 },
  { x: 76, y: 90, delay: 190 },
  { x: 10, y: 95, delay: 290 },
  { x: 90, y: 94, delay: 380 },
];

const MAX_DELAY = Math.max(...SPOTS.map((s) => s.delay));
export const BUBBLE_COVER_MS = 1500;
export const BUBBLE_REVEAL_MS = 600;
export const BUBBLE_REVEAL_HOLD_MS = 90;
// Reveal reuses the same cascade as cover but compressed — the full stagger
// (up to 380ms) would eat most of a deliberately short reveal.
const REVEAL_DELAY_SCALE = 0.35;
/** Total time from triggering `mode="cover"` to the screen being fully hidden. */
export const BUBBLE_COVER_TOTAL_MS = BUBBLE_COVER_MS + MAX_DELAY;

const GROWN_SCALE = 26; // each bubble starts at 10vmax, so this comfortably exceeds any viewport diagonal
const RISE_VH = 55; // how far up the bubbles drift while covering the screen
const DRIFT_VH = 80; // how much further they drift up while fading away on reveal

// Smooth accelerate-into-decelerate, no overshoot or snap — a gentle float,
// not a bounce.
const EASE = 'cubic-bezier(0.33, 0, 0.15, 1)';

export function BigBubbles({ mode }: { mode: 'cover' | 'reveal' }) {
  // `covering` is the shared "currently fully grown and risen" state: cover
  // mode animates INTO it, reveal mode starts there and animates OUT of it.
  const [covering, setCovering] = useState(mode === 'reveal');

  useEffect(() => {
    if (mode === 'cover') {
      // Mount at the start state first so the browser commits that frame,
      // then flip on the next paint so the rise actually transitions
      // instead of snapping straight to covered.
      const id = requestAnimationFrame(() => requestAnimationFrame(() => setCovering(true)));
      return () => cancelAnimationFrame(id);
    }
    const t = setTimeout(() => setCovering(false), BUBBLE_REVEAL_HOLD_MS);
    return () => clearTimeout(t);
  }, [mode]);

  const duration = mode === 'cover' ? BUBBLE_COVER_MS : BUBBLE_REVEAL_MS;
  const rise = covering ? RISE_VH : mode === 'cover' ? 0 : DRIFT_VH;
  const scale = covering ? GROWN_SCALE : 0;

  return (
    <div className="pointer-events-none fixed inset-0 z-50 overflow-hidden" aria-hidden>
      {SPOTS.map((s, i) => {
        const delay = mode === 'cover' ? s.delay : Math.round(s.delay * REVEAL_DELAY_SCALE);
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: `${s.x}%`,
              top: `${s.y}%`,
              width: '10vmax',
              height: '10vmax',
              marginLeft: '-5vmax',
              marginTop: '-5vmax',
              borderRadius: '50%',
              background: '#8B32FF',
              boxShadow: '-8px 10px 0 rgba(100,55,139,0.55)',
              transform: `translateY(-${rise}vh) scale(${scale})`,
              transition: `transform ${duration}ms ${EASE} ${delay}ms`,
            }}
          />
        );
      })}
    </div>
  );
}
