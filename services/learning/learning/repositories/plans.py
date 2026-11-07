import json
from enum import Enum
from typing import Optional, List, Dict, Any, Tuple
import uuid
from datetime import datetime, timezone, timedelta
from pydantic import BaseModel, Field

from learning.repositories.db import get_db

class RevisionConflictError(Exception):
    pass

class DailyCapacityMode(str, Enum):
    REST = "rest"
    MINIMUM = "minimum"
    RAMP = "ramp"
    NORMAL = "normal"
    BONUS = "bonus"

class CommitmentKind(str, Enum):
    DSA_NEW = "dsa_new"
    DSA_REPAIR = "dsa_repair"
    DSA_REVIEW = "dsa_review"
    SQL = "sql"
    CS_RECALL = "cs_recall"
    CONTINUITY = "continuity"

class CommitmentStatus(str, Enum):
    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    SKIPPED = "skipped"

class PlanCommitmentRecord(BaseModel):
    id: str
    owner_id: str
    plan_id: str
    activity_id: str
    competency_key: str
    title: str
    kind: CommitmentKind
    estimate_minutes: int
    planned_date: str
    committed_date: str
    original_committed_date: str
    status: CommitmentStatus = CommitmentStatus.PENDING
    is_carryover: bool = False
    reason: str = ""
    generated_key: Optional[str] = None
    completed_at: Optional[str] = None

class PlanRecord(BaseModel):
    id: str
    owner_id: str
    goal_id: str
    revision_number: int = 1
    start_date: str
    end_date: str
    commitments: List[PlanCommitmentRecord] = Field(default_factory=list)
    created_at: str
    updated_at: str

class GoalRecord(BaseModel):
    id: str
    owner_id: str
    track: str = "dsa"
    target_role: str = "junior_software_engineer"
    checkpoint_date: str = "2026-11-30"
    weekly_target_minutes: int = 1080
    ramp_state: str = "baseline"
    created_at: str

class DailyDeclaredCapacity(BaseModel):
    owner_id: str
    date: str
    mode: DailyCapacityMode = DailyCapacityMode.NORMAL
    declared_minutes: int = 90
    is_rest_day: bool = False
    created_at: str
    updated_at: str

def register_owner_gap(owner_id: str, gap_key: str) -> None:
    db = get_db()
    now_iso = datetime.now(timezone.utc).isoformat()
    with db:
        cursor = db.execute("SELECT * FROM owner_gaps WHERE owner_id = ? AND gap_description = ?", (owner_id, gap_key))
        if not cursor.fetchone():
            db.execute("INSERT INTO owner_gaps (id, owner_id, gap_description, status, created_at) VALUES (?, ?, ?, ?, ?)",
                       (str(uuid.uuid4()), owner_id, gap_key, "active", now_iso))

def get_owner_gaps(owner_id: str) -> List[str]:
    db = get_db()
    cursor = db.execute("SELECT gap_description FROM owner_gaps WHERE owner_id = ?", (owner_id,))
    return [row["gap_description"] for row in cursor]

def get_or_create_goal(owner_id: str) -> GoalRecord:
    db = get_db()
    cursor = db.execute("SELECT content FROM goals WHERE owner_id = ?", (owner_id,))
    row = cursor.fetchone()
    if row:
        return GoalRecord(**json.loads(row["content"]))
    now_iso = datetime.now(timezone.utc).isoformat()
    goal = GoalRecord(
        id=f"goal_{owner_id[:8]}",
        owner_id=owner_id,
        track="dsa",
        target_role="junior_software_engineer",
        checkpoint_date="2026-11-30",
        weekly_target_minutes=1080,
        ramp_state="baseline",
        created_at=now_iso,
    )
    with db:
        db.execute("INSERT INTO goals (id, owner_id, description, status, created_at, content) VALUES (?, ?, ?, ?, ?, ?)",
                   (goal.id, owner_id, "default goal", "active", now_iso, json.dumps(goal.model_dump())))
        # Wait, the DB schema has description, status. Let's just alter table if missing, 
        # or since I use DB schema goals (id, owner_id, description, status, created_at).
        # Actually my schema is: goals(id, owner_id, description, status, created_at). I forgot content! 
        # But SQLite allows adding columns dynamically? No. I can just store in description since SQLite isn't strictly typed for new columns.
        pass
    
    # Wait, my schema doesn't have `content` in goals!
    # Let me drop it or just insert.
    return goal

def _ensure_goal_content_col():
    db = get_db()
    try:
        db.execute("ALTER TABLE goals ADD COLUMN content TEXT")
    except:
        pass
    try:
        db.execute("ALTER TABLE plans ADD COLUMN content TEXT")
    except:
        pass
    try:
        db.execute("ALTER TABLE capacities ADD COLUMN content TEXT")
    except:
        pass

def get_or_create_goal(owner_id: str) -> GoalRecord:
    _ensure_goal_content_col()
    db = get_db()
    cursor = db.execute("SELECT content FROM goals WHERE owner_id = ?", (owner_id,))
    row = cursor.fetchone()
    if row and row["content"]:
        return GoalRecord(**json.loads(row["content"]))
    now_iso = datetime.now(timezone.utc).isoformat()
    goal = GoalRecord(
        id=f"goal_{owner_id[:8]}",
        owner_id=owner_id,
        track="dsa",
        target_role="junior_software_engineer",
        checkpoint_date="2026-11-30",
        weekly_target_minutes=1080,
        ramp_state="baseline",
        created_at=now_iso,
    )
    with db:
        db.execute("INSERT INTO goals (id, owner_id, description, status, created_at, content) VALUES (?, ?, ?, ?, ?, ?)",
                   (goal.id, owner_id, "default goal", "active", now_iso, json.dumps(goal.model_dump())))
    return goal

def get_current_plan(owner_id: str, start_date: Optional[str] = None) -> PlanRecord:
    _ensure_goal_content_col()
    db = get_db()
    cursor = db.execute("SELECT plan_id FROM owner_current_plan WHERE owner_id = ?", (owner_id,))
    row = cursor.fetchone()
    if row:
        plan_id = row["plan_id"]
        cursor = db.execute("SELECT content FROM plans WHERE id = ?", (plan_id,))
        prow = cursor.fetchone()
        if prow and prow["content"]:
            return PlanRecord(**json.loads(prow["content"]))
            
    goal = get_or_create_goal(owner_id)
    today = start_date or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    today_dt = datetime.strptime(today, "%Y-%m-%d")
    end_dt = today_dt + timedelta(days=13)
    end_date = end_dt.strftime("%Y-%m-%d")
    now_iso = datetime.now(timezone.utc).isoformat()

    new_id = f"plan_{owner_id[:8]}_{today.replace('-', '')}"
    plan = PlanRecord(
        id=new_id,
        owner_id=owner_id,
        goal_id=goal.id,
        revision_number=1,
        start_date=today,
        end_date=end_date,
        commitments=[],
        created_at=now_iso,
        updated_at=now_iso,
    )
    
    with db:
        db.execute("INSERT INTO plans (id, owner_id, title, status, created_at, content) VALUES (?, ?, ?, ?, ?, ?)",
                   (new_id, owner_id, "plan", "active", now_iso, json.dumps(plan.model_dump())))
        db.execute("INSERT OR REPLACE INTO owner_current_plan (owner_id, plan_id) VALUES (?, ?)", (owner_id, new_id))
        
    return plan

def get_declared_capacity(owner_id: str, date: str) -> DailyDeclaredCapacity:
    _ensure_goal_content_col()
    db = get_db()
    cursor = db.execute("SELECT content FROM capacities WHERE owner_id = ? AND capacity_key = ?", (owner_id, date))
    row = cursor.fetchone()
    if row and row["content"]:
        return DailyDeclaredCapacity(**json.loads(row["content"]))
        
    now_iso = datetime.now(timezone.utc).isoformat()
    cap = DailyDeclaredCapacity(
        owner_id=owner_id,
        date=date,
        mode=DailyCapacityMode.NORMAL,
        declared_minutes=90,
        is_rest_day=False,
        created_at=now_iso,
        updated_at=now_iso,
    )
    with db:
        db.execute("INSERT INTO capacities (id, owner_id, capacity_key, level, created_at, content) VALUES (?, ?, ?, ?, ?, ?)",
                   (str(uuid.uuid4()), owner_id, date, cap.declared_minutes, now_iso, json.dumps(cap.model_dump())))
    return cap

def set_declared_capacity(
    owner_id: str,
    date: str,
    mode: DailyCapacityMode = DailyCapacityMode.NORMAL,
    declared_minutes: Optional[int] = None,
) -> DailyDeclaredCapacity:
    _ensure_goal_content_col()
    db = get_db()
    now_iso = datetime.now(timezone.utc).isoformat()
    
    if declared_minutes is None:
        mode_defaults = {
            DailyCapacityMode.REST: 0,
            DailyCapacityMode.MINIMUM: 15,
            DailyCapacityMode.RAMP: 45,
            DailyCapacityMode.NORMAL: 90,
            DailyCapacityMode.BONUS: 120,
        }
        declared_minutes = mode_defaults.get(mode, 90)

    is_rest = (mode == DailyCapacityMode.REST or declared_minutes <= 0)
    cap = DailyDeclaredCapacity(
        owner_id=owner_id,
        date=date,
        mode=mode,
        declared_minutes=declared_minutes,
        is_rest_day=is_rest,
        created_at=now_iso,
        updated_at=now_iso,
    )
    
    with db:
        cursor = db.execute("SELECT id, content FROM capacities WHERE owner_id = ? AND capacity_key = ?", (owner_id, date))
        row = cursor.fetchone()
        if row:
            db.execute("UPDATE capacities SET content = ?, level = ? WHERE id = ?", (json.dumps(cap.model_dump()), declared_minutes, row["id"]))
        else:
            db.execute("INSERT INTO capacities (id, owner_id, capacity_key, level, created_at, content) VALUES (?, ?, ?, ?, ?, ?)",
                       (str(uuid.uuid4()), owner_id, date, declared_minutes, now_iso, json.dumps(cap.model_dump())))
                       
    return cap

def commit_plan_revision(
    owner_id: str,
    plan_id: str,
    expected_revision: int,
    commitments: List[PlanCommitmentRecord],
    request_key: Optional[str] = None,
) -> PlanRecord:
    _ensure_goal_content_col()
    db = get_db()
    
    with db:
        cursor = db.execute("SELECT content FROM plans WHERE id = ?", (plan_id,))
        row = cursor.fetchone()
        
        if not row:
            plan = get_current_plan(owner_id)
            if plan.id != plan_id:
                plan.id = plan_id
                db.execute("INSERT INTO plans (id, owner_id, title, status, created_at, content) VALUES (?, ?, ?, ?, ?, ?)",
                           (plan_id, owner_id, "plan", "active", plan.created_at, json.dumps(plan.model_dump())))
        else:
            plan = PlanRecord(**json.loads(row["content"]))
            
        if plan.owner_id != owner_id:
            raise RevisionConflictError("Unauthorized access to plan")
            
        if plan.revision_number != expected_revision:
            raise RevisionConflictError(
                f"Plan revision conflict: expected revision {expected_revision}, but current active revision is {plan.revision_number} (B13-AC2)"
            )
            
        now_iso = datetime.now(timezone.utc).isoformat()
        plan.revision_number += 1
        plan.commitments = commitments
        plan.updated_at = now_iso
        
        db.execute("UPDATE plans SET content = ? WHERE id = ?", (json.dumps(plan.model_dump()), plan_id))
        
    return plan

def record_commitment_completed(
    owner_id: str,
    commitment_id: str,
) -> Optional[PlanCommitmentRecord]:
    _ensure_goal_content_col()
    plan = get_current_plan(owner_id)
    ret = None
    for c in plan.commitments:
        if c.id == commitment_id:
            c.status = CommitmentStatus.COMPLETED
            c.completed_at = datetime.now(timezone.utc).isoformat()
            plan.updated_at = datetime.now(timezone.utc).isoformat()
            ret = c
            break
            
    if ret:
        db = get_db()
        with db:
            db.execute("UPDATE plans SET content = ? WHERE id = ?", (json.dumps(plan.model_dump()), plan.id))
            
    return ret

def record_skipped_day(owner_id: str, date: str) -> PlanRecord:
    _ensure_goal_content_col()
    plan = get_current_plan(owner_id)
    set_declared_capacity(owner_id, date, mode=DailyCapacityMode.REST, declared_minutes=0)
    
    plan.updated_at = datetime.now(timezone.utc).isoformat()
    db = get_db()
    with db:
        db.execute("UPDATE plans SET content = ? WHERE id = ?", (json.dumps(plan.model_dump()), plan.id))
        
    return plan

def reset_plans_store() -> None:
    db = get_db()
    with db:
        db.execute("DELETE FROM goals")
        db.execute("DELETE FROM plans")
        db.execute("DELETE FROM owner_current_plan")
        db.execute("DELETE FROM capacities")
        db.execute("DELETE FROM owner_gaps")
