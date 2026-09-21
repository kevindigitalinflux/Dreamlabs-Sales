import { useEffect, useState } from 'react';

/**
 * Big violet bubbles (same skin as the flask's own bubbles) that grow to
 * fully cover the viewport, then shrink away again — used as a wipe
 * transition between the splash loader and the login screen. `mode="cover"`
 * grows them from nothing; `mode="reveal"` starts already covering and
 * shrinks them back to nothing, exposing whatever renders underneath.
 */

interface Spot {
  x: number;
  y: number;
  delay: number;
}

// Five overlapping anchor points spread across the viewport — at the grown
// scale (below) each bubble's diameter comfortably exceeds any real screen's
// diagonal, so together they guarantee full coverage regardless of aspect
// ratio, while the stagger reads as bubbles rather than one flat wipe.
const SPOTS: Spot[] = [
  { x: 50, y: 55, delay: 0 },
  { x: 20, y: 28, delay: 60 },
  { x: 80, y: 26, delay: 110 },
  { x: 18, y: 80, delay: 160 },
  { x: 82, y: 82, delay: 200 },
];

const MAX_DELAY = Math.max(...SPOTS.map((s) => s.delay));
export const BUBBLE_COVER_MS = 650;
export const BUBBLE_REVEAL_MS = 520;
export const BUBBLE_REVEAL_HOLD_MS = 140;
/** Total time from triggering `mode="cover"` to the screen being fully hidden. */
export const BUBBLE_COVER_TOTAL_MS = BUBBLE_COVER_MS + MAX_DELAY;

const GROWN_SCALE = 24; // each bubble starts at 10vmax, so this comfortably exceeds any viewport diagonal

export function BigBubbles({ mode }: { mode: 'cover' | 'reveal' }) {
  const [grown, setGrown] = useState(mode === 'reveal');

  useEffect(() => {
    if (mode === 'cover') {
      // Mount at scale(0) first so the browser commits that frame, then flip
      // to grown on the next paint so the scale-up actually transitions
      // instead of snapping straight to covered.
      const id = requestAnimationFrame(() => requestAnimationFrame(() => setGrown(true)));
      return () => cancelAnimationFrame(id);
    }
    const t = setTimeout(() => setGrown(false), BUBBLE_REVEAL_HOLD_MS);
    return () => clearTimeout(t);
  }, [mode]);

  const duration = mode === 'cover' ? BUBBLE_COVER_MS : BUBBLE_REVEAL_MS;

  return (
    <div className="pointer-events-none fixed inset-0 z-50 overflow-hidden" aria-hidden>
      {SPOTS.map((s, i) => (
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
            transform: `scale(${grown ? GROWN_SCALE : 0})`,
            transition: `transform ${duration}ms cubic-bezier(0.33,1,0.68,1) ${s.delay}ms`,
          }}
        />
      ))}
    </div>
  );
}
