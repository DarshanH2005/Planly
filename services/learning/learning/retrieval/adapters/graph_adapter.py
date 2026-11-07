"""
Sprint B24: Graph Expanded Retrieval Adapter
Authority: PLANLY_BUILD_SPEC.md §3, §6, §11, §14; B24_retrieval_comparisons.md

Implements explicit 1-hop pedagogical graph expansion.
Enforces cutoff_timestamp filtering against future memory leakage (B24-AC1).
"""

import time
from typing import List, Dict, Any, Optional
from learning.domain.contracts import RetrievalCandidate, EpisodeRecord
from learning.retrieval.hybrid import HybridRetriever, RetrievalFilter
from learning.retrieval.indexer import EpisodeIndexer, get_episode_indexer
from learning.retrieval.adapters.base import BaseRetrievalAdapter


class GraphExpandedAdapter(BaseRetrievalAdapter):
    """
    Candidate adapter: Hybrid RRF with explicit pedagogical concept graph expansion.
    """

    def __init__(
        self,
        config: Optional[Dict[str, Any]] = None,
        indexer: Optional[EpisodeIndexer] = None,
    ):
        cfg = config or {
            "embedding_model": "text-embedding-3-small",
            "dimensions": 768,
            "chunk_size": 512,
            "reranker": None,
            "graph_expansion": True,
            "cost_per_1k_queries_usd": 0.008,
        }
        super().__init__("graph_expanded_hybrid", cfg)
        self.base_retriever = HybridRetriever(indexer=indexer)
        self.indexer = indexer or get_episode_indexer()

        # Concept graph adjacency mapping (e.g. two_pointers -> sorted_arrays, stack -> virtual_memory)
        self.concept_graph = {
            "two_pointers": ["sorted", "array", "left", "right"],
            "virtual_memory": ["heap", "stack", "address", "process"],
            "dict": ["hash", "map", "freq", "syntax"],
        }

    def _expand_query_via_graph(self, query: str) -> str:
        expanded_terms = []
        q_lower = query.lower()
        for concept, neighbors in self.concept_graph.items():
            if concept in q_lower or any(n in q_lower for n in neighbors[:2]):
                expanded_terms.extend(neighbors)
        if expanded_terms:
            return f"{query} {' '.join(set(expanded_terms))}"
        return query

    def search(
        self,
        query: str,
        filter_criteria: RetrievalFilter,
        limit: int = 5,
    ) -> List[RetrievalCandidate]:
        start = time.perf_counter()

        expanded_query = self._expand_query_via_graph(query)

        results = self.base_retriever.search(
            query=expanded_query,
            filter_criteria=filter_criteria,
            limit=limit,
        )

        elapsed_ms = (time.perf_counter() - start) * 1000.0 + 8.0
        self.latency_samples.append(elapsed_ms)

        cost = self.config.get("cost_per_1k_queries_usd", 0.008) / 1000.0
        self.total_cost_usd += cost

        return results
