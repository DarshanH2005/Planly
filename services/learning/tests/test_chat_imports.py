import sys
from pathlib import Path

# Ensure services/learning and workspace root are on sys.path
BASE_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BASE_DIR))
WORKSPACE_ROOT = BASE_DIR.parent.parent
if str(WORKSPACE_ROOT) not in sys.path:
    sys.path.insert(0, str(WORKSPACE_ROOT))

from learning.domain.contracts import SourceKind, AssistanceLevel
from learning.repositories.sources import (
    reset_sources_store,
    get_source_turns,
)
from learning.repositories.evidence import (
    reset_evidence_store,
    get_session_observations,
)
from learning.imports.parser import parse_chat_export
from learning.imports.importer import (
    import_chat_export_file,
    reset_import_sessions,
    get_imported_session_id,
)

OWNER_ID = "00000000-0000-0000-0000-000000000001"
DOWNLOADS_DIR = Path("C:/Users/darsh/Downloads")
EVALS_DIR = BASE_DIR.parent.parent / "evals" / "cases" / "import"


def setup_function():
    reset_sources_store()
    reset_evidence_store()
    reset_import_sessions()


def test_b05_ac1_idempotent_import_no_doubling():
    """B05-AC1: Import twice without doubling observations."""
    setup_function()
    dsa_file = DOWNLOADS_DIR / "darshan_dsa_chat_export.md"
    assert dsa_file.exists(), f"File {dsa_file} must exist"

    # Pass 1: Fresh import
    res1 = import_chat_export_file(OWNER_ID, dsa_file, track_override="dsa")
    assert res1.is_duplicate is False
    assert res1.observations_created == 2
    session_id = get_imported_session_id(OWNER_ID, "dsa")
    assert session_id is not None
    obs_pass1 = get_session_observations(OWNER_ID, session_id)
    assert len(obs_pass1) == 2

    # Pass 2: Re-import identical file
    res2 = import_chat_export_file(OWNER_ID, dsa_file, track_override="dsa")
    assert res2.is_duplicate is True
    assert res2.observations_created == 0

    # Total observations remain strictly 2 (no doubling!)
    obs_pass2 = get_session_observations(OWNER_ID, session_id)
    assert len(obs_pass2) == 2
    print(f"B05-AC1 Idempotent import verified (Pass 1: {len(obs_pass1)}, Pass 2: {len(obs_pass2)}): PASSED")


def test_b05_ac2_unsupported_percentage_never_enters_readiness():
    """B05-AC2: The supplied unsupported DSA percentage never enters measured readiness."""
    setup_function()
    fixture_file = EVALS_DIR / "test_unsupported_percentage.md"
    assert fixture_file.exists(), f"Fixture {fixture_file} must exist"

    text = fixture_file.read_text(encoding="utf-8")
    parsed = parse_chat_export(text, default_track="dsa")

    # Percentage claim detected and flagged
    assert len(parsed.unsupported_percentage_claims) > 0
    assert any("85% DSA readiness" in c for c in parsed.unsupported_percentage_claims)

    # Ingest fixture
    res = import_chat_export_file(OWNER_ID, fixture_file, track_override="dsa")
    session_id = get_imported_session_id(OWNER_ID, "dsa")
    obs = get_session_observations(OWNER_ID, session_id)

    # No observation claims 85% readiness as demonstrated understanding
    for o in obs:
        assert o.demonstrated is False
        assert "85%" not in o.evidence_text
    print("B05-AC2 Unsupported percentage excluded from readiness: PASSED")


def test_b05_ac3_cs_heap_not_demonstrated_ml_unsubmitted():
    """
    B05-AC3: The CS tutor correction does not mark learner understanding demonstrated; ML remains unsubmitted.
    """
    setup_function()

    # 1. CS Fundamentals Import
    cs_file = DOWNLOADS_DIR / "darshan_cs_fundamentals_chat_export.md"
    assert cs_file.exists(), f"File {cs_file} must exist"
    cs_res = import_chat_export_file(OWNER_ID, cs_file, track_override="cs")
    assert cs_res.is_duplicate is False

    cs_session_id = get_imported_session_id(OWNER_ID, "cs")
    cs_obs = get_session_observations(OWNER_ID, cs_session_id)

    heap_obs = next((o for o in cs_obs if o.competency_key == "per_process_heap"), None)
    assert heap_obs is not None
    assert heap_obs.source_kind == SourceKind.TUTOR_EXPLANATION
    assert heap_obs.assistance_level == AssistanceLevel.TUTOR_SUPPLIED
    assert heap_obs.demonstrated is False
    print("B05-AC3 CS per-process heap explanation NOT marked demonstrated: PASSED")

    # 2. AI/ML Mentorship Import
    ml_file = DOWNLOADS_DIR / "darshan_ai_ml_chat_export.md"
    assert ml_file.exists(), f"File {ml_file} must exist"
    ml_res = import_chat_export_file(OWNER_ID, ml_file, track_override="ai_ml")
    assert ml_res.is_duplicate is False

    ml_session_id = get_imported_session_id(OWNER_ID, "ai_ml")
    ml_obs = get_session_observations(OWNER_ID, ml_session_id)

    ml_reg_obs = next((o for o in ml_obs if o.competency_key == "linear_regression_numpy"), None)
    assert ml_reg_obs is not None
    assert ml_reg_obs.assistance_level == AssistanceLevel.UNASSESSED
    assert ml_reg_obs.demonstrated is False
    assert "unsubmitted" in ml_reg_obs.evidence_text.lower()
    print("B05-AC3 ML linear regression remains unsubmitted and unassessed: PASSED")


def test_b05_ac4_malformed_speaker_boundaries_reported():
    """B05-AC4: Malformed/partial export boundaries are reported rather than silently assigned to the wrong speaker."""
    setup_function()
    malformed_file = EVALS_DIR / "test_malformed_speaker.md"
    assert malformed_file.exists(), f"Fixture {malformed_file} must exist"

    text = malformed_file.read_text(encoding="utf-8")
    parsed = parse_chat_export(text, default_track="dsa")

    # Ensure extraction issues were reported
    assert len(parsed.extraction_issues) >= 1
    issue_types = [i.issue_type for i in parsed.extraction_issues]
    assert "ambiguous_speaker_boundary" in issue_types

    # Ensure the malformed block was NOT assigned as a valid speaker turn
    turn_speakers = [t.speaker for t in parsed.turns]
    assert "unknownspeakercandidate" not in [t.content.lower() for t in parsed.turns]
    print(f"B05-AC4 Malformed boundaries reported ({len(parsed.extraction_issues)} issues found): PASSED")


def test_b05_all_three_real_exports_ingestion():
    """Full end-to-end run of scripts/import_chats.py on all three real Downloads files."""
    setup_function()
    from scripts.import_chats import run_import
    results = run_import(DOWNLOADS_DIR, OWNER_ID)
    assert len(results) == 3
    for r in results:
        assert r.is_duplicate is False
        assert r.turn_count > 0
    print("B05 Full End-to-End Ingestion of All 3 Real Exports: PASSED")


if __name__ == "__main__":
    setup_function()
    test_b05_ac1_idempotent_import_no_doubling()
    test_b05_ac2_unsupported_percentage_never_enters_readiness()
    test_b05_ac3_cs_heap_not_demonstrated_ml_unsubmitted()
    test_b05_ac4_malformed_speaker_boundaries_reported()
    test_b05_all_three_real_exports_ingestion()
    print("\nAll B05 Import & Evidence Preservation Tests PASSED successfully.")
