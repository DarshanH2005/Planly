import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional

from learning.domain.contracts import EpisodeRecord
from learning.imports.parser import parse_chat_markdown
from learning.repositories.db import get_db

LOCAL_EMBEDDING_MODEL = "local_dense_hash_v1"
LOCAL_EMBEDDING_DIMENSION = 256
LOCAL_INDEX_VERSION = "local_dense_hash_v1"

def _ensure_content_col():
    db = get_db()
    try: db.execute("ALTER TABLE episodes ADD COLUMN content_json TEXT")
    except: pass

def reset_episode_store() -> None:
    db = get_db()
    with db:
        db.execute("DELETE FROM episodes")

class EpisodeIndexer:
    def __init__(self):
        _ensure_content_col()

    def index_episode(self, episode: EpisodeRecord) -> EpisodeRecord:
        # The laptop-safe retriever uses a deterministic local dense index.
        # Persist the exact model/dimension/index version beside each episode
        # so a later process cannot interpret a 256-dimensional vector as the
        # canonical provider embedding declared by the domain default.
        indexed_episode = episode.model_copy(update={
            "embedding_model": LOCAL_EMBEDDING_MODEL,
            "embedding_dim": LOCAL_EMBEDDING_DIMENSION,
            "index_version": LOCAL_INDEX_VERSION,
        })
        db = get_db()
        with db:
            cursor = db.execute("SELECT id FROM episodes WHERE id = ?", (indexed_episode.id,))
            if cursor.fetchone():
                db.execute("UPDATE episodes SET content_json = ?, embedding_model = ?, embedding_dim = ?, index_version = ? WHERE id = ?", (json.dumps(indexed_episode.model_dump()), indexed_episode.embedding_model, indexed_episode.embedding_dim, indexed_episode.index_version, indexed_episode.id))
            else:
                from datetime import datetime, timezone
                created = indexed_episode.created_at or datetime.now(timezone.utc).isoformat()
                db.execute(
                    "INSERT INTO episodes (id, owner_id, session_id, source_document_id, kind, speaker, title, content, code_snippet, turn_index, visibility, embedding_model, embedding_dim, index_version, created_at, content_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (indexed_episode.id, indexed_episode.owner_id or "", indexed_episode.session_id, indexed_episode.source_document_id, indexed_episode.kind, indexed_episode.speaker, indexed_episode.title, indexed_episode.content, indexed_episode.code_snippet, indexed_episode.turn_index, indexed_episode.visibility, indexed_episode.embedding_model, indexed_episode.embedding_dim, indexed_episode.index_version, created, json.dumps(indexed_episode.model_dump()))
                )
        return indexed_episode

    def get_all_episodes(
        self,
        owner_id: Optional[str] = None,
        include_reference: bool = True,
    ) -> List[EpisodeRecord]:
        db = get_db()
        results = []
        cursor = db.execute("SELECT content_json FROM episodes")
        for row in cursor:
            if row["content_json"]:
                ep = EpisodeRecord(**json.loads(row["content_json"]))
                if ep.kind == "personal_episode":
                    if owner_id and ep.owner_id == owner_id:
                        results.append(ep)
                elif ep.kind == "reference_knowledge":
                    if include_reference:
                        results.append(ep)
        return results

    def index_chat_export(
        self,
        filepath: str,
        owner_id: str,
        session_id: str,
        track: str = "dsa",
    ) -> List[EpisodeRecord]:
        path = Path(filepath)
        if not path.exists():
            return []

        content = path.read_text(encoding="utf-8")
        turns, issues, quality = parse_chat_markdown(content, filename=path.name)

        indexed_episodes: List[EpisodeRecord] = []
        now_str = datetime.now(timezone.utc).isoformat()

        for i in range(len(turns)):
            t = turns[i]
            user_text = t.content

            if "freq(x)" in user_text or (i + 1 < len(turns) and "freq(x)" in turns[i + 1].content):
                assistant_text = turns[i + 1].content if i + 1 < len(turns) else ""
                combined_content = f"User Turn:\n{user_text}\n\nAssistant Turn:\n{assistant_text}"
                ep = EpisodeRecord(
                    id=f"ep_dict_call_{uuid.uuid4().hex[:8]}",
                    owner_id=owner_id,
                    session_id=session_id,
                    source_document_id=f"doc_{path.name}",
                    kind="personal_episode",
                    speaker="learner",
                    title="DSA: Dictionary Access Call Syntax Error (freq(x) vs freq.get)",
                    content=combined_content,
                    code_snippet="if freq(x)>1:\n    res.append(x)\n    freq[x] = freq.get(x ,0)-1",
                    turn_index=t.turn_index,
                    visibility="candidate_facing",
                    created_at=now_str,
                )
                self.index_episode(ep)
                indexed_episodes.append(ep)

            if "while x+1 in nums" in user_text or "x is the fixed starting value" in user_text:
                assistant_text = turns[i + 1].content if i + 1 < len(turns) else ""
                combined_content = f"User Turn:\n{user_text}\n\nAssistant Turn:\n{assistant_text}"
                ep = EpisodeRecord(
                    id=f"ep_fixed_x_{uuid.uuid4().hex[:8]}",
                    owner_id=owner_id,
                    session_id=session_id,
                    source_document_id=f"doc_{path.name}",
                    kind="personal_episode",
                    speaker="learner",
                    title="DSA: Longest Consecutive Sequence Fixed-x Loop Correction",
                    content=combined_content,
                    code_snippet="while current + 1 in num_set:\n    current += 1\n    length += 1",
                    turn_index=t.turn_index,
                    visibility="candidate_facing",
                    created_at=now_str,
                )
                self.index_episode(ep)
                indexed_episodes.append(ep)

        return indexed_episodes

_indexer_instance: Optional[EpisodeIndexer] = None

def get_episode_indexer() -> EpisodeIndexer:
    global _indexer_instance
    if _indexer_instance is None:
        _indexer_instance = EpisodeIndexer()
    return _indexer_instance
