import type { FollowupResponse, OnboardingSessionResponse, Project, SourceRef } from "../types";

export function sourceToMarkdown(source: SourceRef, index: number): string {
  return `${index + 1}. ${source.filePath} (${source.kind} ${source.name}, lines ${source.lines})`;
}

export function buildBriefingMarkdown(
  session: OnboardingSessionResponse,
  followups: FollowupResponse[],
  selectedProject: Project | null,
): string {
  const lines = [
    `# ${session.session.repoName} - Codebase Briefing`,
    "",
    `Generated: ${new Date(session.session.createdAt).toLocaleString()}`,
    `Project: ${selectedProject?.name ?? session.session.repoName}`,
    "",
    "## Briefing",
    "",
    session.brief.brief.trim(),
    "",
    "## Sources",
    "",
    ...(session.brief.sources.length > 0
      ? session.brief.sources.map(sourceToMarkdown)
      : ["No sources were returned for this briefing."]),
  ];

  if (followups.length > 0) {
    lines.push("", "## Follow-up Questions", "");
    followups.forEach((followup, index) => {
      lines.push(`### ${index + 1}. ${followup.intent.replaceAll("_", " ")}`, "", followup.answer.trim(), "");
      if (followup.sources.length > 0) {
        lines.push("Sources:", "", ...followup.sources.map(sourceToMarkdown), "");
      }
    });
  }

  return `${lines.join("\n").trim()}\n`;
}
