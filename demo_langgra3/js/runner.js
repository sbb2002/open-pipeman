/* ─────────────────────────────────────────────────
   RUNNER  — 백엔드 SSE 스트리밍 연동 및 실행 엔진
   의존: store.js(없음), state.js(state, btnRun, btnStop),
         canvas.js(drawEdges), inspector.js(openResultTabStreaming, streamResultTab, validatePipeline),
         hitl.js(showReviewBadge, showHumanReviewPopup),
         ui.js(showModal, showToast), edit.js(appendLog via window.appendLog)
   ───────────────────────────────────────────────── */

/* 백엔드 URL */
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

/* ── I/O ASSERTION ────────────────────────────── */
/**
 * 실행 전: 노드의 inputContract vs 실제 upstream output_schema 비교
 * 실행 후: 노드의 outputContract vs LLM이 생성한 output_schema 비교
 *
 * @param {object} contract  - 사용자 정의 JSON Schema (inputContract / outputContract)
 * @param {object} actual    - 실제 데이터의 schema (upstream.outputSchema or result.output_schema)
 * @param {string} label     - 로그 접두사 ('Input' | 'Output')
 * @returns {{ pass: boolean, assertions: Array<{pass:boolean, message:string}> }}
 */
function assertSchema(contract, actual, label) {
  const assertions = [];

  if (!contract || !contract.properties) {
    // contract 미정의 → assertion 스킵 (항상 pass)
    return { pass: true, assertions };
  }

  const contractProps = contract.properties;
  const actualProps   = (actual && actual.properties) ? actual.properties : {};

  for (const [key, def] of Object.entries(contractProps)) {
    const actualDef = actualProps[key];
    if (!actualDef) {
      assertions.push({
        pass: false,
        message: `${label}: required key "${key}" (${def.type}) not found in actual schema`,
      });
      continue;
    }
    // type 비교 (느슨하게: integer는 number와 호환)
    const expectedType = def.type;
    const actualType   = actualDef.type;
    const typeOk = expectedType === actualType
      || (expectedType === 'number' && actualType === 'integer')
      || (expectedType === 'integer' && actualType === 'number');

    assertions.push({
      pass: typeOk,
      message: typeOk
        ? `${label}: "${key}" — ${actualType} ✓`
        : `${label}: "${key}" type mismatch — expected ${expectedType}, got ${actualType}`,
    });
  }

  const pass = assertions.every(a => a.pass);
  return { pass, assertions };
}

/* SSE 스트림으로 단일 셀 실행 */
async function runCell(node, upstreamSchema) {
  const url = getBackendUrl();
  const cellId = String(node.id);

  // ── 실행 전 Input assertion ─────────────────────
  const preAssertions = [];
  if (node.inputContract) {
    const { assertions } = assertSchema(node.inputContract, upstreamSchema, 'Input');
    preAssertions.push(...assertions);
    const failed = assertions.filter(a => !a.pass);
    if (failed.length > 0) {
      failed.forEach(a => appendRunLog(`[${cellId}] ⚠ ASSERT FAIL — ${a.message}`));
      // assertion 실패는 경고로만 처리 (실행은 계속) — 결과에 기록
    } else {
      appendRunLog(`[${cellId}] ✓ Input assertion passed (${assertions.length} checks)`);
    }
  }

  const body = JSON.stringify({
    cell_id:          cellId,
    prompt:           node.prompt || node.label || node.name || '',
    model:            node.model  || '',
    upstream_schema:  upstreamSchema,
    allow_cleanup:    node.allowCleanup    || false,
    force_review:     node.forceReview     || false,
    hr_strictness:    window.getHRStrictness?.() || 'low',
    allow_web_search: node.webSearch       || false,
    max_retries:      window.getMaxRetries?.() ?? 3,
  });

  setNodeStatus(node.id, 'running');

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

              // ── 실행 후 Output assertion ────────────
              const postResult = assertSchema(
                n.outputContract,
                payload.output_schema || {},
                'Output'
              );
              if (n.outputContract) {
                if (postResult.pass) {
                  appendRunLog(`[${cellId}] ✓ Output assertion passed (${postResult.assertions.length} checks)`);
                } else {
                  postResult.assertions.filter(a => !a.pass).forEach(a =>
                    appendRunLog(`[${cellId}] ⚠ ASSERT FAIL — ${a.message}`)
                  );
                }
              }

              // 모든 assertion 결과를 result에 합산
              const allAssertions = [...preAssertions, ...postResult.assertions];

              n.result = {
                code:          payload.code          || '',
                docstring:     payload.docstring     || '',
                input_schema:  payload.input_schema  || {},
                output_schema: payload.output_schema || {},
                assertions:    allAssertions,
              };

              // Inspector가 이 노드를 보고 있으면 assertion 즉시 반영
              if (typeof _fillResultTab === 'function' && state.selectedNode === node.id) {
                _fillResultTab(n.result);
              }
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
    if (payload.status === 'done' && typeof streamResultTab === 'function') {
      streamResultTab(nodeId, {
        code:          payload.code      || '',
        docstring:     payload.docstring || '',
        output_schema: payload.output_schema || {},
      });
    }
  }
}

/* 로그 창 출력 헬퍼 */
function appendRunLog(msg) {
  if (typeof window.appendLog === 'function') { window.appendLog(msg); return; }
  console.log('[pipeline]', msg);
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
      const remainingIdx = runOrder.indexOf(nodeId) + 1;
      state.pendingRunOrder = runOrder.slice(remainingIdx);
      return;
    }
    if (result === 'failed') { finishRun(); return; }
  }

  if (state.running) finishRun();
}

/* Run / Stop 버튼 */
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

/* done 셀 클릭 → Inspector 열기 */
document.getElementById('canvas').addEventListener('click', e => {
  const nodeEl = e.target.closest('.cell-node');
  if (!nodeEl) return;
  const id = parseInt(nodeEl.id.replace('node-', ''), 10);
  if (typeof openInspector === 'function') openInspector(id);
});
