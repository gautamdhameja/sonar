/** A basic arithmetic calculator. */
class Calculator {
  private history: number[] = [];

  /**
   * Add two numbers together.
   * @param a - First operand
   * @param b - Second operand
   * @returns The sum of a and b
   */
  add(a: number, b: number): number {
    const result = a + b;
    this.history.push(result);
    return result;
  }

  subtract(a: number, b: number): number {
    const result = a - b;
    this.history.push(result);
    return result;
  }

  multiply(a: number, b: number): number {
    const result = a * b;
    this.history.push(result);
    return result;
  }
}

export { Calculator };
