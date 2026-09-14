import { useNavigate } from "react-router-dom";
import DataPage from "../components/DataPage";
import {
  listRoles,
  updateRole,
  deleteRole,
  bulkUpdateRoleStatus,
} from "../services/roles";
import { ROLE_STATUS } from "@shared/constants";

export default function Roles() {
  const navigate = useNavigate();

  return (
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
      ]}
      onStatusToggle={async (row) => {
        const nextStatus =
          row.status === ROLE_STATUS.ACTIVE
            ? ROLE_STATUS.INACTIVE
            : ROLE_STATUS.ACTIVE;

        return updateRole(row.id, { status: nextStatus });
      }}
      actions={[
        {
          type: "edit",
          tooltip: "Edit",
          to: (row) => `/roles/${row.id}/edit`,
        },
        {
          type: "delete",
          tooltip: "Delete",
          onDelete: async (row) => deleteRole(row.id),
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
  );
}