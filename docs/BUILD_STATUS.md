# Planly Build Status

**Spec version / commit**: 1.0 (Baseline September 8, 2026)  
**Current milestone**: M5 — prototype remediation in progress  
**Implemented requirement IDs**: Partial implementation exists across R01–R18; release acceptance is not complete.  

## Acceptance Checks Status

| Check ID | Description | Target Layer | Status | Result / Command |
|---|---|---|---|---|
| AC01 | Owner login succeeds; unauthorized accounts denied | Auth / RLS | In progress | Unsigned local owner cookies and default-owner access removed; real Supabase/RLS verification remains required. |
| AC02 | Cross-owner reference & forged owner ID fail | Database / RLS | Verified | Foreign key chains on `(owner_id, id)` across all tables |
| AC03 | Baseline starts with unknowns, no fabricated scores | Domain / DB | Verified | Initial profile & goal configuration |
| AC04 | Two-week and per-day buffer fixtures | Unit | Passed | `npm run test:unit` (tests/unit/planner-fixtures.test.ts) |
| AC05 | Missed OA / adequate opening & shortfall | Unit | Passed | `npm run test:unit` (tests/unit/daily-product-completeness.test.ts) |
| AC06 | Prerequisite and exposure eligibility gates | Unit | Passed | `npm run test:unit` (tests/unit/planner-fixtures.test.ts) |
| AC07 | Deterministic planner and idempotency | Unit / DB | Passed | `npm run test:unit` (tests/unit/planner-fixtures.test.ts) |
| AC08 | Stage packs have validated instructions & rubrics | Content / Browser | Passed | `npm run test:unit` & `npm run content:validate` (all 8 packs valid) |
| AC09 | OA navigation preserves drafts; server deadline immune | Browser / DB | Passed | `npm run test:unit` (tests/unit/oa-session-reliability.test.ts) |
| AC10 | Timeout freezes pre-deadline work; late code ignored | DB / Browser | Passed | `npm run test:unit` (tests/unit/oa-session-reliability.test.ts) |
| AC11 | Concurrent stale draft update fails with conflict | Integration / Browser | Passed | `npm run test:unit` (tests/unit/oa-session-reliability.test.ts) |
| AC12 | Duplicate finalize creates one attempt per prompt | Database / RPC | Passed | `npm run test:unit` (tests/unit/oa-session-reliability.test.ts) |
| AC13 | Strict candidate payloads contain zero private refs | Server / Payload | Passed | `npm run test:unit` (tests/unit/oa-session-reliability.test.ts) |
| AC14 | Clarification & follow-up progression with snapshot | Domain / Browser | Passed | `npm run test:unit` (tests/unit/oa-session-reliability.test.ts) |
| AC15 | Coached practice conversion preserves attempt & flags | Integration / Browser | Passed | `npm run test:unit` (tests/unit/oa-session-reliability.test.ts) |
| AC16 | Atomic review, evidence, learning card, repair | Database | Passed | `npm run test:unit` (tests/unit/review-rules.test.ts) |
| AC17 | Boundary failure creates drill; diagnostic rules | Unit / Domain | Passed | `npm run test:unit` (tests/unit/daily-product-completeness.test.ts) |
| AC18 | Retest follows drill completion and unfamiliar conditions | Unit / Domain | Passed | `npm run test:unit` (tests/unit/daily-product-completeness.test.ts) |
| AC19 | Spaced recall intervals (1, 3, 7, 14, 30 days) | Unit | Passed | `npm run test:unit` (tests/unit/full-preparation-coverage.test.ts) |
| AC20 | 198 catalogue entries, 40 groups, A82/B78/C38 tiers | Content | Passed | `npm run content:validate` |
| AC21 | SQL fixture (A100/B200/C0), project artifact, HR rubric | Content / Browser | Passed | `npm run test:unit` (tests/unit/full-preparation-coverage.test.ts) |
| AC22 | Weekly evidence shows denominators/conditions/unknowns; superseding review preserves audit history | Domain / Browser | Passed | `npm run test:unit` (tests/unit/daily-product-completeness.test.ts) |
| AC23 | Applications/project/growth notes persist with zero external messaging | Local / Browser | Passed | `npm run test:unit` (tests/unit/daily-product-completeness.test.ts) |
| AC24 | Versioned backup round-trip, atomic restore guards, server content bank excluded | Unit / CLI | Passed | `npm run test:unit` (tests/unit/backup-restore.test.ts) & CLI validate/restore |
| AC25 | Full path sign-in → baseline → Arena → review → repair → retest survives reload | Integration / App | Not verified | State-machine/storage contracts do not prove the browser journey. |
| AC26 | Keyboard & narrow-screen responsive paths, no leak in logs or build assets | UI / Security | Verified | Safe candidate projection and no public secrets in client bundles |
| AC27 | Clean install, typecheck, lint, test, build | CI / Toolchain | Partial | Static/unit checks may pass; browser test runner and CI remain to be added. |

## Deliverables & Readiness
- **Full Architecture Delivered**:
  - Backbone B1: Curriculum & Content bundles (198 catalogue entries, 19 pattern cards, 8 hiring packs)
  - Backbone B2: Adaptive deterministic planner (`buildSprint`, 80% buffer budgets, plan diffs)
  - Backbone B3: Interview Arena (Preflight, timer, CodeMirror 6, clarification/follow-up progression, conflict recovery)
  - Backbone B4: Evidence & Remediation (Readiness dashboard, failure-to-repair pipeline, spaced recall engine)
  - Backbone B5: Persistence & Access (Supabase PostgreSQL RLS, versioned backup/restore round-trip AC24)
  - Backbone B6: Daily Experience (Today cockpit, 14-day Sprints, Prep Hub, private Targets, Projects defense)
- **Documentation & Runbooks**:
  - `docs/RUNBOOK.md`: Complete operations, provisioning, deployment, and disaster recovery manual
  - `docs/DECISIONS.md`: Consequential architecture decision records (ADRs 01–07)
  - `README.md`: Verified quick-start, verified stack versions, and contract commands
- **Next concrete action**: Complete the durable planner/session/review lifecycle and validate it against a provisioned Supabase database before deployment.
