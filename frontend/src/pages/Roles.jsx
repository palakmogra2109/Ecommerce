import { useState } from "react";
import { useNavigate } from "react-router-dom";
import DataPage from "../components/DataPage";
import RoleUsersModal from "../components/RoleUsersModal";
import {
  listRoles,
  updateRole,
  deleteRole,
  bulkUpdateRoleStatus,
} from "../services/roles";
import { ROLE_STATUS } from "@shared/constants";

export default function Roles() {
  const navigate = useNavigate();
  const [usersRole, setUsersRole] = useState(null);

  return (
    <>
      <DataPage
        title="Roles"
        searchPlaceholder="Search by name or slug"
        filters={[
          {
            key: "status",
            label: "All statuses",
            options: [
              { value: ROLE_STATUS.ACTIVE, label: "Active" },
              { value: ROLE_STATUS.INACTIVE, label: "Inactive" },
            ],
          },
        ]}
        fetchData={({ search, filters, page, limit }) =>
          listRoles({
            search,
            status: filters.status,
            page,
            limit,
          })
        }
        dataKey="roles"
        getKey={(row) => row.uuid ?? row.id}
        createLabel="Add Role"
        onCreate={() => navigate("/roles/new")}
        columns={[
          {
            label: "Name",
            sortKey: "name",
            searchKeys: ["name"],
            render: (row) => row.name,
          },
          {
            label: "Slug",
            sortKey: "slug",
            searchKeys: ["slug"],
            render: (row) => <code>{row.slug}</code>,
          },
          {
            type: "status",
            label: "Status",
            sortKey: "status",
            searchKeys: ["status"],
          },
          {
            label: "Users",
            sortKey: "user_count",
            render: (row) => (
              <button
                type="button"
                className="filament-role-users-link"
                title="View users in this role"
                onClick={() => setUsersRole(row)}
              >
                <span className="filament-badge filament-badge-users">
                  <svg viewBox="0 0 24 24" className="filament-badge-icon">
                    <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z" />
                  </svg>
                  {row.user_count ?? 0}
                </span>
              </button>
            ),
          },
        ]}
        onStatusToggle={async (row) => {
          const nextStatus =
            row.status === ROLE_STATUS.ACTIVE
              ? ROLE_STATUS.INACTIVE
              : ROLE_STATUS.ACTIVE;

          return updateRole(row.uuid ?? row.id, { status: nextStatus });
        }}
        actions={[
          {
            type: "edit",
            tooltip: "Edit",
            to: (row) => `/roles/${row.uuid ?? row.id}/edit`,
          },
          {
            type: "delete",
            tooltip: "Delete",
            onDelete: async (row) => deleteRole(row.uuid ?? row.id),
          },
        ]}
        bulkActions={[
          {
            label: "Bulk Activate",
            run: async (ids) =>
              bulkUpdateRoleStatus(ids, ROLE_STATUS.ACTIVE),
          },
          {
            label: "Bulk Deactivate",
            run: async (ids) =>
              bulkUpdateRoleStatus(ids, ROLE_STATUS.INACTIVE),
          },
        ]}
      />

      {usersRole && (
        <RoleUsersModal
          role={usersRole}
          onClose={() => setUsersRole(null)}
        />
      )}
    </>
  );
}