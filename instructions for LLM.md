# LinkedIn Jobs Tracker — LLM Rebuild / Debug Instructions

This document explains how the extension works under the hood, why certain architectural decisions were made, and how to quickly diagnose and fix it if LinkedIn changes their layout.

---

## File overview

```
manifest.json          MV3 config — storage + tabs permissions, matches linkedin.com/jobs/*
options.js             Shared status config — loaded before content.js via manifest
content.js             All injection, storage, sync logic on LinkedIn pages
styles.css             Styles for injected panels + card background tinting
background.js          Service worker — opens dashboard.html on extension icon click
dashboard.html         Standalone dashboard page (opened in new tab)
dashboard.js           Dashboard: filtering, sorting, grouping, settings modal
dashboard.css          Dashboard styles (dark theme)
```

---

## options.js — single source of truth for statuses

All status definitions live here. Both `content.js` and `dashboard.js` consume this.

```js
const LJT_STATUS_OPTIONS = [
  { value: 'None',     label: 'None',     icon: '',   cssKey: 'none',     color: null,       colorDim: null },
  { value: 'Seen',     label: 'Seen',     icon: '👁',  cssKey: 'seen',     color: '#f59e0b',  colorDim: 'rgba(245,158,11,0.12)' },
  { value: 'To Apply', label: 'To Apply', icon: '🎯',  cssKey: 'to-apply', color: '#3b82f6',  colorDim: 'rgba(59,130,246,0.12)' },
  { value: 'Applied',  label: 'Applied',  icon: '✅',  cssKey: 'applied',  color: '#34d399',  colorDim: 'rgba(52,211,153,0.12)' },
  { value: 'Skip',     label: 'Skip',     icon: '🗑',  cssKey: 'skip',     color: '#fb7185',  colorDim: 'rgba(251,113,133,0.12)' },
];
```

Helper functions also exported: `ljtStatusOption(value)`, `ljtStatusCssKey(value)`.

`options.js` is listed **before** `content.js` in `manifest.json` content_scripts so globals are available. In `dashboard.html` it is loaded via `<script src="options.js">` before `dashboard.js`.

To add a new status: add an entry to `LJT_STATUS_OPTIONS`, add CSS rules for `.ljt-s-{cssKey}` in `styles.css` and `.status-{cssKey}-*` in `dashboard.css`.

---

## Storage key strategy

**Both left and right panels must resolve to the same storage key for the same job.**

The left panel has no numeric job ID. The right panel has one. The solution is a **fingerprint key** built from normalised text fields:

```
ljt_idx__{title}||{company}||{location}||{workplace}
```

- All parts are `.trim().replace(/\s+/g, ' ').toLowerCase()`
- Title also strips "Verified job" and empty `()`
- If title or company is missing the key is empty (job skipped)
- When the right panel loads, it also stores the numeric `id` in the value so dashboard links work

**Special keys (not job data):**
- `ljt_settings` — user config `{ colorLeft: bool, colorRight: bool }`. Excluded from Clear All.

---

## content.js — architecture

### Boot sequence

1. `observer.observe(document.documentElement, { childList: true, subtree: true })` starts immediately
2. `chrome.storage.local.get('ljt_settings', ...)` loads config, then calls `scanAll()` (and again at 1.5s + 4s as fallback for slow LinkedIn renders)
3. `MutationObserver` debounces via `requestAnimationFrame` → `scanAll()` on every DOM change

### scanAll()

Calls three functions on every tick:
- `processLeftCards()` — injects panels into left job list
- `processRightPanel()` — injects panel into right job detail view
- `attachLeftCardClickListener()` — attaches click listener once (guarded by `clickListenerAttached` flag)

### processLeftCards() — two-pass design

**Pass 1** — re-checks all known `componentkey` UUIDs from `compKeyToJobId` Map. Finds the element by `document.querySelector('[componentkey="UUID"]')` — this works even after LinkedIn replaces the DOM node (same UUID, new object).

**Pass 2** — discovers new cards via `button[aria-label^="Dismiss "]`. Walks up the DOM to the card container (first ancestor with `height > 50 && width > 150`). Extracts job title from the button label: `label.replace(/^Dismiss /, '').replace(/ job$/, '')`.

Company and location are extracted from `<p>` elements inside the card — skipping the title line and "meta" lines (Viewed, Posted, Reposted, Applicants, Easy Apply, Promoted, Actively reviewing).

### processRightPanel()

Finds `a[href*="/jobs/view/{numericId}"]` links. For each unique numeric ID (deduplicated per scan via `seenThisScan`):
- Walks up from the anchor until finding a container with an Apply button (`a[aria-label*="Apply"]` or `button[aria-label="Save the job"]`) and `height > 80`
- Company found by walking up from anchor up to 10 levels, looking for `a[href*="/company/"]`
- Location/workplace extracted from all `p, span, li` text in the container
- Passes `autoSeen: true` and `panelSide: 'right'`

**Auto-Seen**: if `autoSeen: true` and job status is `'None'` or missing → automatically set to `'Seen'` and save. Never overwrites an existing non-None status.

### appendPanel() — the core injection function

```
loadData(jobId)
  → if autoSeen + status None → set status = 'Seen', save
  → else if meta present → save meta to storage (enriches key with id/title/company etc.)
  → check card still connected + no panel already
  → findTextContainer(card) → appendChild(buildPanel(...))
  → applyCardStatusClass(card, status, side)
  → watchCard(card, jobId, opts)
```

`findTextContainer(card)`: finds the direct child of card that contains the first `<p>` — this is the text column (not the logo column).

### buildPanel()

Creates `div.ljt-panel` with:
- `data-ljt-id` = storage key
- `data-ljt-fp` = fingerprint key (if available)
- Status `<select>` with options from `LJT_STATUS_OPTIONS` (icons prepended to labels)
- Rating `<select>` 0–5 ⭐
- Event stoppers on all pointer/click events to prevent card navigation when interacting with dropdowns
- `panel._ljtSync({ status, rating, seen_at })` — method attached to DOM node; called by storage listener for cross-panel live sync

Accepts `onStatusChange` callback — called on select change and in `_ljtSync` to update card background tinting.

### Injection deduplication guards

| Guard | Type | Purpose |
|---|---|---|
| `injecting` | `Set` | Cards currently mid-inject (async loadData). Prevents race. |
| `compKeyToJobId` | `Map<string,string>` | componentkey UUID → jobId. Survives element replacement. |
| `watchedCards` | `WeakSet` | Cards with MutationObserver. Prevents duplicate observers. |
| `injectedJobIds` | `Set<string>` | Right-panel numeric IDs. Prevents multi-inject when many `/jobs/view/` links exist. |

### watchCard() — re-injection on LinkedIn re-renders

Each injected card gets a `MutationObserver` on `childList`. If our `.ljt-panel` disappears (React reconciliation wipes injected children), re-injects after 150ms delay to let LinkedIn finish rendering.

### applyCardStatusClass()

Adds `ljt-card-{cssKey}` to the correct element for background tinting:
- **left** side: walks up to `closest('[componentkey]')` (the outermost card root)
- **right** side: uses the container directly (it has no `[componentkey]`)

Stores `data-ljt-side` and `data-ljt-status` on the target so the settings change handler can re-apply/remove without re-injection.

Only applies the class if `ljtConfig.colorLeft` / `ljtConfig.colorRight` is `true`. Default is `false` (both off).

### Config / settings

`ljtConfig = { colorLeft: false, colorRight: false }` is module-level.

Loaded from `chrome.storage.local` (`ljt_settings` key) before first scan.

`chrome.storage.onChanged` handler updates `ljtConfig` immediately and walks all `[data-ljt-side]` elements to toggle `ljt-card-*` classes — live, no reload needed.

### Live sync between panels

`chrome.storage.onChanged` finds all `.ljt-panel[data-ljt-id="key"]` elements and calls `panel._ljtSync(newValue)`. The method has closure access to the select elements and `curRating`, so it updates the UI without re-injecting.

---

## CSS class naming conventions

| Class | Where | Meaning |
|---|---|---|
| `.ljt-panel` | content | Injected panel container |
| `.ljt-select` | content | Status and rating selects |
| `.ljt-s-{cssKey}` | content | Status color on the select element |
| `.ljt-card-{cssKey}` | content | Background tint on the card/container |
| `.status-{cssKey}` | dashboard | Job card row color |
| `.status-{cssKey}-pill` | dashboard | Status badge |
| `.status-{cssKey}-header` | dashboard | Group header in grouped view |
| `.stat-{cssKey}` | dashboard | Stat card (Total, To Apply, Applied, Seen, Skip) |

`cssKey` values: `none`, `to-apply`, `seen`, `applied`, `skip` — from `options.js`.

---

## LinkedIn DOM structure (April 2026)

LinkedIn uses **obfuscated/hashed CSS class names** that change with every deploy. **Never use class names as selectors.** Use structural/semantic attributes.

### Left column (job list)

- Each job card has a `[componentkey]` attribute — a stable UUID (e.g. `02ac819f-8ac2-4355-9bb8-e84f839a13c5`)
- Contains `button[aria-label^="Dismiss "]` — most reliable signal that an element is a job card
- No numeric job ID in the left card DOM

### Right column (job detail)

- Job title: `a[href*="/jobs/view/{numericId}"]`
- Numeric ID from href: `/\/jobs\/view\/(\d+)/`
- Company: `a[href*="/company/"]`
- Apply button: `a[aria-label*="Apply"]` or `button[aria-label="Save the job"]`

---

## Diagnosis checklist if the extension stops working

Run in browser console on `linkedin.com/jobs`:

```js
// 1. Are left cards still using componentkey?
document.querySelectorAll('[componentkey]').length

// 2. Do they still have a dismiss button?
document.querySelector('[componentkey]')
  ?.querySelector('button[aria-label^="Dismiss "]')?.getAttribute('aria-label')

// 3. Does the right panel have /jobs/view/ links?
document.querySelectorAll('a[href*="/jobs/view/"]').length

// 4. Does the right panel have a company link?
document.querySelector('a[href*="/company/"]')?.textContent

// 5. Is the panel actually injected?
document.querySelectorAll('.ljt-panel').length
```

If selectors 1–4 fail, update `processLeftCards()` and `processRightPanel()` accordingly. If 5 is 0 but 1–4 pass, check `buildFingerprintKey()` — it returns `''` if title or company is empty, which silently skips injection.

---

## Reloading after changes

1. `chrome://extensions` → click reload icon on the extension
2. Refresh the LinkedIn tab
