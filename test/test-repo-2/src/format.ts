/** Wrap text in brackets for emphasis. */
export function format(text: string): string {
  return `[${text}]`;
}

/** Uppercase a string. */
export function shout(text: string): string {
  return text.toUpperCase();
}
