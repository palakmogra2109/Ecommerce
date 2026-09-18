import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { getAttribute } from "../services/attributes";
import Breadcrumb from "../components/Breadcrumb";
import { useAuth } from "../context/AuthContext";
import { formatDateTime } from "@shared/constants";

export default function AttributeView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();

  const [attribute, setAttribute] = useState(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!id || id === "undefined" || id === "null") {
      navigate("/attributes", { replace: true });
      return;
    }

    let active = true;

    const run = async () => {
      setLoading(true);
      setMessage("");

      try {
        const data = await getAttribute(id);

        if (!active) {
          return;
        }

        if (data.success) {
          setAttribute(data.attribute);
        } else {
          setMessage(data.message || "Attribute not found");
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
          { label: "Attributes", to: "/attributes" },
          { label: attribute ? attribute.name : "View Attribute" },
        ]}
      />

      {message && <div className="filament-alert">{message}</div>}

      <div className="filament-card">
        <div className="filament-card-header">
          <div className="filament-card-header-left">
            <h1>Attribute Details</h1>
            <p className="filament-card-subtitle">
              Read-only overview of this attribute.
            </p>
          </div>
          <div className="filament-card-header-right">
            <button
              type="button"
              className="filament-btn filament-btn-outline"
              onClick={() => navigate("/attributes")}
            >
              ← Back
            </button>
            {attribute && can("attributes.update") && (
              <Link
                className="filament-btn filament-btn-primary"
                to={`/attributes/${attribute.uuid}/edit`}
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
        ) : !attribute ? (
          <div className="filament-empty">
            <p>Attribute not found.</p>
          </div>
        ) : (
          <div className="view-body">
            <div className="view-head">
              <div>
                <h2>{attribute.name}</h2>
                <p>{attribute.slug}</p>
              </div>
              <span className="view-head-badges">
                <span
                  className={`filament-badge filament-badge-${String(attribute.status || "").toLowerCase()}`}
                >
                  <span className="filament-badge-dot" />
                  {attribute.status}
                </span>
              </span>
            </div>

            <div className="view-grid">
              <div className="view-box">
                <span className="view-box-label">Name</span>
                <span className="view-box-value">{attribute.name}</span>
              </div>
              <div className="view-box">
                <span className="view-box-label">Slug</span>
                <span className="view-box-value">{attribute.slug}</span>
              </div>
              <div className="view-box">
                <span className="view-box-label">Status</span>
                <span className="view-box-value">{attribute.status}</span>
              </div>
              <div className="view-box">
                <span className="view-box-label">Created</span>
                <span className="view-box-value">
                  {formatDateTime(attribute.created_at)}
                </span>
              </div>
              <div className="view-box">
                <span className="view-box-label">Updated</span>
                <span className="view-box-value">
                  {formatDateTime(attribute.updated_at)}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}