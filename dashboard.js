(() => {
  'use strict';

  // ── State ─────────────────────────────────────────────────────────────────

  let allJobs = [];
  const filters = {
    search: '',
    status: '',
    sort: 'newest',
    group: false,
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

  async function loadJobs() {
    return new Promise(resolve => {
      chrome.storage.local.get(null, all => {
        const jobs = [];
        for (const [key, val] of Object.entries(all)) {
          if (!key.startsWith('ljt_')) continue;
          if (!val || !val.status || val.status === 'None') continue;

          const fb = parseKeyFallback(key);
          jobs.push({
            key,
            status:    val.status,
            rating:    typeof val.rating === 'number' ? val.rating : 0,
            seen_at:   val.seen_at || 0,
            title:     val.title    || fb.title    || '',
            company:   val.company  || fb.company  || '',
            location:  val.location || fb.location || '',
            workplace: val.workplace || fb.workplace || '',
          });
        }
        resolve(jobs);
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

    if (filters.status) {
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
    const sc = job.status.toLowerCase();
    const date = formatDate(job.seen_at);

    const metaParts = [job.company, job.location, job.workplace].filter(Boolean);
    const meta = esc(metaParts.join(' · '));

    const titleHtml = job.title
      ? esc(job.title)
      : '<span class="no-title">Unknown Position</span>';

    return `
      <div class="job-card status-${sc}">
        <div class="job-card-accent"></div>
        <div class="job-card-body">
          <div class="job-card-top">
            <div class="job-title">${titleHtml}</div>
            <div class="job-rating">${renderStars(job.rating)}</div>
          </div>
          <div class="job-card-bottom">
            <div class="job-meta">${meta || '<span style="color:var(--text-3)">No details</span>'}</div>
            <div class="job-right">
              <span class="job-status-pill status-${sc}-pill">${esc(job.status)}</span>
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
    const order = ['Applied', 'Seen', 'Skip'];
    const grouped = { Applied: [], Seen: [], Skip: [] };

    for (const j of jobs) {
      if (grouped[j.status]) grouped[j.status].push(j);
    }

    let html = '';
    for (const status of order) {
      const group = grouped[status];
      if (!group.length) continue;
      const sc = status.toLowerCase();
      html += `
        <div class="group-section">
          <div class="group-header status-${sc}-header">
            <span class="group-label">${status}</span>
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
    document.getElementById('stat-total').textContent   = allJobs.length;
    document.getElementById('stat-applied').textContent = allJobs.filter(j => j.status === 'Applied').length;
    document.getElementById('stat-seen').textContent    = allJobs.filter(j => j.status === 'Seen').length;
    document.getElementById('stat-skip').textContent    = allJobs.filter(j => j.status === 'Skip').length;
  }

  // ── Main render ───────────────────────────────────────────────────────────

  function render() {
    const filtered = applyFilters(allJobs);
    const list = document.getElementById('job-list');
    list.innerHTML = filters.group ? renderGrouped(filtered) : renderFlat(filtered);
    updateStats();
  }

  // ── Init ──────────────────────────────────────────────────────────────────

  async function init() {
    allJobs = await loadJobs();
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
    const relevant = Object.keys(changes).some(k => k.startsWith('ljt_'));
    if (relevant) init();
  });

  // ── Boot ──────────────────────────────────────────────────────────────────

  init();
})();
