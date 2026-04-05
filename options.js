// ── Shared Status Configuration ───────────────────────────────────────────────
// Single source of truth for all status options.
// Loaded before content.js (via manifest) and before dashboard.js (via HTML).

const LJT_STATUS_OPTIONS = [
  {
    value:    'None',
    label:    'None',
    icon:     '',
    cssKey:   'none',
    color:    null,
    colorDim: null,
  },
  {
    value:    'Seen',
    label:    'Seen',
    icon:     '👁',
    cssKey:   'seen',
    color:    '#f59e0b',
    colorDim: 'rgba(245,158,11,0.12)',
  },
  {
    value:    'To Apply',
    label:    'To Apply',
    icon:     '🎯',
    cssKey:   'to-apply',
    color:    '#3b82f6',
    colorDim: 'rgba(59,130,246,0.12)',
  },
  {
    value:    'Applied',
    label:    'Applied',
    icon:     '✅',
    cssKey:   'applied',
    color:    '#34d399',
    colorDim: 'rgba(52,211,153,0.12)',
  },
  {
    value:    'Skip',
    label:    'Skip',
    icon:     '🗑',
    cssKey:   'skip',
    color:    '#fb7185',
    colorDim: 'rgba(251,113,133,0.12)',
  },
];

// Returns the option object for a given value (falls back to None).
function ljtStatusOption(value) {
  return LJT_STATUS_OPTIONS.find(o => o.value === value) || LJT_STATUS_OPTIONS[0];
}

// Returns the CSS key for a status value (safe to use in class names).
function ljtStatusCssKey(value) {
  return ljtStatusOption(value).cssKey;
}
