"""미니게임 — 달팽이 경주. 서버가 결과를 판정하고 보상 코인을 지급한다(권위)."""
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from .. import models
from ..core.database import get_db
from ..core.deps import get_current_user
from ..core.errors import ApiError
from ..domain import rules
from . import service

router = APIRouter(prefix="/v1/minigame", tags=["minigame"])


class RaceIn(BaseModel):
    guess: int  # 1등으로 예측한 레인 (0-based)


@router.post("/race")
def race(body: RaceIn,
         user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    """경주 1회 — 하루 제한 안에서 판정, 1등 예측 성공 시 보상 코인."""
    if user.suspended_at is not None:
        raise ApiError(403, "suspended", "이용이 정지된 계정입니다.")

    service.lock_user(db, user)
    tk = service.today_key(user)
    state = dict(user.minigame_race or {})
    if state.get("date") != tk:
        state = {"date": tk, "count": 0}
    if state["count"] >= rules.CONFIG["RACE_MAX_PER_DAY"]:
        raise ApiError(409, "no_race", "오늘 경주를 다 했어요. 내일 다시 도전해요!")
    state["count"] += 1
    user.minigame_race = state

    result = rules.race_roll()
    won = int(body.guess) == result["winner"]
    coins = 0
    if won:
        coins = rules.CONFIG["RACE_REWARD"]
        service.add_coins(db, user, coins, "race_win")
    service.bump_revision(user)
    db.commit()
    return {
        "winner": result["winner"], "order": result["order"], "times": result["times"],
        "won": won, "coins": coins,
        "left": rules.CONFIG["RACE_MAX_PER_DAY"] - state["count"],
        "player": service.player_payload(db, user),
    }


class QuizIn(BaseModel):
    index: int   # 문항 번호
    answer: int  # 고른 선택지


@router.post("/quiz")
def quiz(body: QuizIn,
         user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    """퀴즈 1문제 — 하루 제한 안에서 서버가 정답 검증, 맞으면 보상 코인."""
    if user.suspended_at is not None:
        raise ApiError(403, "suspended", "이용이 정지된 계정입니다.")

    service.lock_user(db, user)
    tk = service.today_key(user)
    state = dict(user.minigame_quiz or {})
    if state.get("date") != tk:
        state = {"date": tk, "count": 0}
    if state["count"] >= rules.CONFIG["QUIZ_MAX_PER_DAY"]:
        raise ApiError(409, "no_quiz", "오늘 퀴즈를 다 풀었어요. 내일 또 도전해요!")
    state["count"] += 1
    user.minigame_quiz = state

    correct = rules.quiz_check(int(body.index), int(body.answer))
    coins = 0
    if correct:
        coins = rules.CONFIG["QUIZ_REWARD"]
        service.add_coins(db, user, coins, "quiz_correct")
    service.bump_revision(user)
    db.commit()
    answer = rules.QUIZ_BANK[body.index]["answer"] if 0 <= body.index < len(rules.QUIZ_BANK) else -1
    return {
        "correct": correct, "answer": answer, "coins": coins,
        "left": rules.CONFIG["QUIZ_MAX_PER_DAY"] - state["count"],
        "player": service.player_payload(db, user),
    }
