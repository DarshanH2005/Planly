"""
Context Packet Assembler.
Combines directly loaded lesson state, hybrid episode retrieval, and explicit graph links.
Enforces B07-AC3: Stale index projection cannot hide current work; extraction failure still allows raw-turn retrieval.
Sprint: B07
"""

from typing import Optional, List, Dict, Any

from learning.domain.contracts import (
    ContextPacket,
    SessionMode,
    PendingTaskStatus,
)
from learning.repositories.evidence import (
    get_session,
    get_artifact,
    get_session_observations,
    get_session_messages,
    get_lesson_handoffs,
    get_classroom,
)
from learning.repositories.sources import (
    get_pending_tasks,
    get_owner_source_documents,
    get_source_turns,
)
from learning.repositories.graph import (
    find_superseding_evidence,
    find_prerequisites,
    expand_graph,
)
from learning.retrieval.hybrid import HybridRetriever, RetrievalFilter


def assemble_context_packet(
    session_id: str,
    owner_id: str,
    query_text: str = "",
    cutoff_timestamp: Optional[str] = None,
    allow_retry: bool = True,
    retriever: Optional[HybridRetriever] = None,
) -> ContextPacket:
    """
    Assembles authoritative ContextPacket for teaching decisions.
    Directly loads current artifact and pending question, combining with hybrid episode retrieval
    and explicit learning links graph.
    """
    retriever = retriever or HybridRetriever()

    # 1. Authoritative Direct State Loading (B07-AC3)
    # Never relies on retrieval luck for current code, revision, or pending question
    session = get_session(owner_id=owner_id, session_id=session_id)
    from learning.learner.activities import activity_for_session
    activity = activity_for_session(owner_id, session_id)
    session_mode = session.mode if session else SessionMode.PRACTICE

    artifact = get_artifact(owner_id=owner_id, session_id=session_id)
    active_revision = artifact.revision if artifact else (session.current_revision if session else 1)
    artifact_content = artifact.content if artifact else ""

    classroom_id = session.classroom_id if session else "cls_default"
    pending_tasks = get_pending_tasks(
        owner_id=owner_id,
        classroom_id=classroom_id,
        status=PendingTaskStatus.PENDING,
    )
    pending_tasks = [task for task in pending_tasks if task.session_id == session_id]
    pending_question = pending_tasks[0].prompt_text if pending_tasks else None

    # Load validated observations
    observations = get_session_observations(owner_id=owner_id, session_id=session_id)
    observed_competencies = list(set(o.competency_key for o in observations if o.demonstrated))

    # Recent dialogue is intentionally bounded. Full history remains durable in
    # SQLite and is retrieved/summarised on demand instead of consuming context.
    recent_messages = [m.model_dump() for m in get_session_messages(owner_id, session_id)[-8:]]
    parent_context = None
    if session and session.parent_session_id:
        handoffs = get_lesson_handoffs(owner_id, session.parent_session_id)
        from learning.workflows.coach import memory_records, conversation_memory
        parent_messages = get_session_messages(owner_id, session.parent_session_id)
        # Keep complete recent planning turns within a fixed bound.
        planning_turns = []
        remaining = 6000
        for message in reversed(parent_messages):
            if len(message.content) > remaining or len(planning_turns) >= 4:
                break
            planning_turns.append({"role": message.sender_role, "content": message.content})
            remaining -= len(message.content)
        parent_context = {
            "lesson_goal": session.title,
            "coach_checkpoint": conversation_memory(owner_id, session.parent_session_id)["summary"],
            "coach_dialogue": list(reversed(planning_turns)),
            "reviewed_learning_history": [
                {"source": item["filename"], "summary": item["summary"][:3000]}
                for item in memory_records(owner_id)[:1]
            ],
            "recent_lesson_returns_unverified": [
                {"title": item["title"], "summary": item["summary"][:600]}
                for item in handoffs[:3]
            ],
        }

    # 2. Hybrid Episode Retrieval
    search_filter = RetrievalFilter(
        owner_id=owner_id,
        session_id=session_id,
        cutoff_timestamp=cutoff_timestamp,
        visibility="candidate_facing",
    )

    candidates = []
    from learning.workflows.coach import retrieval_terms
    meaningful_query = bool(retrieval_terms(query_text))
    if meaningful_query:
        candidates = retriever.search(query=query_text, filter_criteria=search_filter, limit=5)

        # 3. Targeted Single Retry (B07 requirement 3)
        # If no candidates matched and retry is permitted, attempt targeted fallback
        if not candidates and allow_retry and pending_question:
            fallback_query = pending_question[:50]
            candidates = retriever.search(
                query=fallback_query,
                filter_criteria=search_filter,
                limit=3,
            )

    source_coverage: List[str] = []
    source_episodes: List[Dict[str, Any]] = []

    for c in candidates:
        source_coverage.append(c.episode.id)
        source_episodes.append({
            "episode_id": c.episode.id,
            "title": c.episode.title,
            "speaker": c.episode.speaker,
            "content": c.episode.content,
            "code_snippet": c.episode.code_snippet,
            "turn_index": c.episode.turn_index,
            "rrf_score": c.rrf_score,
        })

    # 3b. Fallback Raw-Turn Retrieval on Extraction Failure (B07-AC3)
    # If extraction failed or index projection is missing, directly query raw turns
    if not candidates and meaningful_query:
        owner_docs = get_owner_source_documents(owner_id=owner_id)
        query_words = [w.lower() for w in query_text.split() if len(w) > 2]
        for doc in owner_docs:
            raw_turns = get_source_turns(doc.id)
            for t in raw_turns:
                t_lower = t.content.lower()
                matches = sum(1 for w in query_words if w in t_lower)
                if matches > 0:
                    first_code = None
                    if t.code_blocks:
                        cb = t.code_blocks[0]
                        first_code = cb.get("code") if isinstance(cb, dict) else getattr(cb, "code", None)
                    source_coverage.append(f"turn_{t.id}")
                    source_episodes.append({
                        "episode_id": f"turn_{t.id}",
                        "title": f"Raw Source Turn {t.turn_index} ({doc.track})",
                        "speaker": t.speaker,
                        "content": t.content,
                        "code_snippet": first_code,
                        "turn_index": t.turn_index,
                        "rrf_score": 0.01 * matches,
                        "is_raw_turn_fallback": True,
                    })
                    if len(source_episodes) >= 3:
                        break
            if len(source_episodes) >= 3:
                break

    # 4. Explicit Learning Links Graph Traversal
    superseded_evidence: List[Dict[str, Any]] = []
    for c in candidates:
        contra_links = find_superseding_evidence(owner_id=owner_id, target_id=c.episode.id)
        for link in contra_links:
            superseded_evidence.append({
                "target_id": link.target_id,
                "superseded_by": link.source_id,
                "relation_type": link.relation_type,
                "confidence": link.confidence,
                "provenance": link.provenance,
            })

    # Determine track from classroom
    track = "dsa"
    if session and session.classroom_id:
        cls_record = get_classroom(owner_id=owner_id, classroom_id=session.classroom_id)
        if cls_record:
            track = cls_record.track

    # Assemble and return immutable ContextPacket
    return ContextPacket(
        session_id=session_id,
        owner_id=owner_id,
        active_revision=active_revision,
        artifact_content=artifact_content,
        pending_question=pending_question,
        permitted_references=["python_docs", "dsa_curriculum", "cs_curriculum"],
        observed_competencies=observed_competencies,
        recent_messages=recent_messages,
        parent_context=parent_context,
        source_episodes=source_episodes,
        source_coverage=source_coverage,
        superseded_evidence=superseded_evidence,
        mode=session_mode,
        exposure_snapshot=None,
        track=track,
        activity_id=activity.id if activity else None,
        competency_key=activity.competency_key if activity else None,
    )
