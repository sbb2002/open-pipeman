/* ─────────────────────────────────────────────────
   PROJECT UI
   의존: store.js, canvas.js(createNode, renderNode, clearGhosts, drawEdges),
         inspector.js(closeInspector, validatePipeline), ui.js(showModal, showConfirm, showCtxMenu)
   ───────────────────────────────────────────────── */

/* ── TOAST ─────────────────────────────────────── */
let toastTimer = null;

function showToast(msg) {
  const toast    = document.getElementById('toast');
  const toastMsg = document.getElementById('toast-msg');
  toastMsg.textContent = msg;
  toast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add('hidden'), 2600);
}

/* ── 캔버스 초기화 헬퍼 ─────────────────────────── */
function clearCanvasForNew(name) {
  state.nodes = [];
  state.edges = [];
  state.selectedNode   = null;
  state.selectedNodes.clear();
  state.selectedEdge   = null;
  state.connectingFrom = null;
  state.running        = false;
  state.pendingRunOrder = [];
  state.nextId         = 1;
  state.history        = [];
  state.redoStack      = [];
  clearGhosts();
  canvas.innerHTML = '';
  canvas.appendChild(ghostLayer);
  ctx.clearRect(0, 0, edgeCanvas.width, edgeCanvas.height);
  hint.classList.add('hidden');
  document.getElementById('project-name').value = name;
  closeInspector();
  validatePipeline();
}

/* ─────────────────────────────────────────────────
   LOAD PIPELINE  (공통)
   ───────────────────────────────────────────────── */
function loadPipeline(data) {
  state.nodes = [];
  state.edges = [];
  state.selectedNode   = null;
  state.selectedNodes.clear();
  state.connectingFrom = null;
  state.running        = false;
  state.nextId         = data.nextId || 1;
  state.history        = [];
  state.redoStack      = [];
  clearGhosts();
  canvas.innerHTML = '';
  canvas.appendChild(ghostLayer);
  ctx.clearRect(0, 0, edgeCanvas.width, edgeCanvas.height);

  if (data.name) document.getElementById('project-name').value = data.name;

  data.nodes.forEach(nodeData => {
    state.nodes.push({ ...nodeData });
    renderNode(nodeData);
  });

  const maxId = data.nodes.reduce((m, n) => Math.max(m, n.id), 0);
  state.nextId = Math.max(state.nextId, maxId + 1);

  data.edges.forEach(edge => state.edges.push({ ...edge }));

  if (!state.nodes.find(n => n.type === 'input') || !state.nodes.find(n => n.type === 'output')) {
    requestAnimationFrame(initIOCells);
  } else {
    hint.classList.add('hidden');
  }

  if (typeof closeInspector === 'function') closeInspector();
  validatePipeline();
}

/* ─────────────────────────────────────────────────
   RECENTS SIDEBAR
   ───────────────────────────────────────────────── */

function buildRecentsList() {
  const list = document.getElementById('recent-list');
  list.innerHTML = '';
  const all = storeGetAll();
  const activeId = getActiveId();

  const sorted = Object.values(all).sort(
    (a, b) => new Date(b.savedAt) - new Date(a.savedAt)
  );

  if (sorted.length === 0) return;

  sorted.forEach(proj => {
    const li = buildRecentItem(proj, proj.id === activeId);
    list.appendChild(li);
  });
}

function buildRecentItem(proj, active = false) {
  const li = document.createElement('li');
  li.className = 'recent-item' + (active ? ' active' : '');
  li.dataset.id = proj.id;
  li.innerHTML = `
    <span class="recent-dot"></span>
    <div class="recent-meta">
      <span class="recent-name">${proj.name}</span>
      <span class="recent-time">${relativeTime(proj.savedAt)}</span>
    </div>
    <button class="recent-more-btn" title="더 보기">···</button>
  `;
  initRecentItem(li);
  return li;
}

/* recent-item 에 이벤트 연결 */
function initRecentItem(item) {
  item.addEventListener('click', e => {
    if (e.target.closest('.recent-more-btn')) return;
    const id = item.dataset.id;
    if (id === getActiveId()) return;
    switchToProject(id);
  });

  item.addEventListener('contextmenu', e => {
    e.preventDefault();
    showRecentCtxMenu(e.clientX, e.clientY, item);
  });

  const moreBtn = item.querySelector('.recent-more-btn');
  if (moreBtn) {
    moreBtn.addEventListener('click', e => {
      e.stopPropagation();
      const r = moreBtn.getBoundingClientRect();
      showRecentCtxMenu(r.right, r.bottom, item);
    });
  }
}

/* 프로젝트 전환 */
function switchToProject(id) {
  snapshotCurrentProject();

  const proj = storeGet(id);
  if (!proj) return;

  setActiveId(id);

  document.querySelectorAll('.recent-item').forEach(i => {
    i.classList.toggle('active', i.dataset.id === id);
  });

  loadPipeline(proj);
}

/* 컨텍스트 메뉴 */
function showRecentCtxMenu(x, y, item) {
  showCtxMenu(x, y, [
    { icon: '✏️', label: '프로젝트 이름 변경', action: () => startRenameProject(item) },
    'sep',
    { icon: '🗑', label: '프로젝트 제거', danger: true, action: () => confirmRemoveProject(item) }
  ]);
}

/* 이름 변경 */
function startRenameProject(item) {
  const projectInput = document.getElementById('project-name');
  const nameEl = item.querySelector('.recent-name');

  document.querySelectorAll('.recent-item').forEach(i => i.classList.remove('active'));
  item.classList.add('active');
  projectInput.value = nameEl.textContent;

  setTimeout(() => { projectInput.focus(); projectInput.select(); }, 50);
}

/* 프로젝트 이름 인풋 직접 편집 */
(function attachProjectNameDirectEdit() {
  const projectInput = document.getElementById('project-name');

  function getActiveNameEl() {
    const active = document.querySelector('.recent-item.active');
    return active ? active.querySelector('.recent-name') : null;
  }

  let resolved = false;

  function commit() {
    if (resolved) return;
    resolved = true;
    cleanup();
    const nameEl  = getActiveNameEl();
    const newName = projectInput.value.trim();
    if (nameEl && newName) {
      nameEl.textContent = newName;
      const id = getActiveId();
      if (id) {
        const proj = storeGet(id);
        if (proj) { proj.name = newName; storeSet(id, proj); }
      }
    } else if (nameEl) {
      projectInput.value = nameEl.textContent;
    }
    projectInput.blur();
  }

  function cancel() {
    if (resolved) return;
    resolved = true;
    cleanup();
    const nameEl = getActiveNameEl();
    if (nameEl) projectInput.value = nameEl.textContent;
    projectInput.blur();
  }

  function onKey(e) {
    if (e.key === 'Enter')  { e.preventDefault(); commit(); }
    if (e.key === 'Escape') { e.preventDefault(); cancel(); }
  }

  function onBlur() {
    setTimeout(() => { if (!resolved) cancel(); }, 50);
  }

  function cleanup() {
    projectInput.removeEventListener('keydown', onKey);
    projectInput.removeEventListener('blur',    onBlur);
  }

  projectInput.addEventListener('focus', () => {
    resolved = false;
    projectInput.addEventListener('keydown', onKey);
    projectInput.addEventListener('blur',    onBlur);
  });
}());

/* 프로젝트 제거 */
function confirmRemoveProject(item) {
  const nameEl   = item.querySelector('.recent-name');
  const projName = nameEl ? nameEl.textContent : '프로젝트';
  const id       = item.dataset.id;

  showConfirm(
    'REMOVE PROJECT',
    `<p><strong>"${projName}"</strong>을(를) 목록에서 제거합니다.</p>
     <p style="margin-top:10px;color:var(--red);font-size:12px;">⚠ 이 작업은 되돌릴 수 없습니다.</p>`,
    () => {
      storeDelete(id);
      item.remove();

      if (id === getActiveId()) {
        const remaining = Object.values(storeGetAll())
          .sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt));
        if (remaining.length > 0) {
          switchToProject(remaining[0].id);
        } else {
          setActiveId(null);
          clearCanvasForNew('Untitled Project');
          requestAnimationFrame(initIOCells);
        }
      }
    }
  );

  requestAnimationFrame(() => {
    const yesBtn = document.getElementById('confirm-yes');
    const noBtn  = document.getElementById('confirm-no');
    if (yesBtn) yesBtn.textContent = '제거';
    if (noBtn)  noBtn.textContent  = '취소';
  });
}

/* F2 단축키 */
document.addEventListener('keydown', e => {
  if (e.key === 'F2') {
    const activeItem = document.querySelector('.recent-item.active');
    if (activeItem) { e.preventDefault(); startRenameProject(activeItem); }
  }
});

/* ─────────────────────────────────────────────────
   ADD PROJECT BUTTON
   ───────────────────────────────────────────────── */
document.getElementById('add-project-btn').addEventListener('click', () => {
  snapshotCurrentProject();

  const name = 'Untitled Project';
  const id   = 'proj-' + Date.now();
  const proj = {
    id, name,
    savedAt: new Date().toISOString(),
    nodes: [], edges: [], nextId: 1,
  };
  storeSet(id, proj);
  setActiveId(id);

  clearCanvasForNew(name);

  const list = document.getElementById('recent-list');
  document.querySelectorAll('.recent-item').forEach(i => i.classList.remove('active'));
  const li = buildRecentItem(proj, true);
  list.insertBefore(li, list.firstChild);

  requestAnimationFrame(initIOCells);
});

/* ─────────────────────────────────────────────────
   SAVE  (헤더 Save 버튼)
   ───────────────────────────────────────────────── */
document.getElementById('btn-save').addEventListener('click', () => {
  const projectName = document.getElementById('project-name').value.trim() || 'Untitled Project';

  function doSave() {
    snapshotCurrentProject();

    const activeId = getActiveId();
    const proj = activeId ? storeGet(activeId) : null;
    const data = proj || {
      name:    projectName,
      savedAt: new Date().toISOString(),
      nodes:   state.nodes,
      edges:   state.edges,
      nextId:  state.nextId,
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `${projectName.replace(/\s+/g, '_')}.json`;
    a.click();
    URL.revokeObjectURL(url);

    showToast('현재 프로젝트를 저장했습니다!');
  }

  const activeId = getActiveId();
  const all = storeGetAll();
  const duplicate = Object.values(all).find(
    p => p.name === projectName && p.id !== activeId
  );

  if (duplicate) {
    showConfirm(
      'OVERWRITE PROJECT?',
      `<p>같은 이름의 프로젝트 <strong>"${projectName}"</strong>이(가) 이미 존재합니다.</p>
       <p style="margin-top:8px;font-size:12px;color:var(--text3);">덮어쓰면 해당 프로젝트의 데이터가 대체됩니다.</p>`,
      () => {
        storeDelete(duplicate.id);
        const dupItem = document.querySelector(`.recent-item[data-id="${duplicate.id}"]`);
        if (dupItem) dupItem.remove();
        doSave();
      }
    );
    requestAnimationFrame(() => {
      const yesBtn = document.getElementById('confirm-yes');
      const noBtn  = document.getElementById('confirm-no');
      if (yesBtn) yesBtn.textContent = '덮어쓰기';
      if (noBtn)  noBtn.textContent  = '취소';
    });
  } else {
    doSave();
  }
});

/* ─────────────────────────────────────────────────
   LOAD POPUP
   ───────────────────────────────────────────────── */
const loadOverlay    = document.getElementById('load-overlay');
const loadFileList   = document.getElementById('load-file-list');
const loadEmpty      = document.getElementById('load-empty');
const loadSearch     = document.getElementById('load-search');
const loadConfirmBtn = document.getElementById('load-confirm-btn');
const loadSelInfo    = document.getElementById('load-selection-info');
const loadDropzone   = document.getElementById('load-dropzone');
const loadFileInput  = document.getElementById('load-file-input');

let loadSelectedIds = new Set();

/* ── 팝업 열기/닫기 ───────────────────────────── */
document.getElementById('btn-load').addEventListener('click', () => openLoadPopup());

function openLoadPopup() {
  loadSelectedIds = new Set();
  loadSearch.value = '';
  loadConfirmBtn.disabled = true;
  renderLoadList('');
  loadOverlay.classList.remove('hidden');
  setTimeout(() => loadSearch.focus(), 80);
}

function closeLoadPopup() {
  loadOverlay.classList.add('hidden');
}

document.getElementById('load-close').addEventListener('click', closeLoadPopup);
document.getElementById('load-cancel-btn').addEventListener('click', closeLoadPopup);
loadOverlay.addEventListener('click', e => { if (e.target === loadOverlay) closeLoadPopup(); });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !loadOverlay.classList.contains('hidden')) {
    e.stopPropagation();
    closeLoadPopup();
  }
});

/* ── 검색 필터 ────────────────────────────────── */
loadSearch.addEventListener('input', () => {
  renderLoadList(loadSearch.value.trim().toLowerCase());
});

/* ── 리스트 렌더 ──────────────────────────────── */
function renderLoadList(filter) {
  loadFileList.innerHTML = '';
  const all = storeGetAll();
  const projects = Object.values(all)
    .filter(p => !filter || p.name.toLowerCase().includes(filter))
    .sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt));

  if (projects.length === 0) {
    loadEmpty.style.display = 'block';
    loadFileList.style.display = 'none';
    updateLoadConfirmBtn();
    return;
  }

  loadEmpty.style.display = 'none';
  loadFileList.style.display = 'flex';

  projects.forEach(proj => {
    const li = document.createElement('li');
    li.className = 'load-file-item' + (loadSelectedIds.has(proj.id) ? ' selected' : '');
    li.dataset.id = proj.id;

    const nodeCount = (proj.nodes || []).length;
    li.innerHTML = `
      <span class="load-file-icon">◈</span>
      <div class="load-file-meta">
        <span class="load-file-name">${proj.name}</span>
        <span class="load-file-time">${relativeTime(proj.savedAt)} · ${nodeCount} cell${nodeCount !== 1 ? 's' : ''}</span>
      </div>
      <span class="load-file-size">.json</span>
    `;

    li.addEventListener('click', e => handleLoadItemClick(proj.id, e));
    loadFileList.appendChild(li);
  });

  updateLoadConfirmBtn();
}

/* ── 클릭 선택 (Ctrl / Shift) ────────────────── */
function handleLoadItemClick(id, e) {
  const all = storeGetAll();
  const allIds = Object.values(all)
    .sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt))
    .filter(p => {
      const f = loadSearch.value.trim().toLowerCase();
      return !f || p.name.toLowerCase().includes(f);
    })
    .map(p => p.id);

  if (e.ctrlKey || e.metaKey) {
    if (loadSelectedIds.has(id)) loadSelectedIds.delete(id);
    else                          loadSelectedIds.add(id);
  } else if (e.shiftKey && loadSelectedIds.size > 0) {
    const lastSelected = [...loadSelectedIds].pop();
    const fromIdx = allIds.indexOf(lastSelected);
    const toIdx   = allIds.indexOf(id);
    const [lo, hi] = fromIdx < toIdx ? [fromIdx, toIdx] : [toIdx, fromIdx];
    for (let i = lo; i <= hi; i++) loadSelectedIds.add(allIds[i]);
  } else {
    if (loadSelectedIds.size === 1 && loadSelectedIds.has(id)) {
      loadSelectedIds.delete(id);
    } else {
      loadSelectedIds = new Set([id]);
    }
  }

  loadFileList.querySelectorAll('.load-file-item').forEach(li => {
    li.classList.toggle('selected', loadSelectedIds.has(li.dataset.id));
  });

  updateLoadConfirmBtn();
}

function updateLoadConfirmBtn() {
  const n = loadSelectedIds.size;
  loadConfirmBtn.disabled = n === 0;
  loadSelInfo.textContent = n === 0
    ? 'Ctrl / Shift 클릭으로 여러 개 선택'
    : `${n}개 선택됨`;
}

/* ── 드래그 앤 드롭 ───────────────────────────── */
loadDropzone.addEventListener('dragenter', e => {
  e.preventDefault();
  loadDropzone.classList.add('drag-over');
});
loadDropzone.addEventListener('dragover', e => {
  e.preventDefault();
  loadDropzone.classList.add('drag-over');
});
loadDropzone.addEventListener('dragleave', e => {
  if (!loadDropzone.contains(e.relatedTarget)) {
    loadDropzone.classList.remove('drag-over');
  }
});
loadDropzone.addEventListener('drop', e => {
  e.preventDefault();
  loadDropzone.classList.remove('drag-over');
  const files = [...e.dataTransfer.files].filter(f => f.name.endsWith('.json'));
  if (files.length > 0) ingestFiles(files);
});

/* 드롭존 클릭 → 파일 선택 (label 제외한 영역) */
loadDropzone.addEventListener('click', e => {
  if (e.target.closest('#load-file-btn') || e.target === loadFileInput) return;
  loadFileInput.click();
});

/* ── 파일 선택 버튼 ───────────────────────────── */
loadFileInput.addEventListener('change', e => {
  const files = [...e.target.files].filter(f => f.name.endsWith('.json'));
  if (files.length > 0) ingestFiles(files);
  loadFileInput.value = ''; // 초기화 (같은 파일 재선택 가능)
});

/* ── JSON 파일 파싱 → localStorage에 추가 ──────── */
function ingestFiles(files) {
  let pending = files.length;

  files.forEach(file => {
    const reader = new FileReader();
    reader.onload = ev => {
      pending--;
      let data;
      try { data = JSON.parse(ev.target.result); } catch { return; }
      if (!data.nodes || !data.edges) return;

      const name = data.name || file.name.replace(/\.json$/, '').replace(/_/g, ' ');

      const all = storeGetAll();
      const existing = Object.values(all).find(p => p.name === name);

      const proj = {
        id:      existing ? existing.id : ('proj-' + Date.now() + '-' + Math.random().toString(36).slice(2,6)),
        name,
        savedAt: data.savedAt || new Date().toISOString(),
        nodes:   data.nodes,
        edges:   data.edges,
        nextId:  data.nextId || 1,
      };

      storeSet(proj.id, proj);

      if (pending === 0) {
        renderLoadList(loadSearch.value.trim().toLowerCase());
      }
    };
    reader.readAsText(file);
  });
}

/* ── 불러오기 실행 ────────────────────────────── */
loadConfirmBtn.addEventListener('click', () => {
  if (loadSelectedIds.size === 0) return;
  const ids       = [...loadSelectedIds];
  const loadCount = ids.length;
  closeLoadPopup();
  processLoadQueue(ids, 0, loadCount);
});

function processLoadQueue(ids, idx, totalCount) {
  if (idx >= ids.length) {
    if (idx === 1) {
      const proj = storeGet(ids[0]);
      const name = proj ? proj.name : '프로젝트';
      showToast(`'${name}' 프로젝트를 불러왔습니다!`);
    } else {
      showToast(`${totalCount}개의 프로젝트를 불러왔습니다!`);
    }
    return;
  }

  const id   = ids[idx];
  const proj = storeGet(id);
  if (!proj) { processLoadQueue(ids, idx + 1, totalCount); return; }

  const activeId   = getActiveId();
  const activeName = document.getElementById('project-name').value.trim();

  if (proj.id !== activeId && proj.name === activeName) {
    showConfirm(
      'DUPLICATE PROJECT NAME',
      `<p>불러올 프로젝트 <strong>"${proj.name}"</strong>의 이름이 현재 열려 있는 프로젝트와 같습니다.</p>
       <p style="margin-top:8px;font-size:12px;color:var(--text3);">현재 프로젝트에 덮어씌울까요?</p>`,
      () => {
        const activeProj = storeGet(activeId) || {};
        const merged = { ...activeProj, nodes: proj.nodes, edges: proj.edges, nextId: proj.nextId };
        storeSet(activeId, merged);
        loadPipeline(merged);
        processLoadQueue(ids, idx + 1, totalCount);
      },
      () => {
        addAndSwitchToProject(proj);
        processLoadQueue(ids, idx + 1, totalCount);
      }
    );
    requestAnimationFrame(() => {
      const yesBtn = document.getElementById('confirm-yes');
      const noBtn  = document.getElementById('confirm-no');
      if (yesBtn) yesBtn.textContent = '덮어쓰기';
      if (noBtn)  noBtn.textContent  = '새 프로젝트로 추가';
    });
  } else if (proj.id === activeId) {
    loadPipeline(proj);
    processLoadQueue(ids, idx + 1, totalCount);
  } else {
    snapshotCurrentProject();
    addAndSwitchToProject(proj);
    processLoadQueue(ids, idx + 1, totalCount);
  }
}

function addAndSwitchToProject(proj) {
  setActiveId(proj.id);
  if (!document.querySelector(`.recent-item[data-id="${proj.id}"]`)) {
    const list = document.getElementById('recent-list');
    document.querySelectorAll('.recent-item').forEach(i => i.classList.remove('active'));
    const li = buildRecentItem(proj, true);
    list.insertBefore(li, list.firstChild);
  } else {
    document.querySelectorAll('.recent-item').forEach(i => {
      i.classList.toggle('active', i.dataset.id === proj.id);
    });
  }
  loadPipeline(proj);
}

/* ─────────────────────────────────────────────────
   INIT I/O CELLS
   ───────────────────────────────────────────────── */
function initIOCells() {
  const wrap    = document.getElementById('canvas-wrap');
  const canvasW = wrap.clientWidth  || 800;
  const canvasH = wrap.clientHeight || 600;
  const NODE_W  = 180;
  const centerX = Math.round((canvasW - NODE_W) / 2);

  if (!state.nodes.find(n => n.type === 'input'))  createNode('input',  centerX, 40);
  if (!state.nodes.find(n => n.type === 'output')) createNode('output', centerX, canvasH - 180);

  state.history   = [];
  state.redoStack = [];

  snapshotCurrentProject();
}

/* ─────────────────────────────────────────────────
   APP INIT  — 앱 시작 시 localStorage 복원
   ───────────────────────────────────────────────── */
(function initApp() {
  const all      = storeGetAll();
  const activeId = getActiveId();

  if (Object.keys(all).length === 0) {
    const id   = 'proj-' + Date.now();
    const name = 'Untitled Project';
    const proj = { id, name, savedAt: new Date().toISOString(), nodes: [], edges: [], nextId: 1 };
    storeSet(id, proj);
    setActiveId(id);
    document.getElementById('project-name').value = name;
    buildRecentsList();
    validatePipeline();
    requestAnimationFrame(initIOCells);
    return;
  }

  buildRecentsList();

  const projToLoad = activeId && all[activeId]
    ? all[activeId]
    : Object.values(all).sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt))[0];

  setActiveId(projToLoad.id);
  document.querySelectorAll('.recent-item').forEach(li => {
    li.classList.toggle('active', li.dataset.id === projToLoad.id);
  });
  loadPipeline(projToLoad);
}());