import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { getBanner } from "../services/banners";
import { mediaUrl } from "../services/media";
import Breadcrumb from "../components/Breadcrumb";
import { useAuth } from "../context/AuthContext";
import { BANNER_POSITIONS_LABELS, formatDateTime } from "@shared/constants";

export default function BannerView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();

  const [banner, setBanner] = useState(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!id || id === "undefined" || id === "null") {
      navigate("/banners", { replace: true });
      return;
    }

    let active = true;

    const run = async () => {
      setLoading(true);
      setMessage("");

      try {
        const data = await getBanner(id);

        if (!active) {
          return;
        }

        if (data.success) {
          setBanner(data.banner);
        } else {
          setMessage(data.message || "Banner not found");
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
          { label: "Banners", to: "/banners" },
          { label: banner ? banner.title : "View Banner" },
        ]}
      />

      {message && <div className="filament-alert">{message}</div>}

      <div className="filament-card">
        <div className="filament-card-header">
          <div className="filament-card-header-left">
            <h1>Banner Details</h1>
            <p className="filament-card-subtitle">
              Read-only overview of this banner.
            </p>
          </div>
          <div className="filament-card-header-right">
            <button
              type="button"
              className="filament-btn filament-btn-outline"
              onClick={() => navigate("/banners")}
            >
              ← Back
            </button>
            {banner && can("banners.update") && (
              <Link
                className="filament-btn filament-btn-primary"
                to={`/banners/${banner.uuid}/edit`}
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
        ) : !banner ? (
          <div className="filament-empty">
            <p>Banner not found.</p>
          </div>
        ) : (
          <div className="view-body">
            <div className="view-head">
              {banner.image ? (
                <img
                  className="view-thumb view-thumb-wide"
                  src={mediaUrl(banner.image)}
                  alt={banner.title}
                />
              ) : null}
              <div>
                <h2>{banner.title}</h2>
                <p>
                  {BANNER_POSITIONS_LABELS[banner.position] || banner.position}
                </p>
              </div>
              <span className="view-head-badges">
                <span
                  className={`filament-badge filament-badge-${String(banner.status || "").toLowerCase()}`}
                >
                  <span className="filament-badge-dot" />
                  {banner.status}
                </span>
              </span>
            </div>

            <div className="view-grid">
              <div className="view-box">
                <span className="view-box-label">Title</span>
                <span className="view-box-value">{banner.title}</span>
              </div>
              <div className="view-box">
                <span className="view-box-label">Subtitle</span>
                <span className="view-box-value">{banner.subtitle || "—"}</span>
              </div>
              <div className="view-box">
                <span className="view-box-label">Position</span>
                <span className="view-box-value">
                  {BANNER_POSITIONS_LABELS[banner.position] || banner.position}
                </span>
              </div>
              <div className="view-box">
                <span className="view-box-label">Sort Order</span>
                <span className="view-box-value">
                  {banner.sort_order ?? 0}
                </span>
              </div>
              <div className="view-box view-box-full">
                <span className="view-box-label">Link</span>
                <span className="view-box-value">
                  {banner.link ? (
                    <a
                      href={banner.link}
                      target="_blank"
                      rel="noreferrer noopener"
                    >
                      {banner.link}
                    </a>
                  ) : (
                    "—"
                  )}
                </span>
              </div>
              <div className="view-box">
                <span className="view-box-label">Created</span>
                <span className="view-box-value">
                  {formatDateTime(banner.created_at)}
                </span>
              </div>
              <div className="view-box">
                <span className="view-box-label">Updated</span>
                <span className="view-box-value">
                  {formatDateTime(banner.updated_at)}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}