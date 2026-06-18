---
title: Precision-First Local Briefings
date: 2026-06-17
status: ready-for-planning
---

# Precision-First Local Briefings Requirements

## Problem

Sonar's local-model briefing path is now operational, but it can still make unsupported or over-specific claims. The target is not frontier-model depth. The target is correctness: a local-model briefing may be slower, shorter, and more cautious, but it must not tell the user something false.

The latest `mdn/todo-react` comparison showed the failure clearly. Sonar correctly described the repository as a React todo tutorial, but it underweighted the central state owner and produced an imprecise ownership claim that pointed state management at `Form.jsx` instead of `App.jsx`.

## Research Summary

Recent RAG and code-summarization research points to the same conclusion: global repository overview is not ordinary nearest-neighbor retrieval.

- GraphRAG frames broad corpus questions as query-focused summarization rather than simple retrieval. It builds graph/community summaries before generation because "main themes" questions are global sensemaking tasks, not local lookup tasks. Source: [From Local to Global: A Graph RAG Approach to Query-Focused Summarization](https://arxiv.org/abs/2404.16130).
- SAFE-style factuality evaluation breaks long-form answers into individual facts and verifies each fact against external evidence. For Sonar, the analogous move is source-backed claim verification and deterministic stripping of unsupported claims. Source: [Long-form factuality in large language models](https://arxiv.org/abs/2403.18802).
- Self-RAG shows that factuality improves when generation is coupled with reflection about retrieval relevance and output support. Sonar should apply a lightweight version: verify support before trusting generated specificity. Source: [Self-RAG: Learning to Retrieve, Generate, and Critique through Self-Reflection](https://arxiv.org/abs/2310.11511).
- Code hallucination surveys identify insufficient semantic grounding as a major cause of code-task hallucination and point to program analysis, static checks, and post-editing as mitigation tools. Source: [A Systematic Literature Review of Code Hallucinations in LLMs](https://arxiv.org/abs/2511.00776).
- Repository-level local-LLM summarization benefits from hierarchical source analysis: summarize smaller artifacts, then aggregate to higher-level file/package summaries. Source: [Hierarchical Repository-Level Code Summarization for Business Applications Using Local LLMs](https://arxiv.org/abs/2501.07857).

## Product Principle

Sonar should behave like a cautious repository scout:

- State supported facts plainly.
- Mark weak inference as inference.
- Say when the inspected context does not support an answer.
- Prefer a useful partial answer over a confident false answer.
- Avoid absolute absence claims unless the system can justify the inspected scope.

## Requirements

R1. The briefing generator must receive a deterministic grounding map before source excerpts.

R2. The grounding map must be generic across languages and project types. It may use repository invariants such as entry points, import/export/call relationships, source centrality, state/data ownership signals, external-boundary signals, persistence indicators, config, tests, and documentation. It must not depend on SaaS-specific assumptions like billing, analytics, sharing, or AI.

R3. The local-model prompt must explicitly prefer cautious language over unsupported specificity.

R4. The model must not claim a subsystem exists unless the supplied evidence shows it. If evidence is missing, it should say the inspected context does not show it rather than inventing it.

R5. Citation normalization should run before model-based citation repair so local runs do not pay for an expensive repair call when deterministic repair is enough.

R6. The system should favor central orchestration files in overview sections. A file that imports or calls many project-local concepts should outrank leaf files for ownership/system-map claims.

R7. The generated briefing should be allowed to be higher-level than a frontier-model source-read baseline, but wrong claims should be reduced through prompt constraints, evidence selection, and post-generation stripping.

## Acceptance Examples

AE1. In a small React app where `App.jsx` owns state and child components call parent callbacks, the grounding map identifies `App.jsx` as central evidence.

AE2. In a repository without backend evidence in the selected source context, the model should not claim a backend exists.

AE3. If the model emits a broad citation to a file range that maps to a known selected range, deterministic normalization fixes it without requiring a model repair call.

AE4. If a factual claim has no citation and is not an allowed uncertainty/gap statement, post-generation cleanup removes it.

## Non-Goals

- Do not reintroduce embeddings as the primary overview mechanism.
- Do not try to make the local model match a frontier model's depth.
- Do not add project-specific hardcoding for `todo-react`, Papermark, Excalidraw, or Sonar itself.
- Do not require Docker or a running model for unit tests.

