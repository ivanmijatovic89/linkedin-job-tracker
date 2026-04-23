(() => {
  'use strict';

  // ── State ─────────────────────────────────────────────────────────────────

  let allJobs = [];
  let blacklist = []; // [{ key, company, created_at }]
  let blacklistSet = new Set(); // normalized company names
  const filters = {
    search: '',
    status: '',
    sort: 'newest',
    group: false,
    blacklistSearch: '',
  };

  // ── Storage ───────────────────────────────────────────────────────────────

  function parseKeyFallback(key) {
    const match = key.match(/^ljt_idx__(.+)$/);
    if (!match) return {};
    const parts = match[1].split('||');
    return {
      title: parts[0] || '',
      company: parts[1] || '',
      location: parts[2] || '',
      workplace: parts[3] || '',
    };
  }

  async function loadAll() {
    return new Promise(resolve => {
      chrome.storage.local.get(null, all => {
        const jobs = [];
        const bl = [];
        for (const [key, val] of Object.entries(all)) {
          if (key.startsWith(LJT_BL_PREFIX)) {
            if (val && val.company) {
              bl.push({
                key,
                company: val.company,
                created_at: val.created_at || 0,
              });
            }
            continue;
          }
          if (!key.startsWith('ljt_idx__')) continue;
          if (!val || !val.status || val.status === 'None') continue;

          const fb = parseKeyFallback(key);
          jobs.push({
            key,
            status:    val.status,
            rating:    typeof val.rating === 'number' ? val.rating : 0,
            seen_at:   val.seen_at || 0,
            id:        val.id || '',
            title:     val.title    || fb.title    || '',
            company:   val.company  || fb.company  || '',
            location:  val.location || fb.location || '',
            workplace: val.workplace || fb.workplace || '',
          });
        }
        resolve({ jobs, blacklist: bl });
      });
    });
  }

  // ── Filter / Sort ─────────────────────────────────────────────────────────

  function applyFilters(jobs) {
    let result = [...jobs];

    if (filters.search) {
      const q = filters.search.toLowerCase();
      result = result.filter(j =>
        j.title.toLowerCase().includes(q) ||
        j.company.toLowerCase().includes(q) ||
        j.location.toLowerCase().includes(q) ||
        j.workplace.toLowerCase().includes(q)
      );
    }

    if (filters.status === '__blacklist__') {
      result = result.filter(j => blacklistSet.has(ljtNormalizeCompany(j.company)));
    } else if (filters.status) {
      result = result.filter(j => j.status === filters.status);
    }

    result.sort((a, b) => {
      switch (filters.sort) {
        case 'newest':  return (b.seen_at || 0) - (a.seen_at || 0);
        case 'oldest':  return (a.seen_at || 0) - (b.seen_at || 0);
        case 'title':   return a.title.localeCompare(b.title);
        case 'company': return a.company.localeCompare(b.company);
        case 'rating':  return b.rating - a.rating;
        default:        return 0;
      }
    });

    return result;
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  function esc(str) {
    return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function formatDate(ts) {
    if (!ts) return '';
    return new Date(ts).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }

  function renderStars(rating) {
    let html = '';
    for (let i = 1; i <= 5; i++) {
      html += `<span class="star${i <= rating ? ' star--on' : ''}">${i <= rating ? '★' : '☆'}</span>`;
    }
    return html;
  }

  // ── Render job card ───────────────────────────────────────────────────────

  function renderCard(job) {
    const opt = ljtStatusOption(job.status);
    const sc = opt.cssKey;
    const date = formatDate(job.seen_at);

    const metaParts = [job.company, job.location, job.workplace].filter(Boolean);
    const meta = esc(metaParts.join(' · '));

    const titleText = job.title ? esc(job.title) : '<span class="no-title">Unknown Position</span>';
    const titleHtml = job.id
      ? `<a class="job-title-link" href="https://www.linkedin.com/jobs/view/${esc(job.id)}/" target="_blank" rel="noopener noreferrer">${titleText}</a>`
      : titleText;

    const pillLabel = opt.icon ? `${opt.icon} ${esc(job.status)}` : esc(job.status);
    const blCls = blacklistSet.has(ljtNormalizeCompany(job.company)) ? ' is-blacklisted' : '';

    return `
      <div class="job-card status-${sc}${blCls}">
        <div class="job-card-accent"></div>
        <div class="job-card-body">
          <div class="job-card-top">
            <div class="job-title">${titleHtml}</div>
            <div class="job-rating">${renderStars(job.rating)}</div>
          </div>
          <div class="job-card-bottom">
            <div class="job-meta">${meta || '<span style="color:var(--text-3)">No details</span>'}</div>
            <div class="job-right">
              <span class="job-status-pill status-${sc}-pill">${pillLabel}</span>
              ${date ? `<span class="job-date">${date}</span>` : ''}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  // ── Render flat list ──────────────────────────────────────────────────────

  function renderFlat(jobs) {
    if (!jobs.length) return renderEmpty();
    return jobs.map(renderCard).join('');
  }

  // ── Render grouped list ───────────────────────────────────────────────────

  function renderGrouped(jobs) {
    // Build groups from options order, skipping None
    const orderOpts = LJT_STATUS_OPTIONS.filter(o => o.value !== 'None');
    const grouped = {};
    for (const opt of orderOpts) grouped[opt.value] = [];
    for (const j of jobs) {
      if (grouped[j.status] !== undefined) grouped[j.status].push(j);
    }

    let html = '';
    for (const opt of orderOpts) {
      const group = grouped[opt.value];
      if (!group.length) continue;
      const sc = opt.cssKey;
      const headerLabel = opt.icon ? `${opt.icon} ${opt.label}` : opt.label;
      html += `
        <div class="group-section">
          <div class="group-header status-${sc}-header">
            <span class="group-label">${headerLabel}</span>
            <span class="group-count">${group.length}</span>
          </div>
          <div class="group-jobs">
            ${group.map(renderCard).join('')}
          </div>
        </div>
      `;
    }

    return html || renderEmpty();
  }

  function renderEmpty() {
    return `
      <div class="empty-state">
        <span class="empty-state-icon">⬡</span>
        No jobs found
      </div>
    `;
  }

  // ── Update stats ──────────────────────────────────────────────────────────

  function updateStats() {
    document.getElementById('stat-total').textContent     = allJobs.length;
    document.getElementById('stat-to-apply').textContent  = allJobs.filter(j => j.status === 'To Apply').length;
    document.getElementById('stat-applied').textContent   = allJobs.filter(j => j.status === 'Applied').length;
    document.getElementById('stat-seen').textContent      = allJobs.filter(j => j.status === 'Seen').length;
    document.getElementById('stat-skip').textContent      = allJobs.filter(j => j.status === 'Skip').length;
    document.getElementById('stat-blacklist').textContent = blacklist.length;
  }

  // ── Blacklist render ──────────────────────────────────────────────────────

  function renderBlacklist() {
    const section = document.getElementById('blacklist-section');
    const list = document.getElementById('blacklist-list');
    const countEl = document.getElementById('blacklist-count');
    countEl.textContent = blacklist.length;

    if (!blacklist.length) {
      section.setAttribute('hidden', '');
      list.innerHTML = '';
      return;
    }
    section.removeAttribute('hidden');

    const q = filters.blacklistSearch.toLowerCase();
    const filtered = [...blacklist]
      .filter(b => !q || b.company.toLowerCase().includes(q))
      .sort((a, b) => (b.created_at || 0) - (a.created_at || 0));

    if (!filtered.length) {
      list.innerHTML = `<li class="blacklist-empty">No matches for "${esc(filters.blacklistSearch)}"</li>`;
      return;
    }

    list.innerHTML = filtered.map(b => {
      const date = b.created_at ? formatDate(b.created_at) : '';
      return `
        <li class="blacklist-item" data-key="${esc(b.key)}">
          <span class="blacklist-item-name">${esc(b.company)}</span>
          ${date ? `<span class="blacklist-item-date">${date}</span>` : ''}
          <button class="blacklist-unbtn" data-key="${esc(b.key)}" type="button">Unblacklist</button>
        </li>
      `;
    }).join('');
  }

  // ── Main render ───────────────────────────────────────────────────────────

  function render() {
    const filtered = applyFilters(allJobs);
    const list = document.getElementById('job-list');
    list.innerHTML = filters.group ? renderGrouped(filtered) : renderFlat(filtered);
    updateStats();
    renderBlacklist();
  }

  // ── Init ──────────────────────────────────────────────────────────────────

  async function init() {
    const { jobs, blacklist: bl } = await loadAll();
    allJobs = jobs;
    blacklist = bl;
    blacklistSet = new Set(bl.map(b => ljtNormalizeCompany(b.company)));
    render();
    document.getElementById('last-updated').textContent =
      new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  }

  // ── Event listeners ───────────────────────────────────────────────────────

  document.getElementById('search').addEventListener('input', e => {
    filters.search = e.target.value.trim();
    render();
  });

  document.getElementById('filter-status').addEventListener('change', e => {
    filters.status = e.target.value;
    render();
  });

  document.getElementById('sort').addEventListener('change', e => {
    filters.sort = e.target.value;
    render();
  });

  document.getElementById('group-toggle').addEventListener('change', e => {
    filters.group = e.target.checked;
    render();
  });

  document.getElementById('blacklist-search').addEventListener('input', e => {
    filters.blacklistSearch = e.target.value.trim();
    renderBlacklist();
  });

  document.getElementById('blacklist-list').addEventListener('click', e => {
    const btn = e.target.closest('.blacklist-unbtn');
    if (!btn) return;
    const key = btn.dataset.key;
    if (!key) return;
    chrome.storage.local.remove(key);
  });

  document.getElementById('btn-clear').addEventListener('click', async () => {
    const count = allJobs.length;
    if (!count) return;
    const confirmed = confirm(`Remove all ${count} tracked job${count === 1 ? '' : 's'}? This cannot be undone.`);
    if (!confirmed) return;

    chrome.storage.local.get(null, all => {
      const keys = Object.keys(all).filter(k => k.startsWith('ljt_') && k !== 'ljt_settings');
      chrome.storage.local.remove(keys, () => init());
    });
  });

  document.getElementById('btn-refresh').addEventListener('click', async () => {
    const btn = document.getElementById('btn-refresh');
    btn.disabled = true;
    btn.classList.add('spinning');
    await init();
    setTimeout(() => {
      btn.classList.remove('spinning');
      btn.disabled = false;
    }, 600);
  });

  // ── Live storage updates ──────────────────────────────────────────────────

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    const relevant = Object.keys(changes).some(k => k.startsWith('ljt_') && k !== 'ljt_settings');
    if (relevant) init();
  });

  // ── Settings (config modal) ───────────────────────────────────────────────

  const DEFAULT_SETTINGS = { colorLeft: false, colorRight: false };

  function loadSettings(cb) {
    chrome.storage.local.get('ljt_settings', res => cb({ ...DEFAULT_SETTINGS, ...(res.ljt_settings || {}) }));
  }

  function saveSetting(key, value) {
    loadSettings(current => {
      chrome.storage.local.set({ ljt_settings: { ...current, [key]: value } });
    });
  }

  function openModal() {
    loadSettings(s => {
      document.getElementById('cfg-color-left').checked  = s.colorLeft;
      document.getElementById('cfg-color-right').checked = s.colorRight;
      const count = allJobs.length;
      document.getElementById('export-desc').textContent =
        `Download ${count} tracked job${count === 1 ? '' : 's'} as a JSON backup`;
      document.getElementById('modal-config').removeAttribute('hidden');
    });
  }

  function closeModal() {
    document.getElementById('modal-config').setAttribute('hidden', '');
  }

  document.getElementById('btn-config').addEventListener('click', openModal);
  document.getElementById('modal-close').addEventListener('click', closeModal);
  document.getElementById('modal-config').addEventListener('click', e => {
    if (e.target === document.getElementById('modal-config')) closeModal();
  });

  document.getElementById('cfg-color-left').addEventListener('change', e => {
    saveSetting('colorLeft', e.target.checked);
  });
  document.getElementById('cfg-color-right').addEventListener('change', e => {
    saveSetting('colorRight', e.target.checked);
  });

  document.getElementById('btn-export').addEventListener('click', () => {
    chrome.storage.local.get(null, all => {
      const data = {};
      for (const [k, v] of Object.entries(all)) {
        if (k.startsWith('ljt_') && k !== 'ljt_settings') data[k] = v;
      }
      const json = JSON.stringify(data, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `job-tracker-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    });
  });

  document.getElementById('btn-import').addEventListener('click', () => {
    document.getElementById('import-file').click();
  });

  document.getElementById('import-file').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      let data;
      try {
        data = JSON.parse(ev.target.result);
      } catch {
        alert('Invalid JSON file.');
        return;
      }
      const valid = Object.entries(data).filter(([k]) => k.startsWith('ljt_') && k !== 'ljt_settings');
      if (!valid.length) {
        alert('No valid job data found in this file.');
        return;
      }
      const toImport = Object.fromEntries(valid);
      chrome.storage.local.set(toImport, () => {
        e.target.value = '';
        closeModal();
        init();
      });
    };
    reader.readAsText(file);
  });

  // ── Boot ──────────────────────────────────────────────────────────────────

  init();
})();
