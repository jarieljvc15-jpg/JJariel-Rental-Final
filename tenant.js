// =============================================================================
// tenant.js — Tenant Portal Logic for JJ Apartment RMS
// Depends on: api.js (must be loaded first)
// =============================================================================

// ---------------------------------------------------------------------------
// STATE
// ---------------------------------------------------------------------------
let _loginCode   = '';    // tenant's login code for the session
let _cfg         = {};    // config from Sheets
let _tenantInfo  = null;  // { tenant, billing, last_payment }
let _billingRows = [];    // full billing history
let _payments    = [];    // full payment history
let _activeTab   = 'home';

// ---------------------------------------------------------------------------
// BOOT
// ---------------------------------------------------------------------------
(async function boot() {
  try {
    _cfg = await apiGetConfig();
    applyPropertyName(_cfg.property_name || 'Property', 'Tenant Portal');
  } catch (e) {
    applyPropertyName('Property', 'Tenant Portal');
  }

  // Wire login
  const codeInput = document.getElementById('code-input');
  const loginBtn  = document.getElementById('login-btn');

  loginBtn.addEventListener('click', attemptLogin);
  codeInput.addEventListener('keydown', e => { if (e.key === 'Enter') attemptLogin(); });
  // Auto-uppercase as the tenant types their code
  codeInput.addEventListener('input', function () {
    const pos = this.selectionStart;
    this.value = this.value.toUpperCase();
    this.setSelectionRange(pos, pos);
  });

  // Wire tabs
  document.querySelectorAll('.nav-tab').forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });

  // Wire logout
  document.getElementById('logout-btn').addEventListener('click', logout);

  // Pay now shortcut (home tab)
  document.getElementById('btn-pay-now').addEventListener('click', () => switchTab('pay'));

  // Submit payment
  document.getElementById('btn-submit-payment').addEventListener('click', submitPayment);

  // Default date fields to today
  document.getElementById('pay-date').value = getTodayDate();
})();

// ---------------------------------------------------------------------------
// AUTH
// ---------------------------------------------------------------------------
async function attemptLogin() {
  const codeInput = document.getElementById('code-input');
  const loginErr  = document.getElementById('login-error');
  const loginBtn  = document.getElementById('login-btn');
  const code      = codeInput.value.trim().toUpperCase();

  if (!code) { codeInput.focus(); return; }

  setBtnLoading(loginBtn, true, 'Checking…');
  loginErr.classList.add('hidden');

  try {
    // getTenantInfo validates the code server-side; if it fails, code is invalid
    const info = await apiGetTenantInfo(code);
    _loginCode  = code;
    _tenantInfo = info;

    // Show app shell
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('app-shell').classList.remove('hidden');
    document.getElementById('topbar-unit').textContent = info.tenant.unit || '';

    codeInput.value = '';
    await loadHome();

  } catch (e) {
    loginErr.classList.remove('hidden');
    loginErr.textContent = e.message.includes('Invalid')
      ? 'Invalid code. Please check and try again.'
      : 'Connection error. Check your internet and try again.';
    codeInput.value = '';
    codeInput.focus();
  } finally {
    setBtnLoading(loginBtn, false);
    loginBtn.textContent = 'View my account';
  }
}

function logout() {
  _loginCode  = '';
  _tenantInfo = null;
  _billingRows = [];
  _payments    = [];
  _cacheClear();
  document.getElementById('app-shell').classList.add('hidden');
  document.getElementById('login-screen').classList.remove('hidden');
  document.getElementById('code-input').value = '';
  switchTab('home');
}

// ---------------------------------------------------------------------------
// TAB SWITCHING
// ---------------------------------------------------------------------------
function switchTab(tabName) {
  _activeTab = tabName;

  document.querySelectorAll('.nav-tab').forEach(t => {
    const active = t.dataset.tab === tabName;
    t.classList.toggle('active', active);
    t.setAttribute('aria-selected', active);
  });

  document.querySelectorAll('[id^="tab-"]').forEach(s => s.classList.add('hidden'));
  document.getElementById(`tab-${tabName}`).classList.remove('hidden');

  if (!_loginCode) return;

  switch (tabName) {
    case 'home':    return loadHome();
    case 'billing': return loadBillingTab();
    case 'pay':     return loadPayTab();
    case 'history': return loadHistoryTab();
  }
}

// ---------------------------------------------------------------------------
// HOME TAB
// ---------------------------------------------------------------------------
async function loadHome() {
  try {
    // Refresh tenant info + current billing
    _tenantInfo = await apiGetTenantInfo(_loginCode);
    renderHome(_tenantInfo);
  } catch (e) {
    document.getElementById('home-billing-card').innerHTML =
      `<div class="empty-state"><p class="empty-state__msg">${esc(e.message)}</p></div>`;
  }
}

function renderHome(info) {
  const { tenant, billing, last_payment } = info;
  const balance = billing ? (parseFloat(billing.balance) || 0) : 0;
  const cfg     = _cfg;

  // Balance hero
  const heroAmount = document.getElementById('hero-amount');
  const heroDue    = document.getElementById('hero-due');
  const heroLast   = document.getElementById('hero-last');

  heroAmount.textContent = formatPeso(balance);
  heroAmount.className   = 'balance-hero__amount' + (balance <= 0 ? ' balance-hero__amount--zero' : '');

  if (billing) {
    const dueDay  = cfg.due_day || 5;
    const dueDateStr = billing.month + '-' + String(dueDay).padStart(2, '0');
    heroDue.textContent = balance > 0
      ? `Due by the ${ordinal(parseInt(dueDay))} of the month`
      : '✓ No outstanding balance';
  } else {
    heroDue.textContent = 'No bill generated yet for this month';
  }

  heroLast.textContent = last_payment
    ? `Last payment: ${formatPeso(last_payment.amount)} on ${last_payment.date}`
    : 'No payments recorded yet';

  // Tenant info chips
  document.getElementById('tenant-chips').innerHTML = [
    tenant.name       ? `<span class="tenant-chip"><strong>${esc(tenant.name)}</strong></span>` : '',
    tenant.unit       ? `<span class="tenant-chip">Unit: <strong>${esc(tenant.unit)}</strong></span>` : '',
    tenant.login_code ? `<span class="tenant-chip">Code: <strong>${esc(tenant.login_code)}</strong></span>` : '',
    tenant.monthly_rent ? `<span class="tenant-chip">Rent: <strong>${formatPeso(tenant.monthly_rent)}/mo</strong></span>` : '',
  ].join('');

  // Current month billing card
  const billingEl = document.getElementById('home-billing-card');
  if (!billing) {
    billingEl.innerHTML = `
      <div class="card card--flat">
        <div class="empty-state">
          <div class="empty-state__icon">📋</div>
          <div class="empty-state__title">No bill yet</div>
          <p class="empty-state__msg">Your admin hasn't generated a bill for this month yet.</p>
        </div>
      </div>`;
    return;
  }

  billingEl.innerHTML = buildBillingCard(billing, cfg);
}

function buildBillingCard(b, cfg) {
  const electricRate = cfg.electric_rate || 0;
  const waterRate    = cfg.water_rate    || 0;
  const balance      = parseFloat(b.balance) || 0;

  return `
    <div class="billing-card">
      <div class="billing-card__header">
        <span class="billing-card__period">${esc(formatMonth(b.month))}</span>
        <span class="billing-card__total">${formatPeso(b.total_bill)}</span>
      </div>
      <div class="billing-card__body">

        <div class="billing-line">
          <div>
            <div class="billing-line__label">Monthly Rent</div>
          </div>
          <div class="billing-line__amount">${formatPeso(b.rent_amount)}</div>
        </div>

        <div class="billing-line">
          <div>
            <div class="billing-line__label">⚡ Electric</div>
            <div class="billing-line__sub">
              🔒 Prev: ${esc(String(b.elec_prev))} kWh &nbsp;→&nbsp; ✏️ Curr: ${esc(String(b.elec_curr))} kWh
              &nbsp;·&nbsp; ${esc(String(b.elec_consumption))} kWh used @ ₱${esc(String(electricRate))}/kWh
            </div>
          </div>
          <div class="billing-line__amount">${formatPeso(b.elec_bill)}</div>
        </div>

        <div class="billing-line">
          <div>
            <div class="billing-line__label">💧 Water</div>
            <div class="billing-line__sub">
              🔒 Prev: ${esc(String(b.water_prev))} m³ &nbsp;→&nbsp; ✏️ Curr: ${esc(String(b.water_curr))} m³
              &nbsp;·&nbsp; ${esc(String(b.water_consumption))} m³ used @ ₱${esc(String(waterRate))}/m³
            </div>
          </div>
          <div class="billing-line__amount">${formatPeso(b.water_bill)}</div>
        </div>

        ${parseFloat(b.late_fee) > 0 ? `
        <div class="billing-line">
          <div class="billing-line__label text-red">Late fee</div>
          <div class="billing-line__amount text-red">${formatPeso(b.late_fee)}</div>
        </div>` : ''}

      </div>

      <div class="billing-total-row">
        <span>Total bill</span>
        <span class="billing-total-row__amount">${formatPeso(b.total_bill)}</span>
      </div>

      ${parseFloat(b.amount_paid) > 0 ? `
      <div style="padding:var(--sp-sm) var(--sp-lg);font-size:.8rem;color:var(--clr-green);
                  border-top:1px solid var(--border);display:flex;justify-content:space-between">
        <span>Amount paid</span>
        <strong>${formatPeso(b.amount_paid)}</strong>
      </div>` : ''}

      <div style="padding:var(--sp-md) var(--sp-lg);
                  background:${balance > 0 ? 'var(--clr-red-light)' : 'var(--clr-green-light)'};
                  display:flex;justify-content:space-between;align-items:center;
                  font-weight:700;font-size:.9rem;
                  color:${balance > 0 ? 'var(--clr-red)' : 'var(--clr-green)'}">
        <span>Balance due</span>
        <span>${balance > 0 ? formatPeso(balance) : '✓ Fully paid'}</span>
      </div>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// BILLING TAB — full history
// ---------------------------------------------------------------------------
async function loadBillingTab() {
  const el = document.getElementById('billing-list');
  showSkeleton(el, 3);

  try {
    _billingRows = await apiGetBillingHistory({ login_code: _loginCode });
    renderBillingTab();
  } catch (e) {
    el.innerHTML = `<div class="empty-state"><p class="empty-state__msg">${esc(e.message)}</p></div>`;
  }
}

function renderBillingTab() {
  const el = document.getElementById('billing-list');

  if (!_billingRows.length) {
    el.innerHTML = `
      <div class="empty-state">
        <div class="empty-state__icon">📋</div>
        <div class="empty-state__title">No billing records</div>
        <p class="empty-state__msg">Your admin hasn't generated any bills yet.</p>
      </div>`;
    return;
  }

  el.innerHTML = _billingRows.map(b => buildBillingCard(b, _cfg)).join('');
}

// ---------------------------------------------------------------------------
// PAY TAB — submit payment form
// ---------------------------------------------------------------------------
async function loadPayTab() {
  // Populate billing period dropdown with unpaid/partial rows
  const sel = document.getElementById('pay-billing');
  sel.innerHTML = '<option value="">Loading…</option>';

  try {
    if (!_billingRows.length) {
      _billingRows = await apiGetBillingHistory({ login_code: _loginCode });
    }
    const unpaid = _billingRows.filter(b => b.status === 'unpaid' || b.status === 'partial');

    if (!unpaid.length) {
      sel.innerHTML = '<option value="">No outstanding balance — all paid!</option>';
      return;
    }

    sel.innerHTML = unpaid.map(b =>
      `<option value="${esc(b.billing_id)}">
        ${esc(formatMonth(b.month))} — Balance: ${formatPeso(b.balance)}
      </option>`
    ).join('');

    // Pre-fill amount from first unpaid balance
    const firstBal = parseFloat(unpaid[0].balance) || 0;
    if (firstBal > 0) document.getElementById('pay-amount').value = firstBal.toFixed(2);

    // Update amount hint when period changes
    sel.addEventListener('change', function () {
      const chosen = unpaid.find(b => b.billing_id === this.value);
      if (chosen) document.getElementById('pay-amount').value = (parseFloat(chosen.balance) || 0).toFixed(2);
    });

  } catch (e) {
    sel.innerHTML = `<option value="">${esc(e.message)}</option>`;
  }
}

async function submitPayment() {
  const btn = document.getElementById('btn-submit-payment');

  const billingId  = document.getElementById('pay-billing').value;
  const amount     = document.getElementById('pay-amount').value;
  const date       = document.getElementById('pay-date').value;
  const method     = document.getElementById('pay-method').value;
  const ref        = document.getElementById('pay-ref').value.trim();
  const proof      = document.getElementById('pay-proof').value.trim();

  if (!billingId || !amount || !date || !method) {
    showToast('Please fill in all required fields.', 'error');
    return;
  }

  if (parseFloat(amount) <= 0) {
    showToast('Amount must be greater than zero.', 'error');
    return;
  }

  setBtnLoading(btn, true, 'Submitting…');

  try {
    await apiSubmitPayment(_loginCode, {
      billing_id:   billingId,
      amount:       parseFloat(amount),
      date:         date,
      method:       method,
      reference_no: ref,
      proof_url:    proof
    });

    showToast('Payment submitted! Your admin will review it shortly.', 'success');

    // Clear form
    document.getElementById('pay-amount').value  = '';
    document.getElementById('pay-ref').value     = '';
    document.getElementById('pay-proof').value   = '';
    document.getElementById('pay-method').value  = '';
    document.getElementById('pay-date').value    = getTodayDate();

    // Bust billing cache so history tab refreshes
    _billingRows = [];
    _payments    = [];

    // Switch to history so tenant can see their pending submission
    switchTab('history');

  } catch (e) {
    showToast(e.message, 'error');
  } finally {
    setBtnLoading(btn, false);
    btn.textContent = 'Submit for approval';
  }
}

// ---------------------------------------------------------------------------
// HISTORY TAB — payment records
// ---------------------------------------------------------------------------
async function loadHistoryTab() {
  const el = document.getElementById('history-list');
  showSkeleton(el, 3);

  try {
    _payments = await apiGetPaymentHistory({ login_code: _loginCode });
    renderHistoryTab();
  } catch (e) {
    el.innerHTML = `<div class="empty-state"><p class="empty-state__msg">${esc(e.message)}</p></div>`;
  }
}

function renderHistoryTab() {
  const el = document.getElementById('history-list');

  if (!_payments.length) {
    el.innerHTML = `
      <div class="empty-state">
        <div class="empty-state__icon">🧾</div>
        <div class="empty-state__title">No payments yet</div>
        <p class="empty-state__msg">Your payment history will appear here once you submit or your admin logs a payment.</p>
      </div>`;
    return;
  }

  el.innerHTML = _payments.map(p => `
    <div class="history-item">
      <div class="history-item__header">
        <div>
          <div class="history-item__period">${esc(formatMonth(p.billing_period || '') || p.date)}</div>
          <div class="history-item__meta">
            <span>${esc(p.date)}</span>
            <span>${esc(p.method || '—')}</span>
            ${p.reference_no ? `<span>Ref: ${esc(p.reference_no)}</span>` : ''}
            <span>${statusBadge(p.status)}</span>
          </div>
        </div>
        <div class="history-item__amount">${formatPeso(p.amount)}</div>
      </div>

      ${p.status === 'pending' ? `
        <div class="card card--teal" style="padding:var(--sp-sm) var(--sp-md);margin-top:var(--sp-sm)">
          <p style="font-size:.78rem;color:var(--clr-teal-dark);margin:0">
            ⏳ Awaiting admin approval. Your balance will update once confirmed.
          </p>
        </div>` : ''}

      ${p.status === 'rejected' ? `
        <div style="background:var(--clr-red-light);border:1px solid var(--clr-red);border-radius:var(--r-sm);
                    padding:var(--sp-sm) var(--sp-md);margin-top:var(--sp-sm);font-size:.78rem;color:var(--clr-red)">
          ✗ Rejected${p.note ? ': ' + esc(p.note) : ''}. Please resubmit with correct details.
        </div>` : ''}

      ${p.status === 'approved' && p.receipt_no ? `
        <div style="margin-top:var(--sp-sm)">
          <button class="btn btn-ghost btn-sm" type="button"
            onclick="viewReceipt('${esc(p.payment_id)}')">
            🧾 View Receipt #${esc(String(p.receipt_no))}
          </button>
        </div>` : ''}

      ${p.proof_url && p.status === 'pending' ? `
        <div style="margin-top:var(--sp-xs);font-size:.75rem">
          <a href="${esc(p.proof_url)}" target="_blank" rel="noopener" class="text-teal">View submitted proof ↗</a>
        </div>` : ''}
    </div>
  `).join('');
}

// ---------------------------------------------------------------------------
// RECEIPT VIEW
// ---------------------------------------------------------------------------
async function viewReceipt(paymentId) {
  const body = document.getElementById('receipt-body');
  body.innerHTML = '<div class="skeleton-card"></div>';
  openModal('modal-receipt');

  try {
    const result = await apiGenerateReceipt({ login_code: _loginCode }, paymentId);
    const r      = result.receipt;
    body.innerHTML = buildReceiptHTML(r);
  } catch (e) {
    body.innerHTML = `<p class="text-red" style="padding:16px">${esc(e.message)}</p>`;
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
            <td>
              ⚡ Electric<br>
              <small class="text-muted">
                🔒 ${esc(String(r.elec_prev))} kWh → ${esc(String(r.elec_curr))} kWh
                &nbsp;·&nbsp; ${esc(String(r.elec_kwh))} kWh @ ₱${esc(String(r.electric_rate))}/kWh
              </small>
            </td>
            <td>${formatPeso(r.elec_bill)}</td>
          </tr>
          <tr>
            <td>
              💧 Water<br>
              <small class="text-muted">
                🔒 ${esc(String(r.water_prev))} m³ → ${esc(String(r.water_curr))} m³
                &nbsp;·&nbsp; ${esc(String(r.water_cbm))} m³ @ ₱${esc(String(r.water_rate))}/m³
              </small>
            </td>
            <td>${formatPeso(r.water_bill)}</td>
          </tr>
          ${r.late_fee > 0
            ? `<tr><td class="text-red">Late Fee</td><td class="text-red">${formatPeso(r.late_fee)}</td></tr>`
            : ''}
          <tr class="total"><td>Total Bill</td><td>${formatPeso(r.total_bill)}</td></tr>
        </table>

        <div class="receipt__paid">
          <div class="receipt__paid-row">
            <span>Amount Paid</span>
            <strong>${formatPeso(r.amount_paid)} via ${esc(r.method)}</strong>
          </div>
          ${r.reference_no
            ? `<div class="receipt__paid-row"><span>Reference No</span><span>${esc(r.reference_no)}</span></div>`
            : ''}
          <div class="receipt__balance ${balance > 0 ? 'receipt__balance--owing' : 'receipt__balance--clear'}">
            <span>Remaining Balance</span>
            <span>${balance > 0 ? formatPeso(balance) : '₱0.00 — Fully Paid'}</span>
          </div>
        </div>
      </div>
      <div class="receipt__footer">
        For concerns, contact your property admin.
      </div>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// UTILITY
// ---------------------------------------------------------------------------

/** Returns "1st", "2nd", "3rd", "4th"… for due-day display */
function ordinal(n) {
  const s = ['th','st','nd','rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
