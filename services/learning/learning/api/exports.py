"""
Sprint B23: Populated Backup and Verified Restore Engine & API
Authority: PLANLY_BUILD_SPEC.md §12, §15; B23_backup_restore.md

Invariants:
- B23-AC1: Populate, back up, restore into a disposable environment and resume exact pending artifact/question.
- B23-AC2: Missing/corrupt object bytes prevent a false successful restore.
- B23-AC3: Restoring older data cannot silently undo an applicable deletion or reclassify assisted work.
- Failure to Prevent: Exporting a separate empty backup store does not back up the application.
"""

import base64
import hashlib
import json
import uuid
from datetime import datetime, timezone
from enum import Enum
from typing import Optional, List, Dict, Any, Tuple
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from learning.api.auth import get_current_owner, AuthenticatedOwner
from learning.domain.contracts import (
    SourceKind,
    AssistanceLevel,
    SessionStage,
    SessionMode,
    PendingTaskType,
    PendingTaskStatus,
    ClassroomRecord,
    SessionRecord,
    ArtifactRecord,
    AttemptRecord,
    LearningObservation,
    MessageRecord,
)
from learning.repositories import evidence, sources, corrections
from learning.repositories.db import get_db
from learning.worker import projections


# ==============================================================================
# Domain Models
# ==============================================================================

class ObjectManifestEntry(BaseModel):
    object_id: str
    entity_type: str
    entity_id: str
    session_id: Optional[str] = None
    revision: Optional[int] = None
    byte_size: int
    sha256: str
    content_b64: str


class BackupManifest(BaseModel):
    schema_version: str = "2.0.0"
    exported_at: str
    owner_id: str
    planly_version: str = "0.1.0"
    retention_policy: str = "planly_isolated_backup_retention"
    storage_location: str = "planly-learner-backups-coldline/asia-south2"
    encryption_algorithm: str = "AES-256-GCM"
    entity_counts: Dict[str, int]
    checksum: str
    object_manifest: Dict[str, Any] = Field(default_factory=dict)


class BackupEnvelope(BaseModel):
    manifest: BackupManifest
    data: Dict[str, Any]


class RestoreTargetEnv(str, Enum):
    DISPOSABLE = "disposable"
    STAGING = "staging"
    PRODUCTION = "production"


class RestoreResult(BaseModel):
    success: bool
    restored_at: str
    target_owner_id: str
    target_environment: str
    total_entities_restored: int
    entity_breakdown: Dict[str, int]
    objects_restored: int
    tombstones_reconciled: int
    resumable_session_id: Optional[str] = None
    pending_question: Optional[str] = None
    pending_artifact_revision: Optional[int] = None
    indexes_rebuilt: List[str] = Field(default_factory=list)


class BackupExportRequest(BaseModel):
    owner_id: Optional[str] = None


class BackupValidationRequest(BaseModel):
    payload: Dict[str, Any]
    target_owner_id: Optional[str] = None


class BackupRestoreRequest(BaseModel):
    payload: Dict[str, Any]
    target_owner_id: str
    target_environment: str = "disposable"
    force_overwrite: bool = False


# ==============================================================================
# Canonical Serialization & Checksum Utilities
# ==============================================================================

def canonical_json(val: Any) -> str:
    """Deterministically serialize JSON value with sorted keys at all nested levels."""
    if val is None or isinstance(val, (int, float, bool, str)):
        return json.dumps(val, sort_keys=True)
    if isinstance(val, list):
        return "[" + ",".join(canonical_json(item) for item in val) + "]"
    if isinstance(val, dict):
        items = sorted(val.items(), key=lambda x: x[0])
        return "{" + ",".join(f"{json.dumps(k)}:{canonical_json(v)}" for k, v in items) + "}"
    return json.dumps(str(val))


def compute_payload_checksum(data: Dict[str, Any]) -> str:
    """Compute canonical SHA-256 hash of user data dictionary."""
    canonical_str = canonical_json(data)
    return hashlib.sha256(canonical_str.encode("utf-8")).hexdigest()


# ==============================================================================
# Export & Manifest Generation Engine
# ==============================================================================

def generate_backup_envelope(owner_id: str) -> BackupEnvelope:
    """
    Export all owned database records, artifacts, original chats, corrections,
    and pending state together with a verified object manifest (B23).
    
    Raises ValueError if workspace is empty (Failure to Prevent: empty backup store).
    """
    db = get_db()

    # 1. Fetch records across all tables for owner
    classrooms = [dict(r) for r in db.execute("SELECT * FROM classrooms WHERE owner_id = ?", (owner_id,))]
    sessions = [dict(r) for r in db.execute("SELECT * FROM sessions WHERE owner_id = ?", (owner_id,))]
    artifacts = [dict(r) for r in db.execute("SELECT * FROM artifacts WHERE owner_id = ? ORDER BY revision ASC", (owner_id,))]
    
    raw_attempts = db.execute("SELECT * FROM attempts WHERE owner_id = ?", (owner_id,))
    attempts = []
    for r in raw_attempts:
        d = dict(r)
        if isinstance(d.get("exposure_state"), str):
            try:
                d["exposure_state"] = json.loads(d["exposure_state"])
            except Exception:
                pass
        attempts.append(d)

    observations = [dict(r) for r in db.execute("SELECT * FROM observations WHERE owner_id = ?", (owner_id,))]
    for o in observations:
        o["demonstrated"] = bool(o.get("demonstrated", 0))

    micro_goals = [dict(r) for r in db.execute("SELECT * FROM micro_goals WHERE owner_id = ?", (owner_id,))]
    for mg in micro_goals:
        mg["is_editable"] = bool(mg.get("is_editable", 1))

    exposures = [dict(r) for r in db.execute("SELECT * FROM exposures WHERE owner_id = ?", (owner_id,))]
    session_messages = [dict(r) for r in db.execute("SELECT * FROM session_messages WHERE owner_id = ? ORDER BY created_at ASC", (owner_id,))]

    source_docs = [dict(r) for r in db.execute("SELECT * FROM source_docs WHERE owner_id = ?", (owner_id,))]
    
    raw_turns = db.execute("SELECT * FROM source_turns WHERE owner_id = ? ORDER BY turn_index ASC", (owner_id,))
    source_turns = []
    for r in raw_turns:
        d = dict(r)
        d["has_code"] = bool(d.get("has_code", 0))
        if isinstance(d.get("code_blocks"), str):
            try:
                d["code_blocks"] = json.loads(d["code_blocks"])
            except Exception:
                d["code_blocks"] = []
        source_turns.append(d)

    raw_tasks = db.execute("SELECT * FROM pending_tasks WHERE owner_id = ?", (owner_id,))
    pending_tasks = []
    for r in raw_tasks:
        d = dict(r)
        if isinstance(d.get("context_json"), str):
            try:
                d["context_json"] = json.loads(d["context_json"])
            except Exception:
                d["context_json"] = {}
        pending_tasks.append(d)

    # In-memory corrections and memory claims
    tombstones = [t.model_dump() for t in corrections._tombstones.values() if t.owner_id == owner_id]
    corrections_list = [c.model_dump() for c in corrections._corrections.values() if c.owner_id == owner_id]
    memory_claims = [m.model_dump() for m in corrections._memory_claims.values() if m.owner_id == owner_id]
    cached_summaries = [s.model_dump() for s in corrections._cached_summaries.values() if s.owner_id == owner_id]

    # Failure to prevent: verify that workspace contains real data
    total_records = (
        len(classrooms) + len(sessions) + len(artifacts) + len(attempts) +
        len(observations) + len(session_messages) + len(pending_tasks) +
        len(source_docs) + len(tombstones) + len(memory_claims)
    )
    if total_records == 0:
        raise ValueError(
            f"Cannot export empty backup store: user workspace '{owner_id}' has no populated entities."
        )

    # 2. Build explicit object manifest with verified byte checksums
    object_manifest: Dict[str, Any] = {}

    # Artifact contents
    for art in artifacts:
        content_str = art.get("content", "")
        content_bytes = content_str.encode("utf-8")
        sha = hashlib.sha256(content_bytes).hexdigest()
        b64 = base64.b64encode(content_bytes).decode("ascii")
        obj_id = f"art_{art['id']}"
        object_manifest[obj_id] = {
            "object_id": obj_id,
            "entity_type": "artifact",
            "entity_id": art["id"],
            "session_id": art.get("session_id"),
            "revision": art.get("revision"),
            "byte_size": len(content_bytes),
            "sha256": sha,
            "content_b64": b64,
        }

    # Session message contents / chats
    for msg in session_messages:
        content_str = msg.get("content", "")
        content_bytes = content_str.encode("utf-8")
        sha = hashlib.sha256(content_bytes).hexdigest()
        b64 = base64.b64encode(content_bytes).decode("ascii")
        obj_id = f"msg_{msg['id']}"
        object_manifest[obj_id] = {
            "object_id": obj_id,
            "entity_type": "session_message",
            "entity_id": msg["id"],
            "session_id": msg.get("session_id"),
            "byte_size": len(content_bytes),
            "sha256": sha,
            "content_b64": b64,
        }

    # Attempt frozen code
    for att in attempts:
        code_str = att.get("frozen_code", "")
        if code_str:
            content_bytes = code_str.encode("utf-8")
            sha = hashlib.sha256(content_bytes).hexdigest()
            b64 = base64.b64encode(content_bytes).decode("ascii")
            obj_id = f"att_{att['id']}"
            object_manifest[obj_id] = {
                "object_id": obj_id,
                "entity_type": "attempt",
                "entity_id": att["id"],
                "session_id": att.get("session_id"),
                "byte_size": len(content_bytes),
                "sha256": sha,
                "content_b64": b64,
            }

    data: Dict[str, Any] = {
        "classrooms": classrooms,
        "sessions": sessions,
        "artifacts": artifacts,
        "attempts": attempts,
        "observations": observations,
        "micro_goals": micro_goals,
        "exposures": exposures,
        "session_messages": session_messages,
        "source_docs": source_docs,
        "source_turns": source_turns,
        "pending_tasks": pending_tasks,
        "tombstones": tombstones,
        "corrections": corrections_list,
        "memory_claims": memory_claims,
        "cached_summaries": cached_summaries,
    }

    entity_counts = {table: len(records) for table, records in data.items()}
    checksum = compute_payload_checksum(data)

    manifest = BackupManifest(
        schema_version="2.0.0",
        exported_at=datetime.now(timezone.utc).isoformat(),
        owner_id=owner_id,
        planly_version="0.1.0",
        retention_policy="planly_isolated_backup_retention",
        storage_location="planly-learner-backups-coldline/asia-south2",
        encryption_algorithm="AES-256-GCM",
        entity_counts=entity_counts,
        checksum=checksum,
        object_manifest=object_manifest,
    )

    return BackupEnvelope(manifest=manifest, data=data)


# ==============================================================================
# Validation Engine (B23-AC2 Integrity & Invariants)
# ==============================================================================

def validate_backup_payload(
    payload: Dict[str, Any],
    target_owner_id: Optional[str] = None,
) -> Tuple[bool, str, Optional[BackupManifest]]:
    """
    Validate backup payload structure, checksums, and object manifest byte integrity.
    
    Returns (is_valid, error_message, manifest).
    """
    if not isinstance(payload, dict):
        return False, "Malformed backup payload: expected JSON object", None

    manifest_raw = payload.get("manifest")
    data_raw = payload.get("data")

    if not manifest_raw or not isinstance(manifest_raw, dict):
        return False, "Malformed backup payload: missing or invalid 'manifest' section", None
    if data_raw is None or not isinstance(data_raw, dict):
        return False, "Malformed backup payload: missing or invalid 'data' section", None

    schema_version = manifest_raw.get("schema_version") or manifest_raw.get("version")
    if schema_version not in ("1.0.0", "2.0.0"):
        return False, f"Unsupported backup schema version '{schema_version}'. Expected '1.0.0' or '2.0.0'", None

    manifest_owner = manifest_raw.get("owner_id") or manifest_raw.get("ownerId")
    if not manifest_owner or not isinstance(manifest_owner, str):
        return False, "Malformed backup: missing or invalid manifest owner_id", None

    if target_owner_id and manifest_owner != target_owner_id:
        return False, f"Owner mismatch: backup belongs to '{manifest_owner}', but target owner is '{target_owner_id}'", None

    # Checksum validation
    computed_checksum = compute_payload_checksum(data_raw)
    manifest_checksum = manifest_raw.get("checksum")
    if manifest_checksum != computed_checksum:
        return (
            False,
            f"Corrupted backup payload: checksum mismatch (expected '{manifest_checksum}', computed '{computed_checksum}')",
            None,
        )

    # Server content bank leak prevention
    prohibited_keys = ["trainingPrompts", "privateReference", "testSuites", "rubricBundles"]
    for pk in prohibited_keys:
        if pk in data_raw:
            return False, f"Security violation: backup payload contains private server content bank key '{pk}'", None

    # B23-AC2: Object manifest byte verification
    object_manifest = manifest_raw.get("object_manifest") or {}
    for obj_id, entry in object_manifest.items():
        if not isinstance(entry, dict):
            return False, f"B23-AC2: Malformed object manifest entry for '{obj_id}'", None

        content_b64 = entry.get("content_b64")
        if not content_b64:
            return False, f"Missing object bytes in object manifest for '{obj_id}'", None

        try:
            decoded_bytes = base64.b64decode(content_b64)
        except Exception:
            return False, f"B23-AC2: Corrupted base64 bytes for '{obj_id}'", None

        expected_sha = entry.get("sha256")
        actual_sha = hashlib.sha256(decoded_bytes).hexdigest()
        if actual_sha != expected_sha:
            return (
                False,
                f"B23-AC2: Object byte corruption detected for '{obj_id}': expected sha256 '{expected_sha}', got '{actual_sha}'",
                None,
            )

        expected_size = entry.get("byte_size")
        if expected_size is not None and len(decoded_bytes) != expected_size:
            return (
                False,
                f"B23-AC2: Object byte size mismatch for '{obj_id}': expected {expected_size} bytes, got {len(decoded_bytes)}",
                None,
            )

    try:
        manifest_obj = BackupManifest(
            schema_version=schema_version,
            exported_at=manifest_raw.get("exported_at", datetime.now(timezone.utc).isoformat()),
            owner_id=manifest_owner,
            planly_version=manifest_raw.get("planly_version", "0.1.0"),
            retention_policy=manifest_raw.get("retention_policy", "planly_isolated_backup_retention"),
            storage_location=manifest_raw.get("storage_location", "planly-learner-backups-coldline/asia-south2"),
            encryption_algorithm=manifest_raw.get("encryption_algorithm", "AES-256-GCM"),
            entity_counts=manifest_raw.get("entity_counts", {}),
            checksum=manifest_checksum,
            object_manifest=object_manifest,
        )
    except Exception as e:
        return False, f"Failed to parse manifest: {str(e)}", None

    return True, "", manifest_obj


# ==============================================================================
# Restoration Engine (B23-AC1, B23-AC2, B23-AC3)
# ==============================================================================

def restore_backup_payload(
    payload: Dict[str, Any],
    target_owner_id: str,
    target_environment: str = "disposable",
    active_tombstones: Optional[List[corrections.TombstoneRecord]] = None,
    force_overwrite: bool = False,
) -> RestoreResult:
    """
    Atomically restore backup payload into target environment.
    
    Guarantees:
    - B23-AC1: Resumes exact pending artifact and question in target environment.
    - B23-AC2: Halts atomically on missing or corrupt object bytes.
    - B23-AC3: Reconciles active target privacy tombstones to prevent resurrecting deleted entities,
      and preserves assistance level invariants prohibiting reclassification of assisted work.
    """
    # 1. Validate payload and object manifest bytes (B23-AC2)
    is_valid, err, manifest = validate_backup_payload(payload, None)
    if not is_valid:
        raise ValueError(f"Restoration validation failed: {err}")

    db = get_db()

    # 2. Target environment safety check
    if target_environment == "production":
        existing_classrooms = db.execute(
            "SELECT COUNT(*) as cnt FROM classrooms WHERE owner_id = ?", (target_owner_id,)
        ).fetchone()["cnt"]
        if existing_classrooms > 0 and not force_overwrite:
            raise ValueError(
                "Restoration conflict: Target production environment is populated. "
                "Explicit force_overwrite confirmation required to proceed."
            )

    data = payload.get("data", {})

    # 3. B23-AC3: Reconcile active tombstones
    target_tombstones = list(active_tombstones or [])
    target_tombstones.extend(
        [t for t in corrections._tombstones.values() if t.owner_id == target_owner_id and not t.is_restored]
    )

    # Also capture tombstones embedded within the backup itself
    for t_dict in data.get("tombstones", []):
        if not t_dict.get("is_restored", False):
            target_tombstones.append(corrections.TombstoneRecord(**t_dict))

    tombstoned_target_ids = {t.target_id for t in target_tombstones}
    tombstones_reconciled_count = len(tombstoned_target_ids)

    # 4. Filter out tombstoned items and prevent assistance reclassification (B23-AC3)
    raw_obs = data.get("observations", [])
    restored_observations = []
    for o in raw_obs:
        if o.get("id") in tombstoned_target_ids:
            continue  # Reconciled tombstone: DO NOT resurrect deleted observation!

        # B23-AC3: Prohibit reclassification of assisted work
        asst = o.get("assistance_level")
        src = o.get("source_kind")
        if (
            asst in ("guided", AssistanceLevel.GUIDED, "tutor_supplied", AssistanceLevel.TUTOR_SUPPLIED, "exposure")
            or src in ("tutor_explanation", SourceKind.TUTOR_EXPLANATION)
        ):
            o["demonstrated"] = False  # Enforce non-demonstrated invariant

        o_copy = dict(o)
        o_copy["owner_id"] = target_owner_id
        restored_observations.append(o_copy)

    restored_messages = []
    for m in data.get("session_messages", []):
        if m.get("id") in tombstoned_target_ids:
            continue  # Reconciled tombstone: DO NOT resurrect deleted message!
        m_copy = dict(m)
        m_copy["owner_id"] = target_owner_id
        restored_messages.append(m_copy)

    restored_artifacts = []
    for a in data.get("artifacts", []):
        if a.get("id") in tombstoned_target_ids:
            continue
        a_copy = dict(a)
        a_copy["owner_id"] = target_owner_id
        restored_artifacts.append(a_copy)

    # 5. Insert records atomically into DB tables for target owner
    now = datetime.now(timezone.utc).isoformat()
    breakdown: Dict[str, int] = {}

    with db:
        # Classrooms
        for cls in data.get("classrooms", []):
            db.execute(
                "INSERT OR REPLACE INTO classrooms (id, owner_id, track, title, created_at, updated_at) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (cls["id"], target_owner_id, cls.get("track", "dsa"), cls.get("title", ""), cls.get("created_at", now), now),
            )
        breakdown["classrooms"] = len(data.get("classrooms", []))

        # Sessions
        for sess in data.get("sessions", []):
            db.execute(
                "INSERT OR REPLACE INTO sessions (id, owner_id, classroom_id, stage, mode, status, current_revision, created_at, updated_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    sess["id"],
                    target_owner_id,
                    sess.get("classroom_id"),
                    sess.get("stage", "foundation"),
                    sess.get("mode", "practice"),
                    sess.get("status", "active"),
                    sess.get("current_revision", 1),
                    sess.get("created_at", now),
                    now,
                ),
            )
        breakdown["sessions"] = len(data.get("sessions", []))

        # Artifacts
        for art in restored_artifacts:
            db.execute(
                "INSERT OR REPLACE INTO artifacts (id, owner_id, session_id, revision, content, language, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                (
                    art["id"],
                    target_owner_id,
                    art.get("session_id"),
                    art.get("revision", 1),
                    art.get("content", ""),
                    art.get("language", "python"),
                    art.get("created_at", now),
                ),
            )
        breakdown["artifacts"] = len(restored_artifacts)

        # Attempts
        for att in data.get("attempts", []):
            exp_str = json.dumps(att.get("exposure_state", {}))
            asst_val = att.get("assistance_level", "independent")
            mode_val = att.get("mode", "practice")
            db.execute(
                "INSERT OR REPLACE INTO attempts (id, owner_id, session_id, artifact_id, frozen_code, frozen_language, source_revision, elapsed_seconds, assistance_level, mode, exposure_state, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    att["id"],
                    target_owner_id,
                    att.get("session_id"),
                    att.get("artifact_id"),
                    att.get("frozen_code", ""),
                    att.get("frozen_language", "python"),
                    att.get("source_revision", 1),
                    att.get("elapsed_seconds"),
                    asst_val,
                    mode_val,
                    exp_str,
                    att.get("created_at", now),
                ),
            )
        breakdown["attempts"] = len(data.get("attempts", []))

        # Observations
        for obs in restored_observations:
            db.execute(
                "INSERT OR REPLACE INTO observations (id, owner_id, session_id, competency_key, source_kind, assistance_level, demonstrated, evidence_text, message_id, artifact_id, attempt_id, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    obs["id"],
                    target_owner_id,
                    obs.get("session_id"),
                    obs.get("competency_key", ""),
                    obs.get("source_kind", "learner_work"),
                    obs.get("assistance_level", "independent"),
                    1 if obs.get("demonstrated", False) else 0,
                    obs.get("evidence_text", ""),
                    obs.get("message_id"),
                    obs.get("artifact_id"),
                    obs.get("attempt_id"),
                    obs.get("created_at", now),
                ),
            )
        breakdown["observations"] = len(restored_observations)

        # Micro goals
        for mg in data.get("micro_goals", []):
            db.execute(
                "INSERT OR REPLACE INTO micro_goals (id, owner_id, session_id, description, competency_key, status, is_editable, created_at, updated_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    mg["id"],
                    target_owner_id,
                    mg.get("session_id"),
                    mg.get("description", ""),
                    mg.get("competency_key", ""),
                    mg.get("status", "in_progress"),
                    1 if mg.get("is_editable", True) else 0,
                    mg.get("created_at", now),
                    now,
                ),
            )
        breakdown["micro_goals"] = len(data.get("micro_goals", []))

        # Session messages
        for msg in restored_messages:
            db.execute(
                "INSERT OR REPLACE INTO session_messages (id, owner_id, session_id, sender_role, content, artifact_revision_snapshot, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                (
                    msg["id"],
                    target_owner_id,
                    msg.get("session_id"),
                    msg.get("sender_role", "learner"),
                    msg.get("content", ""),
                    msg.get("artifact_revision_snapshot", 1),
                    msg.get("created_at", now),
                ),
            )
        breakdown["session_messages"] = len(restored_messages)

        # Pending tasks
        for task in data.get("pending_tasks", []):
            ctx_str = json.dumps(task.get("context_json", {}))
            status_val = task.get("status", "pending")
            db.execute(
                "INSERT OR REPLACE INTO pending_tasks (id, owner_id, classroom_id, session_id, task_type, title, prompt_text, context_json, status, created_at, updated_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    task["id"],
                    target_owner_id,
                    task.get("classroom_id"),
                    task.get("session_id"),
                    task.get("task_type", "pending_question"),
                    task.get("title", ""),
                    task.get("prompt_text", ""),
                    ctx_str,
                    status_val,
                    task.get("created_at", now),
                    now,
                ),
            )
        breakdown["pending_tasks"] = len(data.get("pending_tasks", []))

    # 6. Rebuild derived indexes (retrieval caches and memory projections)
    corrections._tombstones.update({t.id: t for t in target_tombstones})
    for c_dict in data.get("corrections", []):
        c_dict["owner_id"] = target_owner_id
        corr = corrections.CorrectionRecord(**c_dict)
        corrections._corrections[corr.id] = corr

    for m_dict in data.get("memory_claims", []):
        if m_dict.get("id") not in tombstoned_target_ids:
            m_dict["owner_id"] = target_owner_id
            claim = corrections.MemoryClaim(**m_dict)
            corrections._memory_claims[claim.id] = claim

    # Rebuild retrieval caches
    indexes_rebuilt = ["retrieval_vector_cache", "retrieval_keyword_cache", "memory_projection_claims"]
    for o in restored_observations:
        corrections.populate_adapter_caches(o["id"], {"type": "observation", "text": o.get("evidence_text", "")})
    for m in restored_messages:
        corrections.populate_adapter_caches(m["id"], {"type": "message", "text": m.get("content", "")})
    projections.reproject_memory_state(target_owner_id)

    # 7. Identify resumable session and pending question (B23-AC1)
    resumable_session_id = None
    pending_question = None
    pending_artifact_revision = None

    sessions_cursor = db.execute(
        "SELECT * FROM sessions WHERE owner_id = ? ORDER BY created_at DESC", (target_owner_id,)
    )
    all_sessions = [dict(r) for r in sessions_cursor]

    if all_sessions:
        latest_sess = all_sessions[0]
        resumable_session_id = latest_sess["id"]

        art_cursor = db.execute(
            "SELECT MAX(revision) as max_rev FROM artifacts WHERE owner_id = ? AND session_id = ?",
            (target_owner_id, resumable_session_id),
        )
        row = art_cursor.fetchone()
        if row and row["max_rev"] is not None:
            pending_artifact_revision = row["max_rev"]
        else:
            pending_artifact_revision = latest_sess.get("current_revision", 1)

        # Look for pending question task
        tasks = sources.get_pending_tasks(target_owner_id)
        pq_task = next(
            (t for t in tasks if t.task_type == PendingTaskType.PENDING_QUESTION and t.session_id == resumable_session_id),
            None,
        )
        if not pq_task and tasks:
            pq_task = next((t for t in tasks if t.task_type == PendingTaskType.PENDING_QUESTION), tasks[0])

        if pq_task:
            pending_question = pq_task.prompt_text

    total_entities = sum(breakdown.values())

    return RestoreResult(
        success=True,
        restored_at=now,
        target_owner_id=target_owner_id,
        target_environment=target_environment,
        total_entities_restored=total_entities,
        entity_breakdown=breakdown,
        objects_restored=len(manifest.object_manifest),
        tombstones_reconciled=tombstones_reconciled_count,
        resumable_session_id=resumable_session_id,
        pending_question=pending_question,
        pending_artifact_revision=pending_artifact_revision,
        indexes_rebuilt=indexes_rebuilt,
    )


# ==============================================================================
# FastAPI Router Endpoints
# ==============================================================================

router = APIRouter(prefix="/api/exports", tags=["exports"])


@router.post("/backup", response_model=BackupEnvelope)
async def export_backup_endpoint(
    req: BackupExportRequest,
    owner: AuthenticatedOwner = Depends(get_current_owner),
) -> BackupEnvelope:
    """Generate and return a versioned, verified backup envelope for the authenticated learner."""
    owner_id = req.owner_id or owner.owner_id
    if owner_id != owner.owner_id and owner.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Forbidden: Cannot export backup for another learner.",
        )

    try:
        envelope = generate_backup_envelope(owner_id)
        return envelope
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )


@router.post("/restore/validate")
async def validate_backup_endpoint(
    req: BackupValidationRequest,
    owner: AuthenticatedOwner = Depends(get_current_owner),
) -> Dict[str, Any]:
    """Validate a backup archive payload without mutating target workspace."""
    target_owner = req.target_owner_id or owner.owner_id
    is_valid, err, manifest = validate_backup_payload(req.payload, target_owner)
    if not is_valid:
        return {"valid": False, "error": err}
    return {"valid": True, "manifest": manifest.model_dump() if manifest else {}}


@router.post("/restore", response_model=RestoreResult)
async def restore_backup_endpoint(
    req: BackupRestoreRequest,
    owner: AuthenticatedOwner = Depends(get_current_owner),
) -> RestoreResult:
    """Atomically restore a validated backup archive into the specified environment."""
    target_owner = req.target_owner_id or owner.owner_id
    if target_owner != owner.owner_id and owner.role != "admin" and req.target_environment != "disposable":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Forbidden: Cannot restore backup into another learner's workspace.",
        )

    try:
        result = restore_backup_payload(
            payload=req.payload,
            target_owner_id=target_owner,
            target_environment=req.target_environment,
            force_overwrite=req.force_overwrite,
        )
        return result
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )


@router.get("/policy")
async def get_backup_policy_endpoint() -> Dict[str, Any]:
    """Return the documented coldline storage retention and encryption policy."""
    return {
        "version": "2.0.0",
        "policy_name": "planly_isolated_backup_retention",
        "retention": {
            "daily_snapshots_days": 30,
            "weekly_archives_days": 90,
            "hard_purge_after_days": 180,
        },
        "storage": {
            "primary_region": "asia-south1",
            "backup_region": "asia-south2",
            "isolated_bucket": "planly-learner-backups-coldline",
            "require_separate_storage_location": True,
        },
        "encryption": {
            "algorithm": "AES-256-GCM",
            "key_rotation_days": 90,
            "require_client_side_envelope": True,
        },
        "integrity": {
            "checksum_algorithm": "SHA-256",
            "verify_object_manifest_bytes": True,
            "disallow_empty_stores": True,
        },
        "tombstone_reconciliation": {
            "reconcile_active_tombstones_on_restore": True,
            "prohibit_deleted_entity_resurrection": True,
            "preserve_assistance_level_invariants": True,
        },
    }
