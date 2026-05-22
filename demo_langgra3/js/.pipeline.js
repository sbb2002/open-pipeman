/* ═══════════════════════════════════════════════
   PROJECT STORE  (localStorage  key: "pipeline_projects")
   저장 구조:
   {
     "proj-<id>": {
       id, name, savedAt,
       nodes, edges, nextId
     },
     ...
   }
   현재 열려있는 프로젝트 id:
     localStorage["pipeline_active_id"]
   ═══════════════════════════════════════════════ */

const LS_PROJECTS = 'pipeline_projects';
const LS_ACTIVE   = 'pipeline_active_id';

/* ── 스토어 헬퍼 ──────────────────────────────── */
function storeGetAll() {
  try { return JSON.parse(localStorage.getItem(LS_PROJECTS) || '{}'); }
  catch { return {}; }
}

function storeSaveAll(data) {
  localStorage.setItem(LS_PROJECTS, JSON.stringify(data));
}

function storeGet(id) {
  return storeGetAll()[id] || null;
}

function storeSet(id, project) {
  const all = storeGetAll();
  all[id] = project;
  storeSaveAll(all);
}

function storeDelete(id) {
  const all = storeGetAll();
  delete all[id];
  storeSaveAll(all);
}

function getActiveId() {
  return localStorage.getItem(LS_ACTIVE) || null;
}

function setActiveId(id) {
  if (id === null) localStorage.removeItem(LS_ACTIVE);
  else             localStorage.setItem(LS_ACTIVE, id);
}

/* ── 현재 캔버스 → 데이터 스냅샷 ─────────────── */
function snapshotCurrentProject() {
  const id = getActiveId();
  if (!id) return;
  const proj = storeGet(id);
  if (!proj) return;
  proj.nodes   = JSON.parse(JSON.stringify(state.nodes));
  proj.edges   = JSON.parse(JSON.stringify(state.edges));
  proj.nextId  = state.nextId;
  proj.name    = document.getElementById('project-name').value || proj.name;
  proj.savedAt = new Date().toISOString();
  storeSet(id, proj);
  const item = document.querySelector(`.recent-item[data-id="${id}"]`);
  if (item) item.querySelector('.recent-time').textContent = 'just now';
}

/* ── 상대시간 포맷 ────────────────────────────── */
function relativeTime(isoStr) {
  if (!isoStr) return '';
  const diff = Date.now() - new Date(isoStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)   return 'just now';
  if (m < 60)  return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7)   return `${d}d ago`;
  return `${Math.floor(d / 7)}w ago`;
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

/* 캔버스 초기화 헬퍼 */
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
   TOAST
   ───────────────────────────────────────────────── */
let toastTimer = null;

function showToast(msg) {
  const toast    = document.getElementById('toast');
  const toastMsg = document.getElementById('toast-msg');
  toastMsg.textContent = msg;
  toast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add('hidden'), 2600);
}

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
  let addedCount = 0;

  files.forEach(file => {
    const reader = new FileReader();
    reader.onload = ev => {
      pending--;
      let data;
      try { data = JSON.parse(ev.target.result); } catch { return; }
      if (!data.nodes || !data.edges) return;

      // 파일명 기반 이름 (저장된 name 우선)
      const name = data.name || file.name.replace(/\.json$/, '').replace(/_/g, ' ');

      // id 충돌 방지: 같은 name이 이미 있으면 업데이트, 없으면 신규
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
      addedCount++;

      // 마지막 파일까지 처리 완료되면 리스트 갱신
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
    // 전체 완료 → 토스트
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
   RUN / STOP  — 백엔드 SSE 스트리밍 연동
   ───────────────────────────────────────────────── */

/* 백엔드 URL (Settings > API Keys > FastAPI Endpoint) */
function getBackendUrl() {
  return (document.getElementById('apikey-backend').value || 'http://localhost:8000').replace(/\/$/, '');
}

/* 위상 정렬 (Kahn's) → 실행 순서 배열 반환 */
function topoSort(startNodeId, singleOnly) {
  const successors   = {};
  const predecessors = {};
  state.nodes.forEach(n => { successors[n.id] = []; predecessors[n.id] = []; });
  state.edges.forEach(e => {
    if (successors[e.from])   successors[e.from].push(e.to);
    if (predecessors[e.to])   predecessors[e.to].push(e.from);
  });
  const inDeg = {};
  state.nodes.forEach(n => inDeg[n.id] = predecessors[n.id].length);
  const queue = state.nodes.filter(n => inDeg[n.id] === 0).map(n => n.id);
  const order = [];
  while (queue.length) {
    const cur = queue.shift();
    order.push(cur);
    (successors[cur] || []).forEach(nxt => { inDeg[nxt]--; if (inDeg[nxt] === 0) queue.push(nxt); });
  }
  state.nodes.forEach(n => { if (!order.includes(n.id)) order.push(n.id); });

  let runOrder = order;
  if (startNodeId !== null && startNodeId !== undefined) {
    const startIdx = order.indexOf(startNodeId);
    runOrder = startIdx >= 0 ? order.slice(startIdx) : order;
  }
  if (singleOnly) runOrder = runOrder.slice(0, 1);
  return runOrder;
}

/* 이전 셀의 output_schema 추출 */
function getUpstreamSchema(nodeId) {
  const edge = state.edges.find(e => e.to === nodeId);
  if (!edge) return {};
  const upstream = state.nodes.find(n => n.id === edge.from);
  return (upstream && upstream.outputSchema) ? upstream.outputSchema : {};
}

/* SSE 스트림으로 단일 셀 실행 */
async function runCell(node, upstreamSchema) {
  const url = getBackendUrl();
  const cellId = String(node.id);

  const body = JSON.stringify({
    cell_id:         cellId,
    prompt:          node.prompt || node.label || node.name || '',
    model:           node.model  || '',
    upstream_schema: upstreamSchema,
  });

  setNodeStatus(node.id, 'running');

  /* 실행 시작 시 해당 셀의 Result 탭을 스트리밍 모드로 자동 오픈 */
  if (typeof openResultTabStreaming === 'function') openResultTabStreaming(node.id);

  try {
    const resp = await fetch(url + '/cell/run', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);

    const reader  = resp.body.getReader();
    const decoder = new TextDecoder();
    let   buf     = '';

    while (true) {
      if (!state.running) {
        reader.cancel();
        break;
      }
      const { done, value } = await reader.read();
      if (done) break;

      buf += decoder.decode(value, { stream: true });
      const parts = buf.split('\n\n');
      buf = parts.pop();

      let earlyExit = null;
      for (const part of parts) {
        const eventLine = part.split('\n').find(l => l.startsWith('event:'));
        const dataLine  = part.split('\n').find(l => l.startsWith('data:'));
        if (!dataLine) continue;

        const eventName = eventLine ? eventLine.replace('event:', '').trim() : 'message';
        let   payload;
        try { payload = JSON.parse(dataLine.replace('data:', '').trim()); } catch { continue; }

        handleSseEvent(node.id, eventName, payload);

        if (eventName === 'result') {
          const st = payload.status === 'done' ? 'done' : 'failed';
          setNodeStatus(node.id, st);
          if (st === 'done') {
            const n = state.nodes.find(x => x.id === node.id);
            if (n) {
              n.outputSchema = payload.output_schema || {};
              n.result = {
                code:          payload.code          || '',
                docstring:     payload.docstring     || '',
                input_schema:  payload.input_schema  || {},
                output_schema: payload.output_schema || {},
              };
            }
          }
          earlyExit = st;
          break;
        }

        if (eventName === 'paused') {
          setNodeStatus(node.id, 'paused');
          state.pausedCell = { nodeId: node.id, code: payload.code };
          showReviewBadge(node.id);
          showHumanReviewPopup(node.id, payload);
          earlyExit = 'paused';
          break;
        }
      }
      if (earlyExit !== null) return earlyExit;
    }
  } catch (err) {
    console.error('[runCell] error:', err);
    setNodeStatus(node.id, 'failed');
    showToast('셀 실행 오류: ' + err.message);
    return 'failed';
  }
  return 'done';
}

/* SSE 이벤트 → 로그 패널 출력 + Result 탭 실시간 업데이트 */
function handleSseEvent(nodeId, eventName, payload) {
  if (eventName === 'stage_start') {
    appendRunLog('[' + nodeId + '] ▶ ' + payload.stage);
    if (typeof streamResultTab === 'function') {
      streamResultTab(nodeId, { stage: payload.stage });
    }
  } else if (eventName === 'log' && payload.logs) {
    payload.logs.forEach(l => appendRunLog(l));
  } else if (eventName === 'result') {
    appendRunLog('[' + nodeId + '] ' + (payload.status === 'done' ? '✔ done' : '✖ failed'));
    /* 완료 시 Result 탭에 최종 결과 반영 */
    if (payload.status === 'done' && typeof streamResultTab === 'function') {
      streamResultTab(nodeId, {
        code:          payload.code      || '',
        docstring:     payload.docstring || '',
        output_schema: payload.output_schema || {},
      });
    }
  }
}

/* 로그 창 출력 헬퍼 (edit.js의 로그 창 재사용) */
function appendRunLog(msg) {
  if (typeof window.appendLog === 'function') { window.appendLog(msg); return; }
  console.log('[pipeline]', msg);
}

/* ── Human Review 뱃지 표시 ───────────────────── */
function showReviewBadge(nodeId) {
  const el = document.getElementById('node-' + nodeId);
  if (!el) return;
  // 기존 뱃지 제거
  const old = el.querySelector('.cell-review-badge');
  if (old) old.remove();

  el.classList.add('review-pending');

  const badge = document.createElement('div');
  badge.className = 'cell-review-badge';
  badge.textContent = '!';
  badge.title = 'Human Review 필요 — 클릭하여 검토';
  badge.addEventListener('click', e => {
    e.stopPropagation();
    const pc = state.pausedCell;
    if (pc && pc.nodeId === nodeId) {
      showHumanReviewPopup(nodeId, { code: pc.code });
    }
  });
  el.appendChild(badge);
}

function removeReviewBadge(nodeId) {
  const el = document.getElementById('node-' + nodeId);
  if (!el) return;
  el.classList.remove('review-pending');
  const badge = el.querySelector('.cell-review-badge');
  if (badge) badge.remove();
}

/* ── Human Review 팝업 ────────────────────────── */
function showHumanReviewPopup(nodeId, payload) {
  const node = state.nodes.find(n => n.id === nodeId);
  const overlay = document.getElementById('human-review-overlay');
  if (!overlay) return;

  /* 셀 라벨 */
  const cellLabel = document.getElementById('hr-cell-label');
  if (cellLabel) cellLabel.textContent = (node ? node.name : '') + ' — Cell #' + nodeId;

  /* AI 분석 데이터 채우기 (payload에 analysis 필드가 있으면 사용) */
  const analysis = payload.analysis || null;
  _fillHumanReview(analysis, payload.code || '');

  /* 코멘트 블록 초기화 */
  const rewriteBlock = document.getElementById('hr-rewrite-block');
  const rewriteMsg   = document.getElementById('hr-rewrite-msg');
  if (rewriteBlock) rewriteBlock.classList.add('hidden');
  if (rewriteMsg)   rewriteMsg.value = '';

  /* 버튼 이벤트 — cloneNode로 이전 핸들러 완전 제거 후 재바인딩 */
  function bindBtn(id, handler) {
    const btn = document.getElementById(id);
    if (!btn) return;
    const fresh = btn.cloneNode(true);
    btn.replaceWith(fresh);
    fresh.addEventListener('click', handler);
    return fresh;
  }

  bindBtn('hr-close', closeHumanReviewPopup);

  /* ✓ 승인 — 현재 결과물을 그대로 다음 단계로 진행 */
  bindBtn('hr-btn-approve', () => {
    closeHumanReviewPopup();
    removeReviewBadge(nodeId);
    resumeCell(nodeId, null);
  });

  /* ↺ 재작성 요청 — 첫 클릭: 코멘트란 열기 / 두 번째 클릭: 코멘트 유무로 전송 판정 */
  bindBtn('hr-btn-rewrite', () => {
    const block = document.getElementById('hr-rewrite-block');
    const msg   = document.getElementById('hr-rewrite-msg');
    if (!block) return;

    if (block.classList.contains('hidden')) {
      /* 첫 클릭 → 코멘트란 열기 */
      block.classList.remove('hidden');
      if (msg) msg.focus();
      return;
    }

    /* 두 번째 클릭 → 코멘트 있으면 재작성 요청 전송, 없으면 란만 닫기 */
    const comment = msg ? msg.value.trim() : '';
    if (comment) {
      closeHumanReviewPopup();
      removeReviewBadge(nodeId);
      resumeCell(nodeId, comment);
    } else {
      block.classList.add('hidden');
    }
  });

  /* ✕ 거절 — 현재 결과물을 거절하고 해당 셀을 failed 상태로 멈춤 */
  bindBtn('hr-btn-reject', () => {
    closeHumanReviewPopup();
    removeReviewBadge(nodeId);
    setNodeStatus(nodeId, 'failed');
    appendRunLog('[' + nodeId + '] ✖ rejected by human');
    finishRun();
  });

  overlay.classList.remove('hidden');

  /* 오버레이 배경 클릭으로 닫기 */
  overlay.onclick = e => { if (e.target === overlay) closeHumanReviewPopup(); };

  /* ESC 키 */
  function onEsc(e) {
    if (e.key === 'Escape') { closeHumanReviewPopup(); document.removeEventListener('keydown', onEsc); }
  }
  document.addEventListener('keydown', onEsc);
}

function closeHumanReviewPopup() {
  const overlay = document.getElementById('human-review-overlay');
  if (overlay) overlay.classList.add('hidden');
}

/* Human Review 팝업 내용 채우기 */
function _fillHumanReview(analysis, code) {
  /* 코드 미리보기 */
  const codeEl = document.getElementById('hr-code-preview');
  if (codeEl) codeEl.textContent = code || '(코드 없음)';

  /* analysis 없으면 기본 메시지 */
  const summaryEl = document.getElementById('hr-summary');
  if (!analysis) {
    if (summaryEl) summaryEl.textContent = '백엔드에서 human_review 인터럽트가 발생했습니다. 생성된 코드를 검토하고 승인 여부를 결정하세요.';
    _setConfBar(null);
    const itemsList = document.getElementById('hr-items-list');
    if (itemsList) itemsList.innerHTML = '';
    const risksList = document.getElementById('hr-risks-list');
    if (risksList) risksList.innerHTML = '';
    document.getElementById('hr-items-block').style.display = 'none';
    document.getElementById('hr-risks-block').style.display = 'none';
    return;
  }

  /* summary */
  if (summaryEl) summaryEl.textContent = analysis.summary || '';

  /* confidence bar */
  _setConfBar(analysis.confidence);

  /* items */
  const itemsBlock = document.getElementById('hr-items-block');
  const itemsList  = document.getElementById('hr-items-list');
  if (itemsList && analysis.items?.length) {
    itemsList.innerHTML = '';
    itemsBlock.style.display = '';
    analysis.items.forEach(it => {
      const tagClass = { ok: 'hr-tag-ok', warn: 'hr-tag-warn', err: 'hr-tag-err', info: 'hr-tag-info' }[it.status] || 'hr-tag-info';
      const tagLabel = { ok: '확인됨', warn: '주의', err: '문제', info: '참고' }[it.status] || it.status;
      const div = document.createElement('div');
      div.className = 'hr-item';
      div.innerHTML = `
        <div class="hr-item-left">
          ${it.category ? `<span class="hr-item-cat">${it.category}</span>` : ''}
          <span class="hr-item-text">${it.text}</span>
        </div>
        <span class="hr-tag ${tagClass}">${tagLabel}</span>
      `;
      itemsList.appendChild(div);
    });
  } else if (itemsBlock) {
    itemsBlock.style.display = 'none';
  }

  /* risks */
  const risksBlock = document.getElementById('hr-risks-block');
  const risksList  = document.getElementById('hr-risks-list');
  if (risksList && analysis.risks?.length) {
    risksList.innerHTML = '';
    risksBlock.style.display = '';
    analysis.risks.forEach(r => {
      const tagClass = { high: 'hr-tag-err', mid: 'hr-tag-warn', low: 'hr-tag-info' }[r.level] || 'hr-tag-info';
      const tagLabel = { high: 'HIGH', mid: 'MID', low: 'LOW' }[r.level] || r.level;
      const div = document.createElement('div');
      div.className = 'hr-risk';
      div.innerHTML = `
        <span class="hr-tag ${tagClass}">${tagLabel}</span>
        <span class="hr-risk-text">${r.desc}</span>
      `;
      risksList.appendChild(div);
    });
  } else if (risksBlock) {
    risksBlock.style.display = 'none';
  }
}

function _setConfBar(confidence) {
  const confBlock = document.getElementById('hr-confidence-block');
  const confFill  = document.getElementById('hr-conf-fill');
  const confValue = document.getElementById('hr-conf-value');
  if (confidence === null || confidence === undefined) {
    if (confBlock) confBlock.style.display = 'none';
    return;
  }
  if (confBlock) confBlock.style.display = '';
  const pct   = Math.round(confidence * 100);
  const color = confidence >= 0.75 ? 'var(--accent)' : confidence >= 0.5 ? 'var(--orange)' : 'var(--red)';
  const label = confidence >= 0.75 ? '높음' : confidence >= 0.5 ? '보통' : '낮음';
  if (confFill)  { confFill.style.width = pct + '%'; confFill.style.background = color; }
  if (confValue) confValue.textContent = pct + '% — ' + label;
}

/* Resume 요청 */
async function resumeCell(nodeId, updatedCode) {
  /* 혹시 남아있는 구 패널 제거 */
  const panel = document.getElementById('paused-panel');
  if (panel) panel.remove();
  /* 뱃지·팝업 정리 */
  removeReviewBadge(nodeId);
  closeHumanReviewPopup();

  const url  = getBackendUrl();
  const body = JSON.stringify({ cell_id: String(nodeId), updated_code: updatedCode });

  state.running    = true;
  btnRun.disabled  = true;
  btnStop.disabled = false;
  setNodeStatus(nodeId, 'running');

  try {
    const resp = await fetch(url + '/cell/resume', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);

    const reader  = resp.body.getReader();
    const decoder = new TextDecoder();
    let   buf     = '';

    let resumeFinished = false;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const parts = buf.split('\n\n');
      buf = parts.pop();
      for (const part of parts) {
        const eventLine = part.split('\n').find(l => l.startsWith('event:'));
        const dataLine  = part.split('\n').find(l => l.startsWith('data:'));
        if (!dataLine) continue;
        const eventName = eventLine ? eventLine.replace('event:', '').trim() : 'message';
        let   payload;
        try { payload = JSON.parse(dataLine.replace('data:', '').trim()); } catch { continue; }
        handleSseEvent(nodeId, eventName, payload);

        if (eventName === 'result') {
          const st = payload.status === 'done' ? 'done' : 'failed';
          setNodeStatus(nodeId, st);
          if (st === 'done') {
            const n = state.nodes.find(x => x.id === nodeId);
            if (n) {
              n.outputSchema = payload.output_schema || {};
              n.result = {
                code:          payload.code          || '',
                docstring:     payload.docstring     || '',
                input_schema:  payload.input_schema  || {},
                output_schema: payload.output_schema || {},
              };
            }
          }
          resumeFinished = true;
          break;
        }

        /* 재작성 요청 후 human_review 재진입 시 팝업 재표시 */
        if (eventName === 'paused') {
          setNodeStatus(nodeId, 'paused');
          state.pausedCell = { nodeId: nodeId, code: payload.code };
          showReviewBadge(nodeId);
          showHumanReviewPopup(nodeId, payload);
          resumeFinished = true;  /* finishRun 호출하지 않음 */
          break;
        }
      }
      if (resumeFinished) break;
    }
  } catch (err) {
    console.error('[resumeCell] error:', err);
    setNodeStatus(nodeId, 'failed');
    showToast('Resume 오류: ' + err.message);
  }

  /* paused 재진입이면 실행 상태 유지하고 대기, 그 외엔 남은 셀 이어서 실행 */
  const stillPaused = state.nodes.find(n => n.id === nodeId)?.status === 'paused';
  if (stillPaused) return;

  /* 남은 실행 순서가 있으면 이어서 실행 */
  const pending = state.pendingRunOrder || [];
  state.pendingRunOrder = [];

  if (pending.length > 0 && state.running) {
    for (const nextId of pending) {
      if (!state.running) break;
      const nextNode = state.nodes.find(n => n.id === nextId);
      if (!nextNode) continue;
      const upstreamSchema = getUpstreamSchema(nextId);
      const result = await runCell(nextNode, upstreamSchema);
      if (result === 'paused') {
        const remainingIdx = pending.indexOf(nextId) + 1;
        state.pendingRunOrder = pending.slice(remainingIdx);
        return;
      }
      if (result === 'failed') { finishRun(); return; }
    }
  }

  finishRun();
}

/* 전체 파이프라인 순차 실행 */
async function runFromNode(startNodeId, singleOnly) {
  state.nodes.forEach(n => setNodeStatus(n.id, 'pending'));
  const runOrder = topoSort(startNodeId, singleOnly);

  state.running    = true;
  btnRun.disabled  = true;
  btnStop.disabled = false;
  validatePipeline();

  for (const nodeId of runOrder) {
    if (!state.running) break;

    const node = state.nodes.find(n => n.id === nodeId);
    if (!node) continue;

    const upstreamSchema = getUpstreamSchema(nodeId);
    const result = await runCell(node, upstreamSchema);

    if (result === 'paused') {
      /* 남은 셀 순서를 저장해두고 resume 후 이어서 실행 */
      const remainingIdx = runOrder.indexOf(nodeId) + 1;
      state.pendingRunOrder = runOrder.slice(remainingIdx);
      return;
    }
    if (result === 'failed') { finishRun(); return; }
  }

  if (state.running) finishRun();
}

btnRun.addEventListener('click', () => {
  const { canRun, errors } = validatePipeline();
  if (!canRun) {
    const body = '<ul>' + errors.map(e => '<li>' + e + '</li>').join('') + '</ul>';
    showModal('Cannot Run Pipeline', body);
    return;
  }
  runFromNode(null, false);
});

btnStop.addEventListener('click', async () => {
  state.running = false;
  const url = getBackendUrl();

  const runningNode = state.nodes.find(n => n.status === 'running');
  if (runningNode) {
    setNodeStatus(runningNode.id, 'stopped');
    try {
      await fetch(url + '/cell/stop/' + runningNode.id, { method: 'POST' });
    } catch (e) {
      console.warn('[stop] backend stop 요청 실패:', e);
    }
  }
  btnRun.disabled  = false;
  btnStop.disabled = true;
  validatePipeline();
});

function finishRun() {
  state.running    = false;
  btnRun.disabled  = false;
  btnStop.disabled = true;
  validatePipeline();
}

function setNodeStatus(id, status) {
  const node = state.nodes.find(n => n.id === id);
  if (!node) return;
  node.status = status;
  const el = document.getElementById('node-' + id);
  if (!el) return;
  el.className = 'cell-node ' + status;
  if (state.selectedNode === id)        el.classList.add('selected');
  else if (state.selectedNodes.has(id)) el.classList.add('multi-selected');
}

/* done 셀 더블클릭 → Result 탭 열기 */
document.getElementById('canvas').addEventListener('click', e => {
  const nodeEl = e.target.closest('.cell-node');
  if (!nodeEl) return;
  const id = parseInt(nodeEl.id.replace('node-', ''), 10);
  const node = state.nodes.find(n => n.id === id);
  /* 클릭 시 Inspector 열기 — done이면 Result 탭, 아니면 Config 탭 */
  if (typeof openInspector === 'function') openInspector(id);
});
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