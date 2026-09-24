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
import { USER_STATUS } from "@shared/constants";
import { formatDate } from "../utils/format";

export default function Users() {
  const { user: currentUser } = useAuth();
  const navigate = useNavigate();

  return (
    <DataPage
      title="Users"
      breadcrumb={[{ label: "Users" }]}
      searchPlaceholder="Search by name, email or mobile"
      filters={[
        {
          key: "status",
          label: "All statuses",
          options: [
            { value: USER_STATUS.ACTIVE, label: "Active" },
            { value: USER_STATUS.INACTIVE, label: "Inactive" },
            { value: USER_STATUS.SUSPENDED, label: "Suspended" },
          ],
        },
      ]}
      fetchData={({ search, filters, page, limit }) =>
        listUsers({
          search,
          status: filters.status,
          page,
          limit,
        })
      }
      dataKey="users"
      permissions={{
        view: "users.view",
        create: "users.create",
        update: "users.update",
        delete: "users.delete",
      }}
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
                <Link to={`/users/${row.uuid}`}>{row.name || "—"}</Link>
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
          searchKeys: ["role"],
          render: (row) => {
            if (!row.role) return "—";

            if (typeof row.role === "string") {
              return row.role;
            }

            return row.role.name || "—";
          },
        },
        {
          label: "Parent",
          sortKey: "parent",
          searchKeys: ["parent"],
          render: (row) => {
            if (!row.parent) return "—";

            return (
              <Link to={`/users/${row.parent.uuid}`}>{row.parent.name}</Link>
            );
          },
        },
        {
          label: "Created",
          sortKey: "created_at",
          searchKeys: ["created_at"],
          render: (row) => formatDate(row.created_at),
        },
      ]}
      onStatusToggle={async (row) => {
        const nextStatus =
          row.status === USER_STATUS.ACTIVE
            ? USER_STATUS.INACTIVE
            : USER_STATUS.ACTIVE;

        return updateUser(row.uuid, { status: nextStatus });
      }}
      actions={[
        {
          type: "view",
          tooltip: "View",
          to: (row) => `/users/${row.uuid}`,
        },
        {
          type: "edit",
          tooltip: "Edit",
          to: (row) => `/users/${row.uuid}/edit`,
        },
        {
          type: "delete",
          tooltip: "Delete",
          disabled: (row) => row.uuid === currentUser?.uuid,
          disabledReason: "You cannot delete your own account",
          onDelete: async (row) => deleteUser(row.uuid),
        },
      ]}
      bulkActions={[
        {
          label: "Activate",
          run: async (ids) =>
            bulkUpdateUserStatus(ids, USER_STATUS.ACTIVE),
        },
        {
          label: "Deactivate",
          run: async (ids) =>
            bulkUpdateUserStatus(ids, USER_STATUS.INACTIVE),
        },
      ]}
    />
  );
}