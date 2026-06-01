import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  Clipboard,
  Download,
  FileText,
  RefreshCw,
  Search,
} from "lucide-react";
import { suggestedQuestions } from "../app/constants";
import type { ActiveTask } from "../app/types";
import { formatMs } from "../app/format";
import type { CitationVerification, FollowupResponse, OnboardingSessionResponse, Project, SourceRef } from "../types";
import { MarkdownContent } from "./MarkdownContent";

interface BriefingViewProps {
  activeTask: ActiveTask | null;
  citation?: CitationVerification | null;
  followups: FollowupResponse[];
  latestSources: SourceRef[];
  question: string;
  selectedProject: Project | null;
  session: OnboardingSessionResponse;
  sourceFileCount: number;
  onCopyBriefing: () => void;
  onCreateOnboarding: () => void;
  onExportBriefing: () => void;
  onFollowup: () => void;
  onOpenEvidence: () => void;
  onQuestionChange: (value: string) => void;
}

export function BriefingView({
  activeTask,
  citation,
  followups,
  latestSources,
  question,
  selectedProject,
  session,
  sourceFileCount,
  onCopyBriefing,
  onCreateOnboarding,
  onExportBriefing,
  onFollowup,
  onOpenEvidence,
  onQuestionChange,
}: BriefingViewProps) {
  return (
    <div className="briefing-layout">
      <article className="brief-document">
        <div className="document-head">
          <div>
            <p className="eyebrow">Codebase Briefing</p>
            <h2>{session.session.repoName}</h2>
          </div>
          <div className="document-actions">
            <button className="secondary" onClick={onCopyBriefing} type="button">
              <Clipboard size={16} />
              Copy
            </button>
            <button className="secondary" onClick={onExportBriefing} type="button">
              <Download size={16} />
              Export
            </button>
            <button className="secondary" onClick={onOpenEvidence} type="button">
              <Search size={16} />
              Evidence
            </button>
            <button className="secondary" onClick={onCreateOnboarding} type="button">
              <RefreshCw size={16} />
              Regenerate
            </button>
          </div>
        </div>

        <div className="confidence-row">
          <span>
            <BookOpen size={15} />
            {sourceFileCount} source files
          </span>
          <span>
            <FileText size={15} />
            {latestSources.length} cited units
          </span>
          {citation && (
            <span className={citation.valid ? "confidence-good" : "confidence-warn"}>
              {citation.valid ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
              {citation.valid ? "Grounded" : `${citation.uncitedClaims.length} open claims`}
            </span>
          )}
          {session.brief.generationTruncated && (
            <span className="confidence-warn">
              <AlertTriangle size={15} />
              Output truncated
            </span>
          )}
        </div>

        <MarkdownContent className="briefing-text" content={session.brief.brief} />

        <section className="followup-card">
          <div>
            <p className="eyebrow">Ask Next</p>
            <h3>Continue from this briefing</h3>
          </div>
          <div className="answers">
            {followups.map((item) => (
              <article
                className="answer"
                key={`${item.question}-${item.intent}-${item.retrievalTime}-${item.generationTime}`}
              >
                <div className="answer-question">
                  <span>You asked</span>
                  <p>{item.question}</p>
                </div>
                <div className="answer-meta">
                  <span>{item.intent.replaceAll("_", " ")}</span>
                  <span>
                    {formatMs(item.retrievalTime)} retrieval · {formatMs(item.generationTime)} generation
                  </span>
                </div>
                {item.generationTruncated && (
                  <p className="inline-warning">
                    This answer reached the model output limit. Regenerate or ask a narrower question.
                  </p>
                )}
                <MarkdownContent content={item.answer} />
              </article>
            ))}
          </div>
          <div className="chat-composer">
            <div className="suggestion-row">
              {suggestedQuestions.map((item) => (
                <button key={item} onClick={() => onQuestionChange(item)} type="button">
                  {item}
                </button>
              ))}
            </div>
            <div className="question-row">
              <textarea
                value={question}
                onChange={(event) => onQuestionChange(event.target.value)}
                placeholder="Ask a follow-up about this codebase"
              />
              <button
                className="primary"
                disabled={!session || activeTask?.kind === "followup" || !question.trim()}
                onClick={onFollowup}
                type="button"
              >
                Ask
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        </section>
      </article>

      <aside className="brief-aside">
        <section>
          <p className="eyebrow">Confidence</p>
          <h3>{citation?.valid ? "Evidence looks grounded" : "Review suggested"}</h3>
          <p>
            {citation?.valid
              ? "The briefing cites concrete files from the repository."
              : "Some summary language may need a human check before sharing."}
          </p>
        </section>
        <section>
          <p className="eyebrow">Selected Repository</p>
          <h3>{selectedProject?.name ?? session.session.repoName}</h3>
          <p>{selectedProject?.fileCount ?? 0} files indexed locally.</p>
        </section>
      </aside>
    </div>
  );
}
