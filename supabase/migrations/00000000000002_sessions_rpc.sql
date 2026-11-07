-- 00000000000002_sessions_rpc.sql
-- Sprint 03: Database Schema: Sessions, Evidence & RPCs

CREATE TABLE public.mutation_receipts (
    owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    request_uuid UUID NOT NULL,
    operation_name TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (owner_id, request_uuid)
);

CREATE TABLE public.sessions (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    pack_id TEXT NOT NULL,
    status TEXT NOT NULL,
    started_at TIMESTAMPTZ,
    deadline_at TIMESTAMPTZ,
    finish_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (owner_id, id)
);

CREATE TABLE public.session_prompts (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    session_id UUID NOT NULL,
    prompt_id TEXT NOT NULL,
    exposed BOOLEAN NOT NULL DEFAULT false,
    PRIMARY KEY (owner_id, id),
    FOREIGN KEY (owner_id, session_id) REFERENCES public.sessions(owner_id, id) ON DELETE CASCADE
);

CREATE TABLE public.drafts (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    session_id UUID NOT NULL,
    prompt_id TEXT NOT NULL,
    content TEXT NOT NULL,
    revision_number INT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (owner_id, id),
    FOREIGN KEY (owner_id, session_id) REFERENCES public.sessions(owner_id, id) ON DELETE CASCADE
);

CREATE TABLE public.attempts (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    session_id UUID NOT NULL,
    prompt_id TEXT NOT NULL,
    final_content TEXT NOT NULL,
    time_taken_seconds INT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (owner_id, id),
    FOREIGN KEY (owner_id, session_id) REFERENCES public.sessions(owner_id, id) ON DELETE CASCADE
);

CREATE TABLE public.execution_evidence (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    attempt_id UUID NOT NULL,
    competency_key TEXT NOT NULL,
    rating INT,
    observation TEXT,
    evaluator_provenance TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (owner_id, id),
    FOREIGN KEY (owner_id, attempt_id) REFERENCES public.attempts(owner_id, id) ON DELETE CASCADE
);

CREATE TABLE public.reviews (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    session_id UUID NOT NULL,
    review_content TEXT NOT NULL,
    superseded BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (owner_id, id),
    FOREIGN KEY (owner_id, session_id) REFERENCES public.sessions(owner_id, id) ON DELETE CASCADE
);

CREATE TABLE public.repairs (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    competency_key TEXT NOT NULL,
    trigger_evidence_id UUID,
    status TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (owner_id, id)
);

CREATE TABLE public.learning_cards (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    concept_key TEXT NOT NULL,
    lesson TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (owner_id, id)
);

CREATE TABLE public.recall_items (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    concept_key TEXT NOT NULL,
    interval_days INT NOT NULL DEFAULT 1,
    next_due_date DATE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (owner_id, id)
);

-- RLS Enablement
ALTER TABLE public.mutation_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.session_prompts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.execution_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.repairs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.learning_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recall_items ENABLE ROW LEVEL SECURITY;

-- Owner Policies
CREATE POLICY "owner_all_mutation_receipts" ON public.mutation_receipts USING (auth.uid() = owner_id);
CREATE POLICY "owner_all_sessions" ON public.sessions USING (auth.uid() = owner_id);
CREATE POLICY "owner_all_session_prompts" ON public.session_prompts USING (auth.uid() = owner_id);
CREATE POLICY "owner_all_drafts" ON public.drafts USING (auth.uid() = owner_id);
CREATE POLICY "owner_all_attempts" ON public.attempts USING (auth.uid() = owner_id);
CREATE POLICY "owner_all_execution_evidence" ON public.execution_evidence USING (auth.uid() = owner_id);
CREATE POLICY "owner_all_reviews" ON public.reviews USING (auth.uid() = owner_id);
CREATE POLICY "owner_all_repairs" ON public.repairs USING (auth.uid() = owner_id);
CREATE POLICY "owner_all_learning_cards" ON public.learning_cards USING (auth.uid() = owner_id);
CREATE POLICY "owner_all_recall_items" ON public.recall_items USING (auth.uid() = owner_id);

-- Atomic RPC Functions

-- 1. start_session
CREATE OR REPLACE FUNCTION public.start_session(
    p_owner_id UUID,
    p_request_uuid UUID,
    p_pack_id TEXT,
    p_deadline_at TIMESTAMPTZ
) RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE
    v_session_id UUID;
    v_existing_hash TEXT;
BEGIN
    -- Authorization check
    IF auth.uid() IS NOT NULL AND auth.uid() != p_owner_id THEN
        RAISE EXCEPTION 'Unauthorized: Caller cannot start session for another owner';
    END IF;

    -- Idempotency check
    SELECT payload_hash INTO v_existing_hash
    FROM public.mutation_receipts
    WHERE owner_id = p_owner_id AND request_uuid = p_request_uuid;

    IF v_existing_hash IS NOT NULL THEN
        -- Return the session created by this receipt if match
        SELECT id INTO v_session_id
        FROM public.sessions
        WHERE owner_id = p_owner_id AND pack_id = p_pack_id
        ORDER BY created_at DESC
        LIMIT 1;
        RETURN v_session_id;
    END IF;

    INSERT INTO public.mutation_receipts (owner_id, request_uuid, operation_name, payload_hash)
    VALUES (p_owner_id, p_request_uuid, 'start_session', p_pack_id);

    INSERT INTO public.sessions (owner_id, pack_id, status, started_at, deadline_at)
    VALUES (p_owner_id, p_pack_id, 'running', now(), p_deadline_at)
    RETURNING id INTO v_session_id;

    RETURN v_session_id;
END;
$$;

-- 2. finalize_session
CREATE OR REPLACE FUNCTION public.finalize_session(
    p_owner_id UUID,
    p_request_uuid UUID,
    p_session_id UUID,
    p_finish_reason TEXT
) RETURNS BOOLEAN LANGUAGE plpgsql AS $$
DECLARE
    v_existing_hash TEXT;
    v_current_status TEXT;
BEGIN
    IF auth.uid() IS NOT NULL AND auth.uid() != p_owner_id THEN
        RAISE EXCEPTION 'Unauthorized';
    END IF;

    SELECT payload_hash INTO v_existing_hash
    FROM public.mutation_receipts
    WHERE owner_id = p_owner_id AND request_uuid = p_request_uuid;

    IF v_existing_hash IS NOT NULL THEN
        RETURN true;
    END IF;

    SELECT status INTO v_current_status
    FROM public.sessions
    WHERE owner_id = p_owner_id AND id = p_session_id;

    IF v_current_status IS NULL THEN
        RAISE EXCEPTION 'Session not found';
    END IF;

    IF v_current_status != 'running' THEN
        -- Already finalized
        RETURN true;
    END IF;

    UPDATE public.sessions
    SET status = 'finalized',
        finish_reason = p_finish_reason,
        updated_at = now()
    WHERE owner_id = p_owner_id AND id = p_session_id;

    INSERT INTO public.mutation_receipts (owner_id, request_uuid, operation_name, payload_hash)
    VALUES (p_owner_id, p_request_uuid, 'finalize_session', p_session_id::text || ':' || p_finish_reason);

    RETURN true;
END;
$$;

-- 3. submit_review
CREATE OR REPLACE FUNCTION public.submit_review(
    p_owner_id UUID,
    p_request_uuid UUID,
    p_session_id UUID,
    p_review_content TEXT
) RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE
    v_existing_hash TEXT;
    v_review_id UUID;
BEGIN
    IF auth.uid() IS NOT NULL AND auth.uid() != p_owner_id THEN
        RAISE EXCEPTION 'Unauthorized';
    END IF;

    SELECT payload_hash INTO v_existing_hash
    FROM public.mutation_receipts
    WHERE owner_id = p_owner_id AND request_uuid = p_request_uuid;

    IF v_existing_hash IS NOT NULL THEN
        SELECT id INTO v_review_id
        FROM public.reviews
        WHERE owner_id = p_owner_id AND session_id = p_session_id AND superseded = false
        ORDER BY created_at DESC
        LIMIT 1;
        RETURN v_review_id;
    END IF;

    -- Supersede older reviews for this session
    UPDATE public.reviews
    SET superseded = true
    WHERE owner_id = p_owner_id AND session_id = p_session_id AND superseded = false;

    -- Insert new review
    INSERT INTO public.reviews (owner_id, session_id, review_content, superseded)
    VALUES (p_owner_id, p_session_id, p_review_content, false)
    RETURNING id INTO v_review_id;

    INSERT INTO public.mutation_receipts (owner_id, request_uuid, operation_name, payload_hash)
    VALUES (p_owner_id, p_request_uuid, 'submit_review', p_session_id::text);

    RETURN v_review_id;
END;
$$;

-- 4. atomic_debrief
CREATE OR REPLACE FUNCTION public.atomic_debrief(
    p_owner_id UUID,
    p_request_uuid UUID,
    p_session_id UUID,
    p_review_content TEXT,
    p_evidence JSONB,
    p_repairs JSONB,
    p_cards JSONB
) RETURNS BOOLEAN LANGUAGE plpgsql AS $$
DECLARE
    v_existing_hash TEXT;
    v_attempt_id UUID;
    v_item JSONB;
BEGIN
    IF auth.uid() IS NOT NULL AND auth.uid() != p_owner_id THEN
        RAISE EXCEPTION 'Unauthorized';
    END IF;

    SELECT payload_hash INTO v_existing_hash
    FROM public.mutation_receipts
    WHERE owner_id = p_owner_id AND request_uuid = p_request_uuid;

    IF v_existing_hash IS NOT NULL THEN
        RETURN true;
    END IF;

    -- 1. Insert review if provided
    IF p_review_content IS NOT NULL AND p_review_content != '' THEN
        UPDATE public.reviews
        SET superseded = true
        WHERE owner_id = p_owner_id AND session_id = p_session_id AND superseded = false;

        INSERT INTO public.reviews (owner_id, session_id, review_content, superseded)
        VALUES (p_owner_id, p_session_id, p_review_content, false);
    END IF;

    -- 2. Insert repairs if array provided
    IF p_repairs IS NOT NULL AND jsonb_typeof(p_repairs) = 'array' THEN
        FOR v_item IN SELECT * FROM jsonb_array_elements(p_repairs)
        LOOP
            INSERT INTO public.repairs (owner_id, competency_key, status)
            VALUES (
                p_owner_id,
                v_item->>'competency_key',
                COALESCE(v_item->>'status', 'pending')
            );
        END LOOP;
    END IF;

    -- 3. Insert learning cards if array provided
    IF p_cards IS NOT NULL AND jsonb_typeof(p_cards) = 'array' THEN
        FOR v_item IN SELECT * FROM jsonb_array_elements(p_cards)
        LOOP
            INSERT INTO public.learning_cards (owner_id, concept_key, lesson)
            VALUES (
                p_owner_id,
                v_item->>'concept_key',
                v_item->>'lesson'
            );
        END LOOP;
    END IF;

    -- 4. Mark session reviewed
    UPDATE public.sessions
    SET status = 'reviewed',
        updated_at = now()
    WHERE owner_id = p_owner_id AND id = p_session_id;

    -- 5. Record receipt
    INSERT INTO public.mutation_receipts (owner_id, request_uuid, operation_name, payload_hash)
    VALUES (p_owner_id, p_request_uuid, 'atomic_debrief', p_session_id::text);

    RETURN true;
END;
$$;
