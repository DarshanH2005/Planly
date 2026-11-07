"""
Sprint B27: Source Connectors Package
Authority: PLANLY_BUILD_SPEC.md §8, §10; B27_optional_sources_voice.md

Provides provider-neutral contracts for optional reference and study source connectors.
Enforces:
- B27-AC1: Connector failure or missing citations falls back to local references without stopping DSA.
- B27-AC3: Without actual authorized access, connectors are unavailable and never reported integrated.
"""

from learning.tools.source_connectors.base import (
    SourceCitation,
    SourceResultContract,
    BaseSourceConnector,
    ConnectorUnavailableError,
    CitationVerificationError,
)
from learning.tools.source_connectors.local_fallback import LocalReferenceConnector
from learning.tools.source_connectors.notebooklm import NotebookLMConnector
from learning.tools.source_connectors.manager import (
    SourceConnectorManager,
    get_source_manager,
)

__all__ = [
    "SourceCitation",
    "SourceResultContract",
    "BaseSourceConnector",
    "ConnectorUnavailableError",
    "CitationVerificationError",
    "LocalReferenceConnector",
    "NotebookLMConnector",
    "SourceConnectorManager",
    "get_source_manager",
]
