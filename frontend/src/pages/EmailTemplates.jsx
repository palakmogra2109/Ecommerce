import { useNavigate } from "react-router-dom";
import DataPage from "../components/DataPage";
import {
  listEmailTemplates,
  updateEmailTemplate,
  bulkUpdateEmailTemplateStatus,
} from "../services/emailTemplates";
import { STATUS } from "@shared/constants";

export default function EmailTemplates() {
  const navigate = useNavigate();

  return (
    <DataPage
      title="Email Templates"
      searchPlaceholder="Search by name, slug or subject"
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
        listEmailTemplates({
          search,
          status: filters.status,
          page,
          limit,
        })
      }
      dataKey="templates"
      columns={[
        {
          label: "Name",
          sortKey: "name",
          searchKeys: ["name"],
          render: (row) => row.name,
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
          label: "Subject",
          sortKey: "subject",
          searchKeys: ["subject"],
          render: (row) => row.subject,
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
          row.status === STATUS.ACTIVE
            ? STATUS.INACTIVE
            : STATUS.ACTIVE;

        return updateEmailTemplate(row.uuid, { status: nextStatus });
      }}
      permissions={{
        view: "email_templates.view",
        create: "email_templates.create",
        update: "email_templates.update",
        delete: "email_templates.delete",
      }}
      actions={[
        {
          type: "edit",
          tooltip: "Edit",
          to: (row) => `/email-templates/${row.uuid}/edit`,
        },
      ]}
      bulkActions={[
        {
          label: "Bulk Activate",
          run: async (ids) =>
            bulkUpdateEmailTemplateStatus(ids, STATUS.ACTIVE),
        },
        {
          label: "Bulk Deactivate",
          run: async (ids) =>
            bulkUpdateEmailTemplateStatus(ids, STATUS.INACTIVE),
        },
      ]}
    />
  );
}