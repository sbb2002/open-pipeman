/* ── CUSTOM COLOR PICKER ──────────────────────── */
const ccpPopup   = document.getElementById('custom-color-popup');
const ccpCanvas  = document.getElementById('ccp-canvas');
const ccpCtx     = ccpCanvas.getContext('2d');
const ccpCursor  = document.getElementById('ccp-sv-cursor');
const ccpHueStrip= document.getElementById('ccp-hue-strip');
const ccpHueThumb= document.getElementById('ccp-hue-thumb');
const ccpPreview = document.getElementById('ccp-preview');
const ccpHexInput= document.getElementById('ccp-hex-input');

let ccp = { hue:0, s:1, v:1, onApply: null, anchorBtn: null };
let ccpDragging = null; // 'sv' | 'hue'

function hsvToHex(h, s, v) {
  let r,g,b;
  const i = Math.floor(h/60)%6, f=h/60-Math.floor(h/60), p=v*(1-s), q=v*(1-f*s), t=v*(1-(1-f)*s);
  [[r,g,b]=[v,t,p],[r,g,b]=[q,v,p],[r,g,b]=[p,v,t],[r,g,b]=[p,q,v],[r,g,b]=[t,p,v],[r,g,b]=[v,p,q]][i];
  const toHex = x => Math.round(x*255).toString(16).padStart(2,'0');
  return '#'+toHex(r)+toHex(g)+toHex(b);
}

function hexToHsv(hex) {
  const r=parseInt(hex.slice(1,3),16)/255, g=parseInt(hex.slice(3,5),16)/255, b=parseInt(hex.slice(5,7),16)/255;
  const max=Math.max(r,g,b), min=Math.min(r,g,b), d=max-min;
  let h=0;
  if(d>0){
    if(max===r) h=((g-b)/d+6)%6;
    else if(max===g) h=(b-r)/d+2;
    else h=(r-g)/d+4;
    h*=60;
  }
  return { hue:h, s:max?d/max:0, v:max };
}

function ccpDrawSV() {
  const w=180, h=140;
  const grad1 = ccpCtx.createLinearGradient(0,0,w,0);
  grad1.addColorStop(0,'#fff');
  grad1.addColorStop(1,`hsl(${ccp.hue},100%,50%)`);
  ccpCtx.fillStyle = grad1;
  ccpCtx.fillRect(0,0,w,h);
  const grad2 = ccpCtx.createLinearGradient(0,0,0,h);
  grad2.addColorStop(0,'rgba(0,0,0,0)');
  grad2.addColorStop(1,'#000');
  ccpCtx.fillStyle = grad2;
  ccpCtx.fillRect(0,0,w,h);
}

function ccpUpdateUI() {
  ccpDrawSV();
  const hex = hsvToHex(ccp.hue, ccp.s, ccp.v);
  ccpPreview.style.background = hex;
  ccpHexInput.value = hex.toUpperCase();
  ccpCursor.style.left = (ccp.s * 180) + 'px';
  ccpCursor.style.top  = ((1 - ccp.v) * 140) + 'px';
  ccpHueThumb.style.left = (ccp.hue / 360 * 100) + '%';
}

function ccpOpen(anchorBtn, currentHex, onApply) {
  ccp.onApply = onApply;
  ccp.anchorBtn = anchorBtn;
  const parsed = /^#[0-9a-f]{6}$/i.test(currentHex) ? hexToHsv(currentHex) : {hue:0,s:1,v:0.5};
  ccp.hue = parsed.hue; ccp.s = parsed.s; ccp.v = parsed.v;
  ccpUpdateUI();
  ccpPopup.classList.remove('hidden');

  const rect = anchorBtn.getBoundingClientRect();
  const pw = 216, ph = 200;
  let left = rect.right + 8;
  let top  = rect.top + rect.height/2 - ph/2;
  if (left + pw > window.innerWidth - 8) left = rect.left - pw - 8;
  if (top < 8) top = 8;
  if (top + ph > window.innerHeight - 8) top = window.innerHeight - ph - 8;
  ccpPopup.style.left = left + 'px';
  ccpPopup.style.top  = top  + 'px';
}

function ccpClose() { ccpPopup.classList.add('hidden'); }

ccpCanvas.addEventListener('mousedown', e => { ccpDragging = 'sv'; ccpSVMove(e); });
document.addEventListener('mousemove', e => {
  if (ccpDragging === 'sv') ccpSVMove(e);
  else if (ccpDragging === 'hue') ccpHueMove(e);
});
document.addEventListener('mouseup', () => { ccpDragging = null; });

function ccpSVMove(e) {
  const r = ccpCanvas.getBoundingClientRect();
  ccp.s = Math.max(0, Math.min(1, (e.clientX - r.left) / 180));
  ccp.v = Math.max(0, Math.min(1, 1 - (e.clientY - r.top) / 140));
  ccpUpdateUI();
  if (ccp.onApply) ccp.onApply(hsvToHex(ccp.hue, ccp.s, ccp.v), false);
}

ccpHueStrip.addEventListener('mousedown', e => { ccpDragging = 'hue'; ccpHueMove(e); });

function ccpHueMove(e) {
  const r = ccpHueStrip.getBoundingClientRect();
  ccp.hue = Math.max(0, Math.min(360, (e.clientX - r.left) / 180 * 360));
  ccpUpdateUI();
  if (ccp.onApply) ccp.onApply(hsvToHex(ccp.hue, ccp.s, ccp.v), false);
}

ccpHexInput.addEventListener('input', e => {
  const v = e.target.value;
  if (/^#[0-9a-f]{6}$/i.test(v)) {
    const h = hexToHsv(v); ccp.hue=h.hue; ccp.s=h.s; ccp.v=h.v;
    ccpUpdateUI();
    if (ccp.onApply) ccp.onApply(v.toUpperCase(), false);
  }
});

document.getElementById('ccp-apply').addEventListener('click', () => {
  const hex = hsvToHex(ccp.hue, ccp.s, ccp.v);
  if (ccp.onApply) ccp.onApply(hex, true);
  ccpClose();
});

document.addEventListener('mousedown', e => {
  if (!ccpPopup.classList.contains('hidden') && !ccpPopup.contains(e.target) && !e.target.classList.contains('rainbow-picker-btn') && !e.target.classList.contains('rainbow-swatch'))
    ccpClose();
});

function openColorPicker(anchorBtn, currentHex, onApply) {
  ccpOpen(anchorBtn, currentHex || '#000000', onApply);
}

/* ── SETTINGS TABS ────────────────────────────── */
document.querySelectorAll('.settings-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.settings-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.settings-tab-panel').forEach(p => p.classList.add('hidden'));
    tab.classList.add('active');
    document.getElementById('tab-' + tab.dataset.tab)?.classList.remove('hidden');
  });
});

document.querySelectorAll('.apikey-toggle').forEach(btn => {
  btn.addEventListener('click', () => {
    const input = document.getElementById(btn.dataset.target);
    if (!input) return;
    input.type = input.type === 'password' ? 'text' : 'password';
  });
});

window.getHRStrictness = () => {
  const val = parseInt(document.getElementById('hr-strictness-slider')?.value ?? '0', 10);
  return ['low', 'medium', 'high'][val] || 'low';
};

const _hrLabels = ['Low', 'Medium', 'High'];
const _hrDescs  = [
  'L2+ (Mutating, Network) 자동 리뷰',
  'L1+ (I/O, Mutating, Network) 자동 리뷰',
  '모든 레벨 리뷰 (L0 포함)',
];
document.getElementById('hr-strictness-slider')?.addEventListener('input', e => {
  const val = parseInt(e.target.value, 10);
  const labelEl = document.getElementById('hr-strictness-label');
  const descEl  = document.getElementById('hr-strictness-desc');
  if (labelEl) labelEl.textContent = _hrLabels[val] || 'Low';
  if (descEl)  descEl.textContent  = _hrDescs[val]  || '';
});

/* ── MAX RETRIES ──────────────────────────────── */
// 5단계 quantized: 인덱스 0~4 → 실제값 [3, 5, 10, 20, 0(=no-limit)]
const _RETRY_STEPS  = [3, 5, 10, 20, 0];

window.getMaxRetries = () => {
  const idx = parseInt(document.getElementById('max-retries-slider')?.value ?? '0', 10);
  return _RETRY_STEPS[idx] ?? 3;
};

function _retrySnapToStep(inputVal) {
  const n = parseInt(inputVal, 10);
  if (isNaN(n)) return _RETRY_STEPS.length - 1;
  let best = 0, bestDist = Infinity;
  _RETRY_STEPS.forEach((v, i) => {
    if (v === 0) return;
    const d = Math.abs(v - n);
    if (d < bestDist) { bestDist = d; best = i; }
  });
  return best;
}

function _syncRetrySliderToInput(idx) {
  const isNoLimit = _RETRY_STEPS[idx] === 0;
  const inputEl = document.getElementById('max-retries-input');
  if (inputEl) {
    inputEl.value       = isNoLimit ? '' : _RETRY_STEPS[idx];
    inputEl.placeholder = isNoLimit ? 'No limit' : '';
  }
}

function _syncRetryInputToSlider(raw) {
  const sliderEl = document.getElementById('max-retries-slider');
  if (!sliderEl) return;
  if (!raw || raw.trim() === '') {
    sliderEl.value = _RETRY_STEPS.length - 1;
    _syncRetrySliderToInput(_RETRY_STEPS.length - 1);
    return;
  }
  const idx = _retrySnapToStep(raw);
  sliderEl.value = idx;
  _syncRetrySliderToInput(idx);
}

document.getElementById('max-retries-slider')?.addEventListener('input', e => {
  _syncRetrySliderToInput(parseInt(e.target.value, 10));
});

document.getElementById('max-retries-input')?.addEventListener('blur', e => {
  _syncRetryInputToSlider(e.target.value.trim());
  const idx = parseInt(document.getElementById('max-retries-slider')?.value ?? '0', 10);
  e.target.value       = _RETRY_STEPS[idx] === 0 ? '' : _RETRY_STEPS[idx];
  e.target.placeholder = _RETRY_STEPS[idx] === 0 ? 'No limit' : '';
});

window.getApiKeys = () => ({
  anthropic: document.getElementById('apikey-anthropic')?.value || '',
  google:    document.getElementById('apikey-google')?.value    || '',
  openai:    document.getElementById('apikey-openai')?.value    || '',
  e2b:       document.getElementById('apikey-e2b')?.value       || '',
  backend:   document.getElementById('apikey-backend')?.value   || 'http://localhost:8000',
});

/* ── SETTINGS ─────────────────────────────────── */
const settingsState = {
  theme:       'dark',
  pattern:     'cross',
  cellColor:   'default',
  cellRadius:  10,
  inputColor:  '#1e3a5f',
  outputColor: '#5f1e1e',
  fontFamily:   'sans',
  fontSizeName:  13,
  fontSizeIO:    10,
  fontColorName: 'default',
  fontColorIO:   'default',
};

function contrastColor(hex) {
  const h = hex.replace('#','');
  const r = parseInt(h.substr(0,2),16);
  const g = parseInt(h.substr(2,2),16);
  const b = parseInt(h.substr(4,2),16);
  const lum = (0.299*r + 0.587*g + 0.114*b) / 255;
  return lum > 0.5 ? '#111111' : '#f0f0f0';
}

function buildPlusSVG() {
  const color = settingsState.theme === 'light'
    ? 'rgba(0,0,0,0.15)'
    : 'rgba(255,255,255,0.13)';
  const enc = encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='56' height='56'>` +
    `<line x1='28' y1='22' x2='28' y2='34' stroke='${color}' stroke-width='2' stroke-linecap='round'/>` +
    `<line x1='22' y1='28' x2='34' y2='28' stroke='${color}' stroke-width='2' stroke-linecap='round'/>` +
    `</svg>`
  );
  return `url("data:image/svg+xml,${enc}")`;
}

function applyPattern(pattern) {
  const wrap = document.getElementById('canvas-wrap');
  const c = 'var(--pattern-color)';
  const patterns = {
    cross:    `linear-gradient(45deg, transparent 47%, ${c} 47%, ${c} 53%, transparent 53%), linear-gradient(-45deg, transparent 47%, ${c} 47%, ${c} 53%, transparent 53%)`,
    dots:     `radial-gradient(circle at 3px 3px, ${c} 4px, transparent 0)`,
    grid:     `linear-gradient(${c} 1px, transparent 1px), linear-gradient(90deg, ${c} 1px, transparent 1px)`,
    diagonal: buildPlusSVG(),
    none:     `linear-gradient(45deg, transparent 47%, ${c} 47%, ${c} 53%, transparent 53%)`,
  };
  const sizes = { cross:'64px 64px', dots:'56px 56px', grid:'40px 40px', diagonal:'56px 56px', none:'64px 64px' };
  wrap.style.backgroundImage = patterns[pattern] || 'none';
  wrap.style.backgroundSize  = sizes[pattern] || '';
}

function applyCellColor(color) {
  const bg = color === 'default' ? null : color;
  const textColor = bg ? contrastColor(bg) : null;
  document.querySelectorAll('.cell-node').forEach(el => {
    const nodeId = parseInt(el.id.replace('node-', ''));
    const n = state.nodes.find(x => x.id === nodeId);
    if (n && (n.type === 'input' || n.type === 'output')) return;
    el.style.background = bg || '';
    const nameEl = el.querySelector('.cell-node-name');
    if (nameEl) nameEl.style.color = textColor || '';
  });
  settingsState.cellColor = color;
  settingsState._cellBg    = bg;
  settingsState._cellText  = textColor;
}

function applyIOColor(type, color) {
  if (type === 'input')  settingsState.inputColor  = color;
  if (type === 'output') settingsState.outputColor = color;
  const contrast = contrastColor(color);
  state.nodes
    .filter(n => n.type === type)
    .forEach(n => {
      const el = document.getElementById(`node-${n.id}`);
      if (!el) return;
      el.style.background = color;
      const nameEl = el.querySelector('.cell-node-name');
      if (nameEl) nameEl.style.color = contrast;
      el.querySelectorAll('.io-label-text').forEach(lbl => { lbl.style.color = contrast; });
      el.querySelectorAll('.cell-io-type').forEach(chip => {
        chip.style.color = contrast;
        chip.style.background = 'rgba(128,128,128,0.15)';
      });
      const typeLabel = el.querySelector('.cell-node-type');
      if (typeLabel) typeLabel.style.color = contrast === '#111111' ? 'rgba(0,0,0,0.45)' : 'rgba(255,255,255,0.45)';
    });
}

function applyCellRadius(r) {
  settingsState.cellRadius = r;
  document.querySelectorAll('.cell-node').forEach(el => {
    el.style.borderRadius = r + 'px';
  });
}

function applyTheme(theme) {
  settingsState.theme = theme;
  document.body.classList.toggle('theme-light', theme === 'light');
  requestAnimationFrame(() => applyPattern(settingsState.pattern));
}

const _origRenderNode = renderNode;

document.getElementById('btn-settings').addEventListener('click', () => {
  document.getElementById('settings-overlay').classList.remove('hidden');
});

document.getElementById('settings-close').addEventListener('click', () => {
  document.getElementById('settings-overlay').classList.add('hidden');
});

document.getElementById('settings-overlay').addEventListener('click', e => {
  if (e.target === document.getElementById('settings-overlay'))
    document.getElementById('settings-overlay').classList.add('hidden');
});

document.querySelectorAll('.theme-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.theme-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    applyTheme(btn.dataset.theme);
  });
});

document.querySelectorAll('.pattern-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.pattern-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    settingsState.pattern = btn.dataset.pattern;
    applyPattern(btn.dataset.pattern);
  });
});

document.querySelectorAll('.cell-color-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    if (btn.classList.contains('rainbow-picker-btn')) {
      const curColor = settingsState._cellBg || '#13161b';
      openColorPicker(btn, curColor, (hex, done) => {
        document.querySelectorAll('.cell-color-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        applyCellColor(hex);
      });
      return;
    }
    document.querySelectorAll('.cell-color-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    applyCellColor(btn.dataset.color);
  });
});

/* ── FONT SETTINGS ─────────────────────────────── */
const FONT_MAP = {
  sans:  "var(--font-sans)",
  mono:  "var(--font-mono)",
  serif: "var(--font-serif)",
};

function applyFontFamily(family) {
  settingsState.fontFamily = family;
  const fontVal = FONT_MAP[family] || FONT_MAP.sans;
  document.querySelectorAll('.cell-node-name').forEach(el => {
    el.style.fontFamily = fontVal;
  });
}

function applyFontColor(target, color) {
  const isDefault = color === 'default';
  if (target === 'name') {
    settingsState.fontColorName = color;
    document.querySelectorAll('.cell-node-name').forEach(el => {
      const nodeId = parseInt(el.closest('.cell-node')?.id.replace('node-', '') || '0');
      const n = state.nodes.find(x => x.id === nodeId);
      const isIO = n && (n.type === 'input' || n.type === 'output');
      if (!isIO) el.style.color = isDefault ? '' : color;
    });
  } else {
    settingsState.fontColorIO = color;
    document.querySelectorAll('.cell-io-type').forEach(el => {
      el.style.color = isDefault ? '' : color;
    });
  }
}

function applyFontSize(target, size) {
  if (target === 'name') {
    settingsState.fontSizeName = size;
    document.querySelectorAll('.cell-node-name').forEach(el => {
      el.style.fontSize = size + 'px';
    });
    document.getElementById('font-size-name-label').textContent = size + 'px';
  } else {
    settingsState.fontSizeIO = size;
    document.querySelectorAll('.cell-io-type').forEach(el => {
      el.style.fontSize = size + 'px';
    });
    document.getElementById('font-size-io-label').textContent = size + 'px';
  }
}

document.querySelectorAll('.font-family-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.font-family-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    applyFontFamily(btn.dataset.font);
  });
});

document.querySelectorAll('.font-size-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const target = btn.dataset.target;
    const delta  = parseInt(btn.dataset.delta);
    const cur    = target === 'name' ? settingsState.fontSizeName : settingsState.fontSizeIO;
    const min    = target === 'name' ? 9 : 8;
    const max    = target === 'name' ? 22 : 16;
    const next   = Math.min(max, Math.max(min, cur + delta));
    applyFontSize(target, next);
  });
});

document.querySelectorAll('.font-color-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const target = btn.dataset.target;
    document.querySelectorAll(`.font-color-btn[data-target="${target}"]`).forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const picker = document.getElementById(`font-color-${target}-custom`);
    if (picker && btn.dataset.color !== 'default') picker.value = btn.dataset.color;
    applyFontColor(target, btn.dataset.color);
  });
});

document.getElementById('font-color-name-custom').addEventListener('input', e => {
  document.querySelectorAll('.font-color-btn[data-target="name"]').forEach(b => b.classList.remove('active'));
  applyFontColor('name', e.target.value);
});

document.getElementById('font-color-io-custom').addEventListener('input', e => {
  document.querySelectorAll('.font-color-btn[data-target="io"]').forEach(b => b.classList.remove('active'));
  applyFontColor('io', e.target.value);
});

document.querySelectorAll('.io-color-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const target = btn.dataset.target;
    if (btn.classList.contains('rainbow-picker-btn')) {
      const curColor = target === 'input' ? settingsState.inputColor : settingsState.outputColor;
      openColorPicker(btn, curColor, (hex, done) => {
        document.querySelectorAll(`.io-color-btn[data-target="${target}"]`).forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        applyIOColor(target, hex);
      });
      return;
    }
    document.querySelectorAll(`.io-color-btn[data-target="${target}"]`).forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    applyIOColor(target, btn.dataset.color);
  });
});

document.querySelectorAll('.cell-shape-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.cell-shape-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    applyCellRadius(parseInt(btn.dataset.radius));
  });
});

const _applySettingsToNode = (nodeEl) => {
  const nodeId = parseInt(nodeEl.id.replace('node-', ''));
  const n = state.nodes.find(x => x.id === nodeId);
  if (n && (n.type === 'input' || n.type === 'output')) {
    const ioColor = n.type === 'input' ? settingsState.inputColor : settingsState.outputColor;
    nodeEl.style.background = ioColor;
    const contrast = contrastColor(ioColor);
    const nameEl = nodeEl.querySelector('.cell-node-name');
    if (nameEl) nameEl.style.color = contrast;
    nodeEl.querySelectorAll('.io-label-text').forEach(el => { el.style.color = contrast; });
    nodeEl.querySelectorAll('.cell-io-type').forEach(el => { el.style.color = contrast; el.style.background = 'rgba(128,128,128,0.15)'; });
    const typeLabel = nodeEl.querySelector('.cell-node-type');
    if (typeLabel) typeLabel.style.color = contrast === '#111111' ? 'rgba(0,0,0,0.45)' : 'rgba(255,255,255,0.45)';
  } else {
    if (settingsState._cellBg) {
      nodeEl.style.background = settingsState._cellBg;
      const nameEl = nodeEl.querySelector('.cell-node-name');
      if (nameEl && settingsState._cellText) nameEl.style.color = settingsState._cellText;
    }
  }
  nodeEl.style.borderRadius = settingsState.cellRadius + 'px';
  const nameEl2 = nodeEl.querySelector('.cell-node-name');
  if (nameEl2) {
    nameEl2.style.fontFamily = FONT_MAP[settingsState.fontFamily] || FONT_MAP.sans;
    nameEl2.style.fontSize   = settingsState.fontSizeName + 'px';
    const nodeId2 = parseInt(nodeEl.id.replace('node-', ''));
    const n2 = state.nodes.find(x => x.id === nodeId2);
    const isIO2 = n2 && (n2.type === 'input' || n2.type === 'output');
    if (!isIO2 && settingsState.fontColorName !== 'default') nameEl2.style.color = settingsState.fontColorName;
  }
  nodeEl.querySelectorAll('.cell-io-type').forEach(el => {
    el.style.fontSize = settingsState.fontSizeIO + 'px';
    if (settingsState.fontColorIO !== 'default') el.style.color = settingsState.fontColorIO;
  });
};

new MutationObserver(mutations => {
  mutations.forEach(m => {
    m.addedNodes.forEach(node => {
      if (node.classList && node.classList.contains('cell-node')) {
        _applySettingsToNode(node);
      }
    });
  });
}).observe(document.getElementById('canvas'), { childList: true });