/* ── STATE ───────────────────────────────────── */
const state = {
  nodes: [],          // { id, type, name, x, y, model, inputType, outputType, inputDesc, outputDesc, prompt, webSearch, domains, status }
  edges: [],          // { from, to, valid }
  selectedNode: null,
  selectedNodes: new Set(), // multi-select node ids
  selectedEdge: null, // currently selected edge object
  connectingFrom: null,
  nextId: 1,
  running: false,
  dragging: null,     // { nodeId, offsetX, offsetY, startPositions, isCtrlDrag }
  zoom: 1,            // current zoom level
  clipboard: null,    // copied node data
  history: [],        // undo stack — snapshots of { nodes, edges, nextId }
  redoStack: [],      // redo stack — cleared on any new action
};

/* ── DOM REFS ─────────────────────────────────── */
const canvas      = document.getElementById('canvas');
const edgeCanvas  = document.getElementById('edge-canvas');
const ctx         = edgeCanvas.getContext('2d');
const inspector   = document.getElementById('inspector');
const hint        = document.getElementById('canvas-hint');
const btnRun      = document.getElementById('btn-run');
const btnStop     = document.getElementById('btn-stop');
const modalOverlay= document.getElementById('modal-overlay');
const statusValid = document.getElementById('status-validity');
const fWebsearch  = document.getElementById('f-websearch');
const domainWrap  = document.getElementById('domain-wrap');

/* ── RESIZE CANVAS ────────────────────────────── */
function resizeCanvas() {
  const wrap = document.getElementById('canvas-wrap');
  edgeCanvas.width  = wrap.clientWidth;
  edgeCanvas.height = wrap.clientHeight;
  drawEdges();
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

/* ── PALETTE DRAG ─────────────────────────────── */
let dragType = null;

document.querySelectorAll('.palette-item').forEach(item => {
  item.addEventListener('dragstart', e => {
    dragType = item.dataset.type;
    e.dataTransfer.effectAllowed = 'copy';
  });
});

function handleDrop(e) {
  if (!dragType) return;
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left - 90;
  const y = e.clientY - rect.top  - 40;
  createNode(dragType, x, y);
  dragType = null;
}

/* ── CREATE NODE ──────────────────────────────── */
function createNode(type, x, y) {
  // Enforce single input / single output
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
    x: Math.max(0, x),
    y: Math.max(0, y),
    model: '', inputType: '', outputType: '',
    inputDesc: '', outputDesc: '', prompt: '',
    webSearch: false, domains: '',
    memo: '',
    status: 'pending',
  };
  state.nodes.push(node);
  renderNode(node);
  hint.classList.add('hidden');
  validatePipeline();
}

function renderNode(node) {
  const el = document.createElement('div');
  el.className = 'cell-node pending';
  el.id = `node-${node.id}`;
  el.style.left = node.x + 'px';
  el.style.top  = node.y + 'px';

  const showIN  = node.type !== 'output';
  const showOUT = node.type !== 'input';
  el.innerHTML = `
    <div class="cell-status-dot"></div>
    <div class="cell-node-type">${node.type}</div>
    <div class="cell-node-name" id="nn-${node.id}">${node.name}</div>
    <div class="cell-node-io">
      ${showIN  ? `<div class="cell-io-row">
        <span class="cell-io-label io-label-text">IN</span>
        <span class="cell-io-type" id="ni-${node.id}">${node.inputType || '—'}</span>
      </div>` : ''}
      ${showOUT ? `<div class="cell-io-row">
        <span class="cell-io-label io-label-text">OUT</span>
        <span class="cell-io-type output" id="no-${node.id}">${node.outputType || '—'}</span>
      </div>` : ''}
    </div>
  `;

  // Click: select / connect
  el.addEventListener('click', e => {
    e.stopPropagation();
    if (e.ctrlKey || e.metaKey) {
      handleCtrlClick(node.id);
      return;
    }
    handleNodeClick(node.id);
  });

  // Drag to move (supports multi-select + ctrl-drag copy)
  el.addEventListener('mousedown', e => {
    if (state.connectingFrom !== null) return;
    if (e.button !== 0) return;
    e.preventDefault();
    const rect = el.getBoundingClientRect();

    // Determine which nodes to drag
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

/* ── GHOST ELEMENTS (Ctrl+drag preview) ──────── */
const ghostLayer = document.createElement('div');
ghostLayer.id = 'ghost-layer';
document.getElementById('canvas').appendChild(ghostLayer);

function buildGhosts(dragIds, startPositions) {
  ghostLayer.innerHTML = '';
  dragIds.forEach(nid => {
    const src = document.getElementById(`node-${nid}`);
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
    g.style.left = Math.max(0, sp.x + dx) + 'px';
    g.style.top  = Math.max(0, sp.y + dy) + 'px';
  });
}

function clearGhosts() {
  ghostLayer.innerHTML = '';
  ghostLayer.style.display = 'none';
}

/* ── DRAG NODES ───────────────────────────────── */
document.addEventListener('mousemove', e => {
  if (!state.dragging) return;
  const dx = (e.clientX - state.dragging.startX) / state.zoom;
  const dy = (e.clientY - state.dragging.startY) / state.zoom;
  if (Math.abs(dx) > 3 || Math.abs(dy) > 3) state.dragging.hasMoved = true;

  if (state.dragging.isCtrlDrag) {
    // Ctrl+drag: originals stay, ghosts follow mouse
    if (state.dragging.hasMoved) {
      if (ghostLayer.children.length === 0) {
        buildGhosts(state.dragging.dragIds, state.dragging.startPositions);
      }
      moveGhosts(state.dragging.dragIds, state.dragging.startPositions, dx, dy);
    }
  } else {
    // Normal drag: move originals
    state.dragging.dragIds.forEach(nid => {
      const n = state.nodes.find(x => x.id === nid);
      if (!n) return;
      const sp = state.dragging.startPositions[nid];
      n.x = Math.max(0, sp.x + dx);
      n.y = Math.max(0, sp.y + dy);
      const el = document.getElementById(`node-${nid}`);
      if (el) { el.style.left = n.x + 'px'; el.style.top = n.y + 'px'; }
    });
    drawEdges();
  }
});

document.addEventListener('mouseup', e => {
  if (!state.dragging) return;
  const d = state.dragging;
  state.dragging = null;

  if (d.isCtrlDrag && d.hasMoved) {
    // Drop: clear ghosts, create real clones at ghost positions
    clearGhosts();
    const dx = (e.clientX - d.startX) / state.zoom;
    const dy = (e.clientY - d.startY) / state.zoom;
    d.dragIds.forEach(nid => {
      const src = state.nodes.find(x => x.id === nid);
      if (!src) return;
      const sp = d.startPositions[nid];
      cloneNode(src, Math.max(0, sp.x + dx), Math.max(0, sp.y + dy));
    });
    drawEdges();
    validatePipeline();
  }
});

/* ── NODE CLICK / CONNECT ─────────────────────── */
function handleNodeClick(id) {
  if (state.connectingFrom === null) {
    // First click: start connection OR open inspector
    if (state.selectedNode === id) {
      // Already selected → start connecting
      state.connectingFrom = id;
      document.getElementById(`node-${id}`).classList.add('connecting-source');
      statusValid.textContent = '● Click another cell to connect...';
      statusValid.className = 'running';
      return;
    }
    selectNode(id);
  } else {
    // Second click: complete connection
    const from = state.connectingFrom;
    const to   = id;
    state.connectingFrom = null;
    document.querySelectorAll('.cell-node').forEach(el => el.classList.remove('connecting-source'));

    if (from === to) { validatePipeline(); return; }

    // No reverse or same-level connections
    const fromNode = state.nodes.find(n => n.id === from);
    const toNode   = state.nodes.find(n => n.id === to);
    if (toNode.y <= fromNode.y) {
      const reason = toNode.y === fromNode.y
        ? '<p>같은 Y축 위치의 셀은 연결할 수 없습니다. 병렬 셀은 아래에 배치한 뒤 연결하세요.</p>'
        : '<p>역방향 연결은 허용되지 않습니다. 연결은 위→아래 방향으로만 가능합니다.</p>';
      showModal('Connection Not Allowed', reason);
      validatePipeline();
      return;
    }

    // Remove existing edge from→to if any
    state.edges = state.edges.filter(e => !(e.from === from && e.to === to));

    // Auto-copy output → input
    if (fromNode.outputType) {
      const hasExistingInput = !!(toNode.inputType || toNode.inputDesc);
      const isSame = toNode.inputType === fromNode.outputType && toNode.inputDesc === fromNode.outputDesc;

      if (hasExistingInput && !isSame) {
        showConfirm(
          '후행 셀 Input 덮어쓰기',
          `<p>선행 셀의 Output으로 후행 셀 <strong>"${toNode.name}"</strong>의 Input을 덮어쓰겠습니까?</p>
           <div class="confirm-diff">
             <div><span class="diff-label">현재 Input Type</span><code>${toNode.inputType || '(없음)'}</code></div>
             <div><span class="diff-label">대체될 값 (Output Type)</span><code>${fromNode.outputType}</code></div>
           </div>`,
          () => { applyInputCopy(fromNode, toNode); finalizeEdge(from, to, fromNode, toNode); },
          () => { finalizeEdge(from, to, fromNode, toNode); }
        );
        return;
      } else if (!hasExistingInput) {
        applyInputCopy(fromNode, toNode);
      }
    }

    finalizeEdge(from, to, fromNode, toNode);
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
  // Close single-select inspector if switching to multi
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
  // If exactly one remains, treat as normal select
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

/* ── CANVAS CLICK: deselect or select edge ────── */
canvas.addEventListener('click', e => {
  if (state.connectingFrom !== null) {
    state.connectingFrom = null;
    document.querySelectorAll('.cell-node').forEach(el => el.classList.remove('connecting-source'));
    validatePipeline();
    return;
  }
  // Hit-test edges on left-click on canvas background
  if (e.target === canvas || e.target === edgeCanvas) {
    const wrap = document.getElementById('canvas-wrap').getBoundingClientRect();
    const cx = e.clientX - wrap.left;
    const cy = e.clientY - wrap.top;
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
  const wrap = document.getElementById('canvas-wrap').getBoundingClientRect();

  state.edges.forEach(edge => {
    const fromNode = state.nodes.find(n => n.id === edge.from);
    const toNode   = state.nodes.find(n => n.id === edge.to);
    if (!fromNode || !toNode) return;

    const fromEl = document.getElementById(`node-${edge.from}`);
    const toEl   = document.getElementById(`node-${edge.to}`);
    if (!fromEl || !toEl) return;

    const fr = fromEl.getBoundingClientRect();
    const tr = toEl.getBoundingClientRect();

    const x1 = fr.left + fr.width / 2 - wrap.left;
    const y1 = fr.bottom - wrap.top;
    const x2 = tr.left + tr.width / 2 - wrap.left;
    const y2 = tr.top - wrap.top;

    const color     = edge.valid ? '#7ee8a2' : '#f87171';
    const isSelected = state.selectedEdge === edge;

    // Neon glow layer for selected edge
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

    // Main line
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.bezierCurveTo(x1, y1 + (y2 - y1) * 0.5, x2, y1 + (y2 - y1) * 0.5, x2, y2);
    ctx.strokeStyle = color;
    ctx.lineWidth = isSelected ? 2.5 : 2;
    ctx.setLineDash(edge.valid ? [] : [6, 4]);
    ctx.stroke();
    ctx.setLineDash([]);

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

/* ── INSPECTOR ────────────────────────────────── */
function openInspector(id) {
  const node = state.nodes.find(n => n.id === id);
  if (!node) return;

  // Title
  const titles = { input: 'Input Cell Config', output: 'Output Cell Config', cell: 'Cell Config' };
  document.getElementById('inspector-title').textContent = titles[node.type] || 'Cell Config';

  // Show/hide IO fields based on cell type
  const isInput  = node.type === 'input';
  const isOutput = node.type === 'output';

  // Input cell: show input fields only (output fields hidden)
  // Output cell: show output fields only (input fields hidden)
  const showInputFields  = !isOutput;
  const showOutputFields = !isInput;

  document.getElementById('f-group-input-type').style.display  = showInputFields  ? '' : 'none';
  document.getElementById('f-group-output-type').style.display = showOutputFields ? '' : 'none';
  document.getElementById('f-group-input-desc').style.display  = showInputFields  ? '' : 'none';
  document.getElementById('f-group-output-desc').style.display = showOutputFields ? '' : 'none';

  // Adjust the type row: if only one side visible, make it full width
  const typeRow = document.getElementById('f-row-types');
  if (isInput || isOutput) {
    typeRow.style.gridTemplateColumns = '1fr';
  } else {
    typeRow.style.gridTemplateColumns = '';
  }

  // Update required markers
  document.querySelector('#f-group-input-type  label .required').style.display  = showInputFields  ? '' : 'none';
  document.querySelector('#f-group-output-type label .required').style.display = showOutputFields ? '' : 'none';
  document.querySelector('#f-group-input-desc  label .required').style.display  = showInputFields  ? '' : 'none';
  document.querySelector('#f-group-output-desc label .required').style.display = showOutputFields ? '' : 'none';

  document.getElementById('f-name').value        = node.name;
  document.getElementById('f-model').value       = node.model;
  document.getElementById('f-input-type').value  = node.inputType;
  document.getElementById('f-output-type').value = node.outputType;
  document.getElementById('f-input-desc').value  = node.inputDesc;
  document.getElementById('f-output-desc').value = node.outputDesc;
  document.getElementById('f-prompt').value      = node.prompt;
  document.getElementById('f-websearch').checked = node.webSearch;
  document.getElementById('f-domains').value     = node.domains;
  document.getElementById('f-memo').value        = node.memo || '';
  domainWrap.classList.toggle('hidden', !node.webSearch);

  inspector.classList.remove('closed');
}

function closeInspector() {
  inspector.classList.add('closed');
}

document.getElementById('inspector-close').addEventListener('click', () => {
  clearSelection();
  closeInspector();
});

fWebsearch.addEventListener('change', () => {
  domainWrap.classList.toggle('hidden', !fWebsearch.checked);
});

document.getElementById('apply-btn').addEventListener('click', () => {
  if (state.selectedNode === null) return;
  const node = state.nodes.find(n => n.id === state.selectedNode);
  if (!node) return;
  pushHistory();

  node.name   = document.getElementById('f-name').value.trim();
  node.model  = document.getElementById('f-model').value;
  node.prompt = document.getElementById('f-prompt').value.trim();
  node.webSearch = fWebsearch.checked;
  node.domains   = document.getElementById('f-domains').value.trim();
  node.memo      = document.getElementById('f-memo').value.trim();

  if (node.type === 'input') {
    // Input cell: only has input type/desc; outputType mirrors inputType for edge propagation
    node.inputType  = document.getElementById('f-input-type').value.trim();
    node.inputDesc  = document.getElementById('f-input-desc').value.trim();
    node.outputType = node.inputType;   // mirror so downstream edges validate correctly
    node.outputDesc = node.inputDesc;
  } else if (node.type === 'output') {
    // Output cell: only has output type/desc
    node.outputType = document.getElementById('f-output-type').value.trim();
    node.outputDesc = document.getElementById('f-output-desc').value.trim();
    node.inputType  = node.outputType;  // mirror so upstream edges validate correctly
    node.inputDesc  = node.outputDesc;
  } else {
    node.inputType  = document.getElementById('f-input-type').value.trim();
    node.outputType = document.getElementById('f-output-type').value.trim();
    node.inputDesc  = document.getElementById('f-input-desc').value.trim();
    node.outputDesc = document.getElementById('f-output-desc').value.trim();
  }

  // Update node display (ni/no may not exist for input/output cell types)
  const _nn = document.getElementById(`nn-${node.id}`);
  const _ni = document.getElementById(`ni-${node.id}`);
  const _no = document.getElementById(`no-${node.id}`);
  if (_nn) _nn.textContent = node.name || `Cell ${node.id}`;
  if (_ni) _ni.textContent = node.inputType  || '—';
  if (_no) _no.textContent = node.outputType || '—';

  // For input cell: propagate its type to all directly connected downstream cells
  if (node.type === 'input' && node.outputType) {
    state.edges
      .filter(e => e.from === node.id)
      .forEach(e => {
        const toNode = state.nodes.find(n => n.id === e.to);
        if (toNode && !toNode.inputType) {
          applyInputCopy(node, toNode);
        }
      });
  }

  // Revalidate edges touching this node
  state.edges.forEach(edge => {
    if (edge.from === node.id || edge.to === node.id) {
      const fromNode = state.nodes.find(n => n.id === edge.from);
      const toNode   = state.nodes.find(n => n.id === edge.to);
      edge.valid = !!(fromNode.outputType && toNode.inputType && fromNode.outputType === toNode.inputType);
    }
  });

  drawEdges();
  validatePipeline();

  // "Applied!" flash then close
  const applyBtn = document.getElementById('apply-btn');
  applyBtn.classList.remove('applied');        // reset in case already active
  void applyBtn.offsetWidth;                  // force reflow so animation restarts
  applyBtn.textContent = 'Applied!';
  applyBtn.disabled = true;
  applyBtn.classList.add('applied');
  setTimeout(() => {
    applyBtn.classList.remove('applied');
    applyBtn.textContent = 'Apply';
    applyBtn.disabled = false;
    clearSelection();
    closeInspector();
  }, 800);
});

/* ── VALIDATION ───────────────────────────────── */
function validatePipeline() {
  const errors = [];

  // Check all nodes are configured
  state.nodes.forEach(node => {
    const missing = [];
    if (!node.name)  missing.push('name');
    if (!node.model) missing.push('model');
    if (!node.prompt) missing.push('system prompt');
    // Input cell: only needs inputType/inputDesc
    if (node.type !== 'output') {
      if (!node.inputType) missing.push('input type');
      if (!node.inputDesc) missing.push('input description');
    }
    // Output cell: only needs outputType/outputDesc
    if (node.type !== 'input') {
      if (!node.outputType) missing.push('output type');
      if (!node.outputDesc) missing.push('output description');
    }
    if (missing.length) errors.push(`"${node.name}": missing ${missing.join(', ')}`);
  });

  // Check edges
  const invalidEdges = state.edges.filter(e => !e.valid);
  invalidEdges.forEach(edge => {
    const fromNode = state.nodes.find(n => n.id === edge.from);
    const toNode   = state.nodes.find(n => n.id === edge.to);
    errors.push(`Type mismatch: "${fromNode?.name}" (${fromNode?.outputType || '?'}) → "${toNode?.name}" (${toNode?.inputType || '?'})`);
  });

  const canRun = state.nodes.length > 0 && errors.length === 0;
  btnRun.disabled = !canRun || state.running;

  if (state.running) {
    statusValid.textContent = '● Running...';
    statusValid.className = 'running';
  } else if (errors.length === 0 && state.nodes.length > 0) {
    statusValid.textContent = `● Ready — ${state.nodes.length} cell${state.nodes.length > 1 ? 's' : ''}`;
    statusValid.className = '';
  } else if (state.nodes.length === 0) {
    statusValid.textContent = '● No cells';
    statusValid.className = '';
  } else {
    statusValid.textContent = `● ${errors.length} error${errors.length > 1 ? 's' : ''}`;
    statusValid.className = 'error';
  }

  return { canRun, errors };
}

/* ── RUN ──────────────────────────────────────── */
btnRun.addEventListener('click', () => {
  const { canRun, errors } = validatePipeline();
  if (!canRun) {
    const body = `<ul>${errors.map(e => `<li>${e}</li>`).join('')}</ul>`;
    showModal('Cannot Run Pipeline', body);
    return;
  }

  state.running = true;
  btnRun.disabled = true;
  btnStop.disabled = false;
  validatePipeline();

  // Sort nodes top-to-bottom
  const sorted = [...state.nodes].sort((a, b) => a.y - b.y);

  // Simulate sequential execution
  let i = 0;
  function runNext() {
    if (!state.running || i >= sorted.length) {
      finishRun();
      return;
    }
    const node = sorted[i++];
    setNodeStatus(node.id, 'running');
    setTimeout(() => {
      if (!state.running) return;
      setNodeStatus(node.id, 'done');
      setTimeout(runNext, 200);
    }, 1200 + Math.random() * 800);
  }
  runNext();
});

btnStop.addEventListener('click', () => {
  state.running = false;
  state.nodes.forEach(n => { if (n.status === 'running') setNodeStatus(n.id, 'pending'); });
  finishRun();
});

function finishRun() {
  state.running = false;
  btnStop.disabled = true;
  validatePipeline();
}

function setNodeStatus(id, status) {
  const node = state.nodes.find(n => n.id === id);
  if (!node) return;
  node.status = status;
  const el = document.getElementById(`node-${id}`);
  el.className = `cell-node ${status}`;
  if (state.selectedNode === id) el.classList.add('selected');
}

/* ── SAVE ─────────────────────────────────────── */
document.getElementById('btn-save').addEventListener('click', () => {
  const projectName = document.getElementById('project-name').value || 'pipeline';
  const data = {
    name: projectName,
    savedAt: new Date().toISOString(),
    nodes: state.nodes,
    edges: state.edges,
    nextId: state.nextId,
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `${projectName.replace(/\s+/g, '_')}.pipeline.json`;
  a.click();
  URL.revokeObjectURL(url);
});

/* ── LOAD ─────────────────────────────────────── */
document.getElementById('btn-load').addEventListener('click', () => {
  document.getElementById('load-input').value = '';
  document.getElementById('load-input').click();
});

document.getElementById('load-input').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    let data;
    try {
      data = JSON.parse(ev.target.result);
    } catch {
      showModal('Load Failed', '<p>유효하지 않은 파일입니다. .pipeline.json 파일을 선택해주세요.</p>');
      return;
    }
    if (!data.nodes || !data.edges) {
      showModal('Load Failed', '<p>파일 형식이 올바르지 않습니다.</p>');
      return;
    }
    loadPipeline(data);
  };
  reader.readAsText(file);
});

function loadPipeline(data) {
  // Clear current canvas
  state.nodes = [];
  state.edges = [];
  state.selectedNode = null;
  state.selectedNodes.clear();
  state.connectingFrom = null;
  state.running = false;
  state.nextId = data.nextId || 1;
  clearGhosts();
  canvas.innerHTML = '';
  canvas.appendChild(ghostLayer);
  ctx.clearRect(0, 0, edgeCanvas.width, edgeCanvas.height);

  // Restore project name
  if (data.name) document.getElementById('project-name').value = data.name;

  // Rebuild nodes
  data.nodes.forEach(nodeData => {
    state.nodes.push({ ...nodeData });
    renderNode(nodeData);
  });

  // Restore node counter so new nodes don't collide with loaded ids
  const maxId = data.nodes.reduce((m, n) => Math.max(m, n.id), 0);
  state.nextId = Math.max(state.nextId, maxId + 1);

  // Rebuild edges
  data.edges.forEach(edge => state.edges.push({ ...edge }));

  // Ensure IO cells always present (legacy saves may lack them)
  if (!state.nodes.find(n => n.type === 'input') || !state.nodes.find(n => n.type === 'output')) {
    requestAnimationFrame(initIOCells);
  } else {
    hint.classList.add('hidden');
  }
  closeInspector();
  drawEdges();
  validatePipeline();
}

/* ── RECENT LIST ──────────────────────────────── */
document.querySelectorAll('.recent-item').forEach(item => {
  item.addEventListener('click', () => {
    document.querySelectorAll('.recent-item').forEach(i => i.classList.remove('active'));
    item.classList.add('active');
  });
});

document.getElementById('add-project-btn').addEventListener('click', () => {
  // Clear canvas
  state.nodes = [];
  state.edges = [];
  state.selectedNode = null;
  state.selectedNodes.clear();
  state.selectedEdge = null;
  state.connectingFrom = null;
  state.running = false;
  state.nextId = 1;
  state.history = [];
  state.redoStack = [];
  canvas.innerHTML = '';
  canvas.appendChild(ghostLayer);
  ctx.clearRect(0, 0, edgeCanvas.width, edgeCanvas.height);
  hint.classList.add('hidden');
  document.getElementById('project-name').value = 'Untitled Project';
  closeInspector();
  validatePipeline();
  requestAnimationFrame(initIOCells);
});

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

/* ── CONTEXT MENU ─────────────────────────────── */
const ctxMenu = document.getElementById('ctx-menu');
let ctxTarget = null; // { kind: 'node'|'edge'|'canvas', id? }

function showCtxMenu(x, y, items) {
  ctxMenu.innerHTML = '';
  items.forEach(item => {
    if (item === 'sep') {
      const sep = document.createElement('div');
      sep.className = 'ctx-sep';
      ctxMenu.appendChild(sep);
      return;
    }
    const el = document.createElement('div');
    el.className = 'ctx-item' + (item.danger ? ' danger' : '');
    el.innerHTML = `<span class="ctx-icon">${item.icon}</span>${item.label}`;
    el.addEventListener('mousedown', e => {
      e.stopPropagation();
      hideCtxMenu();
      item.action();
    });
    ctxMenu.appendChild(el);
  });

  // Position: keep within viewport
  ctxMenu.style.display = 'block';
  const mw = ctxMenu.offsetWidth;
  const mh = ctxMenu.offsetHeight;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  ctxMenu.style.left = (x + mw > vw ? x - mw : x) + 'px';
  ctxMenu.style.top  = (y + mh > vh ? y - mh : y) + 'px';
}

function hideCtxMenu() {
  ctxMenu.style.display = 'none';
  ctxTarget = null;
}

document.addEventListener('mousedown', e => {
  if (!ctxMenu.contains(e.target)) hideCtxMenu();
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') hideCtxMenu();
});

/* Hit-test: is click point near a bezier curve edge? */
function getEdgeAtPoint(px, py) {
  const wrap = document.getElementById('canvas-wrap').getBoundingClientRect();
  const THRESH = 10; // pixels tolerance

  for (const edge of state.edges) {
    const fromEl = document.getElementById(`node-${edge.from}`);
    const toEl   = document.getElementById(`node-${edge.to}`);
    if (!fromEl || !toEl) continue;

    const fr = fromEl.getBoundingClientRect();
    const tr = toEl.getBoundingClientRect();

    const x1 = fr.left + fr.width / 2 - wrap.left;
    const y1 = fr.bottom - wrap.top;
    const x2 = tr.left + tr.width / 2 - wrap.left;
    const y2 = tr.top - wrap.top;

    // Sample bezier at N points and check distance
    const cp1x = x1, cp1y = y1 + (y2 - y1) * 0.5;
    const cp2x = x2, cp2y = y1 + (y2 - y1) * 0.5;

    for (let t = 0; t <= 1; t += 0.04) {
      const bx = Math.pow(1-t,3)*x1 + 3*Math.pow(1-t,2)*t*cp1x + 3*(1-t)*t*t*cp2x + Math.pow(t,3)*x2;
      const by = Math.pow(1-t,3)*y1 + 3*Math.pow(1-t,2)*t*cp1y + 3*(1-t)*t*t*cp2y + Math.pow(t,3)*y2;
      if (Math.hypot(bx - px, by - py) < THRESH) return edge;
    }
  }
  return null;
}

/* Right-click handler on canvas-wrap */
document.getElementById('canvas-wrap').addEventListener('contextmenu', e => {
  e.preventDefault();
  hideCtxMenu();

  const mx = e.clientX;
  const my = e.clientY;

  // 1. Check if click is on a node element
  const nodeEl = e.target.closest('.cell-node');
  if (nodeEl) {
    const nodeId = parseInt(nodeEl.id.replace('node-', ''));
    const node = state.nodes.find(n => n.id === nodeId);
    ctxTarget = { kind: 'node', id: nodeId };
    const isIONode = node && (node.type === 'input' || node.type === 'output');
    const nodeMenuItems = [
      {
        icon: '✏️', label: '셀 수정',
        action: () => { selectNode(nodeId); }
      },
      'sep',
    ];
    if (!isIONode) {
      nodeMenuItems.push({
        icon: '↔', label: 'X축 정렬 — 후행 셀을 현재 X로',
        action: () => alignDescendantsX(nodeId)
      });
      nodeMenuItems.push({
        icon: '↕', label: 'Y축 정렬 — 같은 열 스냅',
        action: () => alignSameRowY(nodeId)
      });
      nodeMenuItems.push('sep');
    }
    nodeMenuItems.push({
      icon: '🔗', label: '연결 모두 끊기',
      action: () => {
        pushHistory();
        state.edges = state.edges.filter(e => e.from !== nodeId && e.to !== nodeId);
        drawEdges();
        validatePipeline();
      }
    });
    nodeMenuItems.push({
      icon: '🧹', label: '내용 초기화', danger: true,
      action: () => {
        pushHistory();
        const n = state.nodes.find(n => n.id === nodeId);
        if (n) { clearNodeConfig(n); state.edges.forEach(e => { if (e.from === nodeId || e.to === nodeId) e.valid = false; }); drawEdges(); validatePipeline(); }
      }
    });
    nodeMenuItems.push('sep');
    if (!isIONode) {
      nodeMenuItems.push({
        icon: '🗑', label: '셀 지우기', danger: true,
        action: () => deleteNode(nodeId)
      });
    }
    showCtxMenu(mx, my, nodeMenuItems);
    return;
  }

  // 2. Check if click is near an edge (use canvas-relative coords)
  const wrap = document.getElementById('canvas-wrap').getBoundingClientRect();
  const cx = mx - wrap.left;
  const cy = my - wrap.top;
  const edge = getEdgeAtPoint(cx, cy);
  if (edge) {
    ctxTarget = { kind: 'edge', edge };
    const fromNode = state.nodes.find(n => n.id === edge.from);
    const toNode   = state.nodes.find(n => n.id === edge.to);
    showCtxMenu(mx, my, [
      {
        icon: '✂️', label: `선 지우기 (${fromNode?.name} → ${toNode?.name})`, danger: true,
        action: () => {
          state.edges = state.edges.filter(e => e !== edge);
          drawEdges();
          validatePipeline();
        }
      }
    ]);
    return;
  }

  // 3. Canvas background
  ctxTarget = { kind: 'canvas', x: cx, y: cy };
  showCtxMenu(mx, my, [
    {
      icon: '＋', label: '셀 추가',
      action: () => createNode('cell', cx - 90, cy - 40)
    },
    'sep',
    {
      icon: '⬡', label: 'Auto Layout (겹침 없음)',
      action: () => autoLayout()
    },
    'sep',
    {
      icon: '↔', label: 'X축 정렬 — I/O 기준 좌우대칭',
      action: () => alignAllX()
    },
    {
      icon: '↕', label: 'Y축 정렬 — 비슷한 높이 스냅',
      action: () => alignAllY()
    },
    'sep',
    {
      icon: '🧹', label: '모든 셀 내용 초기화', danger: true,
      action: () => {
        showConfirm(
          '모든 셀 내용 초기화',
          '<p>모든 셀의 <strong>CELL CONFIG</strong> 내용을 초기화합니다.<br>이 작업은 Ctrl+Z로 되돌릴 수 있습니다.</p>',
          () => clearAllConfigs(),
          null
        );
      }
    },
    {
      icon: '🔌', label: '모든 셀 연결 초기화', danger: true,
      action: () => {
        showConfirm(
          '모든 셀 연결 초기화',
          '<p>모든 셀 간의 <strong>연결선</strong>을 모두 제거합니다.<br>이 작업은 Ctrl+Z로 되돌릴 수 있습니다.</p>',
          () => clearAllEdges(),
          null
        );
      }
    },
    {
      icon: '💥', label: '모두 초기화', danger: true,
      action: () => {
        showConfirm(
          '모두 초기화',
          '<p>모든 셀의 <strong>CELL CONFIG 내용</strong>과 <strong>연결선</strong>을 모두 초기화합니다.<br>이 작업은 Ctrl+Z로 되돌릴 수 있습니다.</p>',
          () => { pushHistory(); clearAllConfigsNoHistory(); clearAllEdgesNoHistory(); drawEdges(); validatePipeline(); },
          null
        );
      }
    },
  ]);
});

/* ── CLEAR CONFIG HELPERS ─────────────────────── */
function clearNodeConfig(node) {
  node.model      = '';
  node.inputType  = '';
  node.outputType = '';
  node.inputDesc  = '';
  node.outputDesc = '';
  node.prompt     = '';
  node.webSearch  = false;
  node.domains    = '';
  node.memo       = '';
  // Update display chips
  const ni = document.getElementById(`ni-${node.id}`);
  const no = document.getElementById(`no-${node.id}`);
  if (ni) ni.textContent = '—';
  if (no) no.textContent = '—';
  // Refresh inspector if this node is open
  if (state.selectedNode === node.id) openInspector(node.id);
}

function clearAllConfigs() {
  pushHistory();
  clearAllConfigsNoHistory();
  drawEdges();
  validatePipeline();
}

function clearAllConfigsNoHistory() {
  state.nodes.forEach(n => clearNodeConfig(n));
  state.edges.forEach(e => { e.valid = false; });
}

function clearAllEdges() {
  pushHistory();
  clearAllEdgesNoHistory();
  drawEdges();
  validatePipeline();
}

function clearAllEdgesNoHistory() {
  state.edges = [];
  state.selectedEdge = null;
}

/* Delete node + its edges */
function deleteNode(id, skipHistory = false) {
  if (!skipHistory) pushHistory();
  state.edges = state.edges.filter(e => e.from !== id && e.to !== id);
  state.nodes = state.nodes.filter(n => n.id !== id);
  const el = document.getElementById(`node-${id}`);
  if (el) el.remove();
  if (state.selectedNode === id) {
    state.selectedNode = null;
    closeInspector();
  }
  if (state.connectingFrom === id) state.connectingFrom = null;
  if (state.nodes.length === 0) hint.classList.remove('hidden');
  drawEdges();
  validatePipeline();
}

/* ── ALIGN FUNCTIONS ─────────────────────────── */

/* Util: set node position and update DOM */
function setNodePos(node, x, y) {
  if (x !== null) { node.x = x; document.getElementById(`node-${node.id}`).style.left = x + 'px'; }
  if (y !== null) { node.y = y; document.getElementById(`node-${node.id}`).style.top  = y + 'px'; }
}

/* Get all descendant node IDs reachable from a given node via edges */
function getDescendants(nodeId) {
  const visited = new Set();
  const queue = [nodeId];
  while (queue.length) {
    const cur = queue.shift();
    state.edges
      .filter(e => e.from === cur && !visited.has(e.to))
      .forEach(e => { visited.add(e.to); queue.push(e.to); });
  }
  return [...visited];
}

/* Canvas X align: I/O cells share same X, rest laid out symmetrically */
/* ── AUTO LAYOUT (Sugiyama-style DAG layout) ────── */
function autoLayout() {
  if (state.nodes.length === 0) return;
  pushHistory();

  const NODE_W = 180;
  const NODE_H = 110;   // approximate rendered height
  const PAD_X  = 60;    // horizontal gap between nodes
  const PAD_Y  = 80;    // vertical gap between layers

  // ── Step 1: Assign layers (longest-path ranking) ──────────────────────────
  // Build adjacency
  const successors   = {};  // id → [id]
  const predecessors = {};  // id → [id]
  state.nodes.forEach(n => { successors[n.id] = []; predecessors[n.id] = []; });
  state.edges.forEach(e => {
    successors[e.from]?.push(e.to);
    predecessors[e.to]?.push(e.from);
  });

  // Topological sort (Kahn's algorithm)
  const inDeg = {};
  state.nodes.forEach(n => inDeg[n.id] = predecessors[n.id].length);
  const queue = state.nodes.filter(n => inDeg[n.id] === 0).map(n => n.id);
  const topoOrder = [];
  while (queue.length) {
    const cur = queue.shift();
    topoOrder.push(cur);
    (successors[cur] || []).forEach(nxt => {
      inDeg[nxt]--;
      if (inDeg[nxt] === 0) queue.push(nxt);
    });
  }
  // Any nodes not reached (cycles / isolated) append at end
  state.nodes.forEach(n => { if (!topoOrder.includes(n.id)) topoOrder.push(n.id); });

  // Layer = max layer of predecessors + 1
  const layer = {};
  topoOrder.forEach(id => {
    const preds = predecessors[id] || [];
    layer[id] = preds.length === 0 ? 0 : Math.max(...preds.map(p => layer[p] ?? 0)) + 1;
  });

  // Group nodes by layer
  const layerGroups = {};
  state.nodes.forEach(n => {
    const l = layer[n.id] ?? 0;
    if (!layerGroups[l]) layerGroups[l] = [];
    layerGroups[l].push(n.id);
  });
  const layerKeys = Object.keys(layerGroups).map(Number).sort((a, b) => a - b);

  // ── Step 2: Assign provisional X positions per layer for barycenter ────────
  // Use floating-point "order index" that updates each sweep
  const orderX = {};  // id → float order value (used for barycenter)
  state.nodes.forEach(n => { orderX[n.id] = 0; });

  // Initialize order by current user X position
  layerKeys.forEach(lk => {
    const grp = [...layerGroups[lk]].sort((a, b) => {
      const na = state.nodes.find(n => n.id === a);
      const nb = state.nodes.find(n => n.id === b);
      return na.x - nb.x;
    });
    grp.forEach((id, i) => { orderX[id] = i; });
    layerGroups[lk] = grp;
  });

  // Barycenter using orderX (real position proxy) — alternating sweep
  function bary(id, useSuccessors) {
    const nbrs = useSuccessors ? (successors[id] || []) : (predecessors[id] || []);
    if (nbrs.length === 0) return orderX[id]; // keep current if no neighbors
    return nbrs.reduce((s, nid) => s + (orderX[nid] ?? 0), 0) / nbrs.length;
  }

  // Multiple alternating sweeps (down then up) for convergence
  for (let pass = 0; pass < 8; pass++) {
    const forward = pass % 2 === 0;
    const keys = forward ? layerKeys : [...layerKeys].reverse();
    keys.forEach((lk, li) => {
      const isTop = lk === layerKeys[0];
      const grp = layerGroups[lk];
      // Compute new order values
      const withBary = grp.map(id => ({ id, b: bary(id, isTop && forward) }));
      withBary.sort((a, b) => a.b - b.b);
      // Assign integer positions
      withBary.forEach(({ id }, i) => { orderX[id] = i; });
      layerGroups[lk] = withBary.map(x => x.id);
    });
  }

  // ── Step 3: Assign pixel coordinates ─────────────────────────────────────
  const wrap    = document.getElementById('canvas-wrap');
  const canvasW = wrap.clientWidth;
  const canvasH = wrap.clientHeight;

  const numLayers   = layerKeys.length;
  const maxPerLayer = Math.max(...layerKeys.map(lk => layerGroups[lk].length));
  const totalH = numLayers   * NODE_H + (numLayers   - 1) * PAD_Y;

  const startY = Math.max(40, Math.round((canvasH - totalH) / 2));

  const positions = {};
  layerKeys.forEach((lk, li) => {
    const grp   = layerGroups[lk];
    const count = grp.length;
    const rowW  = count * NODE_W + (count - 1) * PAD_X;
    // Each row is independently centred in the canvas
    const rowStartX = Math.round((canvasW - rowW) / 2);
    const y = startY + li * (NODE_H + PAD_Y);
    grp.forEach((id, xi) => {
      positions[id] = { x: rowStartX + xi * (NODE_W + PAD_X), y };
    });
  });

  // ── Step 4: Apply positions ───────────────────────────────────────────────
  state.nodes.forEach(n => {
    const pos = positions[n.id];
    if (!pos) return;
    setNodePos(n, pos.x, pos.y);
  });

  drawEdges();
  validatePipeline();
}

function alignAllX() {
  if (state.nodes.length < 2) return;

  const NODE_W  = 180;
  const NODE_CX = NODE_W / 2; // center offset within a node

  const ioNodes   = state.nodes.filter(n => n.type === 'input' || n.type === 'output');
  const restNodes = state.nodes.filter(n => n.type !== 'input' && n.type !== 'output');

  // Axis = center-x of I/O nodes (connection endpoint), or canvas center
  const canvasW = document.getElementById('canvas-wrap').clientWidth;
  let axisCX; // this is the CENTER-x that edges connect to
  if (ioNodes.length > 0) {
    axisCX = Math.round(ioNodes.reduce((s, n) => s + n.x + NODE_CX, 0) / ioNodes.length);
  } else {
    axisCX = Math.round(canvasW / 2);
  }

  // Snap I/O nodes so their center aligns to axisCX
  ioNodes.forEach(n => setNodePos(n, axisCX - NODE_CX, null));

  // Group rest nodes by Y-row (same row = same edge endpoints at same depth)
  const SNAP = 80;
  const sortedByY = [...restNodes].sort((a, b) => a.y - b.y);
  const rows = [];
  let row = [sortedByY[0]];
  for (let i = 1; i < sortedByY.length; i++) {
    if (sortedByY[i].y - row[row.length - 1].y <= SNAP) {
      row.push(sortedByY[i]);
    } else {
      rows.push(row);
      row = [sortedByY[i]];
    }
  }
  if (row.length) rows.push(row);

  // For each row: spread nodes so their centers are symmetric around axisCX
  // Single node in row → center on axis
  // Multiple nodes → evenly spaced, centers symmetric around axisCX
  const GAP = NODE_W + 24; // gap between node centers

  rows.forEach(rowNodes => {
    const count = rowNodes.length;
    // Sort left-to-right by current x to preserve user's intended ordering
    const sorted = [...rowNodes].sort((a, b) => a.x - b.x);

    if (count === 1) {
      // Sole node: its center (= edge endpoint) lands on axisCX
      setNodePos(sorted[0], axisCX - NODE_CX, null);
    } else {
      // Distribute centers: [-floor(n/2)…, -1, 0(if odd), 1, …, floor(n/2)]
      // But we want symmetric: step = GAP, centered on axisCX
      const totalSpan = (count - 1) * GAP;
      const startCX   = axisCX - totalSpan / 2;
      sorted.forEach((node, i) => {
        const cx = startCX + i * GAP;
        setNodePos(node, Math.round(cx - NODE_CX), null);
      });
    }
  });

  drawEdges();
  validatePipeline();
}

/* Canvas Y align: snap same-row clusters (existing behaviour) */
function alignAllY() {
  if (state.nodes.length < 2) return;
  const SNAP   = 80;
  const sorted = [...state.nodes].sort((a, b) => a.y - b.y);
  const groups = [];
  let group    = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].y - group[group.length - 1].y <= SNAP) {
      group.push(sorted[i]);
    } else {
      groups.push(group);
      group = [sorted[i]];
    }
  }
  groups.push(group);
  groups.forEach(grp => {
    const med = Math.round(grp.reduce((s, n) => s + n.y, 0) / grp.length);
    grp.forEach(n => setNodePos(n, null, med));
  });
  drawEdges();
  validatePipeline();
}

/* Node X align: all downstream successors snap to this node's X */
function alignDescendantsX(nodeId) {
  const srcNode = state.nodes.find(n => n.id === nodeId);
  if (!srcNode) return;
  const descIds = getDescendants(nodeId);
  descIds.forEach(id => {
    const n = state.nodes.find(n => n.id === id);
    if (n && n.type !== 'input' && n.type !== 'output') {
      setNodePos(n, srcNode.x, null);
    }
  });
  drawEdges();
  validatePipeline();
}

/* Node Y align: snap nodes in the same Y cluster as this node */
function alignSameRowY(nodeId) {
  const srcNode = state.nodes.find(n => n.id === nodeId);
  if (!srcNode) return;
  const SNAP = 80;
  const sameRow = state.nodes.filter(n => Math.abs(n.y - srcNode.y) <= SNAP);
  const med = Math.round(sameRow.reduce((s, n) => s + n.y, 0) / sameRow.length);
  sameRow.forEach(n => setNodePos(n, null, med));
  drawEdges();
  validatePipeline();
}


/* ── ZOOM ─────────────────────────────────────── */
function applyZoom(newZoom) {
  state.zoom = Math.max(0.3, Math.min(2.5, newZoom));
  const canvasEl = document.getElementById('canvas');
  const edgeCv   = document.getElementById('edge-canvas');
  canvasEl.style.transform = `scale(${state.zoom})`;
  canvasEl.style.transformOrigin = '0 0';
  edgeCv.style.transform  = `scale(${state.zoom})`;
  edgeCv.style.transformOrigin = '0 0';
  document.getElementById('zoom-pct').value = Math.round(state.zoom * 100);
  drawEdges();
}

document.getElementById('canvas-wrap').addEventListener('wheel', e => {
  if (!e.ctrlKey && !e.metaKey) return;
  e.preventDefault();
  const delta = e.deltaY > 0 ? -0.1 : 0.1;
  applyZoom(state.zoom + delta);
}, { passive: false });

document.getElementById('zoom-in').addEventListener('click', () => applyZoom(state.zoom + 0.1));
document.getElementById('zoom-out').addEventListener('click', () => applyZoom(state.zoom - 0.1));
document.getElementById('zoom-reset').addEventListener('click', () => applyZoom(1));
document.getElementById('zoom-pct').addEventListener('change', e => {
  const v = parseInt(e.target.value);
  if (!isNaN(v)) applyZoom(v / 100);
});

/* ── CLONE NODE ───────────────────────────────── */
function cloneNode(src, x, y) {
  const id = state.nextId++;
  const node = {
    ...JSON.parse(JSON.stringify(src)),
    id,
    x: Math.max(0, x),
    y: Math.max(0, y),
    status: 'pending',
    name: src.name + ' (copy)',
  };
  state.nodes.push(node);
  renderNode(node);
  hint.classList.add('hidden');
  return node;
}

/* ── UNDO HISTORY ─────────────────────────────── */
function pushHistory() {
  state.history.push({
    nodes:  JSON.parse(JSON.stringify(state.nodes)),
    edges:  JSON.parse(JSON.stringify(state.edges)),
    nextId: state.nextId,
  });
  if (state.history.length > 50) state.history.shift();
  // New action invalidates redo chain
  state.redoStack = [];
}

function popHistory() {
  if (state.history.length === 0) return;

  // Save current state to redo stack before restoring
  state.redoStack.push({
    nodes:  JSON.parse(JSON.stringify(state.nodes)),
    edges:  JSON.parse(JSON.stringify(state.edges)),
    nextId: state.nextId,
  });
  if (state.redoStack.length > 50) state.redoStack.shift();

  const snap = state.history.pop();
  restoreSnapshot(snap);
}

function pushRedo() {
  if (state.redoStack.length === 0) return;

  // Save current state to undo stack
  state.history.push({
    nodes:  JSON.parse(JSON.stringify(state.nodes)),
    edges:  JSON.parse(JSON.stringify(state.edges)),
    nextId: state.nextId,
  });
  if (state.history.length > 50) state.history.shift();

  const snap = state.redoStack.pop();
  restoreSnapshot(snap);
}

function restoreSnapshot(snap) {
  // Clear canvas DOM
  canvas.innerHTML = '';
  canvas.appendChild(ghostLayer);
  ctx.clearRect(0, 0, edgeCanvas.width, edgeCanvas.height);

  state.nodes   = snap.nodes;
  state.edges   = snap.edges;
  state.nextId  = snap.nextId;
  state.selectedNode  = null;
  state.selectedNodes.clear();
  state.selectedEdge  = null;

  state.nodes.forEach(n => renderNode(n));
  // Ensure IO cells always present
  if (!state.nodes.find(n => n.type === 'input') || !state.nodes.find(n => n.type === 'output')) {
    requestAnimationFrame(initIOCells);
  } else {
    hint.classList.add('hidden');
  }
  closeInspector();
  drawEdges();
  validatePipeline();
}

/* ── KEYBOARD SHORTCUTS ───────────────────────── */
document.addEventListener('keydown', e => {
  const tag = document.activeElement.tagName;
  const inInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';

  // Ctrl+Enter — Apply cell config
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    const applyBtn = document.getElementById('apply-btn');
    if (!inspector.classList.contains('closed') && applyBtn) {
      e.preventDefault();
      applyBtn.click();
    }
    return;
  }

  // Ctrl+Z — Undo
  if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !inInput) {
    e.preventDefault();
    popHistory();
    return;
  }

  // Ctrl+Y — Redo
  if ((e.ctrlKey || e.metaKey) && e.key === 'y' && !inInput) {
    e.preventDefault();
    pushRedo();
    return;
  }

  // Delete — delete selected node(s) or selected edge
  if (e.key === 'Delete' && !inInput) {
    if (state.selectedEdge) {
      pushHistory();
      state.edges = state.edges.filter(ed => ed !== state.selectedEdge);
      state.selectedEdge = null;
      drawEdges();
      validatePipeline();
      return;
    }
    const toDelete = (state.selectedNodes.size > 0
      ? [...state.selectedNodes]
      : (state.selectedNode ? [state.selectedNode] : [])
    ).filter(id => {
      const n = state.nodes.find(n => n.id === id);
      return n && n.type !== 'input' && n.type !== 'output';
    });
    if (toDelete.length > 0) {
      pushHistory();
      toDelete.forEach(id => deleteNode(id, true));
      return;
    }
  }

  // Ctrl+A — select all nodes
  if ((e.ctrlKey || e.metaKey) && e.key === 'a' && !inInput) {
    e.preventDefault();
    closeInspector();
    state.selectedNode = null;
    state.selectedEdge = null;
    state.selectedNodes.clear();
    state.nodes.forEach(n => {
      state.selectedNodes.add(n.id);
      document.getElementById(`node-${n.id}`)?.classList.add('multi-selected');
    });
    return;
  }

  // Ctrl+C — copy selected node(s)
  if ((e.ctrlKey || e.metaKey) && e.key === 'c' && !inInput) {
    const ids = state.selectedNodes.size > 0
      ? [...state.selectedNodes]
      : (state.selectedNode ? [state.selectedNode] : []);
    if (ids.length === 0) return;
    state.clipboard = ids.map(id => state.nodes.find(n => n.id === id)).filter(Boolean);
    return;
  }

  // Ctrl+V — paste below
  if ((e.ctrlKey || e.metaKey) && e.key === 'v' && !inInput) {
    if (!state.clipboard || state.clipboard.length === 0) return;
    e.preventDefault();
    pushHistory();
    clearSelection();
    state.clipboard.forEach(src => {
      const clone = cloneNode(src, src.x + 20, src.y + 160);
      state.selectedNodes.add(clone.id);
      document.getElementById(`node-${clone.id}`)?.classList.add('multi-selected');
    });
    drawEdges();
    validatePipeline();
    return;
  }
});


/* ── MEMO TOOLTIP ─────────────────────────────── */
const cellTooltip = document.getElementById('cell-tooltip');
let tooltipTimer = null;

function showTooltip(nodeEl, node) {
  if (!node.memo) return;
  const wrap = document.getElementById('canvas-wrap').getBoundingClientRect();
  const nr   = nodeEl.getBoundingClientRect();

  cellTooltip.textContent = node.memo;
  cellTooltip.classList.remove('hidden');

  // Position: right of node, or left if too close to edge
  const tw = cellTooltip.offsetWidth || 220;
  const th = cellTooltip.offsetHeight || 60;
  let tx = (nr.right - wrap.left + 12) / state.zoom;
  let ty = (nr.top   - wrap.top  + (nr.height - th) / 2) / state.zoom;

  // Clamp within canvas
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

// Attach hover listeners when a node is rendered
function attachTooltipListeners(el, node) {
  el.addEventListener('mouseenter', () => {
    clearTimeout(tooltipTimer);
    tooltipTimer = setTimeout(() => showTooltip(el, node), 700);
  });
  el.addEventListener('mouseleave', hideTooltip);
  el.addEventListener('mousedown',  hideTooltip);
}

/* ── HELPER FUNCTIONS ─────────────────────────── */

function applyInputCopy(fromNode, toNode) {
  toNode.inputType = fromNode.outputType;
  toNode.inputDesc = fromNode.outputDesc;
  const ni = document.getElementById(`ni-${toNode.id}`);
  if (ni) ni.textContent = toNode.inputType || '—';
  if (state.selectedNode === toNode.id) {
    document.getElementById('f-input-type').value = toNode.inputType;
    document.getElementById('f-input-desc').value = toNode.inputDesc;
  }
}

function finalizeEdge(from, to, fromNode, toNode) {
  pushHistory();
  const valid = !!(fromNode.outputType && toNode.inputType && fromNode.outputType === toNode.inputType);
  state.edges.push({ from, to, valid });
  drawEdges();
  validatePipeline();
}

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

  document.getElementById('confirm-yes').addEventListener('click', () => {
    closeConfirm(); onYes();
  });
  document.getElementById('confirm-no').addEventListener('click', () => {
    closeConfirm(); if (onNo) onNo();
  });
}


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

  // Position: right of anchor button, vertically centered
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

// SV canvas drag
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

// Hue strip drag
ccpHueStrip.addEventListener('mousedown', e => { ccpDragging = 'hue'; ccpHueMove(e); });

function ccpHueMove(e) {
  const r = ccpHueStrip.getBoundingClientRect();
  ccp.hue = Math.max(0, Math.min(360, (e.clientX - r.left) / 180 * 360));
  ccpUpdateUI();
  if (ccp.onApply) ccp.onApply(hsvToHex(ccp.hue, ccp.s, ccp.v), false);
}

// Hex input
ccpHexInput.addEventListener('input', e => {
  const v = e.target.value;
  if (/^#[0-9a-f]{6}$/i.test(v)) {
    const h = hexToHsv(v); ccp.hue=h.hue; ccp.s=h.s; ccp.v=h.v;
    ccpUpdateUI();
    if (ccp.onApply) ccp.onApply(v.toUpperCase(), false);
  }
});

// Apply button
document.getElementById('ccp-apply').addEventListener('click', () => {
  const hex = hsvToHex(ccp.hue, ccp.s, ccp.v);
  if (ccp.onApply) ccp.onApply(hex, true);
  ccpClose();
});

// Close on outside click
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

// API key show/hide toggle
document.querySelectorAll('.apikey-toggle').forEach(btn => {
  btn.addEventListener('click', () => {
    const input = document.getElementById(btn.dataset.target);
    if (!input) return;
    input.type = input.type === 'password' ? 'text' : 'password';
  });
});

// Expose getApiKeys() for backend integration
window.getApiKeys = () => ({
  anthropic: document.getElementById('apikey-anthropic')?.value || '',
  google:    document.getElementById('apikey-google')?.value    || '',
  openai:    document.getElementById('apikey-openai')?.value    || '',
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
  fontFamily:   'sans',     // 'sans' | 'mono' | 'serif'
  fontSizeName:  13,        // px for .cell-node-name
  fontSizeIO:    10,        // px for .cell-io-type chips
  fontColorName: 'default', // 'default' or hex
  fontColorIO:   'default', // 'default' or hex
};

// Luminance-based text color for cell name
function contrastColor(hex) {
  const h = hex.replace('#','');
  const r = parseInt(h.substr(0,2),16);
  const g = parseInt(h.substr(2,2),16);
  const b = parseInt(h.substr(4,2),16);
  const lum = (0.299*r + 0.587*g + 0.114*b) / 255;
  return lum > 0.5 ? '#111111' : '#f0f0f0';
}


function buildPlusSVG() {
  // Use theme state directly — avoids CSS variable read timing issues
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
    // 1. X 무늬 — 얇게
    cross:    `linear-gradient(45deg, transparent 47%, ${c} 47%, ${c} 53%, transparent 53%), linear-gradient(-45deg, transparent 47%, ${c} 47%, ${c} 53%, transparent 53%)`,
    // 2. 점 무늬 — 큰 점
    dots:     `radial-gradient(circle at 3px 3px, ${c} 4px, transparent 0)`,
    // 3. 촘촘한 격자 무늬
    grid:     `linear-gradient(${c} 1px, transparent 1px), linear-gradient(90deg, ${c} 1px, transparent 1px)`,
    // 4. + 무늬 — SVG 타일로 + 기호를 점처럼 찍기 (패턴2와 동일 방식)
    diagonal: buildPlusSVG(),
    // 5. / 무늬 — 단방향 사선
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
    // Skip IO nodes — they have independent colors
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
  // Re-apply pattern so SVG tile picks up new --pattern-color
  requestAnimationFrame(() => applyPattern(settingsState.pattern));
}

// Patch renderNode to apply current settings on creation
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

// Theme
document.querySelectorAll('.theme-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.theme-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    applyTheme(btn.dataset.theme);
  });
});

// Pattern
document.querySelectorAll('.pattern-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.pattern-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    settingsState.pattern = btn.dataset.pattern;
    applyPattern(btn.dataset.pattern);
  });
});

// Cell color swatches
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
      // Only override if cell bg isn't overriding (IO cells manage their own contrast)
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

// Font family
document.querySelectorAll('.font-family-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.font-family-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    applyFontFamily(btn.dataset.font);
  });
});

// Font size buttons
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

// Font color buttons
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

// IO cell colors
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



// Cell shape
document.querySelectorAll('.cell-shape-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.cell-shape-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    applyCellRadius(parseInt(btn.dataset.radius));
  });
});

// Apply settings to newly created nodes (monkey-patch after renderNode is defined)
const _applySettingsToNode = (nodeEl) => {
  const nodeId = parseInt(nodeEl.id.replace('node-', ''));
  const n = state.nodes.find(x => x.id === nodeId);
  if (n && (n.type === 'input' || n.type === 'output')) {
    const ioColor = n.type === 'input' ? settingsState.inputColor : settingsState.outputColor;
    nodeEl.style.background = ioColor;
    const contrast = contrastColor(ioColor);
    const nameEl = nodeEl.querySelector('.cell-node-name');
    if (nameEl) nameEl.style.color = contrast;
    // IO label text (IN / OUT) also follows contrast
    nodeEl.querySelectorAll('.io-label-text').forEach(el => { el.style.color = contrast; });
    // IO type chips follow contrast too
    nodeEl.querySelectorAll('.cell-io-type').forEach(el => { el.style.color = contrast; el.style.background = 'rgba(128,128,128,0.15)'; });
    // cell-node-type label
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
  // Apply font
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

// Hook into canvas MutationObserver to catch new nodes
new MutationObserver(mutations => {
  mutations.forEach(m => {
    m.addedNodes.forEach(node => {
      if (node.classList && node.classList.contains('cell-node')) {
        _applySettingsToNode(node);
      }
    });
  });
}).observe(document.getElementById('canvas'), { childList: true });

/* ── INIT I/O CELLS ───────────────────────────── */
function initIOCells() {
  const wrap    = document.getElementById('canvas-wrap');
  const canvasW = wrap.clientWidth  || 800;
  const canvasH = wrap.clientHeight || 600;
  const NODE_W  = 180;
  const centerX = Math.round((canvasW - NODE_W) / 2);

  // Only create if not already present (e.g. after load)
  if (!state.nodes.find(n => n.type === 'input')) {
    createNode('input',  centerX, 40);
  }
  if (!state.nodes.find(n => n.type === 'output')) {
    createNode('output', centerX, canvasH - 180);
  }
  // Clear undo/redo history so user can't undo the initial IO cells
  state.history = [];
  state.redoStack = [];
}

/* ── INIT ─────────────────────────────────────── */
validatePipeline();
requestAnimationFrame(initIOCells);