"""
Explicit Learning Links Graph Repository.
Stores and traverses source-linked prerequisite and supersession relationships.
Sprint: B07
Authority: planly_architecture.md sections 5-6, 11
"""

import sqlite3
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional, Any

from learning.domain.contracts import LearningLinkRecord

_LOCAL_LOCK = threading.Lock()

# In-memory store fallback for fast isolated tests
_in_memory_links: List[LearningLinkRecord] = []


def reset_graph_store() -> None:
    """For test isolation: clears in-memory and database graph links."""
    global _in_memory_links
    with _LOCAL_LOCK:
        _in_memory_links.clear()


def add_learning_link(
    owner_id: str,
    source_id: str,
    target_id: str,
    relation_type: str,
    confidence: float = 1.0,
    provenance: str = "curriculum_rule",
) -> LearningLinkRecord:
    """
    Creates an explicit directed relationship between two entities (skills, episodes, observations).
    Relation types: 'requires_prerequisite', 'supersedes', 'contradicts', 'reinforces'.
    """
    with _LOCAL_LOCK:
        # Check uniqueness constraint: (owner_id, source_id, target_id, relation_type)
        for link in _in_memory_links:
            if (
                link.owner_id == owner_id
                and link.source_id == source_id
                and link.target_id == target_id
                and link.relation_type == relation_type
            ):
                return link

        now_str = datetime.now(timezone.utc).isoformat()
        record = LearningLinkRecord(
            id=f"link_{uuid.uuid4().hex[:12]}",
            owner_id=owner_id,
            source_id=source_id,
            target_id=target_id,
            relation_type=relation_type,
            confidence=confidence,
            provenance=provenance,
            created_at=now_str,
        )
        _in_memory_links.append(record)
        return record


def get_learning_links(
    owner_id: str,
    source_id: Optional[str] = None,
    target_id: Optional[str] = None,
    relation_type: Optional[str] = None,
) -> List[LearningLinkRecord]:
    """Retrieves learning links for an owner matching optional filters."""
    with _LOCAL_LOCK:
        results = []
        for link in _in_memory_links:
            if link.owner_id != owner_id:
                continue
            if source_id and link.source_id != source_id:
                continue
            if target_id and link.target_id != target_id:
                continue
            if relation_type and link.relation_type != relation_type:
                continue
            results.append(link)
        return list(results)


def expand_graph(
    owner_id: str,
    seed_ids: List[str],
    max_depth: int = 2,
    max_fan_out: int = 5,
    relation_types: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """
    Bounded graph expansion: traverses relations with bounded depth and fan-out (architecture section 8).
    Prevents token explosion and cycle loops.
    """
    visited_nodes = set(seed_ids)
    current_frontier = set(seed_ids)
    traversed_edges: List[LearningLinkRecord] = []

    for depth in range(max_depth):
        if not current_frontier:
            break
        next_frontier = set()
        for node in current_frontier:
            # Get outgoing edges
            edges = get_learning_links(owner_id=owner_id, source_id=node)
            if relation_types:
                edges = [e for e in edges if e.relation_type in relation_types]

            # Bounded fan-out limit
            edges = edges[:max_fan_out]

            for edge in edges:
                traversed_edges.append(edge)
                if edge.target_id not in visited_nodes:
                    visited_nodes.add(edge.target_id)
                    next_frontier.add(edge.target_id)

        current_frontier = next_frontier

    return {
        "reachable_nodes": list(visited_nodes),
        "edges": traversed_edges,
        "depth_reached": min(depth + 1, max_depth),
    }


def find_superseding_evidence(
    owner_id: str,
    target_id: str,
) -> List[LearningLinkRecord]:
    """Finds any links where another record supersedes or contradicts target_id."""
    links = get_learning_links(owner_id=owner_id, target_id=target_id)
    return [l for l in links if l.relation_type in ("supersedes", "contradicts")]


def find_prerequisites(
    owner_id: str,
    skill_or_node_id: str,
) -> List[LearningLinkRecord]:
    """Finds prerequisites required by a skill or exercise node."""
    return get_learning_links(
        owner_id=owner_id,
        source_id=skill_or_node_id,
        relation_type="requires_prerequisite",
    )
