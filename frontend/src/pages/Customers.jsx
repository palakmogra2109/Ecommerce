import DataPage from "../components/DataPage";
import {
  listCustomers,
  updateCustomer,
  deleteCustomer,
} from "../services/customers";
import { CUSTOMER_STATUS, formatDateTime } from "@shared/constants";

export default function Customers() {
  return (
    <DataPage
      title="Customers"
      searchPlaceholder="Search by name, email or mobile"
      filters={[
        {
          key: "status",
          label: "All statuses",
          options: [
            { value: CUSTOMER_STATUS.ACTIVE, label: "Active" },
            { value: CUSTOMER_STATUS.INACTIVE, label: "Inactive" },
            { value: CUSTOMER_STATUS.SUSPENDED, label: "Suspended" },
          ],
        },
      ]}
      fetchData={({ search, filters, page, limit }) =>
        listCustomers({
          search,
          status: filters.status,
          page,
          limit,
        })
      }
      dataKey="customers"
      permissions={{
        view: "customers.view",
        create: "customers.create",
        update: "customers.update",
        delete: "customers.delete",
      }}
      columns={[
        {
          label: "Customer",
          sortKey: "name",
          searchKeys: ["name"],
          render: (row) => (
            <span>
              <strong>{row.name}</strong>
              <span className="filament-muted"> · {row.email}</span>
            </span>
          ),
        },
        {
          label: "Mobile",
          sortKey: "mobile",
          render: (row) => row.mobile || <span className="filament-muted">—</span>,
        },
        {
          label: "Location",
          render: (row) => {
            const addr = row.address;
            const city = addr && (addr.city || addr.line1);
            return city || <span className="filament-muted">—</span>;
          },
        },
        {
          label: "Joined",
          sortKey: "created_at",
          render: (row) => formatDateTime(row.created_at),
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
          row.status === CUSTOMER_STATUS.ACTIVE
            ? CUSTOMER_STATUS.INACTIVE
            : CUSTOMER_STATUS.ACTIVE;

        return updateCustomer(row.uuid, { status: nextStatus });
      }}
      actions={[
        {
          type: "view",
          tooltip: "View",
          to: (row) => `/customers/${row.uuid}`,
        },
        {
          type: "delete",
          tooltip: "Delete",
          onDelete: async (row) => deleteCustomer(row.uuid),
        },
      ]}
    />
  );
}