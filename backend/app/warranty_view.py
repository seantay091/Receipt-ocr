"""SQL for the `v_item_warranty` view (docs/REQUIREMENTS.md §4.1).

Effective warranty per item:
    months  = item.warranty_months ?? receipt.warranty_months
    start   = item.warranty_start  ?? receipt.warranty_start ?? receipt.purchase_date
    contact = item.contact_id      ?? receipt.contact_id
    expires = start + months (calendar months, clamped to the month end,
              e.g. 2024-01-31 + 1 month = 2024-02-29)
    status  = none | expired | expiring (within expiry_window_days) | active

SQLite's date(x, '+N months') overflows into the next month (Jan 31 + 1 month
= Mar 2/3), so the expiry is computed from the first of the month and clamped.
"""

CREATE_V_ITEM_WARRANTY = """
CREATE VIEW v_item_warranty AS
WITH eff AS (
    SELECT
        i.id          AS item_id,
        i.receipt_id  AS receipt_id,
        i.no_warranty AS no_warranty,
        COALESCE(i.warranty_months, r.warranty_months)                 AS months,
        COALESCE(i.warranty_start, r.warranty_start, r.purchase_date) AS start_date,
        COALESCE(i.contact_id, r.contact_id)                           AS contact_id
    FROM item i
    JOIN receipt r ON r.id = i.receipt_id
),
calc AS (
    SELECT
        eff.*,
        CASE
            WHEN no_warranty OR months IS NULL OR start_date IS NULL THEN NULL
            ELSE MIN(
                date(start_date, 'start of month', '+' || months || ' months',
                     '+' || (CAST(strftime('%d', start_date) AS INTEGER) - 1) || ' days'),
                date(start_date, 'start of month', '+' || (months + 1) || ' months', '-1 day')
            )
        END AS expires_on
    FROM eff
)
SELECT
    item_id,
    receipt_id,
    CASE WHEN expires_on IS NULL THEN NULL ELSE months END     AS months,
    CASE WHEN expires_on IS NULL THEN NULL ELSE start_date END AS start_date,
    expires_on,
    contact_id,
    CASE
        WHEN expires_on IS NULL THEN 'none'
        WHEN expires_on < date('now', 'localtime') THEN 'expired'
        WHEN expires_on <= date('now', 'localtime', '+' || COALESCE(
                (SELECT CAST(value AS INTEGER) FROM setting WHERE key = 'expiry_window_days'), 30
             ) || ' days') THEN 'expiring'
        ELSE 'active'
    END AS status
FROM calc
"""

DROP_V_ITEM_WARRANTY = "DROP VIEW IF EXISTS v_item_warranty"
