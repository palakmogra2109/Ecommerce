import { useState, useEffect } from "react";
import { getProduct, updateProductVariantPricing } from "../services/products";
import Breadcrumb from "./Breadcrumb";
import { useAuth } from "../context/AuthContext";
import { useNavigate, useParams } from "react-router-dom";

export default function VariantPricing() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();

  const [product, setProduct] = useState(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!id || id === "undefined" || id === "null") {
      navigate("/products", { replace: true });
      return;
    }

    let active = true;

    const run = async () => {
      setLoading(true);
      try {
        const data = await getProduct(id);
        if (active && data.success) {
          setProduct(data.product);
        } else if (active) {
          setMessage(data.message || "Product not found");
        }
      } catch {
        if (active) {
          setMessage("Unable to connect to the server.");
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    run();
    return () => { active = false; };
  }, [id, navigate]);

  const variants = Array.isArray(product?.variants) ? product.variants : [];

  const handlePriceChange = (index, value) => {
    setProduct((prev) => {
      const variants = [...prev.variants];
      variants[index] = { ...variants[index], price: value };
      return { ...prev, variants };
    });
  };

  const handleStockChange = (index, value) => {
    setProduct((prev) => {
      const variants = [...prev.variants];
      variants[index] = { ...variants[index], stock: value };
      return { ...prev, variants };
    });
  };

  const handleDiscountChange = (index, value) => {
    setProduct((prev) => {
      const variants = [...prev.variants];
      variants[index] = { ...variants[index], discountPrice: value };
      return { ...prev, variants };
    });
  };

  async function handleSave() {
    if (!can("products.update")) {
      setMessage("You do not have permission to update products.");
      return;
    }

    setSaving(true);
    setMessage("");

    try {
      const data = await updateProductVariantPricing(id, {
        variants: product.variants.map((v) => ({
          sku: v.sku,
          name: v.name,
          price: v.price,
          stock: v.stock,
          discountPrice: v.discountPrice ?? "",
        })),
      });

      if (data.success) {
        setMessage("Variant pricing updated successfully.");
        setProduct(data.product);
      } else {
        setMessage(data.message || "Failed to update variant pricing.");
      }
    } catch {
      setMessage("Unable to connect to the server.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="filament-empty"><div className="filament-spinner" /></div>;
  }

  if (!product) {
    return (
      <div className="filament-page">
        <div className="filament-empty"><p>Product not found.</p></div>
      </div>
    );
  }

  return (
    <div className="filament-page">
      <Breadcrumb items={[
        { label: "Products", to: "/products" },
        { label: product.name, to: `/products/${product.uuid}` },
        { label: "Variant Pricing" },
      ]} />

      {message && <div className="filament-alert">{message}</div>}

      <div className="filament-card">
        <div className="filament-card-header">
          <div className="filament-card-header-left">
            <h1>Variant Pricing &amp; Stock</h1>
            <p className="filament-card-subtitle">
              Set individual price and stock for each variant of{" "}
              <strong>{product.name}</strong>
            </p>
          </div>
        </div>

        <div className="variant-table-wrap">
          <table className="variant-edit-table">
            <thead>
              <tr>
                <th>Variant</th>
                <th>SKU</th>
                <th>Price</th>
                <th>Stock</th>
              </tr>
            </thead>
            <tbody>
              {variants.length === 0 ? (
                <tr>
                  <td colSpan="5">
                    <p className="input-hint">No variants found.</p>
                  </td>
                </tr>
              ) : (
                variants.map((variant, index) => (
                  <tr key={variant.sku || index}>
                    <td>
                      {variant.attributes && Object.keys(variant.attributes).length > 0 ? (
                        <div className="variant-combo">
                          {Object.entries(variant.attributes).map(([name, value]) => (
                            <span className="variant-chip" key={name}>
                              <em>{name}</em> {value}
                            </span>
                          ))}
                        </div>
                      ) : (
                        variant.name || `Variant ${index + 1}`
                      )}
                    </td>
                    <td>{variant.sku || "—"}</td>
                    <td>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={variant.price ?? ""}
                        onChange={(e) => handlePriceChange(index, e.target.value)}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        min="0"
                        value={variant.stock ?? ""}
                        onChange={(e) => handleStockChange(index, e.target.value)}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="Discount"
                        value={variant.discountPrice ?? ""}
                        onChange={(e) => handleDiscountChange(index, e.target.value)}
                      />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="form-actions form-actions-sticky">
          <button
            type="button"
            className="filament-btn filament-btn-outline"
            onClick={() => navigate(`/products/${product.uuid}`)}
          >
            Cancel
          </button>
          <button
            type="button"
            className="filament-btn filament-btn-primary"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? "Saving..." : "Save Variant Pricing"}
          </button>
        </div>
      </div>
    </div>
  );
}
