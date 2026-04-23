(() => {
  'use strict';

  // STATUS_OPTIONS are defined in options.js (loaded first via manifest)

  // ── Config ────────────────────────────────────────────────────────────────
  let ljtConfig = { colorLeft: false, colorRight: false };
  const DEFAULT_DATA = { status: 'None', rating: 0 };

  // ── Blacklist cache ───────────────────────────────────────────────────────
  const blacklistSet = new Set();
  const jobIdToFp = new Map(); // "4404274683" -> "ljt_idx__..."
  const fpToJobId = new Map(); // "ljt_idx__..." -> "4404274683"

  function isBlacklisted(company) {
    if (!company) return false;
    return blacklistSet.has(ljtNormalizeCompany(company));
  }

  function reapplyAllBlacklistClasses() {
    document.querySelectorAll('[data-ljt-side]').forEach(el => {
      const side = el.dataset.ljtSide;
      const status = el.dataset.ljtStatus || 'None';
      const company = el.dataset.ljtCompany || '';
      applyCardStatusClass(el, status, side, company, /*targetIsAlready=*/ true);
      const panel = el.querySelector('.ljt-panel');
      panel?._ljtSyncBlacklist?.();
    });
  }

  // ── Utilities ─────────────────────────────────────────────────────────────

  function normalizeText(str) {
    return (str || '').trim().replace(/\s+/g, ' ');
  }

  function normalizeKeyPart(str) {
    return normalizeText(str).toLowerCase();
  }

  function cleanTitleText(text) {
    let t = normalizeText(text);
    t = t.replace(/verified job/ig, '');
    t = t.replace(/\(\s*\)/g, '');
    return normalizeText(t);
  }

  function extractWorkplaceFromText(text) {
    if (!text) return '';
    const t = text.toLowerCase();
    if (t.includes('remote')) return 'remote';
    if (t.includes('hybrid')) return 'hybrid';
    if (t.includes('on-site') || t.includes('on site') || t.includes('onsite')) return 'on-site';
    return '';
  }

  function isWorkplaceOnly(text) {
    const t = normalizeText(text).toLowerCase();
    return t === 'remote' || t === 'hybrid' || t === 'on-site' || t === 'on site' || t === 'onsite';
  }

  function extractWorkplaceFromTitle(title) {
    return extractWorkplaceFromText(title);
  }

  function extractWorkplaceFromContainer(container) {
    const pills = [...container.querySelectorAll('button, span, li, div')]
      .map(el => normalizeText(el.textContent))
      .filter(Boolean);
    for (const t of pills) {
      const wp = extractWorkplaceFromText(t);
      if (wp) return wp;
    }
    return '';
  }

  function stripBullets(text) {
    return text.split('·')[0].trim();
  }

  function parseLocationAndWorkplace(text) {
    const workplace = extractWorkplaceFromText(text);
    const location = text.replace(/\([^)]*\)/g, '').trim();
    return { location, workplace };
  }

  function buildFingerprintKey(title, company, location, workplace) {
    const t = normalizeKeyPart(cleanTitleText(title));
    const c = normalizeKeyPart(company);
    const l = normalizeKeyPart(location);
    const w = normalizeKeyPart(workplace);
    if (!t || !c) return '';
    return `${LJT_IDX_PREFIX}${t}||${c}||${l}||${w}`;
  }

  function buildMeta({ id, title, company, company_slug, location, workplace }) {
    const meta = {};
    if (id) meta.id = id;
    if (title) meta.title = title;
    if (company) meta.company = company;
    if (company_slug) meta.company_slug = company_slug;
    if (location) meta.location = location;
    if (workplace) meta.workplace = workplace;
    return meta;
  }

  function extractCompanySlugFromHref(href) {
    if (!href) return '';
    let path = String(href).trim();
    try {
      path = new URL(path, location.origin).pathname;
    } catch (_) {
      // fallback for malformed values
    }
    const m = path.match(/\/company\/([^/?#]+)/i);
    return m ? normalizeKeyPart(decodeURIComponent(m[1])) : '';
  }

  // ── Storage ───────────────────────────────────────────────────────────────

  function jobIdKey(jobNumericId) {
    return jobNumericId ? `${LJT_ID_PREFIX}${jobNumericId}` : '';
  }

  function mapIdKey(jobNumericId) {
    return jobNumericId ? `${LJT_MAP_ID_PREFIX}${jobNumericId}` : '';
  }

  function mapFpKey(fingerprintKey) {
    return fingerprintKey ? `${LJT_MAP_FP_PREFIX}${fingerprintKey}` : '';
  }

  function getJobIdFromStorageKey(key) {
    if (!key || !key.startsWith(LJT_ID_PREFIX)) return '';
    return key.slice(LJT_ID_PREFIX.length);
  }

  function readJobIdFromUrl(url = location.href) {
    const raw = String(url || '');
    const mPath = raw.match(/\/jobs\/view\/(\d+)/);
    if (mPath) return mPath[1];
    try {
      const u = new URL(raw, location.origin);
      const q = u.searchParams.get('currentJobId') || '';
      const mQuery = q.match(/^(\d+)$/);
      if (mQuery) return mQuery[1];
    } catch (_) {
      // ignore parse errors and fall through
    }
    return '';
  }

  function extractJobIdFromHref(href) {
    if (!href) return '';
    const m = String(href).match(/\/jobs\/view\/(\d+)/);
    return m ? m[1] : '';
  }

  function extractJobIdFromCard(card) {
    const anchor = card?.querySelector?.('a[href*="/jobs/view/"]');
    if (!anchor) return '';
    return extractJobIdFromHref(anchor.getAttribute('href'));
  }

  function resolvePrimaryKey({ fingerprintKey = '', jobNumericId = '' } = {}) {
    if (jobNumericId) return jobIdKey(jobNumericId);
    if (fingerprintKey) {
      const mappedId = fpToJobId.get(fingerprintKey);
      if (mappedId) return jobIdKey(mappedId);
    }
    return fingerprintKey;
  }

  function upsertJobLink(jobNumericId, fingerprintKey) {
    if (!jobNumericId || !fingerprintKey) return;
    const prevFp = jobIdToFp.get(jobNumericId) || '';
    const prevId = fpToJobId.get(fingerprintKey) || '';
    jobIdToFp.set(jobNumericId, fingerprintKey);
    fpToJobId.set(fingerprintKey, jobNumericId);
    if (prevFp === fingerprintKey && prevId === jobNumericId) return;
    chrome.storage.local.set({
      [mapIdKey(jobNumericId)]: fingerprintKey,
      [mapFpKey(fingerprintKey)]: jobNumericId,
    });
  }

  function isJobDataKey(key) {
    return key.startsWith(LJT_ID_PREFIX) || key.startsWith(LJT_IDX_PREFIX);
  }

  function loadData(primaryKey, { fingerprintKey = '', jobNumericId = '' } = {}) {
    const keys = [];
    const push = k => {
      if (!k || keys.includes(k)) return;
      keys.push(k);
    };

    push(primaryKey);
    if (jobNumericId) {
      push(jobIdKey(jobNumericId));
      push(jobIdToFp.get(jobNumericId));
    }
    if (fingerprintKey) {
      push(fingerprintKey);
      const mappedId = fpToJobId.get(fingerprintKey);
      if (mappedId) push(jobIdKey(mappedId));
    }

    if (!keys.length) return Promise.resolve({ ...DEFAULT_DATA });

    return new Promise(resolve => {
      chrome.storage.local.get(keys, res => {
        const hitKey = keys.find(k => !!res[k]);
        if (!hitKey) {
          resolve({ ...DEFAULT_DATA });
          return;
        }
        const found = res[hitKey];
        if (isJobDataKey(hitKey)) {
          const hitJobId = getJobIdFromStorageKey(hitKey);
          if (hitJobId && fingerprintKey) upsertJobLink(hitJobId, fingerprintKey);
        }
        resolve(found ?? { ...DEFAULT_DATA });
      });
    });
  }

  function saveData(primaryKey, value, meta = null, { fingerprintKey = '', jobNumericId = '' } = {}) {
    const payload = meta ? { ...value, ...meta } : value;
    const writes = {};
    const effectiveJobId = jobNumericId || meta?.id || '';
    const idKey = jobIdKey(effectiveJobId);
    const primary = primaryKey || idKey || fingerprintKey;

    if (!primary) return;
    writes[primary] = payload;
    if (idKey && idKey !== primary) writes[idKey] = payload;
    if (fingerprintKey && fingerprintKey !== primary) writes[fingerprintKey] = payload;

    chrome.storage.local.set(writes);
    upsertJobLink(effectiveJobId, fingerprintKey);
  }

  // Allow manual clear from page console:
  // window.postMessage({ type: 'LJT_CLEAR' }, '*')
  window.addEventListener('message', e => {
    if (e.source !== window) return;
    if (e.data?.type !== 'LJT_CLEAR') return;
    chrome.storage.local.get(null, all => {
      const toRemove = Object.keys(all).filter(k => k.startsWith('ljt_'));
      if (toRemove.length) chrome.storage.local.remove(toRemove);
      console.log('[LJT] cleared', toRemove.length, 'keys');
    });
  });

  // Sync all panels with the same jobId when storage changes (cross-panel live update)
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;

    // Handle settings changes — re-apply or remove card background colors
    if (changes['ljt_settings']) {
      ljtConfig = { colorLeft: true, colorRight: true, ...(changes['ljt_settings'].newValue || {}) };
      reapplyAllBlacklistClasses();
    }

    // Handle blacklist changes — update local set and reapply classes on all visible cards
    let blacklistTouched = false;
    Object.entries(changes).forEach(([key, { newValue }]) => {
      if (!key.startsWith(LJT_BL_PREFIX)) return;
      blacklistTouched = true;
      const norm = key.slice(LJT_BL_PREFIX.length);
      if (newValue) blacklistSet.add(norm);
      else blacklistSet.delete(norm);
    });
    if (blacklistTouched) reapplyAllBlacklistClasses();

    // Keep in-memory id<->fingerprint bridge in sync with storage updates
    Object.entries(changes).forEach(([key, { newValue }]) => {
      if (key.startsWith(LJT_MAP_ID_PREFIX)) {
        const jobNumericId = key.slice(LJT_MAP_ID_PREFIX.length);
        if (newValue) jobIdToFp.set(jobNumericId, String(newValue));
        else jobIdToFp.delete(jobNumericId);
        return;
      }
      if (key.startsWith(LJT_MAP_FP_PREFIX)) {
        const fingerprintKey = key.slice(LJT_MAP_FP_PREFIX.length);
        if (newValue) fpToJobId.set(fingerprintKey, String(newValue));
        else fpToJobId.delete(fingerprintKey);
      }
    });

    Object.entries(changes).forEach(([key, { newValue }]) => {
      if (!newValue) return;
      if (key.startsWith(LJT_BL_PREFIX)) return;
      if (key.startsWith(LJT_MAP_ID_PREFIX) || key.startsWith(LJT_MAP_FP_PREFIX)) return;
      if (!isJobDataKey(key)) return;
      document.querySelectorAll(`.ljt-panel[data-ljt-id="${CSS.escape(key)}"]`).forEach(panel => {
        panel._ljtSync?.(newValue);
      });
    });

    const jobDataTouched = Object.keys(changes).some(k => isJobDataKey(k));
    if (jobDataTouched) {
      document.querySelectorAll('.ljt-panel').forEach(panel => {
        panel._ljtRefreshCounts?.();
      });
    }
  });

  // ── UI builder ────────────────────────────────────────────────────────────

  function renderStars(wrap, active, preview = false) {
    wrap.querySelectorAll('.ljt-star').forEach(s => {
      const v = +s.dataset.v;
      s.classList.toggle('ljt-star--on', v <= active);
      s.classList.toggle('ljt-star--preview', preview && v <= active);
    });
  }

  function buildPanel(jobId, { status, rating, seen_at, seen_at_first, seen_at_last } = {}, { readOnly = false, fingerprintKey = '', jobNumericId = '', meta = null, onStatusChange = null, company = '', companySlug = '', roleTitle = '', panelSide = 'right' } = {}) {
    const safeStatus = status || 'None';
    const safeRating = Number.isFinite(rating) ? rating : 0;
    const panel = document.createElement('div');
    panel.className = 'ljt-panel';
    panel.classList.add(panelSide === 'left' ? 'ljt-panel-left' : 'ljt-panel-right');
    panel.setAttribute('data-ljt-id', jobId);
    if (fingerprintKey) panel.setAttribute('data-ljt-fp', fingerprintKey);

    const sel = document.createElement('select');
    sel.className = `ljt-select ljt-s-${ljtStatusCssKey(safeStatus)}`;
    if (readOnly) sel.disabled = true;
    LJT_STATUS_OPTIONS.forEach(opt => {
      const o = document.createElement('option');
      o.value = opt.value;
      o.textContent = opt.icon ? `${opt.icon} ${opt.label}` : opt.label;
      if (opt.value === safeStatus) o.selected = true;
      sel.appendChild(o);
    });

    const ratingSel = document.createElement('select');
    ratingSel.className = 'ljt-select ljt-rating';
    if (readOnly) ratingSel.disabled = true;
    for (let i = 0; i <= 5; i++) {
      const o = document.createElement('option');
      o.value = String(i);
      o.textContent = i === 0 ? '? ⭐' : `${i} ⭐`;
      if (i === safeRating) o.selected = true;
      ratingSel.appendChild(o);
    }

    panel.appendChild(sel);
    panel.appendChild(ratingSel);

    // Blacklist select — per-company toggle (select so change event isn't blocked by panel capture handler)
    const blSel = document.createElement('select');
    blSel.className = 'ljt-select ljt-bl-select';
    if (readOnly || !company) blSel.disabled = true;
    const OPT_OK = document.createElement('option');
    OPT_OK.value = 'ok';
    OPT_OK.textContent = '🏢 Company';
    const OPT_BL = document.createElement('option');
    OPT_BL.value = 'bl';
    OPT_BL.textContent = '🚫 Blacklisted';
    blSel.appendChild(OPT_OK);
    blSel.appendChild(OPT_BL);

    const renderBlSel = () => {
      const on = isBlacklisted(company);
      blSel.value = on ? 'bl' : 'ok';
      blSel.classList.toggle('ljt-bl-select--on', on);
      blSel.title = company
        ? (on ? `Blacklisted: "${company}"` : `Mark "${company}" as blacklisted`)
        : 'Company not detected';
    };
    renderBlSel();
    panel.appendChild(blSel);
    panel._ljtSyncBlacklist = renderBlSel;

    // ID/C/R badges host:
    // - left panel: move badges to the second row
    // - right panel: keep badges inline
    const badgesHost = panelSide === 'left'
      ? (() => {
        const row = document.createElement('div');
        row.className = 'ljt-badges-row';
        panel.appendChild(row);
        return row;
      })()
      : panel;

    // Small ID badge on panel ("ID 123..." / "NO ID")
    const idBadge = document.createElement('span');
    idBadge.className = 'ljt-job-id';
    let resolvedJobNumericId = String(jobNumericId || meta?.id || getJobIdFromStorageKey(jobId) || '').trim();
    const initialId = resolvedJobNumericId;
    const renderIdBadge = (idValue) => {
      const normalized = String(idValue || '').trim();
      const hasId = /^\d+$/.test(normalized);
      if (hasId) resolvedJobNumericId = normalized;
      idBadge.classList.toggle('ljt-job-id--on', hasId);
      idBadge.classList.toggle('ljt-job-id--off', !hasId);
      idBadge.textContent = hasId ? `ID ${normalized}` : 'NO ID';
      idBadge.title = hasId ? `LinkedIn Job ID: ${normalized}` : 'LinkedIn Job ID not available';
    };
    renderIdBadge(initialId);
    badgesHost.appendChild(idBadge);

    // Company counters (strict slug-only, statuses != None)
    let resolvedCompanySlug = normalizeKeyPart(companySlug || meta?.company_slug || '');
    let resolvedRoleTitle = normalizeText(roleTitle || meta?.title || '');
    const companyCountBadge = document.createElement('span');
    companyCountBadge.className = 'ljt-count-badge ljt-count-badge--company';
    const roleCountBadge = document.createElement('span');
    roleCountBadge.className = 'ljt-count-badge ljt-count-badge--role';
    badgesHost.appendChild(companyCountBadge);
    badgesHost.appendChild(roleCountBadge);

    const renderCountsBadges = (companyCount, roleCount, hasSlug, hasRole, companyStats, roleStats) => {
      const off = !hasSlug;
      companyCountBadge.classList.toggle('ljt-count-badge--off', off);
      roleCountBadge.classList.toggle('ljt-count-badge--off', off || !hasRole);
      companyCountBadge.textContent = hasSlug ? `C:${companyCount}` : 'C:-';
      if (hasSlug) {
        companyCountBadge.textContent = `C:${companyCount}=❌${companyStats.skip}+✅${companyStats.applied}`;
      }
      roleCountBadge.textContent = (hasSlug && hasRole) ? `R:${roleCount}` : 'R:-';
      companyCountBadge.title = hasSlug
        ? `Tracked jobs (status != None) in company slug "${resolvedCompanySlug}": ${companyCount} (Skip:${companyStats.skip}, Applied:${companyStats.applied}, Seen:${companyStats.seen}, To Apply:${companyStats.toApply})`
        : 'Company slug missing';
      roleCountBadge.title = (hasSlug && hasRole)
        ? `Tracked jobs (status != None) with same company+title: ${roleCount} (Seen:${roleStats.seen}, To Apply:${roleStats.toApply}, Applied:${roleStats.applied}, Skip:${roleStats.skip})`
        : 'Role counter unavailable';
    };

    const refreshCounts = () => {
      const hasSlug = !!resolvedCompanySlug;
      const hasRole = !!resolvedRoleTitle;
      const emptyStats = { seen: 0, toApply: 0, applied: 0, skip: 0 };
      if (!hasSlug) {
        renderCountsBadges(0, 0, false, hasRole, emptyStats, emptyStats);
        return;
      }
      chrome.storage.local.get(null, all => {
        let companyCount = 0;
        let roleCount = 0;
        const companyStats = { seen: 0, toApply: 0, applied: 0, skip: 0 };
        const roleStats = { seen: 0, toApply: 0, applied: 0, skip: 0 };
        const seenIdentity = new Set();
        const addStat = (stats, status) => {
          if (status === 'Seen') stats.seen += 1;
          else if (status === 'To Apply') stats.toApply += 1;
          else if (status === 'Applied') stats.applied += 1;
          else if (status === 'Skip') stats.skip += 1;
        };
        Object.entries(all).forEach(([key, val]) => {
          if (!isJobDataKey(key)) return;
          if (!val || !val.status || val.status === 'None') return;
          const slug = normalizeKeyPart(val.company_slug || '');
          if (!slug || slug !== resolvedCompanySlug) return;
          const identity = val.id ? `id:${val.id}` : `key:${key}`;
          if (seenIdentity.has(identity)) return;
          seenIdentity.add(identity);
          companyCount += 1;
          addStat(companyStats, val.status);
          if (hasRole && normalizeText(val.title || '') === resolvedRoleTitle) {
            roleCount += 1;
            addStat(roleStats, val.status);
          }
        });
        renderCountsBadges(companyCount, roleCount, true, hasRole, companyStats, roleStats);
      });
    };
    panel._ljtRefreshCounts = refreshCounts;
    refreshCounts();

    if (!readOnly) {
      blSel.addEventListener('change', () => {
        if (!company) return;
        const key = ljtBlacklistKey(company);
        if (blSel.value === 'bl') {
          chrome.storage.local.set({
            [key]: { company: normalizeText(company), created_at: Date.now() },
          });
        } else {
          chrome.storage.local.remove(key);
        }
      });
    }

    let curRating = safeRating;
    let seenAtFirst = seen_at_first || seen_at || null;
    let seenAtLast = seen_at_last || seen_at || null;

    // Stop all pointer/click events from bubbling out of the panel into the card's button handler
    ['mousedown', 'pointerdown', 'click', 'mouseup', 'pointerup', 'dblclick'].forEach(evt =>
      panel.addEventListener(evt, e => {
        e.stopImmediatePropagation();
        e.stopPropagation();
        if (evt === 'click') e.preventDefault();
      }, true)
    );

    if (!readOnly) {
      sel.addEventListener('change', () => {
        sel.className = `ljt-select ljt-s-${ljtStatusCssKey(sel.value)}`;
        if (sel.value === 'Seen') {
          const now = Date.now();
          if (!seenAtFirst) seenAtFirst = now;
          seenAtLast = now;
        }
        onStatusChange?.(sel.value);
        saveData(jobId, {
          status: sel.value,
          rating: curRating,
          seen_at: seenAtLast || seenAtFirst || null,
          seen_at_first: seenAtFirst,
          seen_at_last: seenAtLast,
        }, meta, { fingerprintKey, jobNumericId: resolvedJobNumericId });
      });
    }

    if (!readOnly) {
      ratingSel.addEventListener('change', () => {
        curRating = +ratingSel.value;
        saveData(jobId, {
          status: sel.value,
          rating: curRating,
          seen_at: seenAtLast || seenAtFirst || null,
          seen_at_first: seenAtFirst,
          seen_at_last: seenAtLast,
        }, meta, { fingerprintKey, jobNumericId: resolvedJobNumericId });
      });
    }

    // Expose a sync method so the storage listener can update this panel from outside
    panel._ljtSync = ({ status: s, rating: r, seen_at: sa, seen_at_first: saf, seen_at_last: sal, id, company_slug: cslug, title }) => {
      if (sel.value !== s) {
        sel.value = s;
        sel.className = `ljt-select ljt-s-${ljtStatusCssKey(s)}`;
        onStatusChange?.(s);
      }
      if (curRating !== r) {
        curRating = r;
        ratingSel.value = String(curRating);
      }
      if (saf && seenAtFirst !== saf) {
        seenAtFirst = saf;
      }
      if (sal && seenAtLast !== sal) {
        seenAtLast = sal;
      } else if (sa && seenAtLast !== sa) {
        // Backward compatibility for older records that only have seen_at.
        seenAtLast = sa;
        if (!seenAtFirst) seenAtFirst = sa;
      }
      if (id) {
        renderIdBadge(id);
      }
      if (cslug) {
        resolvedCompanySlug = normalizeKeyPart(cslug);
      }
      if (title) {
        resolvedRoleTitle = normalizeText(title);
      }
      refreshCounts();
    };

    return panel;
  }

  // ── Injection state ───────────────────────────────────────────────────────

  const injecting = new Set();
  const compKeyToState = new Map(); // componentkey UUID -> { panelKey, fingerprintKey, jobNumericId, meta }
  const watchedCards = new WeakSet(); // cards with per-card observers attached
  const injectedJobIds = new Set();   // right-panel numeric IDs already shown

  // ── Per-card watcher ──────────────────────────────────────────────────────
  // Attaches a MutationObserver directly to a card element.
  // If LinkedIn removes our panel (during re-renders), re-inject after a delay.

  function watchCard(card, jobId, opts) {
    if (watchedCards.has(card)) return;
    watchedCards.add(card);

    const obs = new MutationObserver(() => {
      if (!card.isConnected) {
        obs.disconnect();
        return;
      }
      if (!card.querySelector('.ljt-panel') && !injecting.has(card)) {
        // Panel was removed — wait for LinkedIn to finish its render, then re-inject
        setTimeout(() => appendPanel(card, jobId, opts), 150);
      }
    });
    obs.observe(card, { childList: true });
  }

  // Find the inner text column of a job card (contains title, company, location, date).
  // It's the direct child of the card that contains the paragraph elements.
  function findTextContainer(card) {
    const firstP = card.querySelector('p');
    if (!firstP) return card;
    let el = firstP.parentElement;
    // Walk up until el is a direct child of card
    while (el && el.parentElement && el.parentElement !== card) {
      el = el.parentElement;
    }
    return (el && el !== card) ? el : card;
  }

  function applyCardStatusClass(card, status, side, company = '', targetIsAlready = false) {
    // For left panel, walk up to [componentkey] root; for right, use card as-is
    const target = targetIsAlready
      ? card
      : (side === 'left' ? (card.closest('[componentkey]') || card) : card);
    const shouldColor = side === 'right' ? ljtConfig.colorRight : ljtConfig.colorLeft;

    // Store side + status + company so settings/blacklist changes can re-apply without re-injection
    target.dataset.ljtSide = side;
    target.dataset.ljtStatus = status;
    if (company) target.dataset.ljtCompany = company;

    [...target.classList]
      .filter(c => c.startsWith('ljt-card-'))
      .forEach(c => target.classList.remove(c));

    // Blacklist always wins over status color
    if (isBlacklisted(target.dataset.ljtCompany)) {
      target.classList.add('ljt-card-blacklist');
      return;
    }

    if (shouldColor) {
      const cssKey = ljtStatusCssKey(status);
      if (cssKey !== 'none') target.classList.add(`ljt-card-${cssKey}`);
    }
  }

  async function appendPanel(card, jobId, opts) {
    if (!card.isConnected) return;
    if (card.querySelector('.ljt-panel')) return;
    if (injecting.has(card)) return;
    injecting.add(card);

    const data = await loadData(jobId, {
      fingerprintKey: opts?.fingerprintKey || '',
      jobNumericId: opts?.jobNumericId || '',
    });
    if (opts?.autoSeen) {
      const next = { ...data };
      if (!next.status || next.status === 'None') {
        next.status = 'Seen';
      }
      const now = Date.now();
      if (!next.seen_at_first) {
        next.seen_at_first = next.seen_at_last || next.seen_at || now;
      }
      // "Newest first" in dashboard tracks the latest open action.
      next.seen_at_last = now;
      next.seen_at = now; // legacy alias
      saveData(jobId, next, opts.meta, {
        fingerprintKey: opts?.fingerprintKey || '',
        jobNumericId: opts?.jobNumericId || '',
      });
      Object.assign(data, next);
    } else if (opts?.meta) {
      saveData(jobId, data, opts.meta, {
        fingerprintKey: opts?.fingerprintKey || '',
        jobNumericId: opts?.jobNumericId || '',
      });
    }

    if (!card.isConnected || card.querySelector('.ljt-panel')) {
      injecting.delete(card);
      return;
    }

    // Inject into the inner text column so the panel sits below the date/apply line
    const side = opts.panelSide || 'left';
    const company = opts?.meta?.company || data?.company || '';
    const companySlug = opts?.meta?.company_slug || data?.company_slug || '';
    const roleTitle = opts?.meta?.title || data?.title || '';
    const onStatusChange = (status) => applyCardStatusClass(card, status, side, company);
    const target = findTextContainer(card);
    target.appendChild(buildPanel(jobId, data, { ...opts, onStatusChange, company, companySlug, roleTitle }));
    applyCardStatusClass(card, data.status || 'None', side, company);
    injecting.delete(card);
    watchCard(card, jobId, opts);
  }

  // First-time injection for a card
  async function inject(card, jobId, opts) {
    if (card.querySelector('.ljt-panel')) {
      watchCard(card, jobId, opts);
      return;
    }
    if (injecting.has(card)) return;

    await appendPanel(card, jobId, opts);
    watchCard(card, jobId, opts);
  }

  // ── Shared key computation ────────────────────────────────────────────────

  function rekeyPanel(card, newJobId, opts) {
    const panel = card.querySelector('.ljt-panel');
    if (panel && panel.getAttribute('data-ljt-id') !== newJobId) {
      panel.remove();
    }
    if (!card.querySelector('.ljt-panel') && !injecting.has(card)) {
      inject(card, newJobId, opts);
    }
  }

  function collectTexts(root) {
    return [...root.querySelectorAll('p, span, li')]
      .map(el => normalizeText(el.textContent))
      .filter(Boolean);
  }

  function isMetaLine(text) {
    return /(Viewed|Posted|Reposted|Applicants?|Easy Apply|Promoted|Actively reviewing)/i.test(text);
  }

  function extractLeftFields(card, jobTitle) {
    const ps = [...card.querySelectorAll('p')]
      .map(p => normalizeText(p.textContent))
      .filter(Boolean);

    const normJob = cleanTitleText(jobTitle).toLowerCase();
    let titleIdx = ps.findIndex(t => cleanTitleText(t).toLowerCase().includes(normJob));
    if (titleIdx < 0) titleIdx = 0;

    let company = '';
    let locationLine = '';
    for (let i = titleIdx + 1; i < ps.length; i++) {
      const t = ps[i];
      if (!t) continue;
      if (cleanTitleText(t).toLowerCase().includes(normJob)) continue;
      if (isMetaLine(t)) continue;
      company = t;
      // next meaningful line after company is usually location
      for (let j = i + 1; j < ps.length; j++) {
        const t2 = ps[j];
        if (!t2) continue;
        if (isMetaLine(t2)) continue;
        locationLine = t2;
        break;
      }
      break;
    }

    locationLine = stripBullets(locationLine);
    const { location, workplace } = parseLocationAndWorkplace(locationLine);
    return { company, location, workplace };
  }

  function extractLocationWorkplaceFromTexts(texts, jobTitle, company, container = null) {
    let locationLine = '';
    let workplace = '';
    for (const t of texts) {
      if (!t) continue;
      if (t === jobTitle || t === company) continue;
      if (isMetaLine(t)) continue;
      const wp = extractWorkplaceFromText(t);
      if (wp && !workplace) workplace = wp;
      if (isWorkplaceOnly(t)) continue;
      if (t.includes('·')) {
        const seg = stripBullets(t);
        if (seg) { locationLine = seg; break; }
      }
      if (t.includes(',') || t.includes('Area') || t.includes('United States')) {
        locationLine = t;
        break;
      }
      if (t.includes('(') && !isWorkplaceOnly(t)) {
        locationLine = t;
        break;
      }
    }
    locationLine = stripBullets(locationLine || '');
    const parsed = parseLocationAndWorkplace(locationLine);
    const loc = parsed.location;
    const wpFinal =
      parsed.workplace ||
      workplace ||
      (container ? extractWorkplaceFromContainer(container) : '') ||
      extractWorkplaceFromTitle(jobTitle);
    return { location: loc, workplace: wpFinal };
  }


  // ── LEFT COLUMN ───────────────────────────────────────────────────────────

  function processLeftCards() {
    // Pass 1: re-check all known componentkeys — find them regardless of role/tag changes
    compKeyToState.forEach((state, compKey) => {
      const card = document.querySelector(`[componentkey="${compKey}"]`);
      if (!card) return; // scrolled away
      const opts = {
        readOnly: false,
        fingerprintKey: state.fingerprintKey || '',
        jobNumericId: state.jobNumericId || '',
        meta: state.meta || null,
        panelSide: 'left',
      };
      if (card.querySelector('.ljt-panel')) {
        watchCard(card, state.panelKey, opts);
        return;
      }
      if (!injecting.has(card)) inject(card, state.panelKey, opts);
    });

    // Pass 2: discover new cards via dismiss button
    document.querySelectorAll('button[aria-label^="Dismiss "]').forEach(btn => {
      // Walk up to the card container (large enough block)
      let card = btn.parentElement;
      while (card && card !== document.body) {
        const rect = card.getBoundingClientRect();
        if (rect.height > 50 && rect.width > 150) break;
        card = card.parentElement;
      }
      if (!card || card === document.body) return;

      const compKey = card.getAttribute('componentkey') || '';
      if (compKey && compKeyToState.has(compKey)) return; // already handled in pass 1

      const label = btn.getAttribute('aria-label') || '';
      const jobTitle = normalizeText(label.replace(/^Dismiss /, '').replace(/ job$/, ''));
      if (!jobTitle) return;

      const { company, location, workplace } = extractLeftFields(card, jobTitle);
      const fingerprintKey = buildFingerprintKey(jobTitle, company, location, workplace);
      if (!fingerprintKey) return;
      const jobNumericId = extractJobIdFromCard(card);
      const panelKey = resolvePrimaryKey({ fingerprintKey, jobNumericId });
      if (!panelKey) return;

      const meta = buildMeta({ id: jobNumericId, title: jobTitle, company, location, workplace });
      if (jobNumericId) upsertJobLink(jobNumericId, fingerprintKey);
      if (compKey) compKeyToState.set(compKey, { panelKey, fingerprintKey, jobNumericId, meta });
      if (!card.querySelector('.ljt-panel') && !injecting.has(card)) {
        inject(card, panelKey, { readOnly: false, fingerprintKey, jobNumericId, meta, panelSide: 'left' });
      }
    });
  }

  // When user clicks a left card, LinkedIn updates currentJobId in URL.
  // Use that to re-key the clicked card to the numeric job id.
  let clickListenerAttached = false;
  function attachLeftCardClickListener() {
    if (clickListenerAttached) return;
    clickListenerAttached = true;
    document.addEventListener('click', e => {
      // Only react to actual left-list cards (they have a Dismiss button inside).
      const candidate = e.target.closest('[componentkey][role="button"]') || e.target.closest('[componentkey]');
      if (!candidate) return;
      const hasDismiss = !!candidate.querySelector('button[aria-label^="Dismiss "]');
      if (!hasDismiss) return;
      const card = candidate;
      if (!card) return;
      const compKey = card.getAttribute('componentkey') || '';
      if (!compKey) return;
      const urlBeforeClick = location.href;
      const cardJobIdFromHref = extractJobIdFromCard(card);
      let attempts = 0;
      const syncActiveCard = () => {
        // Prefer jobId embedded in the clicked card itself. URL is fallback only.
        const urlChanged = location.href !== urlBeforeClick;
        const activeJobId = cardJobIdFromHref || (urlChanged ? readJobIdFromUrl() : '');
        if (!activeJobId && attempts < 14) {
          attempts += 1;
          setTimeout(syncActiveCard, 60);
          return;
        }

        const btn = card.querySelector('button[aria-label^="Dismiss "]');
        const label = btn?.getAttribute('aria-label') || '';
        const jobTitle = normalizeText(label.replace(/^Dismiss /, '').replace(/ job$/, ''));
        if (!jobTitle) return;
        const { company, location, workplace } = extractLeftFields(card, jobTitle);
        const fingerprintKey = buildFingerprintKey(jobTitle, company, location, workplace);
        if (!fingerprintKey) return;

        const panelKey = resolvePrimaryKey({ fingerprintKey, jobNumericId: activeJobId });
        if (!panelKey) return;
        const meta = buildMeta({ id: activeJobId, title: jobTitle, company, location, workplace });
        if (activeJobId) upsertJobLink(activeJobId, fingerprintKey);
        compKeyToState.set(compKey, { panelKey, fingerprintKey, jobNumericId: activeJobId, meta });
        rekeyPanel(card, panelKey, { readOnly: false, fingerprintKey, jobNumericId: activeJobId, meta, panelSide: 'left' });
      };
      syncActiveCard();
    }, true);
  }

  // ── RIGHT COLUMN ──────────────────────────────────────────────────────────

  function processRightPanel() {
    const seenThisScan = new Set();

    document.querySelectorAll('a[href*="/jobs/view/"]').forEach(a => {
      const m = a.getAttribute('href').match(/\/jobs\/view\/(\d+)/);
      if (!m) return;
      const numericId = m[1];

      if (seenThisScan.has(numericId)) return;
      seenThisScan.add(numericId);

      let container = a.parentElement;
      while (container && container !== document.body) {
        const hasApply = container.querySelector('a[aria-label*="Apply"], button[aria-label="Save the job"]');
        const rect = container.getBoundingClientRect();
        if (hasApply && rect.height > 80) break;
        container = container.parentElement;
      }

      if (!container || container === document.body) return;

      const jobTitle = normalizeText(a.textContent);

      // Company link may be outside the container (in a header above) — walk up from title anchor
      let company = '';
      let companySlug = '';
      let companySearch = a.parentElement;
      for (let i = 0; i < 10 && companySearch && companySearch !== document.body; i++) {
        const cl = companySearch.querySelector('a[href*="/company/"]');
        if (cl) {
          if (cl.textContent.trim()) company = normalizeText(cl.textContent);
          companySlug = extractCompanySlugFromHref(cl.getAttribute('href'));
          break;
        }
        companySearch = companySearch.parentElement;
      }

      const texts = collectTexts(container);
      const { location, workplace } = extractLocationWorkplaceFromTexts(texts, jobTitle, company, container);
      const fingerprintKey = buildFingerprintKey(jobTitle, company, location, workplace);
      if (!fingerprintKey) return;
      const panelKey = resolvePrimaryKey({ fingerprintKey, jobNumericId: numericId });
      if (!panelKey) return;
      const meta = buildMeta({ id: numericId, title: jobTitle, company, company_slug: companySlug, location, workplace });
      upsertJobLink(numericId, fingerprintKey);

      if (injectedJobIds.has(numericId) && !container.querySelector('.ljt-panel')) {
        injectedJobIds.delete(numericId);
      }

      if (container.querySelector('.ljt-panel')) {
        injectedJobIds.add(numericId);
        return;
      }

      injectedJobIds.clear();
      injectedJobIds.add(numericId);
      inject(container, panelKey, {
        readOnly: false,
        fingerprintKey,
        jobNumericId: numericId,
        meta,
        autoSeen: true,
        panelSide: 'right',
      });
    });
  }

  // ── Main scan ─────────────────────────────────────────────────────────────

  function scanAll() {
    processLeftCards();
    processRightPanel();
    attachLeftCardClickListener();
  }

  // Block LinkedIn card navigation when interacting with our panel
  function stopCardNav(e) {
    const panel = e.target.closest('.ljt-panel');
    if (!panel) return;
    e.stopImmediatePropagation();
    e.stopPropagation();
    if (e.type === 'click') e.preventDefault();
  }
  ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick'].forEach(evt => {
    window.addEventListener(evt, stopCardNav, true);
  });

  // ── Observer ──────────────────────────────────────────────────────────────

  let rafId = null;
  const observer = new MutationObserver(() => {
    if (rafId) return;
    rafId = requestAnimationFrame(() => { scanAll(); rafId = null; });
  });

  observer.observe(document.documentElement, { childList: true, subtree: true });

  // Load config + blacklist before first scan so colors are applied correctly on page load
  chrome.storage.local.get(null, res => {
    if (res.ljt_settings) ljtConfig = { ...ljtConfig, ...res.ljt_settings };
    Object.entries(res).forEach(([k, v]) => {
      if (k.startsWith(LJT_BL_PREFIX)) blacklistSet.add(k.slice(LJT_BL_PREFIX.length));
      if (k.startsWith(LJT_MAP_ID_PREFIX) && typeof v === 'string') {
        jobIdToFp.set(k.slice(LJT_MAP_ID_PREFIX.length), v);
      }
      if (k.startsWith(LJT_MAP_FP_PREFIX) && typeof v === 'string') {
        fpToJobId.set(k.slice(LJT_MAP_FP_PREFIX.length), v);
      }
    });
    scanAll();
    setTimeout(scanAll, 1500);
    setTimeout(scanAll, 4000);
  });
})();
