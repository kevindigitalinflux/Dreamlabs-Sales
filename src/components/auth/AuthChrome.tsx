import type { ReactNode } from 'react';
import dlMarkAlpha from '../../assets/branding/dl-mark-alpha.png';

/**
 * Shared visual language for the public auth pages (Login, ForgotPassword,
 * ResetPassword) — adapted from a pasted cobalt-accent SaaS auth spec onto
 * this app's own brand tokens: violet (--color-violet) for fills/tiles/rail
 * (in place of the spec's "cobalt"), cyan (--color-cyan) for focus states,
 * matching how every other page already splits those two roles.
 */

export const BRAND_GRADIENT = 'linear-gradient(150deg, #A559FF 0%, #8B32FF 46%, #64378B 100%)';
export const CARD_SHADOW = '0 1px 2px rgba(4,15,73,0.05), 0 18px 40px -16px rgba(139,50,255,0.20), 0 48px 90px -48px rgba(4,15,73,0.18)';
export const BUTTON_SHADOW = '0 12px 26px -10px rgba(139,50,255,0.55), inset 0 1px 0 rgba(255,255,255,0.18)';
export const LOGO_SHADOW = '0 10px 20px -6px rgba(139,50,255,0.55), inset 0 1px 0 rgba(255,255,255,0.2)';

/** Full-bleed centered-card page shell: soft canvas, faint violet glows, a center-masked grid. */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-bg px-4 py-12">
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: [
            'radial-gradient(480px 360px at 16% 14%, rgba(139,50,255,0.10), transparent 70%)',
            'radial-gradient(520px 400px at 86% 10%, rgba(165,89,255,0.08), transparent 70%)',
            'radial-gradient(560px 440px at 50% 105%, rgba(100,55,139,0.07), transparent 70%)',
          ].join(', '),
        }}
      />
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            'linear-gradient(rgba(139,50,255,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(139,50,255,0.06) 1px, transparent 1px)',
          backgroundSize: '46px 46px',
          maskImage: 'radial-gradient(ellipse 60% 55% at 50% 42%, black 0%, transparent 75%)',
          WebkitMaskImage: 'radial-gradient(ellipse 60% 55% at 50% 42%, black 0%, transparent 75%)',
        }}
      />
      <div className="relative w-full max-w-[440px]">{children}</div>
    </div>
  );
}

/** White rounded-3xl card with a thin brand-gradient accent rail pinned to the top edge. */
export function AuthCard({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-3xl bg-card ring-1 ring-navy/10" style={{ boxShadow: CARD_SHADOW }}>
      <div className="h-1 w-full" style={{ background: BRAND_GRADIENT }} />
      {children}
    </div>
  );
}

/** Brand-gradient rounded logo tile carrying the flask mark, sized for the auth card header. */
export function AuthLogoTile({ size = 56 }: { size?: number }) {
  return (
    <div
      className="mx-auto flex items-center justify-center rounded-2xl"
      style={{ width: size, height: size, background: BRAND_GRADIENT, boxShadow: LOGO_SHADOW }}
    >
      <img src={dlMarkAlpha} alt="" style={{ width: size * 0.72, height: size * 0.72, objectFit: 'contain' }} />
    </div>
  );
}
