import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import dlMarkAlpha from '../../assets/branding/dl-mark-alpha.png';

/**
 * Branded splash/loading screen, translated from the Claude Design project
 * "Dreamlabs Splash Loader" (bubbles rising from the flask of the mark,
 * liquid stirring inside the bowl). The source used a design-tool
 * composition engine (authored clock T, scene cues, easing helpers) that
 * doesn't exist at runtime here — this file reimplements the same
 * choreography with a plain requestAnimationFrame clock so it can run as a
 * normal React component.
 */

type Ease = (t: number) => number;

const Easing = {
  easeOutCubic: ((t: number) => (--t) * t * t + 1) as Ease,
  easeInOutSine: ((t: number) => -(Math.cos(Math.PI * t) - 1) / 2) as Ease,
  easeOutBack: ((t: number) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  }) as Ease,
};

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

function animate({ from, to, start, end, ease }: { from: number; to: number; start: number; end: number; ease: Ease }) {
  return (t: number) => {
    if (t <= start) return from;
    if (t >= end) return to;
    return from + (to - from) * ease((t - start) / (end - start));
  };
}

const MOTION = {
  rise: (o: { from: number; to: number; start: number; end: number }) => animate({ ...o, ease: Easing.easeInOutSine }),
  enter: (o: { from: number; to: number; start: number; end: number }) => animate({ ...o, ease: Easing.easeOutCubic }),
  pop: (o: { from: number; to: number; start: number; end: number }) => animate({ ...o, ease: Easing.easeOutBack }),
};

const RISE01 = MOTION.rise({ from: 0, to: 1, start: 0, end: 1 });
const FADEIN = MOTION.enter({ from: 0, to: 1, start: 0, end: 0.07 });
const BURST = MOTION.pop({ from: 1, to: 1.52, start: 0.84, end: 0.92 });
const BURSTF = MOTION.enter({ from: 1, to: 0, start: 0.88, end: 0.94 });
const DRIFTF = MOTION.enter({ from: 1, to: 0, start: 0.74, end: 1 });
const DROPS = MOTION.enter({ from: 0, to: 1, start: 0.89, end: 1 });

const LOOP = 8; // Rise(3) + Swell(3) + Settle(2), seconds
const CUES = { Swell: 3, Settle: 6 };

const W = 420; // mark group footprint
const GX = 750;
const GY = 281; // group origin inside the 1920x1080 stage
const SRC = { x: 213, y: 220 }; // neck mouth, group-local
const TOP = -80; // where bubbles leave frame, group-local
const CROP = 0.502; // hide the mark's printed bubble trail

// Flask interior, measured off the mark (fractions of the mark footprint).
const FL = { x: 0.40769 * W, y: 0.62769 * W, w: 0.20769 * W, h: 0.20692 * W };
const LEVEL = 0.424 * FL.h;

interface FreeBubble {
  at: number;
  dur: number;
  r: number;
  pop: boolean;
  lane: number;
  amp: number;
  waves: number;
  ph: number;
}

// at = share of the loop the bubble is born at; dur = its life in seconds.
const FREE: FreeBubble[] = [
  { at: 0.02, dur: 3.6, r: 18, pop: true, lane: -9, amp: 18, waves: 2.2, ph: 0.4 },
  { at: 0.34, dur: 3.9, r: 34, pop: false, lane: 6, amp: 20, waves: 1.6, ph: 0.9 },
  { at: 0.24, dur: 3.0, r: 7, pop: false, lane: -16, amp: 14, waves: 2.6, ph: 3.1 },
  { at: 0.55, dur: 4.0, r: 14, pop: false, lane: 16, amp: 22, waves: 1.7, ph: 4.2 },
  { at: 0.82, dur: 3.3, r: 12, pop: true, lane: 10, amp: 16, waves: 2.1, ph: 1.4 },
  { at: 0.13, dur: 4.2, r: 10, pop: false, lane: 12, amp: 24, waves: 1.8, ph: 1.9 },
  { at: 0.44, dur: 3.2, r: 9, pop: true, lane: -12, amp: 13, waves: 2.4, ph: 2.4 },
  { at: 0.70, dur: 3.6, r: 8, pop: false, lane: -5, amp: 12, waves: 2.8, ph: 5.0 },
];

const SKIN = { background: '#8B32FF', boxShadow: '-3px 4px 0 rgba(100,55,139,0.85)' };

function Bub({ x, y, size, opacity }: { x: number; y: number; size: number; opacity: number }) {
  return (
    <div
      style={{
        position: 'absolute',
        left: x - size / 2,
        top: y - size / 2,
        width: size,
        height: size,
        opacity,
        borderRadius: '50%',
        ...SKIN,
      }}
    />
  );
}

/** Authored-seconds clock, looping every `loopSeconds`. */
function useLoopClock(loopSeconds: number) {
  const [t, setT] = useState(0);
  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      setT(((now - start) / 1000) % loopSeconds);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [loopSeconds]);
  return t;
}

/** Scales a fixed 1920x1080 stage to fit the viewport, letterboxed in the same navy. */
function useStageScale(width: number, height: number) {
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const measure = () => setScale(Math.min(window.innerWidth / width, window.innerHeight / height));
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [width, height]);
  return scale;
}

function LoaderScene() {
  const T = useLoopClock(LOOP);
  const bubbles: ReactElement[] = [];

  FREE.forEach((b, i) => {
    const t0 = b.at * LOOP;
    const phase = (((T - t0) % LOOP) + LOOP) % LOOP;
    const q = phase / b.dur;
    if (q > 1) return;
    const e = RISE01(q);
    const x = SRC.x + b.lane * e + b.amp * (Math.sin(q * Math.PI * b.waves + b.ph) - Math.sin(b.ph));
    const y = SRC.y - (SRC.y - TOP) * e;
    // A bubble only reaches full size once it has cleared the neck, so it
    // never covers the letterform — it inflates on the way out.
    const rad = Math.max(3, Math.min(b.r, 4 + 0.7 * (SRC.y - y)));
    bubbles.push(
      <Bub key={`f${i}`} x={x} y={y} size={rad * 2 * (b.pop ? BURST(q) : 1)} opacity={FADEIN(q) * (b.pop ? BURSTF(q) : DRIFTF(q))} />,
    );

    if (b.pop && b.r >= 12 && q > 0.88) {
      const d = DROPS(q);
      for (let k = 0; k < 3; k++) {
        const ang = -Math.PI / 2 + (k - 1) * 0.85;
        bubbles.push(
          <div
            key={`d${i}_${k}`}
            style={{
              position: 'absolute',
              left: x + Math.cos(ang) * b.r * 2.6 * d - 3,
              top: y + Math.sin(ang) * b.r * 2.2 * d - 3,
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: '#8B32FF',
              opacity: (1 - d) * 0.9,
            }}
          />,
        );
      }
    }
  });

  // Liquid: stirs and tilts, never rises. Agitation lifts through "Swell".
  const agUp = MOTION.enter({ from: 0, to: 1, start: CUES.Swell - 0.5, end: CUES.Swell + 1.0 })(T);
  const agDn = MOTION.enter({ from: 0, to: 1, start: CUES.Settle - 0.9, end: CUES.Settle + 0.5 })(T);
  const ag = 1 + 0.75 * (agUp - agDn);
  const w = (2 * Math.PI) / LOOP;
  const lvl = LEVEL + ag * (2.6 * Math.sin(T * w * 2) + 1.3 * Math.sin(T * w * 3 + 1.1));
  const rotA = (T / LOOP) * 720;
  const rotB = (T / LOOP) * -360;
  const S1 = FL.w * 2.6;
  const S2 = FL.w * 2.4;

  const barFill = 392 * RISE01(clamp(T / (LOOP - 0.8), 0, 1));
  const barOpacity = MOTION.enter({ from: 1, to: 0, start: LOOP - 0.45, end: LOOP - 0.05 })(T);

  return (
    <div style={{ position: 'absolute', inset: 0, background: '#040F49', overflow: 'hidden' }}>
      <div
        style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          width: 1500,
          height: 1100,
          transform: 'translate(-50%,-50%)',
          background:
            'radial-gradient(ellipse at 50% 46%, rgba(139,50,255,0.10) 0%, rgba(139,50,255,0.03) 42%, rgba(139,50,255,0) 70%)',
          pointerEvents: 'none',
        }}
      />

      <div style={{ position: 'absolute', left: GX, top: GY, width: W, height: W }}>
        <div style={{ position: 'absolute', left: FL.x, top: FL.y, width: FL.w, height: FL.h, background: '#040F49', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', left: 0, right: 0, top: lvl, bottom: 0, background: '#8B32FF' }} />
          <div
            style={{
              position: 'absolute',
              left: FL.w / 2 - S1 / 2,
              top: lvl + S1 * 0.452 - S1 / 2,
              width: S1,
              height: S1,
              borderRadius: '43%',
              background: '#8B32FF',
              transform: `rotate(${rotA}deg)`,
            }}
          />
          <div
            style={{
              position: 'absolute',
              left: FL.w / 2 - S2 / 2,
              top: lvl + S2 * 0.458 - S2 / 2,
              width: S2,
              height: S2,
              borderRadius: '47% 44% 46% 45%',
              background: '#8B32FF',
              transform: `rotate(${rotB}deg)`,
            }}
          />
          {[0, 1, 2].map((k) => {
            const fp = ((T / LOOP) * (2 + k) + k * 0.37) % 1;
            const sz = 3 + k;
            return (
              <div
                key={`fz${k}`}
                style={{
                  position: 'absolute',
                  left: FL.w * (0.3 + 0.2 * k) + 3 * Math.sin(T * w * 4 + k),
                  top: FL.h - (FL.h - lvl - 6) * fp - sz,
                  width: sz,
                  height: sz,
                  borderRadius: '50%',
                  background: '#C49BFF',
                  opacity: 0.55 * (1 - fp),
                }}
              />
            );
          })}
        </div>

        <div style={{ position: 'absolute', left: 0, top: CROP * W, width: W, height: (1 - CROP) * W, overflow: 'hidden' }}>
          <img src={dlMarkAlpha} alt="" style={{ display: 'block', width: W, height: W, marginTop: -CROP * W }} />
        </div>

        {[0, 1, 2].map((k) => {
          const sz = 5 + k * 2;
          const o = 0.22 + 0.3 * (0.5 + 0.5 * Math.sin(T * w * 4 + k * 2.1));
          return (
            <div
              key={`foam${k}`}
              style={{
                position: 'absolute',
                left: SRC.x - 11 + k * 6,
                top: SRC.y + 9 - k * 3,
                width: sz,
                height: sz,
                borderRadius: '50%',
                background: '#8B32FF',
                opacity: o,
              }}
            />
          );
        })}

        {bubbles}
      </div>

      {/* Wordmark, sitting in the gap between the flask and the progress bar. */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: GY + W,
          height: 793 - (GY + W),
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <h1 className="m-0 text-[32px] font-extrabold text-nav-text">
          Dreamlabs<span className="text-cyan">Sales</span>
        </h1>
      </div>

      <div
        style={{
          position: 'absolute',
          left: 764,
          top: 793,
          width: 392,
          height: 6,
          borderRadius: 999,
          background: 'rgba(244,244,248,0.12)',
          overflow: 'hidden',
          opacity: barOpacity,
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            height: '100%',
            width: barFill,
            borderRadius: 999,
            background: 'linear-gradient(90deg,#64378B 0%,#8B32FF 72%,#A559FF 100%)',
          }}
        />
      </div>
    </div>
  );
}

/** Full-viewport branded loading screen — drop in wherever the app is waiting on auth/session state. */
export function SplashLoader() {
  const scale = useStageScale(1920, 1080);
  return (
    <div className="fixed inset-0 flex items-center justify-center overflow-hidden" style={{ background: '#040F49' }}>
      <div style={{ position: 'relative', width: 1920, height: 1080, transform: `scale(${scale})`, transformOrigin: 'center' }}>
        <LoaderScene />
      </div>
    </div>
  );
}
