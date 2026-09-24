import { useNavigate } from "react-router-dom";
import DataPage from "../components/DataPage";
import {
  listBranches,
  updateBranch,
  deleteBranch,
} from "../services/branches";
import { STATUS } from "@shared/constants";

export default function Branches() {
  const navigate = useNavigate();

  return (
    <DataPage
      title="Branches"
      searchPlaceholder="Search by name, code, city or postal code"
      filters={[
        {
          key: "status",
          label: "All statuses",
          options: [
            { value: STATUS.ACTIVE, label: "Active" },
            { value: STATUS.INACTIVE, label: "Inactive" },
          ],
        },
      ]}
      fetchData={({ search, filters, page, limit }) =>
        listBranches({
          search,
          status: filters.status,
          page,
          limit,
        })
      }
      dataKey="branches"
      columns={[
        {
          label: "Name",
          sortKey: "name",
          searchKeys: ["name"],
          render: (row) => (
            <span>
              <strong>{row.name}</strong>
              <br />
              <code style={{ fontSize: "12px", color: "#6b7280" }}>{row.code}</code>
            </span>
          ),
        },
        {
          label: "City",
          sortKey: "city",
          searchKeys: ["city"],
          render: (row) => row.city || "—",
        },
        {
          label: "Code",
          sortKey: "code",
          render: (row) => <code>{row.code}</code>,
        },
        {
          type: "status",
          label: "Status",
          sortKey: "status",
          searchKeys: ["status"],
        },
        {
          label: "Products",
          sortKey: "productCount",
          render: (row) => row.productCount ?? 0,
        },
      ]}
      onStatusToggle={async (row) => {
        const nextStatus =
          row.status === STATUS.ACTIVE
            ? STATUS.INACTIVE
            : STATUS.ACTIVE;
        return updateBranch(row.uuid, { status: nextStatus });
      }}
      onCreate={() => navigate("/branches/new")}
      createLabel="Create Branch"
      permissions={{
        view: "branches.view",
        create: "branches.create",
        update: "branches.update",
        delete: "branches.delete",
      }}
      actions={[
        {
          type: "view",
          tooltip: "View",
          to: (row) => `/branches/${row.uuid}`,
        },
        {
          type: "edit",
          tooltip: "Edit",
          to: (row) => `/branches/${row.uuid}/edit`,
        },
        {
          type: "view",
          tooltip: "Inventory",
          to: (row) => `/branches/${row.uuid}/inventory`,
        },
        {
          type: "view",
          tooltip: "Dashboard",
          to: (row) => `/branches/${row.uuid}/dashboard`,
        },
        {
          type: "delete",
          tooltip: "Delete",
          onDelete: async (row) => deleteBranch(row.uuid),
        },
      ]}
    />
  );
}
