import { useState } from "react";
import DataPage from "../components/DataPage";
import { listSuppliers } from "../services/purchases";
import SupplierForm from "./SupplierForm";
import SupplierBankPopup from "./SupplierBankPopup";

// Suppliers list. Detail and editing live on /suppliers/:uuid, matching the
// gift-card and purchase-invoice pages.
export default function Suppliers() {
  const [editing, setEditing] = useState(null);
  const [bankFor, setBankFor] = useState(null);
  // Bumped on save so the table refetches instead of showing a stale list.
  const [refreshToken, setRefreshToken] = useState(0);

  return (
    <>
      <DataPage
        title="Suppliers"
        breadcrumb={[{ label: "Dashboard", to: "/dashboard" }, { label: "Suppliers" }]}
        searchPlaceholder="Search name, email, phone or GSTIN…"
        filters={[
          {
            key: "status",
            label: "Status",
            options: [
              { value: "active", label: "Active" },
              { value: "inactive", label: "Inactive" },
            ],
          },
        ]}
        fetchData={async ({ search, filters, page, limit }) => {
          const data = await listSuppliers({ search, status: filters?.status, page, limit });
          // DataPage's status column reads row.status and ignores column.render, so
          // the value has to be on the row. Without this the Status cell rendered
          // an empty badge and was not searchable.
          const suppliers = (data.suppliers || []).map((row) => ({
            ...row,
            status: row.is_active ? "ACTIVE" : "INACTIVE",
          }));
          return { success: data.success, suppliers, pagination: data.pagination };
        }}
        dataKey="suppliers"
        getKey={(row) => row.uuid}
        permissions={{
          view: "suppliers.view",
          create: "suppliers.create",
          update: "suppliers.update",
          delete: "suppliers.delete",
        }}
        refreshToken={refreshToken}
        createLabel="New Supplier"
        onCreate={() => setEditing({ __new: true })}
        columns={[
          {
            label: "Supplier",
            render: (row) => (
              <>
                <strong>{row.name}</strong>
                {row.contact_name && <small>{row.contact_name}</small>}
              </>
            ),
          },
          {
            label: "Contact",
            render: (row) => (
              <>
                <div>{row.email || "—"}</div>
                <small>{row.phone || ""}</small>
              </>
            ),
          },
          { label: "GSTIN / tax ID", render: (row) => row.gstin || "—" },
          {
            label: "Terms",
            render: (row) => `${row.payment_terms_days} days`,
          },
          {
            label: "Status",
            type: "status",
            render: (row) => (row.is_active ? "ACTIVE" : "INACTIVE"),
          },
        ]}
        extraRowActions={[
          {
            // Its own bank glyph, distinct from the view and delete icons
            // DataPage draws, so it cannot be mistaken for either.
            permission: "suppliers.bank.view",
            tooltip: "Bank details",
            icon: "bank",
            onClick: (row) => setBankFor(row),
          },
        ]}
        actions={[
          {
            type: "view",
            permission: "suppliers.view",
            tooltip: "View supplier",
            to: (row) => `/suppliers/${row.uuid}`,
          },
          {
            type: "edit",
            permission: "suppliers.update",
            tooltip: "Edit supplier",
            to: (row) => `/suppliers/${row.uuid}/edit`,
          },
        ]}
      />
      {bankFor && (
        <SupplierBankPopup supplier={bankFor} onClose={() => setBankFor(null)} />
      )}
      {editing && (
        <SupplierForm
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            setRefreshToken((n) => n + 1);
          }}
        />
      )}
    </>
  );
}