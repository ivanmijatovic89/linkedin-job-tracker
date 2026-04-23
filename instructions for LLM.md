# LinkedIn Jobs Tracker — LLM Rebuild / Debug Instructions (Current)

This file documents the **current** architecture after the job-id migration, company blacklist, and company/role counters.

---

## File overview

```
manifest.json          MV3 config — storage + tabs permissions, matches linkedin.com/jobs/*
options.js             Shared constants/config (statuses, key prefixes, blacklist helpers)
content.js             Injection, parsing, storage sync, panel UI, counters
styles.css             Styles for injected panel and left/right card states
background.js          Opens dashboard.html on extension icon click
dashboard.html         Dashboard page
dashboard.js           Dashboard data model + filters/sort/render/settings
dashboard.css          Dashboard styles
```

---

## options.js — shared constants

Status definitions are in `LJT_STATUS_OPTIONS`.

Key prefixes:
- `LJT_ID_PREFIX = 'ljt_id__'`
- `LJT_IDX_PREFIX = 'ljt_idx__'`
- `LJT_MAP_ID_PREFIX = 'ljt_map_id__'`
- `LJT_MAP_FP_PREFIX = 'ljt_map_fp__'`
- `LJT_BL_PREFIX = 'ljt_bl__'`

Blacklist helpers:
- `ljtNormalizeCompany(name)`
- `ljtBlacklistKey(company)`

---

## Storage model (important)

Primary job identity:
- `ljt_id__<jobId>` (preferred when numeric LinkedIn ID exists)

Compatibility identity:
- `ljt_idx__<title>||<company>||<location>||<workplace>` (fingerprint key)

Bridging keys:
- `ljt_map_id__<jobId> -> <fingerprintKey>`
- `ljt_map_fp__<fingerprintKey> -> <jobId>`

Blacklist entries:
- `ljt_bl__<normalized_company> -> { company, created_at }`

Settings:
- `ljt_settings -> { colorLeft, colorRight }`

Job payload may contain:
- `status`, `rating`
- `seen_at`, `seen_at_first`, `seen_at_last`
- `id`, `title`, `company`, `company_slug`, `location`, `workplace`

---

## content.js — behavior summary

### Key resolution

`resolvePrimaryKey({ fingerprintKey, jobNumericId })`:
- if `jobNumericId` exists -> `ljt_id__...`
- else if fingerprint maps to an id -> `ljt_id__...`
- else -> fingerprint key

`saveData(...)` writes compatible entries:
- primary key
- `ljt_id__...` when id available
- fingerprint key when available

### Left panel

- Detect cards via dismiss button (`button[aria-label^="Dismiss "]`) and `[componentkey]`.
- Parse title/company/location/workplace from left card text.
- On click, map clicked card to job id safely:
  - prefer id from clicked card href
  - URL `currentJobId`/`/jobs/view/` is fallback only
  - avoids leaking one id to unrelated cards

### Right panel

- Uses `/jobs/view/<id>` anchors to identify active job.
- Extracts:
  - numeric job id
  - company text
  - `company_slug` from `/company/<slug>/`
  - location/workplace
- `autoSeen`:
  - if status is `None` -> set `Seen`
  - updates `seen_at_last` (and legacy `seen_at`)
  - preserves `seen_at_first`

### Panel UI (both sides)

Panel includes:
- status select
- rating select
- blacklist select
- ID badge (`ID ...` / `NO ID`)
- counters:
  - `C:<total>=❌<skip>+✅<applied>` (company-level, strict slug)
  - `R:<total>` (same company + same title)

Counter rules:
- strict `company_slug` matching (no fallback)
- only `status != None`
- dedupe by `id` where possible

Layout:
- Left panel: `ID/C/R` on second row
- Right panel: inline

### Live sync

`chrome.storage.onChanged`:
- updates blacklist cache
- updates id<->fingerprint bridge maps
- calls `_ljtSync` on matching panels by key
- refreshes counter badges when job data changes

---

## Dashboard notes

`dashboard.js`:
- reads both `ljt_id__*` and `ljt_idx__*`
- ignores map keys and settings
- dedupes by `id` when available
- supports `company_slug`
- shows date+time
- company name links to LinkedIn company page when slug exists

Blacklist:
- separate section with search + unblacklist action

---

## DOM selector guidance (LinkedIn)

Avoid hashed classes; use semantic selectors:
- Left cards: `[componentkey]` + `button[aria-label^="Dismiss "]`
- Right job id: `a[href*="/jobs/view/"]`
- Company link: `a[href*="/company/"]`
- Apply container hints: `a[aria-label*="Apply"]` / `button[aria-label="Save the job"]`

---

## Quick debug checklist

Run on `linkedin.com/jobs`:

```js
document.querySelectorAll('[componentkey]').length
document.querySelectorAll('button[aria-label^="Dismiss "]').length
document.querySelectorAll('a[href*="/jobs/view/"]').length
document.querySelector('a[href*="/company/"]')?.getAttribute('href')
document.querySelectorAll('.ljt-panel').length
```

Storage sanity:

```js
chrome.storage.local.get(null, all => {
  console.log('id keys', Object.keys(all).filter(k => k.startsWith('ljt_id__')).length);
  console.log('idx keys', Object.keys(all).filter(k => k.startsWith('ljt_idx__')).length);
  console.log('map keys', Object.keys(all).filter(k => k.startsWith('ljt_map_')).length);
  console.log('blacklist', Object.keys(all).filter(k => k.startsWith('ljt_bl__')).length);
});
```

---

## Reload after edits

1. `chrome://extensions` -> Reload extension
2. Refresh LinkedIn jobs tab
