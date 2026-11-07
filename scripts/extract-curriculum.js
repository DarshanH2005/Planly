import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const specPath = path.resolve(__dirname, "../PLANLY_BUILD_SPEC.md");
const contentDir = path.resolve(__dirname, "../content");

if (!fs.existsSync(contentDir)) {
  fs.mkdirSync(contentDir, { recursive: true });
}

const specContent = fs.readFileSync(specPath, "utf-8");

// 1. Extract pattern cards
const patternsSectionMatch = specContent.match(
  /### Pattern-family reference cards\s+([\s\S]*?)\s+### Canonical catalogue/
);

if (!patternsSectionMatch) {
  throw new Error("Could not find pattern-family reference cards in spec");
}

const patternsRaw = patternsSectionMatch[1];
const patternBlocks = patternsRaw.split(/(?=#### F\d{2} — )/);

const patternCards = [];

for (const block of patternBlocks) {
  const trimmed = block.trim();
  if (!trimmed.startsWith("#### F")) continue;

  const headerMatch = trimmed.match(/^#### (F\d{2}) — (.*?)$/m);
  if (!headerMatch) continue;

  const id = headerMatch[1];
  const title = headerMatch[2].trim();

  const cueMatch = trimmed.match(/\*\*Concept\/cue:\*\*\s*(.*?)(?=\s*Representatives:|$)/s);
  const repsMatch = trimmed.match(/Representatives:\s*(.*?)(?=\s*\*\*Pitfalls:\*\*|$)/s);
  const pitfallsMatch = trimmed.match(/\*\*Pitfalls:\*\*\s*(.*?)(?=\s*\*\*Cost:\*\*|$)/s);
  const costMatch = trimmed.match(/\*\*Cost:\*\*\s*(.*?)(?=\s*\*\*Say:\*\*|$)/s);
  const sayMatch = trimmed.match(/\*\*Say:\*\*\s*(.*?)(?=\s*\*\*Review:\*\*|$)/s);
  const reviewMatch = trimmed.match(/\*\*Review:\*\*\s*(.*?)$/s);

  const reps = repsMatch
    ? repsMatch[1]
        .split(/[,;]/)
        .map((r) => r.trim())
        .filter(Boolean)
    : [];

  patternCards.push({
    id,
    title,
    conceptCue: cueMatch ? cueMatch[1].trim() : "",
    representatives: reps,
    pitfalls: pitfallsMatch ? pitfallsMatch[1].trim() : "",
    cost: costMatch ? costMatch[1].trim() : "",
    say: sayMatch ? sayMatch[1].trim() : "",
    review: reviewMatch ? reviewMatch[1].trim() : "",
  });
}

console.log(`Parsed ${patternCards.length} pattern cards`);

// 2. Extract catalogue entries
const catalogueSectionMatch = specContent.match(
  /### Canonical catalogue\s+([\s\S]*)$/
);

if (!catalogueSectionMatch) {
  throw new Error("Could not find canonical catalogue section in spec");
}

const catalogueRaw = catalogueSectionMatch[1];
const groupMatches = [...catalogueRaw.matchAll(/#### Source group (\d{2}) — (.*?)\r?\n\r?\n\| ID \|[^\r\n]+\r?\n\|[^\r\n]+\r?\n([\s\S]*?)(?=(?:#### Source group \d{2}|$))/g)];

const catalogue = [];

for (const groupMatch of groupMatches) {
  const groupNumber = parseInt(groupMatch[1], 10);
  const groupName = groupMatch[2].trim();
  const tableRows = groupMatch[3].trim().split(/\r?\n/);

  for (const row of tableRows) {
    const trimmedRow = row.trim();
    if (!trimmedRow.startsWith("|")) continue;

    const cols = trimmedRow
      .split("|")
      .map((c) => c.trim())
      .filter((c, i, arr) => i > 0 && i < arr.length - 1);

    if (cols.length < 4) continue;

    const [id, title, tier, patternNote] = cols;
    if (!id || !tier) continue;

    const familyMatches = patternNote.match(/F\d{2}/g) || [];
    const familyIds = [...new Set(familyMatches)];

    catalogue.push({
      id,
      title,
      tier,
      sourceGroupNumber: groupNumber,
      sourceGroupName: groupName,
      patternNote,
      familyIds,
    });
  }
}

console.log(`Parsed ${catalogue.length} catalogue entries across ${groupMatches.length} source groups`);

// Validate invariants
const uniqueIds = new Set(catalogue.map((c) => c.id));
if (catalogue.length !== 198 || uniqueIds.size !== 198) {
  throw new Error(`Catalogue count mismatch: got ${catalogue.length} entries, ${uniqueIds.size} unique IDs. Expected 198.`);
}

if (groupMatches.length !== 40) {
  throw new Error(`Group count mismatch: got ${groupMatches.length}. Expected 40.`);
}

const tierCounts = { A: 0, B: 0, C: 0 };
for (const entry of catalogue) {
  tierCounts[entry.tier]++;
}

console.log("Tier breakdown:", tierCounts);

if (tierCounts.A !== 82 || tierCounts.B !== 78 || tierCounts.C !== 38) {
  throw new Error(
    `Tier count mismatch: got A=${tierCounts.A}, B=${tierCounts.B}, C=${tierCounts.C}. Expected A=82, B=78, C=38.`
  );
}

if (patternCards.length !== 19) {
  throw new Error(`Pattern card count mismatch: got ${patternCards.length}. Expected 19.`);
}

// Write JSON files
fs.writeFileSync(
  path.join(contentDir, "patterns.json"),
  JSON.stringify(patternCards, null, 2),
  "utf-8"
);

fs.writeFileSync(
  path.join(contentDir, "catalogue.json"),
  JSON.stringify(catalogue, null, 2),
  "utf-8"
);

console.log("Successfully generated catalogue.json and patterns.json!");
