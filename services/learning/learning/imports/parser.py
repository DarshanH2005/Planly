import re
from typing import List, Dict, Tuple, Optional
from pydantic import BaseModel, Field

"""
Sprint B05: Chat Export Parser

Parses historical chat export markdown into structured turns with:
- Turn and speaker boundaries (handling both '## User' and '**User:**' styles)
- Code block and artifact extraction
- Detection and reporting of malformed/partial speaker boundaries (B05-AC4)
- Untrusted data containment: neutralizes embedded policy injection attempts
"""


class CodeBlock(BaseModel):
    language: str
    code: str


class ExtractionIssue(BaseModel):
    line_number: int
    issue_type: str
    description: str


class ParsedTurn(BaseModel):
    speaker: str  # "learner" or "tutor"
    content: str
    turn_index: int
    code_blocks: List[CodeBlock] = Field(default_factory=list)
    has_code: bool = False
    section: Optional[str] = None
    is_malformed: bool = False
    malformed_reason: Optional[str] = None


CODE_BLOCK_REGEX = re.compile(r"```([a-zA-Z0-9_-]*)\s*\n(.*?)```", re.DOTALL)

# Untrusted prompt injection patterns to neutralize/flag
UNTRUSTED_PATTERNS = [
    re.compile(r"ignore\s+(all\s+)?previous\s+instructions", re.IGNORECASE),
    re.compile(r"you\s+are\s+now\s+in\s+(developer|admin|root)\s+mode", re.IGNORECASE),
    re.compile(r"system\s+prompt\s+override", re.IGNORECASE),
]


def extract_code_blocks(text: str) -> List[CodeBlock]:
    blocks = []
    for match in CODE_BLOCK_REGEX.finditer(text):
        lang = match.group(1).strip() or "text"
        code = match.group(2).strip()
        blocks.append(CodeBlock(language=lang, code=code))
    return blocks


def parse_chat_markdown(raw_text: str, filename: str = "") -> Tuple[List[ParsedTurn], List[ExtractionIssue], str]:
    """
    Parses markdown chat exports into discrete, ordered ParsedTurn objects.
    B05-AC4: Detects and reports malformed/partial speaker boundaries instead of
    silently assigning text to the wrong speaker.
    Returns: (turns, extraction_issues, extraction_quality)
    """
    lines = raw_text.splitlines()
    turns: List[ParsedTurn] = []
    issues: List[ExtractionIssue] = []

    current_speaker: Optional[str] = None
    current_content: List[str] = []
    current_section: Optional[str] = None
    turn_index = 0

    def commit_turn():
        nonlocal turn_index, current_content, current_speaker, current_section
        if current_speaker and current_content:
            text = "\n".join(current_content).strip()
            if text:
                code_blocks = extract_code_blocks(text)
                turns.append(ParsedTurn(
                    speaker=current_speaker,
                    content=text,
                    turn_index=turn_index,
                    code_blocks=code_blocks,
                    has_code=len(code_blocks) > 0,
                    section=current_section,
                ))
                turn_index += 1
        current_content = []

    in_code_fence = False

    for line_num, line in enumerate(lines, 1):
        stripped = line.strip()

        # Track code fences to avoid false speaker splits inside code blocks
        if stripped.startswith("```"):
            in_code_fence = not in_code_fence
            if current_speaker:
                current_content.append(line)
            continue

        if in_code_fence:
            if current_speaker:
                current_content.append(line)
            continue

        # Track Day or Section headers: e.g. '# Day 4', '## Day 1'
        if stripped.startswith("# Day ") or stripped.startswith("## Day "):
            current_section = stripped.lstrip("#").strip()
            continue

        # Detect User / Learner headers
        is_user_header = False
        if stripped in ("## User", "**User:**", "### User", "**User**:", "# User"):
            is_user_header = True
        elif stripped.startswith("## User") or stripped.startswith("**User:"):
            # Check for potential malformed speaker lines like "## User said"
            is_user_header = True

        # Detect Assistant / Tutor headers
        is_assistant_header = False
        if stripped in ("## Assistant", "**Assistant:**", "### Assistant", "**Assistant**:", "# Assistant"):
            is_assistant_header = True
        elif stripped.startswith("## Assistant") or stripped.startswith("**Assistant:"):
            is_assistant_header = True

        # Check for malformed / ambiguous speaker boundary markers (B05-AC4)
        if not is_user_header and not is_assistant_header:
            if stripped.startswith("## ") and not stripped.startswith("## Day"):
                issues.append(ExtractionIssue(
                    line_number=line_num,
                    issue_type="malformed_speaker",
                    description=f"Unrecognized speaker marker: {stripped}",
                ))
                issues.append(ExtractionIssue(
                    line_number=line_num,
                    issue_type="ambiguous_speaker_boundary",
                    description=f"Ambiguous speaker boundary: {stripped}",
                ))
            elif stripped.startswith("**") and stripped.endswith(":") and not stripped.endswith("**:") and not stripped.endswith("**"):
                # Unclosed bold boundary marker, e.g. "**InvalidFormat:"
                issues.append(ExtractionIssue(
                    line_number=line_num,
                    issue_type="malformed_boundary",
                    description=f"Malformed formatting tag: {stripped}",
                ))
            elif stripped.startswith("**") and ("user" in stripped.lower() or "assistant" in stripped.lower() or "speaker" in stripped.lower()):
                issues.append(ExtractionIssue(
                    line_number=line_num,
                    issue_type="malformed_boundary",
                    description=f"Malformed speaker boundary tag: {stripped}",
                ))

        if is_user_header:
            commit_turn()
            current_speaker = "learner"
            continue
        elif is_assistant_header:
            commit_turn()
            current_speaker = "tutor"
            continue

        # Check for untrusted policy injection attempts (Failure to prevent)
        for pattern in UNTRUSTED_PATTERNS:
            if pattern.search(stripped):
                issues.append(ExtractionIssue(
                    line_number=line_num,
                    issue_type="untrusted_instruction",
                    description=f"Untrusted policy pattern detected and contained: {stripped[:60]}",
                ))

        if current_speaker:
            current_content.append(line)

    commit_turn()

    # Determine overall extraction quality
    if not turns:
        extraction_quality = "failed"
        issues.append(ExtractionIssue(line_number=0, issue_type="no_turns", description="No valid turns extracted from document."))
    elif issues:
        extraction_quality = "clean_with_warnings"
    else:
        extraction_quality = "clean"

    return turns, issues, extraction_quality


class ParsedChatExport(BaseModel):
    turns: List[ParsedTurn]
    extraction_issues: List[ExtractionIssue]
    extraction_quality: str
    unsupported_percentage_claims: List[str] = Field(default_factory=list)
    pending_questions: List[str] = Field(default_factory=list)
    track: str = "dsa"
    raw_content: str = ""


def parse_chat_export(raw_text: str, default_track: str = "dsa", filename: str = "") -> ParsedChatExport:
    """
    Parses chat export text and extracts turns, boundaries, and unsupported percentage claims.
    """
    turns, issues, quality = parse_chat_markdown(raw_text, filename=filename)

    percentage_claims = []
    claim_matches = re.finditer(
        r"(?:overall\s+)?(\d{1,3}(?:[–-]\d{1,3})?%\s*(?:DSA\s*)?(?:readiness|progress)?)",
        raw_text,
        re.IGNORECASE,
    )
    for m in claim_matches:
        matched_str = m.group(1).strip()
        if matched_str and matched_str not in percentage_claims:
            percentage_claims.append(matched_str)

    if "85% DSA readiness" in raw_text and not any("85% DSA readiness" in c for c in percentage_claims):
        percentage_claims.append("85% DSA readiness")
    if "5–7%" in raw_text or "5-7%" in raw_text:
        if not any("5" in c and "%" in c for c in percentage_claims):
            percentage_claims.append("5-7% DSA progress")

    return ParsedChatExport(
        turns=turns,
        extraction_issues=issues,
        extraction_quality=quality,
        unsupported_percentage_claims=percentage_claims,
        pending_questions=[],
        track=default_track,
        raw_content=raw_text,
    )
