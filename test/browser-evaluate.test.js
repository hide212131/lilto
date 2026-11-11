const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const { checkScriptSyntax, buildEvaluateProgram, buildTokenProgram, parseEnvelope, envelopeToValue, parseJsonValue } = require("../dist/main/browser-evaluate.js");

const KEY = "__lilto_testkey";
const TOKEN = "tok-1";

/** A stand-in page world: window === global, token installed exactly like production does. */
function page(extra = {}) {
  const ctx = vm.createContext({ document: { title: "T" }, TextEncoder, console, ...extra });
  vm.runInContext("var window = globalThis;", ctx);
  assert.equal(vm.runInContext(buildTokenProgram(KEY, TOKEN), ctx), TOKEN);
  return ctx;
}

async function evaluate(script, ctx = page()) {
  checkScriptSyntax(script);
  const raw = await vm.runInContext(buildEvaluateProgram({ script, key: KEY, token: TOKEN }), ctx);
  return envelopeToValue(parseEnvelope(raw));
}
const fails = async (script, code, ctx) => {
  await assert.rejects(() => evaluate(script, ctx), (error) => {
    assert.equal(error.code, code, error.message);
    assert.equal(error.effect, "possible");
    assert.equal(error.retryable, false);
    return true;
  });
};

test("syntax check is compile-only: the script never runs, and it cannot break out of the function body", () => {
  globalThis.__ranInMain = false;
  checkScriptSyntax("globalThis.__ranInMain = true; return 1;");
  assert.equal(globalThis.__ranInMain, false);
  for (const bad of ["return (", "let x = ;", "await await", "}); globalThis.__ranInMain = true; (function(){", "})(); evil(); (function(){"]) {
    assert.throws(() => checkScriptSyntax(bad), (error) => error.code === "SCRIPT_SYNTAX_ERROR" && error.effect === "none" && error.retryable === false && error.message.length <= 300);
  }
  assert.equal(globalThis.__ranInMain, false);
  checkScriptSyntax("const x = await Promise.resolve(1); return x;"); // await + return are legal
  checkScriptSyntax("return 1; // trailing comment without newline");
});

test("function-body semantics: return / await work, the last expression is NOT returned, no return => undefined", async () => {
  assert.deepEqual(await evaluate("return document.title;"), { type: "json", value: "T" });
  assert.deepEqual(await evaluate("const v = await new Promise((r) => setTimeout(() => r(7), 5)); return v;", page({ setTimeout })), { type: "json", value: 7 });
  assert.deepEqual(await evaluate("1 + 1"), { type: "undefined" });
  assert.deepEqual(await evaluate("document.title = 'changed';"), { type: "undefined" });
  assert.deepEqual(await evaluate("return undefined;"), { type: "undefined" });
  assert.deepEqual(await evaluate("// only a comment"), { type: "undefined" });
});

test("script runs in the page's own world: page globals are readable and writable", async () => {
  const ctx = page({ pageFn: () => "from page" });
  vm.runInContext("var appState = { n: 1 };", ctx);
  assert.deepEqual(await evaluate("appState.n += 1; return [appState.n, pageFn()];", ctx), { type: "json", value: [2, "from page"] });
});

test("supported values: null/boolean/number/string/array/plain object/null-proto, incl. unicode and -0", async () => {
  assert.deepEqual(await evaluate("return null;"), { type: "json", value: null });
  assert.deepEqual(await evaluate("return [true, false, 1.5, -2, 0, 'あ😀', { a: [1, { b: null }] }];"), { type: "json", value: [true, false, 1.5, -2, 0, "あ😀", { a: [1, { b: null }] }] });
  assert.deepEqual(await evaluate("return Object.assign(Object.create(null), { k: 1 });"), { type: "json", value: { k: 1 } });
  assert.deepEqual(await evaluate("return Promise.resolve({ later: true });"), { type: "json", value: { later: true } });
  assert.deepEqual(await evaluate("return '\\u0000\\ud800';"), { type: "json", value: "\u0000\ud800" });
});

test("script exceptions and Promise rejections become SCRIPT_EXECUTION_ERROR (effect possible, no retry), without a stack", async () => {
  await fails("throw new TypeError('boom');", "SCRIPT_EXECUTION_ERROR");
  await fails("await Promise.reject(new Error('nope'));", "SCRIPT_EXECUTION_ERROR");
  await fails("throw { secret: 'x'.repeat(1000) };", "SCRIPT_EXECUTION_ERROR");
  await assert.rejects(() => evaluate("throw new Error('x'.repeat(5000));"), (error) => error.message.length <= 300 && !/\n\s+at /.test(error.message));
  await assert.rejects(() => evaluate("throw { toString() { return 'LEAK'; } };"), (error) => !error.message.includes("LEAK"));
});

test("an exception after a side effect still reports effect=possible (never 'nothing happened')", async () => {
  const ctx = page();
  await fails("document.title = 'sent'; throw new Error('late');", "SCRIPT_EXECUTION_ERROR", ctx);
  assert.equal(ctx.document.title, "sent");
});

test("not serializable: nested undefined, sparse arrays, function/symbol/bigint, NaN/Infinity, DOM-like, Date/Map/Set/Error/TypedArray, cycles, accessors, symbol keys", async () => {
  const bad = [
    "return { a: undefined };", "return [undefined];", "return [1,,2];", "const a = [1]; a.x = 1; return a;",
    "return () => 1;", "return Symbol('s');", "return 10n;", "return NaN;", "return -Infinity;",
    "return new Date();", "return new Map();", "return new Set();", "return new Error('e');", "return new Uint8Array(2);", "return /re/;",
    "return document;", "return window;", "return globalThis;",
    "const o = {}; o.self = o; return o;", "const a = []; a.push(a); return a;",
    "return { get a() { throw new Error('getter ran'); } };", "return Object.defineProperty({}, 'h', { value: 1, enumerable: false });",
    "return { [Symbol('k')]: 1 };", "class C { constructor() { this.a = 1; } } return new C();",
    "return { toJSON() { return 'custom'; } , a: () => 1 };"
  ];
  for (const script of bad) await fails(script, "RESULT_NOT_SERIALIZABLE");
  await fails("return Symbol('top');", "RESULT_NOT_SERIALIZABLE");
});

test("getter bodies are never invoked while serializing", async () => {
  const ctx = page();
  vm.runInContext("var calls = 0; var o = { get a() { calls += 1; return 1; } };", ctx);
  await fails("return o;", "RESULT_NOT_SERIALIZABLE", ctx);
  assert.equal(vm.runInContext("calls", ctx), 0);
});

test("limits: > 64 KiB UTF-8, depth > 32 and > 10,000 values are RESULT_TOO_LARGE (never truncated)", async () => {
  await fails("return 'a'.repeat(65536);", "RESULT_TOO_LARGE"); // 65538 bytes with quotes
  await fails("return 'あ'.repeat(21846);", "RESULT_TOO_LARGE"); // 3 bytes each
  await fails("return Array.from({ length: 10001 }, () => 1);", "RESULT_TOO_LARGE");
  await fails("let v = 1; for (let i = 0; i < 33; i++) v = [v]; return v;", "RESULT_TOO_LARGE");
  await fails("return 'x'.repeat(50_000_000);", "RESULT_TOO_LARGE");
  // boundaries that must pass
  assert.equal((await evaluate("return 'a'.repeat(65534);")).value.length, 65534); // exactly 65536 bytes
  assert.equal((await evaluate("let v = 1; for (let i = 0; i < 32; i++) v = [v]; return v;")).type, "json");
  assert.equal((await evaluate("return Array.from({ length: 9999 }, () => 1);")).value.length, 9999);
});

test("the page-side walk stops early: a huge structure is not fully generated before the size check", async () => {
  const ctx = page();
  const started = Date.now();
  await fails("return Array.from({ length: 9_000 }, (_, i) => 'x'.repeat(100) + i);", "RESULT_TOO_LARGE", ctx);
  assert.ok(Date.now() - started < 3000);
});

test("token guard: a document without the expected token never runs the script (effect none)", async () => {
  const fresh = vm.createContext({ document: { title: "NEW" }, TextEncoder });
  vm.runInContext("var window = globalThis; var ran = false;", fresh);
  const raw = await vm.runInContext(buildEvaluateProgram({ script: "ran = true; return 1;", key: KEY, token: TOKEN }), fresh);
  const envelope = parseEnvelope(raw);
  assert.equal(envelope.kind, "guard");
  assert.equal(vm.runInContext("ran", fresh), false);
  assert.throws(() => envelopeToValue(envelope), (error) => error.code === "STALE_DOCUMENT" && error.effect === "none");
  // a different token (document replaced by one with its own token) is rejected too
  const other = page();
  const raw2 = await vm.runInContext(buildEvaluateProgram({ script: "return 1;", key: KEY, token: "someone-else" }), other);
  assert.equal(parseEnvelope(raw2).kind, "guard");
});

test("token program installs once per document and is not writable/deletable by the page", () => {
  const ctx = vm.createContext({});
  vm.runInContext("var window = globalThis;", ctx);
  assert.equal(vm.runInContext(buildTokenProgram(KEY, "first"), ctx), "first");
  assert.equal(vm.runInContext(buildTokenProgram(KEY, "second"), ctx), "first");
  assert.equal(vm.runInContext(`(function(){ 'use strict'; try { delete window[${JSON.stringify(KEY)}]; } catch (e) {} try { window[${JSON.stringify(KEY)}] = 'x'; } catch (e) {} return window[${JSON.stringify(KEY)}]; })()`, ctx), "first");
  assert.equal(vm.runInContext(`Object.keys(window).includes(${JSON.stringify(KEY)})`, ctx), false, "non-enumerable");
});

test("Main re-validates the page's answer: oversized, non-JSON, wrong shape, oversized value text", () => {
  assert.throws(() => parseEnvelope(42), (e) => e.code === "RESULT_TOO_LARGE" && e.effect === "possible");
  assert.throws(() => parseEnvelope("x".repeat(400_000)), (e) => e.code === "RESULT_TOO_LARGE");
  assert.throws(() => parseEnvelope("{nope"), (e) => e.code === "RESULT_NOT_SERIALIZABLE" && e.effect === "possible");
  assert.throws(() => parseEnvelope("[1]"), (e) => e.code === "RESULT_NOT_SERIALIZABLE");
  assert.throws(() => parseEnvelope(JSON.stringify({ kind: "ok" })), (e) => e.code === "RESULT_NOT_SERIALIZABLE");
  assert.throws(() => parseEnvelope(JSON.stringify({ kind: "result-error", code: "INTERNAL_ERROR", message: "x" })), (e) => e.code === "RESULT_NOT_SERIALIZABLE");
  assert.throws(() => parseJsonValue(JSON.stringify("a".repeat(65535))), (e) => e.code === "RESULT_TOO_LARGE"); // 65537 bytes
  assert.throws(() => parseJsonValue(JSON.stringify("あ".repeat(21846))), (e) => e.code === "RESULT_TOO_LARGE");
  assert.throws(() => parseJsonValue("{"), (e) => e.code === "RESULT_NOT_SERIALIZABLE");
  assert.throws(() => parseJsonValue("[".repeat(40) + "]".repeat(40)), (e) => e.code === "RESULT_TOO_LARGE");
  assert.deepEqual(parseJsonValue('{"a":[1,"b",null]}'), { a: [1, "b", null] });
  assert.equal(parseEnvelope(JSON.stringify({ kind: "throw", message: "m".repeat(999) })).message.length, 300);
});

test("the generated program is only the guard + the wrapped script; script text appears once, inside the function body", () => {
  const program = buildEvaluateProgram({ script: "return 'MARKER';", key: KEY, token: TOKEN });
  assert.equal(program.split("MARKER").length - 1, 1);
  assert.ok(program.indexOf(KEY) < program.indexOf("MARKER"), "token guard comes before any script code");
});
