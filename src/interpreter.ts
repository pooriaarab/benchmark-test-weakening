// Tree-walking interpreter for the documented answer grammar: model source is
// parsed by acorn, whitelisted by checkExpr, and evaluated node by node. No
// model text reaches eval, Function, vm, import(), or require, and property
// reads resolve only through explicit allow-lists.

export interface Ast {
  type: string;
  [key: string]: unknown;
}

export class Forbidden extends Error {
  override name = "Forbidden";
}
const forbidden = (message: string): Forbidden => new Forbidden(message);

const MAX_DEPTH = 200;
const STEP_BUDGET = 200_000;
const MAX_OUTPUT = 100_000;
const MAX_STRING = 200_000;
const MAX_ARRAY = 100_000;
const MAX_REGEX_SOURCE = 300;
const MAX_REGEX_INPUT = 1_024;
const MAX_REGEX_RUN = 3;
const MAX_REGEX_QUANTIFIERS = 10;

interface Ctx {
  steps: number;
}
interface Closure {
  kind: "closure";
  params: string[];
  body: Ast;
  bodyIsExpression: boolean;
  scope: Scope;
}
interface Builtin {
  kind: "builtin";
  name: string;
  call: (ctx: Ctx, args: unknown[]) => unknown;
}
type Callable = Closure | Builtin;
const isCallable = (value: unknown): value is Callable =>
  typeof value === "object" && value !== null &&
  ((value as Callable).kind === "closure" || (value as Callable).kind === "builtin");

class Scope {
  #vars = new Map<string, unknown>();
  #parent: Scope | undefined;
  constructor(parent?: Scope) {
    this.#parent = parent;
  }
  set(name: string, value: unknown): void {
    this.#vars.set(name, value);
  }
  get(name: string): unknown {
    if (this.#vars.has(name)) return this.#vars.get(name);
    if (this.#parent) return this.#parent.get(name);
    throw forbidden(`identifier is not in the grammar: ${name}`);
  }
}

function step(ctx: Ctx, cost = 1): void {
  ctx.steps -= cost;
  if (ctx.steps <= 0) throw forbidden("evaluation step budget exhausted");
}

// The member lists below are the whole property surface a candidate can reach.
// Anything else - constructor, __proto__, prototype, or a computed name outside
// the list - is a clean forbidden error, so a member name assembled at run time
// (String.fromCharCode tricks) cannot escape.
const STRING_METHODS = new Set(
  "at charAt charCodeAt codePointAt concat endsWith includes indexOf lastIndexOf padEnd padStart repeat replace replaceAll slice split startsWith substring toLowerCase toString toUpperCase trim trimEnd trimStart".split(" "),
);
const ARRAY_METHODS = new Set(
  "at concat every filter find findIndex findLast flat flatMap forEach includes indexOf join lastIndexOf map reduce reduceRight reverse slice some sort toReversed toSorted toSpliced with".split(" "),
);
const NUMBER_METHODS = new Set(["toExponential", "toFixed", "toPrecision", "toString"]);
const REGEXP_METHODS = new Set(["exec", "test"]);

const freeze = (entries: Record<string, unknown>) => Object.freeze({ ...entries });
const MATH = freeze(Object.fromEntries(
  Object.getOwnPropertyNames(Math).filter((key) => key !== "random")
    .map((key) => [key, (Math as unknown as Record<string, unknown>)[key]]),
));
const JSON_NS = freeze({ parse: JSON.parse, stringify: JSON.stringify });
const OBJECT_NS = freeze(Object.fromEntries(
  "entries fromEntries hasOwn is keys values".split(" ")
    .map((key) => [key, (Object as unknown as Record<string, unknown>)[key]]),
));
const NUMBER_NS = freeze(Object.fromEntries(
  "EPSILON MAX_SAFE_INTEGER MAX_VALUE MIN_SAFE_INTEGER MIN_VALUE NEGATIVE_INFINITY NaN POSITIVE_INFINITY isFinite isInteger isNaN isSafeInteger parseFloat parseInt".split(" ")
    .map((key) => [key, (Number as unknown as Record<string, unknown>)[key]]),
));
// Array.from and Array.of are builtins, not raw natives: an array-like length
// is capped before any loop sees it, so Array.from({ length: 1e9 }) fails fast.
const ARRAY_NS = freeze({
  from: builtin("Array.from", (ctx, args) => {
    const source = args[0];
    const mapper = args[1];
    const out: unknown[] = [];
    const push = (item: unknown): void => {
      step(ctx);
      out.push(mapper === undefined ? item : callValue(ctx, mapper, [item, out.length]));
      if (out.length > MAX_ARRAY) throw forbidden("array exceeds the size limit");
    };
    if (typeof source === "string" || Array.isArray(source)) {
      if (source.length > MAX_ARRAY) throw forbidden("array exceeds the size limit");
      for (const item of source) push(item);
      return out;
    }
    if (typeof source === "object" && source !== null) {
      const raw = (source as { length?: unknown }).length;
      const length = typeof raw === "number" && Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : 0;
      if (length > MAX_ARRAY) throw forbidden("array exceeds the size limit");
      for (let index = 0; index < length; index++) push((source as Record<number, unknown>)[index]);
      return out;
    }
    throw forbidden("Array.from needs an iterable or array-like");
  }),
  isArray: builtin("Array.isArray", (_ctx, args) => Array.isArray(args[0])),
  of: builtin("Array.of", (_ctx, args) => {
    if (args.length > MAX_ARRAY) throw forbidden("array exceeds the size limit");
    return args.slice();
  }),
});
const EMPTY_NS = freeze({});
// Member reads on callable globals resolve through frozen namespaces only, so
// String.fromCharCode stays unreachable even when the name is built at run time.
const BUILTIN_NS: Record<string, Record<string, unknown>> = {
  Array: ARRAY_NS, Number: NUMBER_NS, Object: OBJECT_NS,
};

const isIndex = (key: string): boolean => /^(?:0|[1-9]\d*)$/.test(key) && Number(key) < 2 ** 32 - 1;

function builtin(name: string, call: (ctx: Ctx, args: unknown[]) => unknown): Builtin {
  return { kind: "builtin", name, call };
}
function guardResult(value: unknown): unknown {
  if (typeof value === "string" && value.length > MAX_STRING) throw forbidden("string result exceeds the size limit");
  if (Array.isArray(value) && value.length > MAX_ARRAY) throw forbidden("array result exceeds the size limit");
  return value;
}
// Method dispatch keeps a size guard between the model and native loops so a
// huge receiver (for example Array(2**32-1)) cannot spin outside the budget.
function method(name: string, receiver: unknown): Builtin {
  return builtin(name, (ctx, args) => {
    step(ctx);
    if (typeof receiver === "string" && (name === "repeat" || name === "padStart" || name === "padEnd")) {
      const fill = String(args[1] ?? " ");
      if ((Number(args[0]) || 0) * Math.max(1, fill.length) + receiver.length > MAX_STRING) {
        throw forbidden("string result exceeds the size limit");
      }
    }
    // Native regexp work is invisible to the step budget, so cap the scanned
    // text and charge its length as steps: bounded backtracking per call, and
    // bounded total text across calls.
    if (receiver instanceof RegExp) {
      const input = String(args[0] ?? "");
      if (input.length > MAX_REGEX_INPUT) throw forbidden("regex input exceeds the size limit");
      step(ctx, Math.max(1, input.length));
    }
    if (typeof receiver === "string" && args.some((arg) => arg instanceof RegExp)) {
      if (receiver.length > MAX_REGEX_INPUT) throw forbidden("regex input exceeds the size limit");
      step(ctx, Math.max(1, receiver.length));
    }
    const fn = (receiver as Record<string, unknown>)[name] as (...a: unknown[]) => unknown;
    const mapped = args.map((arg) => (isCallable(arg) ? (...a: unknown[]) => callValue(ctx, arg, a) : arg));
    try {
      return guardResult(fn.apply(receiver, mapped));
    } catch (error) {
      if (error instanceof Forbidden) throw error;
      throw forbidden(`${name} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
}
function getProperty(ctx: Ctx, object: unknown, key: unknown): unknown {
  step(ctx);
  const name = typeof key === "number" ? String(key) : key;
  if (typeof name !== "string") throw forbidden("member keys must be strings or numbers");
  const pick = (label: string, allowed: ReadonlySet<string>): Builtin => {
    if (!allowed.has(name)) throw forbidden(`property is not in the grammar: ${label}.${name}`);
    return method(name, object);
  };
  if (typeof object === "string") {
    if (name === "length") return object.length;
    if (isIndex(name)) return object[Number(name)];
    return pick("String", STRING_METHODS);
  }
  if (Array.isArray(object)) {
    if (object.length > MAX_ARRAY) throw forbidden("array exceeds the size limit");
    if (name === "length") return object.length;
    if (isIndex(name)) return object[Number(name)];
    return pick("Array", ARRAY_METHODS);
  }
  if (typeof object === "number") return pick("Number", NUMBER_METHODS);
  if (object instanceof RegExp) return pick("RegExp", REGEXP_METHODS);
  if (isCallable(object)) {
    const ns = object.kind === "builtin" ? BUILTIN_NS[object.name] ?? EMPTY_NS : EMPTY_NS;
    if (Object.hasOwn(ns, name)) return (ns as Record<string, unknown>)[name];
    throw forbidden(`property is not in the grammar: ${name}`);
  }
  if (typeof object === "object" && object !== null) {
    if (Object.hasOwn(object, name)) return (object as Record<string, unknown>)[name];
    throw forbidden(`property is not in the grammar: ${name}`);
  }
  throw forbidden(`property is not reachable on this value: ${name}`);
}

class ShortCircuit extends Error {
  override name = "ShortCircuit";
}
const shortCircuit = () => new ShortCircuit();

function checkRegex(source: string, flags: string): RegExp {
  if (source.length > MAX_REGEX_SOURCE) throw forbidden("regex source exceeds the size limit");
  if (!/^[dgimsuvy]*$/.test(flags)) throw forbidden(`regex flag is not in the grammar: ${flags}`);
  const stripped = source.replace(/\\./g, "..").replace(/\[[^\]]*\]/g, "[]");
  if (/\\[1-9]/.test(source) || /\(\?/.test(stripped) || /\)[+*?{]/.test(stripped)) {
    throw forbidden("regex is outside the safe subset");
  }
  // The step budget does not reach inside a native regexp, so bound the
  // backtracking surface instead: runs of adjacent variable-quantifier atoms
  // (.*.*.*x is polynomial, a?a?a?... is exponential) and the total number of
  // variable quantifiers stay small, and exec/test inputs are capped below.
  let run = 0;
  let quantifiers = 0;
  for (let index = 0; index < stripped.length; index++) {
    const char = stripped[index]!;
    if (char === "(" || char === ")" || char === "|") { run = 0; continue; }
    let next = index + 1;
    const mark = stripped[next];
    if (mark === "*" || mark === "+" || mark === "?") { quantifiers += 1; run += 1; next += 1; }
    else if (mark === "{") {
      const close = stripped.indexOf("}", next);
      const inner = close === -1 ? "" : stripped.slice(next + 1, close);
      if (/^\d+$/.test(inner)) run = 0;
      else { quantifiers += 1; run += 1; }
      next = close === -1 ? next : close + 1;
    } else run = 0;
    if (run > MAX_REGEX_RUN || quantifiers > MAX_REGEX_QUANTIFIERS) {
      throw forbidden("regex is outside the safe subset");
    }
    index = next - 1;
  }
  try {
    return new RegExp(source, flags);
  } catch (error) {
    throw forbidden(`invalid regex: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const INSTANCEOF: Record<string, (value: unknown) => boolean> = {
  Array: Array.isArray, RegExp: (value) => value instanceof RegExp,
  String: (value) => typeof value === "string", Number: (value) => typeof value === "number",
  Boolean: (value) => typeof value === "boolean", BigInt: (value) => typeof value === "bigint",
  Symbol: (value) => typeof value === "symbol",
};

const GLOBAL_SCOPE = new Scope();
{
  const coerce = (fn: (arg?: unknown) => unknown) => (_ctx: Ctx, args: unknown[]) => (args.length ? fn(args[0]) : fn());
  const globals: Record<string, unknown> = {
    Infinity, NaN, undefined, Math: MATH, JSON: JSON_NS, Object: OBJECT_NS,
    Number: builtin("Number", coerce(Number)), String: builtin("String", coerce(String)),
    Boolean: builtin("Boolean", coerce(Boolean)),
    BigInt: builtin("BigInt", (_ctx, args) => BigInt(args[0] as never)),
    Symbol: builtin("Symbol", (_ctx, args) => Symbol(args[0] as string | undefined)),
    Array: builtin("Array", (_ctx, args) => {
      if (args.length === 1 && typeof args[0] === "number" && args[0] > MAX_ARRAY) {
        throw forbidden("array exceeds the size limit");
      }
      return Array(...(args as number[]));
    }),
    RegExp: builtin("RegExp", (_ctx, args) => checkRegex(String(args[0] ?? ""), String(args[1] ?? ""))),
    parseInt: builtin("parseInt", (_ctx, args) => Number.parseInt(String(args[0]), args[1] as number | undefined)),
    parseFloat: builtin("parseFloat", (_ctx, args) => Number.parseFloat(String(args[0]))),
    isNaN: builtin("isNaN", (_ctx, args) => Number.isNaN(Number(args[0]))),
    isFinite: builtin("isFinite", (_ctx, args) => Number.isFinite(Number(args[0]))),
    decodeURIComponent: builtin("decodeURIComponent", (_ctx, args) => decodeURIComponent(String(args[0]))),
    encodeURIComponent: builtin("encodeURIComponent", (_ctx, args) => encodeURIComponent(String(args[0]))),
  };
  for (const [name, value] of Object.entries(globals)) GLOBAL_SCOPE.set(name, value);
}

// arithmetic, comparison, and bitwise share one table; logical, in, and
// instanceof get dedicated handling below.
const BINARY: Record<string, (left: never, right: never) => unknown> = {
  "+": (left, right) => left + right, "-": (left, right) => left - right,
  "*": (left, right) => left * right, "/": (left, right) => left / right,
  "%": (left, right) => left % right, "**": (left, right) => left ** right,
  "===": (left, right) => left === right, "!==": (left, right) => left !== right,
  "==": (left, right) => left == right, "!=": (left, right) => left != right,
  "<": (left, right) => left < right, "<=": (left, right) => left <= right,
  ">": (left, right) => left > right, ">=": (left, right) => left >= right,
  "&": (left, right) => left & right, "|": (left, right) => left | right,
  "^": (left, right) => left ^ right, "<<": (left, right) => left << right,
  ">>": (left, right) => left >> right, ">>>": (left, right) => left >>> right,
};

function evalMembers(ctx: Ctx, scope: Scope, node: Ast): [unknown, unknown] {
  const object = evaluate(ctx, scope, node.object as Ast);
  if ((object === null || object === undefined) && node.optional) throw shortCircuit();
  let key: unknown;
  if (node.computed) key = evaluate(ctx, scope, node.property as Ast);
  else {
    const property = node.property as Ast;
    key = property.type === "Identifier" ? property.name : (property.value as unknown);
  }
  return [object, key];
}

function callValue(ctx: Ctx, callee: unknown, args: unknown[]): unknown {
  step(ctx);
  if (!isCallable(callee)) {
    if (typeof callee === "function") {
      try {
        return guardResult((callee as (...a: unknown[]) => unknown)(...args));
      } catch (error) {
        if (error instanceof Forbidden) throw error;
        throw forbidden(`call failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    throw forbidden("only grammar functions can be called");
  }
  if (callee.kind === "builtin") return callee.call(ctx, args);
  const inner = new Scope(callee.scope);
  callee.params.forEach((name, index) => inner.set(name, args[index]));
  if (callee.bodyIsExpression) return evaluate(ctx, inner, callee.body);
  const ret = (callee.body.body as Ast[])[0]?.argument as Ast | undefined;
  return ret ? evaluate(ctx, inner, ret) : undefined;
}

function spreadItems(ctx: Ctx, scope: Scope, nodes: readonly (Ast | null)[], into: unknown[]): void {
  for (const node of nodes) {
    if (!node) { into.length += 1; continue; }
    const value = node.type === "SpreadElement"
      ? evaluate(ctx, scope, node.argument as Ast)
      : undefined;
    if (node.type !== "SpreadElement") into.push(evaluate(ctx, scope, node));
    else if (typeof value === "string") into.push(...value);
    else if (Array.isArray(value)) into.push(...value);
    else throw forbidden("spread needs a string or array");
    if (into.length > MAX_ARRAY) throw forbidden("array exceeds the size limit");
  }
}

function evaluate(ctx: Ctx, scope: Scope, node: Ast): unknown {
  step(ctx);
  try {
    switch (node.type) {
      case "Literal": {
        if (node.regex) {
          const regex = node.regex as { pattern: string; flags: string };
          return checkRegex(regex.pattern, regex.flags);
        }
        if (typeof node.bigint === "string") return BigInt(node.bigint);
        return node.value;
      }
      case "Identifier":
        return scope.get(node.name as string);
      case "TemplateLiteral": {
        let text = "";
        const quasis = node.quasis as Ast[];
        const expressions = node.expressions as Ast[];
        for (let index = 0; index < quasis.length; index++) {
          text += String((quasis[index]!.value as { cooked?: string }).cooked ?? "");
          if (index < expressions.length) {
            const part = evaluate(ctx, scope, expressions[index]!);
            if (typeof part === "symbol" || typeof part === "bigint" || isCallable(part)) {
              throw forbidden("template parts must be string data");
            }
            text += String(part);
            if (text.length > MAX_STRING) throw forbidden("template exceeds the size limit");
          }
        }
        return text;
      }
      case "UnaryExpression": {
        const value = evaluate(ctx, scope, node.argument as Ast);
        switch (node.operator) {
          case "-": return -(value as number);
          case "+": return +(value as number);
          case "!": return !value;
          case "~": return ~(value as number);
          case "typeof": return isCallable(value) || typeof value === "function" ? "function" : typeof value;
          case "void": return undefined;
          default: throw forbidden(`unary operator is not in the grammar: ${String(node.operator)}`);
        }
      }
      case "BinaryExpression":
      case "LogicalExpression": {
        const op = node.operator as string;
        if (op === "&&" || op === "||" || op === "??") {
          const left = evaluate(ctx, scope, node.left as Ast);
          const done = op === "&&" ? !left : op === "||" ? Boolean(left) : left !== null && left !== undefined;
          return done ? left : evaluate(ctx, scope, node.right as Ast);
        }
        const left = evaluate(ctx, scope, node.left as Ast);
        const right = evaluate(ctx, scope, node.right as Ast);
        if (op === "in") {
          if (typeof left !== "string" && typeof left !== "number") throw forbidden("in keys must be strings or numbers");
          if (Array.isArray(right)) return isIndex(String(left)) && Number(left) < right.length;
          if (typeof right === "object" && right !== null && !isCallable(right) && !(right instanceof RegExp)) {
            return Object.hasOwn(right, String(left));
          }
          throw forbidden("in needs an object on the right");
        }
        if (op === "instanceof") {
          if (right === OBJECT_NS) return typeof left === "object" && left !== null;
          const test = isCallable(right) && right.kind === "builtin" ? INSTANCEOF[right.name] : undefined;
          if (test) return test(left);
          throw forbidden("instanceof needs a grammar constructor on the right");
        }
        const operation = BINARY[op];
        if (!operation) throw forbidden(`operator is not in the grammar: ${op}`);
        const result = operation(left as never, right as never);
        return op === "+" ? guardResult(result) : result;
      }
      case "ConditionalExpression":
        return evaluate(ctx, scope, node.test as Ast)
          ? evaluate(ctx, scope, node.consequent as Ast)
          : evaluate(ctx, scope, node.alternate as Ast);
      case "MemberExpression": {
        const [object, key] = evalMembers(ctx, scope, node);
        if (object === null || object === undefined) throw forbidden("cannot read a property of null or undefined");
        return getProperty(ctx, object, key);
      }
      case "CallExpression": {
        const args: unknown[] = [];
        const calleeNode = node.callee as Ast;
        if (calleeNode.type === "MemberExpression") {
          const [object, key] = evalMembers(ctx, scope, calleeNode);
          if (object === null || object === undefined) throw forbidden("cannot call a member of null or undefined");
          spreadItems(ctx, scope, node.arguments as Ast[], args);
          return callValue(ctx, getProperty(ctx, object, key), args);
        }
        const callee = evaluate(ctx, scope, calleeNode);
        if ((callee === null || callee === undefined) && node.optional) throw shortCircuit();
        spreadItems(ctx, scope, node.arguments as Ast[], args);
        return callValue(ctx, callee, args);
      }
      case "ArrowFunctionExpression": {
        const params = (node.params as Ast[]).map((param) => param.name as string);
        const body = node.body as Ast;
        return { kind: "closure", params, body, bodyIsExpression: body.type !== "BlockStatement", scope } satisfies Closure;
      }
      case "ArrayExpression": {
        const items: unknown[] = [];
        spreadItems(ctx, scope, node.elements as (Ast | null)[], items);
        return items;
      }
      case "ObjectExpression": {
        const entries: [string, unknown][] = [];
        for (const property of node.properties as Ast[]) {
          if (property.type === "SpreadElement") {
            const spread = evaluate(ctx, scope, property.argument as Ast);
            if (typeof spread === "object" && spread !== null && !isCallable(spread) && !(spread instanceof RegExp)) {
              entries.push(...Object.entries(spread));
            }
            continue;
          }
          const key = property.computed
            ? String(evaluate(ctx, scope, property.key as Ast))
            : String((property.key as Ast).name ?? (property.key as Ast).value);
          entries.push([key, evaluate(ctx, scope, property.value as Ast)]);
        }
        return Object.fromEntries(entries);
      }
      case "ChainExpression":
        try {
          return evaluate(ctx, scope, node.expression as Ast);
        } catch (error) {
          if (error instanceof ShortCircuit) return undefined;
          throw error;
        }
      case "ParenthesizedExpression":
        return evaluate(ctx, scope, node.expression as Ast);
      default:
        throw forbidden(`syntax is not in the grammar: ${node.type}`);
    }
  } catch (error) {
    if (error instanceof Forbidden || error instanceof ShortCircuit) throw error;
    if (error instanceof RangeError) throw forbidden("expression nests too deeply");
    throw forbidden(error instanceof Error ? error.message : String(error));
  }
}

export function astDepth(root: Ast): number {
  let depth = 0;
  const stack: Array<{ node: unknown; level: number }> = [{ node: root, level: 1 }];
  while (stack.length) {
    const { node, level } = stack.pop()!;
    if (level > MAX_DEPTH) throw forbidden("expression nests too deeply");
    if (!node || typeof node !== "object") continue;
    depth = Math.max(depth, level);
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) {
        for (const item of value) if (item && typeof item === "object" && "type" in item) stack.push({ node: item, level: level + 1 });
      } else if (value && typeof value === "object" && "type" in value) stack.push({ node: value, level: level + 1 });
    }
  }
  return depth;
}

function assertJson(value: unknown, depth = 0): void {
  if (depth > MAX_DEPTH) throw forbidden("result nests too deeply");
  if (value === null || value === undefined) return;
  const type = typeof value;
  if (type === "string" || type === "number" || type === "boolean") return;
  if (Array.isArray(value)) {
    for (const item of value) assertJson(item, depth + 1);
    return;
  }
  if (type === "object" && !isCallable(value) && !(value instanceof RegExp)) {
    for (const item of Object.values(value)) assertJson(item, depth + 1);
    return;
  }
  throw forbidden("result is not JSON data");
}

export function interpret(expression: Ast, params: readonly string[], args: readonly unknown[]): unknown {
  astDepth(expression);
  const ctx: Ctx = { steps: STEP_BUDGET };
  const scope = new Scope(GLOBAL_SCOPE);
  params.forEach((name, index) => scope.set(name, args[index]));
  const result = evaluate(ctx, scope, expression);
  assertJson(result);
  if (typeof result === "string" && result.length > MAX_STRING) throw forbidden("result exceeds the size limit");
  if (result !== undefined && result !== null) {
    const serialized = JSON.stringify(result);
    if (serialized !== undefined && serialized.length > MAX_OUTPUT) throw forbidden("result exceeds the size limit");
  }
  return result;
}
