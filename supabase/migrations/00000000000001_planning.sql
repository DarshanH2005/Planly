-- 00000000000001_planning.sql
-- Sprint 02: Database Schema: Planning & Goals

CREATE TABLE public.goals (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    target_date DATE NOT NULL,
    status TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (owner_id, id)
);

CREATE TABLE public.role_tracks (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    goal_id UUID NOT NULL,
    role_name TEXT NOT NULL,
    company_name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (owner_id, id),
    FOREIGN KEY (owner_id, goal_id) REFERENCES public.goals(owner_id, id) ON DELETE CASCADE
);

CREATE TABLE public.sprints (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    goal_id UUID NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    status TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (owner_id, id),
    FOREIGN KEY (owner_id, goal_id) REFERENCES public.goals(owner_id, id) ON DELETE CASCADE
);

CREATE TABLE public.plan_revisions (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    sprint_id UUID NOT NULL,
    revision_number INT NOT NULL,
    content_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (owner_id, id),
    FOREIGN KEY (owner_id, sprint_id) REFERENCES public.sprints(owner_id, id) ON DELETE CASCADE
);

CREATE TABLE public.tasks (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    sprint_id UUID NOT NULL,
    title TEXT NOT NULL,
    status TEXT NOT NULL,
    estimated_minutes INT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (owner_id, id),
    FOREIGN KEY (owner_id, sprint_id) REFERENCES public.sprints(owner_id, id) ON DELETE CASCADE
);

CREATE TABLE public.task_dependencies (
    task_id UUID NOT NULL,
    depends_on_task_id UUID NOT NULL,
    owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    PRIMARY KEY (owner_id, task_id, depends_on_task_id),
    FOREIGN KEY (owner_id, task_id) REFERENCES public.tasks(owner_id, id) ON DELETE CASCADE,
    FOREIGN KEY (owner_id, depends_on_task_id) REFERENCES public.tasks(owner_id, id) ON DELETE CASCADE
);

CREATE TABLE public.daily_logs (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    log_date DATE NOT NULL,
    capacity_minutes INT NOT NULL,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (owner_id, id)
);

CREATE TABLE public.weekly_reviews (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    sprint_id UUID NOT NULL,
    review_date DATE NOT NULL,
    bottleneck TEXT,
    adjustment_notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (owner_id, id),
    FOREIGN KEY (owner_id, sprint_id) REFERENCES public.sprints(owner_id, id) ON DELETE CASCADE
);

-- RLS Policies
ALTER TABLE public.goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.role_tracks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sprints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plan_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_dependencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.weekly_reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner all goals" ON public.goals USING (auth.uid() = owner_id);
CREATE POLICY "Owner all role_tracks" ON public.role_tracks USING (auth.uid() = owner_id);
CREATE POLICY "Owner all sprints" ON public.sprints USING (auth.uid() = owner_id);
CREATE POLICY "Owner all plan_revisions" ON public.plan_revisions USING (auth.uid() = owner_id);
CREATE POLICY "Owner all tasks" ON public.tasks USING (auth.uid() = owner_id);
CREATE POLICY "Owner all task_deps" ON public.task_dependencies USING (auth.uid() = owner_id);
CREATE POLICY "Owner all daily_logs" ON public.daily_logs USING (auth.uid() = owner_id);
CREATE POLICY "Owner all weekly_reviews" ON public.weekly_reviews USING (auth.uid() = owner_id);
