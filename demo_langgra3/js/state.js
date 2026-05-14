/* ── STATE ───────────────────────────────────── */
const state = {
  nodes: [],          // { id, type, name, x, y, model, inputType, outputType, inputDesc, outputDesc, prompt, webSearch, domains, status }
  edges: [],          // { from, to, valid }
  selectedNode: null,
  selectedNodes: new Set(), // multi-select node ids
  selectedEdge: null, // currently selected edge object
  connectingFrom: null,
  connectingFromMulti: null, // Set of node ids — multi-source connecting mode
  nextId: 1,
  running: false,
  dragging: null,     // { nodeId, offsetX, offsetY, startPositions, isCtrlDrag }
  boxSelect: null,    // { startX, startY } — lasso drag in canvas logical coords
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