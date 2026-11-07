/**
 * Sprint B21 Frontend Unit Tests: Evidence-based Debrief and Quiet Progress Views
 * Authority: PLANLY_BUILD_SPEC.md §1, 7-8, 14; B21_debrief_progress.md
 *
 * Verifies:
 * - B21-AC1: Unsupported percentages and simulated readiness never appear as real metrics.
 * - B21-AC2: Changing/superseding evidence updates the read projection consistently.
 * - B21-AC3: User can reach the next lesson without navigating a dashboard wall.
 * - Failure to Prevent: Do not spend this sprint recreating the clutter the user rejected.
 */

import { describe, it, expect } from "vitest";
import {
  computeCanonicalProgressProjection,
  recalculateProjectionOnEvidenceChange,
  buildQuietSessionDebrief,
  validateUserApplicationRecord,
  type CanonicalObservation,
} from "../../src/features/progress/quiet-service";

const OWNER_ID = "00000000-0000-0000-0000-000000000001";

describe("Sprint B21: Quiet Progress & Debrief Views", () => {
  it("B21-AC1: Unsupported percentages and simulated readiness never appear as real metrics", () => {
    const obsList: CanonicalObservation[] = [
      {
        id: "obs-01",
        owner_id: OWNER_ID,
        session_id: "sess-01",
        competency_key: "two_sum_hash_map",
        source_kind: "learner_work",
        assistance_level: "independent",
        demonstrated: true,
        evidence_text: "Learner solved Two Sum independently. Chat mentioned 85% ready.",
      },
      {
        id: "obs-02",
        owner_id: OWNER_ID,
        session_id: "sess-01",
        competency_key: "two_pointers_converge",
        source_kind: "self_report",
        assistance_level: "guided",
        demonstrated: false,
        evidence_text: "Tutor offered hint. Learner claimed 5-7% progress.",
      },
    ];

    const projection = computeCanonicalProgressProjection(OWNER_ID, obsList);

    // Two sum is verified independently
    expect(projection.dimensions.dsa.verified_competencies).toContain("two_sum_hash_map");

    // Two pointers was guided and self-reported; must be uncertain
    expect(projection.dimensions.dsa.verified_competencies).not.toContain("two_pointers_converge");
    expect(projection.dimensions.dsa.uncertain_competencies).toContain("two_pointers_converge");

    // Conversational percentage claims are disclaimed, NEVER counted as metrics
    expect(projection.disclaimed_percentages).toContain("85% ready");
    expect(projection.disclaimed_percentages).toContain("5-7% progress");

    // User application rejection of speculative hiring probability (Implement 4)
    expect(() =>
      validateUserApplicationRecord({
        company_name: "Google",
        role_title: "Staff Engineer",
        speculative_hiring_probability: 0.85,
      })
    ).toThrow("Speculative hiring probabilities are strictly prohibited (B21-AC1)");

    expect(() =>
      validateUserApplicationRecord({
        company_name: "Meta",
        role_title: "Software Engineer",
        hiring_odds: 0.72,
      })
    ).toThrow("Simulated hiring odds are strictly prohibited (B21-AC1)");
  });

  it("B21-AC2: Changing/superseding evidence updates the read projection consistently", () => {
    // 1. Initial guided observation
    const initialObs: CanonicalObservation[] = [
      {
        id: "obs-init",
        owner_id: OWNER_ID,
        session_id: "sess-01",
        competency_key: "two_pointers_converge",
        source_kind: "learner_work",
        assistance_level: "guided",
        demonstrated: false,
        evidence_text: "Learner required tutor hint for right pointer decrement.",
      },
    ];

    const proj1 = computeCanonicalProgressProjection(OWNER_ID, initialObs);
    expect(proj1.dimensions.dsa.verified_competencies).not.toContain("two_pointers_converge");
    expect(proj1.dimensions.dsa.uncertain_competencies).toContain("two_pointers_converge");
    expect(proj1.total_verified_competencies).toBe(0);
    expect(proj1.total_uncertain_competencies).toBe(1);

    // 2. Later independent retest succeeds and supersedes
    const supersedingObs: CanonicalObservation = {
      id: "obs-retest",
      owner_id: OWNER_ID,
      session_id: "sess-02",
      competency_key: "two_pointers_converge",
      source_kind: "learner_work",
      assistance_level: "independent",
      demonstrated: true,
      evidence_text: "Learner independently implemented inward convergence on blank-editor transfer.",
    };

    const proj2 = recalculateProjectionOnEvidenceChange(OWNER_ID, [
      ...initialObs,
      supersedingObs,
    ]);
    expect(proj2.dimensions.dsa.verified_competencies).toContain("two_pointers_converge");
    expect(proj2.dimensions.dsa.uncertain_competencies).not.toContain("two_pointers_converge");
    expect(proj2.total_verified_competencies).toBe(1);
    expect(proj2.total_uncertain_competencies).toBe(0);

    // 3. Retraction observation reopens the competency
    const retractionObs: CanonicalObservation = {
      id: "obs-retract",
      owner_id: OWNER_ID,
      session_id: "sess-03",
      competency_key: "two_pointers_converge",
      source_kind: "execution_evidence",
      assistance_level: "independent",
      demonstrated: false,
      evidence_text: "Learner failed edge case under duplicate inputs.",
    };

    const proj3 = recalculateProjectionOnEvidenceChange(OWNER_ID, [
      ...initialObs,
      supersedingObs,
      retractionObs,
    ]);
    expect(proj3.dimensions.dsa.verified_competencies).not.toContain("two_pointers_converge");
    expect(proj3.dimensions.dsa.uncertain_competencies).toContain("two_pointers_converge");
    expect(proj3.total_verified_competencies).toBe(0);
    expect(proj3.total_uncertain_competencies).toBe(1);
  });

  it("B21-AC3: User can reach the next lesson without navigating a dashboard wall", () => {
    const observations: CanonicalObservation[] = [
      {
        id: "obs-01",
        owner_id: OWNER_ID,
        session_id: "sess-01",
        competency_key: "two_sum_hash_map",
        source_kind: "learner_work",
        assistance_level: "independent",
        demonstrated: true,
        evidence_text: "Blank-editor implementation passed all unit tests.",
      },
      {
        id: "obs-02",
        owner_id: OWNER_ID,
        session_id: "sess-01",
        competency_key: "two_pointers_converge",
        source_kind: "learner_work",
        assistance_level: "guided",
        demonstrated: false,
        evidence_text: "Candidate needed guidance on inward convergence bounds.",
      },
    ];

    const debrief = buildQuietSessionDebrief({
      ownerId: OWNER_ID,
      sessionId: "sess-01",
      classroomId: "cls-dsa-01",
      observations,
      track: "dsa",
    });

    // 1. What improved is clear
    expect(debrief.what_improved).toHaveLength(1);
    expect(debrief.what_improved[0].competency_key).toBe("two_sum_hash_map");

    // 2. What remains uncertain is clear
    expect(debrief.what_remains_uncertain).toHaveLength(1);
    expect(debrief.what_remains_uncertain[0].competency_key).toBe("two_pointers_converge");

    // 3. Direct next lesson route without dashboard wall
    expect(debrief.next_step.route).toBe("/classrooms/cls-dsa-01");
    expect(debrief.next_step.action_label).toBe("Start Independent Transfer");
    expect(debrief.next_step.title).toContain("two_pointers_converge");
  });
});
