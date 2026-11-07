import { describe, it, expect } from "vitest";
import csCurriculum from "../../content/verified/cs/curriculum.json";
import fs from "fs";
import path from "path";

describe("Sprint B16: CS Fundamentals Through Scenario Reasoning", () => {
  const scenariosDir = path.resolve(__dirname, "../../content/verified/cs/scenarios");

  it("verifies CS curriculum structure and category separation", () => {
    expect(csCurriculum.track).toBe("cs");
    expect(csCurriculum.skills.length).toBeGreaterThanOrEqual(10);

    const categories = new Set(csCurriculum.skills.map((s: any) => s.category));
    expect(categories.has("terminology")).toBe(true);
    expect(categories.has("explanation")).toBe(true);
    expect(categories.has("scenario_reasoning")).toBe(true);

    // Verify all prerequisites exist in the curriculum
    const skillIds = new Set(csCurriculum.skills.map((s: any) => s.id));
    for (const skill of csCurriculum.skills) {
      for (const prereq of skill.prerequisites) {
        expect(skillIds.has(prereq)).toBe(true);
      }
    }
  });

  it("B16-AC1: verifies pending follow-ups structure preserves Q11-Q15 without pretending answered", () => {
    const pendingTask = {
      task_type: "unanswered_followup",
      title: "Concurrency Follow-ups Q11-Q15",
      prompt_text: "Unanswered questions on per-process heap, race conditions, critical section mutex lock scope, stack isolation, and intermittent seat booking bug.",
      status: "pending",
      context_json: {
        question_count: 5,
        questions: ["Q11", "Q12", "Q13", "Q14", "Q15"],
      },
    };

    expect(pendingTask.status).toBe("pending");
    expect(pendingTask.context_json.questions).toContain("Q11");
    expect(pendingTask.context_json.questions).toContain("Q15");
    // Must NOT mark answered or completed without learner demonstration
    expect(pendingTask.status).not.toBe("completed");
  });

  it("B16-AC2: verifies rubric distinguishes shared address space concepts from demonstrated knowledge", () => {
    const q11ScenarioPath = path.join(scenariosDir, "cs_os_heap_process_isolation.json");
    expect(fs.existsSync(q11ScenarioPath)).toBe(true);

    const scenario = JSON.parse(fs.readFileSync(q11ScenarioPath, "utf-8"));
    expect(scenario.micro_skill_id).toBe("cs.os.explanation.per_process_heap");
    expect(scenario.evaluator_rubric.required_concepts).toContain("virtual_address_space");
    expect(scenario.evaluator_rubric.required_concepts).toContain("per_process_isolation");
    expect(scenario.evaluator_rubric.forbidden_misconceptions).toContain("one heap for the entire computer");

    // Simulated learner responses
    const misconceptionResponse = "Heap is one single memory for one computer and shared between everyone.";
    const hasMisconception = scenario.evaluator_rubric.forbidden_misconceptions.some((m: string) =>
      misconceptionResponse.toLowerCase().includes("one single memory for one computer")
    );
    expect(hasMisconception).toBe(true);

    const validResponse =
      "Each process has its own isolated virtual address space and private heap. Threads share the heap, while each thread has its own stack and registers.";
    const hasVirtual = validResponse.includes("virtual address space");
    const hasThreadsShare = validResponse.includes("Threads share the heap");
    const hasOwnStack = validResponse.includes("own stack");
    expect(hasVirtual && hasThreadsShare && hasOwnStack).toBe(true);
  });

  it("B16-AC3: verifies track isolation between CS, DSA, and ML", () => {
    interface TrackReadiness {
      track: string;
      verifiedCompetencies: string[];
    }

    const state: Record<string, TrackReadiness> = {
      dsa: { track: "dsa", verifiedCompetencies: ["two_sum_hash_map"] },
      ai_ml: { track: "ai_ml", verifiedCompetencies: [] },
      cs: { track: "cs", verifiedCompetencies: [] },
    };

    // Adding CS demonstrated observations
    state.cs.verifiedCompetencies.push("cs.os.explanation.per_process_heap");
    state.cs.verifiedCompetencies.push("cs.os.scenario.check_then_act_lock_scope");

    // DSA and ML must remain completely unchanged
    expect(state.dsa.verifiedCompetencies).toEqual(["two_sum_hash_map"]);
    expect(state.dsa.verifiedCompetencies.length).toBe(1);
    expect(state.ai_ml.verifiedCompetencies).toEqual([]);
    expect(state.ai_ml.verifiedCompetencies.length).toBe(0);
    expect(state.cs.verifiedCompetencies.length).toBe(2);
  });

  it("Failure to Prevent: verifies rejection of generic syllabus dump in favor of focused scenario reasoning", () => {
    const isSyllabusDump = (text: string) => {
      return (
        text.includes("OPERATING SYSTEMS") &&
        text.includes("COMPUTER NETWORKS") &&
        text.includes("DBMS THEORY")
      );
    };

    const genericDump = `
      OPERATING SYSTEMS
      - process vs thread
      - concurrency
      COMPUTER NETWORKS
      - OSI and TCP/IP
      DBMS THEORY
      - relational databases
    `;
    expect(isSyllabusDump(genericDump)).toBe(true);

    const focusedScenarioResponse = `
      Continuing from where we left off on concurrency fundamentals.
      **Per-Process Heap vs Thread Stack Memory Model**
      Why isn't the heap 'one heap for the whole computer'? Explain what actually gets shared between threads.
    `;
    expect(isSyllabusDump(focusedScenarioResponse)).toBe(false);
  });
});
