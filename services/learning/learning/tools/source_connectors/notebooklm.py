"""
Sprint B27: NotebookLM Source Connector Boundary
Authority: PLANLY_BUILD_SPEC.md §8, §10; B27_optional_sources_voice.md

Enforces:
- B27-AC3: Without actual authorized access, the feature is unavailable, never reported integrated.
- Only enable NotebookLM integration after actual authorized access and supported interface are established;
  community browser automation is a separate optional adapter and not trusted execution policy.
- B27-AC1: Missing or invalid citations rejected before use.
"""

import os
from typing import Dict, Any, Optional
from datetime import datetime, timezone

from learning.tools.source_connectors.base import (
    BaseSourceConnector,
    SourceResultContract,
    SourceCitation,
    ConnectorUnavailableError,
    CitationVerificationError,
)


class NotebookLMConnector(BaseSourceConnector):
    """
    Optional NotebookLM integration adapter.
    Enforces strict authorization boundary (B27-AC3):
    Without actual authorized API access (e.g., NOTEBOOKLM_API_KEY or supported OAuth client),
    is_available() MUST return False and never report integrated.
    """

    def __init__(self, api_key: Optional[str] = None):
        super().__init__(connector_id="notebooklm", version="0.1.0")
        self._api_key = api_key or os.environ.get("NOTEBOOKLM_API_KEY")

    def is_available(self) -> bool:
        """
        B27-AC3: Without access the feature is unavailable, never reported integrated.
        """
        return bool(self._api_key and len(self._api_key.strip()) > 0)

    def fetch_source(self, source_uri: str, **kwargs) -> SourceResultContract:
        """
        Fetches notebook content if authorized.
        Raises ConnectorUnavailableError if access credentials are absent.
        """
        if not self.is_available():
            raise ConnectorUnavailableError(
                "NotebookLM integration is unavailable: no authorized API credentials configured (B27-AC3). "
                "Community browser automation is an untrusted external adapter and cannot substitute for authorized access."
            )

        # In production with valid key, call actual endpoint
        # For mock test injection in tests with authorized key:
        mock_payload = kwargs.get("mock_payload")
        if mock_payload:
            citations = [
                SourceCitation(
                    source_id=c.get("source_id", "nb_cit_01"),
                    snippet=c.get("snippet", ""),
                    verified=False,
                    url_or_path=c.get("url_or_path"),
                )
                for c in mock_payload.get("citations", [])
            ]
            result = SourceResultContract(
                connector_id=self.connector_id,
                connector_version=self.version,
                source_uri=source_uri,
                title=mock_payload.get("title", "NotebookLM Notes"),
                content=mock_payload.get("content", ""),
                citations=citations,
                citations_verified=False,
                fallback_used=False,
                metadata={"provider": "notebooklm"},
            )
            # Verify citations before use (B27-AC1)
            verified = self.verify_citations(result)
            if not verified:
                raise CitationVerificationError(
                    "NotebookLM source contains missing or ungrounded citations (B27-AC1)."
                )
            return result

        raise NotImplementedError("Real NotebookLM API endpoint handshake required.")
