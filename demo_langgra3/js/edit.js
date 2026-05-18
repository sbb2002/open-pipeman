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
  // Close error panel on outside click
  const errorPanel = document.getElementById('error-panel');
  const statusBtn  = document.getElementById('status-validity');
  if (
    errorPanel &&
    errorPanel.classList.contains('open') &&
    !errorPanel.contains(e.target) &&
    !statusBtn?.contains(e.target)
  ) {
    errorPanel.classList.remove('open');
  }
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') hideCtxMenu();
});

/* Hit-test: is click point near a bezier curve edge? */
function getEdgeAtPoint(px, py) {
  // px, py는 canvas-wrap 기준 좌표 (zoom 미적용)
  // drawEdges()와 동일하게 논리 좌표 * zoom으로 비교
  const THRESH = 10;
  const z = state.zoom;

  for (const edge of state.edges) {
    const fromNode = state.nodes.find(n => n.id === edge.from);
    const toNode   = state.nodes.find(n => n.id === edge.to);
    if (!fromNode || !toNode) continue;

    const fromEl = document.getElementById(`node-${edge.from}`);
    const toEl   = document.getElementById(`node-${edge.to}`);
    if (!fromEl || !toEl) continue;

    const fw = fromEl.offsetWidth;
    const fh = fromEl.offsetHeight;
    const tw = toEl.offsetWidth;

    const x1 = (fromNode.x + fw / 2) * z;
    const y1 = (fromNode.y + fh) * z;
    const x2 = (toNode.x  + tw / 2) * z;
    const y2 = (toNode.y) * z;

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
  // zoom 보정: canvas-wrap 기준 좌표 → canvas 내부 논리 좌표
  const lcx = cx / state.zoom;
  const lcy = cy / state.zoom;
  ctxTarget = { kind: 'canvas', x: lcx, y: lcy };
  showCtxMenu(mx, my, [
    {
      icon: '＋', label: '셀 추가',
      action: () => createNode('cell', lcx - 90, lcy - 40)
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

/* Canvas X align: I/O cells share same X, rest laid out symmetrically *//* ── AUTO LAYOUT (Sugiyama-style DAG layout) ────── */
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
  canvasEl.style.transform = `scale(${state.zoom})`;
  canvasEl.style.transformOrigin = '0 0';
  // edge-canvas는 scale 하지 않음 — drawEdges()에서 zoom 보정 좌표로 직접 그림
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

  // J — toggle connecting mode for the selected node(s)
  if (e.key === 'j' && !inInput && !e.ctrlKey && !e.metaKey) {
    // Cancel if already in any connecting mode
    if (state.connectingFrom !== null || state.connectingFromMulti !== null) {
      state.connectingFrom = null;
      state.connectingFromMulti = null;
      document.querySelectorAll('.cell-node').forEach(el => el.classList.remove('connecting-source'));
      validatePipeline();
      return;
    }

    const multiIds = state.selectedNodes.size > 1 ? [...state.selectedNodes] : null;
    const singleId = state.selectedNode !== null ? state.selectedNode
                   : state.selectedNodes.size === 1 ? [...state.selectedNodes][0]
                   : null;

    if (multiIds) {
      // Multi-source connecting mode: all selected nodes become connecting-source
      state.connectingFromMulti = new Set(multiIds);
      state.connectingFrom = null;
      state.selectedNodes.clear();
      multiIds.forEach(nid => {
        const el = document.getElementById(`node-${nid}`);
        if (el) { el.classList.remove('multi-selected'); el.classList.add('connecting-source'); }
      });
      statusValid.textContent = '● Click a target cell to connect all...';
      statusValid.className = 'running';
    } else if (singleId !== null) {
      // Single-source connecting mode
      state.connectingFrom = singleId;
      const singleEl = document.getElementById(`node-${singleId}`);
      if (singleEl) { singleEl.classList.remove('multi-selected'); singleEl.classList.add('connecting-source'); }
      statusValid.textContent = '● Click another cell to connect...';
      statusValid.className = 'running';
      statusValid.className = 'running';
    }
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