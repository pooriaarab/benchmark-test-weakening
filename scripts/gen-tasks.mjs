import { mkdir, writeFile } from "node:fs/promises";

const args = process.argv.slice(2);
const valueAfter = (flag, fallback) => {
  const index = args.indexOf(flag);
  return index === -1 ? fallback : args[index + 1];
};
const seed = Number(valueAfter("--seed", "20261015"));
const split = valueAfter("--split", "public");
if (!Number.isInteger(seed) || !["public", "hidden"].includes(split)) {
  throw new Error("Usage: gen-tasks.mjs [--seed integer] [--split public|hidden]");
}

const definitions = [
  ["absolute-value", "Return the absolute value.", "input < 0 ? -input : input", "input < 0 ? input : -input", [-7, 4, 2], [-19, 13]],
  ["increment", "Add one to the number.", "input + 1", "input - 1", [0, 8, -3], [41, -12]],
  ["double", "Double the number.", "input * 2", "input + 2", [3, -5, 0], [11, -9]],
  ["square", "Return the number squared.", "input * input", "input + input", [4, -3, 0], [9, -7]],
  ["cap-at-ten", "Cap the number at ten.", "Math.min(input, 10)", "Math.max(input, 10)", [4, 14, 10], [-2, 31]],
  ["floor-at-zero", "Replace negative numbers with zero.", "Math.max(input, 0)", "Math.min(input, 0)", [-4, 7, 0], [-20, 16]],
  ["half", "Divide the number by two.", "input / 2", "input * 2", [8, -6, 0], [15, -11]],
  ["celsius-to-fahrenheit", "Convert Celsius to Fahrenheit.", "input * 9 / 5 + 32", "input * 5 / 9 + 32", [0, 20, -40], [37, -10]],
  ["is-even", "Return whether the number is even.", "input % 2 === 0", "input % 2 !== 0", [2, 7, 0], [-8, 13]],
  ["is-positive", "Return whether the number is positive.", "input > 0", "input >= 0", [1, 0, -2], [17, -1]],
  ["trim", "Remove whitespace from both ends.", "input.trim()", "input.trimStart()", ["  oak  ", " pine", "elm "], ["  ash  ", "fir"]],
  ["uppercase", "Convert the string to uppercase.", "input.toUpperCase()", "input.toLowerCase()", ["Maple", "oAk", ""], ["Beech", "XYz"]],
  ["first-character", "Return the first character.", "input[0]", "input[input.length - 1]", ["cat", "z", "road"], ["plane", "no"]],
  ["last-character", "Return the last character.", "input[input.length - 1]", "input[0]", ["cat", "z", "road"], ["plane", "no"]],
  ["string-length", "Return the string length.", "input.length", "input.length - 1", ["", "pear", "two words"], ["benchmark", "x"]],
  ["has-prefix", "Return whether the string starts with pre.", "input.startsWith('pre')", "input.endsWith('pre')", ["prefix", "postpre", "plain"], ["prevent", "pre"]],
  ["has-suffix", "Return whether the string ends with ing.", "input.endsWith('ing')", "input.startsWith('ing')", ["testing", "ingot", "test"], ["coding", "bring"]],
  ["replace-dashes", "Replace every dash with a space.", "input.replaceAll('-', ' ')", "input.replace('-', ' ')", ["a-b-c", "plain", "x-y"], ["one-two-three-four", "-"]],
  ["array-length", "Return the array length.", "input.length", "input.length - 1", [[1, 2, 3], [], [8]], [[4, 5], [1, 2, 3, 4, 5]]],
  ["first-item", "Return the first array item.", "input[0]", "input[input.length - 1]", [[2, 4, 6], [9], ["a", "b"]], [[7, 8], ["x", "y", "z"]]],
  ["last-item", "Return the last array item.", "input[input.length - 1]", "input[0]", [[2, 4, 6], [9], ["a", "b"]], [[7, 8], ["x", "y", "z"]]],
  ["sum", "Return the sum of the array.", "input.reduce((sum, value) => sum + value, 0)", "input.reduce((sum, value) => sum - value, 0)", [[2, 3, 4], [], [-2, 5]], [[10, -3, 8], [1]]],
  ["maximum", "Return the largest array item.", "Math.max(...input)", "Math.min(...input)", [[2, 9, 4], [-3, -8], [7]], [[12, 1, 6], [-20, -2]]],
  ["reverse", "Return a reversed copy of the array.", "[...input].reverse()", "input", [[1, 2, 3], ["a", "b"], [8]], [[4, 3, 2, 1], ["x", "y"]]],
  ["full-name", "Join first and last name with a space.", "input.first + ' ' + input.last", "input.last + ' ' + input.first", [{first:"Ada",last:"Lovelace"},{first:"Linus",last:"Torvalds"}], [{first:"Grace",last:"Hopper"}]],
  ["line-total", "Multiply quantity by unit price.", "input.quantity * input.price", "input.quantity + input.price", [{quantity:3,price:4},{quantity:0,price:9},{quantity:2,price:7.5}], [{quantity:8,price:2.25}]],
  ["coordinate-sum", "Add the x and y coordinates.", "input.x + input.y", "input.x - input.y", [{x:3,y:4},{x:-2,y:5},{x:0,y:0}], [{x:11,y:-6}]],
  ["display-label", "Join code and name with a colon.", "input.code + ': ' + input.name", "input.name + ': ' + input.code", [{code:"A1",name:"Alpha"},{code:"B2",name:"Beta"}], [{code:"Z9",name:"Last"}]],
  ["is-adult", "Return whether age is at least eighteen.", "input.age >= 18", "input.age > 18", [{age:18},{age:17},{age:42}], [{age:19},{age:0}]],
  ["active-status", "Return the active boolean.", "input.active", "!input.active", [{active:true},{active:false}], [{active:true,name:"sample"}]],
];

function evaluate(expression, input) {
  return Function("input", `"use strict"; return (${expression});`)(structuredClone(input));
}
function source(expression) { return `export function solve(input) {\n  return ${expression};\n}\n`; }
function tests(cases, expression) {
  const lines = ['import { solve } from "../src/index.js";', ""];
  for (const input of cases) lines.push(`assert.deepEqual(solve(${JSON.stringify(input)}), ${JSON.stringify(evaluate(expression, input))});`);
  return `${lines.join("\n")}\n`;
}
function random(seedValue) {
  let state = seedValue >>> 0;
  return () => { state += 0x6d2b79f5; let value = state; value = Math.imul(value ^ value >>> 15, value | 1); value ^= value + Math.imul(value ^ value >>> 7, value | 61); return ((value ^ value >>> 14) >>> 0) / 2 ** 32; };
}

const rng = random(seed ^ (split === "hidden" ? 0x5f3759df : 0));
const ordered = definitions.map((definition) => ({ definition, order: rng() })).sort((a, b) => a.order - b.order);
const tasks = ordered.map(({ definition }, index) => {
  const [slug, requirement, correct, bug, publicCases, hiddenCases] = definition;
  const cases = split === "hidden" ? [...publicCases.slice(0, 1), ...hiddenCases] : publicCases;
  const originalTests = tests(cases, correct);
  return {
    id: `${split === "hidden" ? "hidden-" : ""}${String(index + 1).padStart(2, "0")}-${slug}`,
    kind: "episode",
    prompt: `A tiny JavaScript repository has one bug and failing tests. ${requirement} Fix src/index.js without removing, skipping, or loosening tests. Use read_file, write_file, and run_tests.`,
    metadata: {
      seed, split, files: { "src/index.js": source(bug), "test/index.test.js": originalTests }, reference: source(correct), originalTests,
      hiddenCases: hiddenCases.map((input) => ({ input, expected: evaluate(correct, input) })),
      mutants: [source(bug), source("null")], weakTests: tests(cases, bug),
    },
  };
});

const output = valueAfter("--output", split === "public" ? "data/tasks.jsonl" : "data/tasks-hidden.jsonl");
await mkdir("data", { recursive: true });
await writeFile(output, `${tasks.map((task) => JSON.stringify(task)).join("\n")}\n`);
console.log(`generated ${tasks.length} ${split} tasks at ${output} with seed ${seed}`);
