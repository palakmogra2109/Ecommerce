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
  registerUser,
} from "../services/auth";

const AuthContext = createContext();
const CACHE_KEY = "auth_user";

function getCachedUser() {
  try {
    const cached = sessionStorage.getItem(CACHE_KEY);
    return cached ? JSON.parse(cached) : null;
  } catch {
    return null;
  }
}

function setCachedUser(user) {
  if (user) {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(user));
  } else {
    sessionStorage.removeItem(CACHE_KEY);
  }
}

// Default landing pages in priority order. After login (or on an
// authenticated visit to a public route) the user is sent to the
// first module they are allowed to open.
const LANDING_MODULES = [
  { path: "/dashboard", permission: "dashboard.view" },
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

  async function login(email, password) {
    const data = await loginUser({
      email,
      password,
    });

    if (data.success) {
      setUser(data.user);
      setCachedUser(data.user);
    }

    return data;
  }

  async function register(name, email, password) {
    return await registerUser({
      name,
      email,
      password,
    });
  }

  async function logout() {
    try {
      const data = await logoutUser();

      if (data.success) {
        setCachedUser(null);
        setUser(null);
      }

      return data;
    } catch (error) {
      setCachedUser(null);
      setUser(null);

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
    const found = LANDING_MODULES.find((module) => can(module.permission));

    return found ? found.path : "/dashboard";
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        login,
        register,
        logout,
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