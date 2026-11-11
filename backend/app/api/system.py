from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import Settings, get_settings
from ..db import get_session
from ..models import DEFAULT_SETTINGS, Setting

router = APIRouter(tags=["system"])


class Health(BaseModel):
    status: str


class AppConfig(BaseModel):
    claude_available: bool
    default_engine: str
    currency: str
    tax_label: str
    expiry_window_days: int
    max_upload_mb: int


@router.get("/health", response_model=Health)
def health(session: Session = Depends(get_session)) -> Health:
    session.execute(select(1))
    return Health(status="ok")


@router.get("/config", response_model=AppConfig)
def app_config(
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> AppConfig:
    stored = dict(session.execute(select(Setting.key, Setting.value)).tuples().all())
    values = {**DEFAULT_SETTINGS, **stored}
    return AppConfig(
        claude_available=settings.claude_available,
        default_engine=values["default_ocr_engine"],
        currency=values["default_currency"],
        tax_label=values["tax_label"],
        expiry_window_days=int(values["expiry_window_days"]),
        max_upload_mb=settings.max_upload_mb,
    )
