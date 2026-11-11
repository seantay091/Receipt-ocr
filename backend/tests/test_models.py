from datetime import date, timedelta
from decimal import Decimal

import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import Contact, Item, Receipt, Setting, Tag


def _warranty(session: Session, item_id: int) -> dict:
    row = session.execute(
        text("SELECT * FROM v_item_warranty WHERE item_id = :id"), {"id": item_id}
    ).mappings().one()
    return dict(row)


def test_default_settings_seeded(session: Session) -> None:
    rows = dict(session.execute(select(Setting.key, Setting.value)).tuples().all())
    assert rows == {
        "default_currency": "SGD",
        "tax_label": "GST",
        "expiry_window_days": "30",
        "default_ocr_engine": "opensource",
    }


def test_receipt_items_tags_roundtrip(session: Session) -> None:
    kitchen, appliances = Tag(name="Kitchen"), Tag(name="Appliances")
    r = Receipt(
        store_name="Best Denki",
        receipt_no="INV-001",
        purchase_date=date(2026, 1, 15),
        subtotal=Decimal("100.00"),
        tax=Decimal("9.00"),
        total=Decimal("109.00"),
        items=[
            Item(description="Air fryer", quantity=Decimal(1), unit_price=Decimal("100.00"),
                 line_total=Decimal("100.00"), tags=[kitchen, appliances]),
        ],
    )
    session.add(r)
    session.commit()

    got = session.get(Receipt, r.id)
    assert got.currency == "SGD"
    assert got.total == Decimal("109.00")
    assert {t.name for t in got.items[0].tags} == {"Kitchen", "Appliances"}


def test_tag_name_unique_case_insensitive(session: Session) -> None:
    session.add(Tag(name="Kitchen"))
    session.commit()
    session.add(Tag(name="kitchen"))
    with pytest.raises(IntegrityError):
        session.commit()


def test_deleting_receipt_cascades_items(session: Session) -> None:
    r = Receipt(store_name="X", items=[Item(description="a"), Item(description="b")])
    session.add(r)
    session.commit()
    session.delete(r)
    session.commit()
    assert session.scalars(select(Item)).all() == []


def test_negative_warranty_rejected(session: Session) -> None:
    session.add(Receipt(store_name="X", warranty_months=-1))
    with pytest.raises(IntegrityError):
        session.commit()


# --- v_item_warranty -------------------------------------------------------

def _add(session: Session, receipt: Receipt) -> Receipt:
    session.add(receipt)
    session.commit()
    return receipt


def test_warranty_inherits_receipt_defaults(session: Session) -> None:
    c = Contact(name="Samsung Service")
    r = _add(session, Receipt(purchase_date=date(2025, 3, 10), warranty_months=24, contact=c,
                              items=[Item(description="TV")]))
    w = _warranty(session, r.items[0].id)
    assert w["months"] == 24
    assert w["start_date"] == "2025-03-10"
    assert w["expires_on"] == "2027-03-10"
    assert w["contact_id"] == c.id


def test_item_overrides_receipt(session: Session) -> None:
    c1, c2 = Contact(name="Store"), Contact(name="Maker")
    r = _add(session, Receipt(purchase_date=date(2025, 3, 10), warranty_months=12, contact=c1,
                              items=[Item(description="Fridge", warranty_months=60,
                                          warranty_start=date(2025, 4, 1), contact=c2)]))
    w = _warranty(session, r.items[0].id)
    assert (w["months"], w["start_date"], w["expires_on"], w["contact_id"]) == (
        60, "2025-04-01", "2030-04-01", c2.id)


def test_explicit_warranty_start_on_receipt_beats_purchase_date(session: Session) -> None:
    r = _add(session, Receipt(purchase_date=date(2025, 1, 1), warranty_start=date(2025, 2, 1),
                              warranty_months=1, items=[Item(description="x")]))
    assert _warranty(session, r.items[0].id)["expires_on"] == "2025-03-01"


@pytest.mark.parametrize("start,months,expected", [
    (date(2024, 1, 31), 1, "2024-02-29"),   # leap year clamp
    (date(2025, 1, 31), 1, "2025-02-28"),
    (date(2025, 3, 31), 1, "2025-04-30"),
    (date(2025, 8, 31), 6, "2026-02-28"),
    (date(2025, 1, 15), 12, "2026-01-15"),
    (date(2025, 1, 15), 0, "2025-01-15"),
])
def test_expiry_month_end_clamping(session: Session, start: date, months: int, expected: str) -> None:
    r = _add(session, Receipt(purchase_date=start, warranty_months=months, items=[Item(description="x")]))
    assert _warranty(session, r.items[0].id)["expires_on"] == expected


def test_no_warranty_flag_opts_out(session: Session) -> None:
    r = _add(session, Receipt(purchase_date=date(2025, 1, 1), warranty_months=12,
                              items=[Item(description="cable", no_warranty=True)]))
    w = _warranty(session, r.items[0].id)
    assert w["status"] == "none"
    assert w["expires_on"] is None and w["months"] is None


def test_no_months_means_none(session: Session) -> None:
    r = _add(session, Receipt(purchase_date=date(2025, 1, 1), items=[Item(description="x")]))
    assert _warranty(session, r.items[0].id)["status"] == "none"


def test_status_buckets(session: Session) -> None:
    today = date.today()
    r = _add(session, Receipt(items=[
        Item(description="expired", warranty_months=1, warranty_start=today - timedelta(days=60)),
        Item(description="expiring", warranty_months=0, warranty_start=today + timedelta(days=10)),
        Item(description="active", warranty_months=0, warranty_start=today + timedelta(days=90)),
        Item(description="edge-today", warranty_months=0, warranty_start=today),
    ]))
    statuses = {i.description: _warranty(session, i.id)["status"] for i in r.items}
    assert statuses == {"expired": "expired", "expiring": "expiring",
                        "active": "active", "edge-today": "expiring"}


def test_expiry_window_setting_respected(session: Session) -> None:
    today = date.today()
    r = _add(session, Receipt(items=[
        Item(description="x", warranty_months=0, warranty_start=today + timedelta(days=45))]))
    assert _warranty(session, r.items[0].id)["status"] == "active"
    session.get(Setting, "expiry_window_days").value = "60"
    session.commit()
    assert _warranty(session, r.items[0].id)["status"] == "expiring"


def test_migration_downgrade_and_upgrade(settings) -> None:
    from alembic import command
    from alembic.config import Config

    from app.config import BACKEND_DIR
    from app.migrate import upgrade_to_head

    settings.ensure_dirs()
    upgrade_to_head(settings.database_url)
    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("sqlalchemy.url", settings.database_url)
    command.downgrade(cfg, "base")
    upgrade_to_head(settings.database_url)
