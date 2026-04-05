(() => {
  'use strict';

  // STATUS_OPTIONS are defined in options.js (loaded first via manifest)

  // ── Config ────────────────────────────────────────────────────────────────
  let ljtConfig = { colorLeft: true, colorRight: true };

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
    return `ljt_idx__${t}||${c}||${l}||${w}`;
  }

  function buildMeta({ id, title, company, location, workplace }) {
    const meta = {};
    if (id) meta.id = id;
    if (title) meta.title = title;
    if (company) meta.company = company;
    if (location) meta.location = location;
    if (workplace) meta.workplace = workplace;
    return meta;
  }

  // ── Storage ───────────────────────────────────────────────────────────────

  function loadData(key) {
    return new Promise(resolve =>
      chrome.storage.local.get(key, res => resolve(res[key] ?? { status: 'None', rating: 0 }))
    );
  }

  function saveData(key, value, meta = null) {
    const payload = meta ? { ...value, ...meta } : value;
    console.log('[LJT] save', key, payload);
    chrome.storage.local.set({ [key]: payload });
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
      document.querySelectorAll('[data-ljt-side]').forEach(el => {
        const side = el.dataset.ljtSide;
        const status = el.dataset.ljtStatus || 'None';
        const shouldColor = side === 'left' ? ljtConfig.colorLeft : ljtConfig.colorRight;
        [...el.classList].filter(c => c.startsWith('ljt-card-')).forEach(c => el.classList.remove(c));
        if (shouldColor) {
          const cssKey = ljtStatusCssKey(status);
          if (cssKey !== 'none') el.classList.add(`ljt-card-${cssKey}`);
        }
      });
    }

    Object.entries(changes).forEach(([key, { newValue }]) => {
      if (!newValue) return;
      document.querySelectorAll(`.ljt-panel[data-ljt-id="${CSS.escape(key)}"]`).forEach(panel => {
        panel._ljtSync?.(newValue);
      });
    });
  });

  // ── UI builder ────────────────────────────────────────────────────────────

  function renderStars(wrap, active, preview = false) {
    wrap.querySelectorAll('.ljt-star').forEach(s => {
      const v = +s.dataset.v;
      s.classList.toggle('ljt-star--on', v <= active);
      s.classList.toggle('ljt-star--preview', preview && v <= active);
    });
  }

  function buildPanel(jobId, { status, rating, seen_at } = {}, { readOnly = false, fingerprintKey = '', meta = null, onStatusChange = null } = {}) {
    const safeStatus = status || 'None';
    const safeRating = Number.isFinite(rating) ? rating : 0;
    const panel = document.createElement('div');
    panel.className = 'ljt-panel';
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

    let curRating = safeRating;
    let seenAt = seen_at || null;

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
        if (sel.value === 'Seen' && !seenAt) {
          seenAt = Date.now();
        }
        onStatusChange?.(sel.value);
        saveData(jobId, { status: sel.value, rating: curRating, seen_at: seenAt }, meta);
      });
    }

    if (!readOnly) {
      ratingSel.addEventListener('change', () => {
        curRating = +ratingSel.value;
        saveData(jobId, { status: sel.value, rating: curRating, seen_at: seenAt }, meta);
      });
    }

    // Expose a sync method so the storage listener can update this panel from outside
    panel._ljtSync = ({ status: s, rating: r, seen_at: sa }) => {
      if (sel.value !== s) {
        sel.value = s;
        sel.className = `ljt-select ljt-s-${ljtStatusCssKey(s)}`;
        onStatusChange?.(s);
      }
      if (curRating !== r) {
        curRating = r;
        ratingSel.value = String(curRating);
      }
      if (sa && seenAt !== sa) {
        seenAt = sa;
      }
    };

    return panel;
  }

  // ── Injection state ───────────────────────────────────────────────────────

  const injecting = new Set();
  const compKeyToJobId = new Map(); // componentkey UUID → jobId (survives element replacement)
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

  function applyCardStatusClass(card, status, side) {
    // For left panel, walk up to [componentkey] root; for right, use card as-is
    const target = side === 'left' ? (card.closest('[componentkey]') || card) : card;
    const shouldColor = side === 'right' ? ljtConfig.colorRight : ljtConfig.colorLeft;

    // Store side + status so settings changes can re-apply without re-injection
    target.dataset.ljtSide = side;
    target.dataset.ljtStatus = status;

    [...target.classList]
      .filter(c => c.startsWith('ljt-card-'))
      .forEach(c => target.classList.remove(c));

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

    const data = await loadData(jobId);
    if (opts?.autoSeen && (data?.status === 'None' || !data?.status)) {
      if (!data.seen_at) data.seen_at = Date.now();
      data.status = 'Seen';
      saveData(jobId, data, opts.meta);
    } else if (opts?.meta) {
      saveData(jobId, data, opts.meta);
    }

    if (!card.isConnected || card.querySelector('.ljt-panel')) {
      injecting.delete(card);
      return;
    }

    // Inject into the inner text column so the panel sits below the date/apply line
    const side = opts.panelSide || 'left';
    const onStatusChange = (status) => applyCardStatusClass(card, status, side);
    const target = findTextContainer(card);
    target.appendChild(buildPanel(jobId, data, { ...opts, onStatusChange }));
    applyCardStatusClass(card, data.status || 'None', side);
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
    compKeyToJobId.forEach((jobId, compKey) => {
      const card = document.querySelector(`[componentkey="${compKey}"]`);
      if (!card) return; // scrolled away
      if (card.querySelector('.ljt-panel')) {
        watchCard(card, jobId, { readOnly: false, fingerprintKey: jobId });
        return;
      }
      if (!injecting.has(card)) inject(card, jobId, { readOnly: false, fingerprintKey: jobId, panelSide: 'left' });
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
      if (compKey && compKeyToJobId.has(compKey)) return; // already handled in pass 1

      const label = btn.getAttribute('aria-label') || '';
      const jobTitle = normalizeText(label.replace(/^Dismiss /, '').replace(/ job$/, ''));
      if (!jobTitle) return;

      const { company, location, workplace } = extractLeftFields(card, jobTitle);
      const fingerprintKey = buildFingerprintKey(jobTitle, company, location, workplace);
      if (!fingerprintKey) return;

      const meta = buildMeta({ title: jobTitle, company, location, workplace });
      if (compKey) compKeyToJobId.set(compKey, fingerprintKey);
      if (!card.querySelector('.ljt-panel') && !injecting.has(card)) {
        inject(card, fingerprintKey, { readOnly: false, fingerprintKey, meta, panelSide: 'left' });
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
      const card = e.target.closest('[componentkey][role="button"]') || e.target.closest('[componentkey]');
      if (!card) return;
      const compKey = card.getAttribute('componentkey') || '';
      if (!compKey) return;
      setTimeout(() => {
        const btn = card.querySelector('button[aria-label^="Dismiss "]');
        const label = btn?.getAttribute('aria-label') || '';
        const jobTitle = normalizeText(label.replace(/^Dismiss /, '').replace(/ job$/, ''));
        const { company, location, workplace } = extractLeftFields(card, jobTitle);
        const fingerprintKey = buildFingerprintKey(jobTitle, company, location, workplace);
        if (!fingerprintKey) return;

        const meta = buildMeta({ title: jobTitle, company, location, workplace });
        compKeyToJobId.set(compKey, fingerprintKey);
        rekeyPanel(card, fingerprintKey, { readOnly: false, fingerprintKey, meta, panelSide: 'left' });
      }, 0);
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
      let companySearch = a.parentElement;
      for (let i = 0; i < 10 && companySearch && companySearch !== document.body; i++) {
        const cl = companySearch.querySelector('a[href*="/company/"]');
        if (cl && cl.textContent.trim()) { company = normalizeText(cl.textContent); break; }
        companySearch = companySearch.parentElement;
      }

      const texts = collectTexts(container);
      const { location, workplace } = extractLocationWorkplaceFromTexts(texts, jobTitle, company, container);
      const fingerprintKey = buildFingerprintKey(jobTitle, company, location, workplace);
      if (!fingerprintKey) return;
      const meta = buildMeta({ id: numericId, title: jobTitle, company, location, workplace });

      if (injectedJobIds.has(numericId) && !container.querySelector('.ljt-panel')) {
        injectedJobIds.delete(numericId);
      }

      if (container.querySelector('.ljt-panel')) {
        injectedJobIds.add(numericId);
        return;
      }

      injectedJobIds.clear();
      injectedJobIds.add(numericId);
      inject(container, fingerprintKey, { readOnly: false, fingerprintKey, meta, autoSeen: true, panelSide: 'right' });
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

  // Load config before first scan so colors are applied correctly on page load
  chrome.storage.local.get('ljt_settings', res => {
    if (res.ljt_settings) ljtConfig = { ...ljtConfig, ...res.ljt_settings };
    scanAll();
    setTimeout(scanAll, 1500);
    setTimeout(scanAll, 4000);
  });
})();
