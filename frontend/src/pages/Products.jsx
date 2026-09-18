import { useNavigate } from "react-router-dom";
import DataPage from "../components/DataPage";
import {
  listProducts,
  updateProduct,
  deleteProduct,
} from "../services/products";
import { mediaUrl } from "../services/media";
import { PRODUCT_STATUS, formatCurrency } from "@shared/constants";

export default function Products() {
  const navigate = useNavigate();

  return (
    <DataPage
      title="Products"
      searchPlaceholder="Search by name, SKU or slug"
      filters={[
        {
          key: "status",
          label: "All statuses",
          options: [
            { value: PRODUCT_STATUS.DRAFT, label: "Draft" },
            { value: PRODUCT_STATUS.ACTIVE, label: "Active" },
            { value: PRODUCT_STATUS.INACTIVE, label: "Inactive" },
            { value: PRODUCT_STATUS.ARCHIVED, label: "Archived" },
          ],
        },
        {
          key: "featured",
          label: "All products",
          options: [
            { value: "true", label: "Featured only" },
            { value: "false", label: "Not featured" },
          ],
        },
      ]}
      fetchData={({ search, filters, page, limit }) =>
        listProducts({
          search,
          status: filters.status,
          featured: filters.featured,
          page,
          limit,
        })
      }
      dataKey="products"
      columns={[
        {
          label: "Product",
          sortKey: "name",
          searchKeys: ["name"],
          render: (row) => (
            <span className="product-thumb-name">
              {row.images && row.images.length > 0 ? (
                <img
                  src={mediaUrl(row.images[0])}
                  alt=""
                  className="product-thumb"
                />
              ) : null}
              <span>
                <strong>{row.name}</strong>
                {row.sku && (
                  <span className="filament-muted"> · {row.sku}</span>
                )}
              </span>
            </span>
          ),
        },
        {
          label: "Category",
          sortKey: "category_name",
          render: (row) =>
            row.category_name || <span className="filament-muted">—</span>,
        },
        {
          label: "Brand",
          sortKey: "brand_name",
          render: (row) =>
            row.brand_name || <span className="filament-muted">—</span>,
        },
        {
          label: "Price",
          sortKey: "price",
          render: (row) => {
            if (row.discount_price) {
              return (
                <span>
                  <strong>{formatCurrency(row.discount_price)}</strong>{" "}
                  <span className="price-old">{formatCurrency(row.price)}</span>
                </span>
              );
            }
            return <strong>{formatCurrency(row.price)}</strong>;
          },
        },
        {
          label: "Stock",
          sortKey: "stock",
          render: (row) => (
            <span
              className={`stock-badge${
                row.stock <= row.low_stock_threshold
                  ? " stock-badge-low"
                  : ""
              }${row.stock === 0 ? " stock-badge-out" : ""}`}
            >
              {row.stock}
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
      onCreate={() => navigate("/products/new")}
      createLabel="Create Product"
      permissions={{
        view: "products.view",
        create: "products.create",
        update: "products.update",
        delete: "products.delete",
      }}
      actions={[
        {
          type: "view",
          tooltip: "View",
          to: (row) => `/products/${row.uuid}`,
        },
        {
          type: "edit",
          tooltip: "Edit",
          to: (row) => `/products/${row.uuid}/edit`,
        },
        {
          type: "delete",
          tooltip: "Delete",
          onDelete: async (row) => deleteProduct(row.uuid),
          disabled: (row) => row.status === PRODUCT_STATUS.ACTIVE,
          disabledReason:
            "Archive or deactivate an active product before deleting it.",
        },
      ]}
      bulkActions={[
        {
          label: "Activate",
          run: async (ids) => {
            let count = 0;
            for (const id of ids) {
              const r = await updateProduct(id, { status: PRODUCT_STATUS.ACTIVE });
              if (r?.success) count += 1;
            }
            return { message: `${count} product(s) activated` };
          },
        },
        {
          label: "Deactivate",
          run: async (ids) => {
            let count = 0;
            for (const id of ids) {
              const r = await updateProduct(id, { status: PRODUCT_STATUS.INACTIVE });
              if (r?.success) count += 1;
            }
            return { message: `${count} product(s) deactivated` };
          },
        },
        {
          label: "Archive",
          run: async (ids) => {
            let count = 0;
            for (const id of ids) {
              const r = await updateProduct(id, { status: PRODUCT_STATUS.ARCHIVED });
              if (r?.success) count += 1;
            }
            return { message: `${count} product(s) archived` };
          },
        },
      ]}
    />
  );
}