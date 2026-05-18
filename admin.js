// =============================================================================
// admin.js — Admin Portal Logic for JJ Apartment RMS
// Depends on: api.js (must be loaded first)
// =============================================================================

// ---------------------------------------------------------------------------
// STATE
// ---------------------------------------------------------------------------
let _pin        = '';          // admin PIN held in memory for the session
let _cfg        = {};          // config from Sheets
let _tenants    = [];          // all tenants (active + moved-out)
let _ledgerData = null;        // full ledger response
let _pendingPayments = [];     // pending approval queue
let _allPayments     = [];     // payment history (admin view)
let _activeTab  = 'dashboard';
let _ledgerFilter = 'all';

// ---------------------------------------------------------------------------
// BOOT
// ---------------------------------------------------------------------------
(async function boot() {
  try {
    _cfg = await apiGetConfig();
    applyPropertyName(_cfg.property_name || 'Property', 'Admin Portal');
  } catch (e) {
    // If config fails, still show login so admin can try again
    applyPropertyName('Property', 'Admin Portal');
  }

  // Wire up login
  const pinInput = document.getElementById('pin-input');
  const loginBtn = document.getElementById('login-btn');

  loginBtn.addEventListener('click', attemptLogin);
  pinInput.addEventListener('keydown', e => { if (e.key === 'Enter') attemptLogin(); });

  // Wire up global nav & controls
  document.querySelectorAll('.nav-tab').forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });

  document.getElementById('logout-btn').addEventListener('click', logout);
  document.getElementById('refresh-btn').addEventListener('click', () => loadActiveTab(true));

  // Quick-action buttons (dashboard)
  document.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', () => handleQuickAction(btn.dataset.action));
  });

  // Ledger filter pills
  document.querySelectorAll('[data-ledger-filter]').forEach(pill => {
    pill.addEventListener('click', () => {
      _ledgerFilter = pill.dataset.ledgerFilter;
      document.querySelectorAll('[data-ledger-filter]').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      renderLedger();
    });
  });

  document.getElementById('btn-refresh-ledger').addEventListener('click', () => loadLedger(true));

  // Billing tab
  document.getElementById('billing-month').value = getCurrentMonth();
  document.getElementById('btn-load-readings').addEventListener('click', loadReadingsForm);
  document.getElementById('btn-save-readings').addEventListener('click', saveReadings);

  // Tenant tab
  document.getElementById('btn-add-tenant').addEventListener('click', openAddTenant);
  document.getElementById('btn-submit-tenant').addEventListener('click', submitTenantForm);

  // Log payment modal
  document.getElementById('btn-submit-log-payment').addEventListener('click', submitLogPayment);
  document.getElementById('lp-tenant').addEventListener('change', onLogPaymentTenantChange);

  // Move-out date reveal
  document.getElementById('tf-status').addEventListener('change', function () {
    document.getElementById('tf-moveout-row').classList.toggle('hidden', this.value !== 'moved-out');
  });

  // Approve/reject modal buttons
  document.getElementById('btn-approve').addEventListener('click', () => submitApproval('approve'));
  document.getElementById('btn-reject').addEventListener('click', () => submitApproval('reject'));

  // History filter
  document.getElementById('history-tenant-filter').addEventListener('change', renderPaymentHistory);

  // Payments tab – add tenant
  document.getElementById('btn-add-tenant').addEventListener('click', openAddTenant);
})();

// ---------------------------------------------------------------------------
// AUTH
// ---------------------------------------------------------------------------
async function attemptLogin() {
  const pinInput  = document.getElementById('pin-input');
  const loginErr  = document.getElementById('login-error');
  const loginBtn  = document.getElementById('login-btn');
  const entered   = pinInput.value.trim();

  if (!entered) { pinInput.focus(); return; }

  setBtnLoading(loginBtn, true, 'Checking…');
  loginErr.classList.add('hidden');

  try {
    // Fetch fresh config in case it was unavailable at boot
    if (!_cfg.admin_pin) _cfg = await apiGetConfig(true);

    if (entered === String(_cfg.admin_pin)) {
      _pin = entered;
      document.getElementById('login-screen').classList.add('hidden');
      document.getElementById('app-shell').classList.remove('hidden');
      pinInput.value = '';
      await loadDashboard();
    } else {
      loginErr.classList.remove('hidden');
      pinInput.value = '';
      pinInput.focus();
    }
  } catch (e) {
    loginErr.textContent = 'Connection error. Check your internet and try again.';
    loginErr.classList.remove('hidden');
  } finally {
    setBtnLoading(loginBtn, false);
    loginBtn.textContent = 'Sign In';
  }
}

function logout() {
  _pin = '';
  _cfg = {};
  _tenants = [];
  _ledgerData = null;
  _cacheClear();
  document.getElementById('app-shell').classList.add('hidden');
  document.getElementById('login-screen').classList.remove('hidden');
  document.getElementById('pin-input').value = '';
  switchTab('dashboard');
}

// ---------------------------------------------------------------------------
// TAB SWITCHING
// ---------------------------------------------------------------------------
function switchTab(tabName) {
  _activeTab = tabName;

  document.querySelectorAll('.nav-tab').forEach(t => {
    const isActive = t.dataset.tab === tabName;
    t.classList.toggle('active', isActive);
    t.setAttribute('aria-selected', isActive);
  });

  document.querySelectorAll('[id^="tab-"]').forEach(s => s.classList.add('hidden'));
  document.getElementById(`tab-${tabName}`).classList.remove('hidden');

  loadActiveTab(false);
}

async function loadActiveTab(bustCache = false) {
  switch (_activeTab) {
    case 'dashboard': return loadDashboard(bustCache);
    case 'tenants':   return loadTenants(bustCache);
    case 'billing':   return;  // billing loads on user action
    case 'payments':  return loadPaymentsTab(bustCache);
    case 'ledger':    return loadLedger(bustCache);
  }
}

// ---------------------------------------------------------------------------
// DASHBOARD
// ---------------------------------------------------------------------------
async function loadDashboard(bustCache = false) {
  try {
    const data = await apiGetDashboard(_pin, null, bustCache);
    renderDashboard(data);
  } catch (e) {
    document.getElementById('dash-stats').innerHTML =
      `<div class="empty-state"><p class="empty-state__msg">${esc(e.message)}</p></div>`;
  }
}

function renderDashboard(data) {
  document.getElementById('dash-month').textContent = formatMonth(data.month);

  // Stat cards
  document.getElementById('dash-stats').innerHTML = `
    <div class="stat-card">
      <div class="stat-card__icon">💰</div>
      <div class="stat-card__label">Collected this month</div>
      <div class="stat-card__value">${formatPeso(data.collected_month)}</div>
    </div>
    <div class="stat-card">
      <div class="stat-card__icon">🕐</div>
      <div class="stat-card__label">Pending approvals</div>
      <div class="stat-card__value ${data.pending_count > 0 ? 'text-amber' : ''}">${data.pending_count}</div>
    </div>
    <div class="stat-card">
      <div class="stat-card__icon">⚠️</div>
      <div class="stat-card__label">Overdue tenants</div>
      <div class="stat-card__value ${data.overdue_count > 0 ? 'text-red' : ''}">${data.overdue_count}</div>
    </div>
    <div class="stat-card">
      <div class="stat-card__icon">🏠</div>
      <div class="stat-card__label">Active tenants</div>
      <div class="stat-card__value">${data.occupancy}</div>
    </div>
  `;

  // Recent activity feed
  const actEl = document.getElementById('dash-activity');
  if (!data.recent_payments || data.recent_payments.length === 0) {
    actEl.innerHTML = `<div class="empty-state"><p class="empty-state__msg">No payment activity yet.</p></div>`;
    return;
  }

  actEl.innerHTML = data.recent_payments.map(p => `
    <div class="activity-item">
      <div class="activity-dot activity-dot--${p.status === 'pending' ? 'pending' : p.status === 'rejected' ? 'rejected' : ''}"></div>
      <div class="activity-info">
        <div class="activity-name">${esc(p.tenant_name)} — ${esc(p.unit)}</div>
        <div class="activity-meta">${esc(p.date)} · ${esc(p.method || '—')} · ${statusBadge(p.status)}</div>
      </div>
      <div class="activity-amount">${formatPeso(p.amount)}</div>
    </div>
  `).join('');
}

// ---------------------------------------------------------------------------
// TENANTS TAB
// ---------------------------------------------------------------------------
async function loadTenants(bustCache = false) {
  const el = document.getElementById('tenants-list');
  showSkeleton(el, 3);
  try {
    _tenants = await apiGetAllTenants(_pin, bustCache);
    renderTenants();
  } catch (e) {
    el.innerHTML = `<div class="empty-state"><p class="empty-state__msg">${esc(e.message)}</p></div>`;
  }
}

function renderTenants() {
  const el = document.getElementById('tenants-list');
  const active   = _tenants.filter(t => t.status === 'active');
  const movedOut = _tenants.filter(t => t.status === 'moved-out');

  if (_tenants.length === 0) {
    el.innerHTML = `<div class="empty-state">
      <div class="empty-state__icon">🏠</div>
      <div class="empty-state__title">No tenants yet</div>
      <p class="empty-state__msg">Click "Add tenant" to get started.</p>
    </div>`;
    return;
  }

  const renderGroup = (tenants, label) => {
    if (!tenants.length) return '';
    return `
      <p class="section-title mt-md">${label}</p>
      ${tenants.map(t => `
        <div class="card card--flat mb-sm">
          <div class="d-flex align-center justify-between gap-sm mb-sm">
            <div>
              <div class="fw-semi">${esc(t.name)}</div>
              <div class="text-muted text-sm">${esc(t.unit)}${t.room_type ? ' · ' + esc(t.room_type) : ''}</div>
            </div>
            <span class="badge ${t.status === 'active' ? 'badge-paid' : 'badge-unpaid'}">${esc(t.status)}</span>
          </div>
          <div class="d-flex gap-sm" style="flex-wrap:wrap;font-size:.78rem;color:var(--txt-muted);margin-bottom:var(--sp-md)">
            <span>Login: <strong>${esc(t.login_code)}</strong></span>
            <span>Rent: <strong>${formatPeso(t.monthly_rent)}</strong>/mo</span>
            ${t.email ? `<span>✉ ${esc(t.email)}</span>` : ''}
            ${t.contact ? `<span>📞 ${esc(t.contact)}</span>` : ''}
          </div>
          <div class="d-flex gap-sm">
            <button class="btn btn-ghost btn-sm" type="button"
              onclick="openEditTenant('${esc(t.tenant_id)}')">Edit</button>
            <button class="btn btn-secondary btn-sm" type="button"
              onclick="viewTenantPayments('${esc(t.tenant_id)}')">Payments</button>
          </div>
        </div>
      `).join('')}
    `;
  };

  el.innerHTML = renderGroup(active, `Active (${active.length})`) +
                 renderGroup(movedOut, `Moved out (${movedOut.length})`);
}

function openAddTenant() {
  document.getElementById('modal-tenant-title').textContent = 'Add Tenant';
  document.getElementById('btn-submit-tenant').textContent  = 'Add tenant';
  document.getElementById('tenant-form-id').value           = '';

  // Clear form
  ['tf-name','tf-unit','tf-room-type','tf-move-in','tf-rent',
   'tf-deposit','tf-email','tf-contact','tf-login-code'].forEach(id => {
    document.getElementById(id).value = '';
  });
  document.getElementById('tf-status').value = 'active';
  document.getElementById('tf-moveout-row').classList.add('hidden');
  document.getElementById('tf-move-out').value = '';
  openModal('modal-tenant');
}

function openEditTenant(tenantId) {
  const t = _tenants.find(x => String(x.tenant_id) === String(tenantId));
  if (!t) return;

  document.getElementById('modal-tenant-title').textContent = 'Edit Tenant';
  document.getElementById('btn-submit-tenant').textContent  = 'Save changes';
  document.getElementById('tenant-form-id').value           = t.tenant_id;

  document.getElementById('tf-name').value       = t.name        || '';
  document.getElementById('tf-unit').value       = t.unit        || '';
  document.getElementById('tf-room-type').value  = t.room_type   || '';
  document.getElementById('tf-move-in').value    = t.move_in_date || '';
  document.getElementById('tf-rent').value       = t.monthly_rent || '';
  document.getElementById('tf-deposit').value    = t.deposit_paid || '';
  document.getElementById('tf-email').value      = t.email       || '';
  document.getElementById('tf-contact').value    = t.contact     || '';
  document.getElementById('tf-login-code').value = t.login_code  || '';
  document.getElementById('tf-status').value     = t.status      || 'active';
  document.getElementById('tf-move-out').value   = t.move_out_date || '';

  document.getElementById('tf-moveout-row').classList.toggle('hidden', t.status !== 'moved-out');
  openModal('modal-tenant');
}

async function submitTenantForm() {
  const btn      = document.getElementById('btn-submit-tenant');
  const tenantId = document.getElementById('tenant-form-id').value.trim();
  const isEdit   = !!tenantId;

  const payload = {
    tenant_id:     tenantId,
    name:          document.getElementById('tf-name').value.trim(),
    unit:          document.getElementById('tf-unit').value.trim(),
    room_type:     document.getElementById('tf-room-type').value.trim(),
    move_in_date:  document.getElementById('tf-move-in').value,
    monthly_rent:  document.getElementById('tf-rent').value,
    deposit_paid:  document.getElementById('tf-deposit').value,
    email:         document.getElementById('tf-email').value.trim(),
    contact:       document.getElementById('tf-contact').value.trim(),
    login_code:    document.getElementById('tf-login-code').value.trim(),
    status:        document.getElementById('tf-status').value,
    move_out_date: document.getElementById('tf-move-out').value,
  };

  if (!payload.name || !payload.unit || !payload.monthly_rent) {
    showToast('Name, unit, and monthly rent are required.', 'error');
    return;
  }

  setBtnLoading(btn, true);
  try {
    if (isEdit) {
      await apiUpdateTenant(_pin, payload);
      showToast('Tenant updated.', 'success');
    } else {
      await apiAddTenant(_pin, payload);
      showToast('Tenant added.', 'success');
    }
    closeModal('modal-tenant');
    await loadTenants(true);
    // Refresh tenant dropdown in Log Payment modal
    populateLogPaymentTenants();
  } catch (e) {
    showToast(e.message, 'error');
  } finally {
    setBtnLoading(btn, false);
    btn.textContent = isEdit ? 'Save changes' : 'Add tenant';
  }
}

function viewTenantPayments(tenantId) {
  // Switch to Payments tab and pre-filter by this tenant
  switchTab('payments');
  const filter = document.getElementById('history-tenant-filter');
  filter.value = tenantId;
  renderPaymentHistory();
}

// ---------------------------------------------------------------------------
// BILLING / METER READINGS TAB
// ---------------------------------------------------------------------------
async function loadReadingsForm() {
  const month   = document.getElementById('billing-month').value;
  const el      = document.getElementById('readings-list');
  const footer  = document.getElementById('readings-footer');

  if (!month) { showToast('Please select a billing month.', 'error'); return; }

  showSkeleton(el, 4);
  footer.classList.add('hidden');

  try {
    if (_tenants.length === 0) {
      _tenants = await apiGetAllTenants(_pin);
    }
    const active = _tenants.filter(t => t.status === 'active');
    if (!active.length) {
      el.innerHTML = `<div class="empty-state"><p class="empty-state__msg">No active tenants found.</p></div>`;
      return;
    }

    // Fetch existing billing for this month to prefill current values
    let existingBilling = [];
    try {
      // We fetch each tenant's billing; for large sets a dedicated endpoint would be better,
      // but for ~20 tenants a single getLedger call covers it
      if (!_ledgerData) {
        _ledgerData = await apiGetLedger(_pin);
      }
      existingBilling = _ledgerData.ledger.flatMap(row =>
        row.months.filter(m => m.month === month).map(m => ({
          ...m, tenant_id: row.tenant_id
        }))
      );
    } catch (_) {}

    el.innerHTML = active.map(t => {
      const existing = existingBilling.find(b => String(b.tenant_id) === String(t.tenant_id));
      const elecCurr  = existing ? existing.elec_curr  || '' : '';
      const waterCurr = existing ? existing.water_curr || '' : '';
      const elecPrev  = existing ? existing.elec_prev  || 0  : '—';
      const waterPrev = existing ? existing.water_prev || 0  : '—';

      return `
        <div class="card card--flat mb-md" data-tenant-id="${esc(t.tenant_id)}">
          <div class="d-flex align-center justify-between mb-sm">
            <div>
              <div class="fw-semi">${esc(t.name)}</div>
              <div class="text-muted text-sm">${esc(t.unit)} · Rent: ${formatPeso(t.monthly_rent)}</div>
            </div>
          </div>

          <!-- Electric -->
          <div class="meter-block">
            <div class="meter-block__header">
              <span>⚡ Electric</span>
            </div>
            <div class="meter-row meter-row--prev">
              <span class="icon-lock">🔒 Previous reading</span>
              <span><strong>${esc(String(elecPrev))}</strong> kWh</span>
            </div>
            <div class="meter-row meter-row--curr">
              <span class="icon-edit">✏️ Current reading</span>
              <input
                type="number" min="0" step="1"
                class="form-input reading-input"
                data-type="elec"
                data-prev="${esc(String(existing ? (existing.elec_prev || 0) : 0))}"
                data-rate="${esc(String(_cfg.electric_rate || 0))}"
                placeholder="Enter kWh"
                value="${esc(String(elecCurr))}"
                aria-label="Current electric reading for ${esc(t.name)}"
              />
            </div>
          </div>

          <!-- Water -->
          <div class="meter-block">
            <div class="meter-block__header">
              <span>💧 Water</span>
            </div>
            <div class="meter-row meter-row--prev">
              <span class="icon-lock">🔒 Previous reading</span>
              <span><strong>${esc(String(waterPrev))}</strong> m³</span>
            </div>
            <div class="meter-row meter-row--curr">
              <span class="icon-edit">✏️ Current reading</span>
              <input
                type="number" min="0" step="1"
                class="form-input reading-input"
                data-type="water"
                data-prev="${esc(String(existing ? (existing.water_prev || 0) : 0))}"
                data-rate="${esc(String(_cfg.water_rate || 0))}"
                placeholder="Enter m³"
                value="${esc(String(waterCurr))}"
                aria-label="Current water reading for ${esc(t.name)}"
              />
            </div>
          </div>

          <!-- Live computed bill preview -->
          <div class="meter-result" id="bill-preview-${esc(t.tenant_id)}">
            <div class="meter-result__line"><span>Rent</span><span>${formatPeso(t.monthly_rent)}</span></div>
            <div class="meter-result__line" id="elec-bill-line-${esc(t.tenant_id)}">
              <span>Electric bill</span><span>—</span>
            </div>
            <div class="meter-result__line" id="water-bill-line-${esc(t.tenant_id)}">
              <span>Water bill</span><span>—</span>
            </div>
            <div class="meter-result__total" id="total-bill-line-${esc(t.tenant_id)}">
              <span>Total</span><span>${formatPeso(t.monthly_rent)}</span>
            </div>
          </div>
        </div>
      `;
    }).join('');

    // Wire up live computation
    el.querySelectorAll('.reading-input').forEach(input => {
      input.addEventListener('input', () => recomputeBillPreview(input.closest('[data-tenant-id]')));
      // Trigger for pre-filled values
      if (input.value) recomputeBillPreview(input.closest('[data-tenant-id]'));
    });

    footer.classList.remove('hidden');

  } catch (e) {
    el.innerHTML = `<div class="empty-state"><p class="empty-state__msg">${esc(e.message)}</p></div>`;
  }
}

function recomputeBillPreview(card) {
  const tid       = card.dataset.tenantId;
  const tenant    = _tenants.find(t => String(t.tenant_id) === String(tid));
  if (!tenant) return;

  const elecInput  = card.querySelector('[data-type="elec"]');
  const waterInput = card.querySelector('[data-type="water"]');

  const elecPrev  = parseFloat(elecInput.dataset.prev)   || 0;
  const waterPrev = parseFloat(waterInput.dataset.prev)  || 0;
  const elecRate  = parseFloat(elecInput.dataset.rate)   || parseFloat(_cfg.electric_rate) || 0;
  const waterRate = parseFloat(waterInput.dataset.rate)  || parseFloat(_cfg.water_rate)    || 0;

  const elecCurr  = parseFloat(elecInput.value)  || 0;
  const waterCurr = parseFloat(waterInput.value) || 0;

  const elecKwh   = Math.max(0, elecCurr  - elecPrev);
  const waterCbm  = Math.max(0, waterCurr - waterPrev);
  const elecBill  = elecKwh  * elecRate;
  const waterBill = waterCbm * waterRate;
  const rent      = parseFloat(tenant.monthly_rent) || 0;
  const total     = rent + elecBill + waterBill;

  const elecLine  = document.getElementById(`elec-bill-line-${tid}`);
  const waterLine = document.getElementById(`water-bill-line-${tid}`);
  const totalLine = document.getElementById(`total-bill-line-${tid}`);

  if (elecLine) elecLine.innerHTML =
    `<span>Electric (${elecKwh} kWh × ₱${elecRate})</span><span>${formatPeso(elecBill)}</span>`;
  if (waterLine) waterLine.innerHTML =
    `<span>Water (${waterCbm} m³ × ₱${waterRate})</span><span>${formatPeso(waterBill)}</span>`;
  if (totalLine) totalLine.innerHTML =
    `<span>Total</span><span>${formatPeso(total)}</span>`;
}

async function saveReadings() {
  const month  = document.getElementById('billing-month').value;
  const btn    = document.getElementById('btn-save-readings');
  const cards  = document.querySelectorAll('#readings-list [data-tenant-id]');

  if (!cards.length) return;

  const readings = [];
  cards.forEach(card => {
    const tid        = card.dataset.tenantId;
    const elecInput  = card.querySelector('[data-type="elec"]');
    const waterInput = card.querySelector('[data-type="water"]');
    const elecCurr   = elecInput  ? parseFloat(elecInput.value)  : null;
    const waterCurr  = waterInput ? parseFloat(waterInput.value) : null;

    if (elecCurr === null || isNaN(elecCurr) || waterCurr === null || isNaN(waterCurr)) return;
    readings.push({ tenant_id: tid, elec_curr: elecCurr, water_curr: waterCurr });
  });

  if (!readings.length) {
    showToast('Please enter at least one reading.', 'error');
    return;
  }

  setBtnLoading(btn, true, 'Saving…');
  try {
    const result = await apiEnterMeterReadings(_pin, month, readings);
    showToast(`Saved ${result.results.length} billing records for ${formatMonth(month)}.`, 'success');
    _ledgerData = null; // bust ledger cache
    document.getElementById('readings-footer').classList.add('hidden');
  } catch (e) {
    showToast(e.message, 'error');
  } finally {
    setBtnLoading(btn, false);
    btn.textContent = 'Save readings & generate bills';
  }
}

// ---------------------------------------------------------------------------
// PAYMENTS TAB
// ---------------------------------------------------------------------------
async function loadPaymentsTab(bustCache = false) {
  await Promise.all([
    loadPendingPayments(bustCache),
    loadPaymentHistory(bustCache)
  ]);
}

async function loadPendingPayments(bustCache = false) {
  const el    = document.getElementById('pending-list');
  const badge = document.getElementById('pending-count-badge');
  showSkeleton(el, 2);

  try {
    _pendingPayments = await apiGetPendingPayments(_pin, bustCache);

    badge.textContent = _pendingPayments.length;
    badge.classList.toggle('hidden', _pendingPayments.length === 0);

    if (!_pendingPayments.length) {
      el.innerHTML = `<div class="empty-state">
        <div class="empty-state__icon">✅</div>
        <div class="empty-state__title">All clear</div>
        <p class="empty-state__msg">No payments awaiting approval.</p>
      </div>`;
      return;
    }

    el.innerHTML = _pendingPayments.map(p => `
      <div class="pending-card">
        <div class="pending-card__header">
          <div>
            <div class="pending-card__name">${esc(p.tenant_name)} — ${esc(p.unit)}</div>
            <div class="pending-card__meta">${esc(p.date)} · ${esc(p.method)}</div>
          </div>
          <div class="pending-card__amount">${formatPeso(p.amount)}</div>
        </div>
        <div class="pending-card__detail">
          ${p.reference_no ? `<span>Ref: ${esc(p.reference_no)}</span>` : ''}
          ${p.proof_url    ? `<span class="pending-card__proof"><a href="${esc(p.proof_url)}" target="_blank" rel="noopener">View proof ↗</a></span>` : ''}
        </div>
        <div class="pending-card__actions">
          <button class="btn btn-success btn-sm" type="button"
            onclick="openApproveModal('${esc(p.payment_id)}')">Approve</button>
          <button class="btn btn-danger btn-sm" type="button"
            onclick="openRejectModal('${esc(p.payment_id)}')">Reject</button>
        </div>
      </div>
    `).join('');
  } catch (e) {
    el.innerHTML = `<div class="empty-state"><p class="empty-state__msg">${esc(e.message)}</p></div>`;
  }
}

async function loadPaymentHistory(bustCache = false) {
  const wrap = document.getElementById('history-table-wrap');

  // Ensure tenants loaded for filter dropdown
  if (_tenants.length === 0) {
    try { _tenants = await apiGetAllTenants(_pin); } catch (_) {}
  }

  // Populate tenant filter dropdown
  const filter = document.getElementById('history-tenant-filter');
  const curVal = filter.value;
  filter.innerHTML = '<option value="">All tenants</option>' +
    _tenants.map(t => `<option value="${esc(t.tenant_id)}" ${curVal === String(t.tenant_id) ? 'selected' : ''}>${esc(t.name)} (${esc(t.unit)})</option>`).join('');

  wrap.innerHTML = '<div class="skeleton-line" style="margin:16px"></div>';

  try {
    // Collect payments for all tenants or selected tenant
    const selectedId = filter.value;
    if (selectedId) {
      _allPayments = await apiGetPaymentHistory({ admin_pin: _pin, tenant_id: selectedId }, bustCache);
    } else {
      // Fetch for all tenants (parallel, capped at active list)
      const all = await Promise.all(
        _tenants.slice(0, 30).map(t =>
          apiGetPaymentHistory({ admin_pin: _pin, tenant_id: t.tenant_id }, bustCache)
            .then(rows => rows.map(r => ({ ...r,
              tenant_name: t.name, unit: t.unit
            })))
            .catch(() => [])
        )
      );
      _allPayments = all.flat().sort((a,b) => a.date < b.date ? 1 : -1);
    }

    renderPaymentHistory();
  } catch (e) {
    wrap.innerHTML = `<div class="empty-state" style="padding:16px"><p class="empty-state__msg">${esc(e.message)}</p></div>`;
  }
}

function renderPaymentHistory() {
  const wrap       = document.getElementById('history-table-wrap');
  const selectedId = document.getElementById('history-tenant-filter').value;

  const rows = selectedId
    ? _allPayments.filter(p => String(p.tenant_id) === selectedId)
    : _allPayments;

  if (!rows.length) {
    wrap.innerHTML = `<div class="empty-state" style="padding:16px">
      <p class="empty-state__msg">No payment records found.</p>
    </div>`;
    return;
  }

  wrap.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Date</th>
          <th>Tenant</th>
          <th>Amount</th>
          <th>Method</th>
          <th>Status</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(p => `
          <tr>
            <td class="text-muted text-sm">${esc(p.date)}</td>
            <td>
              <div class="fw-semi" style="font-size:.875rem">${esc(p.tenant_name || '—')}</div>
              <div class="text-muted text-sm">${esc(p.unit || '')}</div>
            </td>
            <td class="amount">${formatPeso(p.amount)}</td>
            <td class="text-sm">${esc(p.method || '—')}</td>
            <td>${statusBadge(p.status)}</td>
            <td>
              ${p.status === 'approved' && p.receipt_no
                ? `<button class="btn btn-ghost btn-sm" onclick="viewReceipt('${esc(p.payment_id)}')">Receipt #${esc(String(p.receipt_no))}</button>`
                : ''}
              ${p.status === 'pending'
                ? `<button class="btn btn-success btn-sm" onclick="openApproveModal('${esc(p.payment_id)}')">Review</button>`
                : ''}
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

// Open approve modal
function openApproveModal(paymentId) {
  const p    = _pendingPayments.find(x => x.payment_id === paymentId)
            || _allPayments.find(x => x.payment_id === paymentId);
  if (!p) return;

  document.getElementById('approve-payment-id').value = paymentId;
  document.getElementById('approve-note').value        = '';
  document.getElementById('modal-approve-title').textContent = 'Approve Payment';

  document.getElementById('approve-detail').innerHTML = `
    <div class="billing-card">
      <div class="billing-card__header">
        <span class="billing-card__period">${esc(p.tenant_name || '')} — ${esc(p.unit || '')}</span>
        <span class="billing-card__total">${formatPeso(p.amount)}</span>
      </div>
      <div class="billing-card__body">
        <div class="billing-line">
          <div class="billing-line__label">Date</div>
          <div class="billing-line__amount">${esc(p.date)}</div>
        </div>
        <div class="billing-line">
          <div class="billing-line__label">Method</div>
          <div class="billing-line__amount">${esc(p.method)}</div>
        </div>
        ${p.reference_no ? `<div class="billing-line">
          <div class="billing-line__label">Reference</div>
          <div class="billing-line__amount">${esc(p.reference_no)}</div>
        </div>` : ''}
        ${p.proof_url ? `<div class="billing-line">
          <div class="billing-line__label">Proof</div>
          <div class="billing-line__amount"><a href="${esc(p.proof_url)}" target="_blank" rel="noopener">View ↗</a></div>
        </div>` : ''}
      </div>
    </div>
  `;

  document.getElementById('btn-reject').onclick  = () => submitApproval('reject');
  document.getElementById('btn-approve').onclick = () => submitApproval('approve');
  openModal('modal-approve');
}

function openRejectModal(paymentId) {
  openApproveModal(paymentId); // same modal, both actions available
}

async function submitApproval(action) {
  const paymentId = document.getElementById('approve-payment-id').value;
  const note      = document.getElementById('approve-note').value.trim();
  const approveBtn = document.getElementById('btn-approve');
  const rejectBtn  = document.getElementById('btn-reject');

  setBtnLoading(approveBtn, true, 'Processing…');
  rejectBtn.disabled = true;

  try {
    if (action === 'approve') {
      await apiApprovePayment(_pin, paymentId, note);
      showToast('Payment approved. Receipt sent to tenant.', 'success');
    } else {
      await apiRejectPayment(_pin, paymentId, note);
      showToast('Payment rejected.', 'info');
    }
    closeModal('modal-approve');
    await loadPaymentsTab(true);
  } catch (e) {
    showToast(e.message, 'error');
  } finally {
    setBtnLoading(approveBtn, false);
    approveBtn.textContent = 'Approve & send receipt';
    rejectBtn.disabled = false;
  }
}

async function viewReceipt(paymentId) {
  const body = document.getElementById('receipt-view-body');
  body.innerHTML = '<div class="skeleton-card"></div>';
  openModal('modal-receipt');

  try {
    const result  = await apiGenerateReceipt({ admin_pin: _pin }, paymentId);
    const r       = result.receipt;
    body.innerHTML = buildReceiptHTML(r);
  } catch (e) {
    body.innerHTML = `<p class="text-red">${esc(e.message)}</p>`;
  }
}

function buildReceiptHTML(r) {
  const balance = parseFloat(r.balance) || 0;
  return `
    <div class="receipt">
      <div class="receipt__header">
        <div class="receipt__property">${esc(r.property_name)}</div>
        <div class="receipt__subtitle">Official Payment Receipt</div>
      </div>
      <div class="receipt__meta">
        <span><strong>Receipt No:</strong> #${esc(String(r.receipt_no))}</span>
        <span><strong>Date:</strong> ${esc(r.generated_date)}</span>
        <span><strong>Tenant:</strong> ${esc(r.tenant_name)}</span>
        <span><strong>Unit:</strong> ${esc(r.unit)}</span>
        <span><strong>Period:</strong> ${esc(r.billing_period)}</span>
      </div>
      <div class="receipt__body">
        <table class="receipt__table">
          <tr><td>Monthly Rent</td><td>${formatPeso(r.rent)}</td></tr>
          <tr>
            <td>Electric<br><small class="text-muted">${esc(String(r.elec_prev))} → ${esc(String(r.elec_curr))} kWh · ${esc(String(r.elec_kwh))} used @ ₱${esc(String(r.electric_rate))}/kWh</small></td>
            <td>${formatPeso(r.elec_bill)}</td>
          </tr>
          <tr>
            <td>Water<br><small class="text-muted">${esc(String(r.water_prev))} → ${esc(String(r.water_curr))} m³ · ${esc(String(r.water_cbm))} used @ ₱${esc(String(r.water_rate))}/m³</small></td>
            <td>${formatPeso(r.water_bill)}</td>
          </tr>
          ${r.late_fee > 0 ? `<tr><td class="text-red">Late Fee</td><td class="text-red">${formatPeso(r.late_fee)}</td></tr>` : ''}
          <tr class="total"><td>Total Bill</td><td>${formatPeso(r.total_bill)}</td></tr>
        </table>

        <div class="receipt__paid">
          <div class="receipt__paid-row">
            <span>Amount Paid</span>
            <strong>${formatPeso(r.amount_paid)} via ${esc(r.method)}</strong>
          </div>
          ${r.reference_no ? `<div class="receipt__paid-row"><span>Reference No</span><span>${esc(r.reference_no)}</span></div>` : ''}
          <div class="receipt__balance ${balance > 0 ? 'receipt__balance--owing' : 'receipt__balance--clear'}">
            <span>Remaining Balance</span>
            <span>${balance > 0 ? formatPeso(balance) : '₱0.00 — Fully Paid'}</span>
          </div>
        </div>
      </div>
      <div class="receipt__footer">For concerns, contact your property admin.</div>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// LEDGER TAB
// ---------------------------------------------------------------------------
async function loadLedger(bustCache = false) {
  const sumEl  = document.getElementById('ledger-summary');
  const listEl = document.getElementById('ledger-list');
  showSkeleton(sumEl, 3);
  showSkeleton(listEl, 4);

  try {
    _ledgerData = await apiGetLedger(_pin, bustCache);
    renderLedgerSummary(_ledgerData.summary);
    renderLedger();
  } catch (e) {
    listEl.innerHTML = `<div class="empty-state"><p class="empty-state__msg">${esc(e.message)}</p></div>`;
  }
}

function renderLedgerSummary(summary) {
  document.getElementById('ledger-summary').innerHTML = `
    <div class="stat-card">
      <div class="stat-card__label">Total outstanding</div>
      <div class="stat-card__value text-red">${formatPeso(summary.total_outstanding)}</div>
    </div>
    <div class="stat-card">
      <div class="stat-card__label">Tenants with balance</div>
      <div class="stat-card__value ${summary.tenants_with_balance > 0 ? 'text-amber' : ''}">${summary.tenants_with_balance}</div>
    </div>
    <div class="stat-card">
      <div class="stat-card__label">Fully paid</div>
      <div class="stat-card__value text-green">${summary.tenants_fully_paid}</div>
    </div>
  `;
}

function renderLedger() {
  if (!_ledgerData) return;
  const listEl = document.getElementById('ledger-list');
  let rows = _ledgerData.ledger;

  if (_ledgerFilter === 'owing') rows = rows.filter(r => r.outstanding > 0);
  if (_ledgerFilter === 'clear') rows = rows.filter(r => r.outstanding <= 0);

  if (!rows.length) {
    listEl.innerHTML = `<div class="empty-state">
      <div class="empty-state__title">No tenants match this filter.</div>
    </div>`;
    return;
  }

  listEl.innerHTML = rows.map(tenant => {
    const owing   = tenant.outstanding > 0;
    const balClass = owing ? 'ledger-summary__balance--owing' : 'ledger-summary__balance--clear';
    const balLabel = owing ? formatPeso(tenant.outstanding) + ' owing' : 'Fully paid';

    const monthRows = tenant.months.map(m => {
      const bal       = parseFloat(m.balance) || 0;
      const unpaid    = bal > 0;
      const balClass2 = unpaid ? 'ledger-month__balance--owing' : 'ledger-month__balance--zero';
      return `
        <div class="ledger-month ${unpaid ? 'unpaid' : ''}">
          <div class="ledger-month__label">
            ${esc(m.month_label)} ${statusBadge(m.status)}
          </div>
          <div class="ledger-month__billed">Billed: ${formatPeso(m.total_bill)}</div>
          <div class="ledger-month__balance ${balClass2}">
            ${unpaid ? formatPeso(bal) : '✓ Paid'}
          </div>
        </div>
      `;
    }).join('');

    return `
      <div class="ledger-row" id="ledger-${esc(tenant.tenant_id)}">
        <div class="ledger-summary" onclick="toggleLedgerRow('${esc(tenant.tenant_id)}')">
          <div class="ledger-summary__name">
            ${esc(tenant.name)}
            <span class="ledger-summary__unit">· ${esc(tenant.unit)}</span>
          </div>
          <div class="ledger-summary__balance ${balClass}">${balLabel}</div>
          <div class="ledger-chevron">▼</div>
        </div>
        <div class="ledger-detail">
          ${tenant.months.length ? monthRows : '<div class="ledger-month"><div class="ledger-month__label text-muted">No billing records yet.</div></div>'}
          <div class="ledger-total">
            <span>Total billed: ${formatPeso(tenant.total_billed)}</span>
            <span>Total paid: ${formatPeso(tenant.total_paid)}</span>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function toggleLedgerRow(tenantId) {
  const row = document.getElementById(`ledger-${tenantId}`);
  if (row) row.classList.toggle('open');
}

// ---------------------------------------------------------------------------
// LOG PAYMENT MODAL
// ---------------------------------------------------------------------------
async function populateLogPaymentTenants() {
  if (_tenants.length === 0) {
    try { _tenants = await apiGetAllTenants(_pin); } catch (_) {}
  }
  const sel = document.getElementById('lp-tenant');
  sel.innerHTML = '<option value="">— select tenant —</option>' +
    _tenants.filter(t => t.status === 'active').map(t =>
      `<option value="${esc(t.tenant_id)}">${esc(t.name)} (${esc(t.unit)})</option>`
    ).join('');
}

async function onLogPaymentTenantChange() {
  const tenantId = document.getElementById('lp-tenant').value;
  const bilSel   = document.getElementById('lp-billing');
  bilSel.innerHTML = '<option value="">Loading…</option>';

  if (!tenantId) {
    bilSel.innerHTML = '<option value="">— select tenant first —</option>';
    return;
  }

  try {
    const bills = await apiGetBillingHistory({ admin_pin: _pin, tenant_id: tenantId });
    if (!bills.length) {
      bilSel.innerHTML = '<option value="">No billing records found</option>';
      return;
    }
    bilSel.innerHTML = bills.map(b =>
      `<option value="${esc(b.billing_id)}">${esc(formatMonth(b.month))} — Balance: ${formatPeso(b.balance)} (${esc(b.status)})</option>`
    ).join('');
  } catch (e) {
    bilSel.innerHTML = `<option value="">${esc(e.message)}</option>`;
  }
}

async function submitLogPayment() {
  const btn = document.getElementById('btn-submit-log-payment');
  const payload = {
    tenant_id:    document.getElementById('lp-tenant').value,
    billing_id:   document.getElementById('lp-billing').value,
    amount:       document.getElementById('lp-amount').value,
    date:         document.getElementById('lp-date').value,
    method:       document.getElementById('lp-method').value,
    reference_no: document.getElementById('lp-ref').value.trim(),
    note:         document.getElementById('lp-note').value.trim(),
  };

  if (!payload.tenant_id || !payload.amount || !payload.method || !payload.date) {
    showToast('Tenant, amount, method, and date are required.', 'error');
    return;
  }

  setBtnLoading(btn, true, 'Saving…');
  try {
    const result = await apiLogPayment(_pin, payload);
    showToast('Payment logged. Receipt emailed to tenant.', 'success');
    closeModal('modal-log-payment');
    // Show receipt
    if (result && result.receipt) {
      const body = document.getElementById('receipt-view-body');
      body.innerHTML = buildReceiptHTML(result.receipt);
      openModal('modal-receipt');
    }
    await loadPaymentsTab(true);
    if (_activeTab === 'dashboard') await loadDashboard(true);
  } catch (e) {
    showToast(e.message, 'error');
  } finally {
    setBtnLoading(btn, false);
    btn.textContent = 'Log Payment';
  }
}

// ---------------------------------------------------------------------------
// QUICK ACTIONS (dashboard shortcuts)
// ---------------------------------------------------------------------------
function handleQuickAction(action) {
  switch (action) {
    case 'log-payment':
      document.getElementById('lp-date').value = getTodayDate();
      populateLogPaymentTenants();
      openModal('modal-log-payment');
      break;
    case 'add-tenant':
      openAddTenant();
      break;
    case 'meter-readings':
      switchTab('billing');
      break;
  }
}
