"""SQLAlchemy ORM models. See docs/REQUIREMENTS.md §4."""

from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Column,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Table,
    Text,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base

Money = Numeric(12, 2, asdecimal=True)

ATTACHMENT_KINDS = ("warranty_card", "manual", "photo", "other")

item_tag = Table(
    "item_tag",
    Base.metadata,
    Column("item_id", ForeignKey("item.id", ondelete="CASCADE"), primary_key=True),
    Column("tag_id", ForeignKey("tag.id", ondelete="CASCADE"), primary_key=True),
)


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )


class File(Base):
    __tablename__ = "file"

    id: Mapped[int] = mapped_column(primary_key=True)
    sha256: Mapped[str] = mapped_column(String(64), unique=True)
    original_name: Mapped[str] = mapped_column(String(255))
    mime: Mapped[str] = mapped_column(String(100))
    size: Mapped[int] = mapped_column(Integer)
    path: Mapped[str] = mapped_column(String(500))  # relative to settings.files_dir
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class Contact(TimestampMixin, Base):
    __tablename__ = "contact"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    company: Mapped[str | None] = mapped_column(String(200))
    phone: Mapped[str | None] = mapped_column(String(50))
    email: Mapped[str | None] = mapped_column(String(200))
    address: Mapped[str | None] = mapped_column(Text)
    website: Mapped[str | None] = mapped_column(String(500))
    notes: Mapped[str | None] = mapped_column(Text)


class Tag(Base):
    __tablename__ = "tag"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100, collation="NOCASE"), unique=True)
    color: Mapped[str | None] = mapped_column(String(20))

    items: Mapped[list["Item"]] = relationship(secondary=item_tag, back_populates="tags")


class Receipt(TimestampMixin, Base):
    __tablename__ = "receipt"
    __table_args__ = (
        Index("ix_receipt_dupe", "store_name", "receipt_no", "purchase_date"),
        CheckConstraint("warranty_months IS NULL OR warranty_months >= 0", name="ck_receipt_wm"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    file_id: Mapped[int | None] = mapped_column(ForeignKey("file.id", ondelete="SET NULL"))
    ocr_engine: Mapped[str | None] = mapped_column(String(20))
    raw_text: Mapped[str | None] = mapped_column(Text)

    receipt_no: Mapped[str | None] = mapped_column(String(100))
    purchase_date: Mapped[date | None] = mapped_column(Date)
    store_name: Mapped[str | None] = mapped_column(String(200))
    store_address: Mapped[str | None] = mapped_column(Text)

    subtotal: Mapped[Decimal | None] = mapped_column(Money)
    tax: Mapped[Decimal | None] = mapped_column(Money)
    total: Mapped[Decimal | None] = mapped_column(Money)
    currency: Mapped[str] = mapped_column(String(3), default="SGD", server_default="SGD")

    payment_method: Mapped[str | None] = mapped_column(String(50))
    card_last4: Mapped[str | None] = mapped_column(String(4))
    notes: Mapped[str | None] = mapped_column(Text)

    # Receipt-level warranty defaults (items may override)
    warranty_months: Mapped[int | None] = mapped_column(Integer)
    warranty_start: Mapped[date | None] = mapped_column(Date)
    contact_id: Mapped[int | None] = mapped_column(ForeignKey("contact.id", ondelete="SET NULL"))

    file: Mapped[File | None] = relationship()
    contact: Mapped[Contact | None] = relationship()
    items: Mapped[list["Item"]] = relationship(
        back_populates="receipt",
        cascade="all, delete-orphan",
        order_by="Item.position",
    )


class Item(Base):
    __tablename__ = "item"
    __table_args__ = (
        CheckConstraint("warranty_months IS NULL OR warranty_months >= 0", name="ck_item_wm"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    receipt_id: Mapped[int] = mapped_column(
        ForeignKey("receipt.id", ondelete="CASCADE"), index=True
    )
    position: Mapped[int] = mapped_column(Integer, default=0)

    description: Mapped[str] = mapped_column(String(500))
    quantity: Mapped[Decimal] = mapped_column(Numeric(10, 3), default=Decimal(1), server_default="1")
    unit_price: Mapped[Decimal | None] = mapped_column(Money)
    line_total: Mapped[Decimal | None] = mapped_column(Money)

    model_no: Mapped[str | None] = mapped_column(String(100))
    serial_no: Mapped[str | None] = mapped_column(String(100))
    notes: Mapped[str | None] = mapped_column(Text)

    # Overrides; NULL = inherit from receipt
    warranty_months: Mapped[int | None] = mapped_column(Integer)
    warranty_start: Mapped[date | None] = mapped_column(Date)
    contact_id: Mapped[int | None] = mapped_column(ForeignKey("contact.id", ondelete="SET NULL"))
    no_warranty: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")

    receipt: Mapped[Receipt] = relationship(back_populates="items")
    contact: Mapped[Contact | None] = relationship()
    tags: Mapped[list[Tag]] = relationship(secondary=item_tag, back_populates="items")
    attachments: Mapped[list["Attachment"]] = relationship(
        back_populates="item", cascade="all, delete-orphan"
    )


class Attachment(Base):
    __tablename__ = "attachment"
    __table_args__ = (
        CheckConstraint(
            "kind IN ('warranty_card','manual','photo','other')", name="ck_attachment_kind"
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("item.id", ondelete="CASCADE"), index=True)
    file_id: Mapped[int] = mapped_column(ForeignKey("file.id", ondelete="RESTRICT"))
    kind: Mapped[str] = mapped_column(String(20), default="other")
    label: Mapped[str | None] = mapped_column(String(200))

    item: Mapped[Item] = relationship(back_populates="attachments")
    file: Mapped[File] = relationship()


class Setting(Base):
    __tablename__ = "setting"

    key: Mapped[str] = mapped_column(String(100), primary_key=True)
    value: Mapped[str] = mapped_column(Text)


DEFAULT_SETTINGS: dict[str, str] = {
    "default_currency": "SGD",
    "tax_label": "GST",
    "expiry_window_days": "30",
    "default_ocr_engine": "opensource",
}
