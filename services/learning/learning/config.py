"""
Planly Model and Budget Configuration Loader.
Loads models.yaml and budgets.yaml with strict Pydantic validation.
Sprint: B06
"""

from pathlib import Path
from typing import Dict, List, Optional, Any
from pydantic import BaseModel, Field


def _parse_scalar(val_str: str) -> Any:
    val_str = val_str.strip()
    if val_str.lower() == "true":
        return True
    if val_str.lower() == "false":
        return False
    if val_str.lower() in ("null", "none", "~"):
        return None
    # Check int
    try:
        if val_str.startswith("0") and len(val_str) > 1 and not val_str.startswith("0."):
            pass
        else:
            return int(val_str)
    except ValueError:
        pass
    # Check float
    try:
        return float(val_str)
    except ValueError:
        pass
    # Strip quotes if wrapped
    if (val_str.startswith('"') and val_str.endswith('"')) or (val_str.startswith("'") and val_str.endswith("'")):
        return val_str[1:-1]
    return val_str


import json


def parse_simple_yaml(text: str) -> Dict[str, Any]:
    """
    Lightweight, dependency-free YAML parser for structured configuration files.
    Supports nested maps, scalars, inline comments, lists of scalars, lists of dicts,
    and multiline literal blocks (|).
    Falls back to pyyaml if installed.
    """
    try:
        import yaml
        return yaml.safe_load(text) or {}
    except ImportError:
        pass

    raw_lines = text.splitlines()
    processed_lines: List[tuple[int, str]] = []
    i = 0
    n = len(raw_lines)

    while i < n:
        raw = raw_lines[i]
        # Strip comments outside quotes
        in_quotes = False
        quote_char = ""
        clean_chars = []
        for ch in raw:
            if ch in ('"', "'"):
                if not in_quotes:
                    in_quotes = True
                    quote_char = ch
                elif quote_char == ch:
                    in_quotes = False
            elif ch == "#" and not in_quotes:
                break
            clean_chars.append(ch)
        line_clean = "".join(clean_chars).rstrip()
        if not line_clean.strip():
            i += 1
            continue

        indent = len(line_clean) - len(line_clean.lstrip())
        stripped = line_clean.strip()

        # Handle multiline string block (|)
        if stripped.endswith(": |") or stripped.endswith(":|"):
            key = stripped.split(":", 1)[0].strip()
            block_lines = []
            i += 1
            base_indent = None
            while i < n:
                next_raw = raw_lines[i]
                if not next_raw.strip():
                    block_lines.append("")
                    i += 1
                    continue
                next_indent = len(next_raw) - len(next_raw.lstrip())
                if next_indent <= indent:
                    break
                if base_indent is None:
                    base_indent = next_indent
                block_lines.append(next_raw[base_indent:])
                i += 1
            multiline_text = "\n".join(block_lines).strip()
            processed_lines.append((indent, f"{key}: {json.dumps(multiline_text)}"))
            continue

        processed_lines.append((indent, stripped))
        i += 1

    def _parse_block(start_idx: int) -> tuple[Any, int]:
        if start_idx >= len(processed_lines):
            return {}, start_idx

        curr_indent = processed_lines[start_idx][0]
        first_line = processed_lines[start_idx][1]

        if first_line.startswith("- "):
            # Parsing a LIST
            result_list = []
            idx = start_idx
            while idx < len(processed_lines):
                ind, line = processed_lines[idx]
                if ind != curr_indent or not line.startswith("- "):
                    break
                item_str = line[2:].strip()
                idx += 1

                # Check if item_str is a dict key-value, e.g. "input: '...'"
                has_key_value = False
                split_key, split_val = "", ""
                if ":" in item_str and not (item_str.startswith('"') or item_str.startswith("'")):
                    parts = item_str.split(":", 1)
                    split_key = parts[0].strip()
                    split_val = parts[1].strip()
                    has_key_value = True

                if has_key_value:
                    item_dict = {}
                    if not split_val:
                        if idx < len(processed_lines) and processed_lines[idx][0] > curr_indent:
                            child, idx = _parse_block(idx)
                            item_dict[split_key] = child
                        else:
                            item_dict[split_key] = {}
                    else:
                        item_dict[split_key] = _parse_scalar(split_val)

                    # Accumulate following sibling keys of this dict item
                    while idx < len(processed_lines):
                        sub_ind, sub_line = processed_lines[idx]
                        if sub_ind <= curr_indent or sub_line.startswith("- "):
                            break
                        if ":" in sub_line:
                            sub_parts = sub_line.split(":", 1)
                            sk = sub_parts[0].strip()
                            sv = sub_parts[1].strip()
                            idx += 1
                            if not sv:
                                if idx < len(processed_lines) and processed_lines[idx][0] > sub_ind:
                                    sub_child, idx = _parse_block(idx)
                                    item_dict[sk] = sub_child
                                else:
                                    item_dict[sk] = {}
                            else:
                                item_dict[sk] = _parse_scalar(sv)
                        else:
                            idx += 1
                    result_list.append(item_dict)
                else:
                    # Scalar item
                    result_list.append(_parse_scalar(item_str))
            return result_list, idx
        else:
            # Parsing a DICT
            result_dict = {}
            idx = start_idx
            while idx < len(processed_lines):
                ind, line = processed_lines[idx]
                if ind != curr_indent:
                    break
                if ":" not in line:
                    idx += 1
                    continue
                parts = line.split(":", 1)
                k = parts[0].strip()
                v = parts[1].strip()
                idx += 1
                if not v:
                    if idx < len(processed_lines) and processed_lines[idx][0] > ind:
                        child, idx = _parse_block(idx)
                        result_dict[k] = child
                    else:
                        result_dict[k] = {}
                else:
                    result_dict[k] = _parse_scalar(v)
            return result_dict, idx

    root, _ = _parse_block(0)
    return root if isinstance(root, dict) else {}


# Pydantic Schemas for Model and Budget Configurations

class ModelPricingConfig(BaseModel):
    effective_date: str = "2026-09-01"
    input_cost_per_m: float = 0.75   # USD per 1M tokens
    output_cost_per_m: float = 3.75  # USD per 1M tokens (includes thinking tokens)


class ModelParametersConfig(BaseModel):
    temperature: float = 0.2
    max_output_tokens: int = 2048
    timeout_seconds: int = 30
    max_repair_attempts: int = 1
    reasoning_effort: Optional[str] = None


class ModelDefinition(BaseModel):
    provider: str = "gemini"
    model_name: str = "gemini-3.8-flash"
    api_endpoint: Optional[str] = None
    display_name: str = ""
    enabled: bool = True
    pricing: ModelPricingConfig = Field(default_factory=ModelPricingConfig)
    parameters: ModelParametersConfig = Field(default_factory=ModelParametersConfig)


class ModelRouteConfig(BaseModel):
    """Ordered model candidates for one logical Planly task."""
    primary: str
    fallbacks: List[str] = Field(default_factory=list)


class ModelsConfig(BaseModel):
    models: Dict[str, ModelDefinition] = Field(default_factory=dict)
    routing: Dict[str, ModelRouteConfig] = Field(default_factory=dict)


class BudgetPoolConfig(BaseModel):
    allocation_usd: float
    description: str = ""
    allow_overdraft: bool = False


class BudgetPolicyFlags(BaseModel):
    automatic_premium_review: bool = False
    paid_experiments: bool = False
    block_when_exhausted: bool = True
    retain_uncertain_reservations: bool = True


class BudgetsConfig(BaseModel):
    monthly_ceiling_usd: float = 10.00
    internal_dispatch_limit_usd: float = 9.00
    uncommitted_headroom_usd: float = 1.00
    pools: Dict[str, BudgetPoolConfig] = Field(default_factory=dict)
    policy_flags: BudgetPolicyFlags = Field(default_factory=BudgetPolicyFlags)


def get_project_root() -> Path:
    """Returns root directory of PERSONAL workspace."""
    return Path(__file__).resolve().parent.parent.parent.parent


def load_models_config(config_path: Optional[Path] = None) -> ModelsConfig:
    """Loads models.yaml from config/ directory."""
    if config_path is None:
        config_path = get_project_root() / "config" / "models.yaml"

    if not config_path.exists():
        # Return fallback configuration
        return ModelsConfig(
            models={
                "tutor": ModelDefinition(
                    provider="gemini",
                    model_name="gemini-3.8-flash",
                    display_name="Planly Gemini Tutor",
                    enabled=True,
                ),
                "reviewer": ModelDefinition(
                    provider="gemini",
                    model_name="gemini-3.8-flash",
                    display_name="Planly Code Reviewer",
                    enabled=False,
                ),
            }
        )

    content = config_path.read_text(encoding="utf-8")
    raw_dict = parse_simple_yaml(content)
    return ModelsConfig(**raw_dict)


def load_budgets_config(config_path: Optional[Path] = None) -> BudgetsConfig:
    """Loads budgets.yaml from config/ directory."""
    if config_path is None:
        config_path = get_project_root() / "config" / "budgets.yaml"

    if not config_path.exists():
        return BudgetsConfig(
            monthly_ceiling_usd=10.00,
            internal_dispatch_limit_usd=9.00,
            uncommitted_headroom_usd=1.00,
            pools={
                "live_learning": BudgetPoolConfig(allocation_usd=8.00, description="Live tutoring"),
                "background_work": BudgetPoolConfig(allocation_usd=1.00, description="Background work"),
            },
            policy_flags=BudgetPolicyFlags(),
        )

    content = config_path.read_text(encoding="utf-8")
    raw_dict = parse_simple_yaml(content)
    return BudgetsConfig(**raw_dict)
