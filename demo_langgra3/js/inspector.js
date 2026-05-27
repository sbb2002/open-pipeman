/* ── INSPECTOR ────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {

  /* f-model select 토글 */
  const fModelSel = document.getElementById('f-model');
  if (fModelSel) {
    fModelSel.addEventListener('change', function() {
      const wrap  = document.getElementById('f-model-custom-wrap');
      const input = document.getElementById('f-model-custom');
      if (wrap)  wrap.style.display  = this.value === '__ollama__' ? 'block' : 'none';
      if (input && this.value !== '__ollama__') input.value = '';
    });
  }

  /* Inspector 탭 전환 */
  document.querySelectorAll('.inspector-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.inspector-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const tab    = btn.dataset.tab;
      const form   = document.getElementById('inspector-form');
      const result = document.getElementById('inspector-result');
      if (form)   form.style.display   = tab === 'config' ? '' : 'none';
      if (result) result.style.display = tab === 'result' ? 'flex' : 'none';

      if (tab === 'result' && state.selectedNode !== null) {
        const node = state.nodes.find(n => n.id === state.selectedNode);
        if (node && node.result) _fillResultTab(node.result);
      }
    });
  });

  /* 복사 버튼 */
  document.getElementById('copy-code-btn')?.addEventListener('click', () => {
    const el = document.getElementById('result-code');
    if (el) navigator.clipboard.writeText(el.textContent)
      .then(() => showToast('코드를 클립보드에 복사했습니다.'));
  });
  document.getElementById('copy-doc-btn')?.addEventListener('click', () => {
    const el = document.getElementById('result-docstring');
    if (el) navigator.clipboard.writeText(el.textContent)
      .then(() => showToast('Docstring을 클립보드에 복사했습니다.'));
  });

  /* Schema 편집 버튼 */
  document.getElementById('btn-schema-input')?.addEventListener('click', () => openSchemaModal('input'));
  document.getElementById('btn-schema-output')?.addEventListener('click', () => openSchemaModal('output'));

  _initSchemaModal();
});

/* ── RESULT TAB ───────────────────────────────── */
function _fillResultTab(r) {
  const codeEl   = document.getElementById('result-code');
  const docEl    = document.getElementById('result-docstring');
  const schemaEl = document.getElementById('result-schema');
  if (codeEl)   codeEl.textContent   = r.code      || '(없음)';
  if (docEl)    docEl.textContent    = r.docstring  || '(없음)';
  if (schemaEl) schemaEl.textContent = JSON.stringify(r.output_schema || {}, null, 2) || '{}';

  const assertSection = document.getElementById('result-assertion');
  const assertList    = document.getElementById('result-assertion-list');
  if (assertSection && assertList && r.assertions && r.assertions.length > 0) {
    assertSection.style.display = '';
    assertList.innerHTML = r.assertions.map(a => `
      <div class="assertion-item ${a.pass ? 'pass' : 'fail'}">
        <span class="assertion-item-icon">${a.pass ? '✓' : '✗'}</span>
        <span class="assertion-item-text">${_escHtml(a.message)}</span>
      </div>
    `).join('');
  } else if (assertSection) {
    assertSection.style.display = 'none';
  }
}

function _escHtml(s) {
  return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function streamResultTab(nodeId, partial) {
  if (state.selectedNode !== nodeId) return;
  const result = document.getElementById('inspector-result');
  if (!result || result.style.display === 'none') return;
  const codeEl   = document.getElementById('result-code');
  const docEl    = document.getElementById('result-docstring');
  const schemaEl = document.getElementById('result-schema');
  if (partial.code      !== undefined && codeEl)   codeEl.textContent   = partial.code      || '...';
  if (partial.docstring !== undefined && docEl)    docEl.textContent    = partial.docstring  || '...';
  if (partial.stage     !== undefined && schemaEl && !partial.code) {
    schemaEl.textContent = '▶ ' + partial.stage + '...';
  }
}

function openResultTabStreaming(nodeId) {
  inspector.classList.remove('closed');
  state.selectedNode = nodeId;

  document.querySelectorAll('.inspector-tab').forEach(b => b.classList.remove('active'));
  document.querySelector('.inspector-tab[data-tab="result"]')?.classList.add('active');

  const form   = document.getElementById('inspector-form');
  const result = document.getElementById('inspector-result');
  if (form)   form.style.display   = 'none';
  if (result) result.style.display = 'flex';

  const codeEl        = document.getElementById('result-code');
  const docEl         = document.getElementById('result-docstring');
  const schemaEl      = document.getElementById('result-schema');
  const assertSection = document.getElementById('result-assertion');
  if (codeEl)        codeEl.textContent        = '생성 중...';
  if (docEl)         docEl.textContent         = '대기 중...';
  if (schemaEl)      schemaEl.textContent      = '대기 중...';
  if (assertSection) assertSection.style.display = 'none';

  const titleEl = document.getElementById('inspector-title');
  const node = state.nodes.find(n => n.id === nodeId);
  if (titleEl && node) titleEl.textContent = (node.name || 'Cell') + ' — Running';
}

/* ── OPEN INSPECTOR ───────────────────────────── */
function openInspector(id) {
  const node = state.nodes.find(n => n.id === id);
  if (!node) return;

  const titles = { input: 'Input Cell Config', output: 'Output Cell Config', cell: 'Cell Config' };
  document.getElementById('inspector-title').textContent = titles[node.type] || 'Cell Config';

  const isInput  = node.type === 'input';
  const isOutput = node.type === 'output';

  const showInputSchema  = !isOutput;
  const showOutputSchema = !isInput;
  document.getElementById('f-group-input-schema').style.display  = showInputSchema  ? '' : 'none';
  document.getElementById('f-group-output-schema').style.display = showOutputSchema ? '' : 'none';

  const typeRow = document.getElementById('f-row-types');
  typeRow.style.gridTemplateColumns = (isInput || isOutput) ? '1fr' : '';

  document.getElementById('f-name').value = node.name;

  const _knownModels = ['claude-sonnet-4-6','claude-opus-4-6','claude-haiku-4-5','gpt-4o','gemini-2.0-flash',''];
  const _isOllama = node.model && !_knownModels.includes(node.model);
  document.getElementById('f-model').value = _isOllama ? '__ollama__' : (node.model || '');
  const _customWrap = document.getElementById('f-model-custom-wrap');
  if (_customWrap) _customWrap.style.display = _isOllama ? 'block' : 'none';
  const _customInput = document.getElementById('f-model-custom');
  if (_customInput) _customInput.value = _isOllama ? node.model : '';

  document.getElementById('f-prompt').value         = node.prompt     || '';
  document.getElementById('f-websearch').checked    = node.webSearch  || false;
  document.getElementById('f-cleanup').checked      = node.allowCleanup  || false;
  document.getElementById('f-force-review').checked = node.forceReview   || false;
  document.getElementById('f-domains').value        = node.domains    || '';
  document.getElementById('f-memo').value           = node.memo       || '';
  domainWrap.classList.toggle('hidden', !node.webSearch);

  _updateSchemaBtnState('input',  node.inputContract);
  _updateSchemaBtnState('output', node.outputContract);

  document.querySelectorAll('.inspector-tab').forEach(b => b.classList.remove('active'));
  document.querySelector('.inspector-tab[data-tab="config"]')?.classList.add('active');
  const _form   = document.getElementById('inspector-form');
  const _result = document.getElementById('inspector-result');
  if (_form)   _form.style.display   = '';
  if (_result) _result.style.display = 'none';
  inspector.classList.remove('closed');
}

/* Schema 버튼 상태 업데이트
 * - schema 없음: 기본 스타일, 아이콘 { }
 * - schema 있음: has-schema(녹색), 아이콘 { } 유지 (텍스트 없음)
 */
function _updateSchemaBtnState(side, contract) {
  const btn = document.getElementById(`btn-schema-${side}`);
  if (!btn) return;
  const props    = contract?.properties || {};
  const hasProps = Object.keys(props).length > 0;
  btn.classList.toggle('has-schema', hasProps);
  // 버튼 내용은 항상 아이콘만 — 텍스트 없음
  btn.textContent = '{ }';
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

/* ── APPLY ────────────────────────────────────── */
document.getElementById('apply-btn').addEventListener('click', () => {
  if (state.selectedNode === null) return;
  const node = state.nodes.find(n => n.id === state.selectedNode);
  if (!node) return;
  pushHistory();

  node.name = document.getElementById('f-name').value.trim();

  const _sel = document.getElementById('f-model');
  node.model = _sel.value === '__ollama__'
    ? (document.getElementById('f-model-custom').value.trim() || '')
    : _sel.value;

  node.prompt       = document.getElementById('f-prompt').value.trim();
  node.webSearch    = fWebsearch.checked;
  node.allowCleanup = document.getElementById('f-cleanup').checked;
  node.forceReview  = document.getElementById('f-force-review').checked;
  node.domains      = document.getElementById('f-domains').value.trim();
  node.memo         = document.getElementById('f-memo').value.trim();

  if (node.type === 'input' && node.inputContract) {
    node.outputContract = JSON.parse(JSON.stringify(node.inputContract));
  }
  if (node.type === 'output' && node.outputContract) {
    node.inputContract = JSON.parse(JSON.stringify(node.outputContract));
  }

  const _nn = document.getElementById(`nn-${node.id}`);
  if (_nn) _nn.textContent = node.name || `Cell ${node.id}`;

  if (node.outputContract) {
    state.edges
      .filter(e => e.from === node.id)
      .forEach(e => {
        const toNode = state.nodes.find(n => n.id === e.to);
        if (!toNode) return;
        const hasContract = toNode.inputContract &&
          Object.keys(toNode.inputContract.properties || {}).length > 0;
        if (!hasContract) {
          _syncInputContract(node, toNode);
        }
      });
  }

  drawEdges();
  validatePipeline();

  const applyBtn = document.getElementById('apply-btn');
  applyBtn.classList.remove('applied');
  void applyBtn.offsetWidth;
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

  state.nodes.forEach(node => {
    const missing = [];
    const isIO = node.type === 'input' || node.type === 'output';
    if (!node.name) missing.push('name');
    if (!isIO) {
      if (!node.model)  missing.push('model');
      if (!node.prompt) missing.push('system prompt');
    }
    if (missing.length) errors.push(`"${node.name || `Cell ${node.id}`}": missing ${missing.join(', ')}`);
  });

  state.edges.forEach(edge => { edge.valid = true; });

  const canRun = state.nodes.length > 0 && errors.length === 0;
  btnRun.disabled = !canRun || state.running;

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
  if (errors.length === 0 && errorPanel) errorPanel.classList.remove('open');

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

function openResultTab(nodeId) {
  const node = state.nodes.find(n => n.id === nodeId);
  if (!node || !node.result) return;
  inspector.classList.remove('closed');
  document.querySelectorAll('.inspector-tab').forEach(b => b.classList.remove('active'));
  document.querySelector('.inspector-tab[data-tab="result"]')?.classList.add('active');
  const form   = document.getElementById('inspector-form');
  const result = document.getElementById('inspector-result');
  if (form)   form.style.display   = 'none';
  if (result) result.style.display = 'flex';
  _fillResultTab(node.result);
}

/* ── SCHEMA MODAL ─────────────────────────────── */
let _schemaCtx = { nodeId: null, side: null };
const SCHEMA_TYPES = ['string', 'number', 'integer', 'boolean', 'array', 'object', 'null'];

function _initSchemaModal() {
  document.querySelectorAll('.schema-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.schemaTab;
      document.querySelectorAll('.schema-tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('schema-visual-panel').style.display = tab === 'visual' ? '' : 'none';
      document.getElementById('schema-raw-wrap').style.display     = tab === 'raw'    ? '' : 'none';
      if (tab === 'raw') {
        const schema = _buildSchemaFromVisual();
        document.getElementById('schema-raw-textarea').value = JSON.stringify(schema, null, 2);
        document.getElementById('schema-parse-error-msg').classList.remove('visible');
        document.getElementById('schema-raw-textarea').classList.remove('parse-error');
      } else {
        _tryParseRawToVisual();
      }
    });
  });

  document.getElementById('schema-add-prop-btn').addEventListener('click', () => _addSchemaPropRow('', 'string'));
  document.getElementById('schema-modal-close').addEventListener('click', _closeSchemaModal);
  document.getElementById('schema-cancel-btn').addEventListener('click', _closeSchemaModal);
  document.getElementById('schema-modal-overlay').addEventListener('click', e => {
    if (e.target === document.getElementById('schema-modal-overlay')) _closeSchemaModal();
  });
  document.getElementById('schema-clear-btn').addEventListener('click', () => {
    _clearSchemaVisual();
    document.getElementById('schema-raw-textarea').value = '';
  });
  document.getElementById('schema-save-btn').addEventListener('click', _saveSchema);
  document.getElementById('schema-raw-textarea').addEventListener('input', () => {
    const ta  = document.getElementById('schema-raw-textarea');
    const err = document.getElementById('schema-parse-error-msg');
    try {
      JSON.parse(ta.value || '{}');
      ta.classList.remove('parse-error');
      err.classList.remove('visible');
    } catch (e) {
      ta.classList.add('parse-error');
      err.textContent = e.message;
      err.classList.add('visible');
    }
  });
}

function openSchemaModal(side) {
  if (state.selectedNode === null) return;
  const node = state.nodes.find(n => n.id === state.selectedNode);
  if (!node) return;

  _schemaCtx = { nodeId: node.id, side };
  document.getElementById('schema-modal-title').textContent =
    (side === 'input' ? 'INPUT' : 'OUTPUT') + ' SCHEMA — ' + (node.name || `Cell ${node.id}`);

  const contract = side === 'input' ? (node.inputContract || {}) : (node.outputContract || {});
  _clearSchemaVisual();
  Object.entries(contract.properties || {}).forEach(([key, def]) => _addSchemaPropRow(key, def.type || 'string'));

  const rawVal = Object.keys(contract.properties || {}).length > 0 ? JSON.stringify(contract, null, 2) : '';
  document.getElementById('schema-raw-textarea').value = rawVal;
  document.getElementById('schema-parse-error-msg').classList.remove('visible');
  document.getElementById('schema-raw-textarea').classList.remove('parse-error');

  document.querySelectorAll('.schema-tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelector('.schema-tab-btn[data-schema-tab="visual"]')?.classList.add('active');
  document.getElementById('schema-visual-panel').style.display = '';
  document.getElementById('schema-raw-wrap').style.display = 'none';

  document.getElementById('schema-modal-overlay').classList.remove('hidden');
}

function _closeSchemaModal() {
  document.getElementById('schema-modal-overlay').classList.add('hidden');
  _schemaCtx = { nodeId: null, side: null };
}

function _clearSchemaVisual() {
  document.getElementById('schema-props-list').innerHTML = '';
}

function _addSchemaPropRow(key, type) {
  const list = document.getElementById('schema-props-list');
  const row  = document.createElement('div');
  row.className = 'schema-prop-row';

  const keyInput = document.createElement('input');
  keyInput.type = 'text'; keyInput.placeholder = 'property_name';
  keyInput.value = key; keyInput.spellcheck = false;

  const typeSelect = document.createElement('select');
  SCHEMA_TYPES.forEach(t => {
    const opt = document.createElement('option');
    opt.value = t; opt.textContent = t;
    if (t === type) opt.selected = true;
    typeSelect.appendChild(opt);
  });

  const delBtn = document.createElement('button');
  delBtn.type = 'button'; delBtn.className = 'schema-prop-delete'; delBtn.textContent = '✕';
  delBtn.addEventListener('click', () => row.remove());

  row.appendChild(keyInput);
  row.appendChild(typeSelect);
  row.appendChild(delBtn);
  list.appendChild(row);
  keyInput.focus();
}

function _buildSchemaFromVisual() {
  const rows  = document.querySelectorAll('#schema-props-list .schema-prop-row');
  const props = {};
  rows.forEach(row => {
    const key  = row.querySelector('input[type="text"]').value.trim();
    const type = row.querySelector('select').value;
    if (key) props[key] = { type };
  });
  return Object.keys(props).length > 0 ? { type: 'object', properties: props } : {};
}

function _tryParseRawToVisual() {
  const ta  = document.getElementById('schema-raw-textarea');
  const err = document.getElementById('schema-parse-error-msg');
  try {
    const schema = JSON.parse(ta.value || '{}');
    _clearSchemaVisual();
    Object.entries(schema.properties || {}).forEach(([k, v]) => _addSchemaPropRow(k, v.type || 'string'));
    ta.classList.remove('parse-error'); err.classList.remove('visible');
  } catch (e) {
    ta.classList.add('parse-error'); err.textContent = e.message; err.classList.add('visible');
  }
}

function _saveSchema() {
  const { nodeId, side } = _schemaCtx;
  if (!nodeId || !side) return;
  const node = state.nodes.find(n => n.id === nodeId);
  if (!node) return;

  const activeTab = document.querySelector('.schema-tab-btn.active')?.dataset.schemaTab;
  let schema;
  if (activeTab === 'raw') {
    try { schema = JSON.parse(document.getElementById('schema-raw-textarea').value || '{}'); }
    catch (e) { showToast('JSON 파싱 오류: ' + e.message); return; }
  } else {
    schema = _buildSchemaFromVisual();
  }

  const isEmpty = !schema || Object.keys(schema).length === 0;
  const contract = isEmpty ? null : schema;

  if (side === 'input') {
    node.inputContract = contract;
    if (node.type === 'input') node.outputContract = contract;
  } else {
    node.outputContract = contract;
    if (node.type === 'output') node.inputContract = contract;
    if (contract) {
      state.edges.filter(e => e.from === node.id).forEach(e => {
        const toNode = state.nodes.find(n => n.id === e.to);
        if (!toNode) return;
        const hasContract = toNode.inputContract &&
          Object.keys(toNode.inputContract.properties || {}).length > 0;
        if (!hasContract) _syncInputContract(node, toNode);
      });
    }
  }

  _updateSchemaBtnState(side, contract);
  updateNodeIODisplay(nodeId);
  drawEdges();
  validatePipeline();

  _closeSchemaModal();
  const propCount = isEmpty ? 0 : Object.keys(schema.properties || {}).length;
  showToast(isEmpty ? 'Schema 초기화됨' : `Schema 저장됨 (${propCount}개 속성)`);
}
