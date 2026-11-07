"""
Sprint B27: Source Connector Manager & Fallback Orchestrator
Authority: PLANLY_BUILD_SPEC.md §8, §10; B27_optional_sources_voice.md

Enforces:
- B27-AC1: Connector failure/missing citations falls back to local references without stopping DSA.
- B27-AC3: Without access the feature is unavailable, never reported integrated.
"""

from typing import Dict, Any, Optional
import logging

from learning.tools.source_connectors.base import (
    BaseSourceConnector,
    SourceResultContract,
    ConnectorUnavailableError,
    CitationVerificationError,
)
from learning.tools.source_connectors.local_fallback import LocalReferenceConnector
from learning.tools.source_connectors.notebooklm import NotebookLMConnector

logger = logging.getLogger(__name__)


class SourceConnectorManager:
    """
    Orchestrates source connectors with guaranteed local reference fallback.
    """

    def __init__(self):
        self._connectors: Dict[str, BaseSourceConnector] = {
            "local_reference": LocalReferenceConnector(),
            "notebooklm": NotebookLMConnector(),
        }

    def register_connector(self, name: str, connector: BaseSourceConnector):
        self._connectors[name] = connector

    def get_connector(self, name: str) -> Optional[BaseSourceConnector]:
        return self._connectors.get(name)

    def get_status_report(self) -> Dict[str, Dict[str, Any]]:
        """
        B27-AC3: Without access the feature is unavailable, never reported integrated.
        """
        report = {}
        for name, conn in self._connectors.items():
            avail = conn.is_available()
            report[name] = {
                "connector_id": conn.connector_id,
                "version": conn.version,
                "available": avail,
                "enabled": avail,
                "status": "available" if avail else "unavailable",
                "notes": (
                    "Verified local reference repository"
                    if name == "local_reference"
                    else "Requires authorized API credentials; community browser automation not trusted"
                ),
            }
        return report

    def fetch_with_fallback(
        self,
        source_uri: str,
        preferred_connector: str = "notebooklm",
        **kwargs,
    ) -> SourceResultContract:
        """
        B27-AC1: Connector failure or missing citations falls back to local references without stopping DSA.
        """
        connector = self._connectors.get(preferred_connector)

        if connector and connector.is_available():
            try:
                res = connector.fetch_source(source_uri, **kwargs)
                if connector.verify_citations(res):
                    return res
                else:
                    logger.warning(
                        "Connector '%s' citations failed verification; falling back to local reference (B27-AC1)",
                        preferred_connector,
                    )
            except (ConnectorUnavailableError, CitationVerificationError, Exception) as exc:
                logger.warning(
                    "Connector '%s' failed (%s); falling back to local reference (B27-AC1)",
                    preferred_connector,
                    exc,
                )

        # Fallback to local verified reference
        fallback_conn = self._connectors["local_reference"]
        fallback_res = fallback_conn.fetch_source(source_uri)
        fallback_res.fallback_used = True
        fallback_res.metadata["original_requested_connector"] = preferred_connector
        fallback_res.metadata["fallback_reason"] = (
            f"Preferred connector '{preferred_connector}' unavailable or invalid citations"
        )
        return fallback_res


_global_manager: Optional[SourceConnectorManager] = None


def get_source_manager() -> SourceConnectorManager:
    global _global_manager
    if _global_manager is None:
        _global_manager = SourceConnectorManager()
    return _global_manager
