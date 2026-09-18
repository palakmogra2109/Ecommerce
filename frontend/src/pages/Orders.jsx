import { Link } from "react-router-dom";
import DataPage from "../components/DataPage";
import {
  listOrders,
  deleteOrder,
} from "../services/orders";
import {
  ORDER_STATUS,
  ORDER_STATUS_LABELS,
  PAYMENT_STATUS,
  PAYMENT_STATUS_LABELS,
  formatCurrency,
  formatDateTime,
} from "@shared/constants";

const STATUS_OPTIONS = Object.values(ORDER_STATUS).map((value) => ({
  value,
  label: ORDER_STATUS_LABELS[value],
}));

const PAYMENT_OPTIONS = Object.values(PAYMENT_STATUS).map((value) => ({
  value,
  label: PAYMENT_STATUS_LABELS[value],
}));

export default function Orders() {
  return (
    <DataPage
      title="Orders"
      searchPlaceholder="Search by order number or customer name"
      filters={[
        {
          key: "status",
          label: "All statuses",
          options: STATUS_OPTIONS,
        },
        {
          key: "paymentStatus",
          label: "All payments",
          options: PAYMENT_OPTIONS,
        },
      ]}
      fetchData={({ search, filters, page, limit }) =>
        listOrders({
          search,
          status: filters.status,
          paymentStatus: filters.paymentStatus,
          page,
          limit,
        })
      }
      dataKey="orders"
      permissions={{
        view: "orders.view",
        create: "orders.create",
        update: "orders.update",
        delete: "orders.delete",
      }}
      columns={[
        {
          label: "Order",
          sortKey: "order_number",
          searchKeys: ["order_number"],
          render: (row) => (
            <Link to={`/orders/${row.uuid}`}>
              <strong>{row.order_number}</strong>
            </Link>
          ),
        },
        {
          label: "Customer",
          sortKey: "customer_name",
          searchKeys: ["customer_name"],
          render: (row) => (
            <span>
              <strong>{row.customer_name}</strong>
              <span className="filament-muted"> · {row.customer_email}</span>
            </span>
          ),
        },
        {
          label: "Date",
          sortKey: "created_at",
          render: (row) => formatDateTime(row.created_at),
        },
        {
          label: "Total",
          sortKey: "total",
          searchKeys: ["total"],
          render: (row) => <strong>{formatCurrency(row.total)}</strong>,
        },
        {
          label: "Payment",
          sortKey: "payment_status",
          render: (row) => (
            <span
              className={`filament-badge filament-badge-${String(row.payment_status || "").toLowerCase()}`}
            >
              <span className="filament-badge-dot" />
              {PAYMENT_STATUS_LABELS[row.payment_status] || row.payment_status}
            </span>
          ),
        },
        {
          label: "Status",
          sortKey: "status",
          render: (row) => (
            <span
              className={`filament-badge filament-badge-${String(row.status || "").toLowerCase()}`}
            >
              <span className="filament-badge-dot" />
              {ORDER_STATUS_LABELS[row.status] || row.status}
            </span>
          ),
        },
      ]}
      actions={[
        {
          type: "view",
          tooltip: "View",
          to: (row) => `/orders/${row.uuid}`,
        },
        {
          type: "delete",
          tooltip: "Delete",
          onDelete: async (row) => deleteOrder(row.uuid),
        },
      ]}
    />
  );
}