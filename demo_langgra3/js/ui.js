/* ── HELPER FUNCTIONS ─────────────────────────── */

/* upstream output contract → downstream input contract 동기화 (canvas.js에도 정의됨, 여기서는 alias) */
function applyInputCopy(fromNode, toNode) {
  // 구버전 호환: contract 기반으로 전환됐으므로 contract가 있으면 그걸 씀
  if (fromNode.outputContract) {
    toNode.inputContract = JSON.parse(JSON.stringify(fromNode.outputContract));
    if (typeof updateNodeIODisplay === 'function') updateNodeIODisplay(toNode.id);
  }
}

function finalizeEdge(from, to, fromNode, toNode) {
  pushHistory();
  // 엣지는 항상 valid — 문자열 비교 제거
  state.edges.push({ from, to, valid: true });
  drawEdges();
  validatePipeline();
}

/* ── MODAL ────────────────────────────────────── */
function showModal(title, bodyHTML) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML = bodyHTML;
  modalOverlay.classList.remove('hidden');
}

document.getElementById('modal-close').addEventListener('click', () => {
  modalOverlay.classList.add('hidden');
});

modalOverlay.addEventListener('click', e => {
  if (e.target === modalOverlay) modalOverlay.classList.add('hidden');
});

/* ── CONFIRM DIALOG ───────────────────────────── */
function showConfirm(title, bodyHTML, onYes, onNo) {
  document.getElementById('confirm-title').textContent = title;
  document.getElementById('confirm-body').innerHTML = bodyHTML;
  document.getElementById('confirm-overlay').classList.remove('hidden');

  const yesBtn = document.getElementById('confirm-yes');
  const noBtn  = document.getElementById('confirm-no');
  const newYes = yesBtn.cloneNode(true);
  const newNo  = noBtn.cloneNode(true);
  yesBtn.replaceWith(newYes);
  noBtn.replaceWith(newNo);

  function closeConfirm() {
    document.getElementById('confirm-overlay').classList.add('hidden');
    document.removeEventListener('keydown', onKey);
  }

  function onKey(e) {
    if (e.key === 'Enter') { e.preventDefault(); closeConfirm(); onYes(); }
    if (e.key === 'Escape') { e.preventDefault(); closeConfirm(); if (onNo) onNo(); }
  }
  document.addEventListener('keydown', onKey);

  document.getElementById('confirm-yes').addEventListener('click', () => { closeConfirm(); onYes(); });
  document.getElementById('confirm-no').addEventListener('click',  () => { closeConfirm(); if (onNo) onNo(); });
}

/* ── MEMO TOOLTIP ─────────────────────────────── */
const cellTooltip = document.getElementById('cell-tooltip');
let tooltipTimer = null;

function showTooltip(nodeEl, node) {
  if (!node.memo) return;
  const wrap = document.getElementById('canvas-wrap').getBoundingClientRect();
  const nr   = nodeEl.getBoundingClientRect();

  cellTooltip.textContent = node.memo;
  cellTooltip.classList.remove('hidden');

  const tw = cellTooltip.offsetWidth || 220;
  const th = cellTooltip.offsetHeight || 60;
  let tx = (nr.right - wrap.left + 12) / state.zoom;
  let ty = (nr.top   - wrap.top  + (nr.height - th) / 2) / state.zoom;

  const canvasW = wrap.width / state.zoom;
  if (tx + tw > canvasW - 10) tx = (nr.left - wrap.left - tw - 12) / state.zoom;
  if (ty < 8) ty = 8;

  cellTooltip.style.left = tx + 'px';
  cellTooltip.style.top  = ty + 'px';
}

function hideTooltip() {
  clearTimeout(tooltipTimer);
  tooltipTimer = null;
  cellTooltip.classList.add('hidden');
}

function attachTooltipListeners(el, node) {
  el.addEventListener('mouseenter', () => {
    clearTimeout(tooltipTimer);
    tooltipTimer = setTimeout(() => showTooltip(el, node), 700);
  });
  el.addEventListener('mouseleave', hideTooltip);
  el.addEventListener('mousedown',  hideTooltip);
}
