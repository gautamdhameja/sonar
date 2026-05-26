export async function runDailyPipeline() {
  const candidates = await collectCandidates();
  const classified = classifyCandidates(candidates);
  const scored = scoreCandidates(classified);
  return saveCandidates(scored);
}

export async function collectCandidates() {
  return [];
}

export function classifyCandidates(candidates: unknown[]) {
  return candidates;
}

export function scoreCandidates(candidates: unknown[]) {
  return candidates;
}

export function saveCandidates(candidates: unknown[]) {
  return candidates;
}
