"""Idempotently attach a reviewed, hash-checked briefing to one owner's source."""
import argparse
import hashlib
import json
from pathlib import Path
from datetime import datetime, timezone

from learning.imports.parser import parse_chat_markdown
from learning.repositories.db import get_db
from learning.repositories.sources import save_source_document, store_source_turns, compute_content_hash


def apply_review(owner_id, source_path, review_path):
    data = Path(source_path).read_bytes()
    review = json.loads(Path(review_path).read_text(encoding="utf-8"))
    if hashlib.sha256(data).hexdigest() != review["sha256"]:
        raise ValueError("Source changed; review its contents before applying this briefing")
    raw = data.decode("utf-8").replace("\r\n", "\n")
    turns, _, quality = parse_chat_markdown(raw)
    if not set(review["source_turn_indices"]).issubset({t.turn_index for t in turns}):
        raise ValueError("Invalid source references")
    db = get_db()
    document, created = save_source_document(owner_id, review["track"], review["filename"], compute_content_hash(raw), raw, len(turns), quality)
    if created:
        store_source_turns(document.id, turns, owner_id)
    with db:
        db.execute(
            "INSERT INTO source_briefings VALUES (?,?,?,?,?) ON CONFLICT(document_id) DO UPDATE SET summary=excluded.summary, source_turn_indices=excluded.source_turn_indices, updated_at=excluded.updated_at",
            (document.id, owner_id, review["summary"], json.dumps(review["source_turn_indices"]), datetime.now(timezone.utc).isoformat()),
        )
        # The legacy importer invented this success without reading learner code.
        # Correct only that exact synthetic claim; preserve an explanation in evidence.
        corrected = db.execute(
            "UPDATE observations SET demonstrated=0, assistance_level='guided', source_kind='derived_inference', evidence_text=? "
            "WHERE owner_id=? AND competency_key='two_sum_hash_map' AND evidence_text=?",
            (f"Correction from reviewed source {document.id}, turns 18–31: frequency pair counting required syntax help and tutor-supplied code. Prior import claim 'Authored dictionary lookup termination condition for two-sum in O(N)' was unsupported; independent success revoked.", owner_id, "Authored dictionary lookup termination condition for two-sum in O(N)."),
        ).rowcount
    return {"document_id": document.id, "turn_count": len(turns), "new_document": created, "unsupported_claims_corrected": corrected}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("owner_id")
    parser.add_argument("source_path")
    parser.add_argument("review_path")
    args = parser.parse_args()
    print(json.dumps(apply_review(args.owner_id, args.source_path, args.review_path)))
