import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { getGiftCard } from "../services/giftCards";
import Breadcrumb from "../components/Breadcrumb";
import { useAuth } from "../context/AuthContext";
import { formatCurrency, formatDateTime } from "@shared/constants";

export default function GiftCardView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();

  const [card, setCard] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!id || id === "undefined" || id === "null") {
      navigate("/gift-cards", { replace: true });
      return;
    }

    let active = true;

    const run = async () => {
      setLoading(true);
      setMessage("");

      try {
        const data = await getGiftCard(id);

        if (!active) {
          return;
        }

        if (data.success) {
          setCard(data.giftCard);
          setTransactions(data.transactions || []);
        } else {
          setMessage(data.message || "Gift card not found");
        }
      } catch {
        if (!active) {
          return;
        }

        setMessage("Unable to connect to the server. Please try again.");
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    run();

    return () => {
      active = false;
    };
  }, [id, navigate]);

  return (
    <div className="filament-page">
      <Breadcrumb
        items={[
          { label: "Gift Cards", to: "/gift-cards" },
          { label: card ? card.code : "View Gift Card" },
        ]}
      />

      {message && <div className="filament-alert">{message}</div>}

      <div className="filament-card">
        <div className="filament-card-header">
          <div className="filament-card-header-left">
            <h1>Gift Card Details</h1>
            <p className="filament-card-subtitle">
              Read-only overview plus the full balance ledger.
            </p>
          </div>
          <div className="filament-card-header-right">
            <button
              type="button"
              className="filament-btn filament-btn-outline"
              onClick={() => navigate("/gift-cards")}
            >
              ← Back
            </button>
            {card && can("gift_cards.update") && (
              <Link
                className="filament-btn filament-btn-primary"
                to={`/gift-cards/${card.uuid}/edit`}
              >
                Edit
              </Link>
            )}
          </div>
        </div>

        {loading ? (
          <div className="filament-empty">
            <div className="filament-spinner" />
          </div>
        ) : !card ? (
          <div className="filament-empty">
            <p>Gift card not found.</p>
          </div>
        ) : (
          <div className="view-body">
            <div className="view-head">
              <div>
                <h2>{card.code}</h2>
                <p>
                  Balance {formatCurrency(card.balance)} of {formatCurrency(card.initial_amount)}
                </p>
              </div>
              <span className="view-head-badges">
                <span
                  className={`filament-badge filament-badge-${String(card.status || "").toLowerCase()}`}
                >
                  <span className="filament-badge-dot" />
                  {card.status}
                </span>
              </span>
            </div>

            <h3 className="view-section-title">Card</h3>

            <div className="view-grid">
              <div className="view-box">
                <span className="view-box-label">Code</span>
                <span className="view-box-value">{card.code}</span>
              </div>
              <div className="view-box">
                <span className="view-box-label">Balance</span>
                <span className="view-box-value">{formatCurrency(card.balance)}</span>
              </div>
              <div className="view-box">
                <span className="view-box-label">Initial Amount</span>
                <span className="view-box-value">{formatCurrency(card.initial_amount)}</span>
              </div>
              <div className="view-box">
                <span className="view-box-label">Recipient</span>
                <span className="view-box-value">{card.recipient_email || "Anyone"}</span>
              </div>
              <div className="view-box">
                <span className="view-box-label">Expires</span>
                <span className="view-box-value">
                  {card.expires_at ? formatDateTime(card.expires_at) : "No limit"}
                </span>
              </div>
            </div>

            <h3 className="view-section-title">Ledger</h3>

            {transactions.length === 0 ? (
              <div className="filament-empty">
                <p>No movements yet.</p>
              </div>
            ) : (
              <div className="filament-table-wrap">
                <table className="filament-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Type</th>
                      <th>Order</th>
                      <th>Amount</th>
                      <th>Balance After</th>
                    </tr>
                  </thead>
                  <tbody>
                    {transactions.map((t) => (
                      <tr key={t.uuid}>
                        <td>{formatDateTime(t.created_at)}</td>
                        <td>{t.type}</td>
                        <td>{t.order_number || "—"}</td>
                        <td>{formatCurrency(t.amount)}</td>
                        <td>{formatCurrency(t.balance_after)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
