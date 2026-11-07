"""
Sprint B10: Verified Evaluation Workflow & Artifact-Bound Feedback.
Authority: planly_architecture.md section 9; B10_python_execution.md

Enforces:
- B10-AC1: A real correct/incorrect pair produces expected saved outcomes.
- B10-AC3: Edit code while evaluation runs: older result does not mark new revision passed.
- Failure to prevent: Passing finite tests is not a correctness proof or independent mastery by itself.
"""

from typing import Optional, List, Dict, Any, Tuple
import hashlib
import ast

from learning.domain.contracts import (
    ExecutionRecord,
    ExecutionStatus,
    ExecutionRequestInput,
    ExecutionResponse,
    ArtifactRecord,
    SessionRecord,
    LearningObservation,
    SourceKind,
    AssistanceLevel,
)
from learning.tools.python_runner import PythonRunner, PythonRunnerConfig
from learning.repositories import evidence, executions
from learning.learner.activities import get_activity_definition, activity_for_session


DEFAULT_DSA_TEST_CASES = [
    {
        "name": "test_basic_two_sum",
        "input_args": [[2, 7, 11, 15], 9],
        "expected_output": [1, 2],
    },
    {
        "name": "test_three_elements",
        "input_args": [[2, 3, 4], 6],
        "expected_output": [1, 3],
    },
    {
        "name": "test_negative_numbers",
        "input_args": [[-1, 0], -1],
        "expected_output": [1, 2],
    },
    {
        "name": "test_duplicate_values",
        "input_args": [[0, 0, 3, 4], 0],
        "expected_output": [1, 2],
    },
]


def resolve_test_cases(test_suite_id: Optional[str]) -> Tuple[List[Dict[str, Any]], str]:
    """Resolves test cases and entrypoint function name for a given test suite."""
    if test_suite_id in ("act_dsa_two_sum_sorted", "dsa_two_sum", None):
        return DEFAULT_DSA_TEST_CASES, "two_sum"

    activity = get_activity_definition(test_suite_id)
    evaluator = activity.evaluator_context if activity else None
    if evaluator and evaluator.get("test_cases") and evaluator.get("reference_solution"):
        # Inspect trusted catalog syntax only; never execute the reference solution.
        tree = ast.parse(evaluator["reference_solution"])
        function = next((node for node in tree.body if isinstance(node, ast.FunctionDef)), None)
        if function:
            parameters = [arg.arg for arg in function.args.args]
            cases = [{
                "name": f"reviewed_{index + 1}",
                "input_args": [case["input"][name] for name in parameters],
                "expected_output": case["expected"],
            } for index, case in enumerate(evaluator["test_cases"])]
            return cases, function.name
    raise ValueError("No reviewed executable tests exist for this activity.")


def evaluate_session_artifact(
    owner_id: str,
    session_id: str,
    expected_revision: Optional[int] = None,
    test_suite_id: Optional[str] = None,
    code_override: Optional[str] = None,
    runner: Optional[PythonRunner] = None,
    revision: Optional[int] = None,
) -> ExecutionResponse:
    """
    Evaluates session code artifact with revision binding, stale result detection,
    and pedagogical mastery verification.
    """
    # 1. Resolve session
    session = evidence.get_session(owner_id, session_id)
    if not session:
        raise evidence.DanglingReferenceError(f"Session '{session_id}' not found for owner '{owner_id}'")

    # 2. Resolve artifact and target revision
    artifact = evidence.get_session_artifact(owner_id, session_id)
    target_rev = revision if revision is not None else expected_revision
    evaluating_revision = target_rev or (artifact.revision if artifact else session.current_revision)

    # 3. Resolve code to run
    if code_override is not None:
        code_to_run = code_override
    elif artifact:
        code_to_run = artifact.content
    else:
        code_to_run = ""

    # 4. Resolve test cases and runner
    selected_activity = activity_for_session(owner_id, session_id)
    if selected_activity:
        if test_suite_id and test_suite_id not in (selected_activity.id, "dsa_two_sum" if selected_activity.id == "act_dsa_two_sum_sorted" else selected_activity.id):
            raise ValueError("The test suite does not match this lesson's activity.")
        test_suite_id = selected_activity.id
    elif not test_suite_id:
        raise ValueError("Select a reviewed activity before running code.")
    test_cases, entrypoint = resolve_test_cases(test_suite_id)
    exec_runner = runner or PythonRunner()

    # 5. Execute code in isolated runner
    execution = exec_runner.run_code_against_tests(
        code=code_to_run,
        test_cases=test_cases,
        entrypoint=entrypoint,
        artifact_id=artifact.id if artifact else None,
        artifact_revision=evaluating_revision,
        session_id=session_id,
        owner_id=owner_id,
    )

    # 6. B10-AC3: Revision Parity & Stale Result Protection
    # Check if user edited the code while evaluation was running
    latest_artifact = evidence.get_session_artifact(owner_id, session_id)
    current_artifact_rev = latest_artifact.revision if latest_artifact else session.current_revision
    is_stale = False
    stale_warning = None

    if current_artifact_rev > evaluating_revision:
        is_stale = True
        stale_warning = (
            f"Stale evaluation: Result is bound to revision {evaluating_revision}, "
            f"but active session has advanced to revision {current_artifact_rev}. "
            f"The newer code revision is not marked as passed."
        )
        # Update execution record to explicitly record is_stale=True
        execution = ExecutionRecord(
            id=execution.id,
            session_id=execution.session_id,
            owner_id=execution.owner_id,
            artifact_id=execution.artifact_id,
            artifact_revision=execution.artifact_revision,
            artifact_hash=execution.artifact_hash,
            test_suite_hash=execution.test_suite_hash,
            status=execution.status,
            passed=execution.passed,
            tests_total=execution.tests_total,
            tests_passed=execution.tests_passed,
            results=execution.results,
            stdout=execution.stdout,
            stderr=execution.stderr,
            stdout_truncated=execution.stdout_truncated,
            duration_ms=execution.duration_ms,
            sandbox_provider=execution.sandbox_provider,
            is_stale=True,
            created_at=execution.created_at,
        )

    # 7. Failure-to-Prevent: Passing finite tests is NOT proof of correctness or independent mastery!
    finite_test_pass = execution.passed and (not is_stale)
    independent_mastery = False  # Never granted on finite test pass alone!

    if finite_test_pass:
        pedagogical_note = (
            "All finite test cases passed! However, passing finite tests is not a correctness proof "
            "or independent mastery by itself. Explain why your algorithm is correct "
            "and analyze its time and space complexity."
        )
    elif is_stale:
        pedagogical_note = (
            f"Evaluated revision {evaluating_revision} ({execution.tests_passed}/{execution.tests_total} tests passed). "
            f"Newer edits (revision {current_artifact_rev}) exist and must be evaluated separately."
        )
    elif execution.status == ExecutionStatus.TIMED_OUT:
        pedagogical_note = "Execution timed out. Check loop termination and algorithm complexity."
    elif execution.status == ExecutionStatus.STATIC_REVIEW_ONLY:
        pedagogical_note = "Code execution sandbox unavailable. Walk through the algorithm with an example."
    else:
        pedagogical_note = (
            f"{execution.tests_passed}/{execution.tests_total} tests passed. "
            "Check the failing examples against your algorithm."
        )

    # 8. Persist execution record
    executions.record_execution(execution)

    # 9. Record attempt / evidence if applicable
    observation_recorded = False
    if finite_test_pass and not is_stale:
        try:
            # Per B03-AC2 / B10 Failure to Prevent: Execution evidence of passing tests
            # is recorded with demonstrated=False (unassessed conceptual reasoning) or guided.
            # Only explicit learner explanation can claim demonstrated=True.
            evidence.record_observation(
                owner_id=owner_id,
                session_id=session_id,
                competency_key=(selected_activity or get_activity_definition(test_suite_id)).competency_key,
                source_kind=SourceKind.EXECUTION_EVIDENCE,
                assistance_level=AssistanceLevel.GUIDED,
                demonstrated=False,
                evidence_text=f"Passed {execution.tests_passed}/{execution.tests_total} finite tests on revision {evaluating_revision}.",
                artifact_id=artifact.id if artifact else None,
            )
            observation_recorded = True
        except Exception:
            pass

    return ExecutionResponse(
        execution=execution,
        is_stale=is_stale,
        observation_recorded=observation_recorded,
        finite_test_pass=finite_test_pass,
        independent_mastery=independent_mastery,
        pedagogical_note=pedagogical_note,
        stale_warning=stale_warning,
    )


# Alias for workflow callers
evaluate_session_code = evaluate_session_artifact
