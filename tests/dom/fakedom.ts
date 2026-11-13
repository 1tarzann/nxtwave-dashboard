// A tiny DOM for node tests (no jsdom, no new dependency): enough for the dashboard's h() builder, sheets, buttons,
// toasts and focus. Inputs clean up values the way the HTML spec says (a date input keeps only a valid date, a
// one-line text input drops line breaks), so tests see what a browser would.
/* eslint-disable @typescript-eslint/no-explicit-any */

type Listener = (ev: any) => void;

export class FNode {
  parentNode: FElement | null = null;
  nodeType = 0;
  get parentElement(): FElement | null {
    return this.parentNode && !(this.parentNode instanceof FDocument) ? this.parentNode : null;
  }
  get isConnected(): boolean {
    let n: FNode | null = this;
    while (n && !(n instanceof FDocument)) n = n.parentNode;
    return n instanceof FDocument;
  }
  remove(): void {
    this.parentNode?.removeChild(this);
  }
  get textContent(): string {
    return "";
  }
  set textContent(_v: string) {}
}

export class FText extends FNode {
  constructor(public data: string) {
    super();
    this.nodeType = 3;
  }
  get textContent(): string {
    return this.data;
  }
  set textContent(v: string) {
    this.data = v;
  }
}

function makeClassList(el: FElement) {
  const get = () => (el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean);
  const set = (l: string[]) => el.setAttribute("class", l.join(" "));
  return {
    add: (...c: string[]) => set([...new Set([...get(), ...c])]),
    remove: (...c: string[]) => set(get().filter((x) => !c.includes(x))),
    toggle: (c: string, force?: boolean) => {
      const on = force ?? !get().includes(c);
      if (on) set([...new Set([...get(), c])]);
      else set(get().filter((x) => x !== c));
      return on;
    },
    contains: (c: string) => get().includes(c),
    get length() {
      return get().length;
    },
  };
}

// ── selectors ──────────────────────────────────────────────────────────────
interface Compound {
  tag?: string;
  id?: string;
  classes: string[];
  attrs: Array<{ name: string; op?: string; value?: string }>;
  not: string[];
}

function splitTop(s: string, ch: string): string[] {
  const out: string[] = [];
  let cur = "";
  let depth = 0;
  let quote: string | null = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      cur += c;
      if (c === "\\") {
        cur += s[++i];
        continue;
      }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    if (c === "[" || c === "(") depth++;
    if (c === "]" || c === ")") depth--;
    if (depth === 0 && (ch === " " ? /\s/.test(c) : c === ch)) {
      if (cur.trim()) out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function parseCompound(s: string): Compound {
  const c: Compound = { classes: [], attrs: [], not: [] };
  let i = 0;
  const ident = () => {
    let out = "";
    while (i < s.length && /[\w\-\\]/.test(s[i])) {
      if (s[i] === "\\") {
        out += s[i + 1];
        i += 2;
        continue;
      }
      out += s[i++];
    }
    return out;
  };
  if (/[a-zA-Z*]/.test(s[0])) c.tag = s[0] === "*" ? (i++, undefined) : ident().toLowerCase();
  while (i < s.length) {
    const ch = s[i];
    if (ch === "#") {
      i++;
      c.id = ident();
    } else if (ch === ".") {
      i++;
      c.classes.push(ident());
    } else if (s.startsWith(":not(", i)) {
      let depth = 0;
      const start = i + 5;
      let j = start;
      for (; j < s.length; j++) {
        if (s[j] === "(") depth++;
        else if (s[j] === ")") {
          if (depth === 0) break;
          depth--;
        }
      }
      c.not.push(s.slice(start, j));
      i = j + 1;
    } else if (ch === "[") {
      i++;
      const name = ident();
      let op: string | undefined;
      let value: string | undefined;
      if (s[i] !== "]") {
        op = s[i] === "=" ? "=" : s.slice(i, i + 2);
        i += op.length;
        const q = s[i];
        i++;
        value = "";
        while (s[i] !== q) {
          if (s[i] === "\\") {
            value += s[i + 1];
            i += 2;
            continue;
          }
          value += s[i++];
        }
        i++;
      }
      i++; // ]
      c.attrs.push({ name, op, value });
    } else throw new Error(`fake dom: can't parse selector “${s}” at ${i}`);
  }
  return c;
}

function matchCompound(el: FElement, c: Compound): boolean {
  if (c.tag && el.localName !== c.tag) return false;
  if (c.id !== undefined && el.getAttribute("id") !== c.id) return false;
  for (const k of c.classes) if (!el.classList.contains(k)) return false;
  for (const a of c.attrs) {
    const v = el.getAttribute(a.name);
    if (v === null) return false;
    if (a.op === "=" && v !== a.value) return false;
    if (a.op === "^=" && !v.startsWith(a.value ?? "")) return false;
    if (a.op === "*=" && !v.includes(a.value ?? "")) return false;
  }
  for (const n of c.not) if (matchesSelector(el, n)) return false;
  return true;
}

function matchesSelector(el: FElement, selector: string): boolean {
  return splitTop(selector, ",").some((complex) => {
    const parts = splitTop(complex, " ").map(parseCompound);
    if (!matchCompound(el, parts[parts.length - 1])) return false;
    let k = parts.length - 2;
    let n = el.parentElement;
    while (k >= 0 && n) {
      if (matchCompound(n, parts[k])) k--;
      n = n.parentElement;
    }
    return k < 0;
  });
}

// ── elements ───────────────────────────────────────────────────────────────
export class FElement extends FNode {
  attrs = new Map<string, string>();
  childNodes: FNode[] = [];
  listeners = new Map<string, Listener[]>();
  classList = makeClassList(this);
  style: any = {
    setProperty(this: any, k: string, v: string) {
      this[k] = v;
    },
    removeProperty(this: any, k: string) {
      delete this[k];
    },
  };
  onclick: Listener | null = null;
  scrolledIntoView = 0;
  constructor(public localName: string) {
    super();
    this.nodeType = 1;
  }
  get tagName(): string {
    return this.localName.toUpperCase();
  }
  getAttribute(k: string): string | null {
    return this.attrs.has(k) ? (this.attrs.get(k) as string) : null;
  }
  setAttribute(k: string, v: string): void {
    this.attrs.set(k, String(v));
  }
  removeAttribute(k: string): void {
    this.attrs.delete(k);
  }
  hasAttribute(k: string): boolean {
    return this.attrs.has(k);
  }
  get id(): string {
    return this.getAttribute("id") ?? "";
  }
  get className(): string {
    return this.getAttribute("class") ?? "";
  }
  get hidden(): boolean {
    return this.hasAttribute("hidden");
  }
  set hidden(v: boolean) {
    if (v) this.setAttribute("hidden", "");
    else this.removeAttribute("hidden");
  }
  get disabled(): boolean {
    return this.hasAttribute("disabled");
  }
  set disabled(v: boolean) {
    if (v) this.setAttribute("disabled", "");
    else this.removeAttribute("disabled");
  }
  get children(): FElement[] {
    return this.childNodes.filter((n): n is FElement => n instanceof FElement);
  }
  get firstChild(): FNode | null {
    return this.childNodes[0] ?? null;
  }
  get firstElementChild(): FElement | null {
    return this.children[0] ?? null;
  }
  get childElementCount(): number {
    return this.children.length;
  }
  get previousElementSibling(): FElement | null {
    const p = this.parentNode;
    if (!p) return null;
    const sibs = p.children;
    const i = sibs.indexOf(this);
    return i > 0 ? sibs[i - 1] : null;
  }
  private adopt(n: FNode | string): FNode {
    const node = typeof n === "string" ? new FText(n) : n;
    node.parentNode?.removeChild(node);
    node.parentNode = this;
    return node;
  }
  appendChild<T extends FNode>(n: T): T {
    this.childNodes.push(this.adopt(n));
    return n;
  }
  append(...nodes: Array<FNode | string>): void {
    for (const n of nodes) this.childNodes.push(this.adopt(n));
  }
  prepend(...nodes: Array<FNode | string>): void {
    const add = nodes.map((n) => this.adopt(n));
    this.childNodes.unshift(...add);
  }
  removeChild<T extends FNode>(n: T): T {
    const i = this.childNodes.indexOf(n);
    if (i !== -1) this.childNodes.splice(i, 1);
    n.parentNode = null;
    return n;
  }
  replaceWith(n: FNode): void {
    const p = this.parentNode;
    if (!p) return;
    const i = p.childNodes.indexOf(this);
    n.parentNode?.removeChild(n);
    n.parentNode = p;
    p.childNodes.splice(i, 1, n);
    this.parentNode = null;
  }
  replaceChildren(...nodes: Array<FNode | string>): void {
    for (const c of [...this.childNodes]) this.removeChild(c);
    this.append(...nodes);
  }
  get textContent(): string {
    return this.childNodes.map((c) => c.textContent).join("");
  }
  set textContent(v: string) {
    for (const c of [...this.childNodes]) this.removeChild(c);
    if (v !== "") this.append(new FText(v));
  }
  contains(n: FNode | null): boolean {
    let x: FNode | null = n;
    while (x) {
      if (x === this) return true;
      x = x.parentNode;
    }
    return false;
  }
  *descendants(): Generator<FElement> {
    for (const c of this.children) {
      yield c;
      yield* c.descendants();
    }
  }
  querySelectorAll(sel: string): FElement[] {
    return [...this.descendants()].filter((e) => matchesSelector(e, sel));
  }
  querySelector(sel: string): FElement | null {
    for (const e of this.descendants()) if (matchesSelector(e, sel)) return e;
    return null;
  }
  matches(sel: string): boolean {
    return matchesSelector(this, sel);
  }
  closest(sel: string): FElement | null {
    let n: FElement | null = this;
    while (n) {
      if (n.matches(sel)) return n;
      n = n.parentElement;
    }
    return null;
  }
  addEventListener(type: string, fn: Listener): void {
    const l = this.listeners.get(type) ?? [];
    l.push(fn);
    this.listeners.set(type, l);
  }
  removeEventListener(type: string, fn: Listener): void {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((x) => x !== fn));
  }
  dispatch(type: string, extra: Record<string, unknown> = {}): any {
    let stopped = false;
    const ev: any = {
      type,
      target: this,
      key: undefined,
      defaultPrevented: false,
      stopPropagation: () => (stopped = true),
      preventDefault: () => (ev.defaultPrevented = true),
      ...extra,
    };
    let n: FElement | null = this;
    while (n && !stopped) {
      ev.currentTarget = n;
      for (const fn of [...(n.listeners.get(type) ?? [])]) fn(ev);
      if (type === "click" && n.onclick) n.onclick(ev);
      n = n.parentNode as FElement | null;
      if (n instanceof FDocument) break;
    }
    return ev;
  }
  click(): void {
    if (this.disabled) return;
    this.dispatch("click");
  }
  focus(): void {
    // An element inside an inert subtree can't take focus, as in a browser.
    for (let n: FElement | null = this; n; n = n.parentElement) if (n.hasAttribute("inert")) return;
    if (this.isConnected) fakeDocument.activeElement = this;
  }
  blur(): void {
    if (fakeDocument.activeElement === this) fakeDocument.activeElement = fakeDocument.body;
  }
  scrollIntoView(): void {
    this.scrolledIntoView++;
  }
  getBoundingClientRect() {
    return { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0, x: 0, y: 0 };
  }
  get offsetWidth(): number {
    return 0;
  }
  get offsetLeft(): number {
    return 0;
  }
  animate() {
    return { finished: Promise.resolve() };
  }
}

export class FInput extends FElement {
  _value: string | null = null;
  selectionStart: number | null = null;
  scrollHeight = 0;
  get type(): string {
    return this.getAttribute("type") ?? "text";
  }
  set type(v: string) {
    this.setAttribute("type", v);
  }
  private sanitize(v: string): string {
    // HTML spec value sanitization: date keeps only a valid date; text/search/tel/url/password strip newlines.
    if (this.type === "date") return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "";
    if (this.localName === "input" && ["text", "search", "tel", "url", "password"].includes(this.type)) return v.replace(/[\r\n]/g, "");
    return v;
  }
  get value(): string {
    return this.sanitize(this._value ?? this.getAttribute("value") ?? "");
  }
  set value(v: string) {
    this._value = this.sanitize(String(v));
  }
  get readOnly(): boolean {
    return this.hasAttribute("readonly");
  }
  set readOnly(v: boolean) {
    if (v) this.setAttribute("readonly", "");
    else this.removeAttribute("readonly");
  }
  get rows(): number {
    return Number(this.getAttribute("rows") ?? 2);
  }
  set rows(v: number) {
    this.setAttribute("rows", String(v));
  }
  setSelectionRange(a: number): void {
    this.selectionStart = a;
  }
  get placeholder(): string {
    return this.getAttribute("placeholder") ?? "";
  }
}

export class FTextArea extends FInput {
  get type(): string {
    return "textarea";
  }
  get value(): string {
    return this._value ?? super.textContent;
  }
  set value(v: string) {
    this._value = String(v);
  }
}

export class FOption extends FElement {
  _selected = false;
  get value(): string {
    return this.getAttribute("value") ?? this.textContent;
  }
  get selected(): boolean {
    return this._selected;
  }
  set selected(v: boolean) {
    this._selected = v;
  }
}

export class FSelect extends FElement {
  get options(): FOption[] {
    return [...this.descendants()].filter((e): e is FOption => e instanceof FOption);
  }
  get value(): string {
    const o = this.options;
    const sel = o.find((x) => x._selected) ?? (this._none ? undefined : o[0]);
    return sel?.value ?? "";
  }
  _none = false;
  set value(v: string) {
    let found = false;
    for (const o of this.options) {
      o._selected = !found && o.value === v;
      if (o._selected) found = true;
    }
    this._none = !found;
  }
}

export class FButton extends FElement {}

export class FDocument extends FElement {
  activeElement: FElement | null = null;
  documentElement: FElement;
  body: FElement;
  constructor() {
    super("#document");
    this.documentElement = new FElement("html");
    this.body = new FElement("body");
    this.appendChild(this.documentElement);
    this.documentElement.appendChild(this.body);
    this.activeElement = this.body;
  }
  createElement(tag: string): FElement {
    const t = tag.toLowerCase();
    if (t === "input") return new FInput(t);
    if (t === "textarea") return new FTextArea(t);
    if (t === "select") return new FSelect(t);
    if (t === "option") return new FOption(t);
    if (t === "button") return new FButton(t);
    return new FElement(t);
  }
  createElementNS(_ns: string, tag: string): FElement {
    return new FElement(tag);
  }
  createTextNode(t: string): FText {
    return new FText(t);
  }
}

export const fakeDocument = new FDocument();

export function installFakeDom(): void {
  const g = globalThis as any;
  g.document = fakeDocument;
  g.window = g;
  g.Node = FNode;
  g.HTMLElement = FElement;
  g.Element = FElement;
  g.HTMLInputElement = FInput;
  g.HTMLTextAreaElement = FTextArea;
  g.HTMLSelectElement = FSelect;
  g.HTMLButtonElement = FButton;
  g.FocusEvent = class {};
  g.CSS = { escape: (s: string) => String(s).replace(/(["\\])/g, "\\$1") };
  g.requestAnimationFrame = (cb: (t: number) => void) => setTimeout(() => cb(performance.now()), 0);
  fakeDocument.body.classList.add("nx-reduce-motion");
}

/** The visible text of an element, collapsing whitespace; hidden subtrees left out. */
export function visibleText(el: FElement): string {
  const walk = (n: FNode): string => {
    if (n instanceof FText) return n.data;
    if (n instanceof FElement) {
      if (n.hidden) return "";
      if (n.classList.contains("nx-btn-spin") || n.classList.contains("nx-btn-done")) return "";
      return n.childNodes.map(walk).join(n.localName === "p" || n.localName === "div" || n.localName === "li" ? " " : "");
    }
    return "";
  };
  return walk(el).replace(/\s+/g, " ").trim();
}
