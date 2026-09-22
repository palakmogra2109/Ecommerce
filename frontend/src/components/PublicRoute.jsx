import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import Loading from "./Loading";

export default function PublicRoute({ children }) {
  const { user, loading, getLandingPath } = useAuth();

  if (loading) {
    return <Loading />;
  }

  if (user) {
    return <Navigate to={getLandingPath()} replace />;
  }

  return children;
}