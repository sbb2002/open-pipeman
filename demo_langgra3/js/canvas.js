/* ── TOOL MODE ───────────────────────────────── */
let _toolMode = 'cursor';

(function initToolTray() {
  const btnCursor  = document.getElementById('tool-cursor');
  const btnPan     = document.getElementById('tool-pan');
  const canvasWrap = document.getElementById('canvas-wrap');
  if (!btnCursor || !btnPan) return;
  function setToolMode(mode) {
    _toolMode = mode;
    btnCursor.classList.toggle('active', mode === 'cursor');
    btnPan.classList.toggle('active',    mode === 'pan');
    canvasWrap.style.cursor = mode === 'pan' ? 'grab' : '';
  }
  btnCursor.addEventListener('click', () => setToolMode('cursor'));
  btnPan.addEventListener('click',    () => setToolMode('pan'));
})();

/* ── PALETTE DRAG ─────────────────────────────── */
let dragType = null;
let _dragOffsetX = 0;
let _dragOffsetY = 0;
let _nodeDragMoved = false;

document.querySelectorAll('.palette-item').forEach(item => {
  item.addEventListener('dragstart', e => {
    dragType = item.dataset.type;
    e.dataTransfer.effectAllowed = 'copy';
    const rect = item.getBoundingClientRect();
    _dragOffsetX = e.clientX - rect.left;
    _dragOffsetY = e.clientY - rect.top;
  });
});

function handleDrop(e) {
  if (!dragType) return;
  const wrap = document.getElementById('canvas-wrap').getBoundingClientRect();
  const x = (e.clientX - wrap.left - _dragOffsetX - (state.panX || 0)) / state.zoom;
  const y = (e.clientY - wrap.top  - _dragOffsetY - (state.panY || 0)) / state.zoom;
  createNode(dragType, x, y);
  dragType = null;
}

/* ── CREATE NODE ──────────────────────────────── */
function createNode(type, x, y) {
  if (type === 'input' || type === 'output') {
    const existing = state.nodes.find(n => n.type === type);
    if (existing) {
      const label = type === 'input' ? 'Input' : 'Output';
      showModal(
        `${label} Cell 중복`,
        `<p>이미 <strong>${label} Cell</strong>이 존재합니다. ${label} Cell은 캔버스에 하나만 배치할 수 있습니다.</p>`
      );
      return;
    }
  }

  pushHistory();
  const id = state.nextId++;
  const labels = { cell: 'CELL', input: 'INPUT', output: 'OUTPUT' };
  const node = {
    id, type,
    name: `${labels[type] || 'CELL'} ${id}`,
    x, y,
    model: '',
    inputContract: null,
    outputContract: null,
    prompt: '',
    webSearch: false, domains: '',
    memo: '',
    status: 'pending',
  };
  state.nodes.push(node);
  renderNode(node);
  hint.classList.add('hidden');
  validatePipeline();
}

/* contract의 properties를 "key: type" 줄 목록으로 변환 */
function _contractLines(contract) {
  if (!contract || !contract.properties) return [];
  return Object.entries(contract.properties).map(([k, v]) => `${k}: ${v.type || '?'}`);
}

function renderNode(node) {
  const el = document.createElement('div');
  el.className = 'cell-node pending';
  el.id = 'node-' + node.id;
  el.style.left = node.x + 'px';
  el.style.top  = node.y + 'px';

  const showIN  = node.type !== 'output';
  const showOUT = node.type !== 'input';

  // status dot
  const dot = document.createElement('div');
  dot.className = 'cell-status-dot';
  el.appendChild(dot);

  // type label
  const typeEl = document.createElement('div');
  typeEl.className = 'cell-node-type';
  typeEl.textContent = node.type;
  el.appendChild(typeEl);

  // name
  const nameEl = document.createElement('div');
  nameEl.className = 'cell-node-name';
  nameEl.id = 'nn-' + node.id;
  nameEl.textContent = node.name;
  el.appendChild(nameEl);

  // I/O rows
  const ioWrap = document.createElement('div');
  ioWrap.className = 'cell-node-io';
  ioWrap.id = 'io-' + node.id;

  if (showIN) {
    _renderIOSection(ioWrap, node, 'input');
  }
  if (showOUT) {
    _renderIOSection(ioWrap, node, 'output');
  }

  el.appendChild(ioWrap);

  el.addEventListener('click', e => {
    e.stopPropagation();
    if (_nodeDragMoved) { _nodeDragMoved = false; return; }
    if (e.ctrlKey || e.metaKey) { handleCtrlClick(node.id); return; }
    handleNodeClick(node.id);
  });

  el.addEventListener('mousedown', e => {
    if (_toolMode === 'pan') return;
    if (state.connectingFrom !== null || state.connectingFromMulti !== null) return;
    if (e.button !== 0) return;
    e.preventDefault();
    const rect = el.getBoundingClientRect();
    const dragIds = state.selectedNodes.size > 0 && state.selectedNodes.has(node.id)
      ? [...state.selectedNodes]
      : [node.id];
    const startPositions = {};
    dragIds.forEach(nid => {
      const n = state.nodes.find(x => x.id === nid);
      if (n) startPositions[nid] = { x: n.x, y: n.y };
    });
    state.dragging = {
      nodeId: node.id,
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
      startX: e.clientX,
      startY: e.clientY,
      startPositions,
      dragIds,
      isCtrlDrag: e.ctrlKey || e.metaKey,
      hasMoved: false,
    };
  });

  attachTooltipListeners(el, node);
  canvas.appendChild(el);
}

/* I/O 섹션 렌더 헬퍼 (IN / OUT 공통) */
function _renderIOSection(container, node, side) {
  const isInput   = side === 'input';
  const contract  = isInput ? node.inputContract : node.outputContract;
  const lines     = _contractLines(contract);
  const labelText = isInput ? 'IN' : 'OUT';
  const typeClass = isInput ? 'cell-io-type' : 'cell-io-type output';

  if (lines.length === 0) {
    // contract 미정의: 단순 라벨만
    const row = document.createElement('div');
    row.className = 'cell-io-row';
    const lbl = document.createElement('span');
    lbl.className = 'cell-io-label io-label-text';
    lbl.textContent = labelText;
    const typ = document.createElement('span');
    typ.className = typeClass;
    typ.id = (isInput ? 'ni-' : 'no-') + node.id;
    typ.textContent = '—';
    row.appendChild(lbl);
    row.appendChild(typ);
    container.appendChild(row);
  } else {
    // contract 정의됨: 첫 줄에 라벨, 각 property를 "key: type"으로 표시
    lines.forEach((line, i) => {
      const row = document.createElement('div');
      row.className = 'cell-io-row';
      const lbl = document.createElement('span');
      lbl.className = 'cell-io-label io-label-text';
      lbl.textContent = i === 0 ? labelText : '';
      const typ = document.createElement('span');
      typ.className = typeClass;
      if (i === 0) typ.id = (isInput ? 'ni-' : 'no-') + node.id;
      typ.textContent = line;
      row.appendChild(lbl);
      row.appendChild(typ);
      container.appendChild(row);
    });
  }
}

/* 노드 I/O 표시 업데이트 (contract 변경 후 호출) */
function updateNodeIODisplay(nodeId) {
  const node   = state.nodes.find(n => n.id === nodeId);
  const ioWrap = document.getElementById('io-' + nodeId);
  if (!node || !ioWrap) return;

  ioWrap.innerHTML = '';
  if (node.type !== 'output') _renderIOSection(ioWrap, node, 'input');
  if (node.type !== 'input')  _renderIOSection(ioWrap, node, 'output');
}

/* ── GHOST ELEMENTS (Ctrl+drag preview) ──────── */
const ghostLayer = document.createElement('div');
ghostLayer.id = 'ghost-layer';
document.getElementById('canvas').appendChild(ghostLayer);

function buildGhosts(dragIds, startPositions) {
  ghostLayer.innerHTML = '';
  dragIds.forEach(nid => {
    const src = document.getElementById('node-' + nid);
    if (!src) return;
    const sp = startPositions[nid];
    const g = src.cloneNode(true);
    g.removeAttribute('id');
    g.classList.add('ghost-node');
    g.style.left = sp.x + 'px';
    g.style.top  = sp.y + 'px';
    g.style.pointerEvents = 'none';
    ghostLayer.appendChild(g);
  });
  ghostLayer.style.display = 'block';
}

function moveGhosts(dragIds, startPositions, dx, dy) {
  const ghosts = ghostLayer.querySelectorAll('.ghost-node');
  dragIds.forEach((nid, i) => {
    const sp = startPositions[nid];
    const g  = ghosts[i];
    if (!g) return;
    g.style.left = (sp.x + dx) + 'px';
    g.style.top  = (sp.y + dy) + 'px';
  });
}

function clearGhosts() {
  ghostLayer.innerHTML = '';
  ghostLayer.style.display = 'none';
}

document.addEventListener('mouseup', e => {
  if (!state.dragging) return;
  const d = state.dragging;
  state.dragging = null;

  if (d.hasMoved) _nodeDragMoved = true;

  if (d.isCtrlDrag && d.hasMoved) {
    clearGhosts();
    const dx = (e.clientX - d.startX) / state.zoom;
    const dy = (e.clientY - d.startY) / state.zoom;
    d.dragIds.forEach(nid => {
      const src = state.nodes.find(x => x.id === nid);
      if (!src) return;
      const sp = d.startPositions[nid];
      cloneNode(src, sp.x + dx, sp.y + dy);
    });
    drawEdges();
    validatePipeline();
  }
});

/* ── NODE CLICK / CONNECT ─────────────────────── */
function handleNodeClick(id) {
  if (state.connectingFromMulti !== null) {
    const sources = [...state.connectingFromMulti].filter(sid => sid !== id);
    state.connectingFromMulti = null;
    document.querySelectorAll('.cell-node').forEach(el => el.classList.remove('connecting-source', 'multi-selected', 'selected'));
    state.selectedNodes.clear();
    state.selectedNode = null;

    const toNode = state.nodes.find(n => n.id === id);

    sources.forEach(from => {
      const fromNode = state.nodes.find(n => n.id === from);
      if (!fromNode || !toNode) return;
      if (from === id) return;
      if (toNode.y <= fromNode.y) return;

      const existingEdge = state.edges.find(e => e.from === from && e.to === id);
      if (existingEdge) {
        pushHistory();
        state.edges = state.edges.filter(e => e !== existingEdge);
        drawEdges();
        return;
      }

      _attemptConnect(from, id, fromNode, toNode);
    });

    validatePipeline();
    return;
  }

  if (state.connectingFrom === null && state.selectedNodes.size > 1) {
    selectNode(id);
    return;
  }

  if (state.connectingFrom === null) {
    if (state.selectedNode === id) {
      state.connectingFrom = id;
      document.getElementById(`node-${id}`).classList.add('connecting-source');
      statusValid.textContent = '● Click another cell to connect...';
      statusValid.classList.remove('error');
      statusValid.classList.add('running');
      return;
    }
    selectNode(id);
  } else {
    const from = state.connectingFrom;
    const to   = id;
    state.connectingFrom = null;
    document.querySelectorAll('.cell-node').forEach(el => el.classList.remove('connecting-source'));

    if (from === to) { validatePipeline(); return; }

    const existingEdge = state.edges.find(e => e.from === from && e.to === to);
    if (existingEdge) {
      pushHistory();
      state.edges = state.edges.filter(e => e !== existingEdge);
      drawEdges();
      validatePipeline();
      return;
    }

    const fromNode = state.nodes.find(n => n.id === from);
    const toNode   = state.nodes.find(n => n.id === to);
    if (toNode.y <= fromNode.y) {
      const reason = toNode.y === fromNode.y
        ? '<p>같은 Y축 위치의 셀은 연결할 수 없습니다.</p>'
        : '<p>역방향 연결은 허용되지 않습니다. 연결은 위→아래 방향으로만 가능합니다.</p>';
      showModal('Connection Not Allowed', reason);
      validatePipeline();
      return;
    }

    state.edges = state.edges.filter(e => !(e.from === from && e.to === to));
    _attemptConnect(from, to, fromNode, toNode);
  }
}

/**
 * 연결 시도: upstream output contract → downstream input contract 동기화
 * - downstream에 이미 contract가 있으면 덮어쓰기 confirm
 * - 없으면 자동 동기화
 */
function _attemptConnect(from, to, fromNode, toNode) {
  const fromContract = fromNode.outputContract;
  const toContract   = toNode.inputContract;

  const hasFromContract = fromContract && fromContract.properties && Object.keys(fromContract.properties).length > 0;
  const hasToContract   = toContract   && toContract.properties   && Object.keys(toContract.properties).length > 0;

  if (!hasFromContract) {
    // upstream에 contract 없음 → 그냥 연결
    finalizeEdge(from, to, fromNode, toNode);
    return;
  }

  if (!hasToContract) {
    // downstream에 contract 없음 → 자동 동기화
    _syncInputContract(fromNode, toNode);
    finalizeEdge(from, to, fromNode, toNode);
    return;
  }

  // 양쪽 모두 contract 있음 → 덮어쓰기 confirm
  const fromKeys = Object.keys(fromContract.properties).map(k => `${k}: ${fromContract.properties[k].type}`).join(', ');
  const toKeys   = Object.keys(toContract.properties).map(k => `${k}: ${toContract.properties[k].type}`).join(', ');
  showConfirm(
    'Input Schema 덮어쓰기',
    `<p><strong>"${toNode.name}"</strong>의 Input Schema를 upstream Output Schema로 덮어쓰겠습니까?</p>
     <div class="confirm-diff">
       <div><span class="diff-label">현재 Input Schema</span><code>${toKeys}</code></div>
       <div><span class="diff-label">대체될 값 (Upstream Output)</span><code>${fromKeys}</code></div>
     </div>`,
    () => {
      _syncInputContract(fromNode, toNode);
      finalizeEdge(from, to, fromNode, toNode);
    },
    () => {
      // 취소: contract 동기화 없이 연결만
      finalizeEdge(from, to, fromNode, toNode);
    }
  );
}

/* upstream output contract → downstream input contract 복사 + DOM 업데이트 */
function _syncInputContract(fromNode, toNode) {
  toNode.inputContract = JSON.parse(JSON.stringify(fromNode.outputContract));
  updateNodeIODisplay(toNode.id);
  // Inspector가 이 노드를 보고 있으면 버튼 상태도 갱신
  if (state.selectedNode === toNode.id && typeof _updateSchemaBtnState === 'function') {
    _updateSchemaBtnState('input', toNode.inputContract);
  }
}

function selectNode(id) {
  state.selectedNode = id;
  state.selectedEdge = null;
  state.selectedNodes.clear();
  state.selectedNodes.add(id);
  document.querySelectorAll('.cell-node').forEach(el => el.classList.remove('selected', 'multi-selected'));
  document.getElementById(`node-${id}`)?.classList.add('selected');
  openInspector(id);
  drawEdges();
}

function handleCtrlClick(id) {
  if (state.connectingFrom !== null) return;
  if (state.selectedNodes.size === 1 && state.selectedNode !== null) {
    closeInspector();
  }
  if (state.selectedNodes.has(id)) {
    state.selectedNodes.delete(id);
    document.getElementById(`node-${id}`)?.classList.remove('selected', 'multi-selected');
  } else {
    state.selectedNodes.add(id);
    state.selectedNode = null;
    document.getElementById(`node-${id}`)?.classList.add('multi-selected');
  }
  if (state.selectedNodes.size === 1) {
    const onlyId = [...state.selectedNodes][0];
    selectNode(onlyId);
  }
}

function clearSelection() {
  state.selectedNode = null;
  state.selectedNodes.clear();
  document.querySelectorAll('.cell-node').forEach(el => el.classList.remove('selected', 'multi-selected'));
}

/* ── BOX SELECT (lasso) ───────────────────────── */
const lassoRect = document.createElement('div');
lassoRect.id = 'lasso-rect';
document.getElementById('canvas-wrap').appendChild(lassoRect);

let _lassoDidDrag = false;

document.getElementById('canvas-wrap').addEventListener('mousedown', e => {
  if (e.button !== 0) return;

  if (_toolMode === 'pan') {
    const canvasWrap = document.getElementById('canvas-wrap');
    canvasWrap.style.cursor = 'grabbing';
    const startX    = e.clientX;
    const startY    = e.clientY;
    const startPanX = state.panX || 0;
    const startPanY = state.panY || 0;
    function onPanMove(ev) {
      state.panX = startPanX + (ev.clientX - startX);
      state.panY = startPanY + (ev.clientY - startY);
      applyTransform();
    }
    function onPanUp() {
      canvasWrap.style.cursor = 'grab';
      document.removeEventListener('mousemove', onPanMove);
      document.removeEventListener('mouseup',   onPanUp);
    }
    document.addEventListener('mousemove', onPanMove);
    document.addEventListener('mouseup',   onPanUp);
    return;
  }

  if (state.connectingFrom !== null) return;
  if (state.dragging) return;
  const onCell = e.target.closest('.cell-node');
  if (onCell) return;
  const wrap   = document.getElementById('canvas-wrap').getBoundingClientRect();
  const startX = (e.clientX - wrap.left - (state.panX || 0)) / state.zoom;
  const startY = (e.clientY - wrap.top  - (state.panY || 0)) / state.zoom;
  state.boxSelect = { startX, startY, clientStartX: e.clientX, clientStartY: e.clientY };

  lassoRect.style.display = 'none';
  lassoRect.style.left   = (startX * state.zoom + (state.panX || 0)) + 'px';
  lassoRect.style.top    = (startY * state.zoom + (state.panY || 0)) + 'px';
  lassoRect.style.width  = '0px';
  lassoRect.style.height = '0px';
});

document.addEventListener('mousemove', e => {
  if (!state.dragging) return;
  const d = state.dragging;
  const dx = (e.clientX - d.startX) / state.zoom;
  const dy = (e.clientY - d.startY) / state.zoom;

  if (!d.hasMoved && (Math.abs(e.clientX - d.startX) > 3 || Math.abs(e.clientY - d.startY) > 3)) {
    d.hasMoved = true;
    if (d.isCtrlDrag) buildGhosts(d.dragIds, d.startPositions);
  }
  if (!d.hasMoved) return;

  if (d.isCtrlDrag) {
    moveGhosts(d.dragIds, d.startPositions, dx, dy);
  } else {
    d.dragIds.forEach(nid => {
      const n = state.nodes.find(x => x.id === nid);
      if (!n) return;
      const sp = d.startPositions[nid];
      n.x = sp.x + dx;
      n.y = sp.y + dy;
      const el = document.getElementById('node-' + nid);
      if (el) { el.style.left = n.x + 'px'; el.style.top = n.y + 'px'; }
    });
    drawEdges();
  }
});

document.addEventListener('mousemove', e => {
  if (!state.boxSelect) return;
  const wrap = document.getElementById('canvas-wrap').getBoundingClientRect();
  const curX = (e.clientX - wrap.left - (state.panX || 0)) / state.zoom;
  const curY = (e.clientY - wrap.top  - (state.panY || 0)) / state.zoom;
  const { startX, startY } = state.boxSelect;

  const dx = e.clientX - state.boxSelect.clientStartX;
  const dy = e.clientY - state.boxSelect.clientStartY;
  if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
    lassoRect.style.display = 'block';
  }

  const lx = Math.min(startX, curX) * state.zoom + (state.panX || 0);
  const ly = Math.min(startY, curY) * state.zoom + (state.panY || 0);
  const lw = Math.abs(curX - startX) * state.zoom;
  const lh = Math.abs(curY - startY) * state.zoom;
  lassoRect.style.left   = lx + 'px';
  lassoRect.style.top    = ly + 'px';
  lassoRect.style.width  = lw + 'px';
  lassoRect.style.height = lh + 'px';
});

document.addEventListener('mouseup', e => {
  if (!state.boxSelect) return;
  const bs = state.boxSelect;
  state.boxSelect = null;
  lassoRect.style.display = 'none';

  const wrap = document.getElementById('canvas-wrap').getBoundingClientRect();
  const endX = (e.clientX - wrap.left - (state.panX || 0)) / state.zoom;
  const endY = (e.clientY - wrap.top  - (state.panY || 0)) / state.zoom;

  const dx = e.clientX - bs.clientStartX;
  const dy = e.clientY - bs.clientStartY;
  if (Math.abs(dx) <= 4 && Math.abs(dy) <= 4) return;

  _lassoDidDrag = true;

  const selX1 = Math.min(bs.startX, endX);
  const selY1 = Math.min(bs.startY, endY);
  const selX2 = Math.max(bs.startX, endX);
  const selY2 = Math.max(bs.startY, endY);

  const NODE_W = 180;
  const NODE_H = 110;
  const hit = state.nodes.filter(n => {
    const el = document.getElementById(`node-${n.id}`);
    const nh = el ? el.offsetHeight : NODE_H;
    const nw = el ? el.offsetWidth  : NODE_W;
    return n.x < selX2 && n.x + nw > selX1 &&
           n.y < selY2 && n.y + nh > selY1;
  });

  if (hit.length === 0) {
    clearSelection();
    closeInspector();
    drawEdges();
    return;
  }

  closeInspector();
  state.selectedNode = null;
  state.selectedEdge = null;
  state.selectedNodes.clear();
  document.querySelectorAll('.cell-node').forEach(el => el.classList.remove('selected', 'multi-selected'));
  hit.forEach(n => {
    state.selectedNodes.add(n.id);
    document.getElementById(`node-${n.id}`)?.classList.add('multi-selected');
  });
  drawEdges();
});

canvas.addEventListener('click', e => {
  if (_lassoDidDrag) { _lassoDidDrag = false; return; }

  if (state.connectingFrom !== null || state.connectingFromMulti !== null) {
    state.connectingFrom = null;
    state.connectingFromMulti = null;
    document.querySelectorAll('.cell-node').forEach(el => el.classList.remove('connecting-source'));
    validatePipeline();
    return;
  }
  if (e.target === canvas || e.target === edgeCanvas) {
    const wrap = document.getElementById('canvas-wrap').getBoundingClientRect();
    const cx = e.clientX - wrap.left - (state.panX || 0);
    const cy = e.clientY - wrap.top  - (state.panY || 0);
    const hit = getEdgeAtPoint(cx, cy);
    if (hit) {
      clearSelection();
      state.selectedEdge = hit;
      drawEdges();
      return;
    }
  }
  state.selectedEdge = null;
  clearSelection();
  closeInspector();
  drawEdges();
});

/* ── DRAW EDGES ───────────────────────────────── */
function drawEdges() {
  ctx.clearRect(0, 0, edgeCanvas.width, edgeCanvas.height);

  state.edges.forEach(edge => {
    const fromNode = state.nodes.find(n => n.id === edge.from);
    const toNode   = state.nodes.find(n => n.id === edge.to);
    if (!fromNode || !toNode) return;

    const fromEl = document.getElementById(`node-${edge.from}`);
    const toEl   = document.getElementById(`node-${edge.to}`);
    if (!fromEl || !toEl) return;

    const fw = fromEl.offsetWidth;
    const fh = fromEl.offsetHeight;
    const tw = toEl.offsetWidth;

    const px = state.panX || 0;
    const py = state.panY || 0;
    const z  = state.zoom;
    const x1 = (fromNode.x + fw / 2) * z + px;
    const y1 = (fromNode.y + fh) * z + py;
    const x2 = (toNode.x  + tw / 2) * z + px;
    const y2 = (toNode.y) * z + py;

    // 항상 accent 색상(연결됨)으로 표시 — 문자열 비교 제거
    const color      = '#7ee8a2';
    const isSelected = state.selectedEdge === edge;

    if (isSelected) {
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.bezierCurveTo(x1, y1 + (y2 - y1) * 0.5, x2, y1 + (y2 - y1) * 0.5, x2, y2);
      ctx.strokeStyle = color;
      ctx.lineWidth = 10;
      ctx.globalAlpha = 0.18;
      ctx.setLineDash([]);
      ctx.stroke();
      ctx.globalAlpha = 1;

      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.bezierCurveTo(x1, y1 + (y2 - y1) * 0.5, x2, y1 + (y2 - y1) * 0.5, x2, y2);
      ctx.strokeStyle = color;
      ctx.lineWidth = 4;
      ctx.globalAlpha = 0.45;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.bezierCurveTo(x1, y1 + (y2 - y1) * 0.5, x2, y1 + (y2 - y1) * 0.5, x2, y2);
    ctx.strokeStyle = color;
    ctx.lineWidth = isSelected ? 2.5 : 2;
    ctx.setLineDash([]);
    ctx.stroke();

    drawArrow(ctx, x2, y2, color, isSelected);
  });
}

function drawArrow(ctx, x, y, color, selected = false) {
  const size = selected ? 10 : 8;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x - size / 2, y - size);
  ctx.lineTo(x + size / 2, y - size);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

/* ── CLONE NODE ───────────────────────────────── */
function cloneNode(src, x, y) {
  const id = state.nextId++;
  const node = {
    ...JSON.parse(JSON.stringify(src)),
    id, x, y,
    status: 'pending',
    name: src.name + ' (copy)',
  };
  state.nodes.push(node);
  renderNode(node);
  hint.classList.add('hidden');
  return node;
}

/* ── RESIZE CANVAS ────────────────────────────── */
function resizeCanvas() {
  const wrap = document.getElementById('canvas-wrap');
  edgeCanvas.width  = wrap.clientWidth;
  edgeCanvas.height = wrap.clientHeight;
  drawEdges();
}
window.addEventListener('resize', resizeCanvas);
requestAnimationFrame(resizeCanvas);
