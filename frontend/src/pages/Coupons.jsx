import { useNavigate } from "react-router-dom";
import DataPage from "../components/DataPage";
import {
  listCoupons,
  updateCoupon,
  bulkUpdateCouponStatus,
  deleteCoupon,
} from "../services/coupons";
import {
  COUPON_STATUS,
  COUPON_TYPE,
  COUPON_TYPE_LABELS,
  formatCurrency,
  formatDateTime,
} from "@shared/constants";

export default function Coupons() {
  const navigate = useNavigate();

  return (
    <DataPage
      title="Coupons"
      searchPlaceholder="Search by code or description"
      filters={[
        {
          key: "status",
          label: "All statuses",
          options: [
            { value: COUPON_STATUS.ACTIVE, label: "Active" },
            { value: COUPON_STATUS.INACTIVE, label: "Inactive" },
          ],
        },
        {
          key: "type",
          label: "All types",
          options: [
            { value: COUPON_TYPE.PERCENTAGE, label: "Percentage" },
            { value: COUPON_TYPE.FIXED, label: "Fixed amount" },
          ],
        },
      ]}
      fetchData={({ search, filters, page, limit }) =>
        listCoupons({
          search,
          status: filters.status,
          type: filters.type,
          page,
          limit,
        })
      }
      dataKey="coupons"
      columns={[
        {
          label: "Code",
          sortKey: "code",
          searchKeys: ["code"],
          render: (row) => (
            <code className="coupon-code">{row.code}</code>
          ),
        },
        {
          label: "Discount",
          sortKey: "value",
          render: (row) =>
            row.type === COUPON_TYPE.FIXED
              ? formatCurrency(row.value)
              : `${row.value}%`,
        },
        {
          label: "Type",
          sortKey: "type",
          render: (row) => COUPON_TYPE_LABELS[row.type] || row.type,
        },
        {
          label: "Used",
          render: (row) => (
            <span>{row.used_count ?? 0}{row.usage_limit ? ` / ${row.usage_limit}` : ""}</span>
          ),
        },
        {
          label: "Valid Until",
          render: (row) =>
            row.ends_at ? formatDateTime(row.ends_at) : (
              <span className="filament-muted">No limit</span>
            ),
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
          row.status === COUPON_STATUS.ACTIVE
            ? COUPON_STATUS.INACTIVE
            : COUPON_STATUS.ACTIVE;

        return updateCoupon(row.uuid, { status: nextStatus });
      }}
      onCreate={() => navigate("/coupons/new")}
      createLabel="Create Coupon"
      permissions={{
        view: "coupons.view",
        create: "coupons.create",
        update: "coupons.update",
        delete: "coupons.delete",
      }}
      actions={[
        {
          type: "view",
          tooltip: "View",
          to: (row) => `/coupons/${row.uuid}`,
        },
        {
          type: "edit",
          tooltip: "Edit",
          to: (row) => `/coupons/${row.uuid}/edit`,
        },
        {
          type: "delete",
          tooltip: "Delete",
          onDelete: async (row) => deleteCoupon(row.uuid),
        },
      ]}
      bulkActions={[
        {
          label: "Bulk Activate",
          run: async (ids) =>
            bulkUpdateCouponStatus(ids, COUPON_STATUS.ACTIVE),
        },
        {
          label: "Bulk Deactivate",
          run: async (ids) =>
            bulkUpdateCouponStatus(ids, COUPON_STATUS.INACTIVE),
        },
      ]}
    />
  );
}