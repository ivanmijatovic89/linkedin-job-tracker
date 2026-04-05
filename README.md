# LinkedIn Jobs Tracker

A Chrome Extension (Manifest V3) that adds status tracking and rating to LinkedIn job cards.

## Features

- **Status tracking**: Mark each job as `None`, `Seen`, `Applied`, or `Skipped`
- **Rating**: Rate jobs from 0–5 ⭐
- **Color coding**: Green for Applied, Red for Skipped, Gray for Seen
- **Persistent storage**: All data saved locally via `chrome.storage.local`
- **Dynamic injection**: Works with LinkedIn's infinite scroll via MutationObserver

## File Structure

```
linkedin-chrome-addon/
├── manifest.json
├── content.js
├── styles.css
└── README.md
```

## Installation

1. Open Chrome and navigate to `chrome://extensions`
2. Enable **Developer mode** (toggle in the top-right corner)
3. Click **Load unpacked**
4. Select this folder (`linkedin-chrome-addon/`)
5. Navigate to [linkedin.com/jobs](https://www.linkedin.com/jobs/) — the panels appear automatically on each job card

## Usage

Each job card gets a small inline panel at the bottom:

| Element | Action |
|---|---|
| Status dropdown | Select `None` / `Seen` / `Applied` / `Skipped` |
| Rating (⭐) | Select 0–5 |

Changes save instantly. Data persists across page reloads and browser restarts.

## Storage

Data is stored in `chrome.storage.local` with this shape:

```json
{
  "ljt_idx__<title>||<company>||<location>||<workplace>": {
    "status": "Applied",
    "rating": 4,
    "id": "4381854620",
    "title": "Lead Software Engineer AI - (Materia AI)",
    "company": "Thomson Reuters",
    "location": "New York, NY",
    "workplace": "remote"
  }
}
```

The key is a fingerprint built from: job title + company + location + workplace type. The value also stores those fields (plus numeric job id when available) to make later dashboards easier.

## Updating / Reloading

After editing any file, go to `chrome://extensions` and click the **reload** icon on the extension card, then refresh the LinkedIn tab.

## Clearing Data

To reset all tracked jobs, open the Chrome DevTools console on any LinkedIn page and run:

```js
window.postMessage({ type: 'LJT_CLEAR' }, '*')
```
