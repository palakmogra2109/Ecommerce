import { useRef, useState } from "react";

/**
 * A styled label for a control with no room for visible text — the 64px
 * collapsed rail.
 *
 * Rendered as a real element rather than a `title` attribute, because a native
 * tooltip cannot be styled to match the app, waits about a second to appear, and
 * is unreliable for keyboard users.
 *
 * Fixed position, placed from JS. It cannot be `position: absolute` inside the
 * rail: `.sidebar-nav` is a scroll container, and a scrollable axis implies
 * `overflow: auto` on BOTH axes, so anything positioned inside it is clipped to
 * the rail's 64px. Fixed escapes every ancestor clip — the same reason the
 * collapsed submenu flyout is fixed.
 *
 * `place` is both the coordinates and the visible flag: null means hidden, and
 * one state drives the class, the style and aria-hidden so they cannot disagree.
 *
 * The delay is deliberate: without it, sweeping the cursor down the rail flashes
 * a label past every icon. Shown on focus as well as hover so it is not
 * mouse-only, and dismissed on blur and on Escape.
 */
const SHOW_DELAY_MS = 350;

export default function SidebarTooltip({ label, children }) {
  const [place, setPlace] = useState(null);
  const timer = useRef(null);
  const anchor = useRef(null);

  const show = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const el = anchor.current;
      const rail = el?.closest(".sidebar");
      if (!el || !rail) return;

      const r = el.getBoundingClientRect();
      // Right of the rail, vertically centred on the control, then clamped so a
      // tooltip near the top or bottom of a tall rail stays on screen.
      const top = Math.max(8, Math.min(r.top + r.height / 2, window.innerHeight - 40));
      setPlace({ top, left: rail.getBoundingClientRect().right + 8 });
    }, SHOW_DELAY_MS);
  };

  const hide = () => {
    clearTimeout(timer.current);
    setPlace(null);
  };

  if (!label) return children;

  const shown = place !== null;

  return (
    <span
      ref={anchor}
      className="sidebar-tip-anchor"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      onKeyDown={(event) => {
        if (event.key === "Escape") hide();
      }}
    >
      {children}
      <span
        role="tooltip"
        className={`sidebar-tip${shown ? " sidebar-tip-show" : ""}`}
        style={shown ? { top: place.top, left: place.left } : undefined}
        // Hidden from assistive tech while invisible, so it is not announced as
        // a duplicate of the control's own accessible name. Never focusable, so
        // it cannot swallow a click aimed at the link beneath it.
        aria-hidden={!shown}
      >
        {label}
      </span>
    </span>
  );
}