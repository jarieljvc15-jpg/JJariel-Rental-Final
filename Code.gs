// =============================================================================
// Code.gs — JJ Apartment Rental Management System
// Google Apps Script Web App backend
// All logic runs server-side; frontend communicates via HTTPS POST requests.
// Deploy as: Execute as "Me", Who has access "Anyone"
// =============================================================================

// ---------------------------------------------------------------------------
// CONFIGURATION — set your Spreadsheet ID here after creating the Sheets file
// ---------------------------------------------------------------------------
var SPREADSHEET_ID = '1ONL_RJ99j-pfmGJvt034-LWzGyxJca_2GZrIruQfgI4';

// Sheet tab names — must match exactly what you create in Google Sheets
var SHEET = {
  CONFIG:   'Config',
  TENANTS:  'Tenants',
  BILLING:  'Billing',
  PAYMENTS: 'Payments',
  RECEIPTS: 'Receipts',
  READINGS: 'Readings',
  LEDGER:   'Ledger'
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
      case 'logFlexiblePayment':  return logFlexiblePayment(body);
      case 'approvePayment':      return approvePayment(body);
      case 'rejectPayment':       return rejectPayment(body);
      case 'addTenant':           return addTenant(body);
      case 'updateTenant':        return updateTenant(body);
      case 'enterMeterReadings':  return enterMeterReadings(body);
      case 'getDashboardData':    return getDashboardData(body);
      case 'getAllTenants':           return getAllTenants(body);
      case 'getPendingPayments':      return getPendingPayments(body);
      case 'getAllPayments':          return getAllPayments(body);
      case 'generateReceipt':        return generateReceipt(body);
      case 'resendReceiptEmail':      return resendReceiptEmail(body);
      case 'getTenantCreditBalance':  return getTenantCreditBalance(body);
      case 'triggerRemindersNow':     return triggerRemindersNow(body);
      case 'getCollectionStats':      return getCollectionStats(body);
      default:                        return respond(false, null, 'Unknown action: ' + action);
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

function getSheetData(sheetName) {
  var sheet = getSheet(sheetName);
  if (!sheet) return [];
  var data = sheet.getDataRange().getValues();
  return data;
}

function sheetToObjects(sheetName, rawData) {
  var data = rawData || getSheetData(sheetName);
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

function appendRow(sheetName, obj) {
  var sheet   = getSheet(sheetName);
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var row     = headers.map(function(h) { return obj[h] !== undefined ? obj[h] : ''; });
  sheet.appendRow(row);
}

function updateRow(sheetName, rowIndex, obj) {
  var sheet   = getSheet(sheetName);
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var row     = headers.map(function(h) { return obj[h] !== undefined ? obj[h] : ''; });
  sheet.getRange(rowIndex, 1, 1, row.length).setValues([row]);
}

function findRowIndex(sheetName, fn, rawData) {
  var data = rawData || getSheetData(sheetName);
  if (data.length < 2) return -1;
  var headers = data[0];
  for (var i = 1; i < data.length; i++) {
    var obj = {};
    for (var j = 0; j < headers.length; j++) obj[headers[j]] = data[i][j];
    if (fn(obj)) return i + 1;
  }
  return -1;
}

function genId(prefix) {
  var ts   = Date.now().toString(36).toUpperCase();
  var rand = Math.random().toString(36).substr(2, 3).toUpperCase();
  return (prefix || '') + ts + rand;
}

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
  var s;
  if (yyyymm instanceof Date) {
    var tz = Session.getScriptTimeZone();
    s = Utilities.formatDate(yyyymm, tz, 'yyyy-MM');
  } else {
    s = String(yyyymm || '').trim();
    if (/^\d{1,2}\/\d{1,2}\/\d{4}/.test(s)) {
      var mp = s.split('/');
      s = mp[2] + '-' + String(mp[0]).padStart(2, '0');
    }
  }
  var parts = s.split('-');
  if (parts.length < 2) return s;
  var months = ['January','February','March','April','May','June',
                'July','August','September','October','November','December'];
  var monthIdx = parseInt(parts[1]) - 1;
  return (months[monthIdx] || parts[1]) + ' ' + parts[0];
}

function respond(success, data, error) {
  var payload = success
    ? { success: true, data: data }
    : { success: false, error: error || 'Unknown error' };
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function loadConfig() {
  var rows = sheetToObjects(SHEET.CONFIG);
  var cfg  = {};
  rows.forEach(function(r) { cfg[r.key] = r.value; });
  return cfg;
}

function validateAdmin(body) {
  var cfg = loadConfig();
  return String(body.admin_pin) === String(cfg.admin_pin);
}

function validateTenant(body) {
  var tenants = sheetToObjects(SHEET.TENANTS);
  return tenants.find(function(t) {
    return String(t.login_code).toUpperCase() === String(body.login_code).toUpperCase()
        && t.status === 'active';
  }) || null;
}

// ---------------------------------------------------------------------------
// ACTION: getConfig
// ---------------------------------------------------------------------------
function getConfig(body) {
  var cfg = loadConfig();
  return respond(true, cfg);
}

// ---------------------------------------------------------------------------
// ACTION: getAllTenants
// ---------------------------------------------------------------------------
function getAllTenants(body) {
  if (!validateAdmin(body)) return respond(false, null, 'Unauthorized');
  var tenants = sheetToObjects(SHEET.TENANTS);
  return respond(true, tenants);
}

// ---------------------------------------------------------------------------
// ACTION: getTenantInfo
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

  var credit = getTenantCredit(tenant.tenant_id);

  return respond(true, { tenant: tenant, billing: billing, last_payment: lastPayment, credit: credit });
}

// ---------------------------------------------------------------------------
// ACTION: getBillingHistory
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

  var rawPayments = getSheetData(SHEET.PAYMENTS);
  var rawReceipts = getSheetData(SHEET.RECEIPTS);
  var tz2 = Session.getScriptTimeZone();
  function fmtD(v) {
    if (!v) return '';
    if (v instanceof Date) return Utilities.formatDate(v, tz2, 'yyyy-MM-dd');
    return String(v);
  }

  var rows = sheetToObjects(SHEET.PAYMENTS, rawPayments).filter(function(p) {
    return String(p.tenant_id) === String(tenantId);
  }).sort(function(a, b) {
    var da = fmtD(a.date), db = fmtD(b.date);
    return da < db ? 1 : -1;
  });

  rows = rows.map(function(p) {
    p.date          = fmtD(p.date);
    p.approved_date = fmtD(p.approved_date);
    return p;
  });

  var receipts = sheetToObjects(SHEET.RECEIPTS, rawReceipts);
  rows = rows.map(function(p) {
    var receipt = receipts.find(function(r) {
      return String(r.payment_id) === String(p.payment_id);
    });
    p.receipt    = receipt ? JSON.parse(receipt.receipt_snapshot || '{}') : null;
    p.receipt_no = receipt ? receipt.receipt_no : null;
    return p;
  });

  return respond(true, rows);
}

// ---------------------------------------------------------------------------
// ACTION: getLedger
// ---------------------------------------------------------------------------
function getLedger(body) {
  if (!validateAdmin(body)) return respond(false, null, 'Unauthorized');

  var rawTenants  = getSheetData(SHEET.TENANTS);
  var rawBillings = getSheetData(SHEET.BILLING);
  var rawPayments = getSheetData(SHEET.PAYMENTS);

  var tenants  = sheetToObjects(SHEET.TENANTS,  rawTenants).filter(function(t) {
    return t.status === 'active' || t.status === 'moved-out';
  });
  var billings = sheetToObjects(SHEET.BILLING,  rawBillings);
  var payments = sheetToObjects(SHEET.PAYMENTS, rawPayments).filter(function(p) {
    return p.status === 'approved';
  });

  var ledger = tenants.map(function(tenant) {
    var tid = String(tenant.tenant_id);

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

  var summary = {
    total_outstanding:    ledger.reduce(function(s,t){ return s + t.outstanding; }, 0),
    tenants_with_balance: ledger.filter(function(t){ return t.outstanding > 0; }).length,
    tenants_fully_paid:   ledger.filter(function(t){ return t.outstanding <= 0; }).length
  };

  return respond(true, { summary: summary, ledger: ledger });
}

// ---------------------------------------------------------------------------
// ACTION: getDashboardData
// ---------------------------------------------------------------------------
function dateToYYYYMM(val) {
  if (!val) return '';
  if (val instanceof Date) {
    var y = val.getFullYear();
    var m = String(val.getMonth() + 1).padStart(2, '0');
    return y + '-' + m;
  }
  var s = String(val).trim();
  if (/^\d{4}-\d{2}/.test(s)) return s.substr(0, 7);
  if (/^\d{1,2}\/\d{1,2}\/\d{4}/.test(s)) {
    var parts = s.split('/');
    return parts[2] + '-' + String(parts[0]).padStart(2, '0');
  }
  return '';
}

function getDashboardData(body) {
  if (!validateAdmin(body)) return respond(false, null, 'Unauthorized');

  var cfg      = loadConfig();
  var month    = body.month || currentMonth();

  var rawTenants  = getSheetData(SHEET.TENANTS);
  var rawBillings = getSheetData(SHEET.BILLING);
  var rawPayments = getSheetData(SHEET.PAYMENTS);

  var tenants  = sheetToObjects(SHEET.TENANTS,  rawTenants);
  var billings = sheetToObjects(SHEET.BILLING,  rawBillings);
  var payments = sheetToObjects(SHEET.PAYMENTS, rawPayments);

  var active   = tenants.filter(function(t){ return t.status === 'active'; });
  var occupancy = active.length;

  var approvedPayments = payments.filter(function(p) {
    return String(p.status).toLowerCase() === 'approved';
  });

  var collectedByPaymentDate = approvedPayments
    .filter(function(p) { return dateToYYYYMM(p.date) === String(month); })
    .reduce(function(s, p) { return s + (parseFloat(p.amount) || 0); }, 0);

  var collectedByLoggedDate = approvedPayments
    .filter(function(p) { return dateToYYYYMM(p.approved_date) === String(month); })
    .reduce(function(s, p) { return s + (parseFloat(p.amount) || 0); }, 0);

  var collected = collectedByPaymentDate;

  var pending = payments.filter(function(p) {
    return String(p.status).toLowerCase() === 'pending';
  });

  var now = currentMonth();
  var overdue = billings.filter(function(b) {
    return b.month < now
        && (b.status === 'unpaid' || b.status === 'partial')
        && tenants.find(function(t) {
             return String(t.tenant_id) === String(b.tenant_id) && t.status === 'active';
           });
  });
  var overdueIds = [];
  overdue.forEach(function(b) {
    if (overdueIds.indexOf(b.tenant_id) === -1) overdueIds.push(b.tenant_id);
  });

  var tz = Session.getScriptTimeZone();
  function fmtDate(v) {
    if (!v) return '';
    if (v instanceof Date) return Utilities.formatDate(v, tz, 'yyyy-MM-dd');
    return String(v);
  }

  var recent = payments
    .slice()
    .sort(function(a, b) {
      var da = fmtDate(a.date);
      var db = fmtDate(b.date);
      return da < db ? 1 : da > db ? -1 : 0;
    })
    .slice(0, 10)
    .map(function(p) {
      var t = tenants.find(function(t) { return String(t.tenant_id) === String(p.tenant_id); });
      return {
        payment_id:    p.payment_id,
        tenant_name:   t ? t.name : 'Unknown',
        tenant_code:   t ? t.login_code : '',
        unit:          t ? t.unit : '',
        date:          fmtDate(p.date),
        amount:        p.amount,
        method:        p.method,
        reference_no:  p.reference_no  || '',
        proof_url:     p.proof_url     || '',
        status:        p.status,
        note:          p.note          || '',
        approved_by:   p.approved_by   || '',
        approved_date: fmtDate(p.approved_date),
        billing_id:    p.billing_id    || ''
      };
    });

  return respond(true, {
    month:                    month,
    collected_month:          collected,
    collected_by_payment_date: collectedByPaymentDate,
    collected_by_logged_date:  collectedByLoggedDate,
    pending_count:            pending.length,
    overdue_count:            overdueIds.length,
    occupancy:                occupancy,
    recent_payments:          recent
  });
}

// ---------------------------------------------------------------------------
// ACTION: getPendingPayments
// ---------------------------------------------------------------------------
function getPendingPayments(body) {
  if (!validateAdmin(body)) return respond(false, null, 'Unauthorized');

  var rawTenants  = getSheetData(SHEET.TENANTS);
  var rawPayments = getSheetData(SHEET.PAYMENTS);

  var tenants  = sheetToObjects(SHEET.TENANTS,  rawTenants);
  var payments = sheetToObjects(SHEET.PAYMENTS, rawPayments)
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
// ACTION: getAllPayments
// FIX: now joins receipt_no from the Receipts sheet so the frontend
// can render "Receipt #1001" buttons without a second fetch.
// ---------------------------------------------------------------------------
function getAllPayments(body) {
  if (!validateAdmin(body)) return respond(false, null, 'Unauthorized');

  var rawTenants  = getSheetData(SHEET.TENANTS);
  var rawPayments = getSheetData(SHEET.PAYMENTS);
  var rawReceipts = getSheetData(SHEET.RECEIPTS);

  var tenants  = sheetToObjects(SHEET.TENANTS,  rawTenants);
  var payments = sheetToObjects(SHEET.PAYMENTS, rawPayments);
  var receipts = sheetToObjects(SHEET.RECEIPTS, rawReceipts);

  var tz = Session.getScriptTimeZone();
  function fmtDate(v) {
    if (!v) return '';
    if (v instanceof Date) return Utilities.formatDate(v, tz, 'yyyy-MM-dd');
    return String(v);
  }

  var result = payments
    .sort(function(a, b) {
      var da = fmtDate(a.date);
      var db = fmtDate(b.date);
      return da < db ? 1 : da > db ? -1 : 0;
    })
    .map(function(p) {
      var t = tenants.find(function(t) {
        return String(t.tenant_id) === String(p.tenant_id);
      });
      // FIX: join receipt_no so the Payment History tab can show receipt buttons
      var receipt = receipts.find(function(r) {
        return String(r.payment_id) === String(p.payment_id);
      });
      return {
        payment_id:    p.payment_id,
        tenant_id:     p.tenant_id,
        tenant_name:   t ? t.name       : 'Unknown',
        tenant_code:   t ? t.login_code : '',
        unit:          t ? t.unit       : '',
        billing_id:    p.billing_id    || '',
        date:          fmtDate(p.date),
        amount:        parseFloat(p.amount)  || 0,
        method:        p.method        || '',
        reference_no:  p.reference_no  || '',
        proof_url:     p.proof_url     || '',
        status:        p.status        || '',
        note:          p.note          || '',
        approved_by:   p.approved_by   || '',
        approved_date: fmtDate(p.approved_date),
        receipt_no:    receipt ? receipt.receipt_no : null
      };
    });

  return respond(true, result);
}

// ---------------------------------------------------------------------------
// ACTION: submitPayment
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
// FIX: captures sendReceiptEmail return value and surfaces emailSent in response.
// ---------------------------------------------------------------------------
function logPayment(body) {
  if (!validateAdmin(body)) return respond(false, null, 'Unauthorized');

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var cfg    = loadConfig();
    var rawTenants = getSheetData(SHEET.TENANTS);
    var tenant = sheetToObjects(SHEET.TENANTS, rawTenants).find(function(t){
      return String(t.tenant_id) === String(body.tenant_id);
    });
    if (!tenant) return respond(false, null, 'Tenant not found');

    var paymentId = genId('PAY');
    var payDate   = body.date || today();

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

    var billing = updateBillingAfterPayment(body.billing_id, record.amount, cfg);
    var receipt = buildAndSaveReceipt(paymentId, tenant, billing, record, cfg);

    // FIX: capture email result instead of fire-and-forget
    var emailResult = { emailSent: false, reason: 'no_email' };
    if (tenant.email) {
      emailResult = sendReceiptEmail(tenant, receipt, cfg);
    }

    return respond(true, {
      payment_id: paymentId,
      receipt:    receipt,
      emailSent:  emailResult.emailSent,
      emailNote:  emailResult.reason || ''
    });
  } finally {
    lock.releaseLock();
  }
}

// ---------------------------------------------------------------------------
// INTERNAL: getTenantCredit
// ---------------------------------------------------------------------------
function getTenantCredit(tenantId, rawLedger) {
  var rows = rawLedger
    ? sheetToObjects(SHEET.LEDGER, rawLedger)
    : sheetToObjects(SHEET.LEDGER);
  var total = 0;
  rows.forEach(function(r) {
    if (String(r.tenant_id) === String(tenantId) &&
        r.type === 'Credit' &&
        (!r.spent || String(r.spent).toLowerCase() === 'false' || r.spent === false)) {
      total += parseFloat(r.amount) || 0;
    }
  });
  return total;
}

// ---------------------------------------------------------------------------
// ACTION: logFlexiblePayment
// ---------------------------------------------------------------------------
function logFlexiblePayment(body) {
  if (!validateAdmin(body)) return respond(false, null, 'Unauthorized');

  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var cfg    = loadConfig();
    var amount = parseFloat(body.amount) || 0;
    if (amount <= 0) return respond(false, null, 'Amount must be greater than zero');

    var rawTenants = getSheetData(SHEET.TENANTS);
    var tenant = sheetToObjects(SHEET.TENANTS, rawTenants).find(function(t) {
      return String(t.tenant_id) === String(body.tenant_id);
    });
    if (!tenant) return respond(false, null, 'Tenant not found');

    var selectedPeriods = body.selected_periods || [];
    var remaining = amount;
    var receipts  = [];

    selectedPeriods.forEach(function(billingId) {
      if (remaining <= 0) return;

      var rawBillings = getSheetData(SHEET.BILLING);
      var billings    = sheetToObjects(SHEET.BILLING, rawBillings);
      var billing     = billings.find(function(b) {
        return String(b.billing_id) === String(billingId);
      });
      if (!billing) return;

      var balance = parseFloat(billing.balance) || 0;
      if (balance <= 0) return;

      var payForThis = Math.min(remaining, balance);
      remaining -= payForThis;

      var paymentId = genId('PAY');
      var payDate   = body.date || today();
      var record = {
        payment_id:    paymentId,
        tenant_id:     tenant.tenant_id,
        billing_id:    billingId,
        date:          payDate,
        amount:        payForThis,
        method:        body.method || '',
        reference_no:  body.reference_no || '',
        proof_url:     '',
        status:        'approved',
        note:          body.note || 'Admin logged (flexible)',
        approved_by:   'admin',
        approved_date: today()
      };
      appendRow(SHEET.PAYMENTS, record);

      var updatedBilling = updateBillingAfterPayment(billingId, payForThis, cfg);
      var receipt = buildAndSaveReceipt(paymentId, tenant, updatedBilling, record, cfg);
      receipts.push(receipt);
    });

    var creditWritten = 0;
    if (remaining > 0) {
      var ledgerSheet = getSheet(SHEET.LEDGER);
      if (!ledgerSheet) {
        getSpreadsheet().insertSheet(SHEET.LEDGER);
        ledgerSheet = getSheet(SHEET.LEDGER);
        ledgerSheet.appendRow(['ledger_id','tenant_id','date','type','amount','note','spent']);
      }
      var ledgerId = genId('LDG');
      ledgerSheet.appendRow([
        ledgerId,
        tenant.tenant_id,
        today(),
        'Credit',
        remaining,
        'Advance payment',
        false
      ]);
      creditWritten = remaining;
    }

    var emailResult = { emailSent: false, reason: 'no_receipts' };
    if (receipts.length > 0) {
      emailResult = sendReceiptEmail(tenant, receipts[receipts.length - 1], cfg);
    }

    return respond(true, {
      tenant_id:      tenant.tenant_id,
      amount_applied: amount - remaining,
      credit_written: creditWritten,
      receipts:       receipts,
      emailSent:      emailResult.emailSent,
      emailNote:      emailResult.reason || ''
    });

  } finally {
    lock.releaseLock();
  }
}

// ---------------------------------------------------------------------------
// ACTION: getTenantCreditBalance
// ---------------------------------------------------------------------------
function getTenantCreditBalance(body) {
  var tenant = validateTenant(body);
  if (!tenant) return respond(false, null, 'Invalid tenant code');
  var credit = getTenantCredit(tenant.tenant_id);
  return respond(true, { credit: credit });
}

// ---------------------------------------------------------------------------
// ACTION: approvePayment
// FIX: captures sendReceiptEmail return value and surfaces emailSent in response.
// ---------------------------------------------------------------------------
function approvePayment(body) {
  if (!validateAdmin(body)) return respond(false, null, 'Unauthorized');

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var cfg = loadConfig();

    var rawPayments = getSheetData(SHEET.PAYMENTS);
    var rawTenants  = getSheetData(SHEET.TENANTS);

    var rowIdx = findRowIndex(SHEET.PAYMENTS, function(p){
      return String(p.payment_id) === String(body.payment_id);
    }, rawPayments);
    if (rowIdx === -1) return respond(false, null, 'Payment not found');

    var payments = sheetToObjects(SHEET.PAYMENTS, rawPayments);
    var payment  = payments.find(function(p){
      return String(p.payment_id) === String(body.payment_id);
    });
    if (payment.status !== 'pending') return respond(false, null, 'Payment is not pending');

    payment.status        = 'approved';
    payment.approved_by   = 'admin';
    payment.approved_date = today();
    payment.note          = body.note || '';
    updateRow(SHEET.PAYMENTS, rowIdx, payment);

    var tenant = sheetToObjects(SHEET.TENANTS, rawTenants).find(function(t){
      return String(t.tenant_id) === String(payment.tenant_id);
    });
    if (!tenant) return respond(false, null, 'Tenant not found');

    var billing = updateBillingAfterPayment(payment.billing_id, parseFloat(payment.amount)||0, cfg);
    var receipt = buildAndSaveReceipt(payment.payment_id, tenant, billing, payment, cfg);

    // FIX: capture email result
    var emailResult = { emailSent: false, reason: 'no_email' };
    if (tenant.email) {
      emailResult = sendReceiptEmail(tenant, receipt, cfg);
    }

    return respond(true, {
      payment:   payment,
      receipt:   receipt,
      emailSent: emailResult.emailSent,
      emailNote: emailResult.reason || ''
    });
  } finally {
    lock.releaseLock();
  }
}

// ---------------------------------------------------------------------------
// ACTION: rejectPayment
// ---------------------------------------------------------------------------
function rejectPayment(body) {
  if (!validateAdmin(body)) return respond(false, null, 'Unauthorized');

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var rawPayments = getSheetData(SHEET.PAYMENTS);
    var rowIdx = findRowIndex(SHEET.PAYMENTS, function(p){
      return String(p.payment_id) === String(body.payment_id);
    }, rawPayments);
    if (rowIdx === -1) return respond(false, null, 'Payment not found');

    var payments = sheetToObjects(SHEET.PAYMENTS, rawPayments);
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
// ---------------------------------------------------------------------------
function addTenant(body) {
  if (!validateAdmin(body)) return respond(false, null, 'Unauthorized');

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var cfg     = loadConfig();
    var tenants = sheetToObjects(SHEET.TENANTS);

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
// ---------------------------------------------------------------------------
function updateTenant(body) {
  if (!validateAdmin(body)) return respond(false, null, 'Unauthorized');

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var rawTenants = getSheetData(SHEET.TENANTS);
    var rowIdx = findRowIndex(SHEET.TENANTS, function(t){
      return String(t.tenant_id) === String(body.tenant_id);
    }, rawTenants);
    if (rowIdx === -1) return respond(false, null, 'Tenant not found');

    var tenants = sheetToObjects(SHEET.TENANTS, rawTenants);
    var tenant  = tenants.find(function(t){
      return String(t.tenant_id) === String(body.tenant_id);
    });

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
// ---------------------------------------------------------------------------
function enterMeterReadings(body) {
  if (!validateAdmin(body)) return respond(false, null, 'Unauthorized');

  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var cfg     = loadConfig();
    var month   = body.month || currentMonth();
    var entries = body.readings || [];

    var electricRate = parseFloat(cfg.electric_rate) || 0;
    var waterRate    = parseFloat(cfg.water_rate)    || 0;
    var dueDay       = parseInt(cfg.due_day)         || 5;
    var lateFeeAmt   = parseFloat(cfg.late_fee_amount) || 0;
    var lateFeeType  = cfg.late_fee_type || 'fixed';

    var rawReadings = getSheetData(SHEET.READINGS);
    var rawBillings = getSheetData(SHEET.BILLING);
    var rawTenants  = getSheetData(SHEET.TENANTS);

    var allReadings = sheetToObjects(SHEET.READINGS, rawReadings);
    var allBillings = sheetToObjects(SHEET.BILLING,  rawBillings);
    var allTenants  = sheetToObjects(SHEET.TENANTS,  rawTenants);

    var results = [];

    entries.forEach(function(entry) {
      var tid     = String(entry.tenant_id);
      var tenant  = allTenants.find(function(t){ return String(t.tenant_id)===tid; });
      if (!tenant) return;

      var elecCurr  = parseFloat(entry.elec_curr)  || 0;
      var waterCurr = parseFloat(entry.water_curr) || 0;

      var prevReadings = allReadings
        .filter(function(r){ return String(r.tenant_id)===tid && r.month < month; })
        .sort(function(a,b){ return a.month < b.month ? 1 : -1; });

      var elecPrev  = prevReadings.length ? (parseFloat(prevReadings[0].elec_curr)  || 0) : 0;
      var waterPrev = prevReadings.length ? (parseFloat(prevReadings[0].water_curr) || 0) : 0;

      var elecConsumption  = Math.max(0, elecCurr  - elecPrev);
      var waterConsumption = Math.max(0, waterCurr - waterPrev);
      var elecBill         = elecConsumption  * electricRate;
      var waterBill        = waterConsumption * waterRate;

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
      }, rawReadings);
      if (existingReadingIdx === -1) {
        appendRow(SHEET.READINGS, readingRow);
        rawReadings = getSheetData(SHEET.READINGS);
      } else {
        readingRow.reading_id = allReadings.find(function(r){
          return String(r.tenant_id)===tid && String(r.month)===month;
        }).reading_id;
        updateRow(SHEET.READINGS, existingReadingIdx, readingRow);
      }

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
      }, rawBillings);
      if (existingBillingIdx === -1) {
        appendRow(SHEET.BILLING, billingRow);
        rawBillings = getSheetData(SHEET.BILLING);
      } else {
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
// ---------------------------------------------------------------------------
function generateReceipt(body) {
  var cfg = loadConfig();
  var authed = false;
  if (body.login_code) {
    var tenant = validateTenant(body);
    authed = !!tenant;
  } else {
    authed = validateAdmin(body);
  }
  if (!authed) return respond(false, null, 'Unauthorized');

  var rawReceipts = getSheetData(SHEET.RECEIPTS);
  var receipts = sheetToObjects(SHEET.RECEIPTS, rawReceipts);
  var existing = receipts.find(function(r){
    return String(r.payment_id) === String(body.payment_id);
  });
  if (existing) {
    return respond(true, {
      receipt_no: existing.receipt_no,
      receipt:    JSON.parse(existing.receipt_snapshot || '{}')
    });
  }

  var rawPayments = getSheetData(SHEET.PAYMENTS);
  var payments = sheetToObjects(SHEET.PAYMENTS, rawPayments);
  var payment  = payments.find(function(p){
    return String(p.payment_id) === String(body.payment_id);
  });
  if (!payment) return respond(false, null, 'Payment not found');

  var rawTenants = getSheetData(SHEET.TENANTS);
  var tenants = sheetToObjects(SHEET.TENANTS, rawTenants);
  var tenant2 = tenants.find(function(t){
    return String(t.tenant_id) === String(payment.tenant_id);
  });

  var rawBillings = getSheetData(SHEET.BILLING);
  var billings = sheetToObjects(SHEET.BILLING, rawBillings);
  var billing  = billings.find(function(b){
    return String(b.billing_id) === String(payment.billing_id);
  }) || null;

  var receipt = buildAndSaveReceipt(payment.payment_id, tenant2, billing, payment, cfg);
  return respond(true, { receipt_no: receipt.receipt_no, receipt: receipt });
}

// ---------------------------------------------------------------------------
// ACTION: resendReceiptEmail
// ---------------------------------------------------------------------------
function resendReceiptEmail(body) {
  if (!validateAdmin(body)) return respond(false, null, 'Unauthorized');

  var cfg = loadConfig();

  var rawReceipts = getSheetData(SHEET.RECEIPTS);
  var receipts    = sheetToObjects(SHEET.RECEIPTS, rawReceipts);
  var existing    = receipts.find(function(r) {
    return String(r.payment_id) === String(body.payment_id);
  });
  if (!existing) return respond(false, null, 'Receipt not found for this payment');

  var receipt = JSON.parse(existing.receipt_snapshot || '{}');

  var rawTenants = getSheetData(SHEET.TENANTS);
  var tenants    = sheetToObjects(SHEET.TENANTS, rawTenants);
  var tenant     = tenants.find(function(t) {
    return String(t.tenant_id) === String(existing.tenant_id);
  });

  if (!tenant) return respond(false, null, 'Tenant not found');

  var emailResult = sendReceiptEmail(tenant, receipt, cfg);
  return respond(true, {
    emailSent: emailResult.emailSent,
    emailNote: emailResult.reason || '',
    sentTo:    tenant.email || ''
  });
}

// ---------------------------------------------------------------------------
// INTERNAL: updateBillingAfterPayment
// ---------------------------------------------------------------------------
function updateBillingAfterPayment(billingId, amount, cfg) {
  if (!billingId) return null;

  var rawBillings = getSheetData(SHEET.BILLING);

  var rowIdx = findRowIndex(SHEET.BILLING, function(b){
    return String(b.billing_id) === String(billingId);
  }, rawBillings);
  if (rowIdx === -1) return null;

  var billings = sheetToObjects(SHEET.BILLING, rawBillings);
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
// ACTION: getCollectionStats
// ---------------------------------------------------------------------------
function getCollectionStats(body) {
  if (!validateAdmin(body)) return respond(false, null, 'Unauthorized');

  var mode = body.mode || 'monthly';
  var tz   = Session.getScriptTimeZone();

  var rawPayments = getSheetData(SHEET.PAYMENTS);
  var rawBillings = getSheetData(SHEET.BILLING);
  var payments    = sheetToObjects(SHEET.PAYMENTS, rawPayments);
  var billings    = sheetToObjects(SHEET.BILLING,  rawBillings);

  function bucketKey(date, m) {
    if (!(date instanceof Date)) {
      date = new Date(date);
    }
    if (m === 'daily')   return Utilities.formatDate(date, tz, 'yyyy-MM-dd');
    if (m === 'weekly')  return Utilities.formatDate(date, tz, 'yyyy-') + 'W' + getWeekNumber(date);
    return Utilities.formatDate(date, tz, 'yyyy-MM');
  }

  function getWeekNumber(d) {
    var onejan = new Date(d.getFullYear(), 0, 1);
    return Math.ceil((((d - onejan) / 86400000) + onejan.getDay() + 1) / 7);
  }

  var now    = new Date();
  var labels = [];
  var keys   = [];

  if (mode === 'daily') {
    for (var i = 6; i >= 0; i--) {
      var d = new Date(now);
      d.setDate(d.getDate() - i);
      var k = Utilities.formatDate(d, tz, 'yyyy-MM-dd');
      keys.push(k);
      labels.push(Utilities.formatDate(d, tz, 'MMM d'));
    }
  } else if (mode === 'weekly') {
    for (var i = 7; i >= 0; i--) {
      var d = new Date(now);
      d.setDate(d.getDate() - (i * 7));
      var k = bucketKey(d, 'weekly');
      if (keys.indexOf(k) === -1) {
        keys.push(k);
        labels.push('W' + getWeekNumber(d) + ' ' + d.getFullYear());
      }
    }
  } else {
    for (var i = 5; i >= 0; i--) {
      var d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      var k = Utilities.formatDate(d, tz, 'yyyy-MM');
      keys.push(k);
      labels.push(Utilities.formatDate(d, tz, 'MMM yyyy'));
    }
  }

  var collected = {};
  keys.forEach(function(k) { collected[k] = 0; });

  payments.forEach(function(p) {
    if (String(p.status).toLowerCase() !== 'approved') return;
    var pDate = p.date instanceof Date ? p.date : new Date(p.date);
    if (isNaN(pDate.getTime())) return;
    var k = bucketKey(pDate, mode);
    if (collected.hasOwnProperty(k)) {
      collected[k] += parseFloat(p.amount) || 0;
    }
  });

  var billed = {};
  keys.forEach(function(k) { billed[k] = 0; });

  billings.forEach(function(b) {
    var bMonth = b.month instanceof Date
      ? Utilities.formatDate(b.month, tz, 'yyyy-MM')
      : String(b.month || '').substr(0, 7);

    if (mode === 'monthly') {
      if (billed.hasOwnProperty(bMonth)) {
        billed[bMonth] += parseFloat(b.total_bill) || 0;
      }
    } else {
      var parts = bMonth.split('-');
      if (parts.length < 2) return;
      var bd = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, 1);
      var k  = bucketKey(bd, mode);
      if (billed.hasOwnProperty(k)) {
        billed[k] += parseFloat(b.total_bill) || 0;
      }
    }
  });

  var result = keys.map(function(k, i) {
    return {
      key:       k,
      label:     labels[i],
      collected: collected[k],
      billed:    billed[k]
    };
  });

  return respond(true, { mode: mode, periods: result });
}

// ---------------------------------------------------------------------------
// ACTION: triggerRemindersNow
// ---------------------------------------------------------------------------
function triggerRemindersNow(body) {
  if (!validateAdmin(body)) return respond(false, null, 'Unauthorized');
  var summary = sendMonthlyBillingReminders();
  return respond(true, summary);
}

// ---------------------------------------------------------------------------
// sendMonthlyBillingReminders
// ---------------------------------------------------------------------------
function sendMonthlyBillingReminders() {
  var cfg = loadConfig();

  if (String(cfg.reminder_enabled).toLowerCase() === 'false') {
    Logger.log('sendMonthlyBillingReminders: reminder_enabled is false — skipping.');
    return { sent: 0, skipped: 0, failed: 0, disabled: true };
  }

  var month        = currentMonth();
  var propertyName = cfg.property_name || 'Property';
  var dueDay       = parseInt(cfg.due_day) || 5;
  var dueDate      = month + '-' + String(dueDay).padStart(2, '0');

  var tz = Session.getScriptTimeZone();
  function fmtDate(v) {
    if (!v) return '';
    if (v instanceof Date) return Utilities.formatDate(v, tz, 'yyyy-MM-dd');
    return String(v);
  }

  var rawTenants  = getSheetData(SHEET.TENANTS);
  var rawBillings = getSheetData(SHEET.BILLING);
  var tenants     = sheetToObjects(SHEET.TENANTS,  rawTenants);
  var billings    = sheetToObjects(SHEET.BILLING,  rawBillings);

  var activeTenants = tenants.filter(function(t) {
    return String(t.status).toLowerCase() === 'active';
  });

  var sent    = 0;
  var skipped = 0;
  var failed  = 0;

  activeTenants.forEach(function(tenant) {
    var billing = billings.find(function(b) {
      return String(b.tenant_id) === String(tenant.tenant_id)
          && String(b.month)     === String(month);
    });

    if (!billing) { skipped++; return; }

    var billingStatus = String(billing.status).toLowerCase();

    if (billingStatus === 'paid') { skipped++; return; }
    if (billingStatus !== 'unpaid' && billingStatus !== 'partial') { skipped++; return; }
    if (!tenant.email || String(tenant.email).trim() === '') { skipped++; return; }

    var balance    = parseFloat(billing.balance)    || 0;
    var totalBill  = parseFloat(billing.total_bill) || 0;
    var amountPaid = parseFloat(billing.amount_paid)|| 0;

    var pesoFmt = function(n) {
      return '₱' + parseFloat(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    };

    var subject = propertyName + ' — Billing Reminder for ' + formatMonthLabel(month);

    var partialNote = billingStatus === 'partial'
      ? '<p style="margin:8px 0 0;font-size:13px;color:#555;">You have already paid ' + pesoFmt(amountPaid) + '. The remaining balance is <strong>' + pesoFmt(balance) + '</strong>.</p>'
      : '';

    var html = [
      '<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#333;">',
      '<div style="background:#0e7c61;padding:24px 32px;border-radius:8px 8px 0 0;">',
      '<h1 style="margin:0;color:#ffffff;font-size:22px;">' + propertyName + '</h1>',
      '<p style="margin:4px 0 0;color:#b2dfcd;font-size:14px;">Monthly Billing Reminder</p>',
      '</div>',
      '<div style="padding:24px 32px;">',
      '<p style="font-size:15px;">Hi <strong>' + tenant.name + '</strong>,</p>',
      '<p style="font-size:14px;color:#555;">This is a friendly reminder that your bill for <strong>' + formatMonthLabel(month) + '</strong> is currently <strong style="color:' + (billingStatus === 'partial' ? '#e67e22' : '#c0392b') + '">' + billingStatus + '</strong>.</p>',
      '<div style="background:#f9f6f0;border-radius:6px;padding:16px 20px;margin:16px 0;">',
      '<table style="width:100%;font-size:14px;border-collapse:collapse;">',
      '<tr><td style="padding:4px 0;color:#777;">Tenant</td><td style="padding:4px 0;font-weight:600;text-align:right">' + tenant.name + '</td></tr>',
      '<tr><td style="padding:4px 0;color:#777;">Unit</td><td style="padding:4px 0;font-weight:600;text-align:right">' + tenant.unit + '</td></tr>',
      '<tr><td style="padding:4px 0;color:#777;">Billing period</td><td style="padding:4px 0;font-weight:600;text-align:right">' + formatMonthLabel(month) + '</td></tr>',
      '<tr><td style="padding:4px 0;color:#777;">Total bill</td><td style="padding:4px 0;font-weight:600;text-align:right">' + pesoFmt(totalBill) + '</td></tr>',
      '<tr style="border-top:1px solid #ddd;"><td style="padding:8px 0 4px;font-weight:700;">Balance due</td><td style="padding:8px 0 4px;font-weight:700;font-size:16px;color:#c0392b;text-align:right">' + pesoFmt(balance) + '</td></tr>',
      '</table>',
      partialNote,
      '</div>',
      '<p style="font-size:14px;color:#555;">Please submit your payment through the Tenant Portal on or before <strong>' + dueDate + '</strong>.</p>',
      '<p style="font-size:12px;color:#999;margin-top:24px;">For concerns, please contact your property admin directly.</p>',
      '</div>',
      '<div style="background:#f0f0eb;padding:14px 32px;border-radius:0 0 8px 8px;text-align:center;font-size:12px;color:#888;">' + propertyName + ' &mdash; Automated Billing Reminder</div>',
      '</div>'
    ].join('');

    try {
      MailApp.sendEmail({ to: tenant.email, subject: subject, htmlBody: html });
      Logger.log('sendMonthlyBillingReminders: Sent to ' + tenant.email + ' (' + tenant.name + ')');
      sent++;
    } catch (e) {
      Logger.log('sendMonthlyBillingReminders: FAILED for ' + tenant.name + ' — ' + e.message);
      failed++;
    }
  });

  Logger.log('sendMonthlyBillingReminders: Done — sent=' + sent + ' skipped=' + skipped + ' failed=' + failed);
  return { sent: sent, skipped: skipped, failed: failed };
}

function ordinalGAS(n) {
  var s   = ['th','st','nd','rd'];
  var v   = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// ---------------------------------------------------------------------------
// INTERNAL: sendReceiptEmail
// FIX: now returns { emailSent, reason } so callers can surface failures.
// ---------------------------------------------------------------------------
function sendReceiptEmail(tenant, receipt, cfg) {
  var propertyName = cfg.property_name || 'Property';
  var subject = propertyName + ' — Payment Receipt #' + receipt.receipt_no;

  var pesoFmt = function(n) { return '₱' + parseFloat(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g,','); };

  var html = [
    '<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#333;">',
    '<div style="background:#0e7c61;padding:24px 32px;border-radius:8px 8px 0 0;">',
    '<h1 style="margin:0;color:#ffffff;font-size:22px;">' + propertyName + '</h1>',
    '<p style="margin:4px 0 0;color:#b2dfcd;font-size:14px;">Official Payment Receipt</p>',
    '</div>',
    '<div style="background:#f9f6f0;padding:20px 32px;border-bottom:1px solid #e0d9ce;">',
    '<table style="width:100%;font-size:14px;"><tr>',
    '<td><strong>Receipt No:</strong> #' + receipt.receipt_no + '</td>',
    '<td style="text-align:right"><strong>Date:</strong> ' + receipt.generated_date + '</td>',
    '</tr></table>',
    '<p style="margin:8px 0 0;font-size:14px;"><strong>Tenant:</strong> ' + receipt.tenant_name + ' &nbsp;|&nbsp; <strong>Unit:</strong> ' + receipt.unit + '</p>',
    '<p style="margin:4px 0 0;font-size:14px;"><strong>Billing Period:</strong> ' + receipt.billing_period + '</p>',
    '</div>',
    '<div style="padding:24px 32px;">',
    '<h3 style="margin:0 0 12px;font-size:15px;color:#0e7c61;">Billing Breakdown</h3>',
    '<table style="width:100%;border-collapse:collapse;font-size:14px;">',
    '<tr style="background:#f0f0eb;"><td style="padding:8px 12px;border:1px solid #ddd;"><strong>Item</strong></td><td style="padding:8px 12px;border:1px solid #ddd;text-align:right"><strong>Amount</strong></td></tr>',
    '<tr><td style="padding:8px 12px;border:1px solid #ddd;">Monthly Rent</td><td style="padding:8px 12px;border:1px solid #ddd;text-align:right">' + pesoFmt(receipt.rent) + '</td></tr>',
    '<tr><td style="padding:8px 12px;border:1px solid #ddd;">Electric<br><small style="color:#777;">Prev: ' + receipt.elec_prev + ' kWh &rarr; Curr: ' + receipt.elec_curr + ' kWh &nbsp;(' + receipt.elec_kwh + ' kWh used @ ₱' + receipt.electric_rate + '/kWh)</small></td><td style="padding:8px 12px;border:1px solid #ddd;text-align:right">' + pesoFmt(receipt.elec_bill) + '</td></tr>',
    '<tr><td style="padding:8px 12px;border:1px solid #ddd;">Water<br><small style="color:#777;">Prev: ' + receipt.water_prev + ' m³ &rarr; Curr: ' + receipt.water_curr + ' m³ &nbsp;(' + receipt.water_cbm + ' m³ used @ ₱' + receipt.water_rate + '/m³)</small></td><td style="padding:8px 12px;border:1px solid #ddd;text-align:right">' + pesoFmt(receipt.water_bill) + '</td></tr>',
    receipt.late_fee > 0 ? '<tr><td style="padding:8px 12px;border:1px solid #ddd;color:#c0392b;">Late Fee</td><td style="padding:8px 12px;border:1px solid #ddd;text-align:right;color:#c0392b;">' + pesoFmt(receipt.late_fee) + '</td></tr>' : '',
    '<tr style="background:#f0f0eb;font-weight:bold;"><td style="padding:8px 12px;border:1px solid #ddd;">Total Bill</td><td style="padding:8px 12px;border:1px solid #ddd;text-align:right">' + pesoFmt(receipt.total_bill) + '</td></tr>',
    '</table>',
    '<div style="margin-top:20px;padding:16px;background:#eaf4f0;border-radius:6px;">',
    '<p style="margin:0;font-size:14px;"><strong>Amount Paid:</strong> ' + pesoFmt(receipt.amount_paid) + ' via ' + receipt.method + '</p>',
    receipt.reference_no ? '<p style="margin:4px 0 0;font-size:13px;color:#555;">Reference No: ' + receipt.reference_no + '</p>' : '',
    '<p style="margin:8px 0 0;font-size:14px;"><strong>Remaining Balance:</strong> ' +
      (receipt.balance > 0
        ? '<span style="color:#c0392b;">' + pesoFmt(receipt.balance) + '</span>'
        : '<span style="color:#0e7c61;">₱0.00 — Fully Paid</span>') + '</p>',
    '</div>',
    '</div>',
    '<div style="background:#f0f0eb;padding:16px 32px;border-radius:0 0 8px 8px;text-align:center;font-size:12px;color:#888;">For concerns, contact your property admin.</div>',
    '</div>'
  ].join('');

  // FIX: return result instead of void so callers know whether email succeeded
  try {
    MailApp.sendEmail({
      to:       tenant.email,
      subject:  subject,
      htmlBody: html
    });
    return { emailSent: true };
  } catch(e) {
    Logger.log('Email send failed for tenant ' + tenant.tenant_id + ': ' + e.message);
    return { emailSent: false, reason: e.message };
  }
}
