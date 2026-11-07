"""
Sprint B24: Baseline Hybrid Retrieval Adapter
Authority: PLANLY_BUILD_SPEC.md §3, §6, §11, §14; B24_retrieval_comparisons.md
"""

import time
from typing import List, Dict, Any, Optional
from learning.domain.contracts import RetrievalCandidate
from learning.retrieval.hybrid import HybridRetriever, RetrievalFilter
from learning.retrieval.indexer import EpisodeIndexer, get_episode_indexer
from learning.retrieval.adapters.base import BaseRetrievalAdapter


class BaselineHybridAdapter(BaseRetrievalAdapter):
    """
    Production baseline: Lexical BM25 + dense RRF hybrid retriever.
    Enforces cutoff_timestamp boundary (B24-AC1).
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
            "graph_expansion": False,
            "cost_per_1k_queries_usd": 0.005,
        }
        super().__init__("baseline_hybrid", cfg)
        self.retriever = HybridRetriever(indexer=indexer)

    def search(
        self,
        query: str,
        filter_criteria: RetrievalFilter,
        limit: int = 5,
    ) -> List[RetrievalCandidate]:
        start = time.perf_counter()
        results = self.retriever.search(query=query, filter_criteria=filter_criteria, limit=limit)
        elapsed_ms = (time.perf_counter() - start) * 1000.0
        self.latency_samples.append(elapsed_ms)

        # Track cost
        query_cost = self.config.get("cost_per_1k_queries_usd", 0.005) / 1000.0
        self.total_cost_usd += query_cost

        return results
