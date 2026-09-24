import DataPage from "../components/DataPage";
import {
  listStoreAccounts,
} from "../services/branches";
import { updateUser } from "../services/users";
import { STATUS } from "@shared/constants";
import { Link } from "react-router-dom";

export default function Stores() {
  return (
    <DataPage
      title="Stores"
      searchPlaceholder="Search by store name, email or mobile"
      filters={[
        {
          key: "status",
          label: "All statuses",
          options: [
            { value: STATUS.ACTIVE, label: "Active" },
            { value: STATUS.INACTIVE, label: "Inactive" },
          ],
        },
      ]}
      fetchData={({ search, filters, page, limit }) =>
        listStoreAccounts({
          search,
          status: filters.status,
          page,
          limit,
        })
      }
      dataKey="stores"
      permissions={{
        view: "branches.view",
        update: "branches.update",
      }}
      columns={[
        {
          label: "Store",
          sortKey: "name",
          searchKeys: ["name", "email"],
          render: (row) => (
            <div>
              <strong>{row.name}</strong>
              <br />
              <span style={{ fontSize: "12px", color: "#6b7280" }}>
                {row.email}
              </span>
            </div>
          ),
        },
        {
          label: "Mobile",
          sortKey: "mobile",
          searchKeys: ["mobile"],
          render: (row) => row.mobile || "—",
        },
        {
          label: "Branch",
          sortKey: "branches",
          searchKeys: ["branches"],
          render: (row) => {
            if (!row.branches || row.branches.length === 0) {
              return <span className="input-hint">No branch linked</span>;
            }

            return row.branches.map((b) => (
              <Link
                key={b.uuid}
                to={`/branches/${b.uuid}`}
                style={{ display: "block" }}
              >
                {b.name} <code style={{ fontSize: 11, color: "#6b7280" }}>{b.code}</code>
              </Link>
            ));
          },
        },
        {
          label: "Status",
          sortKey: "status",
          searchKeys: ["status"],
          type: "status",
        },
      ]}
      onStatusToggle={async (row) => {
        const nextStatus =
          row.status === STATUS.ACTIVE
            ? STATUS.INACTIVE
            : STATUS.ACTIVE;
        return updateUser(row.uuid, { status: nextStatus });
      }}
    />
  );
}