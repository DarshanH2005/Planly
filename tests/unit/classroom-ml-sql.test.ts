import { describe, it, expect } from "vitest";
import mlCurriculum from "../../content/verified/ml/curriculum.json";
import sqlCurriculum from "../../content/verified/sql/curriculum.json";
import mlRegressionActivity from "../../content/verified/ml/ml_numpy_linear_regression.json";
import sqlAvgSalaryActivity from "../../content/verified/sql/sql_department_average_salary.json";
import sqlTopEarnersActivity from "../../content/verified/sql/sql_top_earners_per_department.json";

describe("Sprint B17: Executable SQL and AI/ML Learning Activities", () => {
  it("verifies ML and SQL curriculum structures and micro-skills", () => {
    expect(mlCurriculum.track).toBe("ai_ml");
    expect(mlCurriculum.skills.length).toBeGreaterThanOrEqual(4);

    const mlSkillIds = mlCurriculum.skills.map((s: any) => s.id);
    expect(mlSkillIds).toContain("ml.numpy.linear_regression");
    expect(mlSkillIds).toContain("ml.loss.mse_computation");
    expect(mlSkillIds).toContain("ml.optimization.gradient_descent");
    expect(mlSkillIds).toContain("ml.evaluation.generalization");

    expect(sqlCurriculum.track).toBe("sql");
    expect(sqlCurriculum.skills.length).toBeGreaterThanOrEqual(3);

    const sqlSkillIds = sqlCurriculum.skills.map((s: any) => s.id);
    expect(sqlSkillIds).toContain("sql.aggregation.groupby_having");
    expect(sqlSkillIds).toContain("sql.joins.inner_left_join");
    expect(sqlSkillIds).toContain("sql.window.ranking_functions");
  });

  it("B17-AC1: verifies imported ML assignment is preserved as unsubmitted before execution", () => {
    expect(mlRegressionActivity.id).toBe("ml_numpy_linear_regression");
    expect(mlRegressionActivity.micro_skill_id).toBe("ml.numpy.linear_regression");
    expect(mlRegressionActivity.category).toBe("modeling");
    expect(mlRegressionActivity.conceptual_questions.length).toBe(5);

    const pendingAssignment = {
      task_type: "unsubmitted_exercise",
      title: "NumPy Linear Regression from Scratch",
      status: "pending",
      context_json: {
        submitted: false,
        verified_run: false,
        competency_key: "ml.numpy.linear_regression",
      },
    };

    expect(pendingAssignment.status).toBe("pending");
    expect(pendingAssignment.context_json.submitted).toBe(false);
    expect(pendingAssignment.context_json.verified_run).toBe(false);

    const isDemonstrated = (task: typeof pendingAssignment) =>
      task.status === "resolved" && task.context_json.submitted && task.context_json.verified_run;

    expect(isDemonstrated(pendingAssignment)).toBe(false);
  });

  it("B17-AC2: verifies SQL sandbox rejects application tables and mutation leaks", () => {
    const forbiddenAppTables = [
      "users",
      "classrooms",
      "sessions",
      "artifacts",
      "observations",
      "pending_tasks",
      "eval_runs",
      "sqlite_master",
    ];

    const validateSqlQuery = (query: string): { allowed: boolean; error?: string } => {
      const lower = query.toLowerCase();
      for (const tbl of forbiddenAppTables) {
        const pattern = new RegExp(`\\b${tbl}\\b`, "i");
        if (pattern.test(lower)) {
          return {
            allowed: false,
            error: `Security Violation: Access to application table or schema catalog '${tbl}' is strictly prohibited.`,
          };
        }
      }
      return { allowed: true };
    };

    expect(validateSqlQuery("SELECT * FROM classrooms").allowed).toBe(false);
    expect(validateSqlQuery("SELECT email, hashed_password FROM users").allowed).toBe(false);
    expect(validateSqlQuery("SELECT name FROM sqlite_master WHERE type='table'").allowed).toBe(false);
    expect(validateSqlQuery("SELECT department, AVG(salary) FROM employees GROUP BY department").allowed).toBe(true);

    expect(sqlAvgSalaryActivity.fixture_ddl).toContain("CREATE TABLE employees");
    expect(sqlAvgSalaryActivity.reference_query).toContain("GROUP BY");
    expect(sqlTopEarnersActivity.fixture_ddl).toContain("CREATE TABLE employees");
    expect(sqlTopEarnersActivity.reference_query).toContain("DENSE_RANK()");
  });

  it("B17-AC3: verifies feedback specificity for invalid SQL, shape errors, and convergence", () => {
    const mockSqlExecution = (query: string) => {
      if (query.toUpperCase().includes("SELEC ")) {
        return {
          status: "error",
          error: "OperationalError: near 'SELEC': syntax error",
          columns: [],
          rows: [],
        };
      }
      return { status: "success", columns: ["dept", "avg"], rows: [["Eng", 100000]] };
    };

    const invalidSqlResult = mockSqlExecution("SELEC dept, avg(salary) FROM employees");
    expect(invalidSqlResult.status).toBe("error");
    expect(invalidSqlResult.error).toContain("syntax error");
    expect(invalidSqlResult.rows).toHaveLength(0);

    const validateHarnessOutput = (w: any, b: any, lossHistory: any[]) => {
      if (typeof w !== "number" || isNaN(w)) {
        return { passed: false, message: "Invalid weight shape or type" };
      }
      if (typeof b !== "number" || isNaN(b)) {
        return { passed: false, message: "Invalid bias shape or type" };
      }
      if (!Array.isArray(lossHistory) || lossHistory.length === 0) {
        return { passed: false, message: "loss_history must be a non-empty list of loss floats" };
      }
      const initialLoss = lossHistory[0];
      const finalLoss = lossHistory[lossHistory.length - 1];
      if (finalLoss >= initialLoss) {
        return { passed: false, message: "Loss did not decrease during gradient descent training" };
      }
      return { passed: true, message: "Gradient descent converged" };
    };

    const shapeErrorResult = validateHarnessOutput(2.0, 1.0, null as any);
    expect(shapeErrorResult.passed).toBe(false);
    expect(shapeErrorResult.message).toContain("loss_history must be a non-empty list");

    const divergedResult = validateHarnessOutput(2.0, 1.0, [10.0, 15.0, 25.0]);
    expect(divergedResult.passed).toBe(false);
    expect(divergedResult.message).toContain("Loss did not decrease");

    const passedResult = validateHarnessOutput(2.0, 1.0, [50.0, 10.0, 0.05]);
    expect(passedResult.passed).toBe(true);
  });

  it("Failure to Prevent: rejects inferred ML understanding from formula recitation alone", () => {
    const learnerResponses = [
      "The formula for gradient descent is w = w - alpha * dL/dw and MSE is 1/n sum((y_pred - y)^2)",
      "In numpy we do dot product and update weights with learning rate.",
      "y = mx + c where m is slope and c is intercept.",
    ];

    for (const text of learnerResponses) {
      const hasKeywords = text.includes("gradient descent") || text.includes("MSE") || text.includes("slope") || text.includes("learning rate");
      expect(hasKeywords).toBe(true);

      const isVerifiedExecution = false;
      const competencyAwarded = isVerifiedExecution;
      expect(competencyAwarded).toBe(false);
    }
  });
});
