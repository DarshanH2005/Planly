import os
from typing import Optional, Dict, Any, Set
from uuid import UUID
from pydantic import BaseModel

"""
Sprint B02: Identity Repository & Transaction-Local Scoping

Provides data access for owner allowlist and candidate profile in the canonical
planly schema.

CRITICAL INVARIANTS:
- MUST NOT use SELECT * in DB queries (explicit column projection only).
- Transaction-local owner scope (SET LOCAL planly.current_owner_id) prevents
  connection pool identity leakage across requests.
- Single canonical owner identifier linked to auth.users UUID.
"""

PROFILE_COLUMNS = "id, owner_id, name, timezone, language, graduation_date, cgpa, created_at, updated_at"


class OwnerProfile(BaseModel):
    id: str
    owner_id: str
    name: str
    timezone: str
    language: str
    graduation_date: str
    cgpa: Optional[float] = None


# In-memory test/fallback store
_dev_allowed_owners: Set[str] = {"dev-owner-001", "00000000-0000-0000-0000-000000000001"}
_dev_profiles: Dict[str, OwnerProfile] = {
    "dev-owner-001": OwnerProfile(
        id="profile-dev-001",
        owner_id="dev-owner-001",
        name="Candidate",
        timezone="Asia/Kolkata",
        language="python",
        graduation_date="2026-12-01",
        cgpa=None,
    ),
    "00000000-0000-0000-0000-000000000001": OwnerProfile(
        id="profile-00000000-0000-0000-0000-000000000001",
        owner_id="00000000-0000-0000-0000-000000000001",
        name="Darshan",
        timezone="Asia/Kolkata",
        language="python",
        graduation_date="2026-12-01",
        cgpa=8.5,
    ),
}


def is_owner_allowed(owner_id: str) -> bool:
    """
    Checks whether the owner_id exists in allowed_owners.
    """
    db_url = os.environ.get("DATABASE_URL") or os.environ.get("SUPABASE_DB_URL")
    if not db_url:
        return owner_id in _dev_allowed_owners

    try:
        import psycopg
        with psycopg.connect(db_url) as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT 1 FROM public.allowed_owners WHERE owner_id = %s LIMIT 1", (owner_id,))
                return cur.fetchone() is not None
    except Exception:
        # A configured production database must fail closed. Do not fall back
        # to the development allowlist after a connection/query failure.
        return False


def get_owner_profile(owner_id: str) -> Optional[OwnerProfile]:
    """
    Retrieves candidate profile from planly.profiles for the owner.
    """
    db_url = os.environ.get("DATABASE_URL") or os.environ.get("SUPABASE_DB_URL")
    if not db_url:
        return _dev_profiles.get(owner_id)

    try:
        import psycopg
        with psycopg.connect(db_url) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT id, owner_id, name, timezone, language, graduation_date, cgpa "
                    "FROM planly.profiles WHERE owner_id = %s LIMIT 1",
                    (owner_id,),
                )
                row = cur.fetchone()
                if not row:
                    return None
                return OwnerProfile(
                    id=str(row[0]), owner_id=str(row[1]), name=row[2],
                    timezone=row[3], language=row[4], graduation_date=str(row[5]), cgpa=row[6],
                )
    except Exception:
        return None


def bootstrap_allowed_owner(owner_id: str, profile: Optional[OwnerProfile] = None) -> None:
    """
    Registers an allowed owner in the in-memory store for integration test environments.
    """
    _dev_allowed_owners.add(owner_id)
    if profile:
        _dev_profiles[owner_id] = profile


def reset_identity_store() -> None:
    """
    Resets in-memory store for clean test isolation.
    """
    _dev_allowed_owners.clear()
    _dev_profiles.clear()
    _dev_allowed_owners.add("00000000-0000-0000-0000-000000000001")


def get_transaction_local_scope_sql(owner_id: str) -> str:
    """
    Returns SQL statement to set transaction-local identity.
    SET LOCAL planly.current_owner_id automatically reverts when the transaction ends,
    ensuring connection pool reuse never leaks identity across requests.
    """
    # Sanitize UUID to prevent SQL injection
    safe_uuid = str(UUID(owner_id))
    return f"SET LOCAL planly.current_owner_id = '{safe_uuid}';"
