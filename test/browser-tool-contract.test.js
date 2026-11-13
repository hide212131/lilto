const test = require("node:test");
const assert = require("node:assert/strict");
const { BROWSER_TOOLS, listBrowserTools, validateToolArguments, isBrowserToolName } = require("../dist/main/browser-tool-contract.js");
const { parseBrowsableUrl } = require("../dist/shared/browser.js");

const L = "lease-1";
const REF = { leaseId: L, snapshotId: "s1", ref: "b1-d1-n1" };

const valid = {
  browser_status: [{}],
  browser_acquire: [{ url: "https://example.com" }, { url: "https://example.com", timeoutMs: 100 }, { url: "https://e.com", timeoutMs: 30000 }],
  browser_release: [{ leaseId: L }],
  browser_navigate: [{ leaseId: L, url: "https://example.com", waitUntil: "load" }],
  browser_back: [{ leaseId: L, timeoutMs: 5000 }],
  browser_forward: [{ leaseId: L }],
  browser_reload: [{ leaseId: L }],
  browser_snapshot: [{ leaseId: L }, { leaseId: L, maxNodes: 1 }, { leaseId: L, maxNodes: 2000 }],
  browser_click: [REF, { ...REF, button: "right", clickCount: 2 }],
  browser_fill: [{ ...REF, text: "" }, { ...REF, text: "あ".repeat(16384) }],
  browser_select: [{ ...REF, values: ["a"] }, { ...REF, values: Array(100).fill("x".repeat(1024)) }],
  browser_press: [{ ...REF, key: "Enter" }, { ...REF, key: "Tab", modifiers: ["Shift"] }, { ...REF, key: "Space", modifiers: [] }, { ...REF, key: "Enter", modifiers: ["Control"] }],
  browser_scroll: [{ leaseId: L, deltaY: -4000 }, { leaseId: L, deltaY: 4000, deltaX: 4000 }, { leaseId: L, snapshotId: "s", ref: "r", deltaY: 1 }],
  browser_get_text: [{ leaseId: L }, { leaseId: L, maxChars: 32768 }, { leaseId: L, snapshotId: "s", ref: "r" }],
  browser_screenshot: [{ leaseId: L }],
  browser_wait: [
    { leaseId: L, condition: { kind: "text", text: "ok", present: true } },
    { leaseId: L, condition: { kind: "url", url: "https://example.com/" } },
    { leaseId: L, condition: { kind: "ref", snapshotId: "s", ref: "r", state: "hidden" } },
    { leaseId: L, condition: { kind: "load", state: "load" } }
  ],
  browser_evaluate: [
    { leaseId: L, documentEpoch: 0, script: "return document.title;" },
    { leaseId: L, documentEpoch: Number.MAX_SAFE_INTEGER, script: "x", frameId: "f1", timeoutMs: 30000 },
    { leaseId: L, documentEpoch: 3, script: "a".repeat(16384), timeoutMs: 100 },
    { leaseId: L, documentEpoch: 3, script: "あ".repeat(5461) } // 16383 bytes
  ]
};

const invalid = {
  browser_status: [{ extra: 1 }, "x"],
  browser_acquire: [{}, { url: "" }, { url: "x".repeat(8193) }, { url: "https://a.b", timeoutMs: 99 }, { url: "https://a.b", timeoutMs: 30001 }, { url: "https://a.b", timeoutMs: 1.5 }, { url: "https://a.b", extra: true }],
  browser_release: [{}, { leaseId: "" }, { leaseId: "x".repeat(129) }],
  browser_navigate: [{ leaseId: L }, { leaseId: L, url: "u", waitUntil: "idle" }],
  browser_back: [{ leaseId: L, timeoutMs: 0 }],
  browser_forward: [{}],
  browser_reload: [{ leaseId: 1 }],
  browser_snapshot: [{ leaseId: L, maxNodes: 0 }, { leaseId: L, maxNodes: 2001 }],
  browser_click: [{ leaseId: L, ref: "r" }, { ...REF, button: "middle" }, { ...REF, clickCount: 3 }, { ...REF, selector: "a" }],
  browser_fill: [{ ...REF }, { ...REF, text: "x".repeat(16385) }, { ...REF, text: 1 }],
  browser_select: [{ ...REF, values: [] }, { ...REF, values: Array(101).fill("a") }, { ...REF, values: ["x".repeat(1025)] }],
  browser_press: [
    { ...REF, key: "F5" }, { ...REF, key: "a" }, { ...REF, key: "Enter", modifiers: ["Shift", "Shift"] },
    { ...REF, key: "Enter", modifiers: ["Shift", "Control", "Alt", "Meta", "Shift"] }, { ...REF, key: "Enter", modifiers: ["Super"] },
    { ...REF, key: "Tab", modifiers: ["Alt"] }, { ...REF, key: "Delete", modifiers: ["Shift"] }
  ],
  browser_scroll: [{ leaseId: L }, { leaseId: L, deltaY: 4001 }, { leaseId: L, deltaY: 1, snapshotId: "s" }, { leaseId: L, deltaY: 1, ref: "r" }, { leaseId: L, deltaY: 0.5 }],
  browser_get_text: [{ leaseId: L, maxChars: 0 }, { leaseId: L, maxChars: 32769 }, { leaseId: L, ref: "r" }],
  browser_screenshot: [{}],
  browser_wait: [
    { leaseId: L }, { leaseId: L, condition: { kind: "sleep" } }, { leaseId: L, condition: { kind: "text", text: "", present: true } },
    { leaseId: L, condition: { kind: "text", text: "x".repeat(2049), present: true } }, { leaseId: L, condition: { kind: "text", text: "a" } },
    { leaseId: L, condition: { kind: "ref", snapshotId: "s", ref: "r", state: "gone" } }, { leaseId: L, condition: { kind: "load", state: "networkidle" } },
    { leaseId: L, condition: { kind: "url", url: "u", extra: 1 } }
  ],
  browser_evaluate: [
    { leaseId: L, script: "1" }, // documentEpoch required
    { leaseId: L, documentEpoch: 1 }, // script required
    { documentEpoch: 1, script: "1" },
    { leaseId: L, documentEpoch: -1, script: "1" },
    { leaseId: L, documentEpoch: 1.5, script: "1" },
    { leaseId: L, documentEpoch: Number.MAX_SAFE_INTEGER + 1, script: "1" },
    { leaseId: L, documentEpoch: "1", script: "1" },
    { leaseId: L, documentEpoch: 1, script: "" },
    { leaseId: L, documentEpoch: 1, script: " \n\t " }, // blank
    { leaseId: L, documentEpoch: 1, script: "a".repeat(16385) },
    { leaseId: L, documentEpoch: 1, script: "あ".repeat(5462) }, // 16386 UTF-8 bytes
    { leaseId: L, documentEpoch: 1, script: "x", timeoutMs: 99 },
    { leaseId: L, documentEpoch: 1, script: "x", timeoutMs: 30001 },
    { leaseId: L, documentEpoch: 1, script: "x", frameId: "" },
    { leaseId: L, documentEpoch: 1, script: "x", frameId: "f".repeat(129) },
    { leaseId: L, documentEpoch: 1, script: "x", snapshotId: "s" },
    { leaseId: L, documentEpoch: 1, script: "x", ref: "r" },
    { leaseId: L, documentEpoch: 1, script: "x", selector: "a" },
    { leaseId: L, documentEpoch: 1, script: "x", readOnly: true },
    { leaseId: L, documentEpoch: 1, script: "x", userGesture: true }
  ]
};

test("全 tool が固定集合で、入出力スキーマと description を持つ", () => {
  assert.deepEqual(BROWSER_TOOLS.map((t) => t.name), Object.keys(valid));
  for (const tool of listBrowserTools()) {
    assert.equal(tool.inputSchema.additionalProperties, false);
    assert.ok(tool.description.length > 10);
    assert.equal(tool.outputSchema.oneOf.length, 2);
  }
  assert.equal(isBrowserToolName("browser_evaluate"), true);
  assert.equal(isBrowserToolName("browser_click"), true);
});

test("公開ツールは evaluate OFF で16、ON で17（設定ごとの期待集合を比較する）", () => {
  const base = Object.keys(valid).filter((name) => name !== "browser_evaluate");
  assert.equal(base.length, 16);
  assert.deepEqual(listBrowserTools().map((t) => t.name), base);
  assert.deepEqual(listBrowserTools({ evaluateEnabled: false }).map((t) => t.name), base);
  assert.deepEqual(listBrowserTools({ evaluateEnabled: true }).map((t) => t.name), [...base, "browser_evaluate"]);
  const evaluate = listBrowserTools({ evaluateEnabled: true }).find((t) => t.name === "browser_evaluate");
  assert.deepEqual(evaluate.inputSchema.required, ["leaseId", "documentEpoch", "script"]);
  assert.equal(evaluate.inputSchema.additionalProperties, false);
  assert.equal(evaluate.outputSchema.oneOf.length, 2);
  for (const needle of ["async function", "return", "await", "frameId", "64 KiB", "retry", "effect=possible", "untrusted", "trusted input", "NOT read-only"]) {
    assert.ok(evaluate.description.includes(needle), `description mentions ${needle}`);
  }
});

for (const [name, cases] of Object.entries(valid)) {
  test(`${name}: 正例と上限値を受理する`, () => {
    for (const args of cases) assert.equal(validateToolArguments(name, args).ok, true, JSON.stringify(args).slice(0, 80));
  });
}
for (const [name, cases] of Object.entries(invalid)) {
  test(`${name}: 不正例を拒否する`, () => {
    for (const args of cases) assert.equal(validateToolArguments(name, args).ok, false, JSON.stringify(args).slice(0, 80));
  });
}

test("任意 selector・座標・外部で開く・debugger は公開されない。任意 JS は browser_evaluate だけ", () => {
  const names = BROWSER_TOOLS.map((t) => t.name).join(" ");
  assert.doesNotMatch(names, /open_external|coordinate|selector|debugger|cdp/);
  for (const tool of BROWSER_TOOLS) {
    const props = Object.keys(tool.input.properties ?? {});
    for (const forbidden of ["selector", "x", "y", "path", "expression", "readOnly", "userGesture", "args"]) assert.ok(!props.includes(forbidden), `${tool.name}.${forbidden}`);
    if (tool.name !== "browser_evaluate") for (const forbidden of ["script", "documentEpoch", "frameId"]) assert.ok(!props.includes(forbidden), `${tool.name}.${forbidden}`);
  }
  assert.equal(BROWSER_TOOLS.filter((t) => "script" in (t.input.properties ?? {})).length, 1);
});

test("parseBrowsableUrl は http(s) のみ・認証情報なし・長さ上限", () => {
  assert.ok(parseBrowsableUrl("https://example.com/a?b=1"));
  assert.ok(parseBrowsableUrl("http://localhost:3000"));
  for (const bad of ["file:///etc/passwd", "javascript:alert(1)", "data:text/html,x", "blob:https://a/b", "about:blank", "https://u:p@example.com", "example.com", "", null, "https://a.b/" + "x".repeat(8200)]) {
    assert.equal(parseBrowsableUrl(bad), null, String(bad).slice(0, 40));
  }
});

test("tool state schema carries operationReady and windowMinimized; new error codes exist; no focus requirement is advertised (Issue #42)", () => {
  const { BROWSER_ERROR_CODES } = require("../dist/shared/browser.js");
  for (const code of ["PANEL_NOT_READY", "SYSTEM_LOCKED", "SYSTEM_SUSPENDED", "SCREENSHOT_UNAVAILABLE", "WINDOW_NOT_FOCUSED"]) assert.ok(BROWSER_ERROR_CODES.includes(code), code);
  const status = listBrowserTools({ evaluateEnabled: false }).find((t) => t.name === "browser_status");
  assert.match(status.description, /minimized, unfocused or covered/);
  assert.match(status.description, /operationReady/);
  const evaluateTool = listBrowserTools({ evaluateEnabled: true }).find((t) => t.name === "browser_evaluate");
  assert.doesNotMatch(evaluateTool.description, /window unfocused/);
  assert.match(evaluateTool.description, /minimized, unfocused or covered/);
});

test("Codex instructions: background operation is allowed, explicit refusals are respected, no WINDOW_NOT_FOCUSED rule remains", () => {
  const { resolveBrowserInstructionUpdate } = require("../dist/main/agent-sdk-config.js");
  for (const evaluateEnabled of [false, true]) {
    const { text } = resolveBrowserInstructionUpdate({ enabled: true, evaluateEnabled });
    assert.match(text, /minimized, unfocused or covered/);
    assert.match(text, /panelVisible=false alone is no reason to stop/);
    assert.match(text, /SYSTEM_\*/);
    assert.doesNotMatch(text, /WINDOW_NOT_FOCUSED/);
    // Codex truncates a developer item above ~4000 chars (it cuts the middle): the wrapped state text must stay below that.
    assert.ok(text.length + 50 <= 4000, `state text is ${text.length} chars`);
  }
});
