export interface SurveyBudget {
  maxIterations: number;
  validationPasses: number;
  maxFilesPerIteration: number;
  maxValidationFiles: number;
  maxFilesTotal: number;
  maxFileBytes: number;
  maxExcerptLines: number;
}

export const DEFAULT_SURVEY_BUDGET: SurveyBudget = {
  maxIterations: 2,
  validationPasses: 1,
  maxFilesPerIteration: 6,
  maxValidationFiles: 4,
  maxFilesTotal: 14,
  maxFileBytes: 24_000,
  maxExcerptLines: 260,
};

export function normalizeSurveyBudget(input: Partial<SurveyBudget> = {}): SurveyBudget {
  const maxIterations = positiveInteger(input.maxIterations, DEFAULT_SURVEY_BUDGET.maxIterations);
  const validationPasses = nonNegativeInteger(input.validationPasses, DEFAULT_SURVEY_BUDGET.validationPasses);
  const maxFilesPerIteration = positiveInteger(input.maxFilesPerIteration, DEFAULT_SURVEY_BUDGET.maxFilesPerIteration);
  const maxValidationFiles = positiveInteger(input.maxValidationFiles, DEFAULT_SURVEY_BUDGET.maxValidationFiles);
  const maxFilesTotal = positiveInteger(input.maxFilesTotal, DEFAULT_SURVEY_BUDGET.maxFilesTotal);
  const maxFileBytes = positiveInteger(input.maxFileBytes, DEFAULT_SURVEY_BUDGET.maxFileBytes);
  const maxExcerptLines = positiveInteger(input.maxExcerptLines, DEFAULT_SURVEY_BUDGET.maxExcerptLines);

  return {
    maxIterations,
    validationPasses,
    maxFilesPerIteration: Math.min(maxFilesPerIteration, maxFilesTotal),
    maxValidationFiles: Math.min(maxValidationFiles, maxFilesTotal),
    maxFilesTotal,
    maxFileBytes,
    maxExcerptLines,
  };
}

function positiveInteger(value: number | undefined, fallback: number): number {
  if (typeof value !== "number") return fallback;
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function nonNegativeInteger(value: number | undefined, fallback: number): number {
  if (typeof value !== "number") return fallback;
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}
