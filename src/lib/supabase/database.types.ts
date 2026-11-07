export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          owner_id: string;
          email: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          owner_id: string;
          email: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          owner_id?: string;
          email?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      owner_allowlist: {
        Row: {
          email: string;
          created_at: string;
        };
        Insert: {
          email: string;
          created_at?: string;
        };
        Update: {
          email?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      goals: {
        Row: {
          id: string;
          owner_id: string;
          target_date: string;
          status: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          owner_id: string;
          target_date: string;
          status: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          owner_id?: string;
          target_date?: string;
          status?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      role_tracks: {
        Row: {
          id: string;
          owner_id: string;
          goal_id: string;
          role_name: string;
          company_name: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          owner_id: string;
          goal_id: string;
          role_name: string;
          company_name: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          owner_id?: string;
          goal_id?: string;
          role_name?: string;
          company_name?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "role_tracks_owner_id_goal_id_fkey";
            columns: ["owner_id", "goal_id"];
            isOneToOne: false;
            referencedRelation: "goals";
            referencedColumns: ["owner_id", "id"];
          },
        ];
      };
      sprints: {
        Row: {
          id: string;
          owner_id: string;
          goal_id: string;
          start_date: string;
          end_date: string;
          status: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          owner_id: string;
          goal_id: string;
          start_date: string;
          end_date: string;
          status: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          owner_id?: string;
          goal_id?: string;
          start_date?: string;
          end_date?: string;
          status?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "sprints_owner_id_goal_id_fkey";
            columns: ["owner_id", "goal_id"];
            isOneToOne: false;
            referencedRelation: "goals";
            referencedColumns: ["owner_id", "id"];
          },
        ];
      };
      plan_revisions: {
        Row: {
          id: string;
          owner_id: string;
          sprint_id: string;
          revision_number: number;
          content_hash: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          owner_id: string;
          sprint_id: string;
          revision_number: number;
          content_hash: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          owner_id?: string;
          sprint_id?: string;
          revision_number?: number;
          content_hash?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "plan_revisions_owner_id_sprint_id_fkey";
            columns: ["owner_id", "sprint_id"];
            isOneToOne: false;
            referencedRelation: "sprints";
            referencedColumns: ["owner_id", "id"];
          },
        ];
      };
      tasks: {
        Row: {
          id: string;
          owner_id: string;
          sprint_id: string;
          title: string;
          status: string;
          estimated_minutes: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          owner_id: string;
          sprint_id: string;
          title: string;
          status: string;
          estimated_minutes: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          owner_id?: string;
          sprint_id?: string;
          title?: string;
          status?: string;
          estimated_minutes?: number;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "tasks_owner_id_sprint_id_fkey";
            columns: ["owner_id", "sprint_id"];
            isOneToOne: false;
            referencedRelation: "sprints";
            referencedColumns: ["owner_id", "id"];
          },
        ];
      };
      task_dependencies: {
        Row: {
          owner_id: string;
          task_id: string;
          depends_on_task_id: string;
        };
        Insert: {
          owner_id: string;
          task_id: string;
          depends_on_task_id: string;
        };
        Update: {
          owner_id?: string;
          task_id?: string;
          depends_on_task_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "task_dependencies_owner_id_task_id_fkey";
            columns: ["owner_id", "task_id"];
            isOneToOne: false;
            referencedRelation: "tasks";
            referencedColumns: ["owner_id", "id"];
          },
          {
            foreignKeyName: "task_dependencies_owner_id_depends_on_task_id_fkey";
            columns: ["owner_id", "depends_on_task_id"];
            isOneToOne: false;
            referencedRelation: "tasks";
            referencedColumns: ["owner_id", "id"];
          },
        ];
      };
      daily_logs: {
        Row: {
          id: string;
          owner_id: string;
          log_date: string;
          capacity_minutes: number;
          notes: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          owner_id: string;
          log_date: string;
          capacity_minutes: number;
          notes?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          owner_id?: string;
          log_date?: string;
          capacity_minutes?: number;
          notes?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      weekly_reviews: {
        Row: {
          id: string;
          owner_id: string;
          sprint_id: string;
          review_date: string;
          bottleneck: string | null;
          adjustment_notes: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          owner_id: string;
          sprint_id: string;
          review_date: string;
          bottleneck?: string | null;
          adjustment_notes?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          owner_id?: string;
          sprint_id?: string;
          review_date?: string;
          bottleneck?: string | null;
          adjustment_notes?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "weekly_reviews_owner_id_sprint_id_fkey";
            columns: ["owner_id", "sprint_id"];
            isOneToOne: false;
            referencedRelation: "sprints";
            referencedColumns: ["owner_id", "id"];
          },
        ];
      };
      mutation_receipts: {
        Row: {
          owner_id: string;
          request_uuid: string;
          operation_name: string;
          payload_hash: string;
          created_at: string;
        };
        Insert: {
          owner_id: string;
          request_uuid: string;
          operation_name: string;
          payload_hash: string;
          created_at?: string;
        };
        Update: {
          owner_id?: string;
          request_uuid?: string;
          operation_name?: string;
          payload_hash?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      sessions: {
        Row: {
          id: string;
          owner_id: string;
          pack_id: string;
          status: string;
          started_at: string | null;
          deadline_at: string | null;
          finish_reason: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          owner_id: string;
          pack_id: string;
          status: string;
          started_at?: string | null;
          deadline_at?: string | null;
          finish_reason?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          owner_id?: string;
          pack_id?: string;
          status?: string;
          started_at?: string | null;
          deadline_at?: string | null;
          finish_reason?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      session_prompts: {
        Row: {
          id: string;
          owner_id: string;
          session_id: string;
          prompt_id: string;
          exposed: boolean;
        };
        Insert: {
          id?: string;
          owner_id: string;
          session_id: string;
          prompt_id: string;
          exposed?: boolean;
        };
        Update: {
          id?: string;
          owner_id?: string;
          session_id?: string;
          prompt_id?: string;
          exposed?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: "session_prompts_owner_id_session_id_fkey";
            columns: ["owner_id", "session_id"];
            isOneToOne: false;
            referencedRelation: "sessions";
            referencedColumns: ["owner_id", "id"];
          },
        ];
      };
      drafts: {
        Row: {
          id: string;
          owner_id: string;
          session_id: string;
          prompt_id: string;
          content: string;
          revision_number: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          owner_id: string;
          session_id: string;
          prompt_id: string;
          content: string;
          revision_number: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          owner_id?: string;
          session_id?: string;
          prompt_id?: string;
          content?: string;
          revision_number?: number;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "drafts_owner_id_session_id_fkey";
            columns: ["owner_id", "session_id"];
            isOneToOne: false;
            referencedRelation: "sessions";
            referencedColumns: ["owner_id", "id"];
          },
        ];
      };
      attempts: {
        Row: {
          id: string;
          owner_id: string;
          session_id: string;
          prompt_id: string;
          final_content: string;
          time_taken_seconds: number | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          owner_id: string;
          session_id: string;
          prompt_id: string;
          final_content: string;
          time_taken_seconds?: number | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          owner_id?: string;
          session_id?: string;
          prompt_id?: string;
          final_content?: string;
          time_taken_seconds?: number | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "attempts_owner_id_session_id_fkey";
            columns: ["owner_id", "session_id"];
            isOneToOne: false;
            referencedRelation: "sessions";
            referencedColumns: ["owner_id", "id"];
          },
        ];
      };
      execution_evidence: {
        Row: {
          id: string;
          owner_id: string;
          attempt_id: string;
          competency_key: string;
          rating: number | null;
          observation: string | null;
          evaluator_provenance: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          owner_id: string;
          attempt_id: string;
          competency_key: string;
          rating?: number | null;
          observation?: string | null;
          evaluator_provenance: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          owner_id?: string;
          attempt_id?: string;
          competency_key?: string;
          rating?: number | null;
          observation?: string | null;
          evaluator_provenance?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "execution_evidence_owner_id_attempt_id_fkey";
            columns: ["owner_id", "attempt_id"];
            isOneToOne: false;
            referencedRelation: "attempts";
            referencedColumns: ["owner_id", "id"];
          },
        ];
      };
      reviews: {
        Row: {
          id: string;
          owner_id: string;
          session_id: string;
          review_content: string;
          superseded: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          owner_id: string;
          session_id: string;
          review_content: string;
          superseded?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          owner_id?: string;
          session_id?: string;
          review_content?: string;
          superseded?: boolean;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "reviews_owner_id_session_id_fkey";
            columns: ["owner_id", "session_id"];
            isOneToOne: false;
            referencedRelation: "sessions";
            referencedColumns: ["owner_id", "id"];
          },
        ];
      };
      repairs: {
        Row: {
          id: string;
          owner_id: string;
          competency_key: string;
          trigger_evidence_id: string | null;
          status: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          owner_id: string;
          competency_key: string;
          trigger_evidence_id?: string | null;
          status: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          owner_id?: string;
          competency_key?: string;
          trigger_evidence_id?: string | null;
          status?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      learning_cards: {
        Row: {
          id: string;
          owner_id: string;
          concept_key: string;
          lesson: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          owner_id: string;
          concept_key: string;
          lesson: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          owner_id?: string;
          concept_key?: string;
          lesson?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      recall_items: {
        Row: {
          id: string;
          owner_id: string;
          concept_key: string;
          interval_days: number;
          next_due_date: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          owner_id: string;
          concept_key: string;
          interval_days?: number;
          next_due_date: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          owner_id?: string;
          concept_key?: string;
          interval_days?: number;
          next_due_date?: string;
          created_at?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      start_session: {
        Args: {
          p_owner_id: string;
          p_request_uuid: string;
          p_pack_id: string;
          p_deadline_at: string;
        };
        Returns: string;
      };
      finalize_session: {
        Args: {
          p_owner_id: string;
          p_request_uuid: string;
          p_session_id: string;
          p_finish_reason: string;
        };
        Returns: boolean;
      };
      submit_review: {
        Args: {
          p_owner_id: string;
          p_request_uuid: string;
          p_session_id: string;
          p_review_content: string;
        };
        Returns: string;
      };
      atomic_debrief: {
        Args: {
          p_owner_id: string;
          p_request_uuid: string;
          p_session_id: string;
          p_review_content: string;
          p_evidence: Json;
          p_repairs: Json;
          p_cards: Json;
        };
        Returns: boolean;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};
