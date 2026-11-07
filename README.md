# Planly — Private Technical Interview Workbench

**Version**: 1.0 (Personal Release R1) · **Release Checkpoint**: November 30, 2026  
**Target Candidate**: CSE Student (Graduating Dec 2026, Python 3 focus)  
**Target Roles**: SDE-1 / Backend & Platform Engineering (CRED / Tier-1 Product Companies)  

Planly is an evidence-based interview-training platform that turns target role requirements and observed performance into feasible 14-day sprints, runs realistic hiring-stage sessions, preserves attempts immutably, and chooses targeted practice that demonstrates measurable improvement.

---

## The Six Backbone Components (§2)

| Component | Responsibility | Invariant Enforced |
|---|---|---|
| **B1. Curriculum & Content** | 198 catalogue entries, 19 pattern cards, validated starter bundles, and exposure tracking | Familiar prompts are never labelled unseen; private solutions never leak to candidate payloads (AC13, AC20). |
| **B2. Adaptive Planner** | Deterministic 14-day sprint builder, 80% safety buffer budgets, missed-day reallocation, and stale commit guards | Pure TypeScript rules; identical inputs produce identical plans without stochastic LLM calls (AC04, AC05, AC07). |
| **B3. Interview Arena** | Preflight checks, server-authoritative timer, CodeMirror 6 workspace, authored clarification and follow-up trees | Strict attempts preserve evaluation conditions; attempts become immutable once finalized or timed out (AC09, AC10, AC14). |
| **B4. Evidence & Remediation** | Failure-to-repair lifecycle (`proposed → scheduled → drilled → retested → improved`), spaced recall engine, and non-destructive review supersession | Task completion alone never establishes competence; repairs require linked drill attempts and unfamiliar transfer retests (AC17, AC18, AC22). |
| **B5. Persistence & Access** | Single-owner allowlist RLS, composite foreign keys `(owner_id, id)`, and versioned JSON backup/restore round-trip | Private records remain owned, consistent, and recoverable; unauthorized accounts receive HTTP 403 / FORBIDDEN (AC01, AC02, AC24). |
| **B6. Daily Experience** | Today cockpit (Minimum Day 12m, Rest Day 0m), 14-day Sprints diff calendar, Prep Hub/POTD, private Targets, and Projects defense | The primary screen makes the next useful action clear with minimal administration (R03, R04, R05, R15). |

---

## Verified Production Stack

- **Runtime**: Node.js 24 LTS, npm with committed `package-lock.json`
- **Framework**: Next.js 16.3.4 (App Router, Turbopack, React 19, TypeScript strict mode)
- **Styling**: Tailwind CSS 4, Lucide icons
- **Code Workspace**: CodeMirror 6 (client-side lazy loaded, Python & SQL syntax highlighting)
- **Database & Auth**: PostgreSQL with Supabase Auth and Row-Level Security (RLS)
- **Test Harness**: Vitest 5.0 (pure domain engines, fixtures, state machines, and boundary invariants)

---

## Hiring Stage Session Packs (§8.3)

All 7 hiring stages are fully supported with authored prompts, starter packs, and rubrics:
1. **Foundation (`PACK-FOUNDATION-01`)**: `FX-HASH-A` — Array frequency & first repeat diagnostic.
2. **Online Assessment (`PACK-OA-01`)**: `FX-HASH-A` + `FX-SEARCH-A` — Multi-question strict countdown simulation.
3. **Live Technical A (`PACK-TECHNICAL-A-01`)**: `FX-SEARCH-A` — Binary search invariant & talk-aloud defense.
4. **Live Technical B (`PACK-TECHNICAL-B-01`)**: `FX-TREE-LCA` — Binary Tree LCA with authored parent pointer follow-up.
5. **Engineering (`PACK-ENGINEERING-01`)**: `FX-ENG-RATELIMIT` — High-throughput Token Bucket rate limiter in Python.
6. **Portfolio Project (`PACK-PROJECT-01`)**: `FX-PROJ-PLANLY` — Planly architecture defense, concurrency, and commit tracking.
7. **Behavioural / HR (`PACK-BEHAVIOURAL-01`)**: `FX-BEHAV-DISAGREE` — Technical disagreement SAR interview (dedicated non-code rubric).
8. **SQL Core (`PACK-SQL-01`)**: `FX-SQL-ORDERS` — Customer order aggregation fixture returning `A100/B200/C0` (AC21).

---

## Contract Commands & Verification

Every required contract script passes with zero failures:

```powershell
# 1. Typecheck: strict TypeScript compilation
npm run typecheck

# 2. Lint: ESLint across all components and pages
npm run lint

# 3. Content Validation: validates 198 catalogue entries, 19 cards, and SHA-256 bundle
npm run content:validate

# 4. Unit Test Suite: runs all 118 unit tests across 9 test suites
npm run test:unit

# 5. Production Build: compiles all 14 routes cleanly with Turbopack
npm run build

# 6. Backup Validation: verifies versioned JSON backup integrity and checksum
npm run backup:validate -- path/to/backup.json

# 7. Workspace Restoration: atomically restores owned user workspace
npm run backup:restore -- path/to/backup.json [--overwrite]
```

---

## Documentation Links

- **Operational Manual**: [`docs/RUNBOOK.md`](file:///c:/Users/darsh/Desktop/App%20Dev/PERSONAL/planly-app/docs/RUNBOOK.md) — Provisioning, deployment, daily commands, and disaster recovery.
- **Architectural Decisions**: [`docs/DECISIONS.md`](file:///c:/Users/darsh/Desktop/App%20Dev/PERSONAL/planly-app/docs/DECISIONS.md) — ADRs covering architecture, rules engine, and privacy guarantees.
- **Build & Acceptance Status**: [`docs/BUILD_STATUS.md`](file:///c:/Users/darsh/Desktop/App%20Dev/PERSONAL/planly-app/docs/BUILD_STATUS.md) — Current milestone status and acceptance checklist.
