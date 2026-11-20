"""14차 — 계정 연결(link)/로그인(login) Google 플로우 (tokeninfo는 모킹)."""
from types import SimpleNamespace

from app.modules import auth as auth_module
from app.tests.test_api import client, guest, hatch_first  # noqa: F401


class _FakeResp:
    def __init__(self, status_code: int, data: dict):
        self.status_code = status_code
        self._data = data

    def json(self):
        return self._data


def _mock_google(monkeypatch, sub: str, name: str = "구글유저", aud: str = "test-client-id"):
    # settings는 frozen — auth 모듈이 참조하는 이름 자체를 대체한다 (google_client_id만 사용)
    monkeypatch.setattr(auth_module, "settings", SimpleNamespace(google_client_id="test-client-id"))
    monkeypatch.setattr(auth_module.httpx, "get",
                        lambda *a, **k: _FakeResp(200, {"sub": sub, "name": name, "aud": aud}))


def test_link_then_login_roundtrip(guest, monkeypatch):
    """게스트에 Google 연결 → 새 기기(무토큰)에서 로그인하면 같은 계정 토큰."""
    snail_id, _ = hatch_first(guest)
    _mock_google(monkeypatch, sub="g-sub-1")

    r = client.post("/v1/auth/link/google", json={"idToken": "tok"}, headers=guest["headers"])
    assert r.status_code == 200
    linked_user = r.json()["userId"]

    state = client.get("/v1/game/state", headers=guest["headers"]).json()
    account = state["changes"]["player"]["account"]
    assert account["type"] == "social" and account["provider"] == "google"

    # 기기 이전: 인증 없이 Google 로그인 → 같은 userId 토큰 발급
    r2 = client.post("/v1/auth/google", json={"idToken": "tok"})
    assert r2.status_code == 200
    assert r2.json()["userId"] == linked_user

    # 새 토큰으로 상태 조회 — 부화한 달팽이가 그대로 보인다
    headers2 = {"Authorization": f"Bearer {r2.json()['accessToken']}"}
    snails = client.get("/v1/game/state", headers=headers2).json()["changes"]["snails"]
    assert any(s["id"] == snail_id for s in snails)


def test_login_without_link_404(guest, monkeypatch):
    _mock_google(monkeypatch, sub="g-sub-never-linked")
    r = client.post("/v1/auth/google", json={"idToken": "tok"})
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "no_linked_account"


def test_link_conflict_409(guest, monkeypatch):
    """이미 다른 계정에 연결된 Google을 다시 연결하면 409 (자동 병합 금지)."""
    _mock_google(monkeypatch, sub="g-sub-2")
    assert client.post("/v1/auth/link/google", json={"idToken": "tok"},
                       headers=guest["headers"]).status_code == 200

    other = client.post("/v1/auth/guest").json()
    r = client.post("/v1/auth/link/google", json={"idToken": "tok"},
                    headers={"Authorization": f"Bearer {other['accessToken']}"})
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "social_conflict"


def test_google_aud_mismatch_rejected(guest, monkeypatch):
    _mock_google(monkeypatch, sub="g-sub-3", aud="another-client")
    r = client.post("/v1/auth/link/google", json={"idToken": "tok"}, headers=guest["headers"])
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "google_invalid"
