import { useAuth } from "../context/AuthContext";
import Forbidden from "./Forbidden";

export default function PermissionRoute({ permission, permissionLabel, children }) {
  const { can } = useAuth();

  if (permission && !can(permission)) {
    return (
      <Forbidden
        required={permission}
        permissionLabel={permissionLabel}
      />
    );
  }

  return children;
}