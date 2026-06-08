Clean. Zero TypeScript errors.

---

**File:line of change:** `c:\Users\tanne\PPI\components\ui\SearchableSelect.tsx:113-118` (the `close` function body inside the scroll/resize effect).

**2-line summary:** Made the close-on-scroll listener short-circuit when the scroll event's target is inside the portaled popover, so the option `<ul>` (already `max-h-60 overflow-y-auto` on line 226) scrolls independently. Ancestor scrolls (modal body, page) still close the popover because their event targets are outside `popoverRef`.

**Mental trace — 10+ agent list:**
1. User opens "Filter by agent" SearchableSelect — popover portals to `document.body`, positioned `fixed` at trigger rect via the layout effect. Search input focuses, `<ul>` renders 10+ `<li>` rows inside a `max-h-60 overflow-y-auto` container (~240px → ~6 visible).
2. User wheel-scrolls over the option list. The `<ul>` receives a `scroll` event as its content moves. The event bubbles to `window`; the capture-phase listener fires `close(e)`.
3. `e.type === 'scroll'` is true, and `popoverRef.current.contains(e.target as Node)` is true (the `<ul>` is inside the popover div which has `ref={popoverRef}`). The guard returns early — popover stays open, list scrolls down.
4. ArrowDown keypress increments `highlight`; the highlight `useEffect` (line 132) calls `scrollIntoView({ block: 'nearest' })` on the highlighted `<li>`. That programmatic scroll also fires a scroll event on the `<ul>` — again caught by the guard, popover stays open.
5. User scrolls the underlying modal body (not the popover). Modal body's scroll event bubbles to window; `e.target` is the modal body element, NOT inside `popoverRef` — guard fails, `close()` executes, popover dismisses (intended: floating popover would otherwise detach from trigger).
6. Click outside (line 72-85 handler) and Escape (line 145-149) paths untouched. Portal/position logic (commit 421cd15) untouched.