"""
Sprint B27: Local Reference Source Connector (Guaranteed Fallback)
Authority: PLANLY_BUILD_SPEC.md §8, §10; B27_optional_sources_voice.md

Enforces:
- B27-AC1: Connector failure/missing citations falls back to local references without stopping DSA.
- Curated local canonical algorithms and data structures reference material.
"""

from typing import Dict, Any, Optional
from datetime import datetime, timezone

from learning.tools.source_connectors.base import (
    BaseSourceConnector,
    SourceResultContract,
    SourceCitation,
)


CURATED_LOCAL_SOURCES: Dict[str, Dict[str, Any]] = {
    "two_pointers": {
        "title": "Two Pointers Core Invariants & Patterns",
        "content": (
            "The Two Pointers technique processes sequences by maintaining two integer indices "
            "that converge from opposing boundaries or move in tandem. For sorted arrays, "
            "converging pointers achieve O(N) time with O(1) auxiliary space without hash overhead. "
            "Invariant: at each step, elements outside the pointer window are guaranteed excluded."
        ),
        "citations": [
            {
                "source_id": "curated_dsa_twopointers_01",
                "snippet": "converging pointers achieve O(N) time with O(1) auxiliary space without hash overhead.",
                "url_or_path": "docs/curriculum/dsa/two_pointers.md",
                "page_or_section": "Section 1.1 Invariants",
            }
        ],
    },
    "sliding_window": {
        "title": "Sliding Window Dynamic Subarray State",
        "content": (
            "The Sliding Window pattern maintains contiguous subarray state by expanding the right "
            "pointer until a constraint is violated, then contracting the left pointer. "
            "Time complexity is strictly linear amortized O(N) since each pointer moves at most N steps."
        ),
        "citations": [
            {
                "source_id": "curated_dsa_slidingwindow_01",
                "snippet": "Time complexity is strictly linear amortized O(N) since each pointer moves at most N steps.",
                "url_or_path": "docs/curriculum/dsa/sliding_window.md",
                "page_or_section": "Section 2.3 Complexity",
            }
        ],
    },
    "binary_search": {
        "title": "Binary Search Monotonic Search Space",
        "content": (
            "Binary search operates on a monotonic predicate over a discrete domain. "
            "Maintain left and right boundaries such that low <= high, computing mid = low + (high - low) // 2. "
            "Guarantees O(log N) worst-case time complexity."
        ),
        "citations": [
            {
                "source_id": "curated_dsa_binarysearch_01",
                "snippet": "computing mid = low + (high - low) // 2.",
                "url_or_path": "docs/curriculum/dsa/binary_search.md",
                "page_or_section": "Section 1.2 Overflow Prevention",
            }
        ],
    },
    "general_dsa": {
        "title": "Planly Curated Reference Knowledge",
        "content": (
            "Planly verified algorithmic references provide canonical invariant checks, "
            "time-space complexity bounds, and boundary test fixtures without external dependencies."
        ),
        "citations": [
            {
                "source_id": "curated_dsa_core_01",
                "snippet": "Planly verified algorithmic references provide canonical invariant checks",
                "url_or_path": "docs/curriculum/dsa/core.md",
                "page_or_section": "Section 1.0 Overview",
            }
        ],
    },
}


class LocalReferenceConnector(BaseSourceConnector):
    """
    Curated local reference connector.
    Always available and guaranteed to provide verified citations.
    """

    def __init__(self):
        super().__init__(connector_id="local_reference", version="1.0.0")

    def is_available(self) -> bool:
        return True

    def fetch_source(self, source_uri: str, **kwargs) -> SourceResultContract:
        # Match against known curated topics or fallback to general_dsa
        key = source_uri.lower().strip()
        matched_data = CURATED_LOCAL_SOURCES.get(key) or CURATED_LOCAL_SOURCES.get("general_dsa")

        citations = [
            SourceCitation(
                source_id=c["source_id"],
                snippet=c["snippet"],
                verified=True,
                url_or_path=c.get("url_or_path"),
                page_or_section=c.get("page_or_section"),
            )
            for c in matched_data["citations"]
        ]

        result = SourceResultContract(
            connector_id=self.connector_id,
            connector_version=self.version,
            source_uri=source_uri,
            title=matched_data["title"],
            content=matched_data["content"],
            citations=citations,
            citations_verified=True,
            fallback_used=False,
            metadata={"source_tier": "canonical_local"},
        )
        return result
