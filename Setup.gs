// =============================================================================
// Setup.gs — One-time Sheets initializer for JJ Apartment RMS
//
// HOW TO USE:
//   1. Open your Google Sheets file
//   2. Go to Extensions → Apps Script
//   3. Create a NEW script file: click the + next to "Files", name it "Setup"
//   4. Paste this entire file into it
//   5. Click the function dropdown at the top and select "setupSheets"
//   6. Click ▶ Run
//   7. Authorize when prompted
//   8. Check your Sheets file — all 6 tabs will be ready
//
// SAFE TO RE-RUN: If a tab already exists, it is left untouched.
// Only missing tabs are created.
// =============================================================================

function setupSheets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ui = SpreadsheetApp.getUi();

  // ── Tab definitions ─────────────────────────────────────────────────────────
  var tabs = [

    {
      name: 'Config',
      headers: ['key', 'value'],
      seedData: [
        ['property_name',    'JJ Apartment'],
        ['admin_pin',        '1234'],
        ['electric_rate',    '11.50'],
        ['water_rate',       '45.00'],
        ['due_day',          '5'],
        ['late_fee_amount',  '200'],
        ['late_fee_type',    'fixed'],
        ['deposit_multiplier','2'],
        ['login_prefix',     'JJ'],
        ['reminder_enabled', 'true']
      ],
      // Config is special: seed data goes into column A and B directly
      isSeedConfig: true
    },

    {
      name: 'Tenants',
      headers: [
        'tenant_id','name','unit','room_type','move_in_date','move_out_date',
        'monthly_rent','deposit_paid','email','contact','status','login_code'
      ]
    },

    {
      name: 'Billing',
      headers: [
        'billing_id','tenant_id','month','rent_amount',
        'elec_prev','elec_curr','elec_consumption','elec_bill',
        'water_prev','water_curr','water_consumption','water_bill',
        'late_fee','total_bill','amount_paid','balance','status'
      ]
    },

    {
      name: 'Payments',
      headers: [
        'payment_id','tenant_id','billing_id','date','amount',
        'method','reference_no','proof_url','status','note',
        'approved_by','approved_date'
      ]
    },

    {
      name: 'Receipts',
      headers: [
        'receipt_no','payment_id','tenant_id','generated_date','receipt_snapshot'
      ]
    },

    {
      name: 'Readings',
      headers: [
        'reading_id','tenant_id','month',
        'elec_prev','elec_curr','water_prev','water_curr','saved_date'
      ]
    }

  ];

  var created = [];
  var skipped = [];

  tabs.forEach(function(tab) {

    var sheet = ss.getSheetByName(tab.name);

    // ── Tab already exists → leave it alone ───────────────────────────────────
    if (sheet) {
      skipped.push(tab.name);
      return;
    }

    // ── Create the tab ────────────────────────────────────────────────────────
    sheet = ss.insertSheet(tab.name);

    // ── Write header row ──────────────────────────────────────────────────────
    sheet.getRange(1, 1, 1, tab.headers.length)
         .setValues([tab.headers]);

    // Style header row
    var headerRange = sheet.getRange(1, 1, 1, tab.headers.length);
    headerRange
      .setBackground('#0a6650')       // teal-dark
      .setFontColor('#ffffff')
      .setFontWeight('bold')
      .setFontSize(10);

    // Freeze header row so it stays visible when scrolling
    sheet.setFrozenRows(1);

    // ── Seed Config data (key + value pairs) ──────────────────────────────────
    if (tab.isSeedConfig && tab.seedData && tab.seedData.length) {
      sheet.getRange(2, 1, tab.seedData.length, 2)
           .setValues(tab.seedData);

      // Format the admin_pin cell as plain text to prevent leading-zero issues
      sheet.getRange(3, 2).setNumberFormat('@STRING@');

      // Light stripe the config rows for readability
      for (var i = 0; i < tab.seedData.length; i++) {
        var rowBg = (i % 2 === 0) ? '#eaf8f3' : '#ffffff';
        sheet.getRange(i + 2, 1, 1, 2).setBackground(rowBg);
      }

      // Bold the key column
      sheet.getRange(2, 1, tab.seedData.length, 1).setFontWeight('bold');

      // Auto-resize columns
      sheet.autoResizeColumns(1, 2);
    }

    // ── Auto-resize all header columns ────────────────────────────────────────
    sheet.autoResizeColumns(1, tab.headers.length);

    // Set a reasonable default row height for data rows
    sheet.setRowHeightsForced(2, 500, 22);

    created.push(tab.name);
  });

  // ── Move tabs into logical order ──────────────────────────────────────────
  var order = ['Config','Tenants','Billing','Payments','Receipts','Readings'];
  order.forEach(function(name, idx) {
    var s = ss.getSheetByName(name);
    if (s) ss.setActiveSheet(s) && ss.moveActiveSheet(idx + 1);
  });

  // Remove the default "Sheet1" if it was never renamed and is empty
  var defaultSheet = ss.getSheetByName('Sheet1');
  if (defaultSheet && defaultSheet.getLastRow() === 0) {
    ss.deleteSheet(defaultSheet);
  }

  // ── Done — show summary ───────────────────────────────────────────────────
  var msg = '';
  if (created.length)  msg += '✅ Created tabs:\n• ' + created.join('\n• ') + '\n\n';
  if (skipped.length)  msg += '⚠️ Already existed (untouched):\n• ' + skipped.join('\n• ') + '\n\n';
  msg += 'Setup complete! Your Sheets file is ready.\n\nNext step: open Code.gs and set your SPREADSHEET_ID.';

  ui.alert('JJ Apartment RMS — Setup Complete', msg, ui.ButtonSet.OK);
}

// =============================================================================
// setupMonthlyTrigger
// Installs a time-driven trigger that runs sendMonthlyBillingReminders()
// on the 2nd of every month at 8:00 AM (script timezone).
//
// HOW TO USE:
//   1. In Apps Script, select "setupMonthlyTrigger" from the function dropdown
//   2. Click ▶ Run once — the trigger is installed and will recur automatically
//   3. Verify it was created: Triggers (clock icon) in the left sidebar
//
// SAFE TO RE-RUN: Will not create a duplicate if a trigger already exists.
// =============================================================================
function setupMonthlyTrigger() {
  var ui = SpreadsheetApp.getUi();
  var functionName = 'sendMonthlyBillingReminders';

  // Check if a trigger for this function already exists
  var existingTriggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < existingTriggers.length; i++) {
    if (existingTriggers[i].getHandlerFunction() === functionName) {
      ui.alert(
        'Trigger already exists',
        'A monthly trigger for "' + functionName + '" is already installed.\n\n' +
        'No duplicate was created. Check Triggers in the sidebar to verify.',
        ui.ButtonSet.OK
      );
      return;
    }
  }

  // Install the trigger: runs on the 2nd of every month at 8:00 AM
  ScriptApp.newTrigger(functionName)
    .timeBased()
    .onMonthDay(2)
    .atHour(8)
    .create();

  ui.alert(
    'Trigger installed ✅',
    '"' + functionName + '" will now run automatically on the 2nd of every month at 8:00 AM.\n\n' +
    'You can verify it under Triggers (clock icon) in the Apps Script sidebar.\n\n' +
    'To disable without removing the trigger, set reminder_enabled = false in your Config sheet.',
    ui.ButtonSet.OK
  );
}

// =============================================================================
// removeMonthlyTrigger
// Removes the billing reminder trigger if you need to uninstall it.
// Run this from the Apps Script editor — select it from the function dropdown.
// =============================================================================
function removeMonthlyTrigger() {
  var ui = SpreadsheetApp.getUi();
  var functionName = 'sendMonthlyBillingReminders';
  var removed = 0;

  var triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(function(trigger) {
    if (trigger.getHandlerFunction() === functionName) {
      ScriptApp.deleteTrigger(trigger);
      removed++;
    }
  });

  ui.alert(
    removed > 0 ? 'Trigger removed ✅' : 'No trigger found',
    removed > 0
      ? removed + ' trigger(s) for "' + functionName + '" have been removed.'
      : 'No trigger for "' + functionName + '" was found. Nothing to remove.',
    ui.ButtonSet.OK
  );
}
