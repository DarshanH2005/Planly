/**
 * Sprint B20: Project, Design and Behavioural Assessment Types
 * Authority: PLANLY_BUILD_SPEC.md §8; B20_project_behavioral.md
 */

export type MetricStatus = "verified" | "proposed" | "unknown";

export interface ProjectMetric {
  name: string;
  value?: string | null;
  status: MetricStatus;
  source_note?: string;
}

export interface ProjectArtifact {
  id: string;
  owner_id: string;
  title: string;
  architecture_overview: string;
  technologies: string[];
  decisions: Record<string, string>;
  constraints: string[];
  debugging_stories: string[];
  trade_offs: Record<string, string>;
  metrics: ProjectMetric[];
  repo_url?: string;
  provenance_notes?: string;
  is_production_deployed: boolean;
  created_at: string;
  updated_at: string;
}

export interface BehavioralExperience {
  id: string;
  owner_id: string;
  title: string;
  company_or_context: string;
  situation: string;
  task: string;
  action: string;
  result: string;
  metrics: ProjectMetric[];
  tags: string[];
  is_verified_experience: boolean;
  created_at: string;
  updated_at: string;
}

export type ProjectReviewStage =
  | "overview"
  | "concurrency_scaling"
  | "trade_offs"
  | "failure_debugging"
  | "metrics_impact"
  | "debrief";

export type ProjectReviewRole = "candidate" | "interviewer" | "system";

export interface ProjectReviewTurn {
  id: string;
  role: ProjectReviewRole;
  stage: ProjectReviewStage;
  content: string;
  source_artifact_id?: string;
  source_turn_id?: string;
  referenced_section?: string;
  referenced_quote?: string;
  assistance_level: "independent" | "guided" | "tutor_supplied";
  created_at: string;
}

export interface ObservedGap {
  dimension: string;
  gap_key: string;
  description: string;
  candidate_statement: string;
  source_turn_id?: string;
  resolved: boolean;
}

export interface StudyActivityRecommendation {
  gap_key: string;
  title: string;
  description: string;
  estimated_minutes: number;
}

export interface ProjectRubricEvaluation {
  architecture_defended: boolean;
  concurrency_sound: boolean;
  trade_offs_justified: boolean;
  failure_recovery_understood: boolean;
  metrics_honest_and_verified: boolean;
  distinguishes_facts_from_proposals: boolean;
  observed_gaps: ObservedGap[];
  study_recommendations: StudyActivityRecommendation[];
}

export interface ProjectReviewSessionState {
  session_id: string;
  owner_id: string;
  classroom_id: string;
  scenario_id: string;
  stage: ProjectReviewStage;
  mode: "learn" | "practice" | "strict";
  artifact_id?: string;
  experience_id?: string;
  turns: ProjectReviewTurn[];
  rubric: ProjectRubricEvaluation;
  is_official_company_interview: boolean;
  company_attribution?: string;
  is_interrupted: boolean;
  created_at: string;
  updated_at: string;
}
