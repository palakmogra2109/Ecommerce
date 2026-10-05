import {
  createContext,
  useContext,
  useEffect,
  useState,
} from "react";

import {
  getCurrentUser,
  loginUser,
  logoutUser,
} from "../services/auth";
import { clearToken, getStoredToken, onUnauthorized, storeToken } from "../services/http";

const AuthContext = createContext();
const CACHE_KEY = "auth_user";

function getCachedUser() {
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    return cached ? JSON.parse(cached) : null;
  } catch {
    return null;
  }
}

function setCachedUser(user) {
  if (user) {
    localStorage.setItem(CACHE_KEY, JSON.stringify(user));
  } else {
    localStorage.removeItem(CACHE_KEY);
  }
}

// Default landing pages in priority order. After login (or on an
// authenticated visit to a public route) the user is sent to the
// first module they are allowed to open.
const LANDING_MODULES = [
  { path: "/dashboard", permission: "dashboard.view" },
  { path: "/manager", permission: "store_dashboard.view" },
  { path: "/users", permission: "users.view" },
  { path: "/roles", permission: "roles.view" },
  { path: "/email-templates", permission: "email_templates.view" },
  { path: "/products", permission: "products.view" },
  { path: "/orders", permission: "orders.view" },
  { path: "/customers", permission: "customers.view" },
  { path: "/categories", permission: "categories.view" },
  { path: "/brands", permission: "brands.view" },
  { path: "/attributes", permission: "attributes.view" },
  { path: "/coupons", permission: "coupons.view" },
  { path: "/reviews", permission: "reviews.view" },
  { path: "/banners", permission: "banners.view" },
  { path: "/settings", permission: "settings.view" },
];

export function AuthProvider({ children }) {
  const [user, setUser] = useState(getCachedUser);
  const [loading, setLoading] = useState(() => !getCachedUser());

  async function checkAuth() {
    if (!getStoredToken()) {
      setUser(null);
      setCachedUser(null);
      setLoading(false);
      return;
    }

    try {
      const data = await getCurrentUser();

      if (data.success) {
        setUser(data.user);
        setCachedUser(data.user);
      } else {
        setUser(null);
        setCachedUser(null);
      }
    } catch (error) {
      setUser(null);
      setCachedUser(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    checkAuth();
  }, []);

  // Any 401 from any request ends the session, wherever it came from.
  //
  // Without this, a user deactivated while signed in kept working: their token
  // was still cryptographically valid for its full 7 days, and nothing on the
  // client reacted to the server refusing. The token is cleared by
  // handleUnauthorizedResponse; this drops the cached user so the UI falls back
  // to the login page instead of rendering an empty shell.
  useEffect(() => {
    return onUnauthorized(() => {
      setCachedUser(null);
      setUser(null);
      setLoading(false);
    });
  }, []);

  async function login(email, password) {
    const data = await loginUser({
      email,
      password,
    });

    if (data.success) {
      storeToken(data.token);
      setUser(data.user);
      setCachedUser(data.user);
    }

    return data;
  }

  async function logout() {
    // Local logout is authoritative for this app: clear this app's own
    // token even if the network call fails. The other panel keeps its own
    // token, so both stay independent.
    clearToken();
    setCachedUser(null);
    setUser(null);

    try {
      const data = await logoutUser();
      return data;
    } catch (error) {
      return {
        success: false,
        message: "Unable to logout. Please try again.",
      };
    }
  }

  function can(slug) {
    if (!slug) {
      return true;
    }

    if ((user?.roles || []).includes("super_admin")) {
      return true;
    }

    return (user?.permissions || []).includes(slug);
  }

  // First module this user is allowed to open, fallback to dashboard.
  function getLandingPath() {
    // Store managers go straight to their store panel.
    const storeBranches = user?.branches?.length ? user.branches : null;

    if (storeBranches) {
      // Don't coach admin users that happen to manage a branch into the
      // store panel unless they can't open anything else.
      const adminAble = LANDING_MODULES.some(
        (m) => m.path !== "/manager" && can(m.permission)
      );
      if (!adminAble) return "/manager";
    }

    const found = LANDING_MODULES.find((module) => can(module.permission));

    return found ? found.path : "/dashboard";
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        login,
        logout,
        refresh: checkAuth,
        can,
        getLandingPath,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}