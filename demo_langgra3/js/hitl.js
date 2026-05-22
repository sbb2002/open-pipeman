/* ─────────────────────────────────────────────────
   HITL  (Human-in-the-Loop)
   의존: runner.js(runCell, finishRun, setNodeStatus, getBackendUrl),
         inspector.js(openResultTabStreaming, streamResultTab),
         ui.js(showToast), edit.js(appendLog via window.appendLog)
   ───────────────────────────────────────────────── */

/* ── Human Review 뱃지 표시 ───────────────────── */
function showReviewBadge(nodeId) {
  const el = document.getElementById('node-' + nodeId);
  if (!el) return;
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

  const cellLabel = document.getElementById('hr-cell-label');
  if (cellLabel) cellLabel.textContent = (node ? node.name : '') + ' — Cell #' + nodeId;

  const analysis = payload.analysis || null;
  _fillHumanReview(analysis, payload.code || '');

  const rewriteBlock = document.getElementById('hr-rewrite-block');
  const rewriteMsg   = document.getElementById('hr-rewrite-msg');
  if (rewriteBlock) rewriteBlock.classList.add('hidden');
  if (rewriteMsg)   rewriteMsg.value = '';

  function bindBtn(id, handler) {
    const btn = document.getElementById(id);
    if (!btn) return;
    const fresh = btn.cloneNode(true);
    btn.replaceWith(fresh);
    fresh.addEventListener('click', handler);
    return fresh;
  }

  bindBtn('hr-close', closeHumanReviewPopup);

  bindBtn('hr-btn-approve', () => {
    closeHumanReviewPopup();
    removeReviewBadge(nodeId);
    resumeCell(nodeId, null);
  });

  bindBtn('hr-btn-rewrite', () => {
    const block = document.getElementById('hr-rewrite-block');
    const msg   = document.getElementById('hr-rewrite-msg');
    if (!block) return;

    if (block.classList.contains('hidden')) {
      block.classList.remove('hidden');
      if (msg) msg.focus();
      return;
    }

    const comment = msg ? msg.value.trim() : '';
    if (comment) {
      closeHumanReviewPopup();
      removeReviewBadge(nodeId);
      resumeCell(nodeId, comment);
    } else {
      block.classList.add('hidden');
    }
  });

  bindBtn('hr-btn-reject', () => {
    closeHumanReviewPopup();
    removeReviewBadge(nodeId);
    setNodeStatus(nodeId, 'failed');
    appendRunLog('[' + nodeId + '] ✖ rejected by human');
    finishRun();
  });

  overlay.classList.remove('hidden');

  overlay.onclick = e => { if (e.target === overlay) closeHumanReviewPopup(); };

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
  const codeEl = document.getElementById('hr-code-preview');
  if (codeEl) codeEl.textContent = code || '(코드 없음)';

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

  if (summaryEl) summaryEl.textContent = analysis.summary || '';

  _setConfBar(analysis.confidence);

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

/* ── Resume 요청 ────────────────────────────────── */
async function resumeCell(nodeId, updatedCode) {
  const panel = document.getElementById('paused-panel');
  if (panel) panel.remove();
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
          resumeFinished = true;
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