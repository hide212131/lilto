import vm from "node:vm";

import { BROWSER_LIMITS as L, BrowserError, type BrowserEvaluateResult, type BrowserJsonValue } from "../shared/browser";

/**
 * Pure helpers for browser_evaluate (no Electron import: the MCP child and unit tests load this).
 *
 * The page-side program is ONE self-contained expression whose Promise resolves to a string
 * (a JSON envelope). Nothing but a string crosses the process boundary, so no structured-clone
 * behaviour of arbitrary page objects is part of the public contract.
 */

const MESSAGE_MAX = L.evaluateMessageMaxChars;

export type EvaluateEnvelope =
  | { kind: "guard" } // the document token did not match: the script did NOT run
  | { kind: "undefined" }
  | { kind: "ok"; json: string }
  | { kind: "throw"; message: string }
  | { kind: "result-error"; code: "RESULT_NOT_SERIALIZABLE" | "RESULT_TOO_LARGE"; message: string };

/**
 * Compile-only syntax check with the same semantics the page uses (AsyncFunction constructor:
 * the body is parsed on its own, so a script cannot break out of the wrapper). Never runs the script.
 */
export function checkScriptSyntax(script: string): void {
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (body: string) => unknown;
  try {
    // Constructing (not calling) the function only parses it.
    new AsyncFunction(script);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "syntax error";
    throw new BrowserError("SCRIPT_SYNTAX_ERROR", `The script has a syntax error: ${detail}`.slice(0, MESSAGE_MAX), { effect: "none", retryable: false });
  }
}

/** Source that installs / reads the per-document token. Runs only Main-authored code. */
export function buildTokenProgram(key: string, fresh: string): string {
  return `(function(){var k=${JSON.stringify(key)};try{if(!Object.prototype.hasOwnProperty.call(window,k)){Object.defineProperty(window,k,{value:${JSON.stringify(fresh)},enumerable:false,configurable:false,writable:false});}return String(window[k]);}catch(e){return "";}})()`;
}

const SERIALIZER = `
function __ser(v){
  var MAXD=${L.evaluateMaxDepth},MAXV=${L.evaluateMaxValues},MAXB=${L.evaluateResultMaxBytes};
  var stringify=JSON.stringify,isArray=Array.isArray,getProto=Object.getPrototypeOf,ownKeys=Reflect.ownKeys,getDesc=Object.getOwnPropertyDescriptor,isFinite_=Number.isFinite,hasOwn=Object.prototype.hasOwnProperty;
  var enc=new TextEncoder();
  var count=0,bytes=0,out=[],stack=[];
  var AP=Array.prototype,OP=Object.prototype;
  function fail(code,msg){throw {__lilto:1,code:code,msg:msg};}
  function add(s){
    if(s.length>MAXB)fail("RESULT_TOO_LARGE","The result is larger than 64 KiB");
    bytes+=enc.encode(s).length;
    if(bytes>MAXB)fail("RESULT_TOO_LARGE","The result is larger than 64 KiB");
    out.push(s);
  }
  function walk(x,depth){
    count++;
    if(count>MAXV)fail("RESULT_TOO_LARGE","The result has too many values");
    if(x===null){add("null");return;}
    switch(typeof x){
      case "boolean":add(x?"true":"false");return;
      case "number":if(!isFinite_(x))fail("RESULT_NOT_SERIALIZABLE","NaN and Infinity are not allowed");add(stringify(x));return;
      case "string":add(stringify(x));return;
      case "undefined":fail("RESULT_NOT_SERIALIZABLE","A nested undefined is not allowed");
      case "object":break;
      default:fail("RESULT_NOT_SERIALIZABLE","Values of type "+typeof x+" are not allowed");
    }
    if(depth>=MAXD)fail("RESULT_TOO_LARGE","The result is nested deeper than "+MAXD);
    for(var i=0;i<stack.length;i++)if(stack[i]===x)fail("RESULT_NOT_SERIALIZABLE","Circular references are not allowed");
    stack.push(x);
    if(isArray(x)){
      if(getProto(x)!==AP)fail("RESULT_NOT_SERIALIZABLE","Only plain arrays are allowed");
      var keys=ownKeys(x);
      if(keys.length!==x.length+1)fail("RESULT_NOT_SERIALIZABLE","Sparse arrays and extra array properties are not allowed");
      add("[");
      for(var j=0;j<x.length;j++){
        if(!hasOwn.call(x,j))fail("RESULT_NOT_SERIALIZABLE","Sparse arrays are not allowed");
        var d=getDesc(x,j);
        if(!d||!("value" in d))fail("RESULT_NOT_SERIALIZABLE","Accessor properties are not allowed");
        if(j>0)add(",");
        walk(d.value,depth+1);
      }
      add("]");
    }else{
      var proto=getProto(x);
      if(proto!==OP&&proto!==null)fail("RESULT_NOT_SERIALIZABLE","Only plain objects are allowed (convert DOM nodes, Date, Map, Error, ... explicitly)");
      var ks=ownKeys(x);
      add("{");
      for(var n=0;n<ks.length;n++){
        var key=ks[n];
        if(typeof key!=="string")fail("RESULT_NOT_SERIALIZABLE","Symbol keys are not allowed");
        var pd=getDesc(x,key);
        if(!pd||!("value" in pd))fail("RESULT_NOT_SERIALIZABLE","Accessor properties are not allowed");
        if(!pd.enumerable)fail("RESULT_NOT_SERIALIZABLE","Non-enumerable properties are not allowed");
        if(n>0)add(",");
        add(stringify(key));add(":");
        walk(pd.value,depth+1);
      }
      add("}");
    }
    stack.pop();
  }
  walk(v,0);
  return out.join("");
}
`;

/**
 * The program executed in the target frame. `script` must already have passed checkScriptSyntax
 * (so the wrapper below cannot be escaped). The token guard runs BEFORE any script code.
 */
export function buildEvaluateProgram(options: { script: string; key: string; token: string }): string {
  const { script, key, token } = options;
  return `(async function(){
var __stringify=JSON.stringify;
function __env(o){return __stringify(o);}
function __msg(e){
  try{
    if(e instanceof Error){return String(e.name)+": "+String(e.message);}
    return "A non-Error value was thrown";
  }catch(_){return "The script threw";}
}
try{
  if(!Object.prototype.hasOwnProperty.call(window,${JSON.stringify(key)})||window[${JSON.stringify(key)}]!==${JSON.stringify(token)})return __env({kind:"guard"});
}catch(_){return __env({kind:"guard"});}
${SERIALIZER}
var __value;
try{
  __value=await (async function(){
${script}
  })();
}catch(e){
  return __env({kind:"throw",message:__msg(e).slice(0,${MESSAGE_MAX})});
}
if(__value===undefined)return __env({kind:"undefined"});
try{
  return __env({kind:"ok",json:__ser(__value)});
}catch(e){
  if(e&&e.__lilto===1)return __env({kind:"result-error",code:e.code,message:String(e.msg).slice(0,${MESSAGE_MAX})});
  return __env({kind:"result-error",code:"RESULT_NOT_SERIALIZABLE",message:"The value could not be converted to JSON"});
}
})()`;
}

const ENVELOPE_MAX_CHARS = L.evaluateResultMaxBytes * 4 + 4096; // JSON-in-JSON escaping headroom

/** Re-validate whatever the page returned. Never trusts the shape or size. */
export function parseEnvelope(raw: unknown): EvaluateEnvelope {
  if (typeof raw !== "string" || raw.length > ENVELOPE_MAX_CHARS) {
    throw new BrowserError("RESULT_TOO_LARGE", "The page returned an invalid or oversized result", { effect: "possible" });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new BrowserError("RESULT_NOT_SERIALIZABLE", "The page returned an unreadable result", { effect: "possible" });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new BrowserError("RESULT_NOT_SERIALIZABLE", "The page returned an unexpected result", { effect: "possible" });
  }
  const record = parsed as Record<string, unknown>;
  switch (record.kind) {
    case "guard":
      return { kind: "guard" };
    case "undefined":
      return { kind: "undefined" };
    case "throw":
      return { kind: "throw", message: typeof record.message === "string" ? record.message.slice(0, MESSAGE_MAX) : "The script threw" };
    case "ok":
      if (typeof record.json !== "string") break;
      return { kind: "ok", json: record.json };
    case "result-error":
      if ((record.code === "RESULT_NOT_SERIALIZABLE" || record.code === "RESULT_TOO_LARGE") && typeof record.message === "string") {
        return { kind: "result-error", code: record.code, message: record.message.slice(0, MESSAGE_MAX) };
      }
      break;
    default:
      break;
  }
  throw new BrowserError("RESULT_NOT_SERIALIZABLE", "The page returned an unexpected result", { effect: "possible" });
}

/** Main-side verification of the JSON value text (size, JSON validity, depth, value count). */
export function parseJsonValue(json: string): BrowserJsonValue {
  if (Buffer.byteLength(json, "utf8") > L.evaluateResultMaxBytes) {
    throw new BrowserError("RESULT_TOO_LARGE", "The result is larger than 64 KiB", { effect: "possible" });
  }
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new BrowserError("RESULT_NOT_SERIALIZABLE", "The result is not valid JSON", { effect: "possible" });
  }
  let count = 0;
  const visit = (node: unknown, depth: number): void => {
    count += 1;
    if (count > L.evaluateMaxValues || depth > L.evaluateMaxDepth) {
      throw new BrowserError("RESULT_TOO_LARGE", "The result is too large or too deep", { effect: "possible" });
    }
    if (node === null || typeof node === "boolean" || typeof node === "string") return;
    if (typeof node === "number") {
      if (!Number.isFinite(node)) throw new BrowserError("RESULT_NOT_SERIALIZABLE", "Non-finite number", { effect: "possible" });
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) visit(item, depth + 1);
      return;
    }
    if (typeof node === "object") {
      for (const item of Object.values(node as Record<string, unknown>)) visit(item, depth + 1);
      return;
    }
    throw new BrowserError("RESULT_NOT_SERIALIZABLE", "Unsupported value", { effect: "possible" });
  };
  visit(value, 0);
  return value as BrowserJsonValue;
}

/** Envelope -> public result value, or the BrowserError describing what happened. */
export function envelopeToValue(envelope: EvaluateEnvelope): BrowserEvaluateResult["value"] {
  switch (envelope.kind) {
    case "undefined":
      return { type: "undefined" };
    case "ok":
      return { type: "json", value: parseJsonValue(envelope.json) };
    case "throw":
      throw new BrowserError("SCRIPT_EXECUTION_ERROR", envelope.message, { effect: "possible", retryable: false });
    case "result-error":
      throw new BrowserError(envelope.code, envelope.message, { effect: "possible", retryable: false });
    case "guard":
      throw new BrowserError("STALE_DOCUMENT", "The document changed before the script could run", { effect: "none" });
  }
}

/** Exposed for tests: compile-only check that a generated program is syntactically valid JS. */
export function compileOnly(source: string): void {
  new vm.Script(source);
}
