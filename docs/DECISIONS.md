# Planly Architecture Decision Records (ADRs)

**Version**: 1.0 · **Baseline**: September 8, 2026  
**Status**: Adopted & Verified across Milestones M0–M5  

---

## ADR 01: Feature-Oriented Modular Monolith
- **Context**: The product requires coordinated interactions between scheduling, live coding sessions, reviews, curriculum, and target role tracking.
- **Decision**: Implemented as a single deployable Next.js 16 App Router application structured around feature boundaries (`src/features/*`). Avoided microservices, separate backend daemons, and premature distributed queues.
- **Consequence**: Zero inter-service network latency, unified type safety from database to UI, and straightforward local/Vercel deployment.

---

## ADR 02: Pure Deterministic Adaptive Planner (No LLM in Scheduling Loop)
- **Context**: Candidates experience schedule instability and hallucinated recommendations when planning logic relies on prompt engineering or stochastic LLM outputs.
- **Decision**: Implemented `buildSprint(input)` as a pure, deterministic TypeScript function. Given identical input and algorithm version, the plan output, priority scoring, buffer budgets (`min(target, floor(0.8 * declared))`), and diffs are 100% identical.
- **Consequence**: Fully reproducible and testable via unit test fixtures (`tests/unit/planner-fixtures.test.ts`, `tests/unit/daily-product-completeness.test.ts`). Stale plans are reliably detected via canonical payload hashes.

---

## ADR 03: Immutable Session State Machine & Append-Only Attempts
- **Context**: Practice sessions can experience accidental reloads, browser crashes, or disputed evaluations.
- **Decision**: Enforced an explicit state machine: `created → ready → in_progress → finalized → reviewed`. Attempts are frozen upon deadline expiry or finalization and become strictly immutable. Late code or post-deadline submissions are quarantined into separate fields.
- **Consequence**: Prevents retroactive tampering with timed benchmark evidence (AC10, AC12). Concurrency conflicts on drafts are trapped via optimistic revision locking (AC11).

---

## ADR 04: Candidate-Safe Server Content Projection
- **Context**: Training bundles contain authored clarification trees, follow-up criteria, private reference solutions, and test checks that must not leak to the candidate during strict sessions.
- **Decision**: Candidate payloads are projected server-side using pure transformation functions (`toCandidateSession`, `toCandidatePrompt`). Private fields (`privateReference`, `rubricCriteria`, unrevealed follow-ups) are completely excluded from client data transfer objects.
- **Consequence**: Verified via payload inspection tests (AC13). Candidates cannot inspect DOM or network tabs to uncover hidden hints or solutions.

---

## ADR 05: Non-Destructive Review Supersession (AC22)
- **Context**: Self-evaluations or peer reviews may be disputed or corrected after closer inspection of edge-case handling.
- **Decision**: Correcting an evaluation creates an immutable superseding revision (e.g. Revision 2 referencing `supersedes_id: rev-1`). The derived effective evidence aggregates update immediately, but the original disputed review and its raw observations remain permanently in the audit trail.
- **Consequence**: History is never erased or rewritten. Weekly evidence displays honest denominators, conditions, and explicit missing-data gaps rather than fabricated pass percentages.

---

## ADR 06: Private Offline Tracking (Zero External Outreach, AC23)
- **Context**: Automated job applications and unsolicited recruiter outreach violate candidate privacy and generate noisy spam.
- **Decision**: The Targets and Projects trackers persist strictly in owned local tables. Planly never triggers external network requests, bot scraping, or automated messaging upon application status changes.
- **Consequence**: Guarantees candidate data sovereignty and private self-guided pacing (AC23).

---

## ADR 07: Single-Owner Database Allowlist with Composite RLS
- **Context**: Public signup could expose private practice attempts or personal growth reflections.
- **Decision**: Provisioned owner UUID is recorded in a private `allowed_owners` database table. Supabase PostgreSQL Row-Level Security (RLS) policies check both `auth.uid() = owner_id` and membership in `allowed_owners`. All foreign keys reference `(owner_id, id)`.
- **Consequence**: A second authenticated user is blocked with HTTP 403 / FORBIDDEN. Cross-owner data access is structurally impossible at the SQL engine level (AC01, AC02).
