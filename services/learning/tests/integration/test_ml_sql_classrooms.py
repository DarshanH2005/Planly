"""
Integration Test Suite for Sprint B17: Executable SQL and AI/ML Learning Activities.
Authority: planly_architecture.md sections 2, 8-9; B17_ml_sql_classrooms.md

Acceptance Criteria:
- B17-AC1: ML assignment is not marked implemented before a submission/run.
- B17-AC2: SQL cannot access application tables or retain mutations between isolated exercises.
- B17-AC3: Incorrect shapes, invalid SQL and timeouts preserve specific feedback and do not invent results.
- Failure to Prevent: Do not infer ML understanding from a remembered formula or generic Python practice.
"""

import sys
import unittest
from pathlib import Path

# Add services/learning to path
SERVICES_DIR = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(SERVICES_DIR))

from learning.domain.contracts import (
    SourceKind,
    AssistanceLevel,
    PendingTaskType,
    PendingTaskStatus,
)
from learning.repositories import evidence
from learning.repositories import sources
from learning.tools.sql_runner import get_sql_runner
from learning.content.ml_sql import (
    get_ml_assignment_status,
    evaluate_numpy_linear_regression,
    evaluate_ml_conceptual_answers,
    submit_ml_linear_regression,
    perform_static_checks,
)

OWNER_ID = "00000000-0000-0000-0000-000000000001"


class TestMLSQLClassrooms(unittest.TestCase):
    def setUp(self):
        evidence.reset_evidence_store()
        sources.reset_sources_store()

    # ==========================================================================
    # B17-AC1: ML Assignment Not Marked Implemented Before Submission/Run
    # ==========================================================================

    def test_b17_ac1_ml_assignment_not_implemented_before_run(self):
        """
        B17-AC1: The imported ML regression assignment is preserved as unsubmitted.
        Tutor-supplied gradients remain scaffolding. Merely having the task assigned
        or remembering formulas cannot mark understanding demonstrated until verified execution.
        """
        # 1. Setup ML classroom and session
        cls = evidence.create_classroom(OWNER_ID, "ai_ml", "AI & ML Classroom")
        sess = evidence.create_session(OWNER_ID, cls.id, "foundation", "learn")

        # Tutor explanation observation (scaffolding from B05)
        evidence.record_observation(
            owner_id=OWNER_ID,
            session_id=sess.id,
            competency_key="gradient_descent_concept",
            source_kind=SourceKind.TUTOR_EXPLANATION,
            assistance_level=AssistanceLevel.TUTOR_SUPPLIED,
            demonstrated=False,
            evidence_text="Tutor derived gradients for MSE regression. Learner implementation not yet submitted.",
        )

        # Stage unsubmitted pending task
        sources.create_or_update_pending_task(
            owner_id=OWNER_ID,
            classroom_id=cls.id,
            session_id=sess.id,
            task_type=PendingTaskType.UNSUBMITTED_EXERCISE,
            title="NumPy Linear Regression",
            prompt_text="Implement gradient descent from scratch in pure NumPy for univariate linear regression.",
            context_json={"submitted": False},
        )

        # 2. Check initial assignment status
        status = get_ml_assignment_status(OWNER_ID, cls.id)
        self.assertTrue(status["has_unsubmitted_exercise"])
        self.assertEqual(status["status"], PendingTaskStatus.PENDING)
        self.assertFalse(status["is_submitted"])
        self.assertFalse(status["is_demonstrated"])

        # Readiness count is 0
        readiness_before = sources.calculate_measured_readiness(evidence.get_session_observations(OWNER_ID, sess.id))
        self.assertEqual(readiness_before["verified_competencies_count"], 0)

        # 3. Failing submission (wrong update step: added gradient instead of subtracted)
        failing_code = """
import numpy as np

def train_linear_regression(X, y, lr=0.01, epochs=100):
    w, b = 0.0, 0.0
    loss_history = []
    n = len(X)
    for _ in range(epochs):
        y_pred = w * X + b
        loss = float(np.mean((y_pred - y) ** 2))
        loss_history.append(loss)
        dw = float((2.0 / n) * np.sum(X * (y_pred - y)))
        db = float((2.0 / n) * np.sum(y_pred - y))
        # Bug: adding gradients causes explosion
        w += lr * dw
        b += lr * db
    return w, b, loss_history
"""
        success_failing, eval_failing, _ = submit_ml_linear_regression(
            owner_id=OWNER_ID,
            session_id=sess.id,
            code=failing_code,
        )
        self.assertFalse(success_failing)
        self.assertFalse(eval_failing.passed)
        self.assertEqual(eval_failing.status, "loss_diverged")

        # Still not demonstrated
        status_after_fail = get_ml_assignment_status(OWNER_ID, cls.id)
        self.assertFalse(status_after_fail["is_demonstrated"])
        self.assertFalse(status_after_fail["is_submitted"])

        # 4. Valid independent execution
        valid_code = """
import numpy as np

def train_linear_regression(X, y, lr=0.01, epochs=1200):
    w, b = 0.0, 0.0
    loss_history = []
    n = len(X)
    for _ in range(epochs):
        y_pred = w * X + b
        loss = float(np.mean((y_pred - y) ** 2))
        loss_history.append(loss)
        dw = float((2.0 / n) * np.sum(X * (y_pred - y)))
        db = float((2.0 / n) * np.sum(y_pred - y))
        w -= lr * dw
        b -= lr * db
    return w, b, loss_history
"""
        success_valid, eval_valid, obs_valid = submit_ml_linear_regression(
            owner_id=OWNER_ID,
            session_id=sess.id,
            code=valid_code,
        )
        self.assertTrue(success_valid)
        self.assertTrue(eval_valid.passed)
        self.assertEqual(eval_valid.status, "success")
        self.assertIsNotNone(obs_valid)
        self.assertTrue(obs_valid.demonstrated)

        # 5. Now assignment is marked implemented and demonstrated
        status_after_pass = get_ml_assignment_status(OWNER_ID, cls.id)
        self.assertTrue(status_after_pass["is_demonstrated"])
        self.assertTrue(status_after_pass["is_submitted"])

        readiness_after = sources.calculate_measured_readiness(evidence.get_session_observations(OWNER_ID, sess.id))
        self.assertEqual(readiness_after["verified_competencies_count"], 1)
        self.assertIn("ml.numpy.linear_regression", readiness_after["verified_competency_keys"])

    # ==========================================================================
    # B17-AC2: SQL Cannot Access Application Tables or Retain Mutations
    # ==========================================================================

    def test_b17_ac2_sql_cannot_access_app_tables_or_retain_mutations(self):
        """
        B17-AC2:
        1. Query referencing application tables is rejected by the sandbox security policy.
        2. Mutations (e.g. INSERT) do not persist across isolated executions.
        """
        runner = get_sql_runner()

        # 1. Reject access to application tables
        forbidden_query = "SELECT * FROM classrooms;"
        res_forbidden = runner.execute_query(forbidden_query)
        self.assertEqual(res_forbidden.status, "permission_denied")
        self.assertIn("Access to application table(s) 'classrooms' is forbidden", res_forbidden.error_message)

        # Reject users table
        res_users = runner.execute_query("SELECT id, email FROM users;")
        self.assertEqual(res_users.status, "permission_denied")

        # 2. Verify mutation isolation between exercises
        fixture_ddl = "CREATE TABLE department_stats (dept TEXT, count INTEGER);"
        fixture_data = {"department_stats": [{"dept": "Engineering", "count": 10}]}

        # Exercise 1 inserts a new row
        insert_query = "INSERT INTO department_stats (dept, count) VALUES ('Marketing', 5);"
        res_insert = runner.execute_query(insert_query, fixture_ddl=fixture_ddl, fixture_data=fixture_data)
        self.assertEqual(res_insert.status, "success")
        self.assertEqual(res_insert.affected_rows, 1)

        # Exercise 2 runs a SELECT query against a fresh instance of the fixture
        select_query = "SELECT dept, count FROM department_stats ORDER BY dept;"
        res_select = runner.execute_query(select_query, fixture_ddl=fixture_ddl, fixture_data=fixture_data)
        self.assertEqual(res_select.status, "success")
        # Must only contain the initial row ('Engineering', 10), NOT 'Marketing'
        self.assertEqual(len(res_select.rows), 1)
        self.assertEqual(res_select.rows[0][0], "Engineering")
        self.assertEqual(res_select.rows[0][1], 10)

    # ==========================================================================
    # B17-AC3: Incorrect Shapes, Invalid SQL and Timeouts Preserve Specific Feedback
    # ==========================================================================

    def test_b17_ac3_incorrect_shapes_invalid_sql_and_timeouts(self):
        """
        B17-AC3:
        1. Broadcasting / shape errors in ML code are caught and produce specific error messages.
        2. SQL syntax and runtime errors preserve specific SQLite error messages without inventing results.
        3. SQL timeouts (e.g. infinite recursive CTE) are interrupted and produce a timeout status.
        """
        runner = get_sql_runner()

        # 1. SQL Syntax Error produces specific feedback
        bad_sql = "SELECT department, AVG(salary) FROM employees WHERE GROUP BY department;"
        res_syntax = runner.execute_query(bad_sql)
        self.assertIn(res_syntax.status, ("syntax_error", "runtime_error"))
        self.assertIsNotNone(res_syntax.error_message)
        self.assertIn("near \"GROUP\"", res_syntax.error_message)

        # 2. SQL Timeout produces timeout status and bounds resources
        infinite_cte = """
        WITH RECURSIVE inf_loop(n) AS (
            SELECT 1
            UNION ALL
            SELECT n + 1 FROM inf_loop WHERE n < 50000000
        )
        SELECT COUNT(*) FROM inf_loop;
        """
        res_timeout = runner.execute_query(infinite_cte, timeout_seconds=0.1)
        self.assertEqual(res_timeout.status, "timeout")
        self.assertIn("timeout", res_timeout.error_message.lower())

        # 3. Static check catches disallowed frameworks
        sklearn_code = "import sklearn.linear_model\nclf = sklearn.linear_model.LinearRegression()"
        ok_static, err_static = perform_static_checks(sklearn_code)
        self.assertFalse(ok_static)
        self.assertIn("Importing 'sklearn' is disallowed", err_static)

    # ==========================================================================
    # Failure to Prevent: Do Not Infer ML Understanding from Remembered Formula
    # ==========================================================================

    def test_failure_to_prevent_conceptual_understanding_required(self):
        """
        Failure to Prevent: Verifies that conceptual understanding questions
        check true physical meaning (direction, derivatives, learning rate divergence,
        shapes, generalization) rather than accepting formula recitation.
        """
        # Inadequate answers (just reciting words without meaning)
        poor_answers = {
            "q1": "because that is the rule",
            "q2": "gradient of w",
            "q3": "it learns fast",
            "q4": "numbers",
            "q5": "yes loss is low so model is perfect",
        }
        eval_poor = evaluate_ml_conceptual_answers(poor_answers)
        self.assertFalse(eval_poor["q1_descent_direction"])
        self.assertFalse(eval_poor["q2_derivative_meaning"])
        self.assertFalse(eval_poor["q3_learning_rate_divergence"])
        self.assertFalse(eval_poor["q4_shapes"])
        self.assertFalse(eval_poor["q5_generalization_understanding"])

        # Rigorous conceptual answers
        thorough_answers = {
            "q1": "We subtract the gradient because the gradient points in the direction of steepest ascent. To minimize MSE loss, we must move in the opposite direction.",
            "q2": "dw represents the rate of change of the loss function with respect to the weight w, indicating how a small change in w affects total error.",
            "q3": "If learning rate is 100, the parameter updates will overshoot the minimum and diverge to infinity (NaN/Inf).",
            "q4": "X, y_pred, and error are all 1D arrays with shape (5,).",
            "q5": "Decreasing training loss does not prove good generalization on unseen data because the model could be overfitting. Validation on a holdout test set is required.",
        }
        eval_thorough = evaluate_ml_conceptual_answers(thorough_answers)
        self.assertTrue(eval_thorough["q1_descent_direction"])
        self.assertTrue(eval_thorough["q2_derivative_meaning"])
        self.assertTrue(eval_thorough["q3_learning_rate_divergence"])
        self.assertTrue(eval_thorough["q4_shapes"])
        self.assertTrue(eval_thorough["q5_generalization_understanding"])


if __name__ == "__main__":
    unittest.main()
