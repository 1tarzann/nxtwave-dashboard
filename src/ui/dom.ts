// Tiny DOM builder. Strings always become text nodes (never innerHTML), so note content can't inject markup.

export type Child = Node | string | number | null | undefined | false | Child[];
type Handler = (ev: any) => void;
export type Attrs = Record<string, string | number | boolean | Handler | Record<string, string> | null | undefined | (string | false | null | undefined)[]>;

function append(el: Element, child: Child): void {
  if (child === null || child === undefined || child === false) return;
  if (Array.isArray(child)) {
    child.forEach((c) => append(el, c));
    return;
  }
  el.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
}

function applyAttrs(el: Element, attrs?: Attrs | null): void {
  if (!attrs) return;
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") {
      const cls = Array.isArray(v) ? v.filter(Boolean).join(" ") : String(v);
      if (cls) el.setAttribute("class", cls);
    } else if (k === "style" && typeof v === "object" && !Array.isArray(v)) {
      for (const [p, val] of Object.entries(v as Record<string, string>)) (el as HTMLElement).style.setProperty(p, val);
    } else if (k.startsWith("on") && typeof v === "function") {
      el.addEventListener(k.slice(2).toLowerCase(), v as Handler);
    } else if (v === true) {
      el.setAttribute(k, "");
    } else {
      el.setAttribute(k, String(v));
    }
  }
}

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs?: Attrs | null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  applyAttrs(el, attrs);
  append(el, children);
  return el;
}

const SVG_NS = "http://www.w3.org/2000/svg";

export function s<K extends keyof SVGElementTagNameMap>(tag: K, attrs?: Attrs | null, ...children: Child[]): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  applyAttrs(el, attrs);
  append(el, children);
  return el;
}

export function clear(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}
