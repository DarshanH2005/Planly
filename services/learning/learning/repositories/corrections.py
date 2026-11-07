import json
import uuid
from datetime import datetime, timezone
from typing import Optional, List, Dict, Any, Tuple
from pydantic import BaseModel, Field

from learning.domain.contracts import (
    SourceKind,
    AssistanceLevel,
    LearningObservation,
)
from learning.repositories import evidence
from learning.repositories.db import get_db

class TombstoneRecord(BaseModel):
    id: str = Field(default_factory=lambda: f"tomb_{uuid.uuid4().hex[:12]}")
    owner_id: str
    target_id: str
    target_type: str
    reason: str
    deleted_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    restore_token: str = Field(default_factory=lambda: f"rst_{uuid.uuid4().hex[:16]}")
    is_restored: bool = False

class CorrectionRecord(BaseModel):
    id: str = Field(default_factory=lambda: f"corr_{uuid.uuid4().hex[:12]}")
    owner_id: str
    target_observation_id: str
    prior_competency_key: str
    new_competency_key: str
    prior_demonstrated: bool
    new_demonstrated: bool
    source_kind: SourceKind
    assistance_level: AssistanceLevel
    correction_note: str
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    status: str = "applied"

class MemoryClaim(BaseModel):
    id: str = Field(default_factory=lambda: f"claim_{uuid.uuid4().hex[:12]}")
    owner_id: str
    competency_key: str
    claim_text: str
    source_observation_ids: List[str] = Field(default_factory=list)
    is_misconception: bool = False
    status: str = "active"
    demonstrated: bool = False
    source_kind: SourceKind = SourceKind.LEARNER_WORK
    assistance_level: AssistanceLevel = AssistanceLevel.INDEPENDENT
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    updated_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

class CachedSummaryRecord(BaseModel):
    id: str = Field(default_factory=lambda: f"summ_{uuid.uuid4().hex[:12]}")
    owner_id: str
    summary_text: str
    referenced_misconceptions: List[str] = Field(default_factory=list)
    referenced_observation_ids: List[str] = Field(default_factory=list)
    is_invalidated: bool = False
    invalidation_reason: Optional[str] = None
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

_tombstones: Dict[str, TombstoneRecord] = {}
_corrections: Dict[str, CorrectionRecord] = {}
_memory_claims: Dict[str, MemoryClaim] = {}
_cached_summaries: Dict[str, CachedSummaryRecord] = {}

def reset_corrections_store():
    _tombstones.clear()
    _corrections.clear()
    _memory_claims.clear()
    _cached_summaries.clear()
    db = get_db()
    with db:
        db.execute("DELETE FROM tombstones")
        db.execute("DELETE FROM corrections")
        db.execute("DELETE FROM memory_claims")
        db.execute("DELETE FROM cached_summaries")
        db.execute("DELETE FROM vector_cache")
        db.execute("DELETE FROM keyword_cache")
        db.execute("DELETE FROM invalidated_misconceptions")

def register_cached_summary(
    owner_id: str,
    summary_text: str,
    referenced_misconceptions: Optional[List[str]] = None,
    referenced_observation_ids: Optional[List[str]] = None,
) -> CachedSummaryRecord:
    db = get_db()
    summary = CachedSummaryRecord(
        owner_id=owner_id,
        summary_text=summary_text,
        referenced_misconceptions=referenced_misconceptions or [],
        referenced_observation_ids=referenced_observation_ids or [],
    )
    with db:
        db.execute(
            "INSERT INTO cached_summaries (id, owner_id, session_id, summary_text, revision_up_to, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            (summary.id, owner_id, "", json.dumps(summary.model_dump()), 0, summary.created_at)
        )
    return summary

def invalidate_misconception(
    owner_id: str,
    competency_key: str,
    reason: str = "Learner demonstrated understanding or retracted misconception.",
) -> Dict[str, Any]:
    db = get_db()
    invalidated_claims = []
    invalidated_summaries = []
    
    with db:
        # Invalidated claims
        cursor = db.execute("SELECT id, content FROM memory_claims WHERE owner_id = ?", (owner_id,))
        for row in cursor:
            claim_data = json.loads(row["content"])
            if claim_data.get("competency_key") == competency_key and claim_data.get("status") != "invalidated":
                claim_data["status"] = "invalidated"
                claim_data["updated_at"] = datetime.now(timezone.utc).isoformat()
                db.execute("UPDATE memory_claims SET content = ? WHERE id = ?", (json.dumps(claim_data), row["id"]))
                invalidated_claims.append(row["id"])
                
        # Invalidated summaries
        cursor = db.execute("SELECT id, summary_text FROM cached_summaries WHERE owner_id = ?", (owner_id,))
        for row in cursor:
            summ_data = json.loads(row["summary_text"])
            if not summ_data.get("is_invalidated") and competency_key in summ_data.get("referenced_misconceptions", []):
                summ_data["is_invalidated"] = True
                summ_data["invalidation_reason"] = f"Referenced misconception '{competency_key}' was invalidated: {reason}"
                db.execute("UPDATE cached_summaries SET summary_text = ? WHERE id = ?", (json.dumps(summ_data), row["id"]))
                invalidated_summaries.append(row["id"])
                
        # Invalidated misconceptions
        db.execute("INSERT INTO invalidated_misconceptions (id, owner_id, misconception_text, invalidated_at) VALUES (?, ?, ?, ?)",
                   (str(uuid.uuid4()), owner_id, competency_key, datetime.now(timezone.utc).isoformat()))

    return {
        "competency_key": competency_key,
        "invalidated_claims": invalidated_claims,
        "invalidated_summaries": invalidated_summaries,
    }

def get_invalidated_misconceptions(owner_id: str) -> List[str]:
    db = get_db()
    cursor = db.execute("SELECT misconception_text FROM invalidated_misconceptions WHERE owner_id = ?", (owner_id,))
    return [row["misconception_text"] for row in cursor]

def query_active_summary(owner_id: str) -> Optional[CachedSummaryRecord]:
    db = get_db()
    cursor = db.execute("SELECT summary_text FROM cached_summaries WHERE owner_id = ?", (owner_id,))
    candidates = []
    for row in cursor:
        summ = CachedSummaryRecord(**json.loads(row["summary_text"]))
        if not summ.is_invalidated:
            candidates.append(summ)
    if not candidates:
        return None
    candidates.sort(key=lambda s: s.created_at, reverse=True)
    return candidates[0]

def populate_adapter_caches(
    target_id: str,
    payload: Dict[str, Any],
):
    db = get_db()
    with db:
        db.execute("INSERT OR REPLACE INTO vector_cache (id, owner_id, text_hash, embedding, model_version, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                   (target_id, "sys", "hash", json.dumps({"vector_embedding": [0.1, 0.2, 0.3], "payload": payload}), "v1", datetime.now(timezone.utc).isoformat()))
        db.execute("INSERT OR REPLACE INTO keyword_cache (id, owner_id, keyword, entity_id, entity_type, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                   (target_id, "sys", json.dumps({"tokens": ["inverted", "index"], "payload": payload}), target_id, "payload", datetime.now(timezone.utc).isoformat()))

def delete_source_data_with_tombstone(
    owner_id: str,
    target_id: str,
    target_type: str,
    reason: str = "User explicit privacy deletion request.",
) -> TombstoneRecord:
    db = get_db()
    tombstone = TombstoneRecord(owner_id=owner_id, target_id=target_id, target_type=target_type, reason=reason)
    with db:
        db.execute("INSERT INTO tombstones (id, owner_id, entity_id, entity_type, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                   (tombstone.id, owner_id, target_id, target_type, reason, tombstone.deleted_at))
        
        db.execute("DELETE FROM vector_cache WHERE id = ?", (target_id,))
        db.execute("DELETE FROM keyword_cache WHERE id = ?", (target_id,))
        
        cursor = db.execute("SELECT id, summary_text FROM cached_summaries WHERE owner_id = ?", (owner_id,))
        for row in cursor:
            summ_data = json.loads(row["summary_text"])
            if target_id in summ_data.get("referenced_observation_ids", []):
                summ_data["is_invalidated"] = True
                summ_data["invalidation_reason"] = f"Source {target_id} was deleted under tombstone {tombstone.id}."
                db.execute("UPDATE cached_summaries SET summary_text = ? WHERE id = ?", (json.dumps(summ_data), row["id"]))
                
        cursor = db.execute("SELECT id, content FROM memory_claims WHERE owner_id = ?", (owner_id,))
        for row in cursor:
            claim_data = json.loads(row["content"])
            if target_id in claim_data.get("source_observation_ids", []):
                claim_data["status"] = "invalidated"
                claim_data["updated_at"] = datetime.now(timezone.utc).isoformat()
                db.execute("UPDATE memory_claims SET content = ? WHERE id = ?", (json.dumps(claim_data), row["id"]))
                
    _tombstones[tombstone.id] = tombstone
    return tombstone

def is_target_deleted_or_tombstoned(owner_id: str, target_id: str) -> bool:
    for t in _tombstones.values():
        if t.owner_id == owner_id and t.target_id == target_id and not t.is_restored:
            return True
    db = get_db()
    cursor = db.execute("SELECT * FROM tombstones WHERE owner_id = ? AND entity_id = ?", (owner_id, target_id))
    return cursor.fetchone() is not None

def query_retrieval_adapters(owner_id: str, target_id: str) -> Dict[str, Any]:
    db = get_db()
    if is_target_deleted_or_tombstoned(owner_id, target_id):
        return {
            "target_id": target_id,
            "status": "tombstoned",
            "vector_cache_hit": False,
            "keyword_cache_hit": False,
            "data": None,
        }
        
    vec = db.execute("SELECT embedding FROM vector_cache WHERE id = ?", (target_id,)).fetchone()
    kw = db.execute("SELECT keyword FROM keyword_cache WHERE id = ?", (target_id,)).fetchone()
    
    vec_data = json.loads(vec["embedding"]) if vec else None
    kw_data = json.loads(kw["keyword"]) if kw else None
    
    return {
        "target_id": target_id,
        "status": "active",
        "vector_cache_hit": vec is not None,
        "keyword_cache_hit": kw is not None,
        "data": vec_data or kw_data,
    }

def restore_from_tombstone(
    owner_id: str,
    tombstone_id: str,
    restore_token: str,
) -> bool:
    if tombstone_id in _tombstones:
        _tombstones[tombstone_id].is_restored = True
    db = get_db()
    with db:
        cursor = db.execute("SELECT * FROM tombstones WHERE id = ? AND owner_id = ?", (tombstone_id, owner_id))
        if cursor.fetchone():
            db.execute("DELETE FROM tombstones WHERE id = ? AND owner_id = ?", (tombstone_id, owner_id))
            return True
    return False

def list_tombstones(owner_id: str) -> List[TombstoneRecord]:
    seen_ids = set()
    res = []
    for t in _tombstones.values():
        if t.owner_id == owner_id and not t.is_restored:
            seen_ids.add(t.id)
            res.append(t)
    db = get_db()
    cursor = db.execute("SELECT id, owner_id, entity_id as target_id, entity_type as target_type, reason, created_at as deleted_at FROM tombstones WHERE owner_id = ?", (owner_id,))
    for row in cursor:
        if row["id"] not in seen_ids:
            rec = TombstoneRecord(**dict(row))
            seen_ids.add(rec.id)
            res.append(rec)
    return res

def apply_learner_correction(
    owner_id: str,
    target_observation_id: str,
    new_competency_key: str,
    correction_note: str,
    is_self_report: bool = True,
    attempted_direct_override: bool = False,
) -> Tuple[CorrectionRecord, LearningObservation]:
    all_obs = evidence.get_observations(owner_id)
    target_obs = next((o for o in all_obs if o.id == target_observation_id), None)
    prior_key = target_obs.competency_key if target_obs else "unknown"
    prior_dem = target_obs.demonstrated if target_obs else False

    if is_self_report:
        new_source_kind = SourceKind.SELF_REPORT
        new_assistance = AssistanceLevel.UNASSESSED
        new_demonstrated = False
    else:
        new_source_kind = SourceKind.LEARNER_WORK
        new_assistance = AssistanceLevel.INDEPENDENT
        new_demonstrated = True

    sess_id = target_obs.session_id if target_obs else "sess-correction"
    new_obs = evidence.record_observation(
        owner_id=owner_id,
        session_id=sess_id,
        competency_key=new_competency_key,
        source_kind=new_source_kind,
        assistance_level=new_assistance,
        demonstrated=new_demonstrated,
        evidence_text=f"Learner correction: {correction_note}. Appropriately qualified.",
    )

    correction = CorrectionRecord(
        owner_id=owner_id,
        target_observation_id=target_observation_id,
        prior_competency_key=prior_key,
        new_competency_key=new_competency_key,
        prior_demonstrated=prior_dem,
        new_demonstrated=new_demonstrated,
        source_kind=new_source_kind,
        assistance_level=new_assistance,
        correction_note=correction_note,
    )
    
    claim = MemoryClaim(
        owner_id=owner_id,
        competency_key=new_competency_key,
        claim_text=f"Learner self-reported understanding: {correction_note}",
        source_observation_ids=[new_obs.id],
        is_misconception=False,
        status="active",
        demonstrated=new_demonstrated,
        source_kind=new_source_kind,
        assistance_level=new_assistance,
    )
    
    db = get_db()
    with db:
        db.execute(
            "INSERT INTO corrections (id, owner_id, session_id, target_message_id, correction_text, applied, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (correction.id, owner_id, sess_id, target_observation_id, json.dumps(correction.model_dump()), 1, correction.created_at)
        )
        db.execute(
            "INSERT INTO memory_claims (id, owner_id, claim_type, content, confidence, source_session_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (claim.id, owner_id, "claim", json.dumps(claim.model_dump()), 1.0, sess_id, claim.created_at)
        )

    return correction, new_obs

def get_memory_claims(owner_id: str) -> List[MemoryClaim]:
    db = get_db()
    cursor = db.execute("SELECT content FROM memory_claims WHERE owner_id = ?", (owner_id,))
    claims = [MemoryClaim(**json.loads(row["content"])) for row in cursor]
    return [c for c in claims if c.status == "active"]

def get_claims_by_owner(owner_id: str) -> List[MemoryClaim]:
    db = get_db()
    cursor = db.execute("SELECT content FROM memory_claims WHERE owner_id = ?", (owner_id,))
    return [MemoryClaim(**json.loads(row["content"])) for row in cursor]

def get_corrections_by_owner(owner_id: str) -> List[CorrectionRecord]:
    db = get_db()
    cursor = db.execute("SELECT correction_text FROM corrections WHERE owner_id = ?", (owner_id,))
    return [CorrectionRecord(**json.loads(row["correction_text"])) for row in cursor]

def get_tombstones_by_owner(owner_id: str) -> List[TombstoneRecord]:
    return list_tombstones(owner_id)
