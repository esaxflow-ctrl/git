'use strict';

// ── Tab switching ─────────────────────────────────────────────────────────────
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById('tab-' + tab.dataset.tab).classList.add('active');
    if (tab.dataset.tab === 'alerts')   loadAlerts();
    if (tab.dataset.tab === 'wallets')  loadWallets();
    if (tab.dataset.tab === 'markets')  loadMarkets();
    if (tab.dataset.tab === 'paper')    loadPaper();
    if (tab.dataset.tab === 'backtest') loadBacktest();
  });
});

// ── Range sliders ─────────────────────────────────────────────────────────────
document.getElementById('alert-min-score').addEventListener('input', e => {
  document.getElementById('alert-min-score-val').textContent = e.target.value;
});
document.getElementById('wallet-min-score').addEventListener('input', e => {
  document.getElementById('wallet-min-score-val').textContent = e.target.value;
});

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmt_usd = v => v == null ? '—' : '$' + Number(v).toLocaleString('en-US', {maximumFractionDigits: 0});
const fmt_pct = v => v == null ? '—' : Number(v).toFixed(1) + '%';
const fmt_p   = v => v == null ? '—' : Number(v).toFixed(4);
const fmt_ts  = s => s ? new Date(s).toLocaleString() : '—';

function pnl_class(v) {
  if (v == null) return '';
  return v > 0 ? 'pnl-pos' : v < 0 ? 'pnl-neg' : '';
}

function score_grade(score) {
  if (score >= 85) return 's';
  if (score >= 75) return 'a';
  if (score >= 60) return 'b';
  if (score >= 45) return 'c';
  if (score >= 30) return 'd';
  return 'f';
}

function signal_class(label) {
  if (!label) return 'noise';
  const l = label.toUpperCase();
  if (l === 'VERY_HIGH') return 'very-high';
  if (l === 'HIGH')      return 'high';
  if (l === 'MEDIUM')    return 'medium';
  return 'low';
}

async function api(path) {
  const r = await fetch(path);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

// ── Stats header ─────────────────────────────────────────────────────────────
async function loadStats() {
  try {
    const s = await api('/api/stats');
    document.getElementById('hs-wallets').textContent =
      `${s.wallets_tracked} wallets (${s.sharp_wallets} sharp)`;
    document.getElementById('hs-alerts').textContent =
      `${s.total_alerts} alerts (${s.high_signal_alerts} high)`;
    const pnl = s.paper_pnl_usd;
    const el = document.getElementById('hs-pnl');
    el.textContent = `Paper ${pnl >= 0 ? '+' : ''}${fmt_usd(pnl)} (${fmt_pct(s.paper_win_rate_pct)} WR)`;
    el.style.color = pnl >= 0 ? 'var(--green)' : 'var(--red)';
  } catch(e) { console.warn('stats:', e); }
}

// ── Alerts ────────────────────────────────────────────────────────────────────
async function loadAlerts() {
  const minScore = document.getElementById('alert-min-score').value;
  const action   = document.getElementById('alert-action-filter').value;
  const params   = new URLSearchParams({ limit: 80, min_score: minScore });
  if (action) params.set('action', action);

  const alerts = await api('/api/alerts?' + params);
  const container = document.getElementById('alerts-container');
  container.innerHTML = '';

  if (!alerts.length) {
    container.innerHTML = '<p style="color:var(--muted);padding:20px">No alerts found.</p>';
    return;
  }

  alerts.forEach(a => {
    const label = signalLabel(a.signal_score);
    const card = document.createElement('div');
    card.className = `alert-card ${label}`;
    card.innerHTML = `
      <div class="card-header">
        <div class="card-market" title="${esc(a.market_question)}">${esc(a.market_question || a.condition_id)}</div>
        <div class="score-badge ${signal_class(label)}">${a.signal_score.toFixed(0)}</div>
      </div>
      <div class="card-row"><span>Wallet score</span><span class="score-cell ${score_grade(a.wallet_sharp_score)}">${a.wallet_sharp_score.toFixed(1)}</span></div>
      <div class="card-row"><span>Outcome</span><span>${esc(a.outcome)}</span></div>
      <div class="card-row"><span>Entry price</span><span>${fmt_p(a.wallet_entry_price)} (${(a.wallet_entry_price*100).toFixed(1)}¢)</span></div>
      <div class="card-row"><span>Price at alert</span><span>${fmt_p(a.current_price_at_alert)}</span></div>
      <div class="card-row"><span>Trade size</span><span>${fmt_usd(a.trade_size_usd)}</span></div>
      <div class="card-row"><span>Status</span><span>${esc(a.status)}</span></div>
      <div class="card-row"><span>Time</span><span>${fmt_ts(a.created_at)}</span></div>
      <span class="action-tag ${esc(a.suggested_action)}">${esc(a.suggested_action)}</span>
    `;
    card.addEventListener('click', () => openAlertModal(a.id, a.suggested_action, a.status));
    container.appendChild(card);
  });
}

function signalLabel(score) {
  if (score >= 80) return 'high';
  if (score >= 65) return 'medium';
  if (score >= 50) return 'low';
  return 'noise';
}

// ── Alert modal ───────────────────────────────────────────────────────────────
async function openAlertModal(id, action, status) {
  const a = await api(`/api/alerts/${id}`);
  document.getElementById('modal-text').textContent = a.alert_text || JSON.stringify(a, null, 2);

  const actionsEl = document.getElementById('modal-actions');
  actionsEl.innerHTML = '';

  if (status === 'open' && (action === 'MANUAL_APPROVAL' || action === 'STRONG_WATCH')) {
    const approveBtn = document.createElement('button');
    approveBtn.className = 'btn green';
    approveBtn.textContent = '✓ Approve';
    approveBtn.onclick = async () => {
      await fetch(`/api/alerts/${id}/approve`, {method:'POST'});
      closeModal();
      loadAlerts();
    };
    const rejectBtn = document.createElement('button');
    rejectBtn.className = 'btn red';
    rejectBtn.textContent = '✗ Reject';
    rejectBtn.onclick = async () => {
      await fetch(`/api/alerts/${id}/reject`, {method:'POST'});
      closeModal();
      loadAlerts();
    };
    actionsEl.appendChild(approveBtn);
    actionsEl.appendChild(rejectBtn);
  }

  document.getElementById('modal-overlay').classList.remove('hidden');
}

function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
}

// ── Wallets ───────────────────────────────────────────────────────────────────
async function loadWallets() {
  const minScore = document.getElementById('wallet-min-score').value;
  const wallets = await api(`/api/wallets?limit=100&min_score=${minScore}`);
  const tbody = document.getElementById('wallets-tbody');
  tbody.innerHTML = '';

  wallets.forEach(w => {
    const tr = document.createElement('tr');
    const grade = score_grade(w.sharp_score);
    tr.innerHTML = `
      <td><a href="#" onclick="openWallet('${esc(w.address)}')">${esc(w.username || w.address.slice(0,12))}</a><br/><span style="color:var(--muted);font-size:11px">${esc(w.address.slice(0,16))}…</span></td>
      <td class="score-cell ${grade}">${w.sharp_score}</td>
      <td class="${w.total_profit_usd >= 0 ? 'pos' : 'neg'}">${fmt_usd(w.total_profit_usd)}</td>
      <td class="${w.roi_pct >= 0 ? 'pos' : 'neg'}">${fmt_pct(w.roi_pct)}</td>
      <td>${w.resolved_markets}</td>
      <td>${fmt_pct(w.win_rate_pct)}</td>
      <td>${fmt_usd(w.avg_position_size_usd)}</td>
      <td>${fmt_ts(w.last_scored)}</td>
    `;
    tbody.appendChild(tr);
  });
}

async function openWallet(address) {
  const w = await api(`/api/wallets/${address}`);
  const text = JSON.stringify(w, null, 2);
  document.getElementById('modal-text').textContent = text;
  document.getElementById('modal-actions').innerHTML = '';
  document.getElementById('modal-overlay').classList.remove('hidden');
}

// ── Markets ───────────────────────────────────────────────────────────────────
async function loadMarkets() {
  const sharpOnly = document.getElementById('sharp-only-filter').checked;
  const markets = await api(`/api/markets?limit=100&sharp_only=${sharpOnly}`);
  const tbody = document.getElementById('markets-tbody');
  tbody.innerHTML = '';

  markets.forEach(m => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td title="${esc(m.question)}" style="max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(m.question)}</td>
      <td>${esc(m.category || '—')}</td>
      <td>${fmt_p(m.yes_price)} <span style="color:var(--muted)">(${(m.yes_price*100).toFixed(1)}¢)</span></td>
      <td>${fmt_usd(m.liquidity_usd)}</td>
      <td>${fmt_usd(m.volume_24h_usd)}</td>
      <td>${m.sharp_wallet_count > 0 ? `<span style="color:var(--accent)">⚡ ${m.sharp_wallet_count}</span>` : '<span style="color:var(--muted)">0</span>'}</td>
    `;
    tbody.appendChild(tr);
  });
}

// ── Paper trades ──────────────────────────────────────────────────────────────
async function loadPaper() {
  const data = await api('/api/paper-trades');
  const s = data.summary;

  document.getElementById('paper-summary').innerHTML = `
    <div class="summary-card"><div class="val">${s.total_trades || 0}</div><div class="lbl">Total Trades</div></div>
    <div class="summary-card"><div class="val">${s.open || 0}</div><div class="lbl">Open</div></div>
    <div class="summary-card"><div class="val">${s.closed || 0}</div><div class="lbl">Closed</div></div>
    <div class="summary-card"><div class="val ${(s.total_pnl_usd||0) >= 0 ? 'pnl-pos' : 'pnl-neg'}">${(s.total_pnl_usd||0) >= 0 ? '+' : ''}${fmt_usd(s.total_pnl_usd)}</div><div class="lbl">Total PnL</div></div>
    <div class="summary-card"><div class="val">${fmt_pct(s.win_rate_pct)}</div><div class="lbl">Win Rate</div></div>
    <div class="summary-card"><div class="val ${(s.avg_pnl_usd||0) >= 0 ? 'pnl-pos' : 'pnl-neg'}">${fmt_usd(s.avg_pnl_usd)}</div><div class="lbl">Avg PnL</div></div>
    <div class="summary-card"><div class="val pnl-pos">${fmt_usd(s.best_trade_usd)}</div><div class="lbl">Best Trade</div></div>
    <div class="summary-card"><div class="val pnl-neg">${fmt_usd(s.worst_trade_usd)}</div><div class="lbl">Worst Trade</div></div>
  `;

  const tbody = document.getElementById('paper-tbody');
  tbody.innerHTML = '';
  (data.open_trades || []).forEach(t => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${esc(t.condition_id.slice(0,20))}…</td>
      <td>${esc(t.outcome)}</td>
      <td>${fmt_p(t.entry_price)}</td>
      <td>${fmt_usd(t.size_usd)}</td>
      <td>${fmt_ts(t.entered_at)}</td>
    `;
    tbody.appendChild(tr);
  });

  const closedTbody = document.getElementById('paper-closed-tbody');
  closedTbody.innerHTML = '';
  (data.closed_trades || []).forEach(t => {
    const tr = document.createElement('tr');
    const pnlClass = t.pnl_usd == null ? '' : t.pnl_usd > 0 ? 'pnl-pos' : t.pnl_usd < 0 ? 'pnl-neg' : '';
    tr.innerHTML = `
      <td>${esc(t.condition_id.slice(0,20))}…</td>
      <td>${esc(t.outcome)}</td>
      <td>${fmt_p(t.entry_price)}</td>
      <td>${t.exit_price != null ? fmt_p(t.exit_price) : '—'}</td>
      <td>${fmt_usd(t.size_usd)}</td>
      <td class="${pnlClass}">${t.pnl_usd != null ? (t.pnl_usd >= 0 ? '+' : '') + fmt_usd(t.pnl_usd) : '—'}</td>
      <td class="${pnlClass}">${t.pnl_pct != null ? (t.pnl_pct >= 0 ? '+' : '') + t.pnl_pct.toFixed(1) + '%' : '—'}</td>
      <td>${esc(t.status)}</td>
      <td>${fmt_ts(t.exited_at)}</td>
    `;
    closedTbody.appendChild(tr);
  });
}

// ── Backtest ──────────────────────────────────────────────────────────────────
function pnl_cell(v) {
  if (v == null) return '—';
  return `<span class="${pnl_class(v)}">${v > 0 ? '+' : ''}${v}%</span>`;
}

async function loadBacktest() {
  const data = await api('/api/backtest');
  const s = data;

  document.getElementById('backtest-summary').innerHTML = `
    <div class="summary-card"><div class="val">${s.total_alerts || 0}</div><div class="lbl">Total Alerts</div></div>
    <div class="summary-card"><div class="val">${s.alerts_with_data || 0}</div><div class="lbl">With Data</div></div>
    <div class="summary-card"><div class="val ${pnl_class(s.avg_pnl_5m_pct)}">${pnl_cell(s.avg_pnl_5m_pct)}</div><div class="lbl">Avg PnL +5m</div></div>
    <div class="summary-card"><div class="val ${pnl_class(s.avg_pnl_30m_pct)}">${pnl_cell(s.avg_pnl_30m_pct)}</div><div class="lbl">Avg PnL +30m</div></div>
    <div class="summary-card"><div class="val ${pnl_class(s.avg_pnl_2h_pct)}">${pnl_cell(s.avg_pnl_2h_pct)}</div><div class="lbl">Avg PnL +2h</div></div>
    <div class="summary-card"><div class="val ${pnl_class(s.avg_pnl_24h_pct)}">${pnl_cell(s.avg_pnl_24h_pct)}</div><div class="lbl">Avg PnL +24h</div></div>
    <div class="summary-card"><div class="val">${s.win_rate_24h_pct != null ? s.win_rate_24h_pct + '%' : '—'}</div><div class="lbl">Win Rate +24h</div></div>
    <div class="summary-card"><div class="val">${s.win_rate_res_pct != null ? s.win_rate_res_pct + '%' : '—'}</div><div class="lbl">Win Rate Res</div></div>
  `;

  // By action breakdown
  const byAction = s.by_action || {};
  if (Object.keys(byAction).length > 0) {
    let actionHtml = '<h3 style="margin:20px 0 10px">By Action Type</h3><table class="data-table"><thead><tr><th>Action</th><th>#</th><th>Avg +30m</th><th>Avg +2h</th><th>Avg +24h</th><th>Avg Res</th><th>WR 24h</th><th>WR Res</th></tr></thead><tbody>';
    for (const [action, g] of Object.entries(byAction)) {
      actionHtml += `<tr>
        <td><span class="action-tag ${esc(action)}">${esc(action)}</span></td>
        <td>${g.count}</td>
        <td>${pnl_cell(g.avg_pnl_30m_pct)}</td>
        <td>${pnl_cell(g.avg_pnl_2h_pct)}</td>
        <td>${pnl_cell(g.avg_pnl_24h_pct)}</td>
        <td>${pnl_cell(g.avg_pnl_res_pct)}</td>
        <td>${g.win_rate_24h_pct != null ? g.win_rate_24h_pct + '%' : '—'}</td>
        <td>${g.win_rate_res_pct != null ? g.win_rate_res_pct + '%' : '—'}</td>
      </tr>`;
    }
    actionHtml += '</tbody></table>';
    document.getElementById('backtest-summary').insertAdjacentHTML('afterend', actionHtml.replace('id="backtest-action-table"', '') );
    // Use a dedicated container
    let actionEl = document.getElementById('backtest-by-action');
    if (!actionEl) {
      actionEl = document.createElement('div');
      actionEl.id = 'backtest-by-action';
      document.getElementById('backtest-summary').after(actionEl);
    }
    actionEl.innerHTML = actionHtml;
  }

  // By score range breakdown
  const byScore = s.by_score_range || {};
  if (Object.keys(byScore).length > 0) {
    let scoreHtml = '<h3 style="margin:20px 0 10px">By Signal Score Range</h3><table class="data-table"><thead><tr><th>Score Range</th><th>#</th><th>Avg +30m</th><th>Avg +2h</th><th>Avg +24h</th><th>WR 24h</th><th>WR Res</th></tr></thead><tbody>';
    for (const [range, g] of Object.entries(byScore)) {
      if (g.count === 0) continue;
      scoreHtml += `<tr>
        <td>${esc(range)}</td>
        <td>${g.count}</td>
        <td>${pnl_cell(g.avg_pnl_30m_pct)}</td>
        <td>${pnl_cell(g.avg_pnl_2h_pct)}</td>
        <td>${pnl_cell(g.avg_pnl_24h_pct)}</td>
        <td>${g.win_rate_24h_pct != null ? g.win_rate_24h_pct + '%' : '—'}</td>
        <td>${g.win_rate_res_pct != null ? g.win_rate_res_pct + '%' : '—'}</td>
      </tr>`;
    }
    scoreHtml += '</tbody></table>';
    let scoreEl = document.getElementById('backtest-by-score');
    if (!scoreEl) {
      scoreEl = document.createElement('div');
      scoreEl.id = 'backtest-by-score';
      const actionEl = document.getElementById('backtest-by-action');
      if (actionEl) actionEl.after(scoreEl);
      else document.getElementById('backtest-summary').after(scoreEl);
    }
    scoreEl.innerHTML = scoreHtml;
  }

  const tbody = document.getElementById('backtest-tbody');
  tbody.innerHTML = '';
  (s.rows || []).forEach(r => {
    const tr = document.createElement('tr');
    const cell = label => {
      const v = r[`pnl_${label}_pct`];
      if (v == null) return '<td class="neu">—</td>';
      return `<td class="${v > 0 ? 'pnl-pos' : v < 0 ? 'pnl-neg' : ''}">${v > 0 ? '+' : ''}${v}%</td>`;
    };
    tr.innerHTML = `
      <td title="${esc(r.market)}">${esc((r.market||'').slice(0,40))}…</td>
      <td>${esc(r.outcome)}</td>
      <td>${r.signal_score}</td>
      <td>${fmt_p(r.entry_price)}</td>
      ${cell('5m')}${cell('30m')}${cell('2h')}${cell('24h')}
      <td><span class="action-tag ${esc(r.action)}">${esc(r.action)}</span></td>
    `;
    tbody.appendChild(tr);
  });
}

// ── SSE live stream ───────────────────────────────────────────────────────────
function connectSSE() {
  const dot = document.getElementById('live-dot');
  const es = new EventSource('/api/stream');

  es.onopen = () => dot.classList.add('connected');
  es.onerror = () => {
    dot.classList.remove('connected');
    setTimeout(connectSSE, 5000);
    es.close();
  };

  es.onmessage = e => {
    try {
      const ev = JSON.parse(e.data);
      if (ev.type === 'heartbeat') return;
      if (ev.type === 'alert') {
        // Refresh alert list if on that tab
        if (document.querySelector('.tab.active[data-tab="alerts"]')) {
          loadAlerts();
        }
        loadStats();
        showToast(`⚡ New alert: ${ev.market} — score ${ev.score}`);
      }
    } catch(_) {}
  };
}

function showToast(msg) {
  const t = document.createElement('div');
  t.style.cssText = 'position:fixed;bottom:20px;right:20px;background:#1c2030;border:1px solid #00d4ff;border-radius:6px;padding:12px 18px;z-index:999;font-size:12px;color:#e8eaf0;max-width:320px;box-shadow:0 4px 20px rgba(0,0,0,0.5)';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 6000);
}

function esc(s) {
  if (s == null) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Init ──────────────────────────────────────────────────────────────────────
loadStats();
loadAlerts();
connectSSE();

// Auto-refresh every 60s
setInterval(() => {
  loadStats();
  const activeTab = document.querySelector('.tab.active');
  if (activeTab) {
    const t = activeTab.dataset.tab;
    if (t === 'alerts')   loadAlerts();
    if (t === 'wallets')  loadWallets();
    if (t === 'markets')  loadMarkets();
    if (t === 'paper')    loadPaper();
    if (t === 'backtest') loadBacktest();
  }
}, 60000);
