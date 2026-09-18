import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { getCoupon } from "../services/coupons";
import Breadcrumb from "../components/Breadcrumb";
import { useAuth } from "../context/AuthContext";
import {
  COUPON_TYPE,
  COUPON_TYPE_LABELS,
  formatCurrency,
  formatDateTime,
} from "@shared/constants";

function formatValue(coupon) {
  if (coupon.type === COUPON_TYPE.FIXED) {
    return formatCurrency(coupon.value);
  }

  return `${coupon.value}%`;
}

export default function CouponView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();

  const [coupon, setCoupon] = useState(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!id || id === "undefined" || id === "null") {
      navigate("/coupons", { replace: true });
      return;
    }

    let active = true;

    const run = async () => {
      setLoading(true);
      setMessage("");

      try {
        const data = await getCoupon(id);

        if (!active) {
          return;
        }

        if (data.success) {
          setCoupon(data.coupon);
        } else {
          setMessage(data.message || "Coupon not found");
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
          { label: "Coupons", to: "/coupons" },
          { label: coupon ? coupon.code : "View Coupon" },
        ]}
      />

      {message && <div className="filament-alert">{message}</div>}

      <div className="filament-card">
        <div className="filament-card-header">
          <div className="filament-card-header-left">
            <h1>Coupon Details</h1>
            <p className="filament-card-subtitle">
              Read-only overview of this coupon.
            </p>
          </div>
          <div className="filament-card-header-right">
            <button
              type="button"
              className="filament-btn filament-btn-outline"
              onClick={() => navigate("/coupons")}
            >
              ← Back
            </button>
            {coupon && can("coupons.update") && (
              <Link
                className="filament-btn filament-btn-primary"
                to={`/coupons/${coupon.uuid}/edit`}
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
        ) : !coupon ? (
          <div className="filament-empty">
            <p>Coupon not found.</p>
          </div>
        ) : (
          <div className="view-body">
            <div className="view-head">
              <div>
                <h2>{coupon.code}</h2>
                <p>
                  {COUPON_TYPE_LABELS[coupon.type] || coupon.type} ·{" "}
                  {formatValue(coupon)}
                </p>
              </div>
              <span className="view-head-badges">
                <span
                  className={`filament-badge filament-badge-${String(coupon.status || "").toLowerCase()}`}
                >
                  <span className="filament-badge-dot" />
                  {coupon.status}
                </span>
              </span>
            </div>

            <h3 className="view-section-title">Discount</h3>

            <div className="view-grid">
              <div className="view-box">
                <span className="view-box-label">Code</span>
                <span className="view-box-value">{coupon.code}</span>
              </div>
              <div className="view-box">
                <span className="view-box-label">Type</span>
                <span className="view-box-value">
                  {COUPON_TYPE_LABELS[coupon.type] || coupon.type}
                </span>
              </div>
              <div className="view-box">
                <span className="view-box-label">Value</span>
                <span className="view-box-value">{formatValue(coupon)}</span>
              </div>
              <div className="view-box">
                <span className="view-box-label">Minimum Order</span>
                <span className="view-box-value">
                  {formatCurrency(coupon.min_order_amount)}
                </span>
              </div>
              <div className="view-box">
                <span className="view-box-label">Maximum Discount</span>
                <span className="view-box-value">
                  {coupon.max_discount_amount == null
                    ? "—"
                    : formatCurrency(coupon.max_discount_amount)}
                </span>
              </div>
            </div>

            <h3 className="view-section-title">Validity &amp; Usage</h3>

            <div className="view-grid">
              <div className="view-box">
                <span className="view-box-label">Starts At</span>
                <span className="view-box-value">
                  {coupon.starts_at ? formatDateTime(coupon.starts_at) : "—"}
                </span>
              </div>
              <div className="view-box">
                <span className="view-box-label">Ends At</span>
                <span className="view-box-value">
                  {coupon.ends_at ? formatDateTime(coupon.ends_at) : "—"}
                </span>
              </div>
              <div className="view-box">
                <span className="view-box-label">Usage Limit</span>
                <span className="view-box-value">
                  {coupon.usage_limit == null ? "Unlimited" : coupon.usage_limit}
                </span>
              </div>
              <div className="view-box">
                <span className="view-box-label">Used</span>
                <span className="view-box-value">{coupon.used_count ?? 0}</span>
              </div>
              <div className="view-box">
                <span className="view-box-label">Per Customer Limit</span>
                <span className="view-box-value">
                  {coupon.per_customer_limit == null
                    ? "Unlimited"
                    : coupon.per_customer_limit}
                </span>
              </div>
              <div className="view-box view-box-full">
                <span className="view-box-label">Description</span>
                <span className="view-box-value view-longtext">
                  {coupon.description || "—"}
                </span>
              </div>
              <div className="view-box">
                <span className="view-box-label">Created</span>
                <span className="view-box-value">
                  {formatDateTime(coupon.created_at)}
                </span>
              </div>
              <div className="view-box">
                <span className="view-box-label">Updated</span>
                <span className="view-box-value">
                  {formatDateTime(coupon.updated_at)}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}