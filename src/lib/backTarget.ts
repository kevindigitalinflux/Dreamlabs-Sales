const RULES: { pattern: RegExp; fallback: string; label: string }[] = [
  { pattern: /^\/pipeline\/leads\/[^/]+$/, fallback: '/pipeline', label: 'Back to pipeline' },
  { pattern: /^\/pipeline\/manage$/, fallback: '/pipeline', label: 'Back to pipeline' },
  { pattern: /^\/pipeline\/deep-find\/[^/]+$/, fallback: '/jobs', label: 'Back to jobs' },
  { pattern: /^\/jobs\/lookup\/[^/]+$/, fallback: '/jobs', label: 'Back to jobs' },
  { pattern: /^\/scraper\/jobs\/[^/]+$/, fallback: '/scraper', label: 'Back to scraper' },
  { pattern: /^\/outreach\/autopilot\/new$/, fallback: '/outreach/autopilot', label: 'Back to autopilot' },
  { pattern: /^\/settings\/(email|dialer|organization)$/, fallback: '/settings', label: 'Back to settings' },
];

/**
 * Pages you reach from another page get a back arrow. Returns where to go when there is no earlier page in the
 * browser history (for example after opening the address directly), and the label, or null for top-level pages.
 */
export function backTarget(pathname: string): { fallback: string; label: string } | null {
  const rule = RULES.find((r) => r.pattern.test(pathname));
  return rule ? { fallback: rule.fallback, label: rule.label } : null;
}
