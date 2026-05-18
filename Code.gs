// =============================================================================
// Code.gs — JJ Apartment Rental Management System
// Google Apps Script Web App backend
// All logic runs server-side; frontend communicates via HTTPS POST requests.
// Deploy as: Execute as "Me", Who has access "Anyone"
// =============================================================================

// ---------------------------------------------------------------------------
// CONFIGURATION — set your Spreadsheet ID here after creating the Sheets file
// ---------------------------------------------------------------------------
var SPREADSHEET_ID = 'YOUR_SPREADSHEET_ID_HERE';

// Sheet tab names — must match exactly what you create in Google Sheets
var SHEET = {
  CONFIG:   'Config',
  TENANTS:  'Tenants',
  BILLING:  'Billing',
  PAYMENTS: 'Payments',
  RECEIPTS: 'Receipts',
  READINGS: 'Readings'
};

// ---------------------------------------------------------------------------
// ENTRY POINT
// All requests arrive here as HTTP POST. The "action" field in the JSON body
// determines which handler runs. Every response is JSON.
// ---------------------------------------------------------------------------
function doPost(e) {
  try {
    var body   = JSON.parse(e.postData.contents);
    var action = body.action;

    if (!action) return respond(false, null, 'Missing action');

    switch (action) {
      case 'getConfig':           return getConfig(body);
      case 'getTenantInfo':       return getTenantInfo(body);
      case 'getBillingHistory':   return getBillingHistory(body);
      case 'getPaymentHistory':   return getPaymentHistory(body);
      case 'getLedger':           return getLedger(body);
      case 'submitPayment':       return submitPayment(body);
      case 'logPayment':          return logPayment(body);
      case 'approvePayment':      return approvePayment(body);
      case 'rejectPayment':       return rejectPayment(body);
      case 'addTenant':           return addTenant(body);
      case 'updateTenant':        return updateTenant(body);
      case 'enterMeterReadings':  return enterMeterReadings(body);
      case 'getDashboardData':    return getDashboardData(body);
      case 'getAllTenants':        return getAllTenants(body);
      case 'getPendingPayments':  return getPendingPayments(body);
      case 'generateReceipt':     return generateReceipt(body);
      default:                    return respond(false, null, 'Unknown action: ' + action);
    }
  } catch (err) {
    return respond(false, null, 'Server error: ' + err.message);
  }
}

// Allow browser preflight / direct GET health-check
function doGet(e) {
  return ContentService.createTextOutput(JSON.stringify({ ok: true, service: 'JJ Apartment RMS' }))
    .setMimeType(ContentService.MimeType.JSON);
}

// ---------------------------------------------------------------------------
// HELPERS — spreadsheet access, ID generation, response formatting
// ---------------------------------------------------------------------------

function getSpreadsheet() {
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

function getSheet(name) {
  return getSpreadsheet().getSheetByName(name);
}

// Returns all rows of a sheet as an array of objects keyed by the header row
function sheetToObjects(sheetName) {
  var sheet = getSheet(sheetName);
  var data  = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  var headers = data[0];
  var rows    = [];
  for (var i = 1; i < data.length; i++) {
    var obj = {};
    for (var j = 0; j < headers.length; j++) {
      obj[headers[j]] = data[i][j];
    }
    rows.push(obj);
  }
  return rows;
}

// Appends a single row to a sheet in header-column order
function appendRow(sheetName, obj) {
  var sheet   = getSheet(sheetName);
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var row     = headers.map(function(h) { return obj[h] !== undefined ? obj[h] : ''; });
  sheet.appendRow(row);
}

// Overwrites a specific row (1-indexed, row 1 = headers, row 2 = first data row)
function updateRow(sheetName, rowIndex, obj) {
  var sheet   = getSheet(sheetName);
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var row     = headers.map(function(h) { return obj[h] !== undefined ? obj[h] : ''; });
  sheet.getRange(rowIndex, 1, 1, row.length).setValues([row]);
}

// Finds the sheet row index (1-based, including header) of the first object
// matching predicate fn(obj) => bool. Returns -1 if not found.
function findRowIndex(sheetName, fn) {
  var sheet = getSheet(sheetName);
  var data  = sheet.getDataRange().getValues();
  if (data.length < 2) return -1;
  var headers = data[0];
  for (var i = 1; i < data.length; i++) {
    var obj = {};
    for (var j = 0; j < headers.length; j++) obj[headers[j]] = data[i][j];
    if (fn(obj)) return i + 1; // +1 because getRange is 1-based
  }
  return -1;
}

// Generates a short unique ID: prefix + timestamp base36 + 3 random chars
function genId(prefix) {
  var ts   = Date.now().toString(36).toUpperCase();
  var rand = Math.random().toString(36).substr(2, 3).toUpperCase();
  return (prefix || '') + ts + rand;
}

// Auto-increments receipt number by scanning the Receipts sheet
function nextReceiptNo() {
  var rows = sheetToObjects(SHEET.RECEIPTS);
  if (rows.length === 0) return 1001;
  var max = rows.reduce(function(m, r) {
    return Math.max(m, parseInt(r.receipt_no) || 0);
  }, 1000);
  return max + 1;
}

function today() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function currentMonth() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM');
}

function formatMonthLabel(yyyymm) {
  // "2025-03" -> "March 2025"
  var parts = String(yyyymm).split('-');
  var months = ['January','February','March','April','May','June',
                'July','August','September','October','November','December'];
  return months[parseInt(parts[1]) - 1] + ' ' + parts[0];
}

function respond(success, data, error) {
  var payload = success
    ? { success: true, data: data }
    : { success: false, error: error || 'Unknown error' };
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

// Returns config as a key->value plain object
function loadConfig() {
  var rows = sheetToObjects(SHEET.CONFIG);
  var cfg  = {};
  rows.forEach(function(r) { cfg[r.key] = r.value; });
  return cfg;
}

// Validates admin PIN from request body against Config sheet
function validateAdmin(body) {
  var cfg = loadConfig();
  return String(body.admin_pin) === String(cfg.admin_pin);
}

// Validates tenant login code and returns the tenant object or null
function validateTenant(body) {
  var tenants = sheetToObjects(SHEET.TENANTS);
  return tenants.find(function(t) {
    return String(t.login_code).toUpperCase() === String(body.login_code).toUpperCase()
        && t.status === 'active';
  }) || null;
}

// ---------------------------------------------------------------------------
// ACTION: getConfig
// Returns all config key-value pairs. No auth required — property name and
// rates are needed before any login screen can render.
// ---------------------------------------------------------------------------
function getConfig(body) {
  var cfg = loadConfig();
  return respond(true, cfg);
}

// ---------------------------------------------------------------------------
// ACTION: getAllTenants
// Returns full tenant list. Admin only.
// ---------------------------------------------------------------------------
function getAllTenants(body) {
  if (!validateAdmin(body)) return respond(false, null, 'Unauthorized');
  var tenants = sheetToObjects(SHEET.TENANTS);
  return respond(true, tenants);
}

// ---------------------------------------------------------------------------
// ACTION: getTenantInfo
// Returns tenant profile + current month billing + last payment.
// Tenant-facing: auth by login_code.
// ---------------------------------------------------------------------------
function getTenantInfo(body) {
  var tenant = validateTenant(body);
  if (!tenant) return respond(false, null, 'Invalid tenant code');

  var month   = body.month || currentMonth();
  var billing = sheetToObjects(SHEET.BILLING).find(function(b) {
    return String(b.tenant_id) === String(tenant.tenant_id)
        && String(b.month)     === String(month);
  }) || null;

  var payments = sheetToObjects(SHEET.PAYMENTS).filter(function(p) {
    return String(p.tenant_id) === String(tenant.tenant_id);
  });
  var lastPayment = payments.length
    ? payments.sort(function(a,b){ return b.date < a.date ? -1 : 1; })[0]
    : null;

  return respond(true, { tenant: tenant, billing: billing, last_payment: lastPayment });
}

// ---------------------------------------------------------------------------
// ACTION: getBillingHistory
// Returns all billing rows for a tenant. Accessible by tenant or admin.
// ---------------------------------------------------------------------------
function getBillingHistory(body) {
  var tenantId;
  if (body.login_code) {
    var tenant = validateTenant(body);
    if (!tenant) return respond(false, null, 'Invalid tenant code');
    tenantId = tenant.tenant_id;
  } else {
    if (!validateAdmin(body)) return respond(false, null, 'Unauthorized');
    tenantId = body.tenant_id;
  }

  var rows = sheetToObjects(SHEET.BILLING).filter(function(b) {
    return String(b.tenant_id) === String(tenantId);
  }).sort(function(a,b){ return a.month < b.month ? 1 : -1; });

  return respond(true, rows);
}

// ---------------------------------------------------------------------------
// ACTION: getPaymentHistory
// Returns all payment records for a tenant. Accessible by tenant or admin.
// ---------------------------------------------------------------------------
function getPaymentHistory(body) {
  var tenantId;
  if (body.login_code) {
    var tenant = validateTenant(body);
    if (!tenant) return respond(false, null, 'Invalid tenant code');
    tenantId = tenant.tenant_id;
  } else {
    if (!validateAdmin(body)) return respond(false, null, 'Unauthorized');
    tenantId = body.tenant_id;
  }

  var rows = sheetToObjects(SHEET.PAYMENTS).filter(function(p) {
    return String(p.tenant_id) === String(tenantId);
  }).sort(function(a,b){ return a.date < b.date ? 1 : -1; });

  // Attach receipt snapshot if available
  var receipts = sheetToObjects(SHEET.RECEIPTS);
  rows = rows.map(function(p) {
    var receipt = receipts.find(function(r) {
      return String(r.payment_id) === String(p.payment_id);
    });
    p.receipt = receipt ? JSON.parse(receipt.receipt_snapshot || '{}') : null;
    p.receipt_no = receipt ? receipt.receipt_no : null;
    return p;
  });

  return respond(true, rows);
}

// ---------------------------------------------------------------------------
// ACTION: getLedger
// Returns all active tenants with month-by-month billed/paid/balance rows.
// Admin only. This is the running balance view.
// ---------------------------------------------------------------------------
function getLedger(body) {
  if (!validateAdmin(body)) return respond(false, null, 'Unauthorized');

  var tenants  = sheetToObjects(SHEET.TENANTS).filter(function(t) {
    return t.status === 'active' || t.status === 'moved-out';
  });
  var billings  = sheetToObjects(SHEET.BILLING);
  var payments  = sheetToObjects(SHEET.PAYMENTS).filter(function(p) {
    return p.status === 'approved';
  });

  var ledger = tenants.map(function(tenant) {
    var tid = String(tenant.tenant_id);

    // All billing rows for this tenant, sorted oldest first
    var tenantBilling = billings
      .filter(function(b) { return String(b.tenant_id) === tid; })
      .sort(function(a,b) { return a.month < b.month ? -1 : 1; });

    var totalBilled = 0, totalPaid = 0;
    var months = tenantBilling.map(function(b) {
      var billed  = parseFloat(b.total_bill)   || 0;
      var paid    = parseFloat(b.amount_paid)  || 0;
      var balance = parseFloat(b.balance)      || 0;
      totalBilled += billed;
      totalPaid   += paid;
      return {
        month:         b.month,
        month_label:   formatMonthLabel(b.month),
        rent:          parseFloat(b.rent_amount)  || 0,
        elec_bill:     parseFloat(b.elec_bill)    || 0,
        water_bill:    parseFloat(b.water_bill)   || 0,
        late_fee:      parseFloat(b.late_fee)     || 0,
        total_bill:    billed,
        amount_paid:   paid,
        balance:       balance,
        status:        b.status
      };
    });

    var outstanding = totalBilled - totalPaid;

    return {
      tenant_id:   tenant.tenant_id,
      name:        tenant.name,
      unit:        tenant.unit,
      status:      tenant.status,
      outstanding: outstanding,
      total_billed: totalBilled,
      total_paid:   totalPaid,
      months:      months
    };
  });

  // Summary counts
  var summary = {
    total_outstanding:    ledger.reduce(function(s,t){ return s + t.outstanding; }, 0),
    tenants_with_balance: ledger.filter(function(t){ return t.outstanding > 0; }).length,
    tenants_fully_paid:   ledger.filter(function(t){ return t.outstanding <= 0; }).length
  };

  return respond(true, { summary: summary, ledger: ledger });
}

// ---------------------------------------------------------------------------
// ACTION: getDashboardData
// Returns admin dashboard summary: collections, pending approvals, overdue,
// occupancy, and recent payment feed. Admin only.
// ---------------------------------------------------------------------------
function getDashboardData(body) {
  if (!validateAdmin(body)) return respond(false, null, 'Unauthorized');

  var cfg      = loadConfig();
  var month    = body.month || currentMonth();
  var tenants  = sheetToObjects(SHEET.TENANTS);
  var billings  = sheetToObjects(SHEET.BILLING);
  var payments  = sheetToObjects(SHEET.PAYMENTS);

  var active      = tenants.filter(function(t){ return t.status === 'active'; });
  var movedOut    = tenants.filter(function(t){ return t.status === 'moved-out'; });
  var occupancy   = active.length;
  var totalUnits  = tenants.length - movedOut.length;  // rough unit count

  // This-month collections (approved payments this month)
  var monthPayments = payments.filter(function(p) {
    return p.status === 'approved'
        && String(p.date).substr(0,7) === String(month);
  });
  var collected = monthPayments.reduce(function(s,p){ return s + (parseFloat(p.amount)||0); }, 0);

  // Pending approvals
  var pending = payments.filter(function(p){ return p.status === 'pending'; });

  // Overdue: active tenants with an unpaid/partial billing row for a past month
  var now = currentMonth();
  var overdue = billings.filter(function(b) {
    return b.month < now
        && (b.status === 'unpaid' || b.status === 'partial')
        && tenants.find(function(t){ return String(t.tenant_id)===String(b.tenant_id) && t.status==='active'; });
  });
  var overdueIds = [...new Set(overdue.map(function(b){ return b.tenant_id; }))];

  // Recent activity: last 10 approved + pending payments
  var recent = payments
    .sort(function(a,b){ return a.date < b.date ? 1 : -1; })
    .slice(0, 10)
    .map(function(p) {
      var t = tenants.find(function(t){ return String(t.tenant_id)===String(p.tenant_id); });
      return {
        payment_id:  p.payment_id,
        tenant_name: t ? t.name : 'Unknown',
        unit:        t ? t.unit : '',
        date:        p.date,
        amount:      p.amount,
        method:      p.method,
        status:      p.status
      };
    });

  return respond(true, {
    month:             month,
    collected_month:   collected,
    pending_count:     pending.length,
    overdue_count:     overdueIds.length,
    occupancy:         occupancy,
    recent_payments:   recent
  });
}

// ---------------------------------------------------------------------------
// ACTION: getPendingPayments
// Returns all tenant-submitted payments awaiting admin approval. Admin only.
// ---------------------------------------------------------------------------
function getPendingPayments(body) {
  if (!validateAdmin(body)) return respond(false, null, 'Unauthorized');

  var tenants  = sheetToObjects(SHEET.TENANTS);
  var payments = sheetToObjects(SHEET.PAYMENTS)
    .filter(function(p){ return p.status === 'pending'; })
    .sort(function(a,b){ return a.date < b.date ? 1 : -1; });

  var result = payments.map(function(p) {
    var t = tenants.find(function(t){ return String(t.tenant_id)===String(p.tenant_id); });
    return Object.assign({}, p, {
      tenant_name: t ? t.name : 'Unknown',
      unit:        t ? t.unit : ''
    });
  });

  return respond(true, result);
}

// ---------------------------------------------------------------------------
// ACTION: submitPayment
// Tenant submits a payment for admin review. Status = pending.
// ---------------------------------------------------------------------------
function submitPayment(body) {
  var tenant = validateTenant(body);
  if (!tenant) return respond(false, null, 'Invalid tenant code');

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var paymentId = genId('PAY');
    var record = {
      payment_id:    paymentId,
      tenant_id:     tenant.tenant_id,
      billing_id:    body.billing_id || '',
      date:          body.date || today(),
      amount:        parseFloat(body.amount) || 0,
      method:        body.method || '',
      reference_no:  body.reference_no || '',
      proof_url:     body.proof_url || '',
      status:        'pending',
      note:          '',
      approved_by:   '',
      approved_date: ''
    };
    appendRow(SHEET.PAYMENTS, record);
    return respond(true, { payment_id: paymentId, status: 'pending' });
  } finally {
    lock.releaseLock();
  }
}

// ---------------------------------------------------------------------------
// ACTION: logPayment
// Admin logs a payment directly — immediately approved, triggers receipt + email.
// ---------------------------------------------------------------------------
function logPayment(body) {
  if (!validateAdmin(body)) return respond(false, null, 'Unauthorized');

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var cfg    = loadConfig();
    var tenant = sheetToObjects(SHEET.TENANTS).find(function(t){
      return String(t.tenant_id) === String(body.tenant_id);
    });
    if (!tenant) return respond(false, null, 'Tenant not found');

    var paymentId = genId('PAY');
    var payDate   = body.date || today();

    // Write payment record
    var record = {
      payment_id:    paymentId,
      tenant_id:     tenant.tenant_id,
      billing_id:    body.billing_id || '',
      date:          payDate,
      amount:        parseFloat(body.amount) || 0,
      method:        body.method || '',
      reference_no:  body.reference_no || '',
      proof_url:     '',
      status:        'approved',
      note:          body.note || 'Admin logged',
      approved_by:   'admin',
      approved_date: today()
    };
    appendRow(SHEET.PAYMENTS, record);

    // Update billing row amount_paid and balance
    var billing = updateBillingAfterPayment(body.billing_id, record.amount, cfg);

    // Generate receipt
    var receipt = buildAndSaveReceipt(paymentId, tenant, billing, record, cfg);

    // Send email
    if (tenant.email) {
      sendReceiptEmail(tenant, receipt, cfg);
    }

    return respond(true, { payment_id: paymentId, receipt: receipt });
  } finally {
    lock.releaseLock();
  }
}

// ---------------------------------------------------------------------------
// ACTION: approvePayment
// Admin approves a pending tenant submission. Triggers receipt + email.
// ---------------------------------------------------------------------------
function approvePayment(body) {
  if (!validateAdmin(body)) return respond(false, null, 'Unauthorized');

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var cfg = loadConfig();

    // Find the payment row
    var rowIdx = findRowIndex(SHEET.PAYMENTS, function(p){
      return String(p.payment_id) === String(body.payment_id);
    });
    if (rowIdx === -1) return respond(false, null, 'Payment not found');

    var payments = sheetToObjects(SHEET.PAYMENTS);
    var payment  = payments.find(function(p){
      return String(p.payment_id) === String(body.payment_id);
    });
    if (payment.status !== 'pending') return respond(false, null, 'Payment is not pending');

    // Update payment status
    payment.status        = 'approved';
    payment.approved_by   = 'admin';
    payment.approved_date = today();
    payment.note          = body.note || '';
    updateRow(SHEET.PAYMENTS, rowIdx, payment);

    // Find tenant
    var tenant = sheetToObjects(SHEET.TENANTS).find(function(t){
      return String(t.tenant_id) === String(payment.tenant_id);
    });
    if (!tenant) return respond(false, null, 'Tenant not found');

    // Update billing
    var billing = updateBillingAfterPayment(payment.billing_id, parseFloat(payment.amount)||0, cfg);

    // Generate receipt
    var receipt = buildAndSaveReceipt(payment.payment_id, tenant, billing, payment, cfg);

    // Send email
    if (tenant.email) {
      sendReceiptEmail(tenant, receipt, cfg);
    }

    return respond(true, { payment: payment, receipt: receipt });
  } finally {
    lock.releaseLock();
  }
}

// ---------------------------------------------------------------------------
// ACTION: rejectPayment
// Admin rejects a pending payment with optional note.
// ---------------------------------------------------------------------------
function rejectPayment(body) {
  if (!validateAdmin(body)) return respond(false, null, 'Unauthorized');

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var rowIdx = findRowIndex(SHEET.PAYMENTS, function(p){
      return String(p.payment_id) === String(body.payment_id);
    });
    if (rowIdx === -1) return respond(false, null, 'Payment not found');

    var payments = sheetToObjects(SHEET.PAYMENTS);
    var payment  = payments.find(function(p){
      return String(p.payment_id) === String(body.payment_id);
    });
    if (payment.status !== 'pending') return respond(false, null, 'Payment is not pending');

    payment.status        = 'rejected';
    payment.approved_by   = 'admin';
    payment.approved_date = today();
    payment.note          = body.note || '';
    updateRow(SHEET.PAYMENTS, rowIdx, payment);

    return respond(true, { payment_id: payment.payment_id, status: 'rejected' });
  } finally {
    lock.releaseLock();
  }
}

// ---------------------------------------------------------------------------
// ACTION: addTenant
// Admin adds a new tenant. Auto-generates tenant_id and login_code.
// ---------------------------------------------------------------------------
function addTenant(body) {
  if (!validateAdmin(body)) return respond(false, null, 'Unauthorized');

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var cfg     = loadConfig();
    var tenants = sheetToObjects(SHEET.TENANTS);

    // Auto-assign login code: prefix + zero-padded sequence (e.g. JJ-01)
    var prefix  = (cfg.login_prefix || 'JJ') + '-';
    var maxNum  = tenants.reduce(function(max, t) {
      var m = String(t.login_code).match(/(\d+)$/);
      return m ? Math.max(max, parseInt(m[1])) : max;
    }, 0);
    var loginCode = prefix + String(maxNum + 1).padStart(2, '0');

    var tenantId = genId('TEN');
    var record = {
      tenant_id:     tenantId,
      name:          body.name || '',
      unit:          body.unit || '',
      room_type:     body.room_type || '',
      move_in_date:  body.move_in_date || today(),
      move_out_date: '',
      monthly_rent:  parseFloat(body.monthly_rent) || 0,
      deposit_paid:  parseFloat(body.deposit_paid) || 0,
      email:         body.email || '',
      contact:       body.contact || '',
      status:        'active',
      login_code:    body.login_code || loginCode
    };
    appendRow(SHEET.TENANTS, record);
    return respond(true, record);
  } finally {
    lock.releaseLock();
  }
}

// ---------------------------------------------------------------------------
// ACTION: updateTenant
// Admin edits an existing tenant's details. Cannot change tenant_id.
// ---------------------------------------------------------------------------
function updateTenant(body) {
  if (!validateAdmin(body)) return respond(false, null, 'Unauthorized');

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var rowIdx = findRowIndex(SHEET.TENANTS, function(t){
      return String(t.tenant_id) === String(body.tenant_id);
    });
    if (rowIdx === -1) return respond(false, null, 'Tenant not found');

    var tenants = sheetToObjects(SHEET.TENANTS);
    var tenant  = tenants.find(function(t){
      return String(t.tenant_id) === String(body.tenant_id);
    });

    // Merge only allowed fields
    var allowed = ['name','unit','room_type','move_in_date','move_out_date',
                   'monthly_rent','deposit_paid','email','contact','status','login_code'];
    allowed.forEach(function(f){ if (body[f] !== undefined) tenant[f] = body[f]; });

    updateRow(SHEET.TENANTS, rowIdx, tenant);
    return respond(true, tenant);
  } finally {
    lock.releaseLock();
  }
}

// ---------------------------------------------------------------------------
// ACTION: enterMeterReadings
// Admin enters current meter readings for one or more units.
// For each unit: saves to Readings, computes utility bills, writes/updates Billing row.
// ---------------------------------------------------------------------------
function enterMeterReadings(body) {
  if (!validateAdmin(body)) return respond(false, null, 'Unauthorized');

  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var cfg     = loadConfig();
    var month   = body.month || currentMonth();
    var entries = body.readings || []; // array of { tenant_id, elec_curr, water_curr }

    var electricRate = parseFloat(cfg.electric_rate) || 0;
    var waterRate    = parseFloat(cfg.water_rate)    || 0;
    var dueDay       = parseInt(cfg.due_day)         || 5;
    var lateFeeAmt   = parseFloat(cfg.late_fee_amount) || 0;
    var lateFeeType  = cfg.late_fee_type || 'fixed';

    var allReadings  = sheetToObjects(SHEET.READINGS);
    var allBillings  = sheetToObjects(SHEET.BILLING);
    var allTenants   = sheetToObjects(SHEET.TENANTS);

    var results = [];

    entries.forEach(function(entry) {
      var tid     = String(entry.tenant_id);
      var tenant  = allTenants.find(function(t){ return String(t.tenant_id)===tid; });
      if (!tenant) return;

      var elecCurr  = parseFloat(entry.elec_curr)  || 0;
      var waterCurr = parseFloat(entry.water_curr) || 0;

      // Previous reading: last saved entry for this tenant before this month
      var prevReadings = allReadings
        .filter(function(r){ return String(r.tenant_id)===tid && r.month < month; })
        .sort(function(a,b){ return a.month < b.month ? 1 : -1; });

      var elecPrev  = prevReadings.length ? (parseFloat(prevReadings[0].elec_curr)  || 0) : 0;
      var waterPrev = prevReadings.length ? (parseFloat(prevReadings[0].water_curr) || 0) : 0;

      var elecConsumption  = Math.max(0, elecCurr  - elecPrev);
      var waterConsumption = Math.max(0, waterCurr - waterPrev);
      var elecBill         = elecConsumption  * electricRate;
      var waterBill        = waterConsumption * waterRate;

      // Late fee: check if today is past due date for this month
      var dueDate  = month + '-' + String(dueDay).padStart(2,'0');
      var isLate   = today() > dueDate;
      var rent     = parseFloat(tenant.monthly_rent) || 0;
      var lateFee  = 0;
      if (isLate) {
        lateFee = (lateFeeType === 'percent')
          ? rent * (lateFeeAmt / 100)
          : lateFeeAmt;
      }

      var totalBill = rent + elecBill + waterBill + lateFee;

      // Save / overwrite Readings row for this month
      var readingId  = genId('RDG');
      var readingRow = {
        reading_id: readingId,
        tenant_id:  tid,
        month:      month,
        elec_prev:  elecPrev,
        elec_curr:  elecCurr,
        water_prev: waterPrev,
        water_curr: waterCurr,
        saved_date: today()
      };

      var existingReadingIdx = findRowIndex(SHEET.READINGS, function(r){
        return String(r.tenant_id)===tid && String(r.month)===month;
      });
      if (existingReadingIdx === -1) {
        appendRow(SHEET.READINGS, readingRow);
      } else {
        readingRow.reading_id = allReadings.find(function(r){
          return String(r.tenant_id)===tid && String(r.month)===month;
        }).reading_id;
        updateRow(SHEET.READINGS, existingReadingIdx, readingRow);
      }

      // Save / overwrite Billing row for this month
      var billingId   = genId('BIL');
      var billingRow  = {
        billing_id:        billingId,
        tenant_id:         tid,
        month:             month,
        rent_amount:       rent,
        elec_prev:         elecPrev,
        elec_curr:         elecCurr,
        elec_consumption:  elecConsumption,
        elec_bill:         elecBill,
        water_prev:        waterPrev,
        water_curr:        waterCurr,
        water_consumption: waterConsumption,
        water_bill:        waterBill,
        late_fee:          lateFee,
        total_bill:        totalBill,
        amount_paid:       0,
        balance:           totalBill,
        status:            'unpaid'
      };

      var existingBillingIdx = findRowIndex(SHEET.BILLING, function(b){
        return String(b.tenant_id)===tid && String(b.month)===month;
      });
      if (existingBillingIdx === -1) {
        appendRow(SHEET.BILLING, billingRow);
      } else {
        // Preserve amount_paid if re-entering readings after partial payment
        var existing = allBillings.find(function(b){
          return String(b.tenant_id)===tid && String(b.month)===month;
        });
        billingRow.billing_id   = existing.billing_id;
        billingRow.amount_paid  = parseFloat(existing.amount_paid) || 0;
        billingRow.balance      = totalBill - billingRow.amount_paid;
        billingRow.status       = billingRow.balance <= 0 ? 'paid'
                                : billingRow.amount_paid > 0 ? 'partial' : 'unpaid';
        updateRow(SHEET.BILLING, existingBillingIdx, billingRow);
      }

      results.push({
        tenant_id:         tid,
        name:              tenant.name,
        unit:              tenant.unit,
        month:             month,
        elec_prev:         elecPrev,
        elec_curr:         elecCurr,
        elec_consumption:  elecConsumption,
        elec_bill:         elecBill,
        water_prev:        waterPrev,
        water_curr:        waterCurr,
        water_consumption: waterConsumption,
        water_bill:        waterBill,
        late_fee:          lateFee,
        total_bill:        totalBill
      });
    });

    return respond(true, { month: month, results: results });
  } finally {
    lock.releaseLock();
  }
}

// ---------------------------------------------------------------------------
// ACTION: generateReceipt
// Builds (or re-fetches) a receipt for a given payment_id. Admin or tenant.
// ---------------------------------------------------------------------------
function generateReceipt(body) {
  // Allow tenant or admin access
  var cfg = loadConfig();
  var authed = false;
  if (body.login_code) {
    var tenant = validateTenant(body);
    authed = !!tenant;
  } else {
    authed = validateAdmin(body);
  }
  if (!authed) return respond(false, null, 'Unauthorized');

  var receipts = sheetToObjects(SHEET.RECEIPTS);
  var existing = receipts.find(function(r){
    return String(r.payment_id) === String(body.payment_id);
  });
  if (existing) {
    return respond(true, {
      receipt_no: existing.receipt_no,
      receipt:    JSON.parse(existing.receipt_snapshot || '{}')
    });
  }

  // Build fresh if not yet saved (shouldn't happen in normal flow)
  var payments = sheetToObjects(SHEET.PAYMENTS);
  var payment  = payments.find(function(p){
    return String(p.payment_id) === String(body.payment_id);
  });
  if (!payment) return respond(false, null, 'Payment not found');

  var tenants = sheetToObjects(SHEET.TENANTS);
  var tenant2 = tenants.find(function(t){
    return String(t.tenant_id) === String(payment.tenant_id);
  });

  var billings = sheetToObjects(SHEET.BILLING);
  var billing  = billings.find(function(b){
    return String(b.billing_id) === String(payment.billing_id);
  }) || null;

  var receipt = buildAndSaveReceipt(payment.payment_id, tenant2, billing, payment, cfg);
  return respond(true, { receipt_no: receipt.receipt_no, receipt: receipt });
}

// ---------------------------------------------------------------------------
// INTERNAL: updateBillingAfterPayment
// Increments amount_paid and recalculates balance + status for a billing row.
// Returns the updated billing object.
// ---------------------------------------------------------------------------
function updateBillingAfterPayment(billingId, amount, cfg) {
  if (!billingId) return null;

  var rowIdx = findRowIndex(SHEET.BILLING, function(b){
    return String(b.billing_id) === String(billingId);
  });
  if (rowIdx === -1) return null;

  var billings = sheetToObjects(SHEET.BILLING);
  var billing  = billings.find(function(b){
    return String(b.billing_id) === String(billingId);
  });

  var amountPaid = (parseFloat(billing.amount_paid) || 0) + amount;
  var totalBill  = parseFloat(billing.total_bill) || 0;
  var balance    = Math.max(0, totalBill - amountPaid);
  var status     = balance <= 0 ? 'paid' : amountPaid > 0 ? 'partial' : 'unpaid';

  billing.amount_paid = amountPaid;
  billing.balance     = balance;
  billing.status      = status;
  updateRow(SHEET.BILLING, rowIdx, billing);

  return billing;
}

// ---------------------------------------------------------------------------
// INTERNAL: buildAndSaveReceipt
// Constructs the full receipt object and saves a snapshot to the Receipts sheet.
// Returns the receipt object.
// ---------------------------------------------------------------------------
function buildAndSaveReceipt(paymentId, tenant, billing, payment, cfg) {
  var receiptNo   = nextReceiptNo();
  var genDate     = today();
  var propertyName = cfg.property_name || 'Property';

  var snapshot = {
    receipt_no:     receiptNo,
    generated_date: genDate,
    property_name:  propertyName,
    tenant_name:    tenant ? tenant.name       : '',
    unit:           tenant ? tenant.unit       : '',
    email:          tenant ? tenant.email      : '',
    billing_period: billing ? formatMonthLabel(billing.month) : '',
    rent:           billing ? (parseFloat(billing.rent_amount)  || 0) : 0,
    elec_prev:      billing ? (parseFloat(billing.elec_prev)    || 0) : 0,
    elec_curr:      billing ? (parseFloat(billing.elec_curr)    || 0) : 0,
    elec_kwh:       billing ? (parseFloat(billing.elec_consumption) || 0) : 0,
    elec_bill:      billing ? (parseFloat(billing.elec_bill)    || 0) : 0,
    water_prev:     billing ? (parseFloat(billing.water_prev)   || 0) : 0,
    water_curr:     billing ? (parseFloat(billing.water_curr)   || 0) : 0,
    water_cbm:      billing ? (parseFloat(billing.water_consumption) || 0) : 0,
    water_bill:     billing ? (parseFloat(billing.water_bill)   || 0) : 0,
    late_fee:       billing ? (parseFloat(billing.late_fee)     || 0) : 0,
    total_bill:     billing ? (parseFloat(billing.total_bill)   || 0) : 0,
    amount_paid:    parseFloat(payment.amount)  || 0,
    method:         payment.method  || '',
    reference_no:   payment.reference_no || '',
    balance:        billing ? (parseFloat(billing.balance) || 0) : 0,
    electric_rate:  parseFloat(cfg.electric_rate) || 0,
    water_rate:     parseFloat(cfg.water_rate)    || 0
  };

  appendRow(SHEET.RECEIPTS, {
    receipt_no:       receiptNo,
    payment_id:       paymentId,
    tenant_id:        tenant ? tenant.tenant_id : '',
    generated_date:   genDate,
    receipt_snapshot: JSON.stringify(snapshot)
  });

  return snapshot;
}

// ---------------------------------------------------------------------------
// INTERNAL: sendReceiptEmail
// Sends an HTML receipt email via MailApp.
// ---------------------------------------------------------------------------
function sendReceiptEmail(tenant, receipt, cfg) {
  var propertyName = cfg.property_name || 'Property';
  var subject = propertyName + ' — Payment Receipt #' + receipt.receipt_no;

  var pesoFmt = function(n) { return '₱' + parseFloat(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g,','); };

  var html = [
    '<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#333;">',

    // Header
    '<div style="background:#0e7c61;padding:24px 32px;border-radius:8px 8px 0 0;">',
    '<h1 style="margin:0;color:#ffffff;font-size:22px;">' + propertyName + '</h1>',
    '<p style="margin:4px 0 0;color:#b2dfcd;font-size:14px;">Official Payment Receipt</p>',
    '</div>',

    // Receipt meta
    '<div style="background:#f9f6f0;padding:20px 32px;border-bottom:1px solid #e0d9ce;">',
    '<table style="width:100%;font-size:14px;"><tr>',
    '<td><strong>Receipt No:</strong> #' + receipt.receipt_no + '</td>',
    '<td style="text-align:right"><strong>Date:</strong> ' + receipt.generated_date + '</td>',
    '</tr></table>',
    '<p style="margin:8px 0 0;font-size:14px;"><strong>Tenant:</strong> ' + receipt.tenant_name + ' &nbsp;|&nbsp; <strong>Unit:</strong> ' + receipt.unit + '</p>',
    '<p style="margin:4px 0 0;font-size:14px;"><strong>Billing Period:</strong> ' + receipt.billing_period + '</p>',
    '</div>',

    // Breakdown table
    '<div style="padding:24px 32px;">',
    '<h3 style="margin:0 0 12px;font-size:15px;color:#0e7c61;">Billing Breakdown</h3>',
    '<table style="width:100%;border-collapse:collapse;font-size:14px;">',

    '<tr style="background:#f0f0eb;">',
    '<td style="padding:8px 12px;border:1px solid #ddd;"><strong>Item</strong></td>',
    '<td style="padding:8px 12px;border:1px solid #ddd;text-align:right"><strong>Amount</strong></td>',
    '</tr>',

    '<tr>',
    '<td style="padding:8px 12px;border:1px solid #ddd;">Monthly Rent</td>',
    '<td style="padding:8px 12px;border:1px solid #ddd;text-align:right">' + pesoFmt(receipt.rent) + '</td>',
    '</tr>',

    '<tr>',
    '<td style="padding:8px 12px;border:1px solid #ddd;">Electric<br>',
    '<small style="color:#777;">Prev: ' + receipt.elec_prev + ' kWh &rarr; Curr: ' + receipt.elec_curr + ' kWh &nbsp;(' + receipt.elec_kwh + ' kWh used @ ₱' + receipt.electric_rate + '/kWh)</small></td>',
    '<td style="padding:8px 12px;border:1px solid #ddd;text-align:right">' + pesoFmt(receipt.elec_bill) + '</td>',
    '</tr>',

    '<tr>',
    '<td style="padding:8px 12px;border:1px solid #ddd;">Water<br>',
    '<small style="color:#777;">Prev: ' + receipt.water_prev + ' m³ &rarr; Curr: ' + receipt.water_curr + ' m³ &nbsp;(' + receipt.water_cbm + ' m³ used @ ₱' + receipt.water_rate + '/m³)</small></td>',
    '<td style="padding:8px 12px;border:1px solid #ddd;text-align:right">' + pesoFmt(receipt.water_bill) + '</td>',
    '</tr>',

    receipt.late_fee > 0 ? (
      '<tr><td style="padding:8px 12px;border:1px solid #ddd;color:#c0392b;">Late Fee</td>' +
      '<td style="padding:8px 12px;border:1px solid #ddd;text-align:right;color:#c0392b;">' + pesoFmt(receipt.late_fee) + '</td></tr>'
    ) : '',

    '<tr style="background:#f0f0eb;font-weight:bold;">',
    '<td style="padding:8px 12px;border:1px solid #ddd;">Total Bill</td>',
    '<td style="padding:8px 12px;border:1px solid #ddd;text-align:right">' + pesoFmt(receipt.total_bill) + '</td>',
    '</tr>',

    '</table>',

    // Payment details
    '<div style="margin-top:20px;padding:16px;background:#eaf4f0;border-radius:6px;">',
    '<p style="margin:0;font-size:14px;"><strong>Amount Paid:</strong> ' + pesoFmt(receipt.amount_paid) + ' via ' + receipt.method + '</p>',
    receipt.reference_no ? '<p style="margin:4px 0 0;font-size:13px;color:#555;">Reference No: ' + receipt.reference_no + '</p>' : '',
    '<p style="margin:8px 0 0;font-size:14px;"><strong>Remaining Balance:</strong> ' +
      (receipt.balance > 0
        ? '<span style="color:#c0392b;">' + pesoFmt(receipt.balance) + '</span>'
        : '<span style="color:#0e7c61;">₱0.00 — Fully Paid</span>') + '</p>',
    '</div>',

    '</div>',

    // Footer
    '<div style="background:#f0f0eb;padding:16px 32px;border-radius:0 0 8px 8px;text-align:center;font-size:12px;color:#888;">',
    'For concerns, contact your property admin.',
    '</div>',

    '</div>'
  ].join('');

  try {
    MailApp.sendEmail({
      to:      tenant.email,
      subject: subject,
      htmlBody: html
    });
  } catch(e) {
    Logger.log('Email send failed for tenant ' + tenant.tenant_id + ': ' + e.message);
    // Non-fatal — receipt is already saved, just log the failure
  }
}
