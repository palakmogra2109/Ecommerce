import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import DataPage from "../components/DataPage";
import {
  listAttributeValues,
  updateAttributeValue,
  bulkUpdateAttributeValueStatus,
  deleteAttributeValue,
} from "../services/attributeValues";
import { listAttributes } from "../services/attributes";
import { CATEGORY_STATUS } from "@shared/constants";

// Attribute values, listed per attribute. Mirrors SubCategories: same DataPage,
// same parent filter, same bulk activate/deactivate.
//
// `parent` is the attribute's uuid on the wire. parent_name arrives ready to
// render from the model's LEFT JOIN, so the column needs no client-side lookup.
export default function AttributeValues() {
  const navigate = useNavigate();
  const [parentOptions, setParentOptions] = useState([]);

  useEffect(() => {
    let active = true;

    const run = async () => {
      try {
        // Top-level attributes only — a value can never be the parent of another
        // value, so the picker must not offer them.
        const data = await listAttributes({ all: 1, type: "parent" });

        if (active && data.success) {
          setParentOptions(
            (data.attributes || []).map((a) => ({
              value: a.uuid,
              label: a.name,
            }))
          );
        }
      } catch {
        // Options are non-critical; ignore silently.
      }
    };

    run();

    return () => {
      active = false;
    };
  }, []);

  return (
    <DataPage
      title="Attribute Values"
      searchPlaceholder="Search by value, slug or attribute"
      filters={[
        {
          key: "status",
          label: "All statuses",
          options: [
            { value: CATEGORY_STATUS.ACTIVE, label: "Active" },
            { value: CATEGORY_STATUS.INACTIVE, label: "Inactive" },
          ],
        },
        {
          key: "parent",
          label: "All attributes",
          options: parentOptions,
        },
      ]}
      fetchData={({ search, filters, page, limit }) =>
        listAttributeValues({
          search,
          status: filters.status,
          parent: filters.parent,
          page,
          limit,
        })
      }
      dataKey="values"
      columns={[
        {
          label: "Value",
          sortKey: "name",
          searchKeys: ["name"],
          render: (row) => <strong>{row.name}</strong>,
        },
        {
          label: "Attribute",
          sortKey: "parent_name",
          searchKeys: ["parent_name"],
          render: (row) =>
            row.parent_name || <span className="filament-muted">—</span>,
        },
        {
          label: "Slug",
          sortKey: "slug",
          searchKeys: ["slug"],
          render: (row) => <code style={{ fontSize: "13px" }}>{row.slug}</code>,
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

        return updateAttributeValue(row.uuid, { status: nextStatus });
      }}
      onCreate={() => navigate("/attribute-values/new")}
      createLabel="Create Value"
      headerExtras={
        parentOptions.length === 0 && (
          <button
            type="button"
            className="filament-btn filament-btn-outline"
            onClick={() => navigate("/attributes")}
          >
            Create an attribute first
          </button>
        )
      }
      bulkActions={[
        {
          label: "Activate",
          run: (ids) => bulkUpdateAttributeValueStatus(ids, "ACTIVE"),
        },
        {
          label: "Deactivate",
          run: (ids) => bulkUpdateAttributeValueStatus(ids, "INACTIVE"),
        },
      ]}
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
          to: (row) => `/attribute-values/${row.uuid}`,
        },
        {
          type: "delete",
          tooltip: "Delete",
          onDelete: async (row) => deleteAttributeValue(row.uuid),
        },
      ]}
    />
  );
}
