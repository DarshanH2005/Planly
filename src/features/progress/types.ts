/**
 * Sprint B21: Evidence-based Debrief and Quiet Progress Views Types
 * Authority: PLANLY_BUILD_SPEC.md §1, 7-8, 14; B21_debrief_progress.md
 */

export interface CapabilityDimension {
  dimension_key: "dsa" | "cs" | "ml_sql" | "project" | "behavioral";
  title: string;
  verified_competencies: string[];
  uncertain_competencies: string[];
  evidence_count: number;
  assistance_breakdown: {
    independent: number;
    guided: number;
    tutor_supplied: number;
  };
  unsupported_claims_rejected: string[];
}

export interface ProgressProjection {
  owner_id: string;
  dimensions: Record<string, CapabilityDimension>;
  total_verified_competencies: number;
  total_uncertain_competencies: number;
  disclaimed_percentages: string[];
  updated_at: string;
}

export interface NextLessonRecommendation {
  activity_id: string;
  title: string;
  track: string;
  reason: string;
  route: string;
  action_label: string;
}

export interface WhatImprovedItem {
  competency_key: string;
  status: "verified";
  evidence_text: string;
}

export interface WhatRemainsUncertainItem {
  competency_key: string;
  status: "requires_unassisted_transfer" | "specific_gap";
  assistance_level?: string;
  evidence_text: string;
}

export interface QuietSessionDebrief {
  session_id: string;
  owner_id: string;
  classroom_id: string;
  what_improved: WhatImprovedItem[];
  what_remains_uncertain: WhatRemainsUncertainItem[];
  next_step: NextLessonRecommendation;
  is_assisted: boolean;
  unsupported_percentages_excluded: boolean;
  created_at: string;
}

export interface QuietWeeklyReview {
  owner_id: string;
  verified_this_week: string[];
  uncertain_this_week: string[];
  next_recommended_activities: NextLessonRecommendation[];
  clutter_free: boolean;
  created_at: string;
}

export interface UserApplicationRecord {
  id: string;
  owner_id: string;
  company_name: string;
  role_title: string;
  status: "saved" | "applied" | "interviewing" | "archived";
  user_notes: string;
  created_at: string;
}
