# UI refresh ("Aurora"): design

Date: 2026-11-16. Author: Claude (architect), from a design conversation with Kevin.
Status: awaiting Kevin's approval. Nothing is built.
Approved mockup: `docs/superpowers/specs/assets/2026-11-16-ui-refresh-mockup.html` (open in a browser; it has a dark/light switch and a working menu collapse).

## 1. Intent

Kevin's words: the platform "seems a bit sloppy"; the content "looks overwhelming"; the buttons "don't look as professional or as sleek" as he wants. He wants it "cleaner, sleeker, more professional but still visually beautiful and striking", something that "when showcased for social media content, looks impressive and professional", while respecting the DI Dreamlabs brand guidelines.

Two separate problems sit behind that, and this work fixes both:

1. **The look has no shared rules.** On the published `main` there are three corner sizes, four box paddings, 85 buttons that bypass the shared button, no depth, and grey fields on a grey page that look switched off.
2. **Screens show everything at once.** Measured on the live app at a laptop size (1280 x 609):
   - the lead side panel is 2,956 px tall in a 448 px column (about five screens), with eight sections open and 49 buttons;
   - Settings is 5,911 px tall with 13 stacked sections;
   - the "Needs you" strip holds three rows plus a "+N more" link above every screen, so Pipeline shows two leads before scrolling;
   - the Pipeline toolbar has eight filters wrapping onto two rows, and table rows wrap onto two lines.

Who it is for: Kevin, Suj, Valentina and contractors using it daily, and viewers of Kevin's social content. The app's existing ADHD and dyslexia-friendly principle stays: less on screen, clear next step.

## 2. Goals, non-goals, anti-goals

**Goals**
- One visual system (the approved "Aurora" direction) applied to every signed-in screen, in dark and light.
- Each screen shows a short summary first and folds the rest away, so no routine screen needs more than about two screens of scrolling at 1280 x 720.
- One look per kind of control: one primary button, one secondary, one quiet, one danger; one field style; one folding section; one tab strip.
- Text contrast of at least 4.5:1 in both themes, including the two known failures (secondary grey text and cyan link text in light mode).
- Dark mode strong enough to film.

**Non-goals**
- No feature, data, permission, RLS, edge function or database change. No migration.
- No new npm dependency.
- The signed-out pages (splash, login, password reset, welcome, unsubscribe) keep their current design.
- No new copy for other organisations, no new screens.
- The sign-in redirect bug is separate work (`docs/SIGNIN-REDIRECT-BUILD-BRIEF.md` on branch `claude/signin-redirect-brief`).

**Anti-goals (these would make it a failure even if it "works")**
- A screen that is prettier but still shows everything at once.
- Glow, blur or animation that tires the eye or slows the app. The glow is a backdrop, never on text or behind long reading areas at full strength.
- Any colour outside the brand palette for new decoration, or magenta and cyan sitting in the same or adjacent elements.
- A restyle that silently changes what a button does, hides an action someone relies on, or breaks phone use.
- A long-lived branch that collides with the Deep find work in progress.

## 3. Constraints

- **Brand (DI Dreamlabs guidelines v1.0):** Violet Ray `#8B32FF`, Deep Navy `#040F49`, Rebecca Purple `#64378B`, Magenta Bloom `#F0386B`, Strong Cyan `#00DFDF`, Off White `#F4F4F8`. Montserrat for headings (SemiBold or heavier), DM Sans for body. Light background is Off White only, with navy text. White `#FFFFFF` remains the one agreed addition, for card surfaces in light mode. The existing stage colours (amber, green and so on) stay as they are: they carry meaning and are already contrast-tuned.
- **Stack:** Vite, React 19, TypeScript strict, Tailwind v4 with tokens in `src/index.css` (`@theme`), `lucide-react` icons. No testing-library is installed; tests are Vitest on import-free logic.
- **Project rules:** `AGENTS.md` and `CLAUDE.md` conventions (named exports, components under 150 lines, JSDoc on exports, loading/error/empty states, every dropdown through `Listbox`).
- **One earlier decision this replaces:** the 2026-09-09 theme design said accents are identical in both themes. Violet used as text now has a lighter value in dark and a darker value in light (5.1), because one value cannot pass contrast on both.
- **Existing decisions that stay:** light is the default theme and signed-out pages render with no theme attribute; token names in `index.css` keep their names so existing classes keep working; the menu stays dark in both themes; realtime hooks keep per-instance channel names.
- **Concurrency:** other branches are in flight (Deep find stage 2 people, verifier fixes and several unmerged feature branches). One writer per checkout. This work runs in its own worktree and each stage is a short branch.
- **Publishing:** nothing goes live until Kevin has seen it running and said yes.

## 4. Approaches considered

1. **New look everywhere first, then tidy screen by screen (chosen by Kevin).** Stage 1 changes the shared rules, shared building blocks and the app frame, so every screen looks new on one release with layouts unchanged. Stage 2 declutters one screen at a time, each its own small release. Trade-off: between stages some screens look new but are still crowded. It suits the in-flight work, because stage 1 mostly touches shared files the feature branches do not, and each stage 2 screen can wait for any branch touching it.
2. **One screen at a time, fully finished.** The app is half old and half new for weeks, which is bad for filming and confusing to use.
3. **Everything in one go.** One very large change that collides with the work in progress and cannot be reviewed safely. Ruled out.

## 5. The visual system (decided with Kevin from the mockup)

Kevin picked direction B ("Aurora") with two changes: the menu and the lead record sit flush against the screen edges as in direction A (nothing floats loose), and the menu can be collapsed to icons (open by default). He also asked that the real logo is used.

### 5.1 Colour and surfaces

| Role | Dark | Light |
|---|---|---|
| Page base | Deep Navy `#040F49` | Off White `#F4F4F8` |
| Backdrop glow (fixed layer behind the page) | radial Violet at about 42% top right, Rebecca Purple at about 55% bottom left, both fading to nothing | the same two glows at about 16% and 14% |
| Raised surface (cards, table, stat tiles) | Off White at 6% over the base | White `#FFFFFF` |
| Nested block inside a surface | Off White at 10% | Navy at 5% |
| Lines | Off White at 12% | Navy at 12% |
| Main text | Off White | Deep Navy |
| Secondary text | Off White at about 66% | Navy at about 70% |
| Menu | a darker navy, same in both themes | same |
| Text-coloured violet (links, active tab, selected pill) | a lighter violet (mockup `#C9A6FF`) | a darker violet (mockup `#6A1FD6`) |
| Overdue and "needs attention" | magenta, lightened for dark (mockup `#FF7A9D`) on a 16% magenta tint | magenta, darkened (mockup `#C21850`) on a 10% tint |

Rules:
- **Cyan stops being a text and link colour.** It stays in the "Sales" half of the wordmark, the keyboard focus ring and data highlights on dark charts. Links, the "Manage" style links, active states and the phone menu's active item use the text-coloured violet. This removes the known light-mode cyan contrast failure and keeps cyan away from magenta.
- **Red stays for destructive actions and errors.** Overdue dates and attention states move to magenta.
- Every text colour above must measure at least 4.5:1 on both the page base and the raised surface in its theme. The hex values from the mockup are starting points; the builder measures and adjusts lightness only, and records the final values and ratios.
- Shades of navy and violet used for elevation and text are derived from the six brand colours. No neutral grey, no pure black.

### 5.2 Depth

- Raised surfaces get a 1 px line and one soft, navy-tinted shadow (mockup: `0 18px 40px -18px rgba(2,6,40,.55)`). In light mode the same shadow at lower strength.
- Blur (`backdrop-filter`) is used only on things that sit over other content: the lead record, popovers, dialogs. Never on table rows or cards, for performance.
- The lead record panel is flush right, full height, with a shadow on its left edge.

### 5.3 Shape and spacing

- Corners: 14 px for controls (buttons, fields), 16 px for surfaces, 12 px for nested blocks, fully round for pills and counters. Nothing else.
- Spacing steps: 4, 8, 12, 16, 24, 32. Surface padding is 16 or 24. Page padding is 24 to 28 on desktop, 16 on phones.
- Control height: 40 px from the `md` breakpoint up, 44 px below it (touch).

### 5.4 Type

- Page title: Montserrat 700, 28 px. Section title: Montserrat 600, 17 to 18 px. Record title: Montserrat 700, 22 px.
- Body and controls: DM Sans 400 or 500, 15 to 16 px. Reading text never below 14 px.
- 12 to 13 px is allowed only for counters, pills and short meta lines (dates, "7 of 141 leads").
- No all-caps section labels in new work; sentence case throughout. Numbers in tables use tabular figures.

### 5.5 Controls

- **Primary button:** violet to Rebecca Purple gradient with a soft violet glow, Off White text, weight 600. One per view where possible.
- **Secondary:** transparent with a 1 px line. **Quiet:** no border, secondary text colour. **Danger:** unchanged meaning, restyled to the new shape.
- **Fields and dropdowns:** raised-surface fill with a 1 px line, never grey-on-grey. Focus shows the cyan ring.
- **Pills:** fully round, tinted background, a small dot for stage. Removable filter tags carry a small "x".
- **Folding section (new shared piece):** a header row with title, a one-line summary of what is inside ("Phone, email", "None yet", "2") and a chevron; opens in place; keyboard operable; remembers nothing by default.
- **Tabs (new shared piece):** text tabs with a violet underline on the active one.
- **Motion:** only in answer to an action (opening, collapsing, hover), 150 to 200 ms, removed under `prefers-reduced-motion`. No entrance animations.

## 6. Stage 1: the new look everywhere

One branch (`codex/ui-refresh-stage1`), layouts of individual screens unchanged.

**6.1 Tokens (`src/index.css`).** Update the existing token values to section 5 and add the few new ones needed (text-coloured violet, attention colour and tint, nested surface, shadow, radii). Existing token names keep working. Add the fixed backdrop glow layer for signed-in screens only.

**6.2 Shared building blocks (`src/components/ui/`).**
- Restyle in place, keeping every prop and behaviour: `Button`, `Input` (and `SelectField`), `Listbox`, `MultiSelect`, `Card`, `Badge`, `Modal`, `EmptyState`, `Skeleton`, `BulkActionBar`, `ConfirmDeleteButton`, `StepProgress`.
- `Button` gains a `size` (`md` default, `sm`) and an icon-only form with a required accessible name. `Card` gains a flat/raised option, raised by default.
- New: `Collapsible` (the folding section), `Tabs`, and a small `Popover` (anchored panel that closes on Escape and outside click and returns focus; the `Listbox` portal is the model). `Popover` is used by the "Needs you" pill and the avatar menu in stage 1; `Collapsible` and `Tabs` are built now so stage 2 can use them.

**6.3 The frame (`src/components/layout/`, `src/components/jobs/JobsBar.tsx`).**
- **Menu:** the real logo (`src/assets/logo/logo-icon.png`) with the "DreamlabsSales" wordmark; when collapsed, the icon mark alone. A "Collapse menu" control at the bottom. Open by default; the choice is remembered on that device. Collapsed items show their name on hover and to screen readers; count badges stay visible.
- **"Needs you" becomes one pill in the top bar**, replacing the multi-row strip. Its text is the existing one-line summary already used on phones. Clicking it opens a list of every line (needs you, running, finished) with the same Open, View and Dismiss actions as today. The screen-reader announcement of new lines stays exactly as it is.
- **Top bar:** Focus, the pill, the usage chip, the organisation switcher and the avatar. Theme switch and Sign out move into a menu on the avatar.
- **Reply banner:** same behaviour, restyled to one slim line.
- **Phone menu:** same four items, new look, active item in violet.
- **Phones:** the pill takes the place of today's one-line summary; the top bar may still wrap onto two rows as it does now.
- **Focus mode:** unchanged. It still hides the menu, the pill and the reply banner.

**6.4 What stage 1 deliberately leaves.** Raw `<button>` elements and one-off styles inside individual screens are not swept in stage 1 (that is where the in-flight branches live). They move to the shared pieces when their screen is done in stage 2. Stage 1 fixes a one-off style only where the new tokens make it look broken.

## 7. Stage 2: declutter, one screen group at a time

Each group is its own short branch and release. Before each build, Claude writes a short design for that group with a mockup, and Kevin approves it, because layout choices are his. The intended shape, from what was agreed on the Pipeline mockup:

1. **Pipeline and the lead record.** A row of headline numbers; search plus one Filters button with active filters as removable tags; every lead on one line. The lead record opens as a summary: name, stage, value, three main actions (Call, Email, Deep find), the next action on top, then three tabs (Overview, Contacts, Notes and emails) with folding sections. Fields read as plain text and become editable when clicked, saving through the existing lead-update path. Board cards lose their boxes-inside-boxes.
2. **Settings.** The 13 sections grouped into a few named areas with folding sections, so the page opens short.
3. **Jobs.**
4. **Emails** (templates, sequences, release queue, logs).
5. **Dream Agent.**
6. **Scraper, Autopilot, LinkedIn, Power Dialer.**
7. **Dashboard, Analytics, Admin.**

Order may change to avoid a screen that an unmerged branch is editing.

## 8. How it is checked

- Project gates on every branch, with the usual local gate environment (`VITE_SUPABASE_URL=http://127.0.0.1:54321`, `VITE_SUPABASE_ANON_KEY=local-test-placeholder`): `npx tsc --noEmit`, `npx vitest run`, `npm run build`, `git diff --check`, `node scripts/places-edge-typecheck.mjs`.
- New import-free logic gets Vitest tests written first: the menu-collapse memory, the pill's text and list, the folding section's state.
- Browser checks by the reviewer before Kevin sees it: every main screen in dark and light at 1280 px and at 400 px; keyboard only (visible focus, Escape closes popovers, focus returns); reduced motion; no sideways scroll; measured contrast for each text colour.
- Before-and-after screenshots of each main screen, attached to the build report.
- Behaviour check: the same actions are reachable on every screen as before; nothing that calls the database or a function changed.
- Independent review by Claude of each branch against this document, then Kevin's look at it running, then his separate go-ahead to publish.

## 9. Roles and publishing

Claude writes designs and plans and reviews; Codex builds each stage on its own `codex/ui-refresh-*` branch in its own worktree. No role change. Local work only until Kevin approves publication, each time. No paid usage beyond what is already authorised.

## 10. Who decided what

**Kevin decided:** the Aurora look; menu and lead record flush to the edges; a collapsible menu, open by default; use the real logo; approach 1 (look first, then screen by screen).

**Claude's calls (Kevin did not object when they were listed, or they were made while writing this; correct any of them):**
- Codex builds, Claude reviews; nothing live without Kevin's yes.
- Both themes kept, designed dark-first; phone layout keeps working; look and layout only, no behaviour change.
- Cyan stops being a link colour; overdue moves from red to magenta.
- Control height 40 px on desktop, 44 px on phones.
- The menu's open or collapsed state is remembered per device, not per account (per account would need a database change).
- Theme switch and Sign out move into an avatar menu.
- The "Needs you" pill opens a list holding every line, instead of three rows on every screen.
- The reply banner keeps its behaviour and becomes one slim line.
- Stage 1 does not sweep one-off buttons inside screens.
- Each stage 2 group gets its own short design and mockup for Kevin's approval.
- Signed-out pages are out of scope.

## 11. Left to the builder

File-level structure of the new pieces, exact Tailwind classes, the final measured hex values for the text colours within the rules in 5.1, how the backdrop layer is mounted, the popover's positioning (the `Listbox` portal pattern is the model), and test layout.
