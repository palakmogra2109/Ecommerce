import { useNavigate } from "react-router-dom";
import DataPage from "../components/DataPage";
import { mediaUrl } from "../services/media";
import {
  listBanners,
  updateBanner,
  bulkUpdateBannerStatus,
  deleteBanner,
} from "../services/banners";
import {
  BANNER_STATUS,
  BANNER_POSITIONS_LABELS,
  formatDateTime,
} from "@shared/constants";

export default function Banners() {
  const navigate = useNavigate();

  return (
    <DataPage
      title="Banners"
      searchPlaceholder="Search by title or subtitle"
      filters={[
        {
          key: "status",
          label: "All statuses",
          options: [
            { value: BANNER_STATUS.ACTIVE, label: "Active" },
            { value: BANNER_STATUS.INACTIVE, label: "Inactive" },
          ],
        },
        {
          key: "position",
          label: "All positions",
          options: Object.entries(BANNER_POSITIONS_LABELS).map(
            ([value, label]) => ({ value, label })
          ),
        },
      ]}
      fetchData={({ search, filters, page, limit }) =>
        listBanners({
          search,
          status: filters.status,
          position: filters.position,
          page,
          limit,
        })
      }
      dataKey="banners"
      columns={[
        {
          label: "Image",
          sortKey: "title",
          render: (row) => (
            <span className="product-thumb-name">
              {row.image ? (
                <img
                  src={mediaUrl(row.image)}
                  alt={row.title}
                  className="product-thumb"
                  loading="lazy"
                />
              ) : null}
              <span>
                <strong>{row.title}</strong>
                {row.subtitle && (
                  <span className="filament-muted"> · {row.subtitle}</span>
                )}
              </span>
            </span>
          ),
        },
        {
          label: "Position",
          sortKey: "position",
          searchKeys: ["position"],
          render: (row) =>
            BANNER_POSITIONS_LABELS[row.position] || row.position,
        },
        {
          label: "Sort",
          sortKey: "sort_order",
          render: (row) => row.sort_order,
        },
        {
          type: "status",
          label: "Status",
          sortKey: "status",
          searchKeys: ["status"],
        },
        {
          label: "Updated",
          render: (row) => formatDateTime(row.updated_at),
        },
      ]}
      onStatusToggle={async (row) => {
        const nextStatus =
          row.status === BANNER_STATUS.ACTIVE
            ? BANNER_STATUS.INACTIVE
            : BANNER_STATUS.ACTIVE;

        return updateBanner(row.uuid, { status: nextStatus });
      }}
      onCreate={() => navigate("/banners/new")}
      createLabel="Create Banner"
      permissions={{
        view: "banners.view",
        create: "banners.create",
        update: "banners.update",
        delete: "banners.delete",
      }}
      actions={[
        {
          type: "view",
          tooltip: "View",
          to: (row) => `/banners/${row.uuid}`,
        },
        {
          type: "edit",
          tooltip: "Edit",
          to: (row) => `/banners/${row.uuid}/edit`,
        },
        {
          type: "delete",
          tooltip: "Delete",
          onDelete: async (row) => deleteBanner(row.uuid),
        },
      ]}
      bulkActions={[
        {
          label: "Bulk Activate",
          run: async (ids) => bulkUpdateBannerStatus(ids, BANNER_STATUS.ACTIVE),
        },
        {
          label: "Bulk Deactivate",
          run: async (ids) => bulkUpdateBannerStatus(ids, BANNER_STATUS.INACTIVE),
        },
      ]}
    />
  );
}