import json
import uuid
from typing import Optional, List, Dict, Any
from datetime import datetime, timezone
from learning.domain.contracts import (
    ClassroomRecord,
    SessionRecord,
    ArtifactRecord,
    AttemptRecord,
    LearningObservation,
    MessageRecord,
    SourceKind,
    AssistanceLevel,
    SessionMode,
    ModeRecord,
    ExposureRecord,
    LessonMicroGoal,
)
from learning.repositories.db import get_db

class StaleArtifactWriteError(Exception):
    def __init__(self, message: str, expected_revision: int, current_revision: int):
        super().__init__(message)
        self.expected_revision = expected_revision
        self.current_revision = current_revision

class CrossOwnerReferenceError(Exception):
    pass

class DanglingReferenceError(Exception):
    pass

def reset_evidence_store() -> None:
    db = get_db()
    with db:
        db.execute("DELETE FROM classrooms")
        db.execute("DELETE FROM sessions")
        db.execute("DELETE FROM artifacts")
        db.execute("DELETE FROM attempts")
        db.execute("DELETE FROM observations")
        db.execute("DELETE FROM micro_goals")
        db.execute("DELETE FROM exposures")
        db.execute("DELETE FROM session_messages")

def record_session_message(
    owner_id: str,
    session_id: str,
    sender_role: str,
    content: str,
    artifact_revision_snapshot: Optional[int] = None,
    message_id: Optional[str] = None,
) -> MessageRecord:
    db = get_db()
    session = get_session(owner_id, session_id)
    if not session:
        raise DanglingReferenceError(f"Session '{session_id}' does not exist")
    # A queued run supplies its durable message id.  Reusing it makes worker
    # retries idempotent instead of appending a second learner/tutor bubble.
    msg_id = message_id or f"msg_{uuid.uuid4().hex[:12]}"
    created_at = datetime.now(timezone.utc).isoformat()
    rev = artifact_revision_snapshot or session.current_revision
    with db:
        db.execute(
            "INSERT OR IGNORE INTO session_messages (id, owner_id, session_id, sender_role, content, artifact_revision_snapshot, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (msg_id, owner_id, session_id, sender_role, content, rev, created_at)
        )
    existing = db.execute(
        "SELECT id, owner_id, session_id, sender_role, content, artifact_revision_snapshot, created_at FROM session_messages WHERE id = ?",
        (msg_id,),
    ).fetchone()
    if existing:
        return MessageRecord(**dict(existing))
    return MessageRecord(
        id=msg_id, owner_id=owner_id, session_id=session_id, sender_role=sender_role,
        content=content, artifact_revision_snapshot=rev, created_at=created_at
    )

def get_session_messages(owner_id: str, session_id: str) -> List[MessageRecord]:
    db = get_db()
    cursor = db.execute("SELECT * FROM session_messages WHERE owner_id = ? AND session_id = ? ORDER BY created_at ASC", (owner_id, session_id))
    return [MessageRecord(**dict(row)) for row in cursor]

def list_classrooms(owner_id: str) -> List[ClassroomRecord]:
    db = get_db()
    cursor = db.execute("SELECT * FROM classrooms WHERE owner_id = ?", (owner_id,))
    return [ClassroomRecord(**dict(row)) for row in cursor]

def list_sessions(owner_id: str, classroom_id: str) -> List[SessionRecord]:
    db = get_db()
    cursor = db.execute("SELECT * FROM sessions WHERE owner_id = ? AND classroom_id = ?", (owner_id, classroom_id))
    return [SessionRecord(**dict(row)) for row in cursor]

def create_classroom(owner_id: str, track: str, title: str, classroom_id: Optional[str] = None) -> ClassroomRecord:
    db = get_db()
    cid = classroom_id or str(uuid.uuid4())
    cursor = db.execute("SELECT * FROM classrooms WHERE id = ?", (cid,))
    row = cursor.fetchone()
    if row:
        if row["owner_id"] != owner_id:
            raise CrossOwnerReferenceError(f"Classroom '{cid}' belongs to another owner")
        return ClassroomRecord(**dict(row))
    now = datetime.now(timezone.utc).isoformat()
    with db:
        db.execute(
            "INSERT INTO classrooms (id, owner_id, track, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
            (cid, owner_id, track, title, now, now)
        )
    return ClassroomRecord(id=cid, owner_id=owner_id, track=track, title=title, created_at=now, updated_at=now)

def get_classroom(owner_id: str, classroom_id: str) -> Optional[ClassroomRecord]:
    db = get_db()
    cursor = db.execute("SELECT * FROM classrooms WHERE id = ? AND owner_id = ?", (classroom_id, owner_id))
    row = cursor.fetchone()
    if row:
        return ClassroomRecord(**dict(row))
    return None

def create_session(
    owner_id: str,
    classroom_id: str,
    stage: str = "foundation",
    mode: str = "practice",
    session_id: Optional[str] = None,
    parent_session_id: Optional[str] = None,
    title: Optional[str] = None,
) -> SessionRecord:
    db = get_db()
    classroom = get_classroom(owner_id, classroom_id)
    if not classroom:
        cursor = db.execute("SELECT owner_id FROM classrooms WHERE id = ?", (classroom_id,))
        row = cursor.fetchone()
        if row and row["owner_id"] != owner_id:
            raise CrossOwnerReferenceError(f"Cross-owner reference: classroom '{classroom_id}' belongs to another owner (B03-AC1)")
        raise DanglingReferenceError(f"Classroom '{classroom_id}' does not exist (B03-AC1)")
    
    sid = session_id or str(uuid.uuid4())
    cursor = db.execute("SELECT * FROM sessions WHERE id = ?", (sid,))
    row = cursor.fetchone()
    if row:
        if row["owner_id"] != owner_id:
            raise CrossOwnerReferenceError(f"Session '{sid}' belongs to another owner")
        return SessionRecord(**dict(row))
    
    now = datetime.now(timezone.utc).isoformat()
    with db:
        if parent_session_id and not get_session(owner_id, parent_session_id):
            raise DanglingReferenceError(f"Parent session '{parent_session_id}' does not exist")
        db.execute(
            "INSERT INTO sessions (id, owner_id, classroom_id, stage, mode, status, current_revision, parent_session_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (sid, owner_id, classroom_id, stage, mode, "active", 1, parent_session_id, title, now, now)
        )
    return SessionRecord(id=sid, owner_id=owner_id, classroom_id=classroom_id, stage=stage, mode=mode, status="active", current_revision=1, parent_session_id=parent_session_id, title=title, created_at=now, updated_at=now)

def complete_lesson_session(owner_id: str, child_session_id: str, title: str, status: str, summary: str, demonstrated_skills: List[str], misconceptions: List[str], next_recommendation: Optional[str] = None) -> Dict[str, Any]:
    session = get_session(owner_id, child_session_id)
    if not session or not session.parent_session_id:
        raise DanglingReferenceError("Only a child lesson with a parent coach session can be returned.")
    # Returning is a checkpoint, not an assessment. Derive evidence from saved
    # learner work rather than trusting editable checkboxes or client claims.
    observations = get_session_observations(owner_id, child_session_id)
    latest = {item.competency_key: item for item in sorted(observations, key=lambda item: item.created_at or "")}
    demonstrated_skills = sorted(key for key, item in latest.items()
                                 if item.demonstrated and item.assistance_level == AssistanceLevel.INDEPENDENT)
    messages = get_session_messages(owner_id, child_session_id)
    excerpts = [f"{item.sender_role}: {item.content[:650]}" for item in messages[-4:]]
    summary = "Lesson checkpoint; completion and mastery are not implied."
    summary += "\nRecent saved dialogue:\n" + ("\n".join(excerpts) if excerpts else "No saved dialogue yet.")
    misconceptions = []  # No verified misconception classifier runs on return.
    next_recommendation = "Resume from the last saved exchange; check unanswered questions before advancing."
    title = session.title or title
    status = "checkpoint"
    handoff = {
        "id": f"handoff_{uuid.uuid4().hex[:12]}", "owner_id": owner_id,
        "parent_session_id": session.parent_session_id, "child_session_id": child_session_id,
        "title": title, "status": status, "summary": summary,
        "demonstrated_skills": demonstrated_skills, "misconceptions": misconceptions,
        "next_recommendation": next_recommendation,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    db = get_db()
    with db:
        db.execute("UPDATE sessions SET status = ?, updated_at = ? WHERE id = ? AND owner_id = ?", ("active", handoff["created_at"], child_session_id, owner_id))
        db.execute("INSERT OR REPLACE INTO lesson_handoffs (id, owner_id, parent_session_id, child_session_id, title, status, summary, demonstrated_skills, misconceptions, next_recommendation, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", (handoff["id"], owner_id, session.parent_session_id, child_session_id, title, status, summary, json.dumps(demonstrated_skills), json.dumps(misconceptions), next_recommendation, handoff["created_at"]))
    return handoff

def get_lesson_handoffs(owner_id: str, parent_session_id: str) -> List[Dict[str, Any]]:
    db = get_db()
    rows = db.execute("SELECT * FROM lesson_handoffs WHERE owner_id = ? AND parent_session_id = ? ORDER BY created_at DESC", (owner_id, parent_session_id)).fetchall()
    return [{**dict(row), "demonstrated_skills": json.loads(row["demonstrated_skills"]), "misconceptions": json.loads(row["misconceptions"])} for row in rows]

def get_session(owner_id: str, session_id: str) -> Optional[SessionRecord]:
    db = get_db()
    cursor = db.execute("SELECT * FROM sessions WHERE id = ? AND owner_id = ?", (session_id, owner_id))
    row = cursor.fetchone()
    if row:
        return SessionRecord(**dict(row))
    return None

def save_artifact(
    owner_id: str,
    session_id: str,
    expected_revision: int,
    content: str,
    language: str = "python",
) -> ArtifactRecord:
    db = get_db()
    session = get_session(owner_id, session_id)
    if not session:
        cursor = db.execute("SELECT owner_id FROM sessions WHERE id = ?", (session_id,))
        row = cursor.fetchone()
        if row and row["owner_id"] != owner_id:
            raise CrossOwnerReferenceError(f"Cross-owner reference: session '{session_id}' belongs to another owner (B03-AC1)")
        raise DanglingReferenceError(f"Session '{session_id}' does not exist (B03-AC1)")
        
    if session.current_revision != expected_revision:
        raise StaleArtifactWriteError(
            f"Stale artifact write: expected revision {expected_revision}, but current session revision is {session.current_revision}",
            expected_revision=expected_revision,
            current_revision=session.current_revision,
        )

    next_revision = session.current_revision + 1
    artifact_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    
    with db:
        cursor = db.execute(
            "UPDATE sessions SET current_revision = ?, updated_at = ? WHERE id = ? AND current_revision = ?",
            (next_revision, now, session_id, expected_revision)
        )
        if cursor.rowcount == 0:
            current = db.execute("SELECT current_revision FROM sessions WHERE id = ?", (session_id,)).fetchone()
            rev = current["current_revision"] if current else expected_revision
            raise StaleArtifactWriteError(
                f"Stale artifact write: expected revision {expected_revision}, but current session revision is {rev}",
                expected_revision=expected_revision,
                current_revision=rev,
            )
        db.execute(
            "INSERT INTO artifacts (id, owner_id, session_id, revision, content, language, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (artifact_id, owner_id, session_id, expected_revision, content, language, now)
        )
    return ArtifactRecord(id=artifact_id, owner_id=owner_id, session_id=session_id, revision=expected_revision, content=content, language=language, created_at=now)

def get_artifact(owner_id: str, session_id: str, revision: Optional[int] = None) -> Optional[ArtifactRecord]:
    db = get_db()
    session = get_session(owner_id, session_id)
    if not session:
        return None
    if revision is not None:
        cursor = db.execute("SELECT * FROM artifacts WHERE owner_id = ? AND session_id = ? AND revision = ?", (owner_id, session_id, revision))
    else:
        cursor = db.execute("SELECT * FROM artifacts WHERE owner_id = ? AND session_id = ? ORDER BY revision DESC LIMIT 1", (owner_id, session_id))
    row = cursor.fetchone()
    if row:
        return ArtifactRecord(**dict(row))
    return None

get_session_artifact = get_artifact

def get_session_artifacts(session_id: str) -> List[ArtifactRecord]:
    db = get_db()
    cursor = db.execute("SELECT * FROM artifacts WHERE session_id = ? ORDER BY revision ASC", (session_id,))
    return [ArtifactRecord(**dict(row)) for row in cursor]

def record_attempt(
    owner_id: str,
    session_id: str,
    source_revision: int,
    assistance_level: AssistanceLevel,
    artifact_id: Optional[str] = None,
    frozen_code: str = "",
    frozen_language: str = "python",
    elapsed_seconds: Optional[int] = None,
    mode: SessionMode = SessionMode.PRACTICE,
    exposure_state: Optional[Dict[str, Any]] = None,
) -> AttemptRecord:
    db = get_db()
    session = get_session(owner_id, session_id)
    if not session:
        cursor = db.execute("SELECT owner_id FROM sessions WHERE id = ?", (session_id,))
        row = cursor.fetchone()
        if row and row["owner_id"] != owner_id:
            raise CrossOwnerReferenceError(f"Cross-owner reference: session '{session_id}' belongs to another owner (B03-AC1)")
        raise DanglingReferenceError(f"Session '{session_id}' does not exist (B03-AC1)")
        
    if artifact_id:
        cursor = db.execute("SELECT owner_id FROM artifacts WHERE id = ? AND session_id = ?", (artifact_id, session_id))
        row = cursor.fetchone()
        if not row:
            raise DanglingReferenceError(f"Artifact '{artifact_id}' does not exist in session '{session_id}' (B03-AC1)")
        if row["owner_id"] != owner_id:
            raise CrossOwnerReferenceError(f"Cross-owner reference: artifact belongs to another owner (B03-AC1)")
            
    attempt_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    exposure_str = json.dumps(exposure_state or {})
    
    with db:
        db.execute(
            "INSERT INTO attempts (id, owner_id, session_id, artifact_id, frozen_code, frozen_language, source_revision, elapsed_seconds, assistance_level, mode, exposure_state, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (attempt_id, owner_id, session_id, artifact_id, frozen_code, frozen_language, source_revision, elapsed_seconds, assistance_level.value, mode.value, exposure_str, now)
        )
    return AttemptRecord(
        id=attempt_id, owner_id=owner_id, session_id=session_id, artifact_id=artifact_id,
        frozen_code=frozen_code, frozen_language=frozen_language, source_revision=source_revision,
        elapsed_seconds=elapsed_seconds, assistance_level=assistance_level, mode=mode,
        exposure_state=exposure_state or {}, created_at=now
    )

def get_attempt(owner_id: str, attempt_id: str) -> Optional[AttemptRecord]:
    db = get_db()
    cursor = db.execute("SELECT * FROM attempts WHERE owner_id = ? AND id = ?", (owner_id, attempt_id))
    row = cursor.fetchone()
    if row:
        d = dict(row)
        d["exposure_state"] = json.loads(d["exposure_state"])
        return AttemptRecord(**d)
    return None

def get_session_attempts(owner_id: str, session_id: str) -> List[AttemptRecord]:
    db = get_db()
    session = get_session(owner_id, session_id)
    if not session:
        return []
    cursor = db.execute("SELECT * FROM attempts WHERE owner_id = ? AND session_id = ?", (owner_id, session_id))
    res = []
    for row in cursor:
        d = dict(row)
        d["exposure_state"] = json.loads(d["exposure_state"])
        res.append(AttemptRecord(**d))
    return res

def record_observation(
    owner_id: str,
    session_id: str,
    competency_key: str,
    source_kind: SourceKind,
    assistance_level: AssistanceLevel,
    demonstrated: bool,
    evidence_text: str,
    message_id: Optional[str] = None,
    artifact_id: Optional[str] = None,
    attempt_id: Optional[str] = None,
    created_at: Optional[str] = None,
) -> LearningObservation:
    db = get_db()
    session = get_session(owner_id, session_id)
    if not session:
        cursor = db.execute("SELECT owner_id FROM sessions WHERE id = ?", (session_id,))
        row = cursor.fetchone()
        if row and row["owner_id"] != owner_id:
            raise CrossOwnerReferenceError(f"Cross-owner reference: session '{session_id}' belongs to another owner (B03-AC1)")
        raise DanglingReferenceError(f"Session '{session_id}' does not exist (B03-AC1)")
        
    if attempt_id:
        att = get_attempt(owner_id, attempt_id)
        if not att:
            cursor = db.execute("SELECT owner_id FROM attempts WHERE id = ?", (attempt_id,))
            row = cursor.fetchone()
            if row and row["owner_id"] != owner_id:
                raise CrossOwnerReferenceError(f"Cross-owner reference: attempt belongs to another owner (B03-AC1)")
            raise DanglingReferenceError(f"Attempt '{attempt_id}' does not exist (B03-AC1)")
            
    obs_id = str(uuid.uuid4())
    now = created_at or datetime.now(timezone.utc).isoformat()
    
    obs = LearningObservation(
        id=obs_id, owner_id=owner_id, session_id=session_id, competency_key=competency_key,
        source_kind=source_kind, assistance_level=assistance_level, demonstrated=demonstrated,
        evidence_text=evidence_text, message_id=message_id, artifact_id=artifact_id, attempt_id=attempt_id, created_at=now
    )
    
    with db:
        db.execute(
            "INSERT INTO observations (id, owner_id, session_id, competency_key, source_kind, assistance_level, demonstrated, evidence_text, message_id, artifact_id, attempt_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (obs.id, obs.owner_id, obs.session_id, obs.competency_key, obs.source_kind.value, obs.assistance_level.value, 1 if obs.demonstrated else 0, obs.evidence_text, obs.message_id, obs.artifact_id, obs.attempt_id, obs.created_at)
        )
    return obs

def get_session_observations(owner_id: str, session_id: str) -> List[LearningObservation]:
    db = get_db()
    session = get_session(owner_id, session_id)
    if not session:
        return []
    cursor = db.execute("SELECT * FROM observations WHERE owner_id = ? AND session_id = ?", (owner_id, session_id))
    return [LearningObservation(**dict(row)) for row in cursor]

def get_owner_observations(owner_id: str) -> List[LearningObservation]:
    db = get_db()
    cursor = db.execute("SELECT * FROM observations WHERE owner_id = ?", (owner_id,))
    return [LearningObservation(**dict(row)) for row in cursor]

get_observations = get_owner_observations

def create_micro_goal(
    owner_id: str,
    session_id: str,
    description: str,
    competency_key: str,
    is_editable: bool = True,
) -> LessonMicroGoal:
    db = get_db()
    session = get_session(owner_id, session_id)
    if not session:
        cursor = db.execute("SELECT owner_id FROM sessions WHERE id = ?", (session_id,))
        row = cursor.fetchone()
        if row and row["owner_id"] != owner_id:
            raise CrossOwnerReferenceError(f"Cross-owner reference: session belongs to another owner (B03-AC1)")
        raise DanglingReferenceError(f"Session '{session_id}' does not exist (B03-AC1)")
        
    goal_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    with db:
        db.execute(
            "INSERT INTO micro_goals (id, owner_id, session_id, description, competency_key, status, is_editable, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (goal_id, owner_id, session_id, description, competency_key, "in_progress", 1 if is_editable else 0, now, now)
        )
    return LessonMicroGoal(
        goal_id=goal_id, session_id=session_id, owner_id=owner_id, description=description,
        competency_key=competency_key, status="in_progress", is_editable=is_editable, created_at=now, updated_at=now
    )

def update_micro_goal(
    owner_id: str,
    session_id: str,
    goal_id: str,
    description: Optional[str] = None,
    status: Optional[str] = None,
) -> Optional[LessonMicroGoal]:
    db = get_db()
    session = get_session(owner_id, session_id)
    if not session:
        return None
        
    cursor = db.execute("SELECT * FROM micro_goals WHERE owner_id = ? AND session_id = ? AND id = ?", (owner_id, session_id, goal_id))
    row = cursor.fetchone()
    if not row:
        return None
    
    if not row["is_editable"]:
        raise ValueError("Micro-goal is locked and cannot be edited.")
        
    now = datetime.now(timezone.utc).isoformat()
    new_desc = description if description is not None else row["description"]
    new_status = status if status is not None else row["status"]
    
    with db:
        db.execute(
            "UPDATE micro_goals SET description = ?, status = ?, updated_at = ? WHERE id = ?",
            (new_desc, new_status, now, goal_id)
        )
        
    return LessonMicroGoal(
        goal_id=goal_id, session_id=session_id, owner_id=owner_id, description=new_desc,
        competency_key=row["competency_key"], status=new_status, is_editable=bool(row["is_editable"]),
        created_at=row["created_at"], updated_at=now
    )

def get_session_micro_goals(owner_id: str, session_id: str) -> List[LessonMicroGoal]:
    db = get_db()
    session = get_session(owner_id, session_id)
    if not session:
        return []
    cursor = db.execute("SELECT id as goal_id, * FROM micro_goals WHERE owner_id = ? AND session_id = ?", (owner_id, session_id))
    return [LessonMicroGoal(**dict(row)) for row in cursor]

def record_exposure(
    owner_id: str,
    competency_key: str,
    assistance_level: AssistanceLevel,
    demonstrated: bool = False,
) -> ExposureRecord:
    db = get_db()
    now = datetime.now(timezone.utc).isoformat()
    
    with db:
        cursor = db.execute("SELECT * FROM exposures WHERE owner_id = ? AND competency_key = ?", (owner_id, competency_key))
        row = cursor.fetchone()
        
        ind_inc = 1 if (demonstrated and assistance_level == AssistanceLevel.INDEPENDENT) else 0
        gui_inc = 1 if assistance_level == AssistanceLevel.GUIDED else 0
        tut_inc = 1 if assistance_level == AssistanceLevel.TUTOR_SUPPLIED else 0
        
        if row:
            db.execute(
                """UPDATE exposures 
                   SET exposure_count = exposure_count + 1,
                       independent_success_count = independent_success_count + ?,
                       guided_count = guided_count + ?,
                       tutor_supplied_count = tutor_supplied_count + ?,
                       last_exposed_at = ?,
                       last_assistance_level = ?
                   WHERE owner_id = ? AND competency_key = ?""",
                (ind_inc, gui_inc, tut_inc, now, assistance_level.value, owner_id, competency_key)
            )
        else:
            db.execute(
                """INSERT INTO exposures 
                   (id, owner_id, competency_key, exposure_count, independent_success_count, guided_count, tutor_supplied_count, last_exposed_at, last_assistance_level) 
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (str(uuid.uuid4()), owner_id, competency_key, 1, ind_inc, gui_inc, tut_inc, now, assistance_level.value)
            )
            
    cursor = db.execute("SELECT * FROM exposures WHERE owner_id = ? AND competency_key = ?", (owner_id, competency_key))
    return ExposureRecord(**dict(cursor.fetchone()))

def get_exposure(owner_id: str, competency_key: str) -> Optional[ExposureRecord]:
    db = get_db()
    cursor = db.execute("SELECT * FROM exposures WHERE owner_id = ? AND competency_key = ?", (owner_id, competency_key))
    row = cursor.fetchone()
    if row:
        return ExposureRecord(**dict(row))
    return None
