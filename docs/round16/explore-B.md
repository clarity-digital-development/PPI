**Root cause (one sentence):** The capture-phase `scroll` listener at line 118 fires for ALL scroll events including those bubbling up from the `<ul>` inside the popover, so any wheel/scroll attempt on the option list closes the popover before the list can scroll.

**The `max-height` is already correct** — line 226 has `max-h-60 overflow-y-auto` on the `<ul>`. The list is structurally scrollable; the close-on-scroll listener is the sole blocker.

**Exact fix — `components/ui/SearchableSelect.tsx:111-124`:** Make `close` ignore scroll events whose target is inside the popover:

```tsx
useEffect(() => {
  if (!open) return
  const close = (e?: Event) => {
    // Ignore scrolls originating inside the popover — let the option list scroll.
    if (e && e.type === 'scroll' && popoverRef.current?.contains(e.target as Node)) return
    setOpen(false)
    setQuery('')
  }
  window.addEventListener('scroll', close, true)
  window.addEventListener('resize', close)
  return () => {
    window.removeEventListener('scroll', close, true)
    window.removeEventListener('resize', close)
  }
}, [open])
```

This preserves the "close when an ancestor (modal body/page) scrolls" behavior — the portaled popover is a body-child, so ancestor scrolls of the trigger never have the popover in their event path, only the `<ul>` itself does when the user scrolls options.

**Resize listener:** No change needed. Resize is a window-level event with no meaningful inner target; closing on resize is still correct (popover position would detach).

**No regression to commit 421cd15 (portal fix):** The portal/positioning logic (lines 198-210, `position: fixed`, `z-[60]`, `createPortal(..., document.body)`) is untouched. Modal-overflow escape relies on the portal target and fixed positioning, neither of which this fix modifies. Click-outside still works because `popoverRef.current?.contains(target)` already excludes popover-internal clicks (line 77).

**One caveat to flag:** if `containerRef`'s ancestor (the modal body) genuinely scrolls, capture phase still catches it before bubbling, so the listener correctly closes. The fix only short-circuits when `e.target` is *inside* the popover subtree — which only happens for the option `<ul>`.

File:line for the fix: `c:\Users\tanne\PPI\components\ui\SearchableSelect.tsx:113-116` (the `close` function body).