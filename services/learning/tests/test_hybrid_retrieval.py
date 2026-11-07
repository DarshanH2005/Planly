"""
Automated Boundary Tests for Hybrid Retrieval, Explicit Graph Links, and Context Assembly.
Sprint: B07
Verifies:
- B07-AC1: Retrieve the dictionary-call and fixed-x loop episodes with the correct source text.
- B07-AC2: Wrong-owner, evaluator-only and future-cutoff records never enter a candidate-facing packet.
- B07-AC3: Stale index projection cannot hide current work; extraction failure still allows raw-turn retrieval.
"""

import json
import os
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path

# Add services/learning to sys.path
LEARNING_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(LEARNING_DIR))

from learning.domain.contracts import (
    EpisodeRecord,
    ContextPacket,
    SessionMode,
    PendingTaskType,
    PendingTaskStatus,
)
from learning.repositories.identity import reset_identity_store, bootstrap_allowed_owner
from learning.repositories.evidence import (
    reset_evidence_store,
    create_classroom,
    create_session,
    save_artifact,
)
from learning.repositories.sources import (
    reset_sources_store,
    create_or_update_pending_task,
    store_source_document,
    store_source_turns,
)
from learning.repositories.graph import (
    reset_graph_store,
    add_learning_link,
    expand_graph,
    find_superseding_evidence,
)
from learning.retrieval.indexer import (
    EpisodeIndexer,
    get_episode_indexer,
    reset_episode_store,
)
from learning.retrieval.hybrid import HybridRetriever, RetrievalFilter
from learning.retrieval.context_assembler import assemble_context_packet
from learning.api.main import app

OWNER_A = "00000000-0000-0000-0000-000000000001"
OWNER_B = "00000000-0000-0000-0000-000000000002"
DSA_EXPORT_PATH = "C:/Users/darsh/Downloads/darshan_dsa_chat_export.md"


import base64
import time


def _make_jwt(payload: dict) -> str:
    header = {"alg": "HS256", "typ": "JWT"}
    h_b64 = base64.urlsafe_b64encode(json.dumps(header).encode()).decode().rstrip("=")
    p_b64 = base64.urlsafe_b64encode(json.dumps(payload).encode()).decode().rstrip("=")
    dummy_sig = base64.urlsafe_b64encode(b"dummy_sig_12345678").decode().rstrip("=")
    return f"{h_b64}.{p_b64}.{dummy_sig}"


def setup_function():
    reset_identity_store()
    reset_evidence_store()
    reset_sources_store()
    reset_graph_store()
    reset_episode_store()


# --------------------------------------------------------------------------
# ASGI Dispatch Helper
# --------------------------------------------------------------------------

def _dispatch_asgi(method: str, path: str, body: dict = None, headers: dict = None) -> tuple[int, dict]:
    raw_body = json.dumps(body).encode("utf-8") if body else b""
    default_headers = [
        (b"content-type", b"application/json"),
        (b"content-length", str(len(raw_body)).encode("utf-8")),
    ]
    if headers:
        for k, v in headers.items():
            default_headers.append((k.lower().encode("utf-8"), v.encode("utf-8")))

    response_status = 0
    response_body = b""

    async def receive():
        return {"type": "http.request", "body": raw_body, "more_body": False}

    async def send(message):
        nonlocal response_status, response_body
        if message["type"] == "http.response.start":
            response_status = message["status"]
        elif message["type"] == "http.response.body":
            response_body += message.get("body", b"")

    import asyncio
    scope = {
        "type": "http",
        "method": method,
        "path": path,
        "query_string": b"",
        "headers": default_headers,
    }
    asyncio.run(app(scope, receive, send))
    parsed = json.loads(response_body.decode("utf-8")) if response_body else {}
    return response_status, parsed


# --------------------------------------------------------------------------
# B07-AC1: Retrieve dictionary-call and fixed-x loop episodes
# --------------------------------------------------------------------------

def test_retrieve_dictionary_call_and_fixed_x_episodes():
    indexer = EpisodeIndexer()
    session_id = "sess_dsa_001"

    # Index real chat export
    indexed = indexer.index_chat_export(
        filepath=DSA_EXPORT_PATH,
        owner_id=OWNER_A,
        session_id=session_id,
        track="dsa",
    )
    assert len(indexed) >= 2, "Must index at least the dictionary-call and fixed-x loop episodes"

    retriever = HybridRetriever(indexer=indexer)
    search_filter = RetrievalFilter(owner_id=OWNER_A, session_id=session_id)

    # 1. Search for dictionary-call episode
    dict_query = "dictionary access syntax error freq(x) vs freq.get"
    dict_results = retriever.search(query=dict_query, filter_criteria=search_filter, limit=3)
    assert len(dict_results) > 0, "Dictionary search should return candidates"

    top_dict = dict_results[0].episode
    assert "freq(x)" in top_dict.content or "freq(x)" in (top_dict.code_snippet or "")
    assert "freq.get" in top_dict.content
    print(f"B07-AC1: Retrieved dictionary-call episode '{top_dict.title}': PASSED")

    # 2. Search for fixed-x loop episode
    fixed_query = "while x+1 in nums fixed starting value current changes"
    fixed_results = retriever.search(query=fixed_query, filter_criteria=search_filter, limit=3)
    assert len(fixed_results) > 0, "Fixed-x loop search should return candidates"

    top_fixed = fixed_results[0].episode
    assert "fixed starting value" in top_fixed.content
    assert "while current + 1 in num_set" in top_fixed.content or "num_set" in (top_fixed.code_snippet or "")
    print(f"B07-AC1: Retrieved fixed-x loop episode '{top_fixed.title}': PASSED")


def test_eval_cases_retrieval_benchmarks():
    """
    Validates official benchmark cases in evals/cases/retrieval/.
    """
    eval_dir = LEARNING_DIR.parent.parent / "evals" / "cases" / "retrieval"
    assert eval_dir.exists(), f"Evals retrieval dir missing at {eval_dir}"

    indexer = EpisodeIndexer()
    session_id = "sess_eval_benchmark"
    indexed = indexer.index_chat_export(
        filepath=DSA_EXPORT_PATH,
        owner_id=OWNER_A,
        session_id=session_id,
        track="dsa",
    )
    retriever = HybridRetriever(indexer=indexer)
    search_filter = RetrievalFilter(owner_id=OWNER_A, session_id=session_id)

    # 1. Dictionary call case
    dict_case_path = eval_dir / "test_dictionary_call_episode.json"
    with open(dict_case_path, encoding="utf-8") as f:
        dict_case = json.load(f)

    dict_results = retriever.search(query=dict_case["query"], filter_criteria=search_filter, limit=3)
    assert len(dict_results) > 0
    top_dict = dict_results[0]
    assert top_dict.episode.title == dict_case["expected_episode_title"]
    assert dict_case["expected_code_snippet"] in (top_dict.episode.code_snippet or "")
    assert top_dict.rrf_score >= dict_case["min_rrf_score"]

    # 2. Fixed-x loop case
    fixed_case_path = eval_dir / "test_fixed_x_loop_episode.json"
    with open(fixed_case_path, encoding="utf-8") as f:
        fixed_case = json.load(f)

    fixed_results = retriever.search(query=fixed_case["query"], filter_criteria=search_filter, limit=3)
    assert len(fixed_results) > 0
    top_fixed = fixed_results[0]
    assert top_fixed.episode.title == fixed_case["expected_episode_title"]
    assert fixed_case["expected_code_snippet"] in (top_fixed.episode.code_snippet or "")
    assert top_fixed.rrf_score >= fixed_case["min_rrf_score"]

    # 3. Evaluator isolation case
    iso_case_path = eval_dir / "test_evaluator_isolation.json"
    with open(iso_case_path, encoding="utf-8") as f:
        iso_case = json.load(f)

    # Index an evaluator_only record
    ep_eval = EpisodeRecord(
        id="ep_eval_secret",
        owner_id=OWNER_A,
        title=iso_case["evaluator_only_record_title"],
        content="Hidden assessment rubric benchmark solutions for evaluators only.",
        visibility="evaluator_only",
    )
    indexer.index_episode(ep_eval)

    cand_filter = RetrievalFilter(owner_id=OWNER_A, visibility="candidate_facing")
    iso_results = retriever.search(query=iso_case["candidate_query"], filter_criteria=cand_filter)
    assert len(iso_results) == iso_case["expected_candidate_result_count"]

    print("Retrieval Evals: All 3 eval benchmark cases in evals/cases/retrieval/ PASSED.")


# --------------------------------------------------------------------------
# B07-AC2: Strict Isolation: Wrong-Owner, Evaluator-Only & Future-Cutoff
# --------------------------------------------------------------------------

def test_wrong_owner_evaluator_and_future_cutoff_filtered():
    indexer = EpisodeIndexer()
    retriever = HybridRetriever(indexer=indexer)

    now = datetime.now(timezone.utc)
    t_past = (now - timedelta(hours=2)).isoformat()
    t_now = now.isoformat()
    t_future = (now + timedelta(hours=2)).isoformat()

    # 1. Valid record for Owner A
    ep_valid = EpisodeRecord(
        id="ep_valid_owner_a",
        owner_id=OWNER_A,
        title="Valid Pointer Technique",
        content="Learner applied left and right pointers converging inward.",
        created_at=t_past,
    )
    indexer.index_episode(ep_valid)

    # 2. Wrong-owner record (Owner B)
    ep_wrong_owner = EpisodeRecord(
        id="ep_owner_b",
        owner_id=OWNER_B,
        title="Owner B Private Solution",
        content="Learner applied left and right pointers converging inward for Owner B.",
        created_at=t_past,
    )
    indexer.index_episode(ep_wrong_owner)

    # 3. Evaluator-only record
    ep_evaluator = EpisodeRecord(
        id="ep_evaluator_only",
        owner_id=OWNER_A,
        title="Secret Benchmarking Rubric (Evaluator Only)",
        content="Learner applied left and right pointers converging inward. Secret evaluation rubric.",
        visibility="evaluator_only",
        created_at=t_past,
    )
    indexer.index_episode(ep_evaluator)

    # 4. Future-cutoff record (simulating future timestamp)
    ep_future = EpisodeRecord(
        id="ep_future",
        owner_id=OWNER_A,
        title="Future Pointer Insight",
        content="Learner applied left and right pointers converging inward in future session.",
        created_at=t_future,
    )
    indexer.index_episode(ep_future)

    # Search as Owner A with candidate_facing visibility and cutoff at t_now
    search_filter = RetrievalFilter(
        owner_id=OWNER_A,
        visibility="candidate_facing",
        cutoff_timestamp=t_now,
    )
    results = retriever.search(query="left and right pointers converging", filter_criteria=search_filter, limit=10)

    returned_ids = [r.episode.id for r in results]

    # Verify B07-AC2 rules
    assert "ep_valid_owner_a" in returned_ids, "Valid record must be returned"
    assert "ep_owner_b" not in returned_ids, "Wrong-owner record must NEVER enter candidate packet"
    assert "ep_evaluator_only" not in returned_ids, "Evaluator-only record must NEVER enter candidate packet"
    assert "ep_future" not in returned_ids, "Future-cutoff record must NEVER enter candidate packet"

    print("B07-AC2: Wrong-owner, evaluator-only, and future-cutoff strictly excluded: PASSED")


# --------------------------------------------------------------------------
# B07-AC3: Direct State Loading & Stale Index Resilience
# --------------------------------------------------------------------------

def test_stale_index_cannot_hide_current_work():
    # Setup session and artifact in evidence repository
    cls_rec = create_classroom(owner_id=OWNER_A, track="dsa", title="Two Pointers")
    sess_rec = create_session(owner_id=OWNER_A, classroom_id=cls_rec.id)

    # Save active code revision 1
    art_rec = save_artifact(
        owner_id=OWNER_A,
        session_id=sess_rec.id,
        expected_revision=1,
        content="def two_sum_sorted(numbers, target):\n    l, r = 0, len(numbers) - 1\n    return []",
        language="python",
    )

    # Add pending task
    create_or_update_pending_task(
        owner_id=OWNER_A,
        classroom_id=cls_rec.id,
        session_id=sess_rec.id,
        task_type=PendingTaskType.PENDING_QUESTION,
        title="Two Pointers Invariant",
        prompt_text="Why does moving the left pointer increase the sum?",
    )

    # Empty indexer simulating stale secondary projection or extraction failure
    empty_indexer = EpisodeIndexer()
    empty_retriever = HybridRetriever(indexer=empty_indexer)

    # Assemble context packet with empty/stale index
    packet = assemble_context_packet(
        session_id=sess_rec.id,
        owner_id=OWNER_A,
        query_text="two pointers sum",
        retriever=empty_retriever,
    )

    # Verify current work is authoritatively preserved (B07-AC3)
    assert packet.session_id == sess_rec.id
    assert packet.active_revision == 1
    assert "def two_sum_sorted" in packet.artifact_content
    assert packet.pending_question == "Why does moving the left pointer increase the sum?"
    print("B07-AC3: Stale index cannot hide current work; direct artifact and pending task loaded: PASSED")


def test_extraction_failure_allows_raw_turn_retrieval():
    """
    B07-AC3: Extraction failure still allows raw-turn retrieval.
    """
    doc_rec, _ = store_source_document(
        owner_id=OWNER_A,
        track="dsa",
        filename="corrupted_extraction.md",
        sha256_hash="dummy_hash_extraction_fail_123",
        raw_content="Raw turns from un-indexed chat",
        turn_count=1,
        extraction_quality="degraded",
    )
    store_source_turns(
        document_id=doc_rec.id,
        turns=[
            {
                "speaker": "learner",
                "content": "I tried solving with sliding window and left pointer",
                "turn_index": 1,
                "has_code": False,
                "code_blocks": [],
            }
        ],
        owner_id=OWNER_A,
    )

    empty_indexer = EpisodeIndexer()
    empty_retriever = HybridRetriever(indexer=empty_indexer)
    cls_rec = create_classroom(owner_id=OWNER_A, track="dsa", title="DSA")
    sess_rec = create_session(owner_id=OWNER_A, classroom_id=cls_rec.id)

    packet = assemble_context_packet(
        session_id=sess_rec.id,
        owner_id=OWNER_A,
        query_text="sliding window left pointer",
        retriever=empty_retriever,
    )
    assert len(packet.source_episodes) > 0, "Extraction failure must still allow raw-turn retrieval"
    assert packet.source_episodes[0].get("is_raw_turn_fallback") is True
    assert "sliding window" in packet.source_episodes[0]["content"]
    print("B07-AC3: Extraction failure allowed raw-turn fallback retrieval: PASSED")


# --------------------------------------------------------------------------
# Graph Expansion & Superseding Evidence
# --------------------------------------------------------------------------

def test_learning_links_graph_expansion():
    # Setup graph relations:
    # Skill: two_pointers -> requires -> arrays
    # Observation: obs_initial -> superseded_by -> obs_corrected
    add_learning_link(
        owner_id=OWNER_A,
        source_id="skill_two_pointers",
        target_id="skill_arrays",
        relation_type="requires_prerequisite",
        provenance="dsa_curriculum",
    )
    add_learning_link(
        owner_id=OWNER_A,
        source_id="skill_arrays",
        target_id="skill_memory_layout",
        relation_type="requires_prerequisite",
        provenance="cs_fundamentals",
    )
    add_learning_link(
        owner_id=OWNER_A,
        source_id="obs_corrected",
        target_id="obs_initial",
        relation_type="supersedes",
        provenance="tutor_correction",
    )

    # Test bounded graph expansion (depth=2, max_fan_out=5)
    expansion = expand_graph(owner_id=OWNER_A, seed_ids=["skill_two_pointers"], max_depth=2)
    assert "skill_two_pointers" in expansion["reachable_nodes"]
    assert "skill_arrays" in expansion["reachable_nodes"]
    assert "skill_memory_layout" in expansion["reachable_nodes"]
    print("Graph: Bounded prerequisite expansion traversed 2 hops: PASSED")

    # Test superseding evidence
    superseding = find_superseding_evidence(owner_id=OWNER_A, target_id="obs_initial")
    assert len(superseding) == 1
    assert superseding[0].source_id == "obs_corrected"
    assert superseding[0].relation_type == "supersedes"
    print("Graph: Superseding evidence detected: PASSED")


# --------------------------------------------------------------------------
# FastAPI Integration: GET /api/sessions/{session_id}/context
# --------------------------------------------------------------------------

def _make_jwt(payload: dict) -> str:
    import json
    import base64
    header = {"alg": "HS256", "typ": "JWT"}
    h_b64 = base64.urlsafe_b64encode(json.dumps(header).encode()).decode().rstrip("=")
    p_b64 = base64.urlsafe_b64encode(json.dumps(payload).encode()).decode().rstrip("=")
    dummy_sig = base64.urlsafe_b64encode(b"dummy_sig_12345678").decode().rstrip("=")
    return f"{h_b64}.{p_b64}.{dummy_sig}"


def test_api_session_context_endpoint():
    bootstrap_allowed_owner(OWNER_A)
    cls_rec = create_classroom(owner_id=OWNER_A, track="dsa", title="Two Pointers")
    sess_rec = create_session(owner_id=OWNER_A, classroom_id=cls_rec.id)

    token = _make_jwt({
        "sub": OWNER_A,
        "email": "darshan@planly.internal",
        "role": "authenticated",
        "exp": time.time() + 3600,
    })

    status, body = _dispatch_asgi(
        method="GET",
        path=f"/api/sessions/{sess_rec.id}/context",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert status == 200, f"Expected 200, got {status}: {body}"
    assert body["session_id"] == sess_rec.id
    assert "source_coverage" in body
    assert "superseded_evidence" in body
    print("FastAPI GET /api/sessions/{session_id}/context (200): PASSED")


def run_all_tests():
    setup_function()
    test_retrieve_dictionary_call_and_fixed_x_episodes()
    setup_function()
    test_eval_cases_retrieval_benchmarks()
    setup_function()
    test_wrong_owner_evaluator_and_future_cutoff_filtered()
    setup_function()
    test_stale_index_cannot_hide_current_work()
    setup_function()
    test_extraction_failure_allows_raw_turn_retrieval()
    setup_function()
    test_learning_links_graph_expansion()
    setup_function()
    test_api_session_context_endpoint()
    setup_function()
    print("\nAll B07 Hybrid Retrieval & Learning Links Tests PASSED successfully.")


if __name__ == "__main__":
    run_all_tests()
