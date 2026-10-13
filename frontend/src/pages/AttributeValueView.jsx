import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { getAttributeValue } from "../services/attributeValues";
import Breadcrumb from "../components/Breadcrumb";
import { useAuth } from "../context/AuthContext";
import { formatDateTime } from "@shared/constants";

// Read-only overview of one attribute value. Mirrors AttributeView.
//
// The parent attribute is shown by name, with the numeric parent_id beside it —
// the same pairing the create/edit form exposes, so the link is visible in both
// places rather than only being implied by the dropdown.
export default function AttributeValueView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();

  const [value, setValue] = useState(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!id || id === "undefined" || id === "null") {
      navigate("/attribute-values", { replace: true });
      return;
    }

    let active = true;

    const run = async () => {
      setLoading(true);
      setMessage("");

      try {
        const data = await getAttributeValue(id);

        if (!active) {
          return;
        }

        if (data.success) {
          setValue(data.value);
        } else {
          setMessage(data.message || "Attribute value not found");
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
          { label: "Attribute Values", to: "/attribute-values" },
          { label: value ? value.name : "View Value" },
        ]}
      />

      {message && <div className="filament-alert">{message}</div>}

      <div className="filament-card">
        <div className="filament-card-header">
          <div className="filament-card-header-left">
            <h1>Attribute Value Details</h1>
            <p className="filament-card-subtitle">
              Read-only overview of this value.
            </p>
          </div>
          <div className="filament-card-header-right">
            <button
              type="button"
              className="filament-btn filament-btn-outline"
              onClick={() => navigate("/attribute-values")}
            >
              ← Back
            </button>
            {value && can("attributes.update") && (
              <Link
                className="filament-btn filament-btn-primary"
                to={`/attribute-values/${value.uuid}/edit`}
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
        ) : !value ? (
          <div className="filament-empty">
            <p>Attribute value not found.</p>
          </div>
        ) : (
          <div className="view-body">
            <div className="view-head">
              <div>
                <h2>{value.name}</h2>
                <p>{value.slug}</p>
              </div>
              <span className="view-head-badges">
                <span
                  className={`filament-badge filament-badge-${String(value.status || "").toLowerCase()}`}
                >
                  <span className="filament-badge-dot" />
                  {value.status}
                </span>
              </span>
            </div>

            <div className="view-grid">
              <div className="view-box">
                <span className="view-box-label">Value</span>
                <span className="view-box-value">{value.name}</span>
              </div>
              <div className="view-box">
                <span className="view-box-label">Attribute</span>
                <span className="view-box-value">
                  {value.parent_name || "—"}
                </span>
              </div>
              {/* The dropdown chooses the parent by name; this is the numeric id
                  it resolved to, so the relationship is auditable here too. */}
              <div className="view-box">
                <span className="view-box-label">Parent ID</span>
                <span className="view-box-value">
                  <code style={{ fontSize: "13px" }}>
                    {value.parent_id ?? "—"}
                  </code>
                </span>
              </div>
              <div className="view-box">
                <span className="view-box-label">Slug</span>
                <span className="view-box-value">{value.slug}</span>
              </div>
              <div className="view-box">
                <span className="view-box-label">Status</span>
                <span className="view-box-value">{value.status}</span>
              </div>
              <div className="view-box">
                <span className="view-box-label">Created</span>
                <span className="view-box-value">
                  {formatDateTime(value.created_at)}
                </span>
              </div>
              <div className="view-box">
                <span className="view-box-label">Updated</span>
                <span className="view-box-value">
                  {formatDateTime(value.updated_at)}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
