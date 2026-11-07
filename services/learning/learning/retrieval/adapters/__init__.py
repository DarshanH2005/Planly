"""
Sprint B24: Retrieval Adapters Registry
"""

from typing import Dict, Type
from learning.retrieval.adapters.base import BaseRetrievalAdapter
from learning.retrieval.adapters.baseline_adapter import BaselineHybridAdapter
from learning.retrieval.adapters.gemini_adapter import GeminiEmbeddingAdapter
from learning.retrieval.adapters.graph_adapter import GraphExpandedAdapter


ADAPTER_REGISTRY: Dict[str, Type[BaseRetrievalAdapter]] = {
    "baseline_hybrid": BaselineHybridAdapter,
    "gemini_embedding_2": GeminiEmbeddingAdapter,
    "gemini_embedding_2_rerank": lambda cfg, idx: GeminiEmbeddingAdapter(
        "gemini_embedding_2_rerank", cfg, idx, has_reranker=True
    ),
    "graph_expanded_hybrid": GraphExpandedAdapter,
}


def get_retrieval_adapter(name: str, config=None, indexer=None) -> BaseRetrievalAdapter:
    if name not in ADAPTER_REGISTRY:
        raise ValueError(f"Unknown retrieval adapter '{name}'. Available: {list(ADAPTER_REGISTRY.keys())}")
    factory = ADAPTER_REGISTRY[name]
    return factory(config=config, indexer=indexer)
