# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Bench context

This app runs inside a Frappe v16 bench at `/home/trojan-technologies/frappe-bench`, site `local.com`. All `bench` commands must be run from that directory, not from this app directory.

```bash
bench --site local.com migrate          # after any DocType JSON change
bench build --app dms                   # rebuild JS/CSS assets
bench --site local.com clear-cache      # after hooks.py changes
bench --site local.com run-tests --app dms
bench --site local.com export-fixtures --app dms   # after editing Workspace fixtures in DB
```

## Linting

From `apps/dms/` (after `pre-commit install`):

```bash
pre-commit run --all-files   # ruff + ruff-format + prettier + eslint
ruff check dms/              # Python linter only
ruff format dms/             # Python formatter only
```

Ruff config is in `pyproject.toml`. Line length: 110, indent: tabs, target: Python 3.14.

## Architecture

DMS has **no DocTypes and no hooks**. It is a pure REST API layer over ERPNext, consumed by a server-rendered mobile web portal.

### API layer — `dms/api/sales.py`

Every function is decorated `@frappe.whitelist` and called via `/api/method/dms.api.sales.<function>`. All functions call `_require_sales_rep()` first, which checks the `Sales Rep` role on `frappe.session.user`.

Key design decisions to know before editing:

- **`create_sales_order` permission elevation**: ERPNext's `on_submit` creates Stock Reservation Entries, which require `Administrator` permission. The function swaps only `frappe.session.user` (not `frappe.session.sid`) to avoid logging the user out, then restores it in a `finally` block.
- **Stock check in `get_items`**: available qty = `actual_qty - reserved_stock` from `tabBin`. The same formula is used in `create_sales_order` for the pre-submit stock guard — keep these two in sync if you change the formula.
- **Item images**: if `Item.image` is empty, a fallback looks up `tabFile` for the first image-extension attachment on that item.
- **Credit limit**: `_get_credit_info()` imports `get_credit_limit`/`get_customer_outstanding` from ERPNext and respects the `bypass_credit_limit_check` flag on `Customer Credit Limit`, which excludes unbilled Sales Orders from outstanding when set.

### Web portal — `dms/www/`

Server-rendered Frappe portal pages (not the Desk). Each page has a `<page>.py` (`get_context`) + `<page>.html` pair:

| Route | Purpose |
|---|---|
| `/sales-login` | Login page; redirects to `/sales-home` if already authenticated |
| `/sales-home` | Dashboard — calls `get_dashboard_stats` and `get_customers` via JS fetch |
| `/sales-customer` | Customer list + new order entry point |
| `/sales-order` | Order creation form |
| `/sales-logout` | Logout handler |

All `.py` files duplicate a `_require_sales_rep()` that redirects unauthenticated users to `/sales-login` instead of throwing. The HTML pages use vanilla JS `fetch` against `/api/method/dms.api.sales.*` with the CSRF token from the `X-Frappe-CSRF-Token` cookie.

### Fixtures — `dms/fixtures/workspace.json`

Exports two Workspace documents: `Store Keeper` and `Sales Representative`. Controlled by `hooks.py → fixtures`.
