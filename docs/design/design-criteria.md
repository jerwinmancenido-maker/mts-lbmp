# MTS LBMP — Design Criteria Checklist

Drafted 2026-11-11 by Muse, at Jerwin's request.
**Approved by Jerwin Mancenido on 2026-11-11.** This is the standing design
checklist for MTS LBMP user-interface work.
Source: Jerwin's 20 design terms + 20 motion rules (sent 2026-11-11 for the
HACIEN staff app; verbatim copy at `~/workspace/hacien/design-terms-motion-20.md`).
This document adapts the **criteria only** to MTS. No HACIEN branding, colours,
or logo rules are imported — MTS keeps its own identity (current app: Inter,
blue `#2563eb` accents already in its own CSS, light surfaces).

Status key, from code checks on 2026-11-11 against `apps/web`:
**Met** = verified in code · **Gap** = verified missing · **Check** = not yet audited.

MTS context that shapes every rule below (Blueprint v2.0/v2.1, ASM-001):
app-first PWA, large-button tablet workflows, warehouse staff moving fast,
NB80 + phone + desktop widths, English/Tagalog switchable, dark mode
configurable, 80mm ESC/POS print is a primary output.

---

## Part A — The 20 design terms as MTS criteria

| # | Term | MTS rule (checkable) | Applies to | Status |
|---|------|----------------------|------------|--------|
| 1 | Kerning | Default font kerning on; no manual letter tweaks in UI text. Headings use the font's built-in kerning at all sizes. | All screens, print previews | Check |
| 2 | Optical centre | Modal/dialogue content and empty-state icons sit optically centred (slightly above geometric centre), not mathematically centred. | Dialogs, empty states, POD confirm screens | Check |
| 3 | Tabular numbers | Prices, quantities, weights, totals and counts render with `font-variant-numeric: tabular-nums` so columns never wobble. | Cargo rows, payment/expense lists, dashboard figures, receiving summary | **Gap** — no tabular-nums anywhere in `styles.css` today; one-line CSS fix per numeric class |
| 4 | Layout shift | Space is reserved for badges, counts and images before they load; lists never jump while staff are tapping. Async loads show a same-size placeholder. | All lists, sticky receiving summary, dashboard tiles | Check |
| 5 | Tracking | All-caps labels (statuses, eyebrows) get slight positive letter-spacing; body text keeps default tracking. | Status badges, section eyebrows, tile labels | Check |
| 6 | Optimistic update | Safe, reversible actions (mark arrived, collect payment entry) reflect instantly and reconcile with the server; anything money-final shows its true state, never a fake success. Offline queue state is always visible ("saved on tablet — needs sync"). | Delivery, payments, photo uploads (queue already exists) | Check — photo queue message exists; list actions to audit |
| 7 | x-height | Body font keeps a tall x-height for readability at arm's length on a tablet (current Inter stack qualifies); no condensed fonts for operational text. | All operational screens | Met (Inter) |
| 8 | Touch target | Every tappable target ≥ 48px on tablet/phone workflows (blueprint: large buttons); ≥ 44px absolute floor on dense desktop lists. No icon-only button smaller than 44px. | All buttons, rows, filter tabs | **Met** — CSS button height token is 56px; main button classes are 48–52px min-height. Dense rows to spot-check |
| 9 | Leading | Body line-height ≥ 1.4; dense list rows ≥ 1.3; nothing cramped enough to misread a package number. | Lists, detail grids, print previews | Check |
| 10 | Origin-aware animation | Popovers, menus and pickers open from their trigger (see Part B). | Autocomplete dropdowns, row action menus | Gap — see motion |
| 11 | OKLCH | New colour tokens are defined in OKLCH with hex fallbacks. Existing MTS hex palette stays as-is until a token pass is scheduled; status colours are semantic only (state + label, never decoration). | CSS tokens, status badges | Check — current CSS is hex-only |
| 12 | Widow | Headings and tile titles never leave a single word alone on the last line (`text-wrap: balance` or manual breaks on fixed titles). | Screen titles, tile launchers, print headings | Check |
| 13 | Safe area | Content respects notch/home-indicator insets on phones and the NB80 screen edges. | All screens, sticky bars | **Met** — `safe-area-inset` used in 7 places in `styles.css` |
| 14 | Stagger | List reveals may stagger (Part B values) but long operational lists (50+ rows) never animate row-by-row — speed beats decoration. | Short lists, tile grids only | Gap — see motion |
| 15 | Line length | Body/instruction text wraps at ~60–75 characters; warehouse instructions stay short lines, one idea per line. | Help text, notices, DR reader messages | Check |
| 16 | Affordance | Anything tappable looks tappable (button surface, row chevron/action label); plain text never looks like a button. Disabled states look disabled. | Rows, tiles, filter tabs | Check — filter tabs + "View Trip" pseudo-buttons are the pattern to keep |
| 17 | Combobox | Every search-select (customer, product, truck, cargo, trip) uses the one shared accessible autocomplete: keyboard + touch, clear no-results text, selected value shown as a label. No one-off pickers. | Receiving, Trips, Delivery search fields | **Met** — shared `AutocompleteField` used across modules; new fields must reuse it |
| 18 | Interruptible animation | Any animation can be interrupted by the next tap; nothing locks input while animating. | All motion | Gap — see motion |
| 19 | Progressive disclosure | Advanced/rare fields stay behind a deliberate tap (collapsible sections, "details" expansions); the default screen shows only the current step's fields. | Receiving (already the pattern), cargo details, settings | **Met** in Receiving; keep as the rule for new screens |
| 20 | Shared element transition | Not adopted for the ops app (see Part B). Exception: none for now. | — | Not adopted |

## Part B — Motion spec (trimmed subset of Jerwin's 20 rules)

MTS is a working tool: motion must never slow data entry. Current state:
`styles.css` has almost no transitions and **no `prefers-reduced-motion`
handling (Gap)**. The adopted subset below is the whole MTS motion budget
for staff screens. Numbers refer to the original 20-rule list.

**Adopted**
- (1) Ease-out for entrances.
- (2) Dropdowns/pickers animate 150–250 ms.
- (4) Press feedback: scale to 0.97 on primary buttons only (never on list rows staff tap rapidly).
- (9) Ease-in-out for moves (panel/section open-close).
- (10) Popovers start at 0.95 scale.
- (11) + (12) Enter from the trigger, exit back to the trigger (origin-aware, term #10).
- (13) No bounce on everyday UI.
- (14) No tweening while held — drags/scrolls follow the finger directly.
- (15) Exits 20% shorter than entrances.
- (18) Interruptible: a new tap cancels running animation (term #18).
- Reduced motion: `prefers-reduced-motion` renders the final state with no movement — **required, currently missing**.
- Hard cap: no animation over 250 ms on staff workflows; no animation at all on scan/typing-driven updates (QR wedge input must feel instant).

**Not adopted for MTS ops screens** (fine for a marketing site, wrong here):
(3) 30 ms row stagger — only for tile grids/short lists, never long lists;
(5) knob stretch, (6) settle stagger, (7) arcs, (8) success pulse
(a plain status change + message is clearer), (16) state overlap,
(17) mask reveals, (18→icon crossfade/blur), (19) rubber-band,
(20) shared-element transitions / layoutId.

## Part C — MTS-specific additions (Muse proposals, approved with this draft)

1. **Scan-first rule:** any screen a scanner/wedge feeds must be fully usable
   without touching the screen; focus never gets stolen by animations or popups.
2. **Glanceability:** status is readable at arm's length — status badge +
   next-action text on every cargo/trip row (already the cargo-row pattern).
3. **Print parity:** anything printable (receiving slip, QR label, DR,
   manifest) is checked on the 80mm layout, not just on screen.
4. **Bilingual safety:** labels must survive Tagalog length — buttons and
   badges sized for the longer of the two languages, no fixed-width text traps.
5. **Offline honesty:** queued/unsynced work is always visibly marked;
   a screen never implies the server has data it hasn't received.

## How this gets used

- New Phase 1+ UI work is checked against Parts A–B before a PR opens;
  the PR description names any criterion knowingly not met.
- First fixes under this checklist: (a) tabular numbers CSS pass,
  (b) `prefers-reduced-motion` block — both tiny, both verified gaps.
- This file lives in the repo under `docs/`; changes go through a PR.
