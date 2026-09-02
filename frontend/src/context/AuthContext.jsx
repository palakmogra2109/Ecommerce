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

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        login,
        register,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}