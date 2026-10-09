import { useEffect, useRef, useState } from "react";
import { FiChevronUp, FiLogOut, FiMoon, FiSun } from "react-icons/fi";
import { useSettings } from "../context/SettingsContext";
import { useAuth } from "../context/AuthContext";

// Local fallback key, used only when the viewer cannot write the site setting.
// Keyed per browser rather than per user: two people sharing a machine each
// keep the theme they last chose.
const PREF_KEY = "sidebar_theme_pref";

const AVATAR_TINTS = [
  "#6366f1",
  "#0ea5e9",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#ec4899",
  "#14b8a6",
];

/**
 * Two letters from a display name, or one from the email.
 *
 * Not a hash of the whole string: "Palak MogrA" is instantly recognisable,
 * where a hash of "palak.mogra@example.com" would be meaningless.
 */
function initialsFor(user) {
  const name = (user?.name || "").trim();
  if (name) {
    const letters = name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]);
    if (letters.length) return letters.join("").toUpperCase();
  }
  const email = (user?.email || "").trim();
  return email ? email[0].toUpperCase() : "?";
}

/**
 * A stable colour per person. Summed char codes rather than a real hash: this is
 * decoration, it never has to be collision-free, and it must produce the same
 * value on every page load and every device.
 */
function tintFor(user) {
  const seed = (user?.uuid || user?.email || user?.name || "").trim();
  if (!seed) return AVATAR_TINTS[0];

  let total = 0;
  for (let i = 0; i < seed.length; i++) total += seed.charCodeAt(i);

  return AVATAR_TINTS[total % AVATAR_TINTS.length];
}

/**
 * The block at the foot of the rail: the signed-in identity opens a menu holding
 * the display mode and the way out, so the rail ends in one affordance instead of
 * three stacked controls.
 *
 * Collapsed, the trigger is the bare avatar and the menu opens beside the rail
 * rather than under it — a 64px rail has no room for a 240px panel, and
 * `.sidebar-nav`'s `overflow-y: auto` would clip one that tried.
 *
 * Dismissal follows the house pattern used by the bulk and filter menus
 * (`mousedown` outside the root), plus Escape and outside-scroll, which those
 * menus are missing: a keyboard user had no way to close one.
 */
export default function SidebarProfileFooter({ user, collapsed, onLogout }) {
  const { settings, save } = useSettings();
  const { can } = useAuth();

  // Only super_admin and admin can PUT /api/settings. Showing the switch to
  // everyone else would mean showing a control that answers 403, so it is hidden
  // and the theme is kept per browser instead.
  const canSaveTheme = can("settings.update");

  const [open, setOpen] = useState(false);
  const [localDark, setLocalDark] = useState(() => {
    if (canSaveTheme) return null;
    try {
      return localStorage.getItem(PREF_KEY) === "dark";
    } catch {
      return false;
    }
  });
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const root = useRef(null);
  const trigger = useRef(null);
  const menu = useRef(null);

  // Where the menu goes. Fixed and measured, because `.sidebar-nav` is a scroll
  // container and anything positioned inside it is clipped to the rail's width.
  // Above the trigger when there is room below, otherwise below — a menu that
  // opened off the bottom of a short window would be unreachable.
  const [place, setPlace] = useState(null);

  useEffect(() => {
    if (!open) {
      setPlace(null);
      return;
    }

    function measure() {
      const el = trigger.current;
      if (!el) return;

      const r = el.getBoundingClientRect();
      const width = 232;
      const estimatedHeight = 176;
      const gap = 6;

      // Collapsed, the rail is 64px: open beside it. Expanded, sit under the
      // trigger but stay inside the viewport.
      const beside = collapsed
        ? { left: r.right + gap, top: Math.min(r.top, window.innerHeight - estimatedHeight - 8) }
        : window.innerHeight - r.bottom > estimatedHeight + gap
          ? { left: r.left, top: r.bottom + gap }
          : { left: r.left, top: Math.max(8, r.top - estimatedHeight - gap) };

      setPlace({
        left: Math.min(beside.left, window.innerWidth - width - 8),
        top: Math.max(8, beside.top),
      });
    }

    measure();

    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [open, collapsed]);

  const isDark = canSaveTheme ? Boolean(settings?.dark_mode) : localDark;

  useEffect(() => {
    if (!open) return undefined;

    function onPointerDown(event) {
      if (root.current && !root.current.contains(event.target)) setOpen(false);
    }
    function onKeyDown(event) {
      if (event.key === "Escape") {
        setOpen(false);
        // Return focus to the control that opened it, so the keyboard user is
        // not dropped back at the top of the document.
        trigger.current?.focus();
      }
    }
    // Scrolling the rail moves the trigger out from under the menu, leaving it
    // stranded mid-viewport.
    const onScroll = () => setOpen(false);

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", onScroll, true);

    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  async function toggleTheme() {
    const next = !isDark;
    setFailed(false);

    if (!canSaveTheme) {
      setLocalDark(next);
      try {
        localStorage.setItem(PREF_KEY, next ? "dark" : "light");
      } catch {
        // private mode: the choice will not outlive the session
      }
      document.documentElement.dataset.theme = next ? "dark" : "light";
      return;
    }

    setBusy(true);
    const previous = isDark ? "dark" : "light";

    try {
      const data = await save({ dark_mode: next });
      if (!data?.success) {
        // Put it back rather than leave the switch claiming a theme the server
        // has not accepted.
        setFailed(true);
        document.documentElement.dataset.theme = previous;
      }
    } catch {
      setFailed(true);
      document.documentElement.dataset.theme = previous;
    } finally {
      setBusy(false);
    }
  }

  const initials = initialsFor(user);
  const tint = tintFor(user);
  const ThemeIcon = isDark ? FiSun : FiMoon;
  const themeLabel = isDark ? "Light mode" : "Dark mode";
  const menuId = "sidebar-profile-menu";

  return (
    <div className="sidebar-footer" ref={root}>
      <button
        type="button"
        ref={trigger}
        className={`sidebar-profile${open ? " sidebar-profile-open" : ""}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`Account menu for ${user?.name || user?.email || "signed-in user"}`}
        onClick={() => setOpen((o) => !o)}
      >
        <span
          className="sidebar-avatar"
          style={{ backgroundColor: tint }}
          aria-hidden="true"
        >
          {initials}
        </span>
        <span className="sidebar-profile-text">
          <span className="sidebar-profile-name">
            {user?.name || user?.email || "Signed in"}
          </span>
          <span className="sidebar-profile-email">{user?.email || ""}</span>
        </span>
        {/* Chevron only where there is room for it; the collapsed rail is 64px. */}
        {!collapsed && (
          <span className={`sidebar-profile-caret${open ? " is-open" : ""}`} aria-hidden="true">
            <FiChevronUp />
          </span>
        )}
      </button>

      {open && place && (
        <div
          className="sidebar-menu"
          id={menuId}
          role="menu"
          ref={menu}
          style={{ top: place.top, left: place.left }}
        >
          <div className="sidebar-menu-head">
            <span className="sidebar-menu-name">{user?.name || user?.email}</span>
            <span className="sidebar-menu-email">{user?.email || ""}</span>
          </div>

          <button
            type="button"
            className="sidebar-menu-item sidebar-menu-theme"
            role="menuitemcheckbox"
            aria-checked={isDark}
            disabled={busy}
            onClick={toggleTheme}
          >
            <ThemeIcon className="sidebar-item-icon" aria-hidden="true" />
            <span className="sidebar-menu-label">{themeLabel}</span>
            <span className="sidebar-switch" aria-hidden="true">
              <span className="sidebar-switch-knob" />
            </span>
          </button>

          {failed && (
            <p className="sidebar-menu-error" role="status">
              Could not save the theme
            </p>
          )}

          <button
            type="button"
            className="sidebar-menu-item sidebar-menu-logout"
            role="menuitem"
            onClick={onLogout}
          >
            <FiLogOut className="sidebar-item-icon" aria-hidden="true" />
            <span className="sidebar-menu-label">Logout</span>
          </button>
        </div>
      )}
    </div>
  );
}