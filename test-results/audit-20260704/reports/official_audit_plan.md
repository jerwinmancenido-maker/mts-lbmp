---
## ⚡ EXECUTION PROMPT — READ THIS FIRST, EVERY TIME

```
BEFORE DOING ANYTHING ELSE:

1. Read: /Users/jerwinmancenido/mts-lbmp/test-results/audit-20260704/reports/current-state.md
2. Execute ONLY the step listed under NEXT_ACTION in that file.
3. Do not execute any other step, even if you can see what comes next.
4. After completing the step, output the required response block (see Rule 8 below).
5. Update current-state.md: mark the step done, write the new NEXT_ACTION.
6. If the next step requires user confirmation (physical print, user observation):
   → Output: WAITING_FOR_USER
   → Stop. Do not continue until user confirms.
7. If a screenshot is invalid (wrong screen, public website, wrong state):
   → Output: INVALID_SCREENSHOT
   → Stop. Recapture before continuing.
8. If an issue cannot be fixed or deferred right now:
   → Output: BLOCKED with reason
   → Stop. Do not skip past it.
```

## 🔄 RE-ENTRY PROTOCOL

```
If resuming after ANY pause, question, or interruption:

1. Read current-state.md first and ONLY.
2. Do NOT use conversation history to determine position.
3. Do NOT re-read this plan from the top to find your place.
4. Execute the NEXT_ACTION from current-state.md immediately.

Position = current-state.md. Always. No exceptions.
```

---

# MTS-LBMP Audit + Fix Sprint
## MacBook Browser vs NB80 Tablet — Find It, Fix It, Document It

**Status:** 🔴 In Progress — Paused at Phase 5 Receive Print closeout
**State file:** `test-results/audit-20260704/reports/current-state.md`
**Codebase:** `/Users/jerwinmancenido/mts-lbmp`
**Entry point:** `http://localhost:3000/app?demo=admin`
**API port:** `http://localhost:4100`
**Type:** Combined audit + live fix sprint — not documentation only

---

## 📍 Current Active Step

```text
PHASE 5.1 — Receive post-save print screen polish

Do not test Trips, Delivery, Payments, or any other module
until this step and all Receive Print closeout items below are marked done.
```

**Receive Print Closeout — required order:**

```text
1. Workflow correctness    → post-save screen shows RR number before Print appears
2. Print visibility        → Print panel visible on NB80, not hidden below editor
3. Physical confirmation   → 80mm print confirmed by user, 58mm confirmed or deferred
4. UI polish               → button hierarchy, card sizing, secondary actions reduced
5. Staff manual update     → Receive chapter updated with final after-fix screenshots
```

> Fix in this order. Do not fix beauty while workflow is still unclear.

---

## What This Sprint Is

This is **not** a findings report. This is a **fix sprint** that uses audit as its discovery method.

```
Find problem → Fix it immediately → Screenshot the fix → Write the manual chapter → Move on
```

The sprint is complete when all problems are **found and fixed**.
Anything that cannot be fixed live is logged as `Deferred` with a reason and priority.
Nothing is left as just a note.

---

## Sprint Rule

| Device | Role |
|---|---|
| **MacBook browser** | Discovery — find layout issues, API errors, UX problems, broken flows |
| **NB80 tablet APK** | Validation — confirm fixes work on the actual device staff use |

> **If MacBook and NB80 disagree, NB80 wins. Fix for NB80, not for MacBook.**

---

## Fix Loop (runs on every screen, every button, every step)

```
1. Open screen → screenshot before state
2. Test every button and input on that screen
3. Check UX: labels, buttons, redundant actions, information load, step count
4. Decide per issue:
   - Fix live → edit app-shell.tsx → screenshot after → log fix
   - Defer → log with P1/P2/P3 and reason → continue
5. Write the manual chapter for this module (using after-fix screenshots)
6. Move to next screen — do not stop
```

> A step is not done until the fix is applied or explicitly deferred with a reason.

---

## Sprint Reality (Updated 2026-07-04 after execution audit)

### What was completed

- ✅ NB80 connected via wireless ADB, ADB reverse active
- ✅ Baseline screenshots captured for all 12 tabs on both MacBook and NB80
- ✅ Product/SKU/barcode combined into single product field
- ✅ On-screen Scan button removed from Add Item (NB80 uses physical scanner)
- ✅ DR photo label simplified
- ✅ Missing delivery address blocked before server save with staff-readable error
- ✅ Typed/scanned item no longer counted until `Add Item` is tapped
- ✅ Save generates official RR number before Print appears
- ✅ Receive Records shows newest saved RR first
- ✅ Saved record detail exposes Reprint / Preview / Edit / Audit controls
- ✅ Preview Receipt closes record editor before showing print panel
- ✅ View Preview auto-scrolls into view
- ✅ Print success message changed to staff wording: `Print request sent. Check if paper came out.`
- ✅ Cancelled drafts land in Cancelled Drafts view
- ✅ Physical receiving receipt confirmed printed on NB80
- ✅ Paper size selector (80mm / 58mm) works at app level
- ✅ Receive staff manual chapter written

### What drifted (why the sprint was paused)

- ❌ Some live-fixable recommendations were logged instead of being fixed or deferred before moving on
- ❌ Screenshot proof was inconsistent early — some screenshots captured the public website, not the internal app
- ❌ MacBook vs NB80 comparison was not completed for every screen
- ❌ Phase 5 Receive Print was not fully closed before touching Trips/Manifest
- ❌ Several P1/P2 issues on the saved receiving page, trip detail, and print panel were not resolved
- ❌ Fix tracker was not kept synchronized with every screenshot and fix

### Open P1 issues (must fix before any other module)

| # | Issue | Status |
|---|---|---|
| 1 | Saved receiving post-save screen: too many large equal-weight buttons | ❌ Not fixed |
| 2 | Print panel still vertically heavy — one primary Print button required | ❌ Not fixed |
| 3 | Physical 58mm output sizing not validated | ❌ Not tested |
| 4 | Print failure must show staff-readable prompt | ❌ Not tested |

### Open P2 issues (fix or defer with reason before Trips)

| # | Issue | Status |
|---|---|---|
| 5 | Saved receiving page: payment summary cards too tall | ❌ Not fixed |
| 6 | Record detail: edit-heavy — should show print first, edit behind secondary action | ❌ Not fixed |
| 7 | Trip detail page too tall and heavy | ❌ Not fixed |
| 8 | Broken trip/loading photo thumbnail | ❌ Not fixed |
| 9 | Paper selector should default from Device setup setting | ❌ Not fixed |

### Correct restart point

**Resume at: Phase 5 Receive Print closeout.**

Before moving to Phase 6 (Trips), confirm ALL of the following:

```text
[ ] Post-save screen shows: official RR number + one primary Print button + paper selector + smaller secondary actions
[ ] Records detail: Reprint visible, Preview visible, Edit available but not visually dominant
[ ] Physical 80mm print confirmed with new build
[ ] Physical 58mm print confirmed OR explicitly deferred with reason
[ ] Print failure shows staff-readable prompt
[ ] Fix log updated with all changes
[ ] Receive manual chapter updated with final after-fix screenshots
[ ] Plan tracker marked: Phase 4 ✅ CLOSED, Phase 5 Receive Print ✅ CLOSED
```

---

## No-Drift Enforcement (Hard Rules)

> These rules close the loopholes that caused the first sprint to drift.

1. **Never log a recommendation without a decision.** Every issue gets either:
   - `Fixed` — code change made, screenshot proof attached, log entry written
   - `Deferred` — reason written, priority assigned, next-sprint note written
   There is no third option.

2. **Never move to the next module until the current module checklist is 100% closed.** Every checkbox must be `[x]` or `[defer: reason]` — no blank items.

3. **Every screenshot must be validated before it counts as evidence.** A screenshot is only valid if it states:
   - Screen name
   - Action tested
   - What it proves
   - What is still bad
   - Fix/defer decision

4. **A MacBook screenshot and an NB80 screenshot are both required for each step.** One device alone is not enough.

5. **Physical print confirmation requires a user report** — ADB screenshots prove the app sent the request, not that paper came out. Log these separately.

6. **The APK must be on the internal app route before any screenshot counts.** If the APK opens the public website, hard-refresh before continuing. Invalid screenshots must be labeled as invalid in the audit trail — they cannot prove workflow success.

7. **Every valid screenshot must be shown to the user in chat using its file path before counting it as reviewed.** Saving a screenshot to disk without embedding it in a response does not count. The user must be able to see it.

8. **Every response while a step is active must use this format:**

   ```text
   Current step:    [Phase and step name]
   What I tested:   [exact action taken]
   Screenshot proof: [file path shown here]
   Issue found:     [what is wrong]
   Decision:        Fixed / Deferred
   Next action:     [what happens next]
   ```

   No update without this block. No moving on without this block.

9. **Hard stop for invalid screenshots.** If a screenshot shows:
   - The wrong screen
   - The public website instead of internal app
   - A state that does not match the expected action result

   → **Stop. Do not continue testing. Recapture the screenshot first.**
   Mark the invalid screenshot as `INVALID` in the audit trail with the reason.

---

## Pre-Sprint Readiness Check

### ✅ Confirmed installed and ready

| Tool | Version | Status |
|---|---|---|
| Node.js | v24.16.0 | ✅ Ready |
| npm | 11.13.0 | ✅ Ready |
| node_modules | 315 packages installed | ✅ Ready |
| Playwright | 1.61.1 | ✅ Ready |
| Playwright Chromium | v1228 (installed at `~/Library/Caches/ms-playwright/chromium-1228`) | ✅ Ready |
| Playwright Chromium Headless Shell | v1228 (installed) | ✅ Ready |
| Capacitor CLI | 8.4.1 | ✅ Ready |
| ADB | 1.0.41 (at `~/Library/Android/sdk/platform-tools/adb`) | ✅ Ready |
| NB80 device | `adb-NB80T25120035-SVVEdO` connected | ✅ Ready |
| Java JDK | via Android Studio | ✅ Ready |
| Android Gradle wrapper | exists | ✅ Ready |
| Smoke test | `npm run smoke` → `ok: true` | ✅ API + DB working |
| Vitest | ^4.1.9 | ✅ Installed |
| msw | ^2.14.6 | ✅ Installed |

### ⚠️ Action required before sprint

| Item | Issue | Fix |
|---|---|---|
| `.env` file | **Missing** — only `.env.example` exists | Copy and fill: `cp .env.example .env` then set real `DATABASE_URL`, `JWT_SECRET`, `NEXT_PUBLIC_API_URL=http://localhost:4100`, `PORT=4100` |
| `adb` not in PATH | `adb` is at `~/Library/Android/sdk/platform-tools/adb` but not in shell PATH | Add to `~/.zshrc`: `export PATH="$PATH:$HOME/Library/Android/sdk/platform-tools"` then `source ~/.zshrc` |
| Playwright Firefox / WebKit | Not installed (only Chromium is cached) | Run `npx playwright install` if Firefox/WebKit tests are needed — not required for this sprint (Chromium only) |
| ADB reverse | Must be re-run each time device reconnects | `npm run apk:reverse` — confirm port 3000 is forwarded before testing NB80 |
| Web server | Must be running at port 3000 | `npm run dev:web` in a separate terminal |
| API server | Must be running at port 4100 | `npm run dev:api` in a separate terminal |

### Start commands (run in separate terminals)

```bash
# Terminal 1 — API
npm run dev:api

# Terminal 2 — Web
npm run dev:web

# Terminal 3 — ADB reverse (run once after connecting NB80)
npm run apk:reverse

# Terminal 4 — ADB logcat (for native crash monitoring during sprint)
npm run apk:logs
```

---

## Environment

**ADB reverse is active.** The NB80's `localhost:3000` tunnels directly to the MacBook dev server. Both devices hit the same data.

### Demo URLs (all roles)

| Role | URL | Access |
|---|---|---|
| System Admin | `http://localhost:3000/app?demo=admin` | Full — all 12 tabs, all permissions |
| Daet Owner | `http://localhost:3000/app?demo=owner` | Full ops — all tabs including settings |
| Naga Owner | `http://localhost:3000/app?demo=naga` | Full ops — different branch scope |
| Receiving Staff | `http://localhost:3000/app?demo=receiving` | Dashboard, Receive, Cargo, Trips, Payments, Expenses, Chat, Device |
| Delivery Staff | `http://localhost:3000/app?demo=delivery` | Dashboard, Cargo, Deliver, Payments, Expenses, Chat, Device |
| Customer Owner | `http://localhost:3000/app?demo=customer` | Dashboard, Cargo, Customers only |

> **Delivery Admin** has no demo token. Test by manually changing the role in the account panel if available, or note as untested with this sprint's tooling.

**Start as System Admin.** Switch URLs to test role-restricted views in Phase 2.

---

## Live Fix Protocol

### What gets fixed live

| Fix Type | What it means |
|---|---|
| Button label | Rename confusing labels to plain warehouse language |
| Redundant button | Hide or remove buttons that duplicate an existing action |
| Abbreviation | Spell out RR, DR, PKG, etc. where staff would not know them |
| Status label | Rewrite developer status text to action-oriented language |
| Error message | Replace HTTP error codes with plain-language instructions |
| Unnecessary text | Remove helper text or labels that add no value for staff |
| Oversized button | Reduce a button that takes excessive screen space |
| Secondary action | Move secondary buttons to a smaller or collapsed position |
| Workflow prompt | Add a "What to do next" message after a key action |
| Combined steps | Merge two unnecessary separate screens into one |
| Pre-filled field | Auto-fill fields the app already knows (branch, date, staff name) |

### What does NOT get fixed live

- Logic changes (what a button does, not what it says)
- New features or new endpoints
- Database schema changes
- Permission changes
- Print template content (e.g. `auditLine` label in loading manifest — Defer P3)
- Any change that could affect data integrity

### Plain Language Replacements (apply everywhere found)

| Replace | With | Reason |
|---|---|---|
| Finalize | Confirm | Developer word |
| Submit | Save | Tech form word |
| Validate | Check | Too technical |
| Entity | Record | Too technical |
| Draft | Unfinished record | Clearer |
| Finalize Draft | Save as new receiving | Action-oriented |
| Cancel Draft | Delete unfinished record | Tells staff what happens |
| RR (standalone label) | Receiving Record | Not everyone knows RR |
| DR (standalone label) | Delivery Receipt | Not everyone knows DR |
| PKG | Package | Always spell out |
| Waiting for Price | Needs Pricing | Action-oriented |
| Waiting for Loading | Ready to Load | Action-oriented |
| In Transit | On the Truck | Simpler |
| Exception | Problem with Delivery | Clearer |
| 400 Bad Request | Please check your entries | Human-readable |
| 401 Unauthorized | Please log in again | Human-readable |
| 403 Forbidden | You do not have access to do this | Human-readable |
| 500 Internal Server Error | Something went wrong. Try again. | Human-readable |
| auditLine / entityId / entityType | (remove from visible UI — Defer if in print templates) | Developer metadata |
| createdAt | Date added | Simpler |
| updatedAt | Last updated | Simpler |

### Button Simplification Rules

| Rule | Action |
|---|---|
| One primary action visible per step | All others secondary (smaller, outlined, collapsed) |
| Reprint not visible before first print | Hide until after first print succeeds |
| Cancel and X not both present | Keep only one close/cancel per panel |
| Edit not visible if role cannot edit | Hide for roles without `receiving.edit` |
| View Preview not same size as Print | Print is primary, preview is secondary |
| Action buttons not full-width unless sole action | Reduce to fit-content or max-width |

### Workflow Simplification Rules

**The test for every step:** *"Does staff need to see this screen, or is this the app talking to itself?"*

If "the app talking to itself" → combine or remove.

#### Steps that can be combined live

| Pattern | Action |
|---|---|
| Two consecutive screens asking same type of input | Merge into one screen |
| Confirmation dialog right after save with clear success state | Remove dialog |
| "Review" screen before save with no editable fields | Remove it |
| Success screen with only "Done" + Close button | Replace with inline success message |
| Detail page opened just to tap one button | Surface the button in the list row |
| Form split across two pages with 2–3 fields each | Merge into one scrollable form |
| Autocomplete followed by separate "Confirm selection" tap | Auto-confirm on exact match |

#### Fields that can be pre-filled live

| Field | Pre-fill with |
|---|---|
| Branch | Active branch context from current session |
| Date | Today's date |
| Staff name | Logged-in user's name |
| Collection point | Role default (Receiving Staff → Receiving, Delivery → Delivery) |
| Paper width | Last used value from localStorage |

#### Never simplify these (keep the deliberate step)

| Step | Reason |
|---|---|
| Confirm delete or cancel | Irreversible |
| Confirm final save that creates a record number | Creates permanent record |
| Select customer from autocomplete | Staff must verify correct customer |
| Select printer paper size | Device-specific |
| Review print before printing | Prevents wasted paper |

### Fix Log Format

```text
Fix #:         [sequential number]
Screen:        [module → step]
Problem:       [what was wrong]
Fix type:      [label / button / step / pre-fill / merge / remove]
Before:        [original text/structure, or N taps]
After:         [new text/structure, or N taps]
File + line:   [app-shell.tsx ~line X]
Status:        Fixed / Deferred
Deferred why:  [reason if deferred]
Priority:      P1 / P2 / P3 / P4
```

---

## Live Media & Animation Strategy

To provide a modern, interactive staff manual, we capture **looping WebP animations / screen recordings** of the actual workflow steps instead of static screenshots. 

### How media is captured

*   **MacBook Browser**: The browser subagent automatically records sessions as high-quality WebP videos. We extract and crop these into action-specific loop files (`.webp`).
*   **NB80 Tablet**: We use the ADB screen recorder to capture the physical device screen:
    ```bash
    # Record up to 10 seconds of flow
    adb shell screenrecord --time-limit 10 /sdcard/step.mp4
    # Pull to MacBook
    adb pull /sdcard/step.mp4 ./step.mp4
    ```
    We convert these captures into looping WebP files.

### Types of Media Files Captured

| Type | Format | Naming | Purpose |
|---|---|---|---|
| Standard paired flow | WebP loop | `[NN]-[step]-macbook.webp` / `[NN]-[step]-nb80.webp` | Shows interaction comparison side-by-side |
| Before-fix state | WebP loop | `[step]-before-fix.webp` | Captures the original friction/error before code change |
| After-fix state | WebP loop | `[step]-after-fix.webp` | Captures the new, simplified interaction after fix |
| Error trigger | WebP loop | `[module]-error-[type].webp` | Shows validation messages appearing in real time |
| Print sequence | MP4/WebP | `print-[doc]-flow.mp4` | Shows paper feed and print outcome on NB80 |
| Role transition | WebP loop | `[role]-nav-flow.webp` | Walks through menu changes when role is switched |

### UX Review on every recording

```text
Screen:            [module → step]
Redundant buttons: [any that duplicate an action]
Staff clarity:     [would a non-technical warehouse worker understand this?]
Button size:       [any oversized buttons?]
Label clarity:     [any technical, abbreviated, or ambiguous labels?]
Information load:  [too much on screen? what should be collapsed?]
Fix applied:       [code change made, or "None"]
Priority:          [P1 / P2 / P3 / P4]
```

---

## Living Staff Manual

After each module is complete and fixes applied, a chapter is written immediately using the **after-fix WebP loop animations**.

**File:** `staff-manual.md` — grows one chapter per module throughout the sprint.

### Chapter template

```markdown
# [Module Name]
## What this is for
[One sentence.]

## Who uses this
[Plain role names only.]

## How to get here
[Exact tap path. Example: "Tap the Receive tab."]

---

## Steps

### Step 1: [Action in plain language]
![Action Loop (Animation)](/Users/jerwinmancenido/.gemini/antigravity-ide/brain/b9a8a3c9-dd43-42c7-bbc1-54415946e10d/after-fix-animation.webp)

What you see: [describe the screen and animation]
What to do: [exact instruction]
If something goes wrong: [what to do]

---

## Common Questions
**Q: [Natural staff question]**
A: [Plain answer]

**Q: What if I made a mistake?**
A: [Recovery options]

## What happens after this
[One sentence — next step in workflow]
```

### Writing rules

- No technical terms. Use "tap" not "click". Use "record" not "entity".
- One action per step. Every step has a looping animation/video showing the exact action.
- Errors get their own step. Every chapter ends with "What happens after this."

### Chapter order

| Chapter | Module | Written after phase |
|---|---|---|
| 1 | Logging In / Switching Role | Phase 2 |
| 2 | Dashboard | Phase 2 |
| 3 | Receive — Creating a New Record | Phase 3 |
| 4 | Receive — Saving and Printing | Phase 3+4 |
| 5 | Receive — Resuming an Unfinished Record | Phase 3 |
| 6 | Receive — Finding a Past Record | Phase 3 |
| 7 | Cargo — Viewing All Packages | Phase 2 |
| 8 | Trips — Creating and Departing a Trip | Phase 5 |
| 9 | Deliver — Completing a Delivery | Phase 6 |
| 10 | Payments — Recording a Payment | Phase 7 |
| 11 | Expenses — Submitting an Expense | Phase 8 |
| 12 | Chat — Sending a Message or Price Request | Phase 9 |
| 13 | Scanner — Using the Barcode Scanner | Phase 11 |
| 14 | Printing — Printing on the Tablet | Phase 4 |
| 15 | Device — Checking Device Status | Phase 2 |
| 16 | Customer Drop-Off Form (Wall QR) | Phase 14 |
| 17 | Troubleshooting — When Something Goes Wrong | Phase 13 |

---

## Phase 1: Environment Sync

```text
[ ] .env file exists with correct DATABASE_URL, JWT_SECRET, NEXT_PUBLIC_API_URL, PORT
[ ] Web server running at localhost:3000
[ ] API server running at localhost:4100
[ ] GET http://localhost:4100/health → { ok: true } confirmed
[ ] ADB in PATH — run: export PATH="$PATH:$HOME/Library/Android/sdk/platform-tools"
[ ] NB80 connected — run: adb devices → device shown
[ ] ADB reverse active — run: npm run apk:reverse → port 3000 forwarded
[ ] APK freshly installed or hard-refreshed (not stale WebView cache)
[ ] Both devices on same app build
[ ] Both devices using demo=admin (System Admin, full access)
[ ] Active branch context same on both: MacBook=___ NB80=___
[ ] NB80 paper width confirmed
      localStorage key: mts-lbmp-device-paper-width → "80mm" or "58mm"
[ ] Camera unavailable flag absent
      localStorage key: mts-lbmp-device-camera-unavailable → must NOT exist
[ ] NB80 offline queue empty (Device tab → storage)
[ ] NB80 photo queue empty
[ ] Diagnostic logs cleared (Device tab → Clear Logs)
[ ] ADB logcat running in Terminal 4: npm run apk:logs

> ⚠️ **Hanging Safeguard (Browser Subagent)**: The app's active sync/refresh cycles (IndexedDB, PWA caching) can cause Playwright's `networkidle` state to hang indefinitely. 
> To prevent hangs, do NOT wait for networkidle. Wait instead for specific DOM selectors or elements to become visible on the screen before continuing.
[ ] NB80 WebView URL is https:// or http://
      If http://: service worker shell caching is DISABLED — note this
[ ] pendingSyncCount badge shows 0
[ ] npm run smoke passes: ok: true
```

---

## Phase 2: Navigation + Role Visibility Audit

### Step A — API health

```text
[ ] GET http://localhost:4100/health → { ok: true, service: "MTS LBMP API" }
[ ] If fail → stop sprint, fix API server first
```

### Step B — Full admin nav pass

Open each tab as System Admin. Screenshot both devices. Apply UX review.

| Tab | Label | Check |
|---|---|---|
| `dashboard` | Dashboard | `[ ]` |
| `receiving` | **Receive** | `[ ]` |
| `packages` | **Cargo** | `[ ]` |
| `trips` | Trips | `[ ]` |
| `delivery` | **Deliver** | `[ ]` |
| `payments` | Payments | `[ ]` |
| `expenses` | Expenses | `[ ]` |
| `customer` | Customers | `[ ]` |
| `chat` | Chat | `[ ]` |
| `admin` | Admin | `[ ]` |
| `settings` | Settings | `[ ]` |
| `hardware` | Device | `[ ]` |

> Exact labels: **Receive**, **Cargo**, **Deliver** — not Receiving, Packages, Delivery.

### Step C — Role restriction pass

```text
[ ] ?demo=receiving  → Receive✅ Cargo✅ Trips✅ Payments✅ Expenses✅ Chat✅ Device✅
                       Deliver❌ Customers❌ Admin❌ Settings❌
[ ] ?demo=delivery   → Cargo✅ Deliver✅ Payments✅ Expenses✅ Chat✅ Device✅
                       Receive❌ Trips❌ Customers❌ Admin❌ Settings❌
[ ] ?demo=naga       → All tabs✅ (same as Daet Owner but Naga branch scope)
                       Confirm branch context shows Naga, not Daet
[ ] ?demo=customer   → Dashboard✅ Cargo✅ Customers✅ — everything else❌
[ ] Delivery Admin   → No demo token — note as untested, Deferred P3
```

Fix any tab visible to wrong role or missing for correct role.

### Step D — Record count parity

| Tab | Fetch limit | MacBook count | NB80 count | Match? |
|---|---|---|---|---|
| Receive | 250 packages (active statuses) | ___ | ___ | `[ ]` |
| Cargo | 250 packages | ___ | ___ | `[ ]` |
| Trips | 500 packages (active) | ___ | ___ | `[ ]` |
| Deliver | 250 packages (delivery statuses) | ___ | ___ | `[ ]` |
| Payments | 500 packages + payments | ___ | ___ | `[ ]` |

> Lists have `LIST_PAGE_SIZE = 25`. If a module has >25 records, pagination activates.
> Test: does "Load more" / pagination work on NB80? Does it fetch new data or just show cached?

### Step E — Language toggle

```text
[ ] Find language toggle (Settings or account panel)
[ ] Switch NB80 to Tagalog — screenshot all active tabs
[ ] Note any labels that overflow, truncate, or break layout on tablet
[ ] Fix any CSS overflow found live
[ ] Switch back to English before continuing
```

---

## Phase 3: Login Flows

> The plan uses demo URLs for role switching, but actual login is what staff use in production. Both flows must be tested.

| # | Step | API endpoint |
|---|---|---|
| 1 | Open `http://localhost:3000` (no demo param) | — |
| 2 | Email + password login | `POST /auth/login` |
| 3 | Login with wrong password | `POST /auth/login` → expect error |
| 4 | Login with staff code | `POST /auth/staff-code` |
| 5 | Login with wrong staff code | `POST /auth/staff-code` → expect error |
| 6 | Confirm error messages are plain language | — |
| 7 | Confirm successful login redirects to app | — |
| 8 | Confirm role is applied correctly after login | — |

---

## Phase 4: Receive Module — Full Workflow

| # | Step | API endpoint | Fix applied? |
|---|---|---|---|
| 1 | Open Receive tab | — | `[ ]` |
| 2 | New Receiving form opens | — | `[ ]` |
| 3 | Branch pre-filled from session | Bootstrap cache | `[ ]` |
| 4 | Customer autocomplete (min 2 chars) | Bootstrap cache | `[ ]` |
| 5 | Drop-off person autocomplete | Bootstrap cache | `[ ]` |
| 6 | Receiver / consignee autocomplete | Bootstrap cache | `[ ]` |
| 7 | DR number input | — | `[ ]` |
| 8 | DR image — camera capture | `POST /uploads` | `[ ]` |
| 9 | DR image — fallback file picker | `POST /uploads` | `[ ]` |
| 10 | **Camera unavailable fallback** — test on NB80 | localStorage key | `[ ]` |
| 11 | Product scan → product master | `POST /products/scan` | `[ ]` |
| 12 | Scan finds no match → create new product master | `POST /products` | `[ ]` |
| 13 | Barcode scan → customer description | `POST /barcodes/scan` | `[ ]` |
| 14 | Barcode link (new barcode to description) | `POST /barcodes/link` | `[ ]` |
| 15 | Product name manual input | — | `[ ]` |
| 16 | Add single item | — | `[ ]` |
| 17 | Add multiple items | — | `[ ]` |
| 18 | Price suggest | `POST /pricing/suggest` | `[ ]` |
| 19 | Save draft | `POST /receiving/drafts` | `[ ]` |
| 20 | Resume draft after reload | `GET /receiving/drafts` | `[ ]` |
| 21 | Update draft | `PATCH /receiving/drafts/:id` | `[ ]` |
| 22 | Cancel draft | `POST /receiving/drafts/:id/cancel` | `[ ]` |
| 23 | Finalize / save receiving record | `POST /receiving/drafts/:id/finalize` | `[ ]` |
| 24 | **Direct receive create (no draft)** | `POST /receiving` | `[ ]` |
| 25 | RR number shown on screen after save | — | `[ ]` |
| 26 | Print panel visible | — | `[ ]` |
| 27 | Auto-print fires on NB80 (120ms delay) | see Phase 5 | `[ ]` |
| 28 | Print: Receiving Document | `GET /receiving/:id/receiving-document` | `[ ]` |
| 29 | Print: Receiving Slip (per package) | `GET /packages/:id/receiving-slip` | `[ ]` |
| 30 | Print: QR label | `GET /packages/:id/qr-label` | `[ ]` |
| 31 | Open Records tab | `GET /receiving` | `[ ]` |
| 32 | Open saved RR detail | — | `[ ]` |
| 33 | Reprint | `documents.reprint` permission | `[ ]` |
| 34 | Edit with audit reason | `PATCH /receiving/:id` | `[ ]` |
| 35 | Add DR photo after save | `POST /receiving/:id/dr-photo` | `[ ]` |
| 36 | View per-record audit log | `GET /receiving/:id/audit` | `[ ]` |
| 37 | Set/update package price (`pricing.edit`) | `PATCH /packages/:id/price` | `[ ]` |
| 38 | Update package measurements (`loading.scan`) | `PATCH /packages/:id/measurements` | `[ ]` |

### Camera unavailable test (Step 10, NB80 only)

```text
[ ] Set localStorage key: mts-lbmp-device-camera-unavailable = "1"
[ ] Reload the app
[ ] Open Receive → New Receiving form
[ ] Confirm camera buttons are disabled or hidden
[ ] Confirm fallback message is plain language (not a crash)
[ ] Clear the key after test: remove mts-lbmp-device-camera-unavailable
```

### Direct receive create test (Step 24)

```text
[ ] Confirm whether POST /receiving (direct, no draft) is accessible via the UI
[ ] If yes: test it fully — it bypasses draft flow and creates RR directly
[ ] If no UI path exists: flag as Deferred — dead endpoint or future feature
```

### Swipe test (NB80 only)

```text
[ ] While filling out Receive form, perform a left or right swipe
[ ] Does the app navigate away?
[ ] Is form data lost?
[ ] Screenshot result — fix if data is lost
```

---

## Phase 5: Print Audit

### MacBook (preview only — no paper output)

`native-printer.ts` returns `{ ok: false }` on non-native platform. Falls back to `window.print()`.

```text
[ ] Correct API endpoint called per document type
[ ] Text returned and rendered in print preview panel
[ ] Document number appears in preview text
[ ] View Preview toggle works
[ ] Browser print fallback opens when Print tapped
[ ] POST /printing/escpos-preview works
```

### NB80 — Auto-print trigger test

`autoPrintKey` fires `printDocument()` 120ms after receiving save.

```text
[ ] After saving a receiving record, watch the printer
[ ] Does paper come out before staff taps Print?
[ ] Is staff informed auto-print is happening?
[ ] If staff also taps Print — does it double-print?
[ ] Fix: disable Print button during auto-print window if double-print is possible
```

### NB80 — Actual print tests per document

| Document | Endpoint | 58mm tested | 80mm tested |
|---|---|---|---|
| Receiving Document | `GET /receiving/:id/receiving-document` | `[ ]` | `[ ]` |
| Receiving Slip | `GET /packages/:id/receiving-slip` | `[ ]` | `[ ]` |
| QR Label | `GET /packages/:id/qr-label` | `[ ]` | `[ ]` |
| Loading Manifest | `GET /trips/:id/loading-manifest` | `[ ]` | `[ ]` |
| Delivery Receipt | `GET /packages/:id/delivery-receipt` | `[ ]` | `[ ]` |
| ESC/POS Preview | `POST /printing/escpos-preview` | `[ ]` | `[ ]` |

> **58mm note:** The printing package exports only an 80mm renderer (`WIDTH_80MM = 42`). 58mm may rely on the NyxPrinter SDK handling narrower paper. Confirm whether content truncates or wraps correctly on physical 58mm paper. If the same template is used for both widths, flag as Deferred: needs a 58mm-specific template.

> **`auditLine` in Loading Manifest:** The print template includes `{ label: "Print", value: input.auditLine }` which renders developer metadata on the physical paper. This is in the print template (not `app-shell.tsx`) and cannot be fixed live. **Defer P3** — remove auditLine from the print template in a separate fix.

All test prints: include text `TEST PRINT - DO NOT USE AS OFFICIAL`

---

## Phase 6: Trips Module — Full Workflow

| # | Step | API endpoint | Permission | Fix applied? |
|---|---|---|---|---|
| 1 | Open Trips tab | `GET /trips` | `trips.view` | `[ ]` |
| 2 | Trips list renders | — | — | `[ ]` |
| 3 | Create new trip | `POST /trips` | `trips.create` | `[ ]` |
| 4 | Select truck | `GET /trucks` | `trips.view` | `[ ]` |
| 5 | Create new truck | `POST /trucks` | `trips.create` | `[ ]` |
| 6 | Scan package onto trip | `POST /trips/:id/load` | `loading.scan` | `[ ]` |
| 7 | **Loading override** (owner) | `POST /trips/:id/load` with overrideReason | `loading.override` | `[ ]` |
| 8 | Unload package from trip | `POST /trips/:id/unload` | `loading.scan` | `[ ]` |
| 9 | Loading photo | `POST /trips/:id/loading-photo` | `loading.scan` | `[ ]` |
| 10 | Mixed-branch approval | `POST /trips/:id/mixed-approval` | `trips.create` | `[ ]` |
| 11 | Depart trip | `POST /trips/:id/depart` | `trips.edit` | `[ ]` |
| 12 | Print Loading Manifest | `GET /trips/:id/loading-manifest` | `documents.print` | `[ ]` |
| 13 | Mark trip arrived | `POST /trips/:id/arrive` | `arrival.scan` | `[ ]` |
| 14 | Complete trip | `POST /trips/:id/complete` | `trips.edit` | `[ ]` |

> **Loading override test (Step 7):** When a package is flagged or restricted, owners can override the load with a reason. Test: try loading a restricted package as Receiving Staff → should fail. Try as Daet Owner → should succeed with override reason prompt.

> **Receiving Staff trips access:** Receiving Staff has `trips.create` and `loading.scan` but NOT `trips.edit`. Confirm: Depart and Complete buttons are hidden for Receiving Staff.

---

## Phase 7: Deliver Module — Full Workflow

| # | Step | API endpoint | Permission | Fix applied? |
|---|---|---|---|---|
| 1 | Open Deliver tab | `GET /deliveries` | `delivery.complete` | `[ ]` |
| 2 | Packages ready for delivery visible | — | — | `[ ]` |
| 3 | Verify package arrival | `POST /packages/:id/verify-arrival` | `delivery.complete` | `[ ]` |
| 4 | Complete delivery | `POST /deliveries/complete` | `delivery.complete` | `[ ]` |
| 5 | Delivery signature / photo captured | `POST /uploads` | — | `[ ]` |
| 6 | Fail delivery | `POST /deliveries/fail` | `delivery.fail` | `[ ]` |
| 7 | Return package | `POST /returns` | `delivery.complete` | `[ ]` |
| 8 | View returns list | `GET /returns` | `delivery.complete` | `[ ]` |
| 9 | Print Delivery Receipt | `GET /packages/:id/delivery-receipt` | `documents.print` | `[ ]` |
| 10 | Package message / note | `POST /packages/:id/messages` | `messages.reply` | `[ ]` |
| 11 | View package messages | `GET /packages/:id/messages` | `messages.reply` | `[ ]` |

> Confirm: Receiving Staff cannot see the Deliver tab (`?demo=receiving`).

---

## Phase 8: Payments Module — Full Workflow

| # | Step | API endpoint | Permission | Fix applied? |
|---|---|---|---|---|
| 1 | Open Payments tab | `GET /payments` | `payments.record` | `[ ]` |
| 2 | Payments list renders with balance | — | — | `[ ]` |
| 3 | Record a payment | `POST /payments` | `payments.record` | `[ ]` |
| 4 | Payment method selection | Settings data | — | `[ ]` |
| 5 | Partial payment entry | `POST /payments` | `payments.record` | `[ ]` |
| 6 | Mark fully paid | `POST /payments` | `payments.record` | `[ ]` |
| 7 | **Verify payment** (owner) | — | `payments.verify` | `[ ]` |
| 8 | **Void payment** (owner) | — | `payments.void` | `[ ]` |
| 9 | **Edit payment** (owner) | — | `payments.edit` | `[ ]` |
| 10 | View billing invoices | `GET /billing/invoices` | `customers.manage` | `[ ]` |
| 11 | Create billing invoice | `POST /billing/invoices` | `customers.manage` | `[ ]` |
| 12 | Role scope: Receiving Staff → only Receiving collection point | — | — | `[ ]` |
| 13 | Role scope: Delivery Staff → only Delivery collection point | — | — | `[ ]` |
| 14 | Role scope: Owner → sees all payments | — | — | `[ ]` |

> **payments.verify / payments.void / payments.edit (Steps 7–9):** These permissions exist in the permissions package but no test steps existed before. Check whether the UI surfaces these actions anywhere. If UI buttons exist but were untested, test them now. If no UI exists, flag as Deferred: permissions defined but UI not implemented.

---

## Phase 9: Expenses Module — Full Workflow

| # | Step | API endpoint | Permission | Fix applied? |
|---|---|---|---|---|
| 1 | Open Expenses tab | `GET /expenses` | `expenses.create` | `[ ]` |
| 2 | Expenses list renders | — | — | `[ ]` |
| 3 | Submit new expense | `POST /expenses` | `expenses.create` | `[ ]` |
| 4 | Select expense category | Settings data | — | `[ ]` |
| 5 | Attach expense to trip | — | — | `[ ]` |
| 6 | Expense approval (owner) | `POST /expenses/:id/approve` | `expenses.approve` | `[ ]` |
| 7 | Confirm: Receiving Staff cannot approve | — | — | `[ ]` |
| 8 | Expense status visible (pending / approved) | — | — | `[ ]` |

---

## Phase 10: Chat Module — Full Workflow

| # | Step | API endpoint | Permission | Fix applied? |
|---|---|---|---|---|
| 1 | Open Chat tab | `GET /operation-chats` | `messages.reply` | `[ ]` |
| 2 | Chat threads list renders | — | — | `[ ]` |
| 3 | Send a message | `POST /operation-chats/messages` | `messages.reply` | `[ ]` |
| 4 | Send a price request | `POST /operation-chats/price-requests` | `messages.reply` | `[ ]` |
| 5 | Owner approves / rejects price | `POST /operation-chats/:id/price-decision` | `pricing.edit` | `[ ]` |
| 6 | Receiving Staff tries price decision → should be blocked | — | — | `[ ]` |
| 7 | Message timestamps readable (not ISO) | — | — | `[ ]` |
| 8 | Confirm: Customer Owner cannot access Chat | — | — | `[ ]` |

---

## Phase 11: Admin, Settings, and Customers

### Admin tab

| # | Step | API endpoint | Permission | Fix applied? |
|---|---|---|---|---|
| 1 | Open Admin tab | `GET /audit` | `audit.view` | `[ ]` |
| 2 | Audit log list renders | — | — | `[ ]` |
| 3 | Search / filter audit log | — | — | `[ ]` |
| 4 | Soft delete a package | `POST /packages/:id/soft-delete` | `records.softDelete` | `[ ]` |
| 5 | Restore a package | `POST /packages/:id/restore` | `records.restore` | `[ ]` |
| 6 | Receiving Staff cannot access Admin | — | — | `[ ]` |
| 7 | Delivery Staff cannot access Admin | — | — | `[ ]` |

### Settings tab

| # | Step | API endpoint | Permission | Fix applied? |
|---|---|---|---|---|
| 1 | Open Settings tab | `GET /settings` | `settings.manage` | `[ ]` |
| 2 | Company settings visible | — | — | `[ ]` |
| 3 | Update company info | `PATCH /settings/company` | `settings.manage` | `[ ]` |
| 4 | Create branch | `POST /settings/branches` | `settings.manage` | `[ ]` |
| 5 | Edit branch | `PATCH /settings/branches/:id` | `settings.manage` | `[ ]` |
| 6 | Create user | `POST /settings/users` | `settings.manage` | `[ ]` |
| 7 | Edit user | `PATCH /settings/users/:id` | `settings.manage` | `[ ]` |
| 8 | Edit user branch access | `PATCH /settings/users/:id/branch-access` | `settings.manage` | `[ ]` |
| 9 | Update payment methods | `PATCH /settings/payment-methods` | `settings.manage` | `[ ]` |
| 10 | Update expense categories | `PATCH /settings/expense-categories` | `settings.manage` | `[ ]` |
| 11 | Hardware test log | `GET /hardware/tests` | `settings.manage` | `[ ]` |
| 12 | Create hardware test record | `POST /hardware/tests` | `settings.manage` | `[ ]` |
| 13 | Language toggle works | — | — | `[ ]` |
| 14 | Receiving Staff cannot access Settings | — | — | `[ ]` |
| 15 | Delivery Staff cannot access Settings | — | — | `[ ]` |

### Customers tab

| # | Step | API endpoint | Permission | Fix applied? |
|---|---|---|---|---|
| 1 | Open Customers tab | — | — | `[ ]` |
| 2 | Customer list renders | — | — | `[ ]` |
| 3 | Create full customer | `POST /customers` | `customers.manage` | `[ ]` |
| 4 | Add pending customer (during receive) | `POST /customers/pending` | `receiving.create` | `[ ]` |
| 5 | Finalize pending customer | `PATCH /customers/:id/finalize` | `customers.manage` | `[ ]` |
| 6 | Edit customer | `PATCH /customers/:id` | `customers.manage` | `[ ]` |
| 7 | Add customer contact | `POST /customers/:id/contacts` | `receiving.create` | `[ ]` |
| 8 | Send billing reminder | `POST /customers/:id/billing-reminder` | `customers.manage` | `[ ]` |
| 9 | Billing invoices list | `GET /billing/invoices` | `customers.manage` | `[ ]` |
| 10 | Receiving Staff and Delivery Staff cannot access Customers | — | — | `[ ]` |

---

## Phase 12: Scanner Audit

| Endpoint | Purpose | Permission |
|---|---|---|
| `POST /products/scan` | Barcode → product master record | `receiving.create` |
| `POST /barcodes/scan` | Barcode → customer product description | `receiving.create` |
| `POST /barcodes/link` | Link new barcode to existing description | `receiving.create` |
| `POST /products` | Create new product master when scan finds no match | `receiving.create` |

### MacBook

```text
[ ] Type barcode → POST /products/scan → product master populates
[ ] Type barcode → POST /barcodes/scan → description autocomplete appears
[ ] Type unknown barcode → POST /products/scan → no match → create product master via POST /products
[ ] Link barcode to description → POST /barcodes/link
```

### NB80

```text
[ ] Aim physical side scanner at barcode
[ ] Scanned string lands in focused input
[ ] POST /products/scan fires and returns match
[ ] POST /barcodes/scan fires and returns match
[ ] Unknown barcode → no match → UI offers to create new product master
[ ] Autocomplete triggers on scan (not just on typing)
[ ] Result selects without extra tap
[ ] Decide: should on-screen scan buttons be removed if physical scanner handles it?
```

---

## Phase 13: Offline + Sync State Audit

### Offline queue types (from cache.ts)

```typescript
type: "payment" | "expense" | "photo" | "delivery" | "receivingDraft"
```

> ⚠️ Final receiving save is NOT offline-safe. Only drafts queue offline. Staff must be warned clearly.

### Sync state visual audit (7 states)

```text
[ ] Force NB80 offline (airplane mode)
[ ] Sync indicator shows "Offline" — screenshot both devices
[ ] Queue a draft while offline — badge count increments
[ ] Reconnect — indicator transitions: Syncing → Online
[ ] Badge returns to 0 — queued action synced
[ ] Compare: MacBook shows same states for same conditions?
[ ] Fix any sync badge that does not update or shows wrong state
```

### Offline test matrix

| Test | Expected |
|---|---|
| Save draft offline | Queued as `receivingDraft`. Badge increments. |
| Resume draft offline | Available from IndexedDB. No data loss. |
| Final save offline | Clear failure message. No silent RR creation. |
| Photo taken offline | Queued in photoQueue. Syncs on reconnect. |
| Reconnect + sync | All queued items uploaded. Badge clears. |
| Sync failure (server rejects) | Status: Sync failed. Badge stays. Staff sees message. |

---

## Phase 14: Error Visibility + Banner Audit

### Error state library — deliberately trigger on every form

```text
[ ] Submit with all fields empty → screenshot
[ ] Submit with invalid format → screenshot
[ ] Submit with one required field missing → screenshot
[ ] Fix every error message showing HTTP code or developer text
```

### Error banner checks

```text
[ ] GlobalIssueBanner appears on error
[ ] Banner fully visible on NB80 (not cut off by keyboard or notch)
[ ] Plain-language title and message
[ ] Issue count increments
[ ] "Device Logs" button opens diagnostic log
[ ] Error in log: source, level, message, timestamp
[ ] Dismiss → banner closes
[ ] Issue stays in Device Logs after dismissal
```

---

## Phase 15: Public Tracking + Wall QR Intake

### Public shipment tracking (no login required)

```text
[ ] Open: http://localhost:3000/tracking/[reference-number]
[ ] GET /tracking/:reference → package status returned
[ ] Confirm tracking page shows status in plain language
[ ] Confirm it works without login (PublicRoute)
[ ] Test with an invalid reference → confirm error is human-readable
```

### Wall QR Intake (no login required)

Route: `http://localhost:3000/intake/[warehouse]`

| # | Step | API endpoint |
|---|---|---|
| 1 | Open intake page as customer (no login) | — |
| 2 | Validate form | `POST /public/receiving-intake/validate` |
| 3 | Customer name suggestion | `POST /public/receiving-intake/customer-suggestions` |
| 4 | Submit intake | `POST /public/receiving-intake` |
| 5 | Staff views intake tasks in Receive tab | `GET /receiving/intake` |
| 6 | Staff converts intake to receiving | `POST /receiving/intake/:id/convert` |
| 7 | Staff cancels intake | `POST /receiving/intake/:id/cancel` |

---

## Phase 16: Test Data Cleanup

```text
[ ] List all RR numbers created during sprint
[ ] List all trip numbers created during sprint
[ ] Soft-delete all test packages via Admin → Soft Delete
[ ] Cancel all test trips
[ ] Verify dashboard counts return to pre-sprint baseline
[ ] Clear NB80 offline queue (Device tab → Clear Queue)
[ ] Clear NB80 diagnostic logs (Device tab → Clear Logs)
[ ] If soft-delete unavailable for some records → flag as Deferred cleanup
[ ] Optional: npm run reset:clean to reset demo data to clean state
```

---

## Phase 17: Sprint Completion Criteria

The sprint is done when ALL are true:

```text
[ ] GET /health confirmed at sprint start
[ ] All 12 tabs opened and tested on MacBook
[ ] Login flow tested (email + password, staff code)
[ ] All role nav restrictions verified (5 demo URLs + Naga)
[ ] Every button tested — no untested button exists
[ ] Every UX issue Fixed or Deferred with reason + priority
[ ] Every error message plain language (no HTTP codes visible)
[ ] Camera unavailable fallback tested on NB80
[ ] POST /receiving direct path tested or confirmed dead
[ ] payments.verify, payments.void, payments.edit checked
[ ] loading.override tested
[ ] records.restore tested
[ ] Public tracking page tested
[ ] Pagination tested on at least one module
[ ] 58mm print output confirmed or deferred
[ ] auditLine in print template logged as Deferred P3
[ ] Fix log complete — no blank entries
[ ] staff-manual.md has all 17 chapters
[ ] Screenshot index complete and named
[ ] Before/After pairs for every fix
[ ] Error state library complete (at least one error per form)
[ ] Print preview screenshots for all 6 document types
[ ] Package status flow screenshots complete
[ ] Test data cleaned up
[ ] Final report written (Phase 18)
```

---

## Phase 18: Final Report

1. Pre-sprint readiness results
2. Environment record (build, APK, WebView URL, paper width, branch, roles tested)
3. QA records created
4. Fix log (every change, before/after, file + line)
5. Deferred items (priority + reason)
6. MacBook vs NB80 comparison table
7. Functional pass/fail per module
8. Print audit table (per document: auto-print, manual, reprint, 58mm vs 80mm)
9. Scanner audit (products/scan, barcodes/scan, barcodes/link, products create)
10. Login flow results
11. Public tracking results
12. Offline + sync state results
13. Error state library (before → after per module)
14. Language toggle results
15. Swipe navigation findings
16. Camera unavailable fallback results
17. Pagination findings
18. UX findings per screen
19. Workflow simplification log (tap count before → after)
20. Screenshot index
21. Sprint completion checklist
22. Recommended next sprint scope

---

## Decision Rules

### Functional

1. MacBook works, NB80 fails → **NB80 is truth. Fix for NB80.**
2. Print preview passes, no paper output → **print is broken. Fix or Defer P1.**
3. Final receiving save fails offline with no message → **P1. Fix immediately.**
4. Auto-print causes double-print with no cancel → **P1. Fix immediately.**
5. Sync badge does not update after reconnect → **P1. Staff cannot trust data.**
6. Swipe causes form data loss → **P1. Fix immediately.**
7. Scanner fires wrong endpoint → **Workflow Bug. Fix immediately.**
8. Tab missing for a role that needs it → **Permission Bug. Fix immediately.**
9. Error banner off-screen on NB80 → **UX P2. Fix CSS.**
10. Tagalog causes layout overflow → **Responsive CSS P2. Fix CSS.**
11. Login error message is an HTTP code → **UX P1. Fix immediately.**
12. Camera fallback crashes instead of showing message → **P1. Fix immediately.**
13. Pagination does not work on NB80 → **Workflow Bug P1.**
14. `payments.void` / `payments.verify` buttons exist but untested → **Test before closing.**

### UX

15. Button label requires computer knowledge → **UX: Confusing Label. P2 min. Fix label.**
16. Two buttons do the same thing → **UX: Redundant Button. P2 min. Remove one.**
17. Button spans full width with no hierarchy → **UX: Oversized Element. P3. Resize.**
18. Staff would ask "what does this mean?" → **UX: Not Staff-Friendly. P2 min. Rewrite.**
19. Next step after action is not obvious → **UX: Workflow Clarity. P1 if causes wrong action, P2 if causes confusion.**

### Simplification

20. Step count to complete a task > necessary minimum → **Simplify. Merge or remove.**
21. Field staff must type that app already knows → **Pre-fill it.**
22. Confirmation dialog after action that already showed success → **Remove dialog.**
23. Review screen with no editable fields → **Remove screen.**
