/**
 * Sprint B22: Memory Lifecycle, Corrections & Privacy Types
 * Authority: PLANLY_BUILD_SPEC.md §5-6, 11-12; B22_memory_lifecycle.md
 */

export interface TombstoneRecord {
  id: string;
  owner_id: string;
  target_id: string;
  target_type: "observation" | "source_message" | "artifact" | "summary" | "claim";
  reason: string;
  deleted_at: string;
  restore_token: string;
  is_restored: boolean;
}

export interface CorrectionRecord {
  id: string;
  owner_id: string;
  target_observation_id: string;
  prior_competency_key: string;
  new_competency_key: string;
  prior_demonstrated: boolean;
  new_demonstrated: boolean;
  source_kind: "learner_work" | "tutor_explanation" | "self_report" | "derived_inference" | "execution_evidence";
  assistance_level: "independent" | "guided" | "tutor_supplied" | "unassessed" | "unknown";
  correction_note: string;
  created_at: string;
  status: "applied" | "superseded";
}

export interface MemoryClaim {
  id: string;
  owner_id: string;
  competency_key: string;
  claim_text: string;
  source_observation_ids: string[];
  is_misconception: boolean;
  status: "active" | "invalidated" | "corrected";
  demonstrated: boolean;
  source_kind: string;
  assistance_level: string;
  created_at: string;
  updated_at: string;
}

export interface CachedSummaryRecord {
  id: string;
  owner_id: string;
  summary_text: string;
  referenced_misconceptions: string[];
  referenced_observation_ids: string[];
  is_invalidated: boolean;
  invalidation_reason?: string;
  created_at: string;
}

export interface MemoryProjection {
  owner_id: string;
  active_competencies: Record<
    string,
    {
      competency_key: string;
      demonstrated: boolean;
      source_kind: string;
      assistance_level: string;
      confidence: number;
      evidence_text: string;
    }
  >;
  invalidated_misconceptions: string[];
  tombstoned_targets: string[];
}
