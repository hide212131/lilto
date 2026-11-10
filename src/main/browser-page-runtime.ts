/**
 * Fixed script injected into an isolated world (design 9). It is written as a normal
 * function so tsc checks it, then serialised with Function.prototype.toString().
 * It must stay self-contained: no imports, no closures over module scope.
 *
 * Every method returns plain JSON: `{ ok: true, ... }` or `{ ok: false, code, message }`.
 */
export const BROWSER_PAGE_WORLD_ID = 1001;

/* eslint-disable @typescript-eslint/no-explicit-any */
function installBrowserRuntime(): void {
  const g = globalThis as any;
  if (g.__liltoBrowser) return;

  const LIMITS = { nodes: 20000, depth: 64, bytes: 128 * 1024, treeText: 32 * 1024, deadlineMs: 1500, nameChars: 200, ttlMs: 60000 };
  const SKIP = new Set(["SCRIPT", "STYLE", "TEMPLATE", "NOSCRIPT", "HEAD", "META", "LINK", "TITLE", "BASE"]);
  const ACTIONABLE = new Set(["link", "button", "textbox", "searchbox", "checkbox", "radio", "combobox", "listbox", "spinbutton", "slider", "switch", "tab", "menuitem", "option", "menuitemcheckbox", "menuitemradio"]);
  const TEXT_INPUT_TYPES = new Set(["", "text", "search", "email", "url", "tel", "password", "number"]);
  const nonce = Math.random().toString(36).slice(2) + Date.now().toString(36);

  const ids = new WeakMap<Element, number>();
  let nextId = 1;
  let latest: { snapshotId: string; ownershipEpoch: number; documentEpoch: number; createdAt: number; refs: Map<string, { el: Element; fp: string }> } | null = null;

  const fail = (code: string, message: string) => ({ ok: false, code, message });
  const clip = (value: string, max: number) => (value.length > max ? value.slice(0, max) : value);
  const norm = (value: string | null | undefined) => (value || "").replace(/\s+/g, " ").trim();

  function idOf(el: Element): number {
    let id = ids.get(el);
    if (!id) {
      id = nextId++;
      ids.set(el, id);
    }
    return id;
  }

  function roleOf(el: Element): string {
    const explicit = norm(el.getAttribute("role")).split(" ")[0];
    if (explicit && explicit !== "presentation" && explicit !== "none") return explicit;
    const tag = el.tagName;
    if (tag === "A") return el.hasAttribute("href") ? "link" : "generic";
    if (tag === "BUTTON") return "button";
    if (tag === "INPUT") {
      const type = ((el as HTMLInputElement).type || "text").toLowerCase();
      if (type === "hidden") return "hidden";
      if (type === "checkbox") return "checkbox";
      if (type === "radio") return "radio";
      if (type === "submit" || type === "button" || type === "reset" || type === "image") return "button";
      if (type === "number") return "spinbutton";
      if (type === "range") return "slider";
      if (type === "search") return "searchbox";
      return "textbox";
    }
    if (tag === "TEXTAREA") return "textbox";
    if (tag === "SELECT") return (el as HTMLSelectElement).multiple || (el as HTMLSelectElement).size > 1 ? "listbox" : "combobox";
    if (tag === "OPTION") return "option";
    if (/^H[1-6]$/.test(tag)) return "heading";
    if (tag === "IMG") return "img";
    if (tag === "UL" || tag === "OL") return "list";
    if (tag === "LI") return "listitem";
    if (tag === "TABLE") return "table";
    if (tag === "NAV") return "navigation";
    if (tag === "MAIN") return "main";
    if (tag === "FORM") return "form";
    if (tag === "IFRAME" || tag === "FRAME") return "iframe";
    if (tag === "DIALOG") return "dialog";
    if (tag === "LABEL") return "generic";
    if ((el as HTMLElement).isContentEditable && el.getAttribute("contenteditable") !== null) return "textbox";
    return "generic";
  }

  function textOf(el: Element, depth = 0): string {
    if (depth > 8) return "";
    let out = "";
    for (const node of Array.from(el.childNodes)) {
      if (node.nodeType === 3) out += (node.nodeValue || "") + " ";
      else if (node.nodeType === 1) {
        const child = node as Element;
        if (!SKIP.has(child.tagName) && !isHiddenSelf(child)) out += textOf(child, depth + 1) + " ";
      }
    }
    return norm(out);
  }

  function labelledBy(el: Element, seen: Set<Element>): string {
    const attr = el.getAttribute("aria-labelledby");
    if (!attr) return "";
    const root = el.getRootNode() as Document | ShadowRoot;
    const parts: string[] = [];
    for (const id of attr.split(/\s+/).slice(0, 8)) {
      const target = id ? root.getElementById?.(id) : null;
      if (target && !seen.has(target)) {
        seen.add(target);
        parts.push(nameOf(target, seen, true));
      }
    }
    return norm(parts.join(" "));
  }

  function nameOf(el: Element, seen: Set<Element> = new Set([el]), skipLabelledBy = false): string {
    if (!skipLabelledBy) {
      const byRef = labelledBy(el, seen);
      if (byRef) return clip(byRef, LIMITS.nameChars);
    }
    const aria = norm(el.getAttribute("aria-label"));
    if (aria) return clip(aria, LIMITS.nameChars);
    const tag = el.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
      const labels = Array.from((el as HTMLInputElement).labels || []);
      const fromLabels = norm(labels.slice(0, 4).map((label) => textOf(label)).join(" "));
      if (fromLabels) return clip(fromLabels, LIMITS.nameChars);
      const type = ((el as HTMLInputElement).type || "").toLowerCase();
      if (tag === "INPUT" && (type === "submit" || type === "button" || type === "reset")) {
        return clip(norm((el as HTMLInputElement).value) || (type === "submit" ? "Submit" : type === "reset" ? "Reset" : ""), LIMITS.nameChars);
      }
      return clip(norm(el.getAttribute("placeholder")) || norm(el.getAttribute("title")), LIMITS.nameChars);
    }
    if (tag === "IMG") return clip(norm(el.getAttribute("alt")) || norm(el.getAttribute("title")), LIMITS.nameChars);
    const role = roleOf(el);
    if (role === "button" || role === "link" || role === "heading" || role === "option" || role === "tab" || role === "menuitem" || role === "checkbox" || role === "radio") {
      const text = textOf(el);
      if (text) return clip(text, LIMITS.nameChars);
    }
    if (tag === "IFRAME") return clip(norm(el.getAttribute("title")) || norm(el.getAttribute("name")), LIMITS.nameChars);
    return clip(norm(el.getAttribute("title")), LIMITS.nameChars);
  }

  function isHiddenSelf(el: Element): boolean {
    if (el.hasAttribute("hidden") || el.getAttribute("aria-hidden") === "true" || (el as HTMLElement).inert) return true;
    const style = getComputedStyle(el);
    return style.display === "none";
  }

  function invisible(el: Element): boolean {
    const style = getComputedStyle(el);
    return style.visibility === "hidden" || style.visibility === "collapse";
  }

  function visibleBox(el: Element): boolean {
    if (!el.isConnected || isHiddenSelf(el) || invisible(el)) return false;
    for (let p: Element | null = el.parentElement; p; p = p.parentElement) {
      if (isHiddenSelf(p)) return false;
    }
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function fingerprint(el: Element): string {
    const tag = el.tagName;
    const type = tag === "INPUT" ? ((el as HTMLInputElement).type || "").toLowerCase() : "";
    const href = tag === "A" ? (el as HTMLAnchorElement).href || "" : "";
    return [roleOf(el), nameOf(el), tag, type, clip(href, 512)].join("\u0001");
  }

  function unsupported(el: Element): string | undefined {
    const tag = el.tagName;
    if (tag === "IFRAME" || tag === "FRAME") return "iframe";
    if (tag === "INPUT") {
      const type = ((el as HTMLInputElement).type || "text").toLowerCase();
      if (type === "file") return "file input";
      if (["date", "datetime-local", "month", "week", "time", "color"].includes(type)) return "input type " + type;
    }
    return undefined;
  }

  function statesOf(el: Element): any {
    const states: any = {};
    const anyEl = el as any;
    if (anyEl.disabled === true || el.getAttribute("aria-disabled") === "true") states.disabled = true;
    const ariaChecked = el.getAttribute("aria-checked");
    if (typeof anyEl.checked === "boolean" && (el.tagName === "INPUT")) states.checked = anyEl.checked;
    else if (ariaChecked === "true") states.checked = true;
    else if (ariaChecked === "mixed") states.checked = "mixed";
    else if (ariaChecked === "false") states.checked = false;
    const expanded = el.getAttribute("aria-expanded");
    if (expanded === "true") states.expanded = true;
    else if (expanded === "false") states.expanded = false;
    if (el.getAttribute("aria-selected") === "true" || (el.tagName === "OPTION" && anyEl.selected)) states.selected = true;
    if (anyEl.readOnly === true || el.getAttribute("aria-readonly") === "true") states.readonly = true;
    if (el.tagName === "INPUT" && ((el as HTMLInputElement).type || "").toLowerCase() === "password") states.password = true;
    return states;
  }

  function valueOf(el: Element): string | undefined {
    const tag = el.tagName;
    if (tag === "INPUT") {
      const type = ((el as HTMLInputElement).type || "text").toLowerCase();
      if (type === "password" || type === "hidden" || type === "file") return undefined;
      if (type === "checkbox" || type === "radio" || type === "submit" || type === "button" || type === "reset") return undefined;
      return clip((el as HTMLInputElement).value || "", 500);
    }
    if (tag === "TEXTAREA") return clip((el as HTMLTextAreaElement).value || "", 500);
    if (tag === "SELECT") return clip(Array.from((el as HTMLSelectElement).selectedOptions).map((o) => o.value).join(","), 500);
    return undefined;
  }

  function childrenOf(el: Element): Element[] {
    if (el.tagName === "SLOT") {
      const assigned = (el as HTMLSlotElement).assignedElements({ flatten: true });
      return assigned.length > 0 ? assigned : Array.from(el.children);
    }
    if ((el as any).shadowRoot) return Array.from((el as any).shadowRoot.children);
    return Array.from(el.children);
  }

  function snapshot(args: { snapshotId: string; ownershipEpoch: number; documentEpoch: number; maxNodes: number }): any {
    const started = Date.now();
    const refs = new Map<string, { el: Element; fp: string }>();
    const nodes: any[] = [];
    const lines: string[] = [];
    let visited = 0;
    let bytes = 0;
    let treeBytes = 0;
    let truncated = false;
    const stop = () => {
      truncated = true;
    };
    const mkRef = (el: Element) => "b" + args.ownershipEpoch + "-d" + args.documentEpoch + "-n" + idOf(el);

    const walk = (el: Element, depth: number, parentRef: string | null, indent: number): void => {
      if (truncated) return;
      if (visited >= LIMITS.nodes || depth > LIMITS.depth || Date.now() - started > LIMITS.deadlineMs) return stop();
      visited++;
      if (SKIP.has(el.tagName) || isHiddenSelf(el)) return;
      const role = roleOf(el);
      if (role === "hidden") return;
      let nextParent = parentRef;
      let nextIndent = indent;
      const hasRole = role !== "generic";
      const ownText = role === "generic" ? norm(Array.from(el.childNodes).filter((n) => n.nodeType === 3).map((n) => n.nodeValue || "").join(" ")) : "";
      const emit = !invisible(el) && (hasRole || ownText.length > 0);
      if (emit) {
        if (nodes.length >= args.maxNodes) return stop();
        const ref = mkRef(el);
        const name = role === "generic" ? "" : nameOf(el);
        const reason = unsupported(el);
        const states = statesOf(el);
        const value = valueOf(el);
        const node: any = {
          ref,
          parentRef,
          role: role === "generic" ? "text" : role,
          name,
          states,
          actionable: !reason && (ACTIONABLE.has(role) || (el as HTMLElement).isContentEditable === true && role === "textbox")
        };
        if (role === "generic") node.text = clip(ownText, 300);
        if (value !== undefined) node.value = value;
        if (reason) node.unsupportedReason = reason;
        const size = JSON.stringify(node).length;
        const line = "  ".repeat(indent) + node.role + (node.name ? ' "' + node.name.replace(/"/g, "'") + '"' : node.text ? ' "' + String(node.text).replace(/"/g, "'") + '"' : "") +
          (node.actionable ? " [ref=" + ref + "]" : "") +
          (reason ? " [unsupported: " + reason + "]" : "") +
          (states.disabled ? " [disabled]" : "") + (states.checked !== undefined ? " [checked=" + states.checked + "]" : "") + (states.password ? " [password]" : "") +
          (node.value ? ' value="' + String(node.value).replace(/"/g, "'") + '"' : "");
        if (bytes + size > LIMITS.bytes) return stop();
        if (treeBytes + line.length > LIMITS.treeText) return stop();
        bytes += size;
        treeBytes += line.length + 1;
        nodes.push(node);
        lines.push(line);
        refs.set(ref, { el, fp: fingerprint(el) });
        nextParent = ref;
        nextIndent = indent + 1;
      }
      if (unsupported(el) === "iframe") return;
      for (const child of childrenOf(el)) {
        walk(child, depth + 1, nextParent, nextIndent);
        if (truncated) return;
      }
    };

    const root = document.documentElement;
    if (root) walk(root, 0, null, 0);
    latest = { snapshotId: args.snapshotId, ownershipEpoch: args.ownershipEpoch, documentEpoch: args.documentEpoch, createdAt: Date.now(), refs };
    return {
      ok: true,
      snapshot: {
        format: "dom-v1",
        snapshotId: args.snapshotId,
        documentEpoch: args.documentEpoch,
        viewport: { width: window.innerWidth, height: window.innerHeight },
        nodes,
        text: lines.join("\n"),
        truncated,
        limitations: [
          "Not a full accessibility tree: names use a simplified accessible-name algorithm.",
          "iframe contents, closed shadow DOM and canvas contents are not inspected.",
          "Password and hidden input values are never returned."
        ]
      }
    };
  }

  function resolve(snapshotId: string, ref: string, strict: boolean): { el: Element } | { error: any } {
    if (!latest || latest.snapshotId !== snapshotId) return { error: fail("STALE_REF", "The snapshot is outdated; take a new snapshot") };
    if (Date.now() - latest.createdAt > LIMITS.ttlMs) return { error: fail("STALE_REF", "The snapshot expired; take a new snapshot") };
    const entry = latest.refs.get(ref);
    if (!entry) return { error: fail("STALE_REF", "Unknown ref for this snapshot") };
    if (strict) {
      if (!entry.el.isConnected) return { error: fail("STALE_REF", "The element was removed from the page") };
      if (fingerprint(entry.el) !== entry.fp) return { error: fail("STALE_REF", "The element changed; take a new snapshot") };
    }
    return { el: entry.el };
  }

  function deepActive(): Element | null {
    let active: Element | null = document.activeElement;
    while (active && (active as any).shadowRoot && (active as any).shadowRoot.activeElement) active = (active as any).shadowRoot.activeElement;
    return active;
  }

  function deepFromPoint(x: number, y: number): Element | null {
    let hit: Element | null = document.elementFromPoint(x, y);
    while (hit && (hit as any).shadowRoot) {
      const inner: Element | null = (hit as any).shadowRoot.elementFromPoint(x, y);
      if (!inner || inner === hit) break;
      hit = inner;
    }
    return hit;
  }

  function reaches(target: Element, hit: Element | null): boolean {
    for (let node: Node | null = hit; node; node = (node as any).parentNode || (node as any).host || null) {
      if (node === target) return true;
    }
    return false;
  }

  function frames(count: number): Promise<void> {
    return new Promise((resolveFrames) => {
      let remaining = count;
      const timer = setTimeout(() => resolveFrames(), 200 * count);
      const step = () => {
        remaining -= 1;
        if (remaining <= 0) {
          clearTimeout(timer);
          resolveFrames();
        } else requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  }

  function disabledNow(el: Element): boolean {
    return (el as any).disabled === true || el.getAttribute("aria-disabled") === "true";
  }

  async function prepareClick(args: { snapshotId: string; ref: string }): Promise<any> {
    const found = resolve(args.snapshotId, args.ref, true);
    if ("error" in found) return found.error;
    const el = found.el as HTMLElement;
    const reason = unsupported(el);
    if (reason) return fail("UNSUPPORTED_TARGET", reason + " is not supported");
    if (!visibleBox(el) || disabledNow(el)) return fail("ELEMENT_NOT_INTERACTABLE", "The element is hidden or disabled");
    el.scrollIntoView({ block: "center", inline: "center" });
    let rect = el.getBoundingClientRect();
    for (let i = 0; i < 6; i++) {
      await frames(2);
      const next = el.getBoundingClientRect();
      const stable = Math.abs(next.x - rect.x) < 0.5 && Math.abs(next.y - rect.y) < 0.5 && Math.abs(next.width - rect.width) < 0.5 && Math.abs(next.height - rect.height) < 0.5;
      rect = next;
      if (stable) break;
    }
    if (!el.isConnected || fingerprint(el) !== latest!.refs.get(args.ref)!.fp) return fail("STALE_REF", "The element changed while preparing the click");
    const fractions: Array<[number, number]> = [[0.5, 0.5], [0.25, 0.5], [0.75, 0.5], [0.5, 0.25], [0.5, 0.75]];
    for (const [fx, fy] of fractions) {
      const x = rect.left + rect.width * fx;
      const y = rect.top + rect.height * fy;
      if (x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight) continue;
      if (reaches(el, deepFromPoint(x, y))) return { ok: true, x, y };
    }
    return fail("ELEMENT_NOT_INTERACTABLE", "The element is covered by another element or outside the viewport");
  }

  function isTextEditable(el: Element): "input" | "textarea" | "editable" | null {
    if (el.tagName === "INPUT") return TEXT_INPUT_TYPES.has(((el as HTMLInputElement).type || "text").toLowerCase()) ? "input" : null;
    if (el.tagName === "TEXTAREA") return "textarea";
    if ((el as HTMLElement).isContentEditable) return "editable";
    return null;
  }

  async function prepareFill(args: { snapshotId: string; ref: string }): Promise<any> {
    const found = resolve(args.snapshotId, args.ref, true);
    if ("error" in found) return found.error;
    const el = found.el as HTMLElement;
    const kind = isTextEditable(el);
    if (!kind) return fail("UNSUPPORTED_TARGET", "Only text inputs, textareas and simple contenteditable elements can be filled");
    if (!visibleBox(el) || disabledNow(el) || (el as HTMLInputElement).readOnly) return fail("ELEMENT_NOT_INTERACTABLE", "The element is hidden, disabled or read-only");
    el.scrollIntoView({ block: "center", inline: "center" });
    await frames(2);
    el.focus();
    if (kind === "editable") {
      const range = document.createRange();
      range.selectNodeContents(el);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    } else {
      (el as HTMLInputElement).select();
    }
    const active = deepActive();
    if (active !== el) return fail("ELEMENT_NOT_INTERACTABLE", "The element could not receive focus");
    return { ok: true, empty: kind === "editable" ? !(el.textContent || "") : !(el as HTMLInputElement).value };
  }

  function verifyFill(args: { snapshotId: string; ref: string; text: string }): any {
    const found = resolve(args.snapshotId, args.ref, false);
    if ("error" in found) return found.error;
    const el = found.el as HTMLElement;
    const kind = isTextEditable(el);
    const actual = kind === "editable" ? (el.innerText ?? el.textContent ?? "") : (el as HTMLInputElement).value;
    const expected = args.text;
    const same = kind === "editable" ? actual.replace(/\n+$/g, "") === expected : actual === expected;
    return { ok: true, matches: same, focused: deepActive() === el };
  }

  function selectOptions(args: { snapshotId: string; ref: string; values: string[] }): any {
    const found = resolve(args.snapshotId, args.ref, true);
    if ("error" in found) return found.error;
    const el = found.el as HTMLSelectElement;
    if (el.tagName !== "SELECT") return fail("UNSUPPORTED_TARGET", "Only native <select> elements are supported");
    if (!visibleBox(el) || el.disabled) return fail("ELEMENT_NOT_INTERACTABLE", "The select is hidden or disabled");
    const wanted = new Set(args.values);
    if (!el.multiple && wanted.size !== 1) return fail("ELEMENT_NOT_INTERACTABLE", "A single-select needs exactly one value");
    const options = Array.from(el.options);
    for (const value of wanted) {
      const option = options.find((o) => o.value === value);
      if (!option || option.disabled) return fail("ELEMENT_NOT_INTERACTABLE", "Option not found or disabled: " + clip(value, 80));
    }
    for (const option of options) option.selected = wanted.has(option.value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return { ok: true, selectedValues: Array.from(el.selectedOptions).map((o) => o.value) };
  }

  async function prepareFocus(args: { snapshotId: string; ref: string }): Promise<any> {
    const found = resolve(args.snapshotId, args.ref, true);
    if ("error" in found) return found.error;
    const el = found.el as HTMLElement;
    const reason = unsupported(el);
    if (reason) return fail("UNSUPPORTED_TARGET", reason + " is not supported");
    if (!visibleBox(el) || disabledNow(el)) return fail("ELEMENT_NOT_INTERACTABLE", "The element is hidden or disabled");
    el.scrollIntoView({ block: "center", inline: "center" });
    await frames(2);
    el.focus();
    if (deepActive() !== el) return fail("ELEMENT_NOT_INTERACTABLE", "The element could not receive focus");
    return { ok: true };
  }

  function scroll(args: { snapshotId?: string; ref?: string; deltaX: number; deltaY: number }): any {
    if (args.ref !== undefined && args.snapshotId !== undefined) {
      const found = resolve(args.snapshotId, args.ref, true);
      if ("error" in found) return found.error;
      const el = found.el as HTMLElement;
      if (!visibleBox(el)) return fail("ELEMENT_NOT_INTERACTABLE", "The element is hidden");
      el.scrollBy({ left: args.deltaX, top: args.deltaY, behavior: "instant" as ScrollBehavior });
      return { ok: true, scrollX: Math.round(el.scrollLeft), scrollY: Math.round(el.scrollTop) };
    }
    window.scrollBy({ left: args.deltaX, top: args.deltaY, behavior: "instant" as ScrollBehavior });
    return { ok: true, scrollX: Math.round(window.scrollX), scrollY: Math.round(window.scrollY) };
  }

  function getText(args: { snapshotId?: string; ref?: string; maxChars: number }): any {
    let text: string;
    if (args.ref !== undefined && args.snapshotId !== undefined) {
      const found = resolve(args.snapshotId, args.ref, true);
      if ("error" in found) return found.error;
      const el = found.el as HTMLElement;
      text = el.tagName === "INPUT" || el.tagName === "TEXTAREA" ? (valueOf(el) ?? "") : el.innerText || el.textContent || "";
    } else {
      text = document.body ? document.body.innerText || "" : "";
    }
    const truncated = text.length > args.maxChars;
    return { ok: true, text: truncated ? text.slice(0, args.maxChars) : text, truncated };
  }

  function checkRef(args: { snapshotId: string; ref: string; state: "visible" | "hidden" | "enabled" }): any {
    const found = resolve(args.snapshotId, args.ref, false);
    if ("error" in found) return found.error;
    const el = found.el;
    if (args.state === "hidden") return { ok: true, matched: !el.isConnected || !visibleBox(el) };
    if (!el.isConnected) return { ok: true, matched: false };
    if (args.state === "visible") return { ok: true, matched: visibleBox(el) };
    return { ok: true, matched: visibleBox(el) && !disabledNow(el) };
  }

  function hasText(args: { text: string }): any {
    const body = document.body ? document.body.innerText || "" : "";
    return { ok: true, present: body.includes(args.text) };
  }

  function viewport(): any {
    return { ok: true, width: window.innerWidth, height: window.innerHeight, readyState: document.readyState, nonce };
  }

  g.__liltoBrowser = { snapshot, prepareClick, prepareFill, verifyFill, selectOptions, prepareFocus, scroll, getText, checkRef, hasText, viewport, nonce };
}

/** Source for `executeJavaScriptInIsolatedWorld`: installs once, then calls a method. */
export function buildRuntimeCall(method: string, args: unknown): string {
  const install = `(${installBrowserRuntime.toString()})();`;
  return `${install}\nglobalThis.__liltoBrowser[${JSON.stringify(method)}](${JSON.stringify(args ?? {})});`;
}

export const BROWSER_RUNTIME_METHODS = ["snapshot", "prepareClick", "prepareFill", "verifyFill", "selectOptions", "prepareFocus", "scroll", "getText", "checkRef", "hasText", "viewport"] as const;
export type BrowserRuntimeMethod = (typeof BROWSER_RUNTIME_METHODS)[number];
