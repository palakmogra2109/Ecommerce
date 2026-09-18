import { useNavigate } from "react-router-dom";
import DataPage from "../components/DataPage";
import {
  listBrands,
  updateBrand,
  bulkUpdateBrandStatus,
  deleteBrand,
} from "../services/brands";
import { mediaUrl } from "../services/media";
import { BRAND_STATUS } from "@shared/constants";

export default function Brands() {
  const navigate = useNavigate();

  return (
    <DataPage
      title="Brands"
      searchPlaceholder="Search by name or slug"
      filters={[
        {
          key: "status",
          label: "All statuses",
          options: [
            { value: BRAND_STATUS.ACTIVE, label: "Active" },
            { value: BRAND_STATUS.INACTIVE, label: "Inactive" },
          ],
        },
      ]}
      fetchData={({ search, filters, page, limit }) =>
        listBrands({
          search,
          status: filters.status,
          page,
          limit,
        })
      }
      dataKey="brands"
      columns={[
        {
          label: "Name",
          sortKey: "name",
          searchKeys: ["name"],
          render: (row) => (
            <span className="brand-name">
              {row.logo ? (
                <img src={mediaUrl(row.logo)} alt="" className="brand-logo" />
              ) : null}
              <strong>{row.name}</strong>
            </span>
          ),
        },
        {
          label: "Slug",
          sortKey: "slug",
          searchKeys: ["slug"],
          render: (row) => (
            <code style={{ fontSize: "13px" }}>{row.slug}</code>
          ),
        },
        {
          label: "Products",
          sortKey: "product_count",
          render: (row) => (
            <span className={`product-count${row.product_count === 0 ? " product-count-zero" : ""}`}>
              {row.product_count ?? 0}
            </span>
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
          row.status === BRAND_STATUS.ACTIVE
            ? BRAND_STATUS.INACTIVE
            : BRAND_STATUS.ACTIVE;

        return updateBrand(row.uuid, { status: nextStatus });
      }}
      onCreate={() => navigate("/brands/new")}
      createLabel="Create Brand"
      permissions={{
        view: "brands.view",
        create: "brands.create",
        update: "brands.update",
        delete: "brands.delete",
      }}
      actions={[
        {
          type: "view",
          tooltip: "View",
          to: (row) => `/brands/${row.uuid}`,
        },
        {
          type: "edit",
          tooltip: "Edit",
          to: (row) => `/brands/${row.uuid}/edit`,
        },
        {
          type: "delete",
          tooltip: "Delete",
          onDelete: async (row) => deleteBrand(row.uuid),
          disabled: (row) => row.product_count > 0,
          disabledReason: "This brand has products. Reassign them first.",
        },
      ]}
      bulkActions={[
        {
          label: "Bulk Activate",
          run: async (ids) =>
            bulkUpdateBrandStatus(ids, BRAND_STATUS.ACTIVE),
        },
        {
          label: "Bulk Deactivate",
          run: async (ids) =>
            bulkUpdateBrandStatus(ids, BRAND_STATUS.INACTIVE),
        },
      ]}
    />
  );
}