import { useNavigate } from "react-router-dom";
import DataPage from "../components/DataPage";
import {
  listCategories,
  updateCategory,
  bulkUpdateCategoryStatus,
  deleteCategory,
} from "../services/categories";
import { CATEGORY_STATUS } from "@shared/constants";
import { mediaUrl } from "../services/media";

export default function Categories() {
  const navigate = useNavigate();

  return (
    <DataPage
      title="Categories"
      searchPlaceholder="Search by name or slug"
      filters={[
        {
          key: "status",
          label: "All statuses",
          options: [
            { value: CATEGORY_STATUS.ACTIVE, label: "Active" },
            { value: CATEGORY_STATUS.INACTIVE, label: "Inactive" },
          ],
        },
      ]}
      fetchData={({ search, filters, page, limit }) =>
        listCategories({
          search,
          status: filters.status,
          type: "parent",
          page,
          limit,
        })
      }
      dataKey="categories"
      columns={[
        {
          label: "Name",
          sortKey: "name",
          searchKeys: ["name"],
          render: (row) => (
            <span className="product-thumb-name">
              {row.image ? (
                <img
                  src={mediaUrl(row.image)}
                  alt=""
                  className="product-thumb"
                />
              ) : null}
              <span>
                <strong>{row.name}</strong>
              </span>
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
          row.status === CATEGORY_STATUS.ACTIVE
            ? CATEGORY_STATUS.INACTIVE
            : CATEGORY_STATUS.ACTIVE;

        return updateCategory(row.uuid, { status: nextStatus });
      }}
      onCreate={() => navigate("/categories/new")}
      createLabel="Create Category"
      permissions={{
        view: "categories.view",
        create: "categories.create",
        update: "categories.update",
        delete: "categories.delete",
      }}
      actions={[
        {
          type: "view",
          tooltip: "View",
          to: (row) => `/categories/${row.uuid}`,
        },
        {
          type: "edit",
          tooltip: "Edit",
          to: (row) => `/categories/${row.uuid}/edit`,
        },
        {
          type: "delete",
          tooltip: "Delete",
          onDelete: async (row) => deleteCategory(row.uuid),
          disabled: (row) => row.product_count > 0,
          disabledReason:
            "This category has products. Reassign them first.",
        },
      ]}
      bulkActions={[
        {
          label: "Bulk Activate",
          run: async (ids) =>
            bulkUpdateCategoryStatus(ids, CATEGORY_STATUS.ACTIVE),
        },
        {
          label: "Bulk Deactivate",
          run: async (ids) =>
            bulkUpdateCategoryStatus(ids, CATEGORY_STATUS.INACTIVE),
        },
      ]}
    />
  );
}