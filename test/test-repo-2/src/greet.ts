import { format } from "./format";

/** Greet a user by name. */
export function greet(name: string): string {
  return format(`Hello, ${name}!`);
}

/** Say goodbye to a user. */
export function farewell(name: string): string {
  return format(`Goodbye, ${name}!`);
}
