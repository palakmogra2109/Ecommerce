import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { getBrand } from "../services/brands";
import { listProducts } from "../services/products";
import { mediaUrl } from "../services/media";
import Breadcrumb from "../components/Breadcrumb";
import { useAuth } from "../context/AuthContext";
import { formatCurrency, formatDateTime } from "@shared/constants";

function stockClass(stock) {
  if (stock <= 0) {
    return "stock-badge-out";
  }

  if (stock <= 5) {
    return "stock-badge-low";
  }

  return "stock-badge-ok";
}

export default function BrandView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();

  const [brand, setBrand] = useState(null);
  const [loading, setLoading] = useState(true);
  const [products, setProducts] = useState([]);
  const [productsLoading, setProductsLoading] = useState(true);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!id || id === "undefined" || id === "null") {
      navigate("/brands", { replace: true });
      return;
    }

    let active = true;

    const run = async () => {
      setLoading(true);
      setMessage("");

      try {
        const data = await getBrand(id);

        if (!active) {
          return;
        }

        if (data.success) {
          setBrand(data.brand);
        } else {
          setMessage(data.message || "Brand not found");
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

  useEffect(() => {
    if (!id || id === "undefined" || id === "null") {
      return;
    }

    let active = true;

    const run = async () => {
      setProductsLoading(true);

      try {
        const data = await listProducts({ brandUuid: id, limit: 100 });

        if (!active) {
          return;
        }

        setProducts(data.success ? data.products || [] : []);
      } catch {
        if (active) {
          setProducts([]);
        }
      } finally {
        if (active) {
          setProductsLoading(false);
        }
      }
    };

    run();

    return () => {
      active = false;
    };
  }, [id]);

  return (
    <div className="filament-page">
      <Breadcrumb
        items={[
          { label: "Brands", to: "/brands" },
          { label: brand ? brand.name : "View Brand" },
        ]}
      />

      {message && <div className="filament-alert">{message}</div>}

      <div className="filament-card">
        <div className="filament-card-header">
          <div className="filament-card-header-left">
            <h1>Brand Details</h1>
            <p className="filament-card-subtitle">
              Read-only overview of this brand.
            </p>
          </div>
          <div className="filament-card-header-right">
            <button
              type="button"
              className="filament-btn filament-btn-outline"
              onClick={() => navigate("/brands")}
            >
              ← Back
            </button>
            {brand && can("brands.update") && (
              <Link
                className="filament-btn filament-btn-primary"
                to={`/brands/${brand.uuid}/edit`}
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
        ) : !brand ? (
          <div className="filament-empty">
            <p>Brand not found.</p>
          </div>
        ) : (
          <div className="view-body">
            <div className="view-head">
              {brand.logo ? (
                <img
                  className="view-thumb"
                  src={mediaUrl(brand.logo)}
                  alt={brand.name}
                />
              ) : null}
              <div>
                <h2>{brand.name}</h2>
                <p>{brand.slug}</p>
              </div>
              <span className="view-head-badges">
                <span
                  className={`filament-badge filament-badge-${String(brand.status || "").toLowerCase()}`}
                >
                  <span className="filament-badge-dot" />
                  {brand.status}
                </span>
              </span>
            </div>

            <div className="view-grid">
              <div className="view-box">
                <span className="view-box-label">Name</span>
                <span className="view-box-value">{brand.name}</span>
              </div>
              <div className="view-box">
                <span className="view-box-label">Slug</span>
                <span className="view-box-value">{brand.slug}</span>
              </div>
              <div className="view-box">
                <span className="view-box-label">Products</span>
                <span className="view-box-value">
                  {brand.product_count ?? 0}
                </span>
              </div>
              <div className="view-box">
                <span className="view-box-label">Created</span>
                <span className="view-box-value">
                  {formatDateTime(brand.created_at)}
                </span>
              </div>
              <div className="view-box view-box-full">
                <span className="view-box-label">Description</span>
                <span className="view-box-value view-longtext">
                  {brand.description || "—"}
                </span>
              </div>
            </div>

            <h3 className="view-section-title">Products &amp; Variants</h3>

            {productsLoading ? (
              <div className="filament-empty">
                <div className="filament-spinner" />
              </div>
            ) : products.length === 0 ? (
              <p className="input-hint">
                No products are assigned to this brand yet.
              </p>
            ) : (
              <div className="brand-products">
                {products.map((product) => {
                  const variants = Array.isArray(product.variants)
                    ? product.variants
                    : [];

                  return (
                    <details className="brand-product" key={product.uuid}>
                      <summary className="brand-product-head">
                        {product.images?.[0] ? (
                          <img
                            className="brand-product-thumb"
                            src={mediaUrl(product.images[0])}
                            alt={product.name}
                          />
                        ) : (
                          <span className="brand-product-thumb brand-product-thumb-empty" />
                        )}
                        <span className="brand-product-info">
                          <strong>{product.name}</strong>
                          <small>{product.sku || product.slug}</small>
                        </span>
                        <span className="brand-product-price">
                          {formatCurrency(product.price)}
                        </span>
                        <span
                          className={`stock-badge ${stockClass(product.stock)}`}
                        >
                          {product.stock}
                        </span>
                        <span className="variant-count">
                          {variants.length}{" "}
                          {variants.length === 1 ? "variant" : "variants"}
                        </span>
                        <Link
                          className="filament-action-btn"
                          title="View product"
                          to={`/products/${product.uuid}`}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <svg viewBox="0 0 24 24">
                            <path d="M12 4.5C7 4.5 2.7 8.1 1.5 12c1.2 3.9 5.5 7.5 10.5 7.5s9.3-3.6 10.5-7.5C21.3 8.1 17 4.5 12 4.5Zm0 12a4.5 4.5 0 1 1 0-9 4.5 4.5 0 0 1 0 9Zm0-7a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z" />
                          </svg>
                        </Link>
                      </summary>

                      {variants.length === 0 ? (
                        <p className="input-hint brand-variant-empty">
                          This product has no variants.
                        </p>
                      ) : (
                        <div
                          className="filament-card-scroll variant-table-scroll"
                          tabIndex={0}
                          role="region"
                          aria-label="Product variants"
                        >
                        <table className="variant-table">
                          <thead>
                            <tr>
                              <th>Variant</th>
                              <th>SKU</th>
                              <th>Price</th>
                              <th>Stock</th>
                            </tr>
                          </thead>
                          <tbody>
                            {variants.map((variant, index) => (
                              <tr key={variant.sku || index}>
                                <td>
                                  {variant.name || `Variant ${index + 1}`}
                                </td>
                                <td>{variant.sku || "—"}</td>
                                <td>{formatCurrency(variant.price)}</td>
                                <td>
                                  <span
                                    className={`stock-badge ${stockClass(Number(variant.stock) || 0)}`}
                                  >
                                    {variant.stock ?? 0}
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        </div>
                      )}
                    </details>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}