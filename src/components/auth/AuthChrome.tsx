import type { ReactNode } from 'react';
import logoIcon from '../../assets/logo/logo-icon.png';
import { TubesBackground } from './TubesBackground';

/**
 * Shared visual language for the public auth pages (Login, ForgotPassword,
 * ResetPassword) — adapted from a pasted cobalt-accent SaaS auth spec onto
 * this app's own brand tokens: violet (--color-violet) for fills/tiles/rail
 * (in place of the spec's "cobalt"), cyan (--color-cyan) for focus states,
 * matching how every other page already splits those two roles. The canvas
 * itself is a fixed dark navy (brand navy), not the theme-flipping page
 * background — it's the same always-navy treatment as the splash loader,
 * so any text placed directly on it (outside the white card) needs a
 * theme-independent light color, e.g. text-nav-muted, not text-muted.
 */

export const BRAND_GRADIENT = 'linear-gradient(150deg, #A559FF 0%, #8B32FF 46%, #64378B 100%)';
export const CARD_SHADOW = '0 1px 2px rgba(0,0,0,0.35), 0 24px 60px -20px rgba(139,50,255,0.35), 0 60px 110px -60px rgba(0,0,0,0.55)';
export const BUTTON_SHADOW = '0 12px 26px -10px rgba(139,50,255,0.55), inset 0 1px 0 rgba(255,255,255,0.18)';
export const LOGO_SHADOW = '0 10px 20px -6px rgba(139,50,255,0.55), inset 0 1px 0 rgba(255,255,255,0.2)';

/** Full-bleed centered-card page shell: dark navy canvas with an interactive 3D tubes background. */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-navy px-4 py-6">
      <TubesBackground />
      <div className="relative z-10 w-full max-w-[440px]">{children}</div>
    </div>
  );
}

/** White rounded-3xl card with a thin brand-gradient accent rail pinned to the top edge. */
export function AuthCard({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-3xl bg-card ring-1 ring-black/5" style={{ boxShadow: CARD_SHADOW }}>
      <div className="h-1 w-full" style={{ background: BRAND_GRADIENT }} />
      {children}
    </div>
  );
}

/** The brand mark itself (navy square, flask + bubbles), sized for the auth card header. */
export function AuthLogoTile({ size = 56 }: { size?: number }) {
  return (
    <img
      src={logoIcon}
      alt="Dreamlabs Sales"
      className="mx-auto block rounded-2xl"
      style={{ width: size, height: size, objectFit: 'cover', boxShadow: LOGO_SHADOW }}
    />
  );
}
