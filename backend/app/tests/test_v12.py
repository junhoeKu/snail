"""12차 — 달팽이 경주 미니게임 (서버 판정·보상·하루 제한)."""
from app import models
from app.domain import rules
from app.tests.test_api import client, database, guest


def _win_guess(monkeypatch):
    """race_roll을 winner=2로 고정."""
    monkeypatch.setattr(rules, "race_roll",
                        lambda rng=None: {"winner": 2, "order": [2, 0, 1, 3, 4],
                                          "times": [9.0, 9.5, 8.2, 10.0, 9.8]})


def test_race_win_and_reward(guest, monkeypatch):
    _win_guess(monkeypatch)
    state = client.get("/v1/game/state", headers=guest["headers"]).json()
    coins0 = state["changes"]["player"]["coins"]

    # 정답(2) → 보상
    r = client.post("/v1/minigame/race", json={"guess": 2}, headers=guest["headers"]).json()
    assert r["winner"] == 2 and r["won"] is True
    assert r["coins"] == rules.CONFIG["RACE_REWARD"]
    assert r["player"]["coins"] == coins0 + rules.CONFIG["RACE_REWARD"]

    # 오답(0) → 보상 없음
    r2 = client.post("/v1/minigame/race", json={"guess": 0}, headers=guest["headers"]).json()
    assert r2["won"] is False and r2["coins"] == 0


def test_race_daily_limit(guest, monkeypatch):
    _win_guess(monkeypatch)
    client.get("/v1/game/state", headers=guest["headers"])
    # 하루 한도까지 소진
    for _ in range(rules.CONFIG["RACE_MAX_PER_DAY"]):
        assert client.post("/v1/minigame/race", json={"guess": 0}, headers=guest["headers"]).status_code == 200
    over = client.post("/v1/minigame/race", json={"guess": 0}, headers=guest["headers"])
    assert over.status_code == 409 and over.json()["error"]["code"] == "no_race"


def test_quiz_correct_and_limit(guest):
    client.get("/v1/game/state", headers=guest["headers"])
    # 0번 문항 정답은 0
    r = client.post("/v1/minigame/quiz", json={"index": 0, "answer": 0}, headers=guest["headers"]).json()
    assert r["correct"] is True and r["coins"] == rules.CONFIG["QUIZ_REWARD"]
    # 오답
    r2 = client.post("/v1/minigame/quiz", json={"index": 0, "answer": 2}, headers=guest["headers"]).json()
    assert r2["correct"] is False and r2["coins"] == 0
    # 하루 3회 → 한도 초과
    client.post("/v1/minigame/quiz", json={"index": 0, "answer": 0}, headers=guest["headers"])
    over = client.post("/v1/minigame/quiz", json={"index": 0, "answer": 0}, headers=guest["headers"])
    assert over.status_code == 409 and over.json()["error"]["code"] == "no_quiz"
