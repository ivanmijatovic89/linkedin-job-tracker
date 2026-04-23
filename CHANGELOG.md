# Changelog

All notable changes to this project are documented in this file.

## [1.1.0] - 2026-04-23

### Added
- Company blacklist system in LinkedIn panels and dashboard:
  - Per-company blacklist toggle in inline panel
  - Blacklisted visual treatment for cards
  - Dedicated blacklist section in dashboard with search and unblacklist action
- Company slug extraction from LinkedIn company URLs (`company_slug`) and storage support.
- Dashboard company links that open the LinkedIn company page when slug is available.
- Company and role counters in inline panels:
  - `C` for company-level tracked jobs
  - `R` for same-company same-role tracked jobs
  - Company badge compact display (`C:<total>=❌<skip>+✅<applied>`)
- Panel ID badge (`ID <jobId>` / `NO ID`) on LinkedIn job cards.
- Backup features in settings modal:
  - Export tracked jobs to JSON
  - Import jobs from JSON backup

### Changed
- Storage and identity model upgraded:
  - Primary key moved to `ljt_id__<jobId>` when available
  - Fingerprint compatibility retained via `ljt_idx__...`
  - Added bridge mappings `ljt_map_id__*` and `ljt_map_fp__*`
- Dashboard data model updated to read both ID and fingerprint keys and deduplicate correctly.
- Seen tracking upgraded to track both first and last seen timestamps:
  - `seen_at_first`
  - `seen_at_last`
  - legacy `seen_at` kept as compatibility alias
- Dashboard card timestamp display now includes date and time.

### Fixed
- Left/right panel sync issues caused by fingerprint mismatches across columns.
- Left panel save path now correctly uses resolved job ID for status/rating sync to right panel.
- Click/rekey logic hardened so one active job ID is not incorrectly applied to unrelated left cards.
- Dashboard duplicate rows for the same job were resolved after ID/fingerprint bridge changes.

