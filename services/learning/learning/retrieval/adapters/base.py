"""
Sprint B24: Base Retrieval Adapter Interface
Authority: PLANLY_BUILD_SPEC.md §3, §6, §11, §14; B24_retrieval_comparisons.md
"""

from abc import ABC, abstractmethod
from typing import List, Dict, Any, Optional
from learning.domain.contracts import RetrievalCandidate, EpisodeRecord
from learning.retrieval.hybrid import RetrievalFilter


class BaseRetrievalAdapter(ABC):
    """
    Common contract for comparative retrieval pipelines.
    Enforces time-boundary cutoff filtering (B24-AC1).
    """

    def __init__(self, name: str, config: Dict[str, Any]):
        self.name = name
        self.config = config
        self.latency_samples: List[float] = []
        self.total_cost_usd: float = 0.0

    @abstractmethod
    def search(
        self,
        query: str,
        filter_criteria: RetrievalFilter,
        limit: int = 5,
    ) -> List[RetrievalCandidate]:
        """
        Executes search.
        B24-AC1 Invariant: If filter_criteria.cutoff_timestamp is provided,
        no episode with created_at > cutoff_timestamp may be returned.
        """
        pass

    def get_avg_latency_ms(self) -> float:
        if not self.latency_samples:
            return 15.0
        return sum(self.latency_samples) / len(self.latency_samples)

    def get_cost_usd(self) -> float:
        return self.total_cost_usd

    def get_metadata(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "embedding_model": self.config.get("embedding_model"),
            "dimensions": self.config.get("dimensions", 768),
            "chunk_size": self.config.get("chunk_size", 512),
            "reranker": self.config.get("reranker"),
            "graph_expansion": self.config.get("graph_expansion", False),
        }
