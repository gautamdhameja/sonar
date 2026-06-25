import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeClaimText,
  normalizeInvalidCitationsWithMetadata,
  removeInvalidCitationClaims,
  removeUncitedClaims,
  removeWeaklySupportedAiClaims,
  removeWeaklySupportedPrivacyClaims,
  removeWeaklySupportedSecurityAccessClaims,
  removeWeaklySupportedSharingClaims,
  removeWeaklySupportedUsageClaims,
  verifyCitations,
} from "../src/generator/citation-verifier";
import { CodeUnit } from "../src/parser/types";

test("verifyCitations exempts synthesis sections from the citation requirement", () => {
  const brief = [
    "### Product In One Paragraph",
    "Sonar turns any repository into a source-grounded briefing for non-engineers who need orientation fast.",
    "",
    "### Capabilities And Differentiators",
    "It indexes code with tree-sitter and cites real line ranges for every claim it makes here.",
  ].join("\n");

  const withoutPolicy = verifyCitations(brief, []);
  assert.ok(withoutPolicy.uncitedClaims.length >= 2);

  const withPolicy = verifyCitations(brief, [], { synthesisSections: ["Product In One Paragraph"] });
  assert.ok(!withPolicy.uncitedClaims.some((claim) => /turns any repository/i.test(claim)));
  assert.ok(withPolicy.uncitedClaims.some((claim) => /indexes code with tree-sitter/i.test(claim)));
  const synthesisClaim = withPolicy.claims.find((claim) => /turns any repository/i.test(claim.text));
  assert.equal(synthesisClaim?.status, "synthesis");
});

const unit: CodeUnit = {
  id: "unit-1",
  filePath: "src/llama/config.ts",
  language: "typescript",
  kind: "function",
  name: "getLlamaConfig",
  code: "export function getLlamaConfig() {}",
  startLine: 4,
  endLine: 16,
  parentName: null,
  imports: [],
  docstring: null,
  exportedNames: ["getLlamaConfig"],
  calledFunctions: [],
  isVendored: false,
};

test("verifyCitations accepts cited claims with real source citations", () => {
  const result = verifyCitations(
    "The configuration function reads and validates the local model server URL before returning runtime settings [src/llama/config.ts:4-16].",
    [unit],
  );

  assert.equal(result.valid, true);
  assert.deepEqual(result.invalidCitations, []);
  assert.deepEqual(result.uncitedClaims, []);
});

test("verifyCitations accepts citations for routes with square-bracket path params", () => {
  const result = verifyCitations(
    "Team limits are exposed through a route handler [pages/api/teams/[teamId]/limits.ts:1-4].",
    [
      {
        ...unit,
        id: "route-unit",
        filePath: "pages/api/teams/[teamId]/limits.ts",
        name: "limits",
        startLine: 1,
        endLine: 4,
      },
    ],
  );

  assert.equal(result.invalidCitations.length, 0);
  assert.deepEqual(result.citations, ["pages/api/teams/[teamId]/limits.ts:1-4"]);
});

test("verifyCitations rejects citations outside the supplied line range", () => {
  const result = verifyCitations("The configuration function validates runtime settings [src/llama/config.ts:4-999].", [
    unit,
  ]);

  assert.equal(result.valid, false);
  assert.deepEqual(result.invalidCitations, ["src/llama/config.ts:4-999"]);
});

test("verifyCitations rejects broad file-only citations", () => {
  const result = verifyCitations("The configuration function validates runtime settings [src/llama/config.ts].", [
    unit,
  ]);

  assert.equal(result.valid, false);
  assert.deepEqual(result.invalidCitations, ["src/llama/config.ts"]);
});

test("verifyCitations expands combined citation ranges", () => {
  const result = verifyCitations(
    "The configuration logic reads one setting and validates another [src/llama/config.ts:4-8, src/llama/config.ts:9-12].",
    [{ ...unit, startLine: 4, endLine: 12 }],
  );

  assert.equal(result.valid, true);
  assert.deepEqual(result.citations, ["src/llama/config.ts:4-8", "src/llama/config.ts:9-12"]);
});

test("verifyCitations expands repeated ranges for the same file", () => {
  const result = verifyCitations(
    "The configuration logic reads one setting and validates another [src/llama/config.ts:4-8, 9-12].",
    [{ ...unit, startLine: 4, endLine: 12 }],
  );

  assert.equal(result.valid, true);
  assert.deepEqual(result.citations, ["src/llama/config.ts:4-8", "src/llama/config.ts:9-12"]);
});

test("verifyCitations accepts bare file-line citations from small local models", () => {
  const result = verifyCitations(
    "The function `getLlamaConfig` in src/llama/config.ts:4-16 retrieves the value from the environment.",
    [unit],
  );

  assert.equal(result.valid, true);
  assert.deepEqual(result.citations, ["src/llama/config.ts:4-16"]);
  assert.deepEqual(result.uncitedClaims, []);
});

test("verifyCitations accepts unambiguous line-only citations from small local models", () => {
  const result = verifyCitations("The function reads local storage [4-16].", [unit]);

  assert.equal(result.valid, true);
  assert.deepEqual(result.invalidCitations, []);
});

test("verifyCitations rejects ambiguous line-only citations", () => {
  const result = verifyCitations("The function reads local storage [4-16].", [
    unit,
    { ...unit, id: "unit-2", filePath: "src/other.ts" },
  ]);

  assert.equal(result.valid, false);
  assert.deepEqual(result.invalidCitations, ["4-16"]);
});

test("verifyCitations rejects broad summary labels", () => {
  const result = verifyCitations("The workflow validates local model configuration before execution [Data Flow].", [
    unit,
  ]);

  assert.equal(result.valid, false);
  assert.deepEqual(result.invalidCitations, ["Data Flow"]);
});

test("verifyCitations flags uncited factual claims", () => {
  const result = verifyCitations(
    "The configuration function validates the local model URL before returning runtime settings.",
    [unit],
  );

  assert.equal(result.valid, false);
  assert.equal(result.uncitedClaims.length, 1);
});

test("verifyCitations marks per-claim statuses for trusted and unverifiable claims", () => {
  const result = verifyCitations(
    [
      "The configuration function validates the local model URL before returning runtime settings [src/llama/config.ts:4-16].",
      "The same function also uploads repository contents to a hosted analytics service.",
      "The configuration function writes settings outside the supported source range [src/llama/config.ts:4-999].",
    ].join("\n"),
    [unit],
  );

  assert.deepEqual(
    result.claims.map((claim) => claim.status),
    ["verified", "unverifiable", "unverifiable"],
  );
  assert.deepEqual(result.claims[0].citations, ["src/llama/config.ts:4-16"]);
  assert.deepEqual(result.claims[2].invalidCitations, ["src/llama/config.ts:4-999"]);
});

test("verifyCitations marks claims repaired when citation normalization fixed them", () => {
  const answer =
    "The Todo component owns task display and update rendering for the visible list [src/components/Todo.jsx:1-110].";
  const units = [
    {
      id: "todo-module",
      filePath: "src/components/Todo.jsx",
      language: "javascript",
      kind: "module" as const,
      name: "Todo",
      code: "export default function Todo() {}",
      startLine: 1,
      endLine: 25,
      parentName: null,
      imports: [],
      docstring: null,
      exportedNames: [],
      calledFunctions: [],
      isVendored: false,
    },
  ];
  const verification = verifyCitations(answer, units);
  const normalized = normalizeInvalidCitationsWithMetadata(answer, units, verification);
  const repairedVerification = verifyCitations(normalized.answer, units, {
    repairedCitations: normalized.repairedCitations,
  });

  assert.equal(normalized.answer.includes("src/components/Todo.jsx:1-25"), true);
  assert.deepEqual(normalized.repairedCitations, ["src/components/Todo.jsx:1-25"]);
  assert.deepEqual(
    repairedVerification.claims.map((claim) => claim.status),
    ["repaired"],
  );
});

test("normalizeClaimText removes markdown-only differences for UI claim matching", () => {
  assert.equal(
    normalizeClaimText("**Server:** The API validates local model settings before returning runtime configuration."),
    normalizeClaimText("Server: The API validates local model settings before returning runtime configuration."),
  );
});

test("verifyCitations ignores where-to-look-next navigation guidance", () => {
  const result = verifyCitations(
    "For local storage logic: Look at `src/client/api/index.ts`. This file contains the core functions for saving and retrieving data.",
    [unit],
  );

  assert.equal(result.valid, true);
  assert.deepEqual(result.uncitedClaims, []);
});

test("verifyCitations allows unsupported-context gap statements without citations", () => {
  const result = verifyCitations(
    "The provided context does not contain the runtime validation code. To answer this completely, the missing implementation would be needed. To answer this, the code that performs the validation would need to be provided. To answer this question, the code would need to include validation logic.",
    [unit],
  );

  assert.equal(result.valid, true);
  assert.deepEqual(result.uncitedClaims, []);
});

test("verifyCitations ignores markdown links as citations", () => {
  const result = verifyCitations(
    "The README links to [documentation](https://example.com), but this implementation claim is still uncited.",
    [unit],
  );

  assert.deepEqual(result.citations, []);
  assert.equal(result.uncitedClaims.length, 1);
});

test("removeUncitedClaims removes exact unsupported prose lines", () => {
  const answer = [
    "Supported claim [src/llama/config.ts:4-16].",
    "The server handles authenticated data synchronization across every connected client.",
  ].join("\n");
  const verification = verifyCitations(answer, [unit]);

  const scrubbed = removeUncitedClaims(answer, verification);

  assert.equal(scrubbed, "Supported claim [src/llama/config.ts:4-16].");
  assert.equal(verifyCitations(scrubbed, [unit]).valid, true);
});

test("removeInvalidCitationClaims removes lines with unsupported citations", () => {
  const answer = [
    "Supported claim [src/llama/config.ts:4-16].",
    "* **Auth:** The app has a broad auth subsystem [server/auth.go:1-99].",
    "Navigation note:",
  ].join("\n");
  const verification = verifyCitations(answer, [unit]);

  const scrubbed = removeInvalidCitationClaims(answer, verification);

  assert.equal(scrubbed, "Supported claim [src/llama/config.ts:4-16].\nNavigation note:");
  assert.deepEqual(verifyCitations(scrubbed, [unit]).invalidCitations, []);
});

test("removeWeaklySupportedSharingClaims removes sharing claims supported only by credential evidence", () => {
  const answer = [
    "Users create notes [src/llama/config.ts:4-16].",
    "Users generate access tokens to share content [web/src/components/CreateAccessTokenDialog.tsx:1-10] [web/src/components/Settings/AccessTokenSection.tsx:1-12].",
  ].join("\n");
  const units = [
    unit,
    {
      ...unit,
      id: "token-dialog",
      filePath: "web/src/components/CreateAccessTokenDialog.tsx",
      name: "CreateAccessTokenDialog",
      startLine: 1,
      endLine: 10,
    },
    {
      ...unit,
      id: "token-section",
      filePath: "web/src/components/Settings/AccessTokenSection.tsx",
      name: "AccessTokenSection",
      startLine: 1,
      endLine: 12,
    },
  ];
  const verification = verifyCitations(answer, units);

  const scrubbed = removeWeaklySupportedSharingClaims(answer, verification);

  assert.match(scrubbed, /Users create notes/);
  assert.doesNotMatch(scrubbed, /share content/);
});

test("removeWeaklySupportedSharingClaims preserves sharing claims with recipient evidence", () => {
  const answer =
    "Users share public links with recipients [web/src/pages/ShareLink.tsx:1-22] [web/src/components/Settings/AccessTokenSection.tsx:1-12].";
  const units = [
    {
      ...unit,
      id: "share-page",
      filePath: "web/src/pages/ShareLink.tsx",
      name: "ShareLink",
      startLine: 1,
      endLine: 22,
    },
    {
      ...unit,
      id: "token-section",
      filePath: "web/src/components/Settings/AccessTokenSection.tsx",
      name: "AccessTokenSection",
      startLine: 1,
      endLine: 12,
    },
  ];
  const verification = verifyCitations(answer, units);

  assert.equal(removeWeaklySupportedSharingClaims(answer, verification), answer);
});

test("removeWeaklySupportedSharingClaims removes credential sharing claims even with unrelated citations", () => {
  const answer = "Users generate access tokens to share content [server/router/api/v1/memo_service.go:73-91].";
  const units = [
    {
      ...unit,
      id: "memo-service",
      filePath: "server/router/api/v1/memo_service.go",
      name: "CreateMemo",
      startLine: 73,
      endLine: 91,
    },
  ];
  const verification = verifyCitations(answer, units);

  assert.equal(removeWeaklySupportedSharingClaims(answer, verification), "");
});

test("removeWeaklySupportedSharingClaims removes share access claims without sharing evidence", () => {
  const answer =
    "3. **Share/Access**: Users share memos and manage access [server/router/api/v1/memo_service.go:42-59].";
  const units = [
    {
      ...unit,
      id: "memo-read-access",
      filePath: "server/router/api/v1/memo_service.go",
      name: "checkMemoReadAccess",
      startLine: 42,
      endLine: 59,
    },
  ];
  const verification = verifyCitations(answer, units);

  assert.equal(removeWeaklySupportedSharingClaims(answer, verification), "");
});

test("removeWeaklySupportedAiClaims removes AI workflows backed only by internal provider plumbing", () => {
  const answer =
    "2. **AI Assistance**: Users leverage AI models for content processing [internal/ai/audiollm/gemini/gemini.go:200-202].";
  const units = [
    {
      ...unit,
      id: "gemini-provider",
      filePath: "internal/ai/audiollm/gemini/gemini.go",
      name: "normalizeModelName",
      startLine: 200,
      endLine: 202,
    },
  ];
  const verification = verifyCitations(answer, units);

  assert.equal(removeWeaklySupportedAiClaims(answer, verification), "");
});

test("removeWeaklySupportedAiClaims preserves AI workflows with user-facing evidence", () => {
  const answer =
    "2. **AI Assistant**: Users ask the assistant to summarize notes [web/src/pages/AiAssistant.tsx:10-35].";
  const units = [
    {
      ...unit,
      id: "ai-page",
      filePath: "web/src/pages/AiAssistant.tsx",
      name: "AiAssistant",
      startLine: 10,
      endLine: 35,
    },
  ];
  const verification = verifyCitations(answer, units);

  assert.equal(removeWeaklySupportedAiClaims(answer, verification), answer);
});

test("removeWeaklySupportedUsageClaims removes collaboration and automation claims with generic entrypoint evidence", () => {
  const answer =
    "Users utilize the platform to organize personal notes, collaborate via shared content, and automate workflows [cmd/memos/main.go:1-36].";
  const units = [
    {
      ...unit,
      id: "main",
      filePath: "cmd/memos/main.go",
      name: "main",
      startLine: 1,
      endLine: 36,
    },
  ];
  const verification = verifyCitations(answer, units);

  assert.equal(removeWeaklySupportedUsageClaims(answer, verification), "");
});

test("removeWeaklySupportedUsageClaims preserves collaboration and automation claims with direct evidence", () => {
  const answer =
    "Users share notes and trigger webhook automation [server/router/api/v1/memo_share_service.go:10-30] [internal/webhook/webhook.go:5-25].";
  const units = [
    {
      ...unit,
      id: "share-service",
      filePath: "server/router/api/v1/memo_share_service.go",
      name: "CreateMemoShare",
      startLine: 10,
      endLine: 30,
    },
    {
      ...unit,
      id: "webhook",
      filePath: "internal/webhook/webhook.go",
      name: "DispatchWebhook",
      startLine: 5,
      endLine: 25,
    },
  ];
  const verification = verifyCitations(answer, units);

  assert.equal(removeWeaklySupportedUsageClaims(answer, verification), answer);
});

test("removeWeaklySupportedSecurityAccessClaims removes route protection claims with only config evidence", () => {
  const answer = [
    "- **Security and Access Control**: Built-in security features protect sensitive routes and manage access to content [config/security/securityConfig.go:1-11].",
    "- **Security Configuration**: Defines security policy settings for exec and HTTP behavior [config/security/securityConfig.go:1-11].",
  ].join("\n");
  const units = [
    {
      ...unit,
      id: "security-config",
      filePath: "config/security/securityConfig.go",
      name: "securityConfig",
      startLine: 1,
      endLine: 11,
    },
  ];
  const verification = verifyCitations(answer, units);
  const scrubbed = removeWeaklySupportedSecurityAccessClaims(answer, verification);

  assert.doesNotMatch(scrubbed, /sensitive routes|access to content/i);
  assert.match(scrubbed, /security policy settings/i);
});

test("removeWeaklySupportedPrivacyClaims removes data collection claims without privacy evidence", () => {
  const answer = [
    "- **Privacy**: The system does not collect or transmit user data by default [commands/server.go:1-11].",
    "- **Server**: The local server command handles file watching [commands/server.go:1-11].",
  ].join("\n");
  const units = [
    {
      ...unit,
      id: "server-command",
      filePath: "commands/server.go",
      name: "server",
      startLine: 1,
      endLine: 11,
    },
  ];
  const verification = verifyCitations(answer, units);
  const scrubbed = removeWeaklySupportedPrivacyClaims(answer, verification);

  assert.doesNotMatch(scrubbed, /collect or transmit user data/i);
  assert.match(scrubbed, /file watching/i);
});

test("removeUncitedClaims keeps uncited list items but strips uncited prose", () => {
  const brief = [
    "### Top User Workflows",
    "1. Create and upload files so users can share visual content with collaborators.",
    "",
    "This standalone paragraph asserts an uncited claim that should be removed entirely here.",
  ].join("\n");
  const verification = verifyCitations(brief, []);
  const cleaned = removeUncitedClaims(brief, verification);

  assert.match(cleaned, /1\. Create and upload files/);
  assert.doesNotMatch(cleaned, /standalone paragraph asserts an uncited claim/);
});
