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

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  async function checkAuth() {
    try {
      const data = await getCurrentUser();

      if (data.success) {
        setUser(data.user);
      } else {
        setUser(null);
      }
    } catch (error) {
      setUser(null);
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
        setUser(null);
      }

      return data;
    } catch (error) {
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