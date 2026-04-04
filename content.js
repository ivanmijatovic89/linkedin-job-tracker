(() => {
  'use strict';

  const STATUS_OPTIONS = ['None', 'Seen', 'Applied', 'Skipped'];

  // ── Utilities ─────────────────────────────────────────────────────────────

  function simpleHash(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) {
      h = Math.imul(31, h) + str.charCodeAt(i) | 0;
    }
    return Math.abs(h).toString(36);
  }

  function normalizeText(str) {
    return (str || '').trim().replace(/\s+/g, ' ');
  }

  // ── Storage ───────────────────────────────────────────────────────────────

  function loadData(key) {
    return new Promise(resolve =>
      chrome.storage.local.get(key, res => resolve(res[key] ?? { status: 'None', rating: 0 }))
    );
  }

  function saveData(key, value) {
    chrome.storage.local.set({ [key]: value });
  }

  // ── UI builder ────────────────────────────────────────────────────────────

  function renderStars(wrap, active, preview = false) {
    wrap.querySelectorAll('.ljt-star').forEach(s => {
      const v = +s.dataset.v;
      s.classList.toggle('ljt-star--on', v <= active);
      s.classList.toggle('ljt-star--preview', preview && v <= active);
    });
  }

  function buildPanel(jobId, { status, rating }) {
    const panel = document.createElement('div');
    panel.className = 'ljt-panel';
    panel.setAttribute('data-ljt-id', jobId);

    const sel = document.createElement('select');
    sel.className = `ljt-select ljt-s-${status.toLowerCase()}`;
    STATUS_OPTIONS.forEach(opt => {
      const o = document.createElement('option');
      o.value = opt;
      o.textContent = opt;
      if (opt === status) o.selected = true;
      sel.appendChild(o);
    });

    const stars = document.createElement('div');
    stars.className = 'ljt-stars';
    for (let i = 1; i <= 5; i++) {
      const s = document.createElement('span');
      s.className = 'ljt-star';
      s.dataset.v = i;
      s.textContent = '★';
      stars.appendChild(s);
    }
    renderStars(stars, rating);

    panel.appendChild(sel);
    panel.appendChild(stars);

    let curRating = rating;

    sel.addEventListener('mousedown', e => e.stopPropagation());
    sel.addEventListener('click', e => e.stopPropagation());
    sel.addEventListener('change', e => {
      e.stopPropagation();
      sel.className = `ljt-select ljt-s-${sel.value.toLowerCase()}`;
      saveData(jobId, { status: sel.value, rating: curRating });
    });

    stars.addEventListener('mouseover', e => {
      const s = e.target.closest('.ljt-star');
      if (s) renderStars(stars, +s.dataset.v, true);
    });
    stars.addEventListener('mouseleave', () => renderStars(stars, curRating));
    stars.addEventListener('click', e => {
      e.stopPropagation();
      const s = e.target.closest('.ljt-star');
      if (!s) return;
      const v = +s.dataset.v;
      curRating = curRating === v ? 0 : v;
      renderStars(stars, curRating);
      saveData(jobId, { status: sel.value, rating: curRating });
    });

    return panel;
  }

  // ── Injection state ───────────────────────────────────────────────────────

  const injectedCards = new WeakSet(); // DOM elements already processed
  const injectedJobIds = new Set();    // right-panel numeric IDs already shown
  const injecting = new Set();

  async function inject(card, jobId) {
    if (injectedCards.has(card)) return;
    if (card.querySelector('.ljt-panel')) { injectedCards.add(card); return; }
    if (injecting.has(card)) return;
    injecting.add(card);

    const data = await loadData(jobId);
    if (card.querySelector('.ljt-panel')) {
      injectedCards.add(card);
      injecting.delete(card);
      return;
    }

    card.appendChild(buildPanel(jobId, data));
    injectedCards.add(card);
    injecting.delete(card);
  }

  // ── Shared key computation ────────────────────────────────────────────────
  // Both columns must use the same storage key for the same job.
  // We hash (title || company) — the same data available in both columns.

  function makeJobId(title, company) {
    return `ljt_h_${simpleHash(title + '||' + company)}`;
  }

  // ── LEFT COLUMN ───────────────────────────────────────────────────────────
  // Cards are div[role="button"][componentkey] containing a dismiss button.
  // Title comes from the dismiss button aria-label; company from paragraph text.

  function processLeftCards() {
    document.querySelectorAll('div[role="button"][componentkey]').forEach(card => {
      // If already injected, check the panel wasn't removed by LinkedIn re-render
      if (injectedCards.has(card)) {
        if (!card.querySelector('.ljt-panel')) {
          injectedCards.delete(card);
          injecting.delete(card);
        } else {
          return;
        }
      }

      const dismissBtn = card.querySelector('button[aria-label^="Dismiss "]');
      if (!dismissBtn) return;

      const label = dismissBtn.getAttribute('aria-label') || '';
      const jobTitle = normalizeText(label.replace(/^Dismiss /, '').replace(/ job$/, ''));
      if (!jobTitle) return;

      const company = [...card.querySelectorAll('p')]
        .map(p => normalizeText(p.textContent))
        .find(t =>
          t &&
          t !== jobTitle &&
          t.length < 80 &&
          !t.match(/\d+ (hour|day|week|month)/) &&
          !t.includes('applicant') &&
          !t.includes('·') &&
          !t.includes('Posted')
        ) || '';

      inject(card, makeJobId(jobTitle, company));
    });
  }

  // ── RIGHT COLUMN ──────────────────────────────────────────────────────────
  // The job title <a> links to /jobs/view/{id}/.
  // We derive the job title from that anchor's text and company from a nearby
  // /company/ link — computing the same hash as the left column.

  function processRightPanel() {
    const seenThisScan = new Set();

    document.querySelectorAll('a[href*="/jobs/view/"]').forEach(a => {
      const m = a.getAttribute('href').match(/\/jobs\/view\/(\d+)/);
      if (!m) return;
      const numericId = m[1];

      // Only process the first link per numeric ID per scan
      if (seenThisScan.has(numericId)) return;
      seenThisScan.add(numericId);

      // Find the container with Apply/Save buttons
      let container = a.parentElement;
      while (container && container !== document.body) {
        const hasApply = container.querySelector('a[aria-label*="Apply"], button[aria-label="Save the job"]');
        const rect = container.getBoundingClientRect();
        if (hasApply && rect.height > 80) break;
        container = container.parentElement;
      }

      if (!container || container === document.body) return;

      // Compute key using same hash strategy as left column
      // The <a> text IS the job title; company comes from the /company/ link
      const jobTitle = normalizeText(a.textContent);
      const companyLink = container.querySelector('a[href*="/company/"]');
      const company = companyLink ? normalizeText(companyLink.textContent) : '';
      const jobId = jobTitle ? makeJobId(jobTitle, company) : `ljt_${numericId}`;

      // If we already marked this numericId injected but the panel is gone, reset
      if (injectedJobIds.has(numericId) && !container.querySelector('.ljt-panel')) {
        injectedJobIds.delete(numericId);
      }

      if (container.querySelector('.ljt-panel')) {
        injectedJobIds.add(numericId);
        return;
      }

      // A new job is selected — clear stale IDs and inject
      injectedJobIds.clear();
      injectedJobIds.add(numericId);
      inject(container, jobId);
    });
  }

  // ── Main scan ─────────────────────────────────────────────────────────────

  function scanAll() {
    processLeftCards();
    processRightPanel();
  }

  // ── Observer ──────────────────────────────────────────────────────────────

  let rafId = null;
  const observer = new MutationObserver(() => {
    if (rafId) return;
    rafId = requestAnimationFrame(() => { scanAll(); rafId = null; });
  });

  observer.observe(document.documentElement, { childList: true, subtree: true });

  scanAll();
  setTimeout(scanAll, 1500);
  setTimeout(scanAll, 4000);
})();
