import { Link, useNavigate } from "react-router-dom";
import DataPage from "../components/DataPage";
import Avatar from "../components/Avatar";
import {
  listUsers,
  updateUser,
  deleteUser,
  bulkUpdateUserStatus,
} from "../services/users";
import { useAuth } from "../context/AuthContext";

export default function Users() {
  const { user: currentUser } = useAuth();
  const navigate = useNavigate();

  return (
    <DataPage
      title="Users"
      breadcrumb={[{ label: "Users" }]}
      searchPlaceholder="Search by name, email or mobile"
      // filters={[
      //   {
      //     key: "status",
      //     label: "All statuses",
      //     options: [
      //       { value: "ACTIVE", label: "Active" },
      //       { value: "INACTIVE", label: "Inactive" },
      //       { value: "SUSPENDED", label: "Suspended" },
      //     ],
      //   },
      // ]}
      fetchData={({ search, filters, page, limit }) =>
        listUsers({
          search,
          status: filters.status,
          page,
          limit,
        })
      }
      dataKey="users"
      createLabel="Add User"
      onCreate={() => navigate("/users/new")}
      columns={[
        {
          label: "User",
          sortKey: "name",
          searchKeys: ["name", "email"],
          render: (row) => (
            <div className="user-cell">
              <Avatar user={row} size={38} />
              <div className="user-cell-text">
                <Link to={`/users/${row.id}`}>{row.name || "—"}</Link>
                <span>{row.email}</span>
              </div>
            </div>
          ),
        },
        {
          label: "Mobile",
          sortKey: "mobile",
          searchKeys: ["mobile"],
          render: (row) => row.mobile || "—",
        },
        {
          type: "status",
          label: "Status",
          sortKey: "status",
          searchKeys: ["status"],
        },
        {
          label: "Role",
          sortKey: "role",
          render: (row) => {
            if (!row.role) return "—";

            if (typeof row.role === "string") {
              return row.role;
            }

            return row.role.name || "—";
          },
        },
        {
          label: "Created",
          sortKey: "created_at",
          searchKeys: ["created_at"],
          render: (row) =>
            new Date(row.created_at).toLocaleDateString(),
        },
      ]}
      onStatusToggle={async (row) => {
        const nextStatus =
          row.status === "ACTIVE" ? "INACTIVE" : "ACTIVE";

        return updateUser(row.id, { status: nextStatus });
      }}
      actions={[
        {
          type: "view",
          tooltip: "View",
          to: (row) => `/users/${row.id}`,
        },
        {
          type: "edit",
          tooltip: "Edit",
          to: (row) => `/users/${row.id}/edit`,
        },
        {
          type: "delete",
          tooltip: "Delete",
          disabled: (row) => row.id === currentUser?.id,
          onDelete: async (row) => deleteUser(row.id),
        },
      ]}
      bulkActions={[
        {
          label: "Bulk Activate",
          run: async (ids) =>
            bulkUpdateUserStatus(ids, "ACTIVE"),
        },
        {
          label: "Bulk Deactivate",
          run: async (ids) =>
            bulkUpdateUserStatus(ids, "INACTIVE"),
        },
      ]}
    />
  );
}