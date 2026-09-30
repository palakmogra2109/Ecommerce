import { useNavigate } from "react-router-dom";
import DataPage from "../components/DataPage";
import {
  listGiftCards,
  updateGiftCard,
  deleteGiftCard,
} from "../services/giftCards";
import {
  GIFT_CARD_STATUS,
  formatCurrency,
  formatDateTime,
} from "@shared/constants";

export default function GiftCards() {
  const navigate = useNavigate();

  return (
    <DataPage
      title="Gift Cards"
      searchPlaceholder="Search by code or recipient email"
      filters={[
        {
          key: "status",
          label: "All statuses",
          options: [
            { value: GIFT_CARD_STATUS.ACTIVE, label: "Active" },
            { value: GIFT_CARD_STATUS.INACTIVE, label: "Inactive" },
            { value: GIFT_CARD_STATUS.REDEEMED, label: "Redeemed" },
          ],
        },
      ]}
      fetchData={({ search, filters, page, limit }) =>
        listGiftCards({
          search,
          status: filters.status,
          page,
          limit,
        })
      }
      dataKey="giftCards"
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
          label: "Balance",
          sortKey: "balance",
          render: (row) => (
            <span>{formatCurrency(row.balance)} <span className="filament-muted">/ {formatCurrency(row.initial_amount)}</span></span>
          ),
        },
        {
          label: "Recipient",
          searchKeys: ["recipient_email"],
          render: (row) => (
            row.recipient_email || <span className="filament-muted">Anyone</span>
          ),
        },
        {
          label: "Expires",
          render: (row) =>
            row.expires_at ? formatDateTime(row.expires_at) : (
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
          row.status === GIFT_CARD_STATUS.ACTIVE
            ? GIFT_CARD_STATUS.INACTIVE
            : GIFT_CARD_STATUS.ACTIVE;

        return updateGiftCard(row.uuid, { status: nextStatus });
      }}
      onCreate={() => navigate("/gift-cards/new")}
      createLabel="Issue Gift Card"
      permissions={{
        view: "gift_cards.view",
        create: "gift_cards.create",
        update: "gift_cards.update",
        delete: "gift_cards.delete",
      }}
      actions={[
        {
          type: "view",
          tooltip: "View",
          to: (row) => `/gift-cards/${row.uuid}`,
        },
        {
          type: "edit",
          tooltip: "Edit",
          to: (row) => `/gift-cards/${row.uuid}/edit`,
        },
        {
          type: "delete",
          tooltip: "Delete",
          onDelete: async (row) => deleteGiftCard(row.uuid),
        },
      ]}
    />
  );
}
