# LinkedIn Jobs Tracker

A Chrome Extension (Manifest V3) that adds status tracking, rating, and a dashboard to LinkedIn job cards.

## Features

- **Status tracking**: Mark each job as `None`, `To Apply`, `Seen`, `Applied`, or `Skip`
- **Rating**: Rate jobs from 0–5 ⭐
- **Color coding**: Blue for To Apply, Yellow for Seen, Green for Applied, Red for Skip
- **Dashboard**: Dedicated page with filtering, sorting, grouping, and stats
- **Background coloring**: Optional status-based background tint on left/right LinkedIn panels (configurable)
- **Persistent storage**: All data saved locally via `chrome.storage.local`
- **Dynamic injection**: Works with LinkedIn's infinite scroll via MutationObserver
- **Live sync**: Status changes sync instantly across all open panels

## File Structure

```
linkedin-chrome-addon/
├── manifest.json
├── options.js        # Shared status config (values, icons, colors, CSS keys)
├── content.js        # Injected into LinkedIn jobs pages
├── styles.css        # Styles for injected panels
├── background.js     # Service worker (opens dashboard on extension click)
├── dashboard.html    # Standalone dashboard page
├── dashboard.js      # Dashboard logic
├── dashboard.css     # Dashboard styles
└── README.md
```

## Installation

1. Open Chrome and navigate to `chrome://extensions`
2. Enable **Developer mode** (toggle in the top-right corner)
3. Click **Load unpacked**
4. Select this folder (`linkedin-chrome-addon/`)
5. Navigate to [linkedin.com/jobs](https://www.linkedin.com/jobs/) — panels appear automatically on each job card

## Usage

### On LinkedIn

Each job card gets a small inline panel:

| Element | Action |
|---|---|
| Status dropdown | Select `None` / `To Apply` / `Seen` / `Applied` / `Skip` |
| Rating (⭐) | Select 0–5 |

Changes save instantly and sync across panels in real time.

### Dashboard

Click the extension icon to open the dashboard. Features:

- **Stats bar** — counts per status (Total, To Apply, Applied, Seen, Skipped)
- **Search** — filter by title, company, location, or workplace
- **Filter by status** — show only a specific status
- **Sort** — by date, title, company, or rating
- **Group** — toggle grouping by status
- **Settings** — gear icon in the header, configure:
  - `Color left panel cards` — background tint on job cards in the search list
  - `Color right panel` — background tint on the job detail view

## Status Options

| Status | Icon | Color |
|---|---|---|
| None | — | none |
| To Apply | 🎯 | Blue |
| Seen | 👁 | Yellow |
| Applied | ✅ | Green |
| Skip | 🗑 | Red |

## Storage

Job data is stored in `chrome.storage.local`:

```json
{
  "ljt_idx__<title>||<company>||<location>||<workplace>": {
    "status": "Applied",
    "rating": 4,
    "seen_at": 1712345678901,
    "id": "4381854620",
    "title": "Lead Software Engineer",
    "company": "Acme Corp",
    "location": "New York, NY",
    "workplace": "remote"
  },
  "ljt_settings": {
    "colorLeft": false,
    "colorRight": false
  }
}
```

The key is a fingerprint: `title || company || location || workplace`. Settings are stored under `ljt_settings` and are excluded from the "Clear All" operation.

## Updating / Reloading

After editing any file, go to `chrome://extensions`, click the **reload** icon on the extension card, then refresh the LinkedIn tab.

## Clearing Data

To reset all tracked jobs from the DevTools console on any LinkedIn page:

```js
window.postMessage({ type: 'LJT_CLEAR' }, '*')
```

Or use the **Clear All** button in the dashboard (preserves settings).
