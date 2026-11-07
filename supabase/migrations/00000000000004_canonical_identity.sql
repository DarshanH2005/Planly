-- 00000000000004_canonical_identity.sql
-- Sprint B02: Canonical Identity, Allowlist Reconciliation & Private Schema Baseline
--
-- Reconciles Family A (00000000000000-03) and Family B (20260908000001-02).
-- Establishes private planly schema with least-privilege server access,
-- canonical auth.users(id) owner linkage, and non-destructive compatibility views.

-- 1. Create dedicated private planly schema
CREATE SCHEMA IF NOT EXISTS planly;

-- 2. Reconcile allowed_owners table in public schema
CREATE TABLE IF NOT EXISTS public.allowed_owners (
    owner_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Reconcile owner_allowlist (email pre-registration gate)
CREATE TABLE IF NOT EXISTS public.owner_allowlist (
    email TEXT PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS Helper function checking allowed_owners
CREATE OR REPLACE FUNCTION public.is_allowed_owner()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.allowed_owners
        WHERE owner_id = auth.uid()
    );
$$;

REVOKE EXECUTE ON FUNCTION public.is_allowed_owner() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_allowed_owner() TO authenticated, service_role;

-- 3. Canonical planly.profiles table
CREATE TABLE IF NOT EXISTS planly.profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL DEFAULT 'Candidate',
    timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    language TEXT NOT NULL DEFAULT 'python',
    graduation_date DATE NOT NULL DEFAULT '2026-12-01',
    cgpa NUMERIC(4,2) CHECK (cgpa IS NULL OR (cgpa >= 0.0 AND cgpa <= 10.0)),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_planly_profiles_owner UNIQUE (owner_id),
    CONSTRAINT uq_planly_profiles_owner_id UNIQUE (owner_id, id)
);

-- 4. Non-destructive sync trigger: when user signs in or registers, bridge email allowlist to allowed_owners
CREATE OR REPLACE FUNCTION public.handle_user_allowlist_sync()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM public.owner_allowlist WHERE LOWER(email) = LOWER(NEW.email)) THEN
        INSERT INTO public.allowed_owners (owner_id)
        VALUES (NEW.id)
        ON CONFLICT (owner_id) DO NOTHING;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_sync_user_allowlist ON auth.users;
CREATE TRIGGER tr_sync_user_allowlist
    AFTER INSERT OR UPDATE OF email ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_user_allowlist_sync();

-- 5. Least-Privilege Access & RLS configuration
ALTER TABLE public.allowed_owners ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.owner_allowlist ENABLE ROW LEVEL SECURITY;
ALTER TABLE planly.profiles ENABLE ROW LEVEL SECURITY;

-- Anonymous users cannot read or write identity tables
REVOKE ALL ON SCHEMA planly FROM anon, PUBLIC;
GRANT USAGE ON SCHEMA planly TO authenticated, service_role;

-- Allowed owners can manage their own planly profile
CREATE POLICY owner_planly_profiles ON planly.profiles
    FOR ALL
    USING (auth.uid() = owner_id AND public.is_allowed_owner())
    WITH CHECK (auth.uid() = owner_id AND public.is_allowed_owner());

-- Service role has full server management access
CREATE POLICY service_role_planly_profiles ON planly.profiles
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- Browser direct access restrictions on allowed_owners
CREATE POLICY owner_view_allowed ON public.allowed_owners
    FOR SELECT
    USING (auth.uid() = owner_id);

CREATE POLICY service_role_allowed_owners ON public.allowed_owners
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);
