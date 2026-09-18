import { useNavigate } from "react-router-dom";
import DataPage from "../components/DataPage";
import {
  listAttributes,
  updateAttribute,
  deleteAttribute,
} from "../services/attributes";
import { ATTRIBUTE_STATUS } from "@shared/constants";

export default function Attributes() {
  const navigate = useNavigate();

  return (
    <DataPage
      title="Attributes"
      searchPlaceholder="Search by name or slug"
      filters={[
        {
          key: "status",
          label: "All statuses",
          options: [
            { value: ATTRIBUTE_STATUS.ACTIVE, label: "Active" },
            { value: ATTRIBUTE_STATUS.INACTIVE, label: "Inactive" },
          ],
        },
      ]}
      fetchData={({ search, filters, page, limit }) =>
        listAttributes({
          search,
          status: filters.status,
          page,
          limit,
        })
      }
      dataKey="attributes"
      columns={[
        {
          label: "Name",
          sortKey: "name",
          searchKeys: ["name"],
          render: (row) => <strong>{row.name}</strong>,
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
          type: "status",
          label: "Status",
          sortKey: "status",
          searchKeys: ["status"],
        },
      ]}
      onStatusToggle={async (row) => {
        const nextStatus =
          row.status === ATTRIBUTE_STATUS.ACTIVE
            ? ATTRIBUTE_STATUS.INACTIVE
            : ATTRIBUTE_STATUS.ACTIVE;

        return updateAttribute(row.uuid, { status: nextStatus });
      }}
      onCreate={() => navigate("/attributes/new")}
      createLabel="Create Attribute"
      permissions={{
        view: "attributes.view",
        create: "attributes.create",
        update: "attributes.update",
        delete: "attributes.delete",
      }}
      actions={[
        {
          type: "view",
          tooltip: "View",
          to: (row) => `/attributes/${row.uuid}`,
        },
        {
          type: "edit",
          tooltip: "Edit",
          to: (row) => `/attributes/${row.uuid}/edit`,
        },
        {
          type: "delete",
          tooltip: "Delete",
          onDelete: async (row) => deleteAttribute(row.uuid),
        },
      ]}
    />
  );
}