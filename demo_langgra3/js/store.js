/* ═══════════════════════════════════════════════
   STORE  (localStorage  key: "pipeline_projects")
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