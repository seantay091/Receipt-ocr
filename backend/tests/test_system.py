from pathlib import Path

from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app


def test_health(client: TestClient) -> None:
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


def test_config_defaults(client: TestClient) -> None:
    r = client.get("/api/config")
    assert r.status_code == 200
    assert r.json() == {
        "claude_available": False,
        "default_engine": "opensource",
        "currency": "SGD",
        "tax_label": "GST",
        "expiry_window_days": 30,
        "max_upload_mb": 20,
    }


def test_config_claude_available_with_key(tmp_path: Path) -> None:
    s = Settings(data_dir=tmp_path / "d", frontend_dist=tmp_path / "x", anthropic_api_key="sk-test")
    with TestClient(create_app(s)) as c:
        assert c.get("/api/config").json()["claude_available"] is True


def test_data_dirs_created(client: TestClient, settings: Settings) -> None:
    assert settings.db_path.is_file()
    assert settings.files_dir.is_dir()


def test_spa_served_with_fallback(tmp_path: Path) -> None:
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<html>spa</html>")
    (dist / "assets" / "app.js").write_text("console.log(1)")
    (dist / "favicon.svg").write_text("<svg/>")
    s = Settings(data_dir=tmp_path / "d", frontend_dist=dist)
    with TestClient(create_app(s)) as c:
        assert c.get("/").text == "<html>spa</html>"
        assert c.get("/receipts/12").text == "<html>spa</html>"  # client-side route
        assert c.get("/assets/app.js").text == "console.log(1)"
        assert c.get("/favicon.svg").text == "<svg/>"
        assert c.get("/../../etc/passwd").text == "<html>spa</html>"
        assert c.get("/api/nope").status_code == 404
