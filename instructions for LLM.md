# LinkedIn Jobs Tracker — LLM Rebuild Instructions

This document explains how this Chrome extension works, why certain architectural decisions were made, and how to quickly diagnose and fix it if LinkedIn changes their layout.

---

## What the extension does

Injects a small panel (status dropdown + rating select) into every job card on `linkedin.com/jobs`. Data is persisted in `chrome.storage.local`.

---

## Critical: LinkedIn's DOM structure (as of April 2026)

LinkedIn is a React SPA with **obfuscated/hashed CSS class names** (e.g. `_926bef42`) that change with every deploy. **Never use class names as selectors.** Use structural/semantic attributes instead.

### Left column (job list)

- Each job card is a `div[role="button"][componentkey]`
- The `componentkey` attribute is a **UUID** (e.g. `02ac819f-8ac2-4355-9bb8-e84f839a13c5`) — stable across re-renders of the same card
- There is **no numeric job ID** anywhere in the left card's DOM
- Each card contains a `button[aria-label^="Dismiss "]` — e.g. `"Dismiss Senior Backend Engineer job"`
  - Extract job title: `label.replace(/^Dismiss /, '').replace(/ job$/, '').trim()`
  - This is the most reliable signal that an element is a job card
- Company name: first `<p>` inside the card whose text is not the title, not metadata (no digits+time, no "applicant", no "·", no "Posted", length < 80)

### Right column (job detail panel)

- The job title is an `<a href="/jobs/view/{numericId}/">` link
- Numeric ID is extracted from that href: `/\/jobs\/view\/(\d+)/`
- Company name is in an `<a href*="/company/">` link inside the same container
- Container is found by walking up from the title `<a>` until a block containing `a[aria-label*="Apply"]` or `button[aria-label="Save the job"]` with height > 80px

---

## Storage key strategy

**Both columns must use the same storage key for the same job.**

The left column has no numeric job ID. The right column has one. Solution: use `hash(title + "||" + company)` as the key for **both sides**.

```
key = "ljt_h_" + simpleHash(normalizedTitle + "||" + normalizedCompany)
```

- Normalize text: `.trim().replace(/\s+/g, ' ')`
- The `<a>` link text in the right panel equals the dismiss button title in the left panel (verified)
- If title can't be extracted on the right panel, fall back to `ljt_{numericId}`

---

## Why panels disappear when clicking a card

When the user clicks a left-column card, LinkedIn **replaces the DOM element** with a new one (same `componentkey` UUID, but a new JS object). React reconciliation wipes injected children.

**Fix used:**
1. Store `componentkey → jobId` in a regular `Map` (not WeakMap — must survive element replacement)
2. In `processLeftCards`, **pass 1** queries `document.querySelector('[componentkey="UUID"]')` for every known key — this finds the element regardless of whether `role` or tag changed
3. **Pass 2** discovers new cards via `button[aria-label^="Dismiss "]` (walk up to card container)
4. Each card gets a dedicated `MutationObserver` watching `childList` — if panel is removed, re-injects after 150ms delay (gives React time to finish rendering)
5. `inject()` checks `card.isConnected` before and after the async `loadData` to avoid injecting into detached elements

---

## Live sync between left and right panels

When the user changes status/rating on one panel, the other panel must update immediately.

**Fix:** `chrome.storage.onChanged` listener finds all `.ljt-panel[data-ljt-id="key"]` elements and calls `panel._ljtSync({ status, rating })` on each. The `_ljtSync` method is attached to the panel DOM node inside `buildPanel` and has closure access to `curRating` and `sel`.

---

## Injection deduplication

- `compKeyToJobId`: `Map<string, string>` — componentkey UUID → jobId. Used to re-inject after element replacement without re-detecting from dismiss button.
- `watchedCards`: `WeakSet` — cards with per-card observers. Prevents duplicate observers.
- `injecting`: `Set` — cards currently mid-inject (awaiting async loadData). Prevents race conditions.
- `injectedJobIds`: `Set<string>` — right-panel numeric IDs. Prevents injecting multiple panels when many `/jobs/view/` links exist on the page.

---

## If LinkedIn changes the layout — diagnosis checklist

Run these in the browser console on `linkedin.com/jobs`:

```js
// 1. Are left cards still div[role="button"][componentkey]?
document.querySelectorAll('div[role="button"][componentkey]').length

// 2. Do they still have a dismiss button?
document.querySelector('div[role="button"][componentkey]')
  ?.querySelector('button[aria-label^="Dismiss "]')?.getAttribute('aria-label')

// 3. What does componentkey look like?
document.querySelector('div[role="button"][componentkey]')?.getAttribute('componentkey')

// 4. Does the right panel still have /jobs/view/ links?
document.querySelectorAll('a[href*="/jobs/view/"]').length

// 5. Does the right panel have a /company/ link for company name?
document.querySelector('a[href*="/company/"]')?.textContent
```

If any of these fail, update the selectors in `processLeftCards()` and `processRightPanel()` accordingly.

---

## File structure

```
linkedin-chrome-addon/
├── manifest.json        — MV3, storage permission, matches linkedin.com/jobs/*
├── content.js           — all logic (injection, storage, sync)
├── styles.css           — panel styles, status color classes
└── instructions for LLM.md  — this file
```

---

## Reloading after changes

1. Go to `chrome://extensions`
2. Click the reload icon on LinkedIn Jobs Tracker
3. Refresh the LinkedIn tab
