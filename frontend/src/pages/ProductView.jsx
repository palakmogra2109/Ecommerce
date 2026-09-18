import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { getProduct } from "../services/products";
import { mediaUrl } from "../services/media";
import Breadcrumb from "../components/Breadcrumb";
import { useAuth } from "../context/AuthContext";
import {
  formatCurrency,
  formatDateTime,
  INVENTORY_MODE_LABELS,
} from "@shared/constants";

function stockClass(stock) {
  if (stock <= 0) {
    return "stock-badge-out";
  }

  if (stock <= 5) {
    return "stock-badge-low";
  }

  return "stock-badge-ok";
}

export default function ProductView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();

  const [product, setProduct] = useState(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!id || id === "undefined" || id === "null") {
      navigate("/products", { replace: true });
      return;
    }

    let active = true;

    const run = async () => {
      setLoading(true);
      setMessage("");

      try {
        const data = await getProduct(id);

        if (!active) {
          return;
        }

        if (data.success) {
          setProduct(data.product);
        } else {
          setMessage(data.message || "Product not found");
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

  const images = Array.isArray(product?.images) ? product.images : [];
  const attributes = Array.isArray(product?.attributes) ? product.attributes : [];
  const variants = Array.isArray(product?.variants) ? product.variants : [];

  return (
    <div className="filament-page">
      <Breadcrumb
        items={[
          { label: "Products", to: "/products" },
          { label: product ? product.name : "View Product" },
        ]}
      />

      {message && <div className="filament-alert">{message}</div>}

      <div className="filament-card">
        <div className="filament-card-header">
          <div className="filament-card-header-left">
            <h1>Product Details</h1>
            <p className="filament-card-subtitle">
              Read-only overview of this product.
            </p>
          </div>
          <div className="filament-card-header-right">
            <button
              type="button"
              className="filament-btn filament-btn-outline"
              onClick={() => navigate("/products")}
            >
              ← Back
            </button>
            {product && can("products.update") && (
              <Link
                className="filament-btn filament-btn-primary"
                to={`/products/${product.uuid}/edit`}
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
        ) : !product ? (
          <div className="filament-empty">
            <p>Product not found.</p>
          </div>
        ) : (
          <div className="view-body">
            <div className="view-head">
              {images[0] ? (
                <img
                  className="view-thumb"
                  src={mediaUrl(images[0])}
                  alt={product.name}
                />
              ) : null}
              <div>
                <h2>{product.name}</h2>
                <p>{product.sku || product.slug}</p>
              </div>
              <span className="view-head-badges">
                {product.featured && (
                  <span className="filament-badge filament-badge-featured">
                    Featured
                  </span>
                )}
                <span
                  className={`filament-badge filament-badge-${String(product.status || "").toLowerCase()}`}
                >
                  <span className="filament-badge-dot" />
                  {product.status}
                </span>
              </span>
            </div>

            <h3 className="view-section-title">General</h3>

            <div className="view-grid">
              <div className="view-box">
                <span className="view-box-label">Name</span>
                <span className="view-box-value">{product.name}</span>
              </div>
              <div className="view-box">
                <span className="view-box-label">SKU</span>
                <span className="view-box-value">{product.sku || "—"}</span>
              </div>
              <div className="view-box">
                <span className="view-box-label">Slug</span>
                <span className="view-box-value">{product.slug}</span>
              </div>
              <div className="view-box">
                <span className="view-box-label">Brand</span>
                <span className="view-box-value">
                  {product.brand_uuid ? (
                    <Link to={`/brands/${product.brand_uuid}`}>
                      {product.brand_name}
                    </Link>
                  ) : (
                    product.brand_name || "—"
                  )}
                </span>
              </div>
              <div className="view-box">
                <span className="view-box-label">Category</span>
                <span className="view-box-value">
                  {product.category_uuid ? (
                    <Link to={`/categories/${product.category_uuid}`}>
                      {product.category_name}
                    </Link>
                  ) : (
                    product.category_name || "—"
                  )}
                </span>
              </div>
              <div className="view-box view-box-full">
                <span className="view-box-label">Short Description</span>
                <span className="view-box-value view-longtext">
                  {product.short_description || "—"}
                </span>
              </div>
            </div>

            <h3 className="view-section-title">Pricing &amp; Inventory</h3>

            <div className="view-grid">
              <div className="view-box">
                <span className="view-box-label">Price</span>
                <span className="view-box-value">
                  {formatCurrency(product.price)}
                </span>
              </div>
              <div className="view-box">
                <span className="view-box-label">Discount Price</span>
                <span className="view-box-value">
                  {product.discount_price == null
                    ? "—"
                    : formatCurrency(product.discount_price)}
                </span>
              </div>
              <div className="view-box">
                <span className="view-box-label">Stock</span>
                <span className="view-box-value">
                  <span className={`stock-badge ${stockClass(product.stock)}`}>
                    {product.stock}
                  </span>
                </span>
              </div>
              <div className="view-box">
                <span className="view-box-label">Low Stock Threshold</span>
                <span className="view-box-value">
                  {product.low_stock_threshold ?? "—"}
                </span>
              </div>
              <div className="view-box">
                <span className="view-box-label">Inventory Mode</span>
                <span className="view-box-value">
                  {INVENTORY_MODE_LABELS[product.inventory_mode] ||
                    product.inventory_mode ||
                    "—"}
                </span>
              </div>
              <div className="view-box">
                <span className="view-box-label">Expiry Date</span>
                <span className="view-box-value">
                  {product.expiry_date
                    ? String(product.expiry_date).slice(0, 10)
                    : "—"}
                </span>
              </div>
              <div className="view-box">
                <span className="view-box-label">Featured</span>
                <span className="view-box-value">
                  {product.featured ? "Yes" : "No"}
                </span>
              </div>
              <div className="view-box view-box-full">
                <span className="view-box-label">Description</span>
                <span className="view-box-value view-longtext">
                  {product.description || "—"}
                </span>
              </div>
            </div>

            <h3 className="view-section-title">Media</h3>

            {images.length === 0 ? (
              <p className="input-hint">No images uploaded.</p>
            ) : (
              <div className="view-gallery">
                {images.map((image) => (
                  <img
                    key={image}
                    src={mediaUrl(image)}
                    alt={product.name}
                  />
                ))}
              </div>
            )}

            <h3 className="view-section-title">Attributes</h3>

            {attributes.length === 0 ? (
              <p className="input-hint">No attributes added.</p>
            ) : (
              <div className="view-grid">
                {attributes.map((attribute, index) => (
                  <div className="view-box" key={attribute.uuid || index}>
                    <span className="view-box-label">
                      {attribute.name || "Attribute"}
                    </span>
                    <span className="view-box-value">
                      {attribute.value || "—"}
                    </span>
                  </div>
                ))}
              </div>
            )}

            <h3 className="view-section-title">Variants</h3>

            {variants.length === 0 ? (
              <p className="input-hint">No variants added.</p>
            ) : (
              <div className="view-grid">
                {variants.map((variant, index) => {
                  const combo = Object.entries(variant.attributes || {});

                  return (
                    <div className="view-box" key={variant.sku || index}>
                      <span className="view-box-label">
                        {variant.name || `Variant ${index + 1}`}
                      </span>
                      <span className="view-box-value">
                        {combo.length > 0 && (
                          <span className="variant-combo">
                            {combo.map(([name, value]) => (
                              <span className="variant-chip" key={name}>
                                <em>{name}</em> {value}
                              </span>
                            ))}
                          </span>
                        )}
                        {combo.length > 0 && <br />}
                        {variant.sku || "—"} · {formatCurrency(variant.price)} ·
                        stock {variant.stock ?? 0}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

            <h3 className="view-section-title">
              Search Engine Optimisation
            </h3>

            <div className="view-grid">
              <div className="view-box">
                <span className="view-box-label">Meta Title</span>
                <span className="view-box-value">
                  {product.meta_title || "—"}
                </span>
              </div>
              <div className="view-box">
                <span className="view-box-label">Meta Description</span>
                <span className="view-box-value view-longtext">
                  {product.meta_description || "—"}
                </span>
              </div>
              <div className="view-box view-box-full">
                <span className="view-box-label">Meta Keywords</span>
                <span className="view-box-value">
                  {product.meta_keywords || "—"}
                </span>
              </div>
              <div className="view-box">
                <span className="view-box-label">Created</span>
                <span className="view-box-value">
                  {formatDateTime(product.created_at)}
                </span>
              </div>
              <div className="view-box">
                <span className="view-box-label">Updated</span>
                <span className="view-box-value">
                  {formatDateTime(product.updated_at)}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}