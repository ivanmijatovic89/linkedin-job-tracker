# LinkedIn Jobs Tracker

A Chrome Extension (Manifest V3) that adds status tracking and rating directly to LinkedIn job cards — so you can manage your entire job search without leaving the page.

![LinkedIn Search](screenshots/linkedin-search.png)

## The Problem with LinkedIn Job Search

Every day you open LinkedIn, run your search, and get the same 80 jobs you already went through yesterday — mixed in with 5 new ones. There's no way to tell which is which.

And when a job doesn't fit? There's no way to mark it. No "not interested," no "skip" — it just keeps coming back, every single search, every single day.

You end up re-reading the same listings over and over, wasting time on jobs you already decided against.

## How LinkedIn Job Tracker Fixes This

The idea is simple: go through your search results once and mark every job with a status. From then on, anything without a status is new.

**A typical workflow:**

1. Set up your search with the right filters — for example:
   - *AI Agent · Remote · Posted last week · United States*
   - *AI Agent · Remote · Posted last week · Europe*
2. Go through all results (say 80 jobs) and mark each one — **To Apply**, **Skip**, **Seen**, or **Applied**
3. Come back tomorrow — every untagged card is a job you haven't seen yet

You stop re-reading jobs you've already dismissed. You spend your time only on what's actually new.

---

## Features

- **Inline status panel** on every job card — set status and rating without opening a new tab
- **5 statuses**: None, 🎯 To Apply, 👁 Seen, ✅ Applied, 🗑 Skip — each with a distinct color
- **Star rating** — rate jobs 0–5 from within the card
- **Company blacklist** — mark/unmark companies directly from panels; blacklisted cards get a dedicated visual style and dashboard section
- **Stable job identity with `jobId`** — sync uses `ljt_id__<jobId>` as primary key with fingerprint compatibility
- **Company intelligence badges in panels**:
  - `C:<total>=❌<skip>+✅<applied>` for the same company (`company_slug`)
  - `R:<total>` for same company + same role (`title`), with detailed breakdown in tooltip
- **Company slug extraction** — stores `company_slug` from LinkedIn company URL
- **Dashboard** — dedicated page with search, filtering, sorting, grouping, and stats
- **Dashboard company links** — when `company_slug` exists, company name links to LinkedIn company page
- **Seen timestamps** — tracks both first seen and last seen; dashboard sort uses last seen
- **Optional background tinting** — color-code job cards and detail panels by status (off by default, toggle in Settings)
- **Live sync** — status changes reflect instantly across all open panels
- **Persistent storage** — all data saved locally via `chrome.storage.local`, no account needed

---

## Installation

1. Clone or download this repo
2. Open Chrome → `chrome://extensions`
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked** and select this folder
5. Go to [linkedin.com/jobs](https://www.linkedin.com/jobs/) — panels appear automatically

---

## How It Works

### On LinkedIn

Each job card gets a small inline panel with:
- **status dropdown**
- **star rating**
- **company blacklist toggle**
- **ID badge** (`ID <jobId>` / `NO ID`)
- **company/role counters** (`C` and `R`)

| Status | Icon | Meaning |
|---|---|---|
| None | — | Not yet reviewed |
| Seen | 👁 | Reviewed, no decision yet |
| To Apply | 🎯 | Flagged to apply later |
| Applied | ✅ | Application submitted |
| Skip | 🗑 | Not interested |

Changes save instantly.

> **Auto-Seen:** When you click a job and the right-side detail panel loads, if the job has no status (or `None`), it is automatically marked as **👁 Seen** and saved. Jobs that already have a status are never overwritten by this.
>
> Auto-Seen also updates **last seen** so "Newest first" reflects recent opens.

### Dashboard

Click the extension icon to open the dashboard:

![Dashboard](screenshots/dashboard.png)

- **Stats bar** — live counts per status
- **Search** — filter by title, company, location, or workplace
- **Filter by status** — show only jobs with a specific status
- **Sort** — newest, oldest, title, company, or rating
- **Group** — toggle grouping by status
- **Company links** — company names are clickable when slug is available
- **Seen date/time** — cards show date and time
- **Company blacklist section** — searchable list with quick unblacklist action
- **Settings** (⚙ gear icon) — configure background color tinting and data management:
  - *Color left panel cards* — background tint on job cards in the search list
  - *Color right panel* — background tint on the job detail view
  - *Export Jobs* — downloads all tracked jobs as a dated JSON file (e.g. `job-tracker-backup-2026-04-23.json`)
  - *Import Jobs* — restores jobs from a backup file; merges with existing data (existing jobs not in the file are kept, overlapping keys are overwritten by the backup)
  - *Clear All* — permanently removes all tracked jobs

---

## File Structure

```
linkedin-chrome-addon/
├── manifest.json         # Extension config (MV3)
├── options.js            # Shared status config — values, icons, colors, CSS keys
├── content.js            # Injected into LinkedIn jobs pages
├── styles.css            # Styles for injected panels
├── background.js         # Service worker — opens dashboard on extension click
├── dashboard.html        # Dashboard page
├── dashboard.js          # Dashboard logic
├── dashboard.css         # Dashboard styles
└── screenshots/
    ├── linkedin-search.png
    └── dashboard.png
```

---

## Storage Schema

All data is stored in `chrome.storage.local`.

Job data now uses:
- **Primary key:** `ljt_id__<jobId>` (when LinkedIn job ID is known)
- **Compatibility key:** `ljt_idx__<title>||<company>||<location>||<workplace>`
- **Bridge maps:** `ljt_map_id__<jobId>` and `ljt_map_fp__<fingerprintKey>`
- **Blacklist keys:** `ljt_bl__<normalized_company>`

```json
{
  "ljt_id__4405246964": {
    "status": "Applied",
    "rating": 4,
    "seen_at": 1712345678901,
    "seen_at_first": 1712300000000,
    "seen_at_last": 1712345678901,
    "id": "4405246964",
    "title": "Lead Software Engineer",
    "company": "Acme Corp",
    "company_slug": "acme-corp",
    "location": "New York, NY",
    "workplace": "remote"
  },
  "ljt_idx__lead software engineer||acme corp||new york, ny||remote": {
    "status": "Applied",
    "rating": 4,
    "seen_at": 1712345678901,
    "seen_at_first": 1712300000000,
    "seen_at_last": 1712345678901,
    "id": "4405246964",
    "title": "Lead Software Engineer",
    "company": "Acme Corp",
    "company_slug": "acme-corp",
    "location": "New York, NY",
    "workplace": "remote"
  },
  "ljt_map_id__4405246964": "ljt_idx__lead software engineer||acme corp||new york, ny||remote",
  "ljt_map_fp__ljt_idx__lead software engineer||acme corp||new york, ny||remote": "4405246964",
  "ljt_bl__acme corp": {
    "company": "Acme Corp",
    "created_at": 1712340000000
  },
  "ljt_settings": {
    "colorLeft": false,
    "colorRight": false
  }
}
```

Settings are stored under `ljt_settings` and are excluded from the **Clear All** operation.

---

## Clearing Data

Use the **Clear All** button in the dashboard Settings modal, or run this in the Chrome DevTools console on any LinkedIn page:

```js
window.postMessage({ type: 'LJT_CLEAR' }, '*')
```

---

## Reloading After Edits

After editing any file:
1. Go to `chrome://extensions`
2. Click the **reload** icon on the extension card
3. Refresh the LinkedIn tab
