"""
Domain types, token usage, receipts, and typed exceptions for Model Gateway.
Sprint: B06
"""

from enum import Enum
from typing import Dict, Any, Optional
from pydantic import BaseModel, Field


class ModelGatewayError(Exception):
    """Base exception for all model gateway errors."""
    pass


class ProviderCredentialMissingError(ModelGatewayError):
    """Raised when API credentials are absent. Checked by B06-AC1."""
    pass


class ProviderQuotaExceededError(ModelGatewayError):
    """Raised on HTTP 429 or provider quota exhaustion. Checked by B06-AC2."""
    pass


class ProviderTimeoutError(ModelGatewayError):
    """Raised when provider call times out. Checked by B06-AC2."""
    pass


class SchemaValidationError(ModelGatewayError):
    """Raised when structured response cannot be validated or repaired. Checked by B06-AC2."""
    def __init__(self, message: str, raw_content: str = "", validation_errors: Optional[list] = None):
        super().__init__(message)
        self.raw_content = raw_content
        self.validation_errors = validation_errors or []


class MissingContinuationMetadataError(ModelGatewayError):
    """Raised when continuation metadata is required but missing. Checked by B06-AC2."""
    pass


class BudgetExceededError(ModelGatewayError):
    """Raised when call spend exceeds remaining pool or monthly limit. Checked by B06-AC4."""
    pass


class UncertainCallError(ModelGatewayError):
    """Raised when call outcome is uncertain and reservation is retained. Checked by B06-AC4."""
    pass


class ReservationStatus(str, Enum):
    RESERVED = "reserved"
    SETTLED = "settled"
    UNCERTAIN = "uncertain"
    RELEASED = "released"


class TokenUsage(BaseModel):
    prompt_tokens: int = 0
    completion_tokens: int = 0
    thinking_tokens: int = 0
    total_tokens: int = 0
    cost_cents: int = 0


class ProviderResponse(BaseModel):
    content: str
    structured_data: Optional[Dict[str, Any]] = None
    model_name: str
    usage: TokenUsage
    continuation_metadata: Dict[str, Any] = Field(default_factory=dict)
    latency_ms: int = 0
    provider_receipt: str = ""


class ReservationReceipt(BaseModel):
    reservation_id: str
    pool: str
    model_name: str
    estimated_cost_cents: int
    status: ReservationStatus = ReservationStatus.RESERVED
    reason: Optional[str] = None
    created_at: Optional[str] = None


class SettledReceipt(BaseModel):
    reservation_id: str
    pool: str
    actual_cost_cents: int
    status: ReservationStatus = ReservationStatus.SETTLED
    tokens_billed: int
    settled_at: Optional[str] = None


class BudgetStatusReport(BaseModel):
    monthly_ceiling_usd: float
    internal_dispatch_limit_usd: float
    total_settled_usd: float
    total_reserved_usd: float
    total_uncertain_usd: float
    remaining_dispatch_usd: float
    pools: Dict[str, Dict[str, Any]]
