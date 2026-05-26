export function optionalTrimmedString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  return trimmed.slice(0, maxLength);
}

export function requiredTrimmedString(
  value: unknown,
  fieldName: string,
  maxLength: number,
): { value?: string; error?: string } {
  if (typeof value !== "string") {
    return { error: `${fieldName} is required and must be a string` };
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return { error: `${fieldName} is required and must not be empty` };
  }
  if (trimmed.length > maxLength) {
    return { error: `${fieldName} exceeds maximum length of ${maxLength} characters` };
  }

  return { value: trimmed };
}

export function optionalStringList(
  value: unknown,
  fieldName: string,
  maxItems: number,
): { value?: string[]; error?: string } {
  if (value === undefined) return {};
  if (!Array.isArray(value)) {
    return { error: `${fieldName} must be a non-empty array of strings` };
  }

  const items = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, maxItems);

  if (items.length === 0) {
    return { error: `${fieldName} must be a non-empty array of strings` };
  }

  return { value: items };
}
