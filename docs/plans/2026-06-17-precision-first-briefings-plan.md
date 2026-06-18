---
title: Precision-First Local Briefings Implementation Plan
date: 2026-06-17
origin: docs/brainstorms/2026-06-17-precision-first-briefings-requirements.md
execution: code
---

# Precision-First Local Briefings Implementation Plan

## Problem Frame

Sonar's local-model path must prioritize factual safety over completeness. The current path can include the right source file but still let the model choose the wrong ownership explanation. The fix is to move more truth work out of the model and into deterministic source analysis, then constrain and verify the generated answer.

## Scope

In scope:

- Add a generic repository grounding map to the briefing prompt.
- Rank central/orchestration files using language-agnostic source signals.
- Tighten prompt wording around cautious claims and absence claims.
- Run deterministic citation normalization before model repair.
- Add tests that cover the observed `App.jsx` centrality failure mode and the local-model repair path.

Out of scope:

- Full static call graph construction.
- New vector store or embedding behavior.
- Runtime execution of analyzed repositories.
- UI changes.

## Existing Patterns To Follow

- `src/retriever/briefing-workflow-planner.ts` already builds a compact source-backed map before generation.
- `src/generator/onboarding-prompt.ts` already separates system rules, workflow map, memory graph, and raw source context.
- `src/generator/citation-verifier.ts` already verifies citations and removes unsupported claims.
- `test/briefing-workflow-planner.test.ts` and `test/onboarding-prompt.test.ts` are the right places for unit coverage.

## Implementation Units

### U1: Generic Repository Grounding Map

Files:

- Modify: `src/retriever/briefing-workflow-planner.ts`
- Test: `test/briefing-workflow-planner.test.ts`

Approach:

- Add source centrality scoring based on imports, exports, called functions, module size, entry-point path names, and state/data/external-boundary keywords.
- Add generic grounding facts to `BriefingWorkflowPlan`, such as central files, state/data ownership signals, external-boundary signals, persistence signals, and explicit caution notes.
- Update `workflowPlanToPrompt` to emit `Repository grounding map` before workflow-specific sections.

Verification:

- A React fixture with `App.jsx`, `Form.jsx`, `Todo.jsx`, and `FilterButton.jsx` ranks `App.jsx` as central.
- The prompt contains a central-files list and state/data ownership signals.

### U2: Precision-First Prompt Contract

Files:

- Modify: `src/generator/onboarding-prompt.ts`
- Test: `test/onboarding-prompt.test.ts`

Approach:

- Add rules that tell the model to prefer lower-detail truth over unsupported specificity.
- Require the model to anchor ownership claims in the grounding map when present.
- Require cautious wording for absence claims, such as "not shown in inspected context" instead of absolute "does not exist" unless supported.
- Remove or soften SaaS-specific workflow ordering in generic sections.

Verification:

- Prompt tests confirm the precision-first rules are present.
- Existing prompt tests continue to pass.

### U3: Deterministic Citation Repair First

Files:

- Modify: `src/generator/onboarding.ts`
- Test: `test/onboarding-generation.test.ts`

Approach:

- Move `normalizeInvalidCitations` ahead of model-based citation repair.
- Only call the model repair path if invalid citations remain after deterministic normalization.
- Preserve uncited-claim stripping after invalid citation handling.

Verification:

- Existing citation normalization test still passes.
- A new behavioral test covers the deterministic-first ordering where possible without needing a live model.

### U4: Regression And Quality Gate

Files:

- Test: `test/briefing-workflow-planner.test.ts`
- Test: `test/onboarding-prompt.test.ts`
- Test: `test/onboarding-generation.test.ts`

Approach:

- Add regression tests for the observed local-model failure shape.
- Run focused tests after each unit.
- Run `npm run check` at the end.

Verification:

- Focused tests pass.
- Full check suite passes.

