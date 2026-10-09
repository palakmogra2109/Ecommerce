import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FiBell, FiCheck, FiLogOut, FiMoon, FiSun, FiUser } from "react-icons/fi";
import { listNotifications, markNotificationsRead } from "../services/notifications";
import { useSettings } from "../context/SettingsContext";
import { useAuth } from "../context/AuthContext";

// Re-read on a timer rather than a socket: the app has no push channel for
// admins, and a stale badge is better than an open websocket that silently rots.
const POLL_MS = 60_000;

// Per-browser fallback, used only by viewers who cannot PUT /api/settings.
const PREF_KEY = "topbar_theme_pref";

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

function tintFor(user) {
  const seed = (user?.uuid || user?.email || user?.name || "").trim();
  if (!seed) return AVATAR_TINTS[0];

  let total = 0;
  for (let i = 0; i < seed.length; i++) total += seed.charCodeAt(i);

  return AVATAR_TINTS[total % AVATAR_TINTS.length];
}

// "4 minutes ago" / "3 days ago". Deliberately coarse: this is a glance, and
// Intl.RelativeTimeFormat is not guaranteed present in every runtime the app
// targets.
function relativeTime(iso) {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";

  const secs = Math.round((Date.now() - then) / 1000);
  if (secs < 60) return "just now";

  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} min ago`;

  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hr ago`;

  const days = Math.round(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;

  return new Date(then).toLocaleDateString();
}

export default function AdminTopbar({ user, onLogout }) {
  const navigate = useNavigate();
  const { settings, save } = useSettings();
  const { can } = useAuth();

  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [bellOpen, setBellOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [localDark, setLocalDark] = useState(() => {
    if (can("settings.update")) return null;
    try {
      return localStorage.getItem(PREF_KEY) === "dark";
    } catch {
      return false;
    }
  });
  const [busy, setBusy] = useState(false);
  const [themeFailed, setThemeFailed] = useState(false);

  const bellRoot = useRef(null);
  const menuRoot = useRef(null);
  const bellTrigger = useRef(null);
  const menuTrigger = useRef(null);

  const canSaveTheme = can("settings.update");
  const isDark = canSaveTheme ? Boolean(settings?.dark_mode) : localDark;

  const refresh = useCallback(async () => {
    try {
      const data = await listNotifications({ limit: 30 });
      if (data?.success) {
        setItems(Array.isArray(data.notifications) ? data.notifications : []);
        setUnread(Number(data.unread) || 0);
      }
    } catch {
      // Offline or 401: leave whatever is on screen rather than blanking it.
    }
  }, []);

  useEffect(() => {
    // refresh() is async and only touches state after its `await`, so this is
    // not the synchronous-setState-in-effect pattern the rule warns about: the
    // flag is a false positive on a call that cannot set state inline.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
    const timer = setInterval(refresh, POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  // Outside click, Escape and scroll dismissal. Each panel is independent so
  // opening one closes the other rather than stacking two overlays.
  useEffect(() => {
    if (!bellOpen && !menuOpen) return undefined;

    function onPointerDown(event) {
      const inBell = bellRoot.current?.contains(event.target);
      const inMenu = menuRoot.current?.contains(event.target);

      if (!inBell) setBellOpen(false);
      if (!inMenu) setMenuOpen(false);
    }
    function onKeyDown(event) {
      if (event.key !== "Escape") return;
      if (bellOpen) {
        setBellOpen(false);
        bellTrigger.current?.focus();
      }
      if (menuOpen) {
        setMenuOpen(false);
        menuTrigger.current?.focus();
      }
    }
    const onScroll = () => {
      setBellOpen(false);
      setMenuOpen(false);
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);

    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [bellOpen, menuOpen]);

  async function toggleTheme() {
    const next = !isDark;
    setThemeFailed(false);

    if (!canSaveTheme) {
      setLocalDark(next);
      try {
        localStorage.setItem(PREF_KEY, next ? "dark" : "light");
      } catch {
        // private mode
      }
      document.documentElement.dataset.theme = next ? "dark" : "light";
      return;
    }

    setBusy(true);
    const previous = isDark ? "dark" : "light";
    try {
      const data = await save({ dark_mode: next });
      if (!data?.success) {
        setThemeFailed(true);
        document.documentElement.dataset.theme = previous;
      }
    } catch {
      setThemeFailed(true);
      document.documentElement.dataset.theme = previous;
    } finally {
      setBusy(false);
    }
  }

  async function openItem(item) {
    // Mark read first so the badge drops even if navigation is slow, then move.
    if (!item.read_at) {
      try {
        const data = await markNotificationsRead([item.uuid]);
        if (data?.success) {
          setUnread(Number(data.unread) || 0);
          setItems((rows) =>
            rows.map((r) => (r.uuid === item.uuid ? { ...r, read_at: new Date().toISOString() } : r))
          );
        }
      } catch {
        // Not worth blocking navigation over a badge.
      }
    }

    setBellOpen(false);
    if (item.action_url) navigate(item.action_url);
  }

  async function markAllRead() {
    try {
      const data = await markNotificationsRead([]);
      if (data?.success) {
        setUnread(Number(data.unread) || 0);
        setItems((rows) => rows.map((r) => ({ ...r, read_at: r.read_at || new Date().toISOString() })));
      }
    } catch {
      // leave the badge alone if it could not be saved
    }
  }

  const initials = initialsFor(user);
  const tint = tintFor(user);
  const ThemeIcon = isDark ? FiSun : FiMoon;
  const themeLabel = isDark ? "Light mode" : "Dark mode";
  const who = user?.name || user?.email || "signed-in user";

  return (
    <header className="topbar">
      <div className="topbar-actions">
        <div className="topbar-bell-root" ref={bellRoot}>
          <button
            type="button"
            ref={bellTrigger}
            className={`topbar-icon-btn${bellOpen ? " is-open" : ""}`}
            aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
            aria-expanded={bellOpen}
            aria-haspopup="dialog"
            onClick={() => {
              setBellOpen((o) => !o);
              setMenuOpen(false);
            }}
          >
            <FiBell aria-hidden="true" />
            {unread > 0 && (
              <span className="topbar-badge">
                {/* A three-digit count would overflow the pill at 9px. */}
                {unread > 99 ? "99+" : unread}
              </span>
            )}
          </button>

          {bellOpen && (
            <div className="topbar-panel topbar-notifications" role="dialog" aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}>
              <div className="topbar-panel-head">
                <span className="topbar-panel-title">Notifications</span>
                {unread > 0 && (
                  <button type="button" className="topbar-markall" onClick={markAllRead}>
                    <FiCheck aria-hidden="true" />
                    Mark all read
                  </button>
                )}
              </div>

              {items.length === 0 ? (
                <p className="topbar-empty">
                  {unread > 0 ? "Loading…" : "You're all caught up."}
                </p>
              ) : (
                <ul className="topbar-notif-list">
                  {items.map((item) => (
                    <li key={item.uuid}>
                      <button
                        type="button"
                        className={`topbar-notif${item.read_at ? "" : " is-unread"}`}
                        onClick={() => openItem(item)}
                      >
                        <span className="topbar-notif-title">{item.title}</span>
                        {item.message && (
                          <span className="topbar-notif-message">{item.message}</span>
                        )}
                        <span className="topbar-notif-time">{relativeTime(item.created_at)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        <div className="topbar-menu-root" ref={menuRoot}>
          <button
            type="button"
            ref={menuTrigger}
            className={`topbar-avatar${menuOpen ? " is-open" : ""}`}
            style={{ backgroundColor: tint }}
            aria-label={`Account menu for ${who}`}
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            onClick={() => {
              setMenuOpen((o) => !o);
              setBellOpen(false);
            }}
          >
            <span aria-hidden="true">{initials}</span>
          </button>

          {menuOpen && (
            <div className="topbar-panel topbar-menu" role="menu">
              <div className="topbar-menu-head">
                <span className="topbar-menu-name">{user?.name || user?.email}</span>
                <span className="topbar-menu-email">{user?.email || ""}</span>
              </div>

              {/* There is no dedicated profile page in this app, and /users/:id
                  already treats a user's own uuid as their own record
                  (`id === auth.user?.uuid`), so that is where "Profile" goes.
                  Hidden without users.view rather than shown as a link that
                  would land on the Forbidden guard. */}
              {can("users.view") && user?.uuid && (
                <button
                  type="button"
                  className="topbar-menu-item"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    navigate(`/users/${user.uuid}`);
                  }}
                >
                  <FiUser className="sidebar-item-icon" aria-hidden="true" />
                  <span>Profile</span>
                </button>
              )}

              <button
                type="button"
                className="topbar-menu-item"
                role="menuitemcheckbox"
                aria-checked={isDark}
                disabled={busy}
                onClick={toggleTheme}
              >
                <ThemeIcon className="sidebar-item-icon" aria-hidden="true" />
                <span className="topbar-menu-label">{themeLabel}</span>
                <span className="sidebar-switch" aria-hidden="true">
                  <span className="sidebar-switch-knob" />
                </span>
              </button>

              {themeFailed && (
                <p className="topbar-menu-error" role="status">
                  Could not save the theme
                </p>
              )}

              <button
                type="button"
                className="topbar-menu-item topbar-menu-logout"
                role="menuitem"
                onClick={onLogout}
              >
                <FiLogOut className="sidebar-item-icon" aria-hidden="true" />
                <span>Logout</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}