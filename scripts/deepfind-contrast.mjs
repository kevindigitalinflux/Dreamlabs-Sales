// Contrast check for the Deep find screens, using the colour tokens from src/index.css (both themes).
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const over = (fg, a, bg) => fg.map((c, i) => c * a + bg[i] * (1 - a));
const lum = (c) => { const [r, g, b] = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const T = {
  light: { offwhite: hex('#040F49'), card: hex('#FFFFFF'), bg: hex('#F4F4F8'), surface: [hex('#040F49'), 0.04], danger: hex('#EC0B0B'), success: hex('#1D8660') },
  dark: { offwhite: hex('#F4F4F8'), card: hex('#111C6A'), bg: hex('#09102E'), surface: [hex('#1A2575'), 1], danger: hex('#F87171'), success: hex('#34D399') },
};
const tints = { violet: hex('#8B32FF'), cyan: hex('#00DFDF'), amber: hex('#F59E0B'), green: hex('#22C55E'), red: hex('#EF4444') };
let fail = 0;
for (const [theme, t] of Object.entries(T)) {
  const surface = over(t.surface[0], t.surface[1], t.card);
  const grounds = { card: t.card, bg: t.bg, 'surface/50 on card': over(t.surface[0], t.surface[1] * 0.5, t.card), surface };
  for (const [n, c] of Object.entries(tints)) grounds[`${n}/10 on card`] = over(c, 0.1, t.card);
  grounds['violet/10 on card (selected card)'] = over(tints.violet, 0.1, t.card);
  grounds['cyan/10 on bg'] = over(tints.cyan, 0.1, t.bg);
  const checks = [];
  for (const [g, gc] of Object.entries(grounds)) {
    checks.push([`offwhite on ${g}`, t.offwhite, gc]);
    checks.push([`offwhite/80 on ${g}`, over(t.offwhite, 0.8, gc), gc]);
  }
  checks.push(['danger on card', t.danger, t.card], ['success on card', t.success, t.card]);
  checks.push(['on-accent on violet', hex('#F4F4F8'), tints.violet]);
  checks.push(['offwhite/50 radio border on card (non-text 3:1)', over(t.offwhite, 0.5, t.card), t.card]);
  for (const [name, fg, bg] of checks) {
    const r = ratio(fg, bg);
    const need = name.includes('non-text') ? 3 : 4.5;
    const ok = r >= need; if (!ok) fail++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${theme.padEnd(5)} ${r.toFixed(2)}  ${name}`);
  }
}
process.exit(fail ? 1 : 0);
