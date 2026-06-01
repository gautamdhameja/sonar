import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeTruncatedBriefingPart } from "../src/generator/onboarding";

test("sanitizeTruncatedBriefingPart removes incomplete trailing fragments and fills missing sections", () => {
  const result = sanitizeTruncatedBriefingPart(
    [
      "### Top User Workflows",
      "Users create notes through the app [src/app.ts:4-18].",
      "*",
      "",
      "### Main Systems And Ownership Areas",
      "The app module owns user actions [src/app.ts:",
    ].join("\n"),
    ["Top User Workflows", "Main Systems And Ownership Areas", "Risks Or Open Questions"],
  );

  assert.match(result, /Users create notes through the app \[src\/app\.ts:4-18\]\./);
  assert.doesNotMatch(result, /\n\*/);
  assert.doesNotMatch(result, /\[src\/app\.ts:$/);
  assert.match(result, /### Main Systems And Ownership Areas\nNot found in provided context/);
  assert.match(result, /### Risks Or Open Questions\nNot found in provided context/);
});
