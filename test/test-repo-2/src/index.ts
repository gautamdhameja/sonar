import { greet, farewell } from "./greet";
import { shout } from "./format";

const name = "World";
const greeting = greet(name);
const goodbye = farewell(name);

console.log(shout(greeting));
console.log(goodbye);
