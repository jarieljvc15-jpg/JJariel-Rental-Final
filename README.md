# 🏠 JJ Apartment — Rental Management System

A serverless rental management system for small apartment properties. Built with **Google Sheets as the database**, **Google Apps Script as the backend**, and **GitHub Pages as the host** — zero server costs, zero frameworks, zero build tools.

---

## Features

### Admin Portal
- PIN-protected login
- Dashboard with monthly collections, pending approvals, overdue tenants, and occupancy count
- Add, edit, and deactivate tenants with auto-generated login codes
- Enter monthly electric and water meter readings — bills computed instantly
- Log payments directly or approve tenant-submitted payments
- Auto-generated receipts emailed to tenants on approval
- Full running ledger with month-by-month balance per tenant
- Partial payment tracking — shortfalls carry forward automatically

### Tenant Portal
- Login via unique tenant code (e.g. `JJ-04`)
- View current balance, billing breakdown, and due date
- See electric and water readings with consumption and rate details
- Submit payment with method, reference number, and proof link
- View full payment history with printable receipt per approved payment

---

## Tech stack

| Layer | Technology |
|-------|-----------|
| Frontend | HTML + CSS + Vanilla JS |
| Hosting | GitHub Pages (static, free) |
| Backend | Google Apps Script Web App |
| Database | Google Sheets (6 tabs) |
| Email | Google Apps Script MailApp |
| Auth | PIN-based (admin) / tenant code (tenants) |

No npm. No build step. No server. No external APIs.

---

## Project structure

```
├── index.html       # Landing page — links to both portals
├── admin.html       # Admin portal
├── tenant.html      # Tenant self-service portal
├── style.css        # Shared styles
├── api.js           # Shared fetch wrapper + utilities
├── admin.js         # Admin portal logic
├── tenant.js        # Tenant portal logic
├── Code.gs          # Google Apps Script backend (all 16 endpoints)
├── Setup.gs         # One-time Sheets initializer script
└── README.md        # This file
```

---

## Setup guide

### 1. Initialize Google Sheets

1. Create a new Google Sheets file and name it (e.g. **JJ Apartment RMS**)
2. Go to **Extensions → Apps Script**
3. Create a new script file named `Setup`, paste the contents of `Setup.gs`
4. Run the `setupSheets` function — it creates all 6 tabs with correct headers and pre-fills the Config tab with default values
5. Edit the **Config** tab values to match your property (name, PIN, rates, due date)

### 2. Deploy the Apps Script backend

1. In the same Apps Script project, create another file named `Code`, paste the contents of `Code.gs`
2. At the top of `Code.gs`, replace `YOUR_SPREADSHEET_ID_HERE` with your actual Sheets file ID (found in the Sheets URL)
3. Go to **Deploy → New deployment**
4. Set type to **Web app**, execute as **Me**, access to **Anyone**
5. Click **Deploy** and copy the Web App URL

### 3. Connect the frontend

Open `api.js` and replace the placeholder at the top:

```js
const GAS_URL = 'YOUR_APPS_SCRIPT_WEB_APP_URL_HERE';
```

with your Web App URL from Step 2.

### 4. Publish to GitHub Pages

1. Push all files to a public GitHub repository
2. Go to **Settings → Pages**
3. Set source to **Deploy from a branch → main → / (root)**
4. Your site will be live at `https://yourusername.github.io/your-repo-name/`

---

## Configuration

All settings are managed from the **Config tab** in Google Sheets — no code changes needed.

| Key | Description | Example |
|-----|-------------|---------|
| `property_name` | Appears on all pages, receipts, and emails | `JJ Apartment` |
| `admin_pin` | PIN to access the Admin Portal | `1234` |
| `electric_rate` | Cost per kWh in pesos | `11.50` |
| `water_rate` | Cost per m³ in pesos | `45.00` |
| `due_day` | Day of the month rent is due | `5` |
| `late_fee_amount` | Late fee — flat peso amount or percentage | `200` |
| `late_fee_type` | `fixed` (peso) or `percent` (% of rent) | `fixed` |
| `login_prefix` | Prefix for auto-generated tenant codes | `JJ` |

Changes take effect immediately on the next page load — no redeployment required.

---

## How the billing cycle works

1. Admin enters current electric and water meter readings per unit each month
2. System auto-fills previous readings, computes consumption, and generates the bill:
   `Rent + Electric bill + Water bill + Late fee (if past due date) = Total`
3. Tenant sees the bill immediately in the Tenant Portal
4. Tenant submits payment → Admin approves → Receipt auto-emailed to tenant
5. Ledger updates in real time — partial payments tracked, balances carry forward

---

## Security notes

- Admin PIN and tenant codes are validated **server-side** on every write operation
- No data is stored in the browser — no localStorage, no cookies
- The Apps Script Web App is deployed as "Anyone" access, which is required for GitHub Pages (a different origin) to reach it without OAuth
- Suitable for small private properties; not intended for public or multi-owner deployments

---

## License

Private use. Not licensed for redistribution.
