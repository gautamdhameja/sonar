import { Calculator } from "./calculator";
import { formatNumber, validateInput } from "./utils";

const calc = new Calculator();

const a = 42;
const b = 18;

if (validateInput(a) && validateInput(b)) {
  const sum = calc.add(a, b);
  const diff = calc.subtract(a, b);
  const product = calc.multiply(a, b);

  console.log(`Sum: ${formatNumber(sum)}`);
  console.log(`Difference: ${formatNumber(diff)}`);
  console.log(`Product: ${formatNumber(product)}`);
} else {
  console.error("Invalid input");
}
