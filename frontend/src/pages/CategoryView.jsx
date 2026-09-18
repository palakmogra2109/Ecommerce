import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { getCategory } from "../services/categories";
import { mediaUrl } from "../services/media";
import Breadcrumb from "../components/Breadcrumb";
import { useAuth } from "../context/AuthContext";
import { formatDateTime } from "@shared/constants";

export default function CategoryView({ subCategory = false }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();

  const basePath = subCategory ? "/sub-categories" : "/categories";
  const entityLabel = subCategory ? "Sub Category" : "Category";

  const [category, setCategory] = useState(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!id || id === "undefined" || id === "null") {
      navigate(basePath, { replace: true });
      return;
    }

    let active = true;

    const run = async () => {
      setLoading(true);
      setMessage("");

      try {
        const data = await getCategory(id);

        if (!active) {
          return;
        }

        if (data.success) {
          setCategory(data.category);
        } else {
          setMessage(data.message || `${entityLabel} not found`);
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
  }, [id, navigate, basePath, entityLabel]);

  return (
    <div className="filament-page">
      <Breadcrumb
        items={[
          { label: subCategory ? "Sub Categories" : "Categories", to: basePath },
          { label: category ? category.name : `View ${entityLabel}` },
        ]}
      />

      {message && <div className="filament-alert">{message}</div>}

      <div className="filament-card">
        <div className="filament-card-header">
          <div className="filament-card-header-left">
            <h1>{entityLabel} Details</h1>
            <p className="filament-card-subtitle">
              Read-only overview of this {entityLabel.toLowerCase()}.
            </p>
          </div>
          <div className="filament-card-header-right">
            <button
              type="button"
              className="filament-btn filament-btn-outline"
              onClick={() => navigate(basePath)}
            >
              ← Back
            </button>
            {category && can("categories.update") && (
              <Link
                className="filament-btn filament-btn-primary"
                to={`${basePath}/${category.uuid}/edit`}
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
        ) : !category ? (
          <div className="filament-empty">
            <p>{entityLabel} not found.</p>
          </div>
        ) : (
          <div className="view-body">
            <div className="view-head">
              {category.image ? (
                <img
                  className="view-thumb"
                  src={mediaUrl(category.image)}
                  alt={category.name}
                />
              ) : null}
              <div>
                <h2>{category.name}</h2>
                <p>{category.slug}</p>
              </div>
              <span className="view-head-badges">
                <span
                  className={`filament-badge filament-badge-${String(category.status || "").toLowerCase()}`}
                >
                  <span className="filament-badge-dot" />
                  {category.status}
                </span>
              </span>
            </div>

            <div className="view-grid">
              <div className="view-box">
                <span className="view-box-label">Name</span>
                <span className="view-box-value">{category.name}</span>
              </div>
              <div className="view-box">
                <span className="view-box-label">Slug</span>
                <span className="view-box-value">{category.slug}</span>
              </div>
              {!subCategory && (
                <div className="view-box">
                  <span className="view-box-label">Sub Categories</span>
                  <span className="view-box-value">
                    {category.child_count ??
                      category.children_count ??
                      "—"}
                  </span>
                </div>
              )}
              <div className="view-box">
                <span className="view-box-label">Products</span>
                <span className="view-box-value">
                  {category.product_count ?? 0}
                </span>
              </div>
              <div className="view-box">
                <span className="view-box-label">Sort Order</span>
                <span className="view-box-value">{category.sort_order ?? 0}</span>
              </div>
              <div className="view-box">
                <span className="view-box-label">Created</span>
                <span className="view-box-value">
                  {formatDateTime(category.created_at)}
                </span>
              </div>
              <div className="view-box">
                <span className="view-box-label">Updated</span>
                <span className="view-box-value">
                  {formatDateTime(category.updated_at)}
                </span>
              </div>
              {category.parent_name && (
                <div className="view-box">
                  <span className="view-box-label">Parent Category</span>
                  <span className="view-box-value">
                    {category.parent_uuid ? (
                      <Link to={`/categories/${category.parent_uuid}`}>
                        {category.parent_name}
                      </Link>
                    ) : (
                      category.parent_name
                    )}
                  </span>
                </div>
              )}
              <div className="view-box view-box-full">
                <span className="view-box-label">Description</span>
                <span className="view-box-value view-longtext">
                  {category.description || "—"}
                </span>
              </div>
            </div>

            <h3 className="view-section-title">
              Search Engine Optimisation
            </h3>

            <div className="view-grid">
              <div className="view-box">
                <span className="view-box-label">Meta Title</span>
                <span className="view-box-value">
                  {category.meta_title || "—"}
                </span>
              </div>
              <div className="view-box">
                <span className="view-box-label">Meta Description</span>
                <span className="view-box-value view-longtext">
                  {category.meta_description || "—"}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}