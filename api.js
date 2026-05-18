// =============================================================================
// api.js — Shared API wrapper for JJ Apartment RMS
// Imported by admin.html and tenant.html via <script src="api.js">
// All communication with the Google Apps Script Web App goes through here.
// =============================================================================

// ---------------------------------------------------------------------------
// CONFIGURATION — paste your deployed Apps Script Web App URL here
// ---------------------------------------------------------------------------
const GAS_URL = 'https://script.google.com/macros/s/AKfycbwdpGB9qQHIWh5V5EPdcSHu1cBNdcMohxnV-vvuqCdzlUpGYkAse9vSthxgG3hsUvpz/exec';

// ---------------------------------------------------------------------------
// IN-MEMORY CACHE
// Avoids redundant round-trips within a single page session.
// Keys: 'config', 'tenants', 'ledger', 'dashboard', 'pending',
//       'billing:<tenantId>', 'payments:<tenantId>'
// Cache is intentionally NOT persisted to localStorage — a page refresh
// always fetches fresh data from Sheets.
// ---------------------------------------------------------------------------
const _cache = {};
const _CACHE_TTL_MS = 60 * 1000; // 60 seconds per entry

function _cacheSet(key, value) {
  _cache[key] = { value, ts: Date.now() };
}

function _cacheGet(key) {
  const entry = _cache[key];
  if (!entry) return null;
  if (Date.now() - entry.ts > _CACHE_TTL_MS) {
    delete _cache[key];
    return null;
  }
  return entry.value;
}

function _cacheClear(key) {
  if (key) {
    delete _cache[key];
  } else {
    Object.keys(_cache).forEach(k => delete _cache[k]);
  }
}

// ---------------------------------------------------------------------------
// CORE FETCH
// Sends a POST to the Apps Script Web App with a JSON body.
// Returns the parsed { success, data } or { success, error } object.
// Throws on network failure so callers can show an error state.
// ---------------------------------------------------------------------------
async function _post(payload) {
  const res = await fetch(GAS_URL, {
    method:  'POST',
    // Apps Script requires text/plain for CORS-safe requests from a static host
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body:    JSON.stringify(payload)
  });

  if (!res.ok) {
    throw new Error(`Network error: ${res.status} ${res.statusText}`);
  }

  const json = await res.json();

  if (!json.success) {
    throw new Error(json.error || 'Unknown server error');
  }

  return json.data;
}

// ---------------------------------------------------------------------------
// PUBLIC API METHODS
// Each method maps 1-to-1 with a Code.gs action.
// Cached reads pass { bustCache: true } to force a fresh fetch.
// Write methods always bust relevant cache keys after success.
// ---------------------------------------------------------------------------

// ── Config ──────────────────────────────────────────────────────────────────

/**
 * Fetches all Config key-value pairs.
 * Cached — config rarely changes mid-session.
 * @param {boolean} [bustCache]
 * @returns {Promise<Object>} e.g. { property_name, admin_pin, electric_rate, … }
 */
async function apiGetConfig(bustCache = false) {
  const key = 'config';
  if (!bustCache) {
    const cached = _cacheGet(key);
    if (cached) return cached;
  }
  const data = await _post({ action: 'getConfig' });
  _cacheSet(key, data);
  return data;
}

// ── Admin auth helper ────────────────────────────────────────────────────────

/**
 * Returns the admin_pin field from config for local PIN comparison.
 * The actual gate is also enforced server-side on every write action.
 */
async function apiGetAdminPin() {
  const cfg = await apiGetConfig();
  return String(cfg.admin_pin || '');
}

// ── Dashboard ────────────────────────────────────────────────────────────────

/**
 * @param {string} adminPin
 * @param {string} [month] YYYY-MM, defaults to current month server-side
 * @param {boolean} [bustCache]
 */
async function apiGetDashboard(adminPin, month = null, bustCache = false) {
  const key = 'dashboard';
  if (!bustCache) {
    const cached = _cacheGet(key);
    if (cached) return cached;
  }
  const data = await _post({ action: 'getDashboardData', admin_pin: adminPin, month });
  _cacheSet(key, data);
  return data;
}

// ── Tenants ──────────────────────────────────────────────────────────────────

/**
 * Returns all tenants (active + moved-out). Admin only.
 * @param {string} adminPin
 * @param {boolean} [bustCache]
 */
async function apiGetAllTenants(adminPin, bustCache = false) {
  const key = 'tenants';
  if (!bustCache) {
    const cached = _cacheGet(key);
    if (cached) return cached;
  }
  const data = await _post({ action: 'getAllTenants', admin_pin: adminPin });
  _cacheSet(key, data);
  return data;
}

/**
 * Returns tenant profile + current billing + last payment. Tenant-facing.
 * @param {string} loginCode  e.g. "JJ-04"
 * @param {string} [month]    YYYY-MM
 */
async function apiGetTenantInfo(loginCode, month = null) {
  return _post({ action: 'getTenantInfo', login_code: loginCode, month });
}

/**
 * Adds a new tenant. Admin only.
 * @param {string} adminPin
 * @param {Object} tenantData  { name, unit, room_type, move_in_date, monthly_rent, deposit_paid, email, contact }
 */
async function apiAddTenant(adminPin, tenantData) {
  const data = await _post({ action: 'addTenant', admin_pin: adminPin, ...tenantData });
  _cacheClear('tenants');
  _cacheClear('dashboard');
  return data;
}

/**
 * Updates an existing tenant's fields. Admin only.
 * @param {string} adminPin
 * @param {Object} tenantData  Must include tenant_id. Only provided fields are updated.
 */
async function apiUpdateTenant(adminPin, tenantData) {
  const data = await _post({ action: 'updateTenant', admin_pin: adminPin, ...tenantData });
  _cacheClear('tenants');
  _cacheClear('dashboard');
  return data;
}

// ── Billing & Readings ───────────────────────────────────────────────────────

/**
 * Returns all billing rows for a tenant, newest first.
 * Accessible by tenant (login_code) or admin (admin_pin + tenant_id).
 * @param {Object} authParams  { login_code } or { admin_pin, tenant_id }
 * @param {boolean} [bustCache]
 */
async function apiGetBillingHistory(authParams, bustCache = false) {
  const key = `billing:${authParams.tenant_id || authParams.login_code}`;
  if (!bustCache) {
    const cached = _cacheGet(key);
    if (cached) return cached;
  }
  const data = await _post({ action: 'getBillingHistory', ...authParams });
  _cacheSet(key, data);
  return data;
}

/**
 * Admin enters current meter readings for one or more units.
 * Creates / overwrites Billing and Readings rows for the given month.
 * @param {string} adminPin
 * @param {string} month       YYYY-MM
 * @param {Array}  readings    [{ tenant_id, elec_curr, water_curr }, …]
 */
async function apiEnterMeterReadings(adminPin, month, readings) {
  const data = await _post({
    action: 'enterMeterReadings',
    admin_pin: adminPin,
    month,
    readings
  });
  // Bust all billing caches — multiple tenants may have been updated
  Object.keys(_cache).forEach(k => { if (k.startsWith('billing:')) _cacheClear(k); });
  _cacheClear('ledger');
  _cacheClear('dashboard');
  return data;
}

// ── Ledger ───────────────────────────────────────────────────────────────────

/**
 * Returns the full ledger: summary + per-tenant month-by-month breakdown.
 * Admin only.
 * @param {string} adminPin
 * @param {boolean} [bustCache]
 */
async function apiGetLedger(adminPin, bustCache = false) {
  const key = 'ledger';
  if (!bustCache) {
    const cached = _cacheGet(key);
    if (cached) return cached;
  }
  const data = await _post({ action: 'getLedger', admin_pin: adminPin });
  _cacheSet(key, data);
  return data;
}

// ── Payments ─────────────────────────────────────────────────────────────────

/**
 * Returns payment history for a tenant, newest first.
 * Accessible by tenant (login_code) or admin (admin_pin + tenant_id).
 * Includes receipt snapshot if available.
 * @param {Object} authParams
 * @param {boolean} [bustCache]
 */
async function apiGetPaymentHistory(authParams, bustCache = false) {
  const key = `payments:${authParams.tenant_id || authParams.login_code}`;
  if (!bustCache) {
    const cached = _cacheGet(key);
    if (cached) return cached;
  }
  const data = await _post({ action: 'getPaymentHistory', ...authParams });
  _cacheSet(key, data);
  return data;
}

/**
 * Returns all pending (tenant-submitted) payments awaiting approval.
 * Admin only.
 * @param {string} adminPin
 * @param {boolean} [bustCache]
 */
async function apiGetPendingPayments(adminPin, bustCache = false) {
  const key = 'pending';
  if (!bustCache) {
    const cached = _cacheGet(key);
    if (cached) return cached;
  }
  const data = await _post({ action: 'getPendingPayments', admin_pin: adminPin });
  _cacheSet(key, data);
  return data;
}

/**
 * Tenant submits a payment for admin review.
 * @param {string} loginCode
 * @param {Object} paymentData  { billing_id, amount, method, reference_no, proof_url, date }
 */
async function apiSubmitPayment(loginCode, paymentData) {
  const data = await _post({
    action: 'submitPayment',
    login_code: loginCode,
    ...paymentData
  });
  _cacheClear(`payments:${loginCode}`);
  return data;
}

/**
 * Admin logs a payment directly (auto-approved, triggers receipt + email).
 * @param {string} adminPin
 * @param {Object} paymentData  { tenant_id, billing_id, amount, method, reference_no, date, note }
 */
async function apiLogPayment(adminPin, paymentData) {
  const data = await _post({
    action: 'logPayment',
    admin_pin: adminPin,
    ...paymentData
  });
  _cacheClear(`payments:${paymentData.tenant_id}`);
  _cacheClear(`billing:${paymentData.tenant_id}`);
  _cacheClear('ledger');
  _cacheClear('dashboard');
  _cacheClear('pending');
  return data;
}

/**
 * Admin approves a pending payment. Triggers receipt generation and email.
 * @param {string} adminPin
 * @param {string} paymentId
 * @param {string} [note]
 */
async function apiApprovePayment(adminPin, paymentId, note = '') {
  const data = await _post({
    action: 'approvePayment',
    admin_pin: adminPin,
    payment_id: paymentId,
    note
  });
  // Bust caches broadly — we don't know which tenant without an extra lookup
  _cacheClear('pending');
  _cacheClear('ledger');
  _cacheClear('dashboard');
  Object.keys(_cache).forEach(k => {
    if (k.startsWith('payments:') || k.startsWith('billing:')) _cacheClear(k);
  });
  return data;
}

/**
 * Admin rejects a pending payment with an optional note.
 * @param {string} adminPin
 * @param {string} paymentId
 * @param {string} [note]
 */
async function apiRejectPayment(adminPin, paymentId, note = '') {
  const data = await _post({
    action: 'rejectPayment',
    admin_pin: adminPin,
    payment_id: paymentId,
    note
  });
  _cacheClear('pending');
  _cacheClear('dashboard');
  return data;
}

// ── Receipts ─────────────────────────────────────────────────────────────────

/**
 * Fetches (or regenerates) a receipt for a given payment.
 * Accessible by tenant (login_code) or admin (admin_pin).
 * @param {Object} authParams   { login_code } or { admin_pin }
 * @param {string} paymentId
 */
async function apiGenerateReceipt(authParams, paymentId) {
  return _post({
    action: 'generateReceipt',
    ...authParams,
    payment_id: paymentId
  });
}

// ---------------------------------------------------------------------------
// UTILITY HELPERS
// Shared formatting functions used by both admin.js and tenant.js.
// ---------------------------------------------------------------------------

/**
 * Formats a number as Philippine Peso.
 * e.g. 3900 → "₱3,900.00"
 */
function formatPeso(amount) {
  const n = parseFloat(amount) || 0;
  return '₱' + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * Formats a YYYY-MM string to a readable month label.
 * e.g. "2025-03" → "March 2025"
 */
function formatMonth(yyyymm) {
  if (!yyyymm) return '';
  const [y, m] = String(yyyymm).split('-');
  const months = ['January','February','March','April','May','June',
                  'July','August','September','October','November','December'];
  return (months[parseInt(m) - 1] || '') + ' ' + y;
}

/**
 * Returns "YYYY-MM" for the current month in local time.
 */
function getCurrentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Returns today's date as "YYYY-MM-DD" in local time.
 */
function getTodayDate() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

/**
 * Escapes HTML special characters to prevent XSS when injecting user data
 * into innerHTML.
 */
function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Renders a status badge string.
 * @param {'paid'|'partial'|'unpaid'|'pending'|'approved'|'rejected'} status
 */
function statusBadge(status) {
  const map = {
    paid:     ['badge-paid',     'Paid'],
    partial:  ['badge-partial',  'Partial'],
    unpaid:   ['badge-unpaid',   'Unpaid'],
    pending:  ['badge-pending',  'Pending'],
    approved: ['badge-paid',     'Approved'],
    rejected: ['badge-unpaid',   'Rejected']
  };
  const [cls, label] = map[status] || ['badge-pending', status];
  return `<span class="badge ${cls}">${label}</span>`;
}

/**
 * Shows a toast notification at the bottom of the screen.
 * @param {string} message
 * @param {'success'|'error'|'info'} [type]
 * @param {number} [duration] ms
 */
function showToast(message, type = 'info', duration = 3500) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  // Trigger animation
  requestAnimationFrame(() => toast.classList.add('toast-visible'));
  setTimeout(() => {
    toast.classList.remove('toast-visible');
    toast.addEventListener('transitionend', () => toast.remove(), { once: true });
  }, duration);
}

/**
 * Renders a skeleton loader placeholder inside a container element.
 * Call clearSkeleton() or replace innerHTML to remove.
 * @param {HTMLElement} el
 * @param {number} [lines]
 */
function showSkeleton(el, lines = 4) {
  el.innerHTML = Array.from({ length: lines }, () =>
    '<div class="skeleton-line"></div>'
  ).join('');
}

/**
 * Injects the property name into all elements with data-property-name attribute.
 * Called once after getConfig resolves on every page.
 * Also sets the document <title>.
 * @param {string} propertyName
 * @param {string} [pageTitle]  appended after property name in <title>
 */
function applyPropertyName(propertyName, pageTitle = '') {
  document.querySelectorAll('[data-property-name]').forEach(el => {
    el.textContent = propertyName;
  });
  document.title = pageTitle
    ? `${propertyName} — ${pageTitle}`
    : propertyName;
}

/**
 * Simple modal helper: shows a pre-existing <dialog> element by id.
 * @param {string} dialogId
 */
function openModal(dialogId) {
  const dlg = document.getElementById(dialogId);
  if (dlg) dlg.showModal();
}

/**
 * Closes a <dialog> element by id.
 * @param {string} dialogId
 */
function closeModal(dialogId) {
  const dlg = document.getElementById(dialogId);
  if (dlg) dlg.close();
}

/**
 * Reads all named inputs/selects/textareas inside a form element
 * and returns a plain object.
 * @param {HTMLFormElement|string} formOrId
 */
function readForm(formOrId) {
  const form = typeof formOrId === 'string'
    ? document.getElementById(formOrId)
    : formOrId;
  const out = {};
  form.querySelectorAll('[name]').forEach(el => {
    out[el.name] = el.value.trim();
  });
  return out;
}

/**
 * Disables / re-enables a submit button and shows a loading label.
 * @param {HTMLButtonElement} btn
 * @param {boolean} loading
 * @param {string} [loadingLabel]
 */
function setBtnLoading(btn, loading, loadingLabel = 'Saving…') {
  if (loading) {
    btn.dataset.origText = btn.textContent;
    btn.textContent = loadingLabel;
    btn.disabled = true;
  } else {
    btn.textContent = btn.dataset.origText || 'Submit';
    btn.disabled = false;
  }
}
