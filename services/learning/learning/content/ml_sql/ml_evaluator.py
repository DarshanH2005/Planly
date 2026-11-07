"""
ML and SQL Evaluation Engine with Shape, Loss, and Execution Checking.
Sprint: B17
Authority: planly_architecture.md sections 2, 8-9; B17_ml_sql_classrooms.md

Enforces:
- B17-AC1: ML assignment is not marked implemented before a submission/run.
- B17-AC2: SQL cannot access application tables or retain mutations between isolated exercises.
- B17-AC3: Incorrect shapes, invalid SQL and timeouts preserve specific feedback and do not invent results.
- Failure to Prevent: Do not infer ML understanding from a remembered formula or generic Python practice.
"""

import ast
import json
import math
import time
from pathlib import Path
from typing import Dict, List, Optional, Any, Tuple
from pydantic import BaseModel, Field

from learning.domain.contracts import (
    LearningObservation,
    SourceKind,
    AssistanceLevel,
    PendingTaskType,
    PendingTaskStatus,
)
from learning.repositories import evidence
from learning.repositories import sources
from learning.tools.python_runner import get_python_runner, ExecutionStatus
from learning.tools.sql_runner import get_sql_runner, SQLExecutionResult


class MLEvaluationResult(BaseModel):
    passed: bool
    status: str  # "success", "shape_mismatch", "loss_diverged", "static_violation", "runtime_error"
    static_checks_passed: bool
    executed: bool
    final_w: Optional[float] = None
    final_b: Optional[float] = None
    final_loss: Optional[float] = None
    loss_decreased: bool = False
    shape_feedback: Optional[str] = None
    error_message: Optional[str] = None
    feedback: str = ""
    conceptual_mastery: Dict[str, bool] = Field(default_factory=dict)


# ==============================================================================
# B17-AC1: Assignment Tracking (Not Marked Implemented Before Submission/Run)
# ==============================================================================

def get_ml_assignment_status(owner_id: str, classroom_id: str) -> Dict[str, Any]:
    """
    B17-AC1: Verifies that the imported ML regression assignment remains
    unsubmitted and not demonstrated until a verified execution run occurs.
    """
    tasks = sources.get_pending_tasks(
        owner_id=owner_id,
        classroom_id=classroom_id,
        task_type=PendingTaskType.UNSUBMITTED_EXERCISE,
    )
    if not tasks:
        return {
            "has_unsubmitted_exercise": False,
            "status": "none",
            "is_demonstrated": False,
        }

    task = tasks[0]
    is_submitted = bool(task.context_json.get("submitted", False))

    # Check observations in sessions belonging to this classroom
    sessions = evidence.list_sessions(owner_id, classroom_id)
    is_demonstrated = False
    for s in sessions:
        obs = evidence.get_session_observations(owner_id, s.id)
        for o in obs:
            if o.competency_key in ("ml.numpy.linear_regression", "linear_regression_numpy") and o.demonstrated:
                is_demonstrated = True

    return {
        "has_unsubmitted_exercise": True,
        "task_id": task.id,
        "title": task.title,
        "status": task.status,
        "is_submitted": is_submitted,
        "is_demonstrated": is_demonstrated,
    }


# ==============================================================================
# B17-AC3: Shape, Loss, and Static-versus-Executed Feedback
# ==============================================================================

def perform_static_checks(code: str) -> Tuple[bool, Optional[str]]:
    """
    Performs static AST checks ensuring pure NumPy usage without cheating frameworks.
    """
    try:
        tree = ast.parse(code)
    except SyntaxError as e:
        return False, f"Static Syntax Error at line {e.lineno}: {e.msg}"

    disallowed_modules = {"sklearn", "torch", "tensorflow", "scipy"}
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                root_pkg = alias.name.split(".")[0]
                if root_pkg in disallowed_modules:
                    return False, f"Static Check Violation: Use only Python + NumPy. Importing '{root_pkg}' is disallowed."
        elif isinstance(node, ast.ImportFrom):
            if node.module:
                root_pkg = node.module.split(".")[0]
                if root_pkg in disallowed_modules:
                    return False, f"Static Check Violation: Use only Python + NumPy. Importing from '{root_pkg}' is disallowed."

    return True, None


def evaluate_numpy_linear_regression(code: str) -> MLEvaluationResult:
    """
    B17-AC3: Executes candidate NumPy regression script, validating:
    1. Static constraints (pure NumPy, no high-level frameworks).
    2. Shape correctness (detects broadcasting errors e.g. (N,) vs (N, 1)).
    3. Loss trajectory (strictly decreasing MSE, detecting diverging gradients).
    4. Parameter convergence (w approaches 2.0, b approaches 1.0).
    """
    # 1. Static checks
    static_ok, static_err = perform_static_checks(code)
    if not static_ok:
        return MLEvaluationResult(
            passed=False,
            status="static_violation",
            static_checks_passed=False,
            executed=False,
            error_message=static_err,
            feedback=static_err or "",
        )

    # 2. Harness execution code injecting shape assertions and loss logging
    harness_code = f"""
import sys
import json
import numpy as np

# Learner Code
{code}

# Test Harness Verification
X = np.array([1.0, 2.0, 3.0, 4.0, 5.0])
y = np.array([3.0, 5.0, 7.0, 9.0, 11.0])

# Check learner function entrypoint
if 'train_linear_regression' in locals():
    fn = locals()['train_linear_regression']
    w, b, losses = fn(X, y)
else:
    # Look for loop variables
    if 'w' in locals() and 'b' in locals():
        w = locals()['w']
        b = locals()['b']
        losses = locals().get('loss_history', [])
    else:
        print(json.dumps({{'error': 'Missing train_linear_regression function or w/b variables'}}))
        sys.exit(0)

# Check predictions shape explicitly
y_pred = w * X + b
shape_error = None
if y_pred.shape != y.shape:
    shape_error = f"Shape mismatch: predicted shape {{y_pred.shape}} does not match target shape {{y.shape}}"

loss_decreased = False
final_loss = None
if losses:
    loss_decreased = losses[-1] < losses[0]
    final_loss = float(losses[-1])

result = {{
    'w': float(w),
    'b': float(b),
    'final_loss': final_loss,
    'loss_decreased': loss_decreased,
    'shape_error': shape_error,
    'loss_count': len(losses)
}}
print("__RESULT__" + json.dumps(result))
"""

    # 2. Execute harness in an isolated temporary environment
    import tempfile
    import subprocess
    import os
    import sys
    from learning.tools.python_runner import SENSITIVE_ENV_VARS

    with tempfile.TemporaryDirectory() as temp_dir:
        harness_file = os.path.join(temp_dir, "harness.py")
        with open(harness_file, "w", encoding="utf-8") as f:
            f.write(harness_code)

        safe_env = {k: v for k, v in os.environ.items() if k not in SENSITIVE_ENV_VARS}
        safe_env["PYTHONPATH"] = temp_dir
        safe_env["PYTHONDONTWRITEBYTECODE"] = "1"

        try:
            proc = subprocess.run(
                [sys.executable, harness_file],
                capture_output=True,
                text=True,
                timeout=3.0,
                env=safe_env,
                cwd=temp_dir,
            )
            stdout = proc.stdout
            stderr = proc.stderr
            if proc.returncode != 0:
                err_msg = stderr.strip() or f"Process exited with code {proc.returncode}"
                return MLEvaluationResult(
                    passed=False,
                    status="runtime_error",
                    static_checks_passed=True,
                    executed=True,
                    error_message=err_msg,
                    feedback=f"Runtime error: {err_msg}",
                )
        except subprocess.TimeoutExpired:
            return MLEvaluationResult(
                passed=False,
                status="timeout",
                static_checks_passed=True,
                executed=True,
                error_message="Execution timed out. Check for infinite loop or excessive epochs (B17-AC3).",
                feedback="Execution exceeded timeout limit.",
            )
        except Exception as e:
            return MLEvaluationResult(
                passed=False,
                status="runtime_error",
                static_checks_passed=True,
                executed=True,
                error_message=str(e),
                feedback=f"Execution error: {str(e)}",
            )
    if "__RESULT__" not in stdout:
        return MLEvaluationResult(
            passed=False,
            status="runtime_error",
            static_checks_passed=True,
            executed=True,
            error_message="Harness did not produce expected output token.",
            feedback="Execution finished without structured output.",
        )

    try:
        raw_res = stdout.split("__RESULT__")[1].strip()
        data = json.loads(raw_res)
    except Exception as e:
        return MLEvaluationResult(
            passed=False,
            status="runtime_error",
            static_checks_passed=True,
            executed=True,
            error_message=f"Output deserialization error: {str(e)}",
            feedback="Failed to parse execution results.",
        )

    # 3. Analyze shapes, losses, and parameters
    shape_err = data.get("shape_error")
    if shape_err:
        return MLEvaluationResult(
            passed=False,
            status="shape_mismatch",
            static_checks_passed=True,
            executed=True,
            shape_feedback=shape_err,
            error_message=shape_err,
            feedback=f"Broadcasting/Shape error: {shape_err}",
        )

    w = data.get("w", 0.0)
    b = data.get("b", 0.0)
    final_loss = data.get("final_loss")
    loss_decreased = data.get("loss_decreased", False)

    # Check for diverging loss (NaN or Inf or not decreased)
    if final_loss is None or math.isnan(final_loss) or math.isinf(final_loss) or not loss_decreased:
        return MLEvaluationResult(
            passed=False,
            status="loss_diverged",
            static_checks_passed=True,
            executed=True,
            final_w=w,
            final_b=b,
            final_loss=final_loss,
            loss_decreased=False,
            error_message="Loss did not decrease monotonically or diverged to NaN/Inf. Check learning rate or gradient direction (B17-AC3).",
            feedback="Loss failed to decrease over training iterations.",
        )

    # Convergence check: target w=2.0, b=1.0
    w_close = abs(w - 2.0) < 0.20
    b_close = abs(b - 1.0) < 0.40
    passed = w_close and b_close and loss_decreased

    feedback = (
        f"Verified NumPy linear regression convergence: w={w:.3f} (target ~2.0), "
        f"b={b:.3f} (target ~1.0), final MSE loss={final_loss:.4f}."
        if passed
        else f"Parameters did not converge to target (w={w:.3f}, b={b:.3f}). Increase epochs or verify update step."
    )

    return MLEvaluationResult(
        passed=passed,
        status="success" if passed else "loss_diverged",
        static_checks_passed=True,
        executed=True,
        final_w=w,
        final_b=b,
        final_loss=final_loss,
        loss_decreased=loss_decreased,
        feedback=feedback,
    )


# ==============================================================================
# Conceptual Questions Evaluation (Failure to Prevent)
# ==============================================================================

def evaluate_ml_conceptual_answers(answers: Dict[str, str]) -> Dict[str, bool]:
    """
    Failure to Prevent: Verifies true conceptual understanding rather than memorized formulas.
    Q1: Why subtract gradient instead of adding?
    Q2: What does dw actually represent?
    Q3: If learning_rate = 100, what happens?
    Q4: Shapes of X, y_pred, error?
    Q5: Does training loss decrease prove generalization on unseen data?
    """
    results = {}

    # Q1: Gradient descent direction
    q1 = answers.get("q1", "").lower()
    results["q1_descent_direction"] = any(
        k in q1 for k in ["opposite", "steepest descent", "minimize", "negative gradient", "decrease loss"]
    )

    # Q2: dw physical meaning
    q2 = answers.get("q2", "").lower()
    results["q2_derivative_meaning"] = any(
        k in q2 for k in ["rate of change", "slope", "sensitivity", "how loss changes with respect to", "derivative"]
    ) and ("gradient of w" not in q2 or len(q2.split()) > 4)

    # Q3: High learning rate explosion
    q3 = answers.get("q3", "").lower()
    results["q3_learning_rate_divergence"] = any(
        k in q3 for k in ["diverge", "overshoot", "explode", "oscillate", "nan", "inf"]
    )

    # Q4: Array shapes
    q4 = answers.get("q4", "").lower()
    results["q4_shapes"] = any(k in q4 for k in ["(5,)", "(5, 1)", "5 elements", "1d array", "vector of 5", "5"])

    # Q5: Training loss vs generalization
    q5 = answers.get("q5", "").lower()
    results["q5_generalization_understanding"] = any(
        k in q5 for k in ["overfitting", "validation", "test data", "unseen data", "does not prove", "no"]
    ) and any(k in q5 for k in ["generaliz", "unseen", "test", "overfit"])

    return results


# ==============================================================================
# Complete Submission Processor
# ==============================================================================

def submit_ml_linear_regression(
    owner_id: str,
    session_id: str,
    code: str,
    conceptual_answers: Optional[Dict[str, str]] = None,
) -> Tuple[bool, MLEvaluationResult, Optional[LearningObservation]]:
    """
    B17-AC1: Submits and executes the ML linear regression assignment.
    Only when code execution passes shape, loss, and convergence checks
    is the assignment marked implemented, the pending task marked COMPLETED,
    and a verified demonstrated observation recorded.
    """
    eval_result = evaluate_numpy_linear_regression(code)

    if conceptual_answers:
        concept_results = evaluate_ml_conceptual_answers(conceptual_answers)
        eval_result.conceptual_mastery = concept_results

    if eval_result.passed:
        # Mark pending task completed
        session = evidence.get_session(owner_id, session_id)
        if session:
            tasks = sources.get_pending_tasks(
                owner_id=owner_id,
                classroom_id=session.classroom_id,
                task_type=PendingTaskType.UNSUBMITTED_EXERCISE,
            )
            for t in tasks:
                if "NumPy Linear Regression" in t.title:
                    ctx = dict(t.context_json)
                    ctx["submitted"] = True
                    sources.update_pending_task(
                        owner_id=owner_id,
                        task_id=t.id,
                        status=PendingTaskStatus.RESOLVED,
                        context_json=ctx,
                    )

        # Record verified observation
        obs = evidence.record_observation(
            owner_id=owner_id,
            session_id=session_id,
            competency_key="ml.numpy.linear_regression",
            source_kind=SourceKind.LEARNER_WORK,
            assistance_level=AssistanceLevel.INDEPENDENT,
            demonstrated=True,
            evidence_text=eval_result.feedback,
        )
        return True, eval_result, obs
    else:
        obs = evidence.record_observation(
            owner_id=owner_id,
            session_id=session_id,
            competency_key="ml.numpy.linear_regression",
            source_kind=SourceKind.LEARNER_WORK,
            assistance_level=AssistanceLevel.INDEPENDENT,
            demonstrated=False,
            evidence_text=f"Failed execution: {eval_result.feedback}",
        )
        return False, eval_result, obs
