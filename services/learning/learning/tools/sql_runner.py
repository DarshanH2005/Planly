"""
Isolated Disposable SQL Execution Tool.
Sprint: B17
Authority: planly_architecture.md sections 2, 8-9; B17_ml_sql_classrooms.md

Enforces:
- B17-AC2: SQL cannot access application tables or retain mutations between isolated exercises.
- B17-AC3: Invalid SQL, syntax errors, and timeouts preserve specific feedback and do not invent results.
- Bounded queries: Row limit (default 100 rows), statement timeouts, and isolated in-memory fixtures.
"""

import sqlite3
import time
import re
from typing import List, Dict, Any, Optional
from pydantic import BaseModel, Field


class SQLExecutionResult(BaseModel):
    status: str  # "success", "syntax_error", "runtime_error", "timeout", "permission_denied"
    columns: List[str] = Field(default_factory=list)
    rows: List[List[Any]] = Field(default_factory=list)
    row_count: int = 0
    execution_time_ms: float = 0.0
    error_message: Optional[str] = None
    truncated: bool = False
    affected_rows: int = 0


# Forbidden keywords / patterns that attempt to breach sandbox or inspect system
FORBIDDEN_SQL_PATTERNS = [
    r"\bATTACH\s+DATABASE\b",
    r"\bDETACH\s+DATABASE\b",
    r"\bLOAD_EXTENSION\b",
    r"\bPRAGMA\s+database_list\b",
    r"\bsqlite_master\s+.*\b(DROP|DELETE|UPDATE|INSERT)\b",
]

# Application table names that must never be accessible from SQL exercises
APPLICATION_TABLES = {
    "users",
    "accounts",
    "identities",
    "classrooms",
    "sessions",
    "artifacts",
    "attempts",
    "observations",
    "messages",
    "pending_tasks",
    "source_documents",
    "source_turns",
    "episodes",
    "turn_runs",
    "audit_logs",
    "plans",
    "repairs",
    "recall_items",
}


def check_forbidden_sql(query: str) -> Optional[str]:
    q_upper = query.upper()
    for pat in FORBIDDEN_SQL_PATTERNS:
        if re.search(pat, q_upper, re.IGNORECASE):
            return f"Operation disallowed by SQL sandbox security policy: {pat}"

    # Check for direct references to application tables
    tokens = set(re.findall(r"\b[a-zA-Z_][a-zA-Z0-9_]*\b", query.lower()))
    accessed_app_tables = tokens.intersection(APPLICATION_TABLES)
    if accessed_app_tables:
        return f"Access to application table(s) '{', '.join(sorted(accessed_app_tables))}' is forbidden in exercise sandbox (B17-AC2)."

    return None


class SQLRunner:
    def __init__(self, default_timeout_seconds: float = 2.0, max_rows: int = 100):
        self.default_timeout_seconds = default_timeout_seconds
        self.max_rows = max_rows

    def execute_query(
        self,
        query: str,
        fixture_ddl: str = "",
        fixture_data: Optional[Dict[str, List[Dict[str, Any]]]] = None,
        timeout_seconds: Optional[float] = None,
        max_rows: Optional[int] = None,
    ) -> SQLExecutionResult:
        """
        Executes a SQL query in an isolated, disposable in-memory SQLite database.
        Each execution starts with a completely fresh :memory: instance.
        Mutations are never preserved between calls.
        """
        timeout = timeout_seconds or self.default_timeout_seconds
        limit_rows = max_rows or self.max_rows

        # 1. Security Check (B17-AC2)
        forbidden_error = check_forbidden_sql(query)
        if forbidden_error:
            return SQLExecutionResult(
                status="permission_denied",
                error_message=forbidden_error,
            )

        start_time = time.perf_counter()

        # 2. Spin up dedicated, disposable in-memory database
        conn = sqlite3.connect(":memory:")
        cursor = conn.cursor()

        try:
            # Seed fixture DDL
            if fixture_ddl.strip():
                cursor.executescript(fixture_ddl)

            # Seed fixture data if provided
            if fixture_data:
                for table_name, records in fixture_data.items():
                    if not records:
                        continue
                    cols = list(records[0].keys())
                    placeholders = ", ".join(["?"] * len(cols))
                    col_names = ", ".join(cols)
                    insert_sql = f"INSERT INTO {table_name} ({col_names}) VALUES ({placeholders})"
                    rows_to_insert = [[r.get(c) for c in cols] for r in records]
                    cursor.executemany(insert_sql, rows_to_insert)
                conn.commit()

            # Set a query progress handler to enforce timeout (B17-AC3)
            # SQLite progress handler called every N virtual machine instructions
            start_tick = time.perf_counter()

            def progress_handler():
                if time.perf_counter() - start_tick > timeout:
                    return 1  # Non-zero interrupts the query with OperationalError: interrupted
                return 0

            conn.set_progress_handler(progress_handler, 1000)

            # 3. Execute candidate query
            # Split into individual statements if multiple
            statements = [s.strip() for s in query.split(";") if s.strip()]
            if not statements:
                return SQLExecutionResult(
                    status="syntax_error",
                    error_message="Query is empty.",
                )

            last_cursor = None
            affected = 0
            for stmt in statements:
                last_cursor = cursor.execute(stmt)
                if last_cursor.rowcount > 0:
                    affected += last_cursor.rowcount

            elapsed_ms = (time.perf_counter() - start_time) * 1000.0

            # 4. Fetch results if statement produced columns (e.g. SELECT)
            if last_cursor and last_cursor.description:
                columns = [col[0] for col in last_cursor.description]
                fetched_rows = last_cursor.fetchmany(limit_rows + 1)
                truncated = len(fetched_rows) > limit_rows
                output_rows = fetched_rows[:limit_rows]

                return SQLExecutionResult(
                    status="success",
                    columns=columns,
                    rows=[list(r) for r in output_rows],
                    row_count=len(output_rows),
                    execution_time_ms=round(elapsed_ms, 2),
                    truncated=truncated,
                    affected_rows=affected,
                )
            else:
                # Mutation statement without return (e.g. INSERT / UPDATE)
                conn.commit()
                return SQLExecutionResult(
                    status="success",
                    columns=[],
                    rows=[],
                    row_count=0,
                    execution_time_ms=round(elapsed_ms, 2),
                    affected_rows=affected,
                )

        except sqlite3.OperationalError as e:
            elapsed_ms = (time.perf_counter() - start_time) * 1000.0
            err_str = str(e)
            if "interrupted" in err_str.lower() or "timeout" in err_str.lower():
                return SQLExecutionResult(
                    status="timeout",
                    execution_time_ms=round(elapsed_ms, 2),
                    error_message=f"Query execution exceeded timeout limit of {timeout}s (B17-AC3).",
                )
            return SQLExecutionResult(
                status="runtime_error",
                execution_time_ms=round(elapsed_ms, 2),
                error_message=f"SQL OperationalError: {err_str}",
            )
        except sqlite3.DatabaseError as e:
            elapsed_ms = (time.perf_counter() - start_time) * 1000.0
            return SQLExecutionResult(
                status="syntax_error",
                execution_time_ms=round(elapsed_ms, 2),
                error_message=f"SQL Syntax/Database Error: {str(e)}",
            )
        except Exception as e:
            elapsed_ms = (time.perf_counter() - start_time) * 1000.0
            return SQLExecutionResult(
                status="runtime_error",
                execution_time_ms=round(elapsed_ms, 2),
                error_message=f"Execution failed: {str(e)}",
            )
        finally:
            # 5. Immediate Disposable Teardown (B17-AC2)
            try:
                cursor.close()
                conn.close()
            except Exception:
                pass


# Singleton runner instance
_default_sql_runner = SQLRunner()


def get_sql_runner() -> SQLRunner:
    return _default_sql_runner
