-- 00000000000003_onboarding.sql
-- Sprint 07: Database Schema for Onboarding, Profile & Goal Configuration
--
-- Implements tables for candidate profile, immutable versioned goals,
-- and 7-day preparation capacity patterns with multi-tenant RLS.

-- 1. User Profiles
CREATE TABLE IF NOT EXISTS public.user_profiles (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    major TEXT NOT NULL DEFAULT 'CSE',
    graduation_date DATE NOT NULL DEFAULT '2026-12-01',
    primary_language TEXT NOT NULL DEFAULT 'Python',
    cgpa NUMERIC(4,2),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (owner_id, id),
    UNIQUE (owner_id, id)
);

-- 2. Versioned User Goals (AC-03: Incremented versioning rather than overwriting)
CREATE TABLE IF NOT EXISTS public.user_goals (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    version INT NOT NULL DEFAULT 1,
    target_roles TEXT[] NOT NULL DEFAULT '{"general SDE/backend"}',
    target_companies TEXT[] NOT NULL DEFAULT '{"CRED"}',
    target_date DATE NOT NULL DEFAULT '2026-11-30',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (owner_id, id, version),
    UNIQUE (owner_id, id, version)
);

-- 3. 7-Day Capacity Patterns (AC-02: Total minutes and uninterrupted opening lengths)
CREATE TABLE IF NOT EXISTS public.user_capacities (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    day_of_week INT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
    total_minutes INT NOT NULL,
    uninterrupted_lengths INT[] NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (owner_id, day_of_week),
    UNIQUE (owner_id, day_of_week)
);

-- Enable Row Level Security
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_capacities ENABLE ROW LEVEL SECURITY;

-- Multi-Tenant RLS Policies
CREATE POLICY "Users can manage their own profiles"
    ON public.user_profiles
    FOR ALL
    USING (auth.uid() = owner_id);

CREATE POLICY "Users can manage their own goals"
    ON public.user_goals
    FOR ALL
    USING (auth.uid() = owner_id);

CREATE POLICY "Users can manage their own capacities"
    ON public.user_capacities
    FOR ALL
    USING (auth.uid() = owner_id);
