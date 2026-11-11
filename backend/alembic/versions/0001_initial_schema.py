"""initial schema

Revision ID: 0001
Revises: 
Create Date: 2026-11-11 01:02:20.583953
"""
from alembic import op
import sqlalchemy as sa

from app.warranty_view import CREATE_V_ITEM_WARRANTY, DROP_V_ITEM_WARRANTY


revision = '0001'
down_revision = None
branch_labels = None
depends_on = None

# Frozen copy of the initial defaults (do not import app constants into migrations)
INITIAL_SETTINGS = {
    'default_currency': 'SGD',
    'tax_label': 'GST',
    'expiry_window_days': '30',
    'default_ocr_engine': 'opensource',
}


def upgrade() -> None:
    op.create_table('contact',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('name', sa.String(length=200), nullable=False),
    sa.Column('company', sa.String(length=200), nullable=True),
    sa.Column('phone', sa.String(length=50), nullable=True),
    sa.Column('email', sa.String(length=200), nullable=True),
    sa.Column('address', sa.Text(), nullable=True),
    sa.Column('website', sa.String(length=500), nullable=True),
    sa.Column('notes', sa.Text(), nullable=True),
    sa.Column('created_at', sa.DateTime(), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
    sa.Column('updated_at', sa.DateTime(), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('file',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('sha256', sa.String(length=64), nullable=False),
    sa.Column('original_name', sa.String(length=255), nullable=False),
    sa.Column('mime', sa.String(length=100), nullable=False),
    sa.Column('size', sa.Integer(), nullable=False),
    sa.Column('path', sa.String(length=500), nullable=False),
    sa.Column('created_at', sa.DateTime(), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('sha256')
    )
    op.create_table('setting',
    sa.Column('key', sa.String(length=100), nullable=False),
    sa.Column('value', sa.Text(), nullable=False),
    sa.PrimaryKeyConstraint('key')
    )
    op.create_table('tag',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('name', sa.String(length=100, collation='NOCASE'), nullable=False),
    sa.Column('color', sa.String(length=20), nullable=True),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('name')
    )
    op.create_table('receipt',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('file_id', sa.Integer(), nullable=True),
    sa.Column('ocr_engine', sa.String(length=20), nullable=True),
    sa.Column('raw_text', sa.Text(), nullable=True),
    sa.Column('receipt_no', sa.String(length=100), nullable=True),
    sa.Column('purchase_date', sa.Date(), nullable=True),
    sa.Column('store_name', sa.String(length=200), nullable=True),
    sa.Column('store_address', sa.Text(), nullable=True),
    sa.Column('subtotal', sa.Numeric(precision=12, scale=2), nullable=True),
    sa.Column('tax', sa.Numeric(precision=12, scale=2), nullable=True),
    sa.Column('total', sa.Numeric(precision=12, scale=2), nullable=True),
    sa.Column('currency', sa.String(length=3), server_default='SGD', nullable=False),
    sa.Column('payment_method', sa.String(length=50), nullable=True),
    sa.Column('card_last4', sa.String(length=4), nullable=True),
    sa.Column('notes', sa.Text(), nullable=True),
    sa.Column('warranty_months', sa.Integer(), nullable=True),
    sa.Column('warranty_start', sa.Date(), nullable=True),
    sa.Column('contact_id', sa.Integer(), nullable=True),
    sa.Column('created_at', sa.DateTime(), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
    sa.Column('updated_at', sa.DateTime(), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
    sa.CheckConstraint('warranty_months IS NULL OR warranty_months >= 0', name='ck_receipt_wm'),
    sa.ForeignKeyConstraint(['contact_id'], ['contact.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['file_id'], ['file.id'], ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('receipt', schema=None) as batch_op:
        batch_op.create_index('ix_receipt_dupe', ['store_name', 'receipt_no', 'purchase_date'], unique=False)

    op.create_table('item',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('receipt_id', sa.Integer(), nullable=False),
    sa.Column('position', sa.Integer(), nullable=False),
    sa.Column('description', sa.String(length=500), nullable=False),
    sa.Column('quantity', sa.Numeric(precision=10, scale=3), server_default='1', nullable=False),
    sa.Column('unit_price', sa.Numeric(precision=12, scale=2), nullable=True),
    sa.Column('line_total', sa.Numeric(precision=12, scale=2), nullable=True),
    sa.Column('model_no', sa.String(length=100), nullable=True),
    sa.Column('serial_no', sa.String(length=100), nullable=True),
    sa.Column('notes', sa.Text(), nullable=True),
    sa.Column('warranty_months', sa.Integer(), nullable=True),
    sa.Column('warranty_start', sa.Date(), nullable=True),
    sa.Column('contact_id', sa.Integer(), nullable=True),
    sa.Column('no_warranty', sa.Boolean(), server_default='0', nullable=False),
    sa.CheckConstraint('warranty_months IS NULL OR warranty_months >= 0', name='ck_item_wm'),
    sa.ForeignKeyConstraint(['contact_id'], ['contact.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['receipt_id'], ['receipt.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('item', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_item_receipt_id'), ['receipt_id'], unique=False)

    op.create_table('attachment',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('item_id', sa.Integer(), nullable=False),
    sa.Column('file_id', sa.Integer(), nullable=False),
    sa.Column('kind', sa.String(length=20), nullable=False),
    sa.Column('label', sa.String(length=200), nullable=True),
    sa.CheckConstraint("kind IN ('warranty_card','manual','photo','other')", name='ck_attachment_kind'),
    sa.ForeignKeyConstraint(['file_id'], ['file.id'], ondelete='RESTRICT'),
    sa.ForeignKeyConstraint(['item_id'], ['item.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('attachment', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_attachment_item_id'), ['item_id'], unique=False)

    op.create_table('item_tag',
    sa.Column('item_id', sa.Integer(), nullable=False),
    sa.Column('tag_id', sa.Integer(), nullable=False),
    sa.ForeignKeyConstraint(['item_id'], ['item.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['tag_id'], ['tag.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('item_id', 'tag_id')
    )
    with op.batch_alter_table('item_tag', schema=None) as batch_op:
        batch_op.create_index('ix_item_tag_tag_id', ['tag_id'], unique=False)

    setting = sa.table('setting', sa.column('key', sa.String), sa.column('value', sa.Text))
    op.bulk_insert(setting, [{'key': k, 'value': v} for k, v in INITIAL_SETTINGS.items()])

    op.execute(CREATE_V_ITEM_WARRANTY)


def downgrade() -> None:
    op.execute(DROP_V_ITEM_WARRANTY)
    op.drop_table('item_tag')
    with op.batch_alter_table('attachment', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_attachment_item_id'))

    op.drop_table('attachment')
    with op.batch_alter_table('item', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_item_receipt_id'))

    op.drop_table('item')
    with op.batch_alter_table('receipt', schema=None) as batch_op:
        batch_op.drop_index('ix_receipt_dupe')

    op.drop_table('receipt')
    op.drop_table('tag')
    op.drop_table('setting')
    op.drop_table('file')
    op.drop_table('contact')
