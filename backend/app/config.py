from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent
REPO_DIR = BACKEND_DIR.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(REPO_DIR / ".env", BACKEND_DIR / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    data_dir: Path = REPO_DIR / "data"
    host: str = "0.0.0.0"
    port: int = 8000

    anthropic_api_key: str | None = None
    claude_model: str = "claude-sonnet-5-5"

    max_upload_mb: int = 20

    # Built frontend (served by FastAPI in production / Docker)
    frontend_dist: Path = REPO_DIR / "frontend" / "dist"

    @property
    def db_path(self) -> Path:
        return self.data_dir / "app.db"

    @property
    def files_dir(self) -> Path:
        return self.data_dir / "files"

    @property
    def database_url(self) -> str:
        return f"sqlite:///{self.db_path}"

    @property
    def claude_available(self) -> bool:
        return bool(self.anthropic_api_key)

    def ensure_dirs(self) -> None:
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.files_dir.mkdir(parents=True, exist_ok=True)


@lru_cache
def get_settings() -> Settings:
    return Settings()
