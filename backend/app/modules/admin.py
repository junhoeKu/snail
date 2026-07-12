"""어드민 API — 원격 게임 설정/라이브 이벤트/공지 관리. 모든 쓰기는 감사 로그."""
from datetime import datetime

from fastapi import APIRouter, Depends
from fastapi.responses import HTMLResponse
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import models
from ..core.database import get_db
from ..core.deps import require_admin
from ..core.errors import ApiError
from . import config_service, service

router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(require_admin)])

# 조회 UI는 인증 없이 로드되고, 페이지 안에서 토큰을 입력해 API를 호출한다.
ui_router = APIRouter(prefix="/admin", tags=["admin-ui"])


def _audit(db: Session, action: str, target_id: str, before: dict, after: dict, reason: str) -> None:
    db.add(models.AdminAuditLog(action=action, target_type="game_config",
                                target_id=target_id, before=before, after=after, reason=reason))


def _version_dict(v: models.GameConfigVersion) -> dict:
    return {"id": v.id, "version": v.version, "status": v.status, "note": v.note,
            "config": v.config, "created_at": service._aware(v.created_at).isoformat()}


@router.get("/config/effective")
def get_effective():
    """현재 반영된 유효 설정(기본값 ⊕ 활성 오버라이드)."""
    return config_service.effective()


@router.get("/config/versions")
def list_versions(db: Session = Depends(get_db)):
    rows = db.execute(select(models.GameConfigVersion)
                      .order_by(models.GameConfigVersion.version.desc())).scalars().all()
    return {"versions": [_version_dict(v) for v in rows]}


class ConfigDraftIn(BaseModel):
    config: dict          # {config:{}, variants:{}, foods:{}, stages:{}}
    note: str = ""


@router.post("/config/versions")
def create_draft(body: ConfigDraftIn, db: Session = Depends(get_db)):
    """새 draft 생성 — 저장 시 검증(활성화는 별도)."""
    errors = config_service.validate(body.config)
    if errors:
        raise ApiError(422, "config_invalid", "; ".join(errors))
    next_ver = (db.execute(select(func.max(models.GameConfigVersion.version))).scalar() or 0) + 1
    row = models.GameConfigVersion(version=next_ver, status="draft", config=body.config, note=body.note)
    db.add(row)
    _audit(db, "config_draft_create", str(next_ver), {}, {"note": body.note}, body.note)
    db.commit()
    return _version_dict(row)


class ReasonIn(BaseModel):
    reason: str = ""


@router.post("/config/versions/{version}/activate")
def activate_version(version: int, body: ReasonIn, db: Session = Depends(get_db)):
    """검증 통과 시 활성화 — 이전 활성은 archived, rules 전역에 즉시 반영. 롤백도 이 경로."""
    row = db.execute(select(models.GameConfigVersion)
                     .where(models.GameConfigVersion.version == version)).scalar_one_or_none()
    if row is None:
        raise ApiError(404, "not_found", "설정 버전을 찾을 수 없습니다.")
    errors = config_service.validate(row.config)
    if errors:
        raise ApiError(422, "config_invalid", "; ".join(errors))

    prev = config_service.active_overrides(db)
    prev_ver = prev.version if prev else 0
    if prev and prev.id != row.id:
        prev.status = "archived"
    row.status = "active"
    row.published_at = service.utcnow()
    _audit(db, "config_activate", str(version), {"prev_version": prev_ver},
           {"version": version}, body.reason)
    db.commit()
    config_service.apply_active(db)  # 즉시 반영
    return {"ok": True, "active_version": version, "effective": config_service.effective()}


# ── 라이브 이벤트 ───────────────────────────────────────

class EventIn(BaseModel):
    title: str
    config: dict            # 설정 오버라이드 동형
    starts_at: datetime
    ends_at: datetime
    reason: str = ""


@router.get("/events")
def list_events(db: Session = Depends(get_db)):
    rows = db.execute(select(models.LiveEvent)
                      .order_by(models.LiveEvent.starts_at.desc())).scalars().all()
    return {"events": [{"id": e.id, "title": e.title, "status": e.status,
                        "config": e.config,
                        "starts_at": service._aware(e.starts_at).isoformat(),
                        "ends_at": service._aware(e.ends_at).isoformat()} for e in rows]}


@router.post("/events")
def create_event(body: EventIn, db: Session = Depends(get_db)):
    """이벤트 생성 — config는 활성 설정 위에 겹쳐도 검증(확률 합 등) 통과해야 한다."""
    if body.ends_at <= body.starts_at:
        raise ApiError(422, "bad_range", "종료가 시작보다 빨라요.")
    errors = config_service.validate(body.config)
    if errors:
        raise ApiError(422, "event_invalid", "; ".join(errors))
    ev = models.LiveEvent(title=body.title, config=body.config,
                          starts_at=body.starts_at, ends_at=body.ends_at, status="active")
    db.add(ev)
    _audit(db, "event_create", body.title, {}, {"config": body.config}, body.reason)
    db.commit()
    return {"ok": True, "id": ev.id}


@router.post("/events/{event_id}/cancel")
def cancel_event(event_id: str, body: ReasonIn, db: Session = Depends(get_db)):
    ev = db.get(models.LiveEvent, event_id)
    if ev is None:
        raise ApiError(404, "not_found", "이벤트를 찾을 수 없습니다.")
    ev.status = "cancelled"
    _audit(db, "event_cancel", event_id, {"status": "active"}, {"status": "cancelled"}, body.reason)
    db.commit()
    config_service.refresh_for_request(db)  # 즉시 무효화
    return {"ok": True}


# ── 공지 ────────────────────────────────────────────────

class NoticeIn(BaseModel):
    title: str
    body: str = ""
    priority: str = "normal"     # normal | urgent
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    reason: str = ""


@router.post("/notices")
def create_notice(body: NoticeIn, db: Session = Depends(get_db)):
    n = models.Notice(title=body.title, body=body.body,
                      priority=("urgent" if body.priority == "urgent" else "normal"),
                      starts_at=body.starts_at or service.utcnow(), ends_at=body.ends_at)
    db.add(n)
    _audit(db, "notice_create", body.title, {}, {"priority": n.priority}, body.reason)
    db.commit()
    return {"ok": True, "id": n.id}


@router.post("/notices/{notice_id}/end")
def end_notice(notice_id: str, body: ReasonIn, db: Session = Depends(get_db)):
    n = db.get(models.Notice, notice_id)
    if n is None:
        raise ApiError(404, "not_found", "공지를 찾을 수 없습니다.")
    n.ends_at = service.utcnow()
    _audit(db, "notice_end", notice_id, {}, {}, body.reason)
    db.commit()
    return {"ok": True}


# ── 사용자 운영 ─────────────────────────────────────────

def _audit_user(db: Session, action: str, uid: str, before: dict, after: dict, reason: str) -> None:
    db.add(models.AdminAuditLog(action=action, target_type="user",
                                target_id=uid, before=before, after=after, reason=reason))


@router.get("/users")
def search_users(query: str = "", db: Session = Depends(get_db)):
    """id / 닉네임 / 달팽이 이름으로 검색 (부분 일치)."""
    q = (query or "").strip()
    stmt = select(models.User).limit(30)
    if q:
        snail_uids = select(models.Snail.user_id).where(models.Snail.name.ilike(f"%{q}%"))
        stmt = select(models.User).where(
            (models.User.id == q) | (models.User.nickname.ilike(f"%{q}%"))
            | (models.User.id.in_(snail_uids))
        ).limit(30)
    rows = db.execute(stmt).scalars().all()
    return {"users": [{"id": u.id, "nickname": u.nickname, "auth_type": u.auth_type,
                       "coins": u.coins, "keeper_level": u.keeper_level, "generation": u.generation,
                       "suspended": u.suspended_at is not None,
                       "created_at": service._aware(u.created_at).isoformat()} for u in rows]}


@router.get("/users/{user_id}")
def user_detail(user_id: str, db: Session = Depends(get_db)):
    u = db.get(models.User, user_id)
    if u is None:
        raise ApiError(404, "not_found", "사용자를 찾을 수 없습니다.")
    snails = db.execute(select(models.Snail).where(models.Snail.user_id == user_id)).scalars().all()
    inv = service.get_inventory(db, u)
    actions_ = db.execute(select(models.GameAction).where(models.GameAction.user_id == user_id)
                          .order_by(models.GameAction.created_at.desc()).limit(20)).scalars().all()
    return {
        "id": u.id, "nickname": u.nickname, "auth_type": u.auth_type,
        "coins": u.coins, "keeper_level": u.keeper_level, "keeper_xp": u.keeper_xp,
        "generation": u.generation, "snail_slots": u.snail_slots,
        "suspended": u.suspended_at is not None,
        "created_at": service._aware(u.created_at).isoformat(),
        "inventory": inv,
        "snails": [{"id": s.id, "name": s.name, "stage": s.stage, "level": s.level,
                    "color": s.color, "graduated": s.graduated_at is not None} for s in snails],
        "recent_actions": [{"action": a.action_type, "created_at": service._aware(a.created_at).isoformat()}
                           for a in actions_],
    }


@router.get("/users/{user_id}/ledger")
def user_ledger(user_id: str, db: Session = Depends(get_db)):
    coins = db.execute(select(models.CurrencyLedger).where(models.CurrencyLedger.user_id == user_id)
                       .order_by(models.CurrencyLedger.created_at.desc()).limit(50)).scalars().all()
    items = db.execute(select(models.InventoryLedger).where(models.InventoryLedger.user_id == user_id)
                       .order_by(models.InventoryLedger.created_at.desc()).limit(50)).scalars().all()
    return {
        "coins": [{"amount": c.amount, "balance_after": c.balance_after, "reason": c.reason,
                   "created_at": service._aware(c.created_at).isoformat()} for c in coins],
        "items": [{"item_id": i.item_id, "delta": i.delta, "quantity_after": i.quantity_after,
                   "reason": i.reason, "created_at": service._aware(i.created_at).isoformat()} for i in items],
    }


class CompensateIn(BaseModel):
    coins: int = 0
    items: dict = {}          # {item_id: qty}
    reason: str


@router.post("/users/{user_id}/compensate")
def compensate(user_id: str, body: CompensateIn, db: Session = Depends(get_db)):
    """운영자 보상 — 잔액 직접 수정 금지, 반드시 원장 경유(ADMIN_COMPENSATION)."""
    u = db.get(models.User, user_id)
    if u is None:
        raise ApiError(404, "not_found", "사용자를 찾을 수 없습니다.")
    if not body.reason.strip():
        raise ApiError(422, "reason_required", "보상 사유는 필수입니다.")
    if body.coins:
        service.add_coins(db, u, body.coins, "ADMIN_COMPENSATION")
    for item_id, qty in (body.items or {}).items():
        service.add_item(db, u, item_id, int(qty), "ADMIN_COMPENSATION")
    service.bump_revision(u)
    _audit_user(db, "user_compensate", user_id, {}, {"coins": body.coins, "items": body.items}, body.reason)
    db.commit()
    return {"ok": True, "coins": u.coins}


class SuspendIn(BaseModel):
    suspend: bool = True
    reason: str = ""


@router.post("/users/{user_id}/suspend")
def suspend(user_id: str, body: SuspendIn, db: Session = Depends(get_db)):
    u = db.get(models.User, user_id)
    if u is None:
        raise ApiError(404, "not_found", "사용자를 찾을 수 없습니다.")
    before = u.suspended_at is not None
    u.suspended_at = service.utcnow() if body.suspend else None
    _audit_user(db, "user_suspend", user_id, {"suspended": before}, {"suspended": body.suspend}, body.reason)
    db.commit()
    return {"ok": True, "suspended": body.suspend}


@router.get("/audit")
def list_audit(db: Session = Depends(get_db)):
    rows = db.execute(select(models.AdminAuditLog)
                      .order_by(models.AdminAuditLog.created_at.desc()).limit(100)).scalars().all()
    return {"logs": [{"action": r.action, "target_id": r.target_id, "reason": r.reason,
                      "before": r.before, "after": r.after,
                      "created_at": service._aware(r.created_at).isoformat()} for r in rows]}


_ADMIN_HTML = """<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Snail 어드민</title>
<style>
 body{font-family:system-ui,sans-serif;max-width:760px;margin:0 auto;padding:16px;background:#f5f6f3;color:#25281f}
 h1{font-size:18px} input,button,textarea{font:inherit;padding:8px;border:1px solid #cbd3c2;border-radius:8px}
 input,textarea{width:100%;box-sizing:border-box;margin:4px 0}
 button{background:#6f8d5a;color:#fff;border:0;cursor:pointer;margin:2px 0}
 button.ghost{background:#e3e8dc;color:#25281f}
 .card{background:#fff;border-radius:10px;padding:14px;margin:10px 0;box-shadow:0 1px 4px rgba(0,0,0,.06)}
 .row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
 pre{background:#20241c;color:#d7e0cf;padding:10px;border-radius:8px;overflow:auto;font-size:12px}
 .user{padding:8px;border-bottom:1px solid #eee;cursor:pointer}
 .muted{color:#7a8570;font-size:12px}
</style></head><body>
<h1>🐌 Snail 어드민</h1>
<div class="card">
 <label>어드민 토큰 (X-Admin-Token)</label>
 <input id="token" type="password" placeholder="ADMIN_TOKEN 값">
 <div class="muted">토큰은 이 브라우저에만 저장됩니다.</div>
</div>
<div class="card">
 <div class="row"><input id="q" placeholder="사용자 id / 닉네임 / 달팽이 이름"><button onclick="search()">검색</button></div>
 <div id="users"></div>
</div>
<div class="card"><div class="row">
 <button class="ghost" onclick="showEffective()">유효 설정 보기</button>
 <button class="ghost" onclick="showAudit()">감사 로그</button>
</div></div>
<div id="detail"></div>
<pre id="out"></pre>
<script>
const $=id=>document.getElementById(id);
$('token').value=localStorage.getItem('sn_admin_token')||'';
$('token').addEventListener('change',()=>localStorage.setItem('sn_admin_token',$('token').value));
function hdr(){return {'X-Admin-Token':$('token').value,'Content-Type':'application/json'}}
async function api(path,opts){const r=await fetch(path,{headers:hdr(),...opts});const t=await r.text();
 try{return {ok:r.ok,data:JSON.parse(t)}}catch(e){return {ok:r.ok,data:t}}}
function out(o){$('out').textContent=JSON.stringify(o,null,2)}
async function search(){const r=await api('/admin/users?query='+encodeURIComponent($('q').value));
 if(!r.ok)return out(r.data);
 $('users').innerHTML=r.data.users.map(u=>`<div class="user" onclick="detail('${u.id}')">
  <b>${u.nickname||'(게스트)'}</b> · ${u.id.slice(0,8)} · 🪙${u.coins} · Lv${u.keeper_level}
  ${u.suspended?'<span style="color:#c00">· 정지됨</span>':''}</div>`).join('')||'<div class="muted">결과 없음</div>';}
async function detail(id){const r=await api('/admin/users/'+id);if(!r.ok)return out(r.data);const u=r.data;
 $('detail').innerHTML=`<div class="card"><b>${u.nickname||'(게스트)'}</b> <span class="muted">${u.id}</span>
  <div>🪙 ${u.coins} · 양육자 Lv${u.keeper_level} · ${u.generation}세대 · ${u.suspended?'⛔ 정지':'정상'}</div>
  <div class="muted">달팽이 ${u.snails.length}마리 · 인벤토리 ${JSON.stringify(u.inventory)}</div>
  <div class="row" style="margin-top:8px">
   <input id="cc" type="number" placeholder="코인 보상(+/-)" style="width:140px">
   <input id="cr" placeholder="사유(필수)" style="flex:1">
   <button onclick="compensate('${id}')">보상 지급</button></div>
  <div class="row">
   <button onclick="susp('${id}',${!u.suspended})">${u.suspended?'정지 해제':'계정 정지'}</button>
   <button class="ghost" onclick="ledger('${id}')">원장 보기</button>
   <button class="ghost" onclick="out(${JSON.stringify(u).replace(/"/g,'&quot;')})">상세 JSON</button></div></div>`;}
async function compensate(id){const coins=parseInt($('cc').value||'0',10);const reason=$('cr').value;
 const r=await api('/admin/users/'+id+'/compensate',{method:'POST',body:JSON.stringify({coins,reason})});
 out(r.data);if(r.ok)detail(id);}
async function susp(id,s){const reason=prompt('사유:')||'';
 const r=await api('/admin/users/'+id+'/suspend',{method:'POST',body:JSON.stringify({suspend:s,reason})});
 out(r.data);if(r.ok)detail(id);}
async function ledger(id){out((await api('/admin/users/'+id+'/ledger')).data)}
async function showEffective(){out((await api('/admin/config/effective')).data)}
async function showAudit(){out((await api('/admin/audit')).data)}
</script></body></html>"""


@ui_router.get("/ui", response_class=HTMLResponse)
def admin_ui() -> str:
    return _ADMIN_HTML
