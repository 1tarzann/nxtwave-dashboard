// Functional motion. Every helper becomes an instant state change under reduced motion,
// so feedback (check marks, colors, toasts) still shows without movement.

export const EASE = "cubic-bezier(.2,.8,.2,1)";
export const DUR = { fast: 120, base: 200, zoom: 220, slow: 400 };

export type MotionMode = "system" | "on" | "off";

/** Set by applyMotionMode; CSS and every helper read the same body class. */
export function reducedMotion(): boolean {
  return document.body.classList.contains("nx-reduce-motion");
}

/** "system" follows the OS Reduce Motion setting and keeps following it if it changes. Returns a cleanup function. */
export function applyMotionMode(mode: MotionMode): () => void {
  const mq = typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null;
  const apply = () => document.body.classList.toggle("nx-reduce-motion", mode === "off" || (mode === "system" && !!mq?.matches));
  apply();
  if (mode !== "system" || !mq) return () => undefined;
  mq.addEventListener("change", apply);
  return () => mq.removeEventListener("change", apply);
}

/** Restart a CSS animation class (pulse, flash, shake). */
export function replayClass(el: Element, cls: string, ms = 1200): void {
  el.classList.remove(cls);
  void (el as HTMLElement).offsetWidth;
  el.classList.add(cls);
  window.setTimeout(() => el.classList.remove(cls), ms);
}

/** Animate a number from `from` to `to`. */
export function countUp(el: HTMLElement, from: number, to: number, format: (n: number) => string, ms = DUR.slow): void {
  if (reducedMotion() || from === to) {
    el.textContent = format(to);
    return;
  }
  const start = performance.now();
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / ms);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = format(t === 1 ? to : from + (to - from) * eased);
    if (t < 1) requestAnimationFrame(step);
  };
  el.textContent = format(from);
  requestAnimationFrame(step);
}

/** Grow/shrink `el` from the box `from` into its own box (FLIP). Used for square ↔ hub. */
export function zoomFrom(el: HTMLElement, from: DOMRect, ms = DUR.zoom): void {
  if (reducedMotion()) return;
  const to = el.getBoundingClientRect();
  if (!to.width || !to.height) return;
  const sx = from.width / to.width;
  const sy = from.height / to.height;
  const dx = from.left - to.left;
  const dy = from.top - to.top;
  el.animate(
    [
      { transformOrigin: "top left", transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`, opacity: 0.55 },
      { transformOrigin: "top left", transform: "none", opacity: 1 },
    ],
    { duration: ms, easing: EASE },
  );
}

/** Slide the tab underline from its previous spot to the active tab. */
export function slideIndicator(indicator: HTMLElement, target: HTMLElement, previous: { left: number; width: number } | null): { left: number; width: number } {
  const box = { left: target.offsetLeft, width: target.offsetWidth };
  const set = (b: { left: number; width: number }) => {
    indicator.style.transform = `translateX(${b.left}px)`;
    indicator.style.width = `${b.width}px`;
  };
  if (previous && !reducedMotion()) {
    indicator.style.transition = "none";
    set(previous);
    void indicator.offsetWidth;
    indicator.style.transition = "";
  }
  set(box);
  return box;
}

/** Fade + rise an element in (used for tab content and new items). */
export function enter(el: HTMLElement, ms = DUR.fast): void {
  if (reducedMotion()) return;
  el.animate([{ opacity: 0, transform: "translateY(4px)" }, { opacity: 1, transform: "none" }], { duration: ms, easing: EASE });
}

/** Slide out and remove. */
export function leave(el: HTMLElement, ms = DUR.base): Promise<void> {
  if (reducedMotion()) {
    el.remove();
    return Promise.resolve();
  }
  const a = el.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateX(24px)" }], { duration: ms, easing: EASE, fill: "forwards" });
  return a.finished.then(() => el.remove()).catch(() => el.remove());
}
