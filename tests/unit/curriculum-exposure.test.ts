import { describe, it, expect } from "vitest";
import curriculumData from "../../content/verified/curriculum.json";
import twoSumSorted from "../../content/verified/activities/dsa_two_sum_sorted.json";
import twoSumHashMap from "../../content/verified/activities/dsa_two_sum_hash_map.json";
import longestConsecutive from "../../content/verified/activities/dsa_longest_consecutive.json";
import subarraySumEqualsK from "../../content/verified/activities/dsa_subarray_sum_equals_k.json";
import twoSumVariantDiff from "../../content/verified/activities/dsa_two_sum_variant_diff.json";
import advancedInversion from "../../content/verified/activities/dsa_advanced_inversion_count.json";

interface MicroSkill {
  id: string;
  name: string;
  track: string;
  category: string;
  description: string;
  prerequisites: string[];
  difficulty: number;
}

interface ExposureState {
  seen_statement: boolean;
  close_variant: boolean;
  solution_exposed: boolean;
  guided_trials: number;
  independent_trials: number;
}

function isTransferEligible(exposure: ExposureState): boolean {
  if (exposure.solution_exposed) return false;
  if (exposure.seen_statement) return false;
  if (exposure.close_variant) return false;
  return true;
}

describe("Sprint B12: Curriculum Micro-Skills & Exposure-Aware Activities", () => {
  describe("B12-AC1: Curriculum DAG and Content Projections", () => {
    it("verifies curriculum has zero orphan prerequisite edges", () => {
      const skills: MicroSkill[] = curriculumData.skills;
      const skillIds = new Set(skills.map((s) => s.id));

      expect(skills.length).toBeGreaterThanOrEqual(8);

      for (const skill of skills) {
        for (const prereq of skill.prerequisites) {
          expect(
            skillIds.has(prereq),
            `Skill '${skill.id}' has orphan prerequisite '${prereq}'`
          ).toBe(true);
        }
      }
    });

    it("verifies curriculum graph is a strict DAG without cycles", () => {
      const skills: MicroSkill[] = curriculumData.skills;
      const adjList = new Map<string, string[]>();
      for (const s of skills) {
        adjList.set(s.id, s.prerequisites);
      }

      const visited = new Map<string, number>(); // 0: unvisited, 1: visiting, 2: visited

      function hasCycle(node: string): boolean {
        visited.set(node, 1);
        const neighbors = adjList.get(node) || [];
        for (const n of neighbors) {
          if (visited.get(n) === 1) return true;
          if (!visited.get(n) && hasCycle(n)) return true;
        }
        visited.set(node, 2);
        return false;
      }

      for (const s of skills) {
        if (!visited.get(s.id)) {
          expect(hasCycle(s.id)).toBe(false);
        }
      }
    });

    it("verifies strict separation between candidate and evaluator projections", () => {
      const activities = [
        twoSumSorted,
        twoSumHashMap,
        longestConsecutive,
        subarraySumEqualsK,
        twoSumVariantDiff,
      ];

      for (const act of activities) {
        // Candidate projection must have statement and starter code, but NO reference solution
        expect(act.candidate.statement.length).toBeGreaterThan(10);
        expect(act.candidate.starter_code).toContain("def ");
        expect((act.candidate as any).reference_solution).toBeUndefined();

        // Evaluator projection must have reference solution, test cases, and rubric
        expect(act.evaluator.reference_solution).toContain("def ");
        expect(act.evaluator.test_cases.length).toBeGreaterThanOrEqual(1);
        expect(act.evaluator.rubric.length).toBeGreaterThan(10);
      }
    });
  });

  describe("B12-AC2: Exposure Tracking & Unseen Transfer Invariants", () => {
    it("rejects solution-exposed problems from unseen transfer", () => {
      const exposure: ExposureState = {
        seen_statement: true,
        close_variant: false,
        solution_exposed: true,
        guided_trials: 1,
        independent_trials: 0,
      };

      expect(isTransferEligible(exposure)).toBe(false);
    });

    it("rejects seen statements and close variants from unseen transfer", () => {
      const seenExposure: ExposureState = {
        seen_statement: true,
        close_variant: false,
        solution_exposed: false,
        guided_trials: 0,
        independent_trials: 0,
      };
      expect(isTransferEligible(seenExposure)).toBe(false);

      const variantExposure: ExposureState = {
        seen_statement: false,
        close_variant: true,
        solution_exposed: false,
        guided_trials: 0,
        independent_trials: 0,
      };
      expect(isTransferEligible(variantExposure)).toBe(false);
    });

    it("permits completely fresh activities as unseen transfer", () => {
      const cleanExposure: ExposureState = {
        seen_statement: false,
        close_variant: false,
        solution_exposed: false,
        guided_trials: 0,
        independent_trials: 0,
      };
      expect(isTransferEligible(cleanExposure)).toBe(true);
      expect(twoSumSorted.is_transfer_eligible).toBe(true);
      expect(twoSumVariantDiff.is_transfer_eligible).toBe(false);
    });
  });

  describe("B12-AC3: Catalog Gaps & Failure-to-Prevent Guardrail", () => {
    it("enforces that catalogued unverified items cannot be treated as verified ready", () => {
      expect(advancedInversion.provenance.review_status).toBe("catalogued_unverified");
      expect(advancedInversion.is_transfer_eligible).toBe(false);
      expect(advancedInversion.evaluator.test_cases.length).toBe(0);
    });

    it("enforces that advanced catalog items require foundational prerequisites", () => {
      const skills: MicroSkill[] = curriculumData.skills;
      const advancedSkill = skills.find((s) => s.id === "dsa.advanced.inversion_counting");
      expect(advancedSkill).toBeDefined();

      // Inversion counting requires merge sort, which requires two pointers merge, which requires two pointers basics, which requires array iteration
      expect(advancedSkill?.prerequisites).toContain("dsa.sorting.merge_sort");

      const mergeSort = skills.find((s) => s.id === "dsa.sorting.merge_sort");
      expect(mergeSort?.prerequisites).toContain("dsa.two_pointers.merge");

      const twoPointersMerge = skills.find((s) => s.id === "dsa.two_pointers.merge");
      expect(twoPointersMerge?.prerequisites).toContain("dsa.two_pointers.basics");

      const twoPointersBasics = skills.find((s) => s.id === "dsa.two_pointers.basics");
      expect(twoPointersBasics?.prerequisites).toContain("dsa.arrays.iteration");
    });
  });
});
