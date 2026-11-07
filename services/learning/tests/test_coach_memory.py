import json
from types import SimpleNamespace
from unittest.mock import Mock
import pytest
from fastapi import HTTPException

from learning.repositories import db as database
from learning.repositories.evidence import create_classroom, create_session, get_session_messages
from learning.repositories.sources import save_source_document, store_source_turns
from learning.workflows.coach import build_context, day_number, respond, CoachAnswer, memory_records
from learning.models.types import ProviderCredentialMissingError


@pytest.fixture
def isolated(monkeypatch, tmp_path):
    database.close_db()
    monkeypatch.setattr(database, "DB_PATH", str(tmp_path / "coach.db"))
    monkeypatch.setattr(database, "_DATA_DIR", tmp_path)
    monkeypatch.setattr(database, "_schema_initialized", False)
    classroom = create_classroom("owner-a", "coach", "Coach")
    session = create_session("owner-a", classroom.id)
    doc, _ = save_source_document("owner-a", "dsa", "chat.md", "hash", "raw", 2)
    store_source_turns(doc.id, [
        {"turn_index": 0, "speaker": "tutor", "content": "Day 4: Two Pointers. Which pointer moves when sum=17 and target=9?"},
        {"turn_index": 1, "speaker": "learner", "content": "export this chat"},
    ], "owner-a")
    db = database.get_db()
    with db:
        db.execute("INSERT INTO source_briefings VALUES (?,?,?,?,?)", (doc.id, "owner-a", "Prefix sums deferred. Day 4 introduced Two Pointers; no learner answer. Day 3 current versus x needs review.", "[0,1]", "2026-09-13"))
    yield session
    database.close_db()


@pytest.mark.parametrize("message", ["day 5", "day five", "let's start day 5", "please resume day five"])
def test_bare_and_written_days(message):
    assert day_number(message) == "5"


@pytest.mark.parametrize("message", ["day 5", "what did I learn?"])
def test_planning_and_progress_get_reviewed_history(isolated, message):
    context = build_context("owner-a", isolated.id, message)
    assert "Prefix sums deferred" in context["imported_memory"]["reviewed_history"][0]["summary"]
    if message == "day 5":
        assert any("sum=17" in t["content"] for t in context["imported_memory"]["original_excerpts"])
    assert context["newest_message"] == message


@pytest.mark.parametrize("message", ["hi", "why?", "explain again", "continue"])
def test_followups_do_not_retrieve_unrelated_transcripts(isolated, message):
    assert build_context("owner-a", isolated.id, message)["imported_memory"] == {"reviewed_history": [], "original_excerpts": []}


def test_memory_compaction_has_bounded_source_and_persists(isolated):
    from learning.repositories.evidence import record_session_message
    from learning.workflows.coach import memory_checkpoint, persist_memory, conversation_memory
    for index in range(20):
        record_session_message("owner-a", isolated.id, "learner" if index % 2 == 0 else "tutor", f"Turn {index}: keep prefix sums deferred")
    checkpoint = memory_checkpoint("owner-a", isolated.id)
    assert checkpoint["covered_messages"] == 12
    assert len(checkpoint["turns_to_compact"]) == 12
    persist_memory("owner-a", isolated.id, "Learner deferred prefix sums. No mastery established.", 12)
    database.close_db()
    assert "deferred" in build_context("owner-a", isolated.id, "why?")["conversation_checkpoint"]["previous_summary"]
    assert conversation_memory("owner-b", isolated.id)["summary"] == ""
    assert memory_checkpoint("owner-a", isolated.id)["turns_to_compact"] == []


def test_lesson_open_is_explicit_and_reuses_session(isolated):
    from learning.repositories.evidence import record_session_message
    from learning.workflows.coach import open_agreed_lesson, save_recommendation
    with pytest.raises(ValueError):
        open_agreed_lesson("owner-a", isolated.id, "Two Sum II")
    message = record_session_message("owner-a", isolated.id, "tutor", "Would you like a focused lesson?")
    save_recommendation("owner-a", isolated.id, message.id, "Two Sum II")
    first = open_agreed_lesson("owner-a", isolated.id, "Two Sum II")
    second = open_agreed_lesson("owner-a", isolated.id, "Two Sum II")
    assert first.id == second.id
    assert first.parent_session_id == isolated.id
    with pytest.raises(ValueError):
        open_agreed_lesson("owner-b", isolated.id, "Two Sum II")


def test_followup_cannot_offer_a_lesson_even_if_model_does(isolated):
    gateway = Mock()
    gateway.generate_structured.return_value = (CoachAnswer(reply="Here's why.", recommended_lesson="Two Sum II"), SimpleNamespace(continuation_metadata={"finish_reason": "STOP"}))
    assert respond("owner-a", isolated.id, "why?", gateway).recommended_lesson is None


def test_dismissed_proposal_stays_dismissed(isolated):
    from learning.repositories.evidence import record_session_message
    from learning.workflows.coach import save_recommendation, dismiss_recommendation, get_recommendation
    message = record_session_message("owner-a", isolated.id, "tutor", "Two Sum II")
    save_recommendation("owner-a", isolated.id, message.id, "Two Sum II")
    dismiss_recommendation("owner-b", isolated.id)
    assert get_recommendation("owner-a", isolated.id) == "Two Sum II"
    dismiss_recommendation("owner-a", isolated.id)
    database.close_db()
    assert get_recommendation("owner-a", isolated.id) is None


def test_actual_usage_recorded_without_inventing_cache_savings(isolated):
    gateway = Mock()
    gateway.generate_structured.return_value = (
        CoachAnswer(reply="Hello", recommended_lesson=None),
        SimpleNamespace(model_name="test-model", continuation_metadata={"finish_reason": "STOP"}, usage=SimpleNamespace(prompt_tokens=123, completion_tokens=45, total_tokens=168)),
    )
    respond("owner-a", isolated.id, "hi", gateway)
    row = database.get_db().execute("SELECT * FROM coach_turn_usage WHERE session_id=?", (isolated.id,)).fetchone()
    assert (row["input_tokens"], row["output_tokens"], row["total_tokens"]) == (123, 45, 168)
    assert row["cached_input_tokens"] is None
    gateway.generate_structured.assert_called_once()


def test_compaction_committed_with_successful_coach_reply(isolated, monkeypatch):
    from learning.repositories.evidence import record_session_message
    from learning.workflows.coach import conversation_memory
    from learning.api import main
    from learning.api.auth import AuthenticatedOwner
    for index in range(20):
        record_session_message("owner-a", isolated.id, "learner", f"Historical preference {index}")
    monkeypatch.setattr(main, "respond_to_coach", Mock(return_value=CoachAnswer(reply="Let's continue", recommended_lesson=None, memory_update="Learner preferences retained; no mastery inferred.")))
    owner = AuthenticatedOwner(owner_id="owner-a", email="a@example.test", role="authenticated")
    main.post_coach_turn(isolated.id, main.CoachMessageInput(content="continue"), owner)
    assert conversation_memory("owner-a", isolated.id)["covered_messages"] == 12


def test_owner_isolation(isolated):
    assert memory_records("owner-b") == []
    assert build_context("owner-b", isolated.id, "day 5")["imported_memory"]["original_excerpts"] == []


def test_one_call_caps_output_and_uses_structured_recommendation(isolated):
    gateway = Mock()
    gateway.generate_structured.return_value = (
        CoachAnswer(reply="Which pointer moves?", recommended_lesson="Two Sum II"),
        SimpleNamespace(continuation_metadata={"finish_reason": "STOP"}),
    )
    result = respond("owner-a", isolated.id, "day 5", gateway)
    assert result.recommended_lesson == "Two Sum II"
    gateway.generate_structured.assert_called_once()
    args = gateway.generate_structured.call_args.kwargs
    assert args["estimated_max_output_tokens"] == args["max_output_tokens"]
    assert args["max_repair_attempts"] == 0
    assert json.loads(args["prompt"])["requested_day"] == "5"


def test_failure_does_not_fabricate_plan_or_save_duplicate_request(isolated, monkeypatch):
    from learning.api import main
    from learning.api.auth import AuthenticatedOwner
    monkeypatch.setattr(main, "respond_to_coach", Mock(side_effect=ProviderCredentialMissingError("missing")))
    owner = AuthenticatedOwner(owner_id="owner-a", email="a@example.test", role="authenticated")
    with pytest.raises(HTTPException) as error:
        main.post_coach_turn(isolated.id, main.CoachMessageInput(content="day 5"), owner)
    assert error.value.status_code == 503
    assert get_session_messages("owner-a", isolated.id) == []


def test_recommendation_survives_reload_and_clears_on_followup(isolated):
    from learning.repositories.evidence import record_session_message
    from learning.workflows.coach import save_recommendation, get_recommendation
    message = record_session_message("owner-a", isolated.id, "tutor", "Resume Two Sum II")
    save_recommendation("owner-a", isolated.id, message.id, "Two Sum II")
    database.close_db()
    assert get_recommendation("owner-a", isolated.id) == "Two Sum II"
    assert get_recommendation("owner-b", isolated.id) is None
    save_recommendation("owner-a", isolated.id, message.id, None)
    assert get_recommendation("owner-a", isolated.id) is None


def test_child_context_keeps_plan_and_reviewed_history(isolated):
    from learning.repositories.evidence import record_session_message
    from learning.retrieval.context_assembler import assemble_context_packet
    record_session_message("owner-a", isolated.id, "tutor", "Recall current versus x, then resume Two Sum II.")
    classroom = create_classroom("owner-a", "dsa", "Focused lesson")
    child = create_session("owner-a", classroom.id, parent_session_id=isolated.id, title="Two Sum II")
    context = assemble_context_packet(child.id, "owner-a")
    assert context.parent_context["lesson_goal"] == "Two Sum II"
    assert "current versus x" in context.parent_context["coach_dialogue"][0]["content"]
    assert "Prefix sums deferred" in context.parent_context["reviewed_learning_history"][0]["summary"]


def test_selected_lesson_reaches_tutor_without_solution_leak(isolated):
    from learning.learner.activities import activity_for_session
    from learning.retrieval.context_assembler import assemble_context_packet
    from learning.models.prompts import build_tutor_prompt
    classroom = create_classroom("owner-a", "dsa", "Focused lesson")
    child = create_session("owner-a", classroom.id, parent_session_id=isolated.id, title="Longest Consecutive Sequence")
    activity = activity_for_session("owner-a", child.id)
    assert activity.id == "act_dsa_longest_consecutive"
    assert activity.evaluator_context is None
    assert "pass" in activity.starter_code
    context = assemble_context_packet(child.id, "owner-a")
    assert context.activity_id == activity.id
    assert context.competency_key == "dsa.hash_set.consecutive_sequence"
    system, _ = build_tutor_prompt(SimpleNamespace(next_action="probe", reveal_limit=0), context, "help")
    assert "longest consecutive" in system
    assert "two_pointers" not in system
    assert "max_len =" not in system
    assert activity_for_session("owner-b", child.id) is None


def test_unknown_topics_do_not_silently_become_two_sum():
    from learning.learner.activities import activity_for_topic, get_candidate_activity
    assert activity_for_topic("Sliding Window") is None
    assert get_candidate_activity("not_a_reviewed_activity") is None


def test_longest_consecutive_uses_its_own_tests_and_entrypoint():
    from learning.workflows.evaluate import resolve_test_cases
    cases, entrypoint = resolve_test_cases("act_dsa_longest_consecutive")
    assert entrypoint == "longest_consecutive"
    assert cases[0]["input_args"] == [[100, 4, 200, 1, 3, 2]]
    assert [case["expected_output"] for case in cases] == [4, 9, 0]
    with pytest.raises(ValueError, match="No reviewed"):
        resolve_test_cases("not_a_reviewed_activity")


def test_selected_activity_api_is_owner_scoped(isolated):
    from learning.api.main import get_selected_session_activity
    from learning.api.auth import AuthenticatedOwner
    classroom = create_classroom("owner-a", "dsa", "Longest Consecutive Sequence")
    child = create_session("owner-a", classroom.id, parent_session_id=isolated.id, title=classroom.title)
    owner = AuthenticatedOwner(owner_id="owner-a", email="a@example.test", role="authenticated")
    activity = get_selected_session_activity(child.id, owner)
    assert activity.id == "act_dsa_longest_consecutive"
    assert activity.evaluator_context is None
    other = AuthenticatedOwner(owner_id="owner-b", email="b@example.test", role="authenticated")
    with pytest.raises(HTTPException) as error:
        get_selected_session_activity(child.id, other)
    assert error.value.status_code == 404


def test_mismatched_tests_are_rejected_before_execution(isolated):
    from learning.workflows.evaluate import evaluate_session_artifact
    classroom = create_classroom("owner-a", "dsa", "Longest Consecutive Sequence")
    child = create_session("owner-a", classroom.id, parent_session_id=isolated.id, title=classroom.title)
    runner = Mock()
    with pytest.raises(ValueError, match="does not match"):
        evaluate_session_artifact("owner-a", child.id, test_suite_id="act_dsa_two_sum_sorted", runner=runner)
    runner.run_code_against_tests.assert_not_called()


def test_return_is_resumable_evidence_based_checkpoint(isolated):
    from learning.repositories.evidence import (
        record_session_message, complete_lesson_session, get_session, get_lesson_handoffs,
    )
    classroom = create_classroom("owner-a", "dsa", "Longest Consecutive Sequence")
    child = create_session("owner-a", classroom.id, parent_session_id=isolated.id, title=classroom.title)
    record_session_message("owner-a", child.id, "learner", "I keep checking x + 1 instead of current + 1.")
    record_session_message("owner-a", child.id, "tutor", "Which variable changes inside your loop?")
    args = ("owner-a", child.id, "Fake title", "completed", "I mastered everything", ["fake.mastery"], ["fake.mistake"])
    result = complete_lesson_session(*args)
    assert result["status"] == "checkpoint"
    assert result["title"] == classroom.title
    assert result["demonstrated_skills"] == []
    assert result["misconceptions"] == []
    assert "Which variable changes" in result["summary"]
    assert "I mastered everything" not in result["summary"]
    assert get_session("owner-a", child.id).status == "active"
    complete_lesson_session(*args)
    assert len(get_lesson_handoffs("owner-a", isolated.id)) == 1
    context = build_context("owner-a", isolated.id, "what next?")
    assert "Which variable changes" in json.dumps(context)
