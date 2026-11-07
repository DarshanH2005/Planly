"""
Sprint B10: Verified Python execution and artifact-bound feedback.
Authority: Architecture sections 9, 12; OPERATING_PROFILE.md.

Enforces:
- B10-AC1: A real correct/incorrect pair produces the expected saved outcomes.
- B10-AC2: Infinite loop, forged pass JSON and output flooding remain bounded and cannot forge results.
- B10-AC3: Edit code while evaluation runs: older result does not mark new revision passed.
- Failure to prevent: Passing finite tests is not a correctness proof or independent mastery by itself.
- OPERATING_PROFILE: Metered E2B sandbox with explicit allow_internet_access=False; prompt closure;
  graceful fallback to local isolated execution; sensitive credentials stripped.
"""

import os
import sys
import json
import time
import uuid
import hashlib
import tempfile
import subprocess
from typing import Optional, List, Dict, Any, Tuple
from dataclasses import dataclass, field

from learning.domain.contracts import (
    ExecutionRecord,
    ExecutionStatus,
    TestResult,
    TestCaseDefinition,
)

# Stripped sensitive environment variables
SENSITIVE_ENV_VARS = {
    "DATABASE_URL",
    "SUPABASE_URL",
    "SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "JWT_SECRET",
    "GEMINI_API_KEY",
    "OPENAI_API_KEY",
    "E2B_API_KEY",
    "PLANLY_SECRET_KEY",
}

DEFAULT_TIMEOUT_SECONDS = 3.0
MAX_STDOUT_BYTES = 10 * 1024  # 10 KB stdout truncation limit


@dataclass
class PythonRunnerConfig:
    timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS
    max_stdout_bytes: int = MAX_STDOUT_BYTES
    allow_network: bool = False
    prefer_e2b: bool = False
    sandbox_enabled: bool = True
    e2b_api_key: Optional[str] = None
    remaining_sandbox_credits: float = 100.0  # Metered allowance
    allow_local_fallback: bool = True


class PythonRunner:
    def __init__(self, config: Optional[PythonRunnerConfig] = None):
        self.config = config or PythonRunnerConfig(
            prefer_e2b=bool(os.getenv("E2B_API_KEY")),
            e2b_api_key=os.getenv("E2B_API_KEY"),
            # Production never silently executes learner code on the API host.
            sandbox_enabled=(os.getenv("APP_ENV", "").lower() not in {"production", "pilot"} or bool(os.getenv("E2B_API_KEY"))),
            allow_local_fallback=os.getenv("APP_ENV", "").lower() not in {"production", "pilot"},
        )

    def run_code_against_tests(
        self,
        code: str,
        test_cases: List[Dict[str, Any]],
        entrypoint: str = "two_sum",
        artifact_id: Optional[str] = None,
        artifact_revision: int = 1,
        session_id: str = "sess_default",
        owner_id: str = "00000000-0000-0000-0000-000000000001",
    ) -> ExecutionRecord:
        """
        Executes learner code against test cases with bounded resources and strict isolation.
        Grading metadata is kept completely separate from learner stdout.
        """
        import logging
        for tc in test_cases:
            if "args" in tc and "input_args" not in tc:
                logging.getLogger("planly.execution").warning("Deprecated 'args' key in test case, use 'input_args'")
                tc["input_args"] = tc.pop("args")
            if "expected" in tc and "expected_output" not in tc:
                logging.getLogger("planly.execution").warning("Deprecated 'expected' key in test case, use 'expected_output'")
                tc["expected_output"] = tc.pop("expected")

        exec_id = f"exec_{uuid.uuid4().hex[:12]}"
        created_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

        # Compute deterministic hashes for artifact and test suite
        artifact_hash = hashlib.sha256(code.encode("utf-8")).hexdigest()
        test_suite_repr = json.dumps(test_cases, sort_keys=True)
        test_suite_hash = hashlib.sha256(test_suite_repr.encode("utf-8")).hexdigest()

        # Check sandbox availability
        if not self.config.sandbox_enabled:
            return ExecutionRecord(
                id=exec_id,
                session_id=session_id,
                owner_id=owner_id,
                artifact_id=artifact_id,
                artifact_revision=artifact_revision,
                artifact_hash=artifact_hash,
                test_suite_hash=test_suite_hash,
                status=ExecutionStatus.STATIC_REVIEW_ONLY,
                passed=False,
                tests_total=len(test_cases),
                tests_passed=0,
                results=[],
                stdout="Code execution sandbox is currently unavailable. Static review only.",
                stderr="",
                stdout_truncated=False,
                duration_ms=0.0,
                sandbox_provider="unavailable",
                is_stale=False,
                created_at=created_at,
            )

        # Check E2B availability vs local isolated execution
        if self.config.prefer_e2b and self.config.e2b_api_key:
            try:
                return self._run_e2b(
                    exec_id=exec_id,
                    code=code,
                    test_cases=test_cases,
                    entrypoint=entrypoint,
                    artifact_id=artifact_id,
                    artifact_revision=artifact_revision,
                    artifact_hash=artifact_hash,
                    test_suite_hash=test_suite_hash,
                    session_id=session_id,
                    owner_id=owner_id,
                    created_at=created_at,
                )
            except Exception as e:
                # A production E2B failure is an explicit unavailable result;
                # local subprocesses are development-only.
                logging.getLogger('planly.execution').warning(
                    f'E2B sandbox unavailable ({type(e).__name__}: {e})'
                )
                if not self.config.allow_local_fallback:
                    return self._unavailable_record(
                        exec_id, artifact_id, artifact_revision, artifact_hash,
                        test_suite_hash, session_id, owner_id, created_at,
                        len(test_cases), f"Cloud sandbox unavailable: {e}",
                    )

        if not self.config.allow_local_fallback and not self.config.prefer_e2b:
            return self._unavailable_record(
                exec_id, artifact_id, artifact_revision, artifact_hash,
                test_suite_hash, session_id, owner_id, created_at,
                len(test_cases), "Cloud sandbox is not configured.",
            )

        # Run via local isolated subprocess runner
        return self._run_local_isolated(
            exec_id=exec_id,
            code=code,
            test_cases=test_cases,
            entrypoint=entrypoint,
            artifact_id=artifact_id,
            artifact_revision=artifact_revision,
            artifact_hash=artifact_hash,
            test_suite_hash=test_suite_hash,
            session_id=session_id,
            owner_id=owner_id,
            created_at=created_at,
        )

    def _unavailable_record(
        self, exec_id: str, artifact_id: Optional[str], artifact_revision: int,
        artifact_hash: str, test_suite_hash: str, session_id: str, owner_id: str,
        created_at: str, test_count: int, detail: str,
    ) -> ExecutionRecord:
        return ExecutionRecord(
            id=exec_id, session_id=session_id, owner_id=owner_id,
            artifact_id=artifact_id, artifact_revision=artifact_revision,
            artifact_hash=artifact_hash, test_suite_hash=test_suite_hash,
            status=ExecutionStatus.STATIC_REVIEW_ONLY, passed=False,
            tests_total=test_count, tests_passed=0, results=[], stdout=detail,
            stderr="", stdout_truncated=False, duration_ms=0.0,
            sandbox_provider="unavailable", is_stale=False, created_at=created_at,
        )

    def _build_harness_script(self, test_cases: List[Dict[str, Any]], entrypoint: str, results_file: str) -> str:
        harness_content = f"""
import sys
import json
import time
import traceback

class BoundedWriter:
    def __init__(self, target, max_bytes):
        self.target = target
        self.max_bytes = max_bytes
        self.written = 0
        self.truncated = False

    def write(self, s):
        if not s:
            return
        b = s.encode("utf-8", errors="replace")
        if self.written + len(b) > self.max_bytes:
            allowed = max(0, self.max_bytes - self.written)
            if allowed > 0:
                self.target.write(b[:allowed].decode("utf-8", errors="replace"))
                self.written += allowed
            self.truncated = True
        else:
            self.target.write(s)
            self.written += len(b)

    def flush(self):
        try:
            self.target.flush()
        except Exception:
            pass

# Wrap stdout/stderr with byte limit
sys.stdout = BoundedWriter(sys.__stdout__, {self.config.max_stdout_bytes})
sys.stderr = BoundedWriter(sys.__stderr__, {self.config.max_stdout_bytes})

results = []
test_cases = {json.dumps(test_cases)}
entrypoint_name = {json.dumps(entrypoint)}
results_file_path = {json.dumps(results_file)}

try:
    import candidate
    candidate_fn = getattr(candidate, entrypoint_name, None)
    if candidate_fn is None:
        callables = [v for k, v in candidate.__dict__.items() if callable(v) and not k.startswith("_")]
        if len(callables) == 1:
            candidate_fn = callables[0]
        else:
            raise AttributeError(f"Function '{{entrypoint_name}}' not found in submitted code.")
except Exception as e:
    err_tb = traceback.format_exc()
    with open(results_file_path, "w", encoding="utf-8") as f:
        json.dump({{
            "status": "error",
            "error": str(e),
            "traceback": err_tb,
            "results": []
        }}, f)
    sys.exit(0)

# Run test cases
all_passed = True
for idx, tc in enumerate(test_cases):
    tc_name = tc.get("name", f"test_{{idx + 1}}")
    input_args = tc.get("input_args", [])
    expected = tc.get("expected_output")
    
    start_t = time.perf_counter()
    try:
        actual = candidate_fn(*input_args)
        elapsed_ms = (time.perf_counter() - start_t) * 1000.0
        
        # Test equality
        if actual == expected:
            results.append({{
                "name": tc_name,
                "passed": True,
                "execution_time_ms": round(elapsed_ms, 3)
            }})
        else:
            all_passed = False
            results.append({{
                "name": tc_name,
                "passed": False,
                "expected": repr(expected),
                "actual": repr(actual),
                "error": f"Expected {{repr(expected)}}, got {{repr(actual)}}",
                "execution_time_ms": round(elapsed_ms, 3)
            }})
    except Exception as exc:
        all_passed = False
        elapsed_ms = (time.perf_counter() - start_t) * 1000.0
        results.append({{
            "name": tc_name,
            "passed": False,
            "error": f"Runtime error: {{str(exc)}}",
            "execution_time_ms": round(elapsed_ms, 3)
        }})

with open(results_file_path, "w", encoding="utf-8") as f:
    json.dump({{
        "status": "passed" if all_passed else "failed",
        "results": results,
        "stdout_truncated": getattr(sys.stdout, "truncated", False) or getattr(sys.stderr, "truncated", False)
    }}, f)
"""
        return harness_content

    def _run_local_isolated(
        self,
        exec_id: str,
        code: str,
        test_cases: List[Dict[str, Any]],
        entrypoint: str,
        artifact_id: Optional[str],
        artifact_revision: int,
        artifact_hash: str,
        test_suite_hash: str,
        session_id: str,
        owner_id: str,
        created_at: str,
    ) -> ExecutionRecord:
        """
        Executes candidate code in an isolated subprocess with stripped environment,
        timeout enforcement, stdout cap, and separate grading results channel.
        """
        with tempfile.TemporaryDirectory(prefix="planly_exec_") as temp_dir:
            candidate_file = os.path.join(temp_dir, "candidate.py")
            harness_file = os.path.join(temp_dir, "harness.py")
            # Secret random result token to ensure learner stdout/prints cannot forge results
            result_token = uuid.uuid4().hex
            results_file = os.path.join(temp_dir, f"results_{result_token}.json")

            # Write learner code
            with open(candidate_file, "w", encoding="utf-8") as f:
                f.write(code)

            # Generate harness script that executes tests and outputs results to results_file
            # Notice that learner stdout is completely separated from this JSON result file!
            harness_content = self._build_harness_script(test_cases, entrypoint, results_file)
            with open(harness_file, "w", encoding="utf-8") as f:
                f.write(harness_content)

            # Build safe environment without credentials and restricting PYTHONPATH
            safe_env = {k: v for k, v in os.environ.items() if k not in SENSITIVE_ENV_VARS}
            safe_env["PYTHONPATH"] = temp_dir
            safe_env["PYTHONDONTWRITEBYTECODE"] = "1"
            if not self.config.allow_network:
                # Proxy-based restriction doesn't block raw sockets on Windows, but limits basic HTTP
                safe_env["http_proxy"] = "http://127.0.0.1:0"
                safe_env["https_proxy"] = "http://127.0.0.1:0"

            start_time = time.perf_counter()
            process = None
            stdout_str = ""
            stderr_str = ""
            stdout_truncated = False
            status = ExecutionStatus.ERROR
            results: List[TestResult] = []

            try:
                process = subprocess.Popen(
                    [sys.executable, harness_file],
                    cwd=temp_dir,
                    env=safe_env,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    text=True,
                    encoding="utf-8",
                    errors="replace",
                )

                stdout_raw, stderr_raw = process.communicate(timeout=self.config.timeout_seconds)
                stdout_str = stdout_raw or ""
                stderr_str = stderr_raw or ""

                if len(stdout_str.encode("utf-8")) > self.config.max_stdout_bytes:
                    stdout_str = stdout_str[:self.config.max_stdout_bytes]
                    stdout_truncated = True

            except subprocess.TimeoutExpired:
                if process:
                    try:
                        process.kill()
                        out_k, err_k = process.communicate(timeout=1.0)
                        stdout_str = (out_k or "")[:self.config.max_stdout_bytes]
                    except Exception:
                        pass
                elapsed_ms = (time.perf_counter() - start_time) * 1000.0
                return ExecutionRecord(
                    id=exec_id,
                    session_id=session_id,
                    owner_id=owner_id,
                    artifact_id=artifact_id,
                    artifact_revision=artifact_revision,
                    artifact_hash=artifact_hash,
                    test_suite_hash=test_suite_hash,
                    status=ExecutionStatus.TIMED_OUT,
                    passed=False,
                    tests_total=len(test_cases),
                    tests_passed=0,
                    results=[
                        TestResult(
                            name=tc.get("name", f"test_{i+1}"),
                            passed=False,
                            error=f"Execution timed out after {self.config.timeout_seconds}s (infinite loop protection).",
                        )
                        for i, tc in enumerate(test_cases)
                    ],
                    stdout=stdout_str,
                    stderr=f"TimeoutError: Process execution timed out after exceeding {self.config.timeout_seconds}s deadline.",
                    stdout_truncated=stdout_truncated,
                    duration_ms=round(elapsed_ms, 2),
                    sandbox_provider="subprocess_limited" if os.name == "nt" else "subprocess",
                    is_stale=False,
                    created_at=created_at,
                )

            elapsed_ms = (time.perf_counter() - start_time) * 1000.0

            # Parse results from the isolated results channel
            if os.path.exists(results_file):
                try:
                    with open(results_file, "r", encoding="utf-8") as f:
                        payload = json.load(f)
                    
                    if payload.get("stdout_truncated"):
                        stdout_truncated = True
                    
                    raw_status = payload.get("status")
                    if raw_status == "passed":
                        status = ExecutionStatus.PASSED
                    elif raw_status == "failed":
                        status = ExecutionStatus.FAILED
                    else:
                        status = ExecutionStatus.ERROR

                    for r in payload.get("results", []):
                        results.append(
                            TestResult(
                                name=r.get("name", "test"),
                                passed=r.get("passed", False),
                                expected=r.get("expected"),
                                actual=r.get("actual"),
                                error=r.get("error"),
                                execution_time_ms=r.get("execution_time_ms", 0.0),
                            )
                        )
                    
                    if not results and payload.get("error"):
                        stderr_str += f"\n{payload.get('error')}"

                except Exception as e:
                    status = ExecutionStatus.ERROR
                    stderr_str += f"\nFailed to parse test results: {str(e)}"
            else:
                status = ExecutionStatus.ERROR
                if not stderr_str:
                    stderr_str = "Harness terminated abnormally without writing grading results."

            tests_passed = sum(1 for r in results if r.passed)
            passed = (status == ExecutionStatus.PASSED) and (tests_passed == len(test_cases))

            return ExecutionRecord(
                id=exec_id,
                session_id=session_id,
                owner_id=owner_id,
                artifact_id=artifact_id,
                artifact_revision=artifact_revision,
                artifact_hash=artifact_hash,
                test_suite_hash=test_suite_hash,
                status=status,
                passed=passed,
                tests_total=len(test_cases),
                tests_passed=tests_passed,
                results=results,
                stdout=stdout_str,
                stderr=stderr_str,
                stdout_truncated=stdout_truncated,
                duration_ms=round(elapsed_ms, 2),
                sandbox_provider="subprocess_limited" if os.name == "nt" else "subprocess",
                is_stale=False,
                created_at=created_at,
            )

    def _run_e2b(
        self,
        exec_id: str,
        code: str,
        test_cases: List[Dict[str, Any]],
        entrypoint: str,
        artifact_id: Optional[str],
        artifact_revision: int,
        artifact_hash: str,
        test_suite_hash: str,
        session_id: str,
        owner_id: str,
        created_at: str,
    ) -> ExecutionRecord:
        """
        E2B Sandbox execution with explicit network restriction and prompt closure.
        Follows OPERATING_PROFILE.md metered allowance rules.
        """
        # Metered credit check
        if self.config.remaining_sandbox_credits <= 0:
            raise RuntimeError("Configured sandbox credits exhausted. Falling back to local execution.")

        try:
            import e2b  # type: ignore
        except ImportError:
            raise RuntimeError("e2b package not installed.")

        # In E2B, sandbox must have allow_internet_access=False explicitly passed
        # and be closed promptly in a finally block!
        sandbox = None
        start_time = time.perf_counter()
        try:
            # Explicit network restriction
            sandbox = e2b.Sandbox(
                api_key=self.config.e2b_api_key,
                allow_internet_access=False,
                timeout=int(self.config.timeout_seconds) + 5,
            )
            
            # Write candidate code
            sandbox.filesystem.write('/home/user/candidate.py', code)
            
            # Build harness
            harness_content = self._build_harness_script(
                test_cases, entrypoint, '/home/user/results.json'
            )
            sandbox.filesystem.write('/home/user/harness.py', harness_content)
            
            # Execute
            result = sandbox.process.start_and_wait(
                cmd='python /home/user/harness.py',
                timeout=int(self.config.timeout_seconds),
                cwd='/home/user',
            )
            
            # Read results
            results_content = sandbox.filesystem.read('/home/user/results.json')
            payload = json.loads(results_content)
            
            # Deduct sandbox credit
            self.config.remaining_sandbox_credits -= 1
            
            # Parse results
            status = ExecutionStatus.ERROR
            raw_status = payload.get("status")
            if raw_status == "passed":
                status = ExecutionStatus.PASSED
            elif raw_status == "failed":
                status = ExecutionStatus.FAILED
                
            results = []
            for r in payload.get("results", []):
                results.append(
                    TestResult(
                        name=r.get("name", "test"),
                        passed=r.get("passed", False),
                        expected=r.get("expected"),
                        actual=r.get("actual"),
                        error=r.get("error"),
                        execution_time_ms=r.get("execution_time_ms", 0.0),
                    )
                )
                
            tests_passed = sum(1 for r in results if r.passed)
            passed = (status == ExecutionStatus.PASSED) and (tests_passed == len(test_cases))
            elapsed_ms = (time.perf_counter() - start_time) * 1000.0
            
            return ExecutionRecord(
                id=exec_id,
                session_id=session_id,
                owner_id=owner_id,
                artifact_id=artifact_id,
                artifact_revision=artifact_revision,
                artifact_hash=artifact_hash,
                test_suite_hash=test_suite_hash,
                status=status,
                passed=passed,
                tests_total=len(test_cases),
                tests_passed=tests_passed,
                results=results,
                stdout=result.stdout[:self.config.max_stdout_bytes] if result.stdout else "",
                stderr=result.stderr[:self.config.max_stdout_bytes] if result.stderr else "",
                stdout_truncated=payload.get("stdout_truncated", False),
                duration_ms=round(elapsed_ms, 2),
                sandbox_provider="e2b",
                is_stale=False,
                created_at=created_at,
            )
            
        finally:
            if sandbox:
                try:
                    sandbox.close()
                except Exception:
                    pass


# Default Test Suites Registry
DSA_TWO_SUM_SUITE: Dict[str, Any] = {
    "id": "act_dsa_two_sum_sorted",
    "entrypoint": "two_sum",
    "test_cases": [
        {"name": "basic_pair", "input_args": [[2, 7, 11, 15], 9], "expected_output": [0, 1]},
        {"name": "three_elements", "input_args": [[2, 3, 4], 6], "expected_output": [0, 2]},
        {"name": "negative_elements", "input_args": [[-1, 0], -1], "expected_output": [0, 1]},
        {"name": "no_solution", "input_args": [[1, 2, 3, 4, 5], 10], "expected_output": []},
    ],
}

_TEST_SUITES: Dict[str, Dict[str, Any]] = {
    "act_dsa_two_sum_sorted": DSA_TWO_SUM_SUITE,
}


def register_test_suite(suite_id: str, suite_data: Dict[str, Any]) -> None:
    """Registers or updates a test suite."""
    import logging
    test_cases = suite_data.get("test_cases", [])
    for tc in test_cases:
        if "args" in tc and "input_args" not in tc:
            logging.getLogger("planly.execution").warning(f"Deprecated 'args' key in test suite {suite_id}, use 'input_args'")
            tc["input_args"] = tc.pop("args")
        if "expected" in tc and "expected_output" not in tc:
            logging.getLogger("planly.execution").warning(f"Deprecated 'expected' key in test suite {suite_id}, use 'expected_output'")
            tc["expected_output"] = tc.pop("expected")
    _TEST_SUITES[suite_id] = suite_data


def get_test_suite(suite_id: str) -> Optional[Dict[str, Any]]:
    """Retrieves a registered test suite by ID."""
    return _TEST_SUITES.get(suite_id)


def compute_sha256(content: str) -> str:
    """Computes deterministic SHA-256 hash of a string."""
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


def execute_python_code(
    code: str,
    test_suite: Optional[Dict[str, Any]] = None,
    timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS,
    artifact_id: Optional[str] = None,
    artifact_revision: int = 1,
    session_id: str = "sess_default",
    owner_id: str = "00000000-0000-0000-0000-000000000001",
) -> ExecutionRecord:
    """
    Convenience function to execute code using PythonRunner.
    """
    suite = test_suite or DSA_TWO_SUM_SUITE
    test_cases = suite.get("test_cases") or suite.get("tests", [])
    entrypoint = suite.get("entrypoint", "two_sum")

    runner = PythonRunner(PythonRunnerConfig(timeout_seconds=timeout_seconds))
    return runner.run_code_against_tests(
        code=code,
        test_cases=test_cases,
        entrypoint=entrypoint,
        artifact_id=artifact_id,
        artifact_revision=artifact_revision,
        session_id=session_id,
        owner_id=owner_id,
    )


def execute_static_review(code: str, test_suite: Optional[Dict[str, Any]] = None) -> ExecutionRecord:
    """
    Convenience function for static review when sandbox execution is disabled.
    """
    suite = test_suite or DSA_TWO_SUM_SUITE
    test_cases = suite.get("test_cases") or suite.get("tests", [])
    runner = PythonRunner(PythonRunnerConfig(sandbox_enabled=False))
    return runner.run_code_against_tests(
        code=code,
        test_cases=test_cases,
    )


_default_python_runner = PythonRunner()


def get_python_runner() -> PythonRunner:
    """Returns the default PythonRunner instance."""
    return _default_python_runner
