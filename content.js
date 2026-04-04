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
  const injectedJobIds = new Set();    // right-panel job IDs already shown
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

  // ── LEFT COLUMN ───────────────────────────────────────────────────────────
  // Cards are div[role="button"][componentkey] containing a dismiss button.
  // No numeric job ID in DOM — use hash of title + company.

  function processLeftCards() {
    document.querySelectorAll('div[role="button"][componentkey]').forEach(card => {
      if (injectedCards.has(card)) return;

      // Must have a "Dismiss X job" button — this confirms it's a job card
      const dismissBtn = card.querySelector('button[aria-label^="Dismiss "]');
      if (!dismissBtn) return;

      const label = dismissBtn.getAttribute('aria-label') || '';
      const jobTitle = label.replace(/^Dismiss /, '').replace(/ job$/, '').trim();
      if (!jobTitle) return;

      // Get company name: first <p> text that isn't the job title and isn't metadata
      const company = [...card.querySelectorAll('p')]
        .map(p => p.textContent.trim())
        .find(t =>
          t &&
          t !== jobTitle &&
          t.length < 80 &&
          !t.match(/\d+ (hour|day|week|month)/) &&
          !t.includes('applicant') &&
          !t.includes('·') &&
          !t.includes('Posted')
        ) || '';

      const jobId = `ljt_h_${simpleHash(jobTitle + '||' + company)}`;
      inject(card, jobId);
    });
  }

  // ── RIGHT COLUMN ──────────────────────────────────────────────────────────
  // The job detail panel has an <a> link to /jobs/view/{id}/ for the job title.
  // Many other links also contain currentJobId — we only want one panel.
  // Strategy: find the job title <a> (href /jobs/view/), get its ID and container.

  function processRightPanel() {
    // The job title in the right panel links to /jobs/view/{id}/
    document.querySelectorAll('a[href*="/jobs/view/"]').forEach(a => {
      const m = a.getAttribute('href').match(/\/jobs\/view\/(\d+)/);
      if (!m) return;
      const jobId = `ljt_${m[1]}`;

      // Only one panel per right-panel job
      if (injectedJobIds.has(jobId)) return;

      // Find the container: go up to a sizeable block that contains Apply/Save
      // The right panel header section wraps: company logo, job title, Apply, Save
      let container = a.parentElement;
      while (container && container !== document.body) {
        // Stop when we find a block that contains both the title and action buttons
        const hasApply = container.querySelector('a[aria-label*="Apply"], button[aria-label="Save the job"]');
        const rect = container.getBoundingClientRect();
        if (hasApply && rect.height > 80) break;
        container = container.parentElement;
      }

      if (!container || container === document.body) return;
      if (container.querySelector('.ljt-panel')) {
        injectedJobIds.add(jobId);
        return;
      }

      injectedJobIds.add(jobId);
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
