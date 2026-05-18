/* ── INSPECTOR ────────────────────────────────── */
/* f-model select 변경 리스너 — 전역에서 한 번만 등록 */
document.addEventListener('DOMContentLoaded', () => {
  const fModelSel = document.getElementById('f-model');
  if (fModelSel) {
    fModelSel.addEventListener('change', function() {
      const wrap  = document.getElementById('f-model-custom-wrap');
      const input = document.getElementById('f-model-custom');
      if (wrap)  wrap.style.display  = this.value === '__ollama__' ? 'block' : 'none';
      if (input && this.value !== '__ollama__') input.value = '';
    });
  }
});/* ── INSPECTOR ────────────────────────────────── */
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

  document.getElementById('f-name').value = node.name;

  // ── 모델 복원 (Ollama 커스텀 모델 포함) ──────────────────────────────
  const _knownModels = ['claude-sonnet-4-6','claude-opus-4-6','claude-haiku-4-5','gpt-4o','gemini-2.0-flash',''];
  const _isOllama = node.model && !_knownModels.includes(node.model);
  document.getElementById('f-model').value = _isOllama ? '__ollama__' : (node.model || '');
  const _customWrap = document.getElementById('f-model-custom-wrap');
  if (_customWrap) _customWrap.style.display = _isOllama ? 'block' : 'none';
  const _customInput = document.getElementById('f-model-custom');
  if (_customInput) _customInput.value = _isOllama ? node.model : '';

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

  node.name = document.getElementById('f-name').value.trim();

  // ── 모델 저장 (Ollama 커스텀 모델 포함) ─────────────────────────────
  const _sel = document.getElementById('f-model');
  node.model = _sel.value === '__ollama__'
    ? (document.getElementById('f-model-custom').value.trim() || '')
    : _sel.value;

  node.prompt    = document.getElementById('f-prompt').value.trim();
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
    const isIO = node.type === 'input' || node.type === 'output';

    if (!node.name) missing.push('name');

    // model, prompt는 일반 셀(cell)에만 필수
    if (!isIO) {
      if (!node.model)  missing.push('model');
      if (!node.prompt) missing.push('system prompt');
    }

    // Input cell: inputType/inputDesc만 필요
    if (node.type !== 'output') {
      if (!node.inputType) missing.push('input type');
      if (!node.inputDesc) missing.push('input description');
    }
    // Output cell: outputType/outputDesc만 필요
    if (node.type !== 'input') {
      if (!node.outputType) missing.push('output type');
      if (!node.outputDesc) missing.push('output description');
    }

    if (missing.length) errors.push(`"${node.name || `Cell ${node.id}`}": missing ${missing.join(', ')}`);
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

  // ── Error panel: populate list ──────────────────
  const errorPanel     = document.getElementById('error-panel');
  const errorPanelList = document.getElementById('error-panel-list');
  if (errorPanelList) {
    errorPanelList.innerHTML = '';
    errors.forEach(msg => {
      const li = document.createElement('li');
      li.textContent = msg;
      errorPanelList.appendChild(li);
    });
  }
  // Auto-close panel when errors are cleared
  if (errors.length === 0 && errorPanel) {
    errorPanel.classList.remove('open');
  }

  // ── Status bar: preserve base class, toggle state classes ──
  statusValid.classList.remove('running', 'error');
  if (state.running) {
    statusValid.textContent = '● Running...';
    statusValid.classList.add('running');
  } else if (errors.length === 0 && state.nodes.length > 0) {
    statusValid.textContent = `● Ready — ${state.nodes.length} cell${state.nodes.length > 1 ? 's' : ''}`;
  } else if (state.nodes.length === 0) {
    statusValid.textContent = '● No cells';
  } else {
    statusValid.textContent = `● ${errors.length} error${errors.length > 1 ? 's' : ''}`;
    statusValid.classList.add('error');
  }

  // ── Attach handlers once ────────────────────────
  if (!statusValid._errorPanelBound) {
    statusValid._errorPanelBound = true;
    statusValid.addEventListener('click', () => {
      if (!statusValid.classList.contains('error')) return;
      document.getElementById('error-panel')?.classList.toggle('open');
    });
  }
  const epCloseBtn = document.getElementById('error-panel-close');
  if (epCloseBtn && !epCloseBtn._bound) {
    epCloseBtn._bound = true;
    epCloseBtn.addEventListener('click', () => {
      document.getElementById('error-panel')?.classList.remove('open');
    });
  }

  return { canRun, errors };
}