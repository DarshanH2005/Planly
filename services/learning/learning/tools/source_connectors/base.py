"""
Sprint B27: Provider-Neutral Source Result Contracts & Base Connector
Authority: PLANLY_BUILD_SPEC.md §8, §10; B27_optional_sources_voice.md

Enforces:
- Source identity, citations, fetched time, and connector version.
- Citation verification before use (B27-AC1).
- Unavailable state without actual authorized access (B27-AC3).
"""

from abc import ABC, abstractmethod
from typing import List, Dict, Any, Optional
from pydantic import BaseModel, Field
from datetime import datetime, timezone


class SourceCitation(BaseModel):
    source_id: str
    snippet: str
    verified: bool = False
    url_or_path: Optional[str] = None
    page_or_section: Optional[str] = None


class SourceResultContract(BaseModel):
    connector_id: str
    connector_version: str = "1.0.0"
    source_uri: str
    title: str
    content: str
    citations: List[SourceCitation] = Field(default_factory=list)
    fetched_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    citations_verified: bool = False
    fallback_used: bool = False
    metadata: Dict[str, Any] = Field(default_factory=dict)


class ConnectorUnavailableError(Exception):
    """Raised when an optional connector is not configured or lacks authorized access."""
    pass


class CitationVerificationError(Exception):
    """Raised when citations are missing, empty, or fail integrity verification."""
    pass


class BaseSourceConnector(ABC):
    """
    Abstract base connector for external reference sources.
    All implementations must be provider-neutral and verify credentials/citations.
    """

    def __init__(self, connector_id: str, version: str = "1.0.0"):
        self.connector_id = connector_id
        self.version = version

    @abstractmethod
    def is_available(self) -> bool:
        """Returns True only if actual authorized access is established."""
        pass

    @abstractmethod
    def fetch_source(self, source_uri: str, **kwargs) -> SourceResultContract:
        """
        Fetches source material from connector.
        Must raise ConnectorUnavailableError if not authorized.
        """
        pass

    def verify_citations(self, result: SourceResultContract) -> bool:
        """
        Verifies that citations exist and reference snippets present within the content.
        B27-AC1: Missing or ungrounded citations fail verification.
        """
        if not result.citations:
            return False

        for cit in result.citations:
            if not cit.snippet or cit.snippet not in result.content:
                cit.verified = False
                return False
            cit.verified = True

        result.citations_verified = True
        return True
