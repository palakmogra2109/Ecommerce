import { Fragment, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  listProducts,
  bulkUpdateInventory,
} from "../services/products";
import { listBrands } from "../services/brands";
import { listCategories } from "../services/categories";
import { mediaUrl } from "../services/media";
import Breadcrumb from "../components/Breadcrumb";
import Pagination from "../components/Pagination";
import { useAuth } from "../context/AuthContext";
import { PRODUCT_STATUS, formatCurrency } from "@shared/constants";

function stockClass(stock, threshold) {
  const value = Number(stock) || 0;

  if (value <= 0) {
    return "stock-badge-out";
  }

  if (value <= (Number(threshold) || 5)) {
    return "stock-badge-low";
  }

  return "stock-badge-ok";
}

function baseDraft(product) {
  return {
    price: product.price == null ? "" : String(product.price),
    discountPrice:
      (product.discount_price ?? product.discountPrice) == null ? "" : String((product.discount_price ?? product.discountPrice)),
    stock: product.stock == null ? "0" : String(product.stock),
    variants: Array.isArray(product.variants)
      ? product.variants.map((variant) => ({
          ...variant,
          price:
            variant.price == null ? "" : String(variant.price),
          stock: variant.stock == null ? "0" : String(variant.stock),
        }))
      : [],
  };
}

function variantPrices(variants) {
  return (variants || [])
    .map((variant) => variant.price)
    .filter((price) => price !== "" && price != null)
    .map(Number)
    .filter((price) => Number.isFinite(price));
}

function variantMinPrice(variants) {
  const prices = variantPrices(variants);

  return prices.length > 0 ? Math.min(...prices) : null;
}

function variantStockSum(variants) {
  return (variants || []).reduce(
    (total, variant) => total + (parseInt(variant.stock, 10) || 0),
    0
  );
}

export default function Inventory() {
  const { can } = useAuth();
  const canEditInventory = can("products.update");
  const [products, setProducts] = useState([]);
  const [brands, setBrands] = useState([]);
  const [categories, setCategories] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [brandUuid, setBrandUuid] = useState("");
  const [categoryUuid, setCategoryUuid] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);

  const [drafts, setDrafts] = useState({});
  const [selected, setSelected] = useState([]);
  const [expanded, setExpanded] = useState([]);

  const [bulkStock, setBulkStock] = useState("");
  const [bulkPrice, setBulkPrice] = useState("");
  const [bulkPercent, setBulkPercent] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(search.trim());
      setPage(1);
    }, 400);

    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    let active = true;

    const run = async () => {
      try {
        const [brandData, catData] = await Promise.all([
          listBrands({ all: 1 }),
          listCategories({ all: 1 }),
        ]);

        if (active) {
          setBrands(brandData.brands || []);
          setCategories(catData.categories || []);
        }
      } catch {
        // Filter options are non-critical.
      }
    };

    run();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;

    const run = async () => {
      setLoading(true);

      try {
        const data = await listProducts({
          search: query,
          status,
          brandUuid,
          categoryUuid,
          page,
          limit,
        });

        if (!active) {
          return;
        }

        if (data.success) {
          setProducts(data.products || []);
          setPagination(data.pagination || null);
        } else {
          setMessage(data.message || "Unable to load products");
        }
      } catch {
        if (active) {
          setMessage("Unable to connect to the server. Please try again.");
        }
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
  }, [query, status, brandUuid, categoryUuid, page, limit]);

  const draftCount = Object.keys(drafts).length;

  const stats = useMemo(() => {
    let low = 0;
    let out = 0;
    let value = 0;

    for (const product of products) {
      const draft = drafts[product.uuid] || baseDraft(product);
      const variants = draft.variants || [];
      const hasVariants = variants.length > 0;
      const stock = hasVariants
        ? variantStockSum(variants)
        : Number(draft.stock) || 0;
      const price = hasVariants
        ? variantMinPrice(variants) ?? 0
        : Number(draft.price) || 0;

      if (stock <= 0) {
        out += 1;
      } else if (stock <= (Number(product.low_stock_threshold) || 5)) {
        low += 1;
      }

      value += price * stock;
    }

    return { low, out, value };
  }, [products, drafts]);

  function updateDraft(uuid, patch) {
    setDrafts((prev) => {
      const product = products.find((item) => item.uuid === uuid);

      if (!product) {
        return prev;
      }

      const base = prev[uuid] || baseDraft(product);

      return { ...prev, [uuid]: { ...base, ...patch } };
    });
  }

  function updateVariant(uuid, index, field, value) {
    setDrafts((prev) => {
      const product = products.find((item) => item.uuid === uuid);

      if (!product) {
        return prev;
      }

      const base = prev[uuid] || baseDraft(product);
      const variants = base.variants.map((variant, i) =>
        i === index ? { ...variant, [field]: value } : variant
      );

      return { ...prev, [uuid]: { ...base, variants } };
    });
  }

  function toggleSelected(uuid) {
    setSelected((prev) =>
      prev.includes(uuid)
        ? prev.filter((id) => id !== uuid)
        : [...prev, uuid]
    );
  }

  function toggleAll() {
    const pageIds = products.map((product) => product.uuid);
    const allSelected = pageIds.every((id) => selected.includes(id));

    setSelected(allSelected ? [] : pageIds);
  }

  function toggleExpanded(uuid) {
    setExpanded((prev) =>
      prev.includes(uuid)
        ? prev.filter((id) => id !== uuid)
        : [...prev, uuid]
    );
  }

  function targetIds() {
    return selected.length > 0
      ? selected
      : products.map((product) => product.uuid);
  }

  function applyBulkStock(mode) {
    const value = Number(bulkStock);

    if (bulkStock === "" || !Number.isFinite(value)) {
      setMessage("Enter a stock value to apply.");
      return;
    }

    const targets = targetIds();

    setDrafts((prev) => {
      const next = { ...prev };

      for (const uuid of targets) {
        const product = products.find((item) => item.uuid === uuid);
        const base = next[uuid] || baseDraft(product);
        const variants = base.variants || [];

        if (variants.length > 0) {
          const updated = variants.map((variant) => {
            const current = Number(variant.stock) || 0;
            const nextStock =
              mode === "set"
                ? value
                : mode === "add"
                  ? current + value
                  : current - value;

            return { ...variant, stock: String(Math.max(0, nextStock)) };
          });

          next[uuid] = {
            ...base,
            variants: updated,
            stock: String(variantStockSum(updated)),
          };
          continue;
        }

        const current = Number(base.stock) || 0;
        const result =
          mode === "set"
            ? value
            : mode === "add"
              ? current + value
              : current - value;

        next[uuid] = { ...base, stock: String(Math.max(0, result)) };
      }

      return next;
    });
    setMessage("");
  }

  function applyBulkPrice() {
    const value = Number(bulkPrice);

    if (bulkPrice === "" || !Number.isFinite(value)) {
      setMessage("Enter a price to apply.");
      return;
    }

    setDrafts((prev) => {
      const next = { ...prev };

      for (const uuid of targetIds()) {
        const product = products.find((item) => item.uuid === uuid);
        const base = next[uuid] || baseDraft(product);
        const variants = base.variants || [];
        const safe = String(Math.max(0, value));

        if (variants.length > 0) {
          next[uuid] = {
            ...base,
            price: safe,
            variants: variants.map((variant) => ({ ...variant, price: safe })),
          };
          continue;
        }

        next[uuid] = { ...base, price: safe };
      }

      return next;
    });
    setMessage("");
  }

  function adjustPriceByPercent(direction) {
    const pct = Number(bulkPercent);

    if (bulkPercent === "" || !Number.isFinite(pct)) {
      setMessage("Enter a percentage to adjust prices.");
      return;
    }

    const factor =
      direction === "up" ? 1 + Math.abs(pct) / 100 : 1 - Math.abs(pct) / 100;
    const round = (value) => Math.max(0, Math.round(value * 100) / 100);

    setDrafts((prev) => {
      const next = { ...prev };

      for (const uuid of targetIds()) {
        const product = products.find((item) => item.uuid === uuid);
        const base = next[uuid] || baseDraft(product);
        const variants = base.variants || [];

        if (variants.length > 0) {
          const updated = variants.map((variant) => ({
            ...variant,
            price: String(round((Number(variant.price) || 0) * factor)),
          }));

          next[uuid] = {
            ...base,
            variants: updated,
            price: String(variantMinPrice(updated) ?? 0),
          };
          continue;
        }

        const current = Number(base.price) || 0;
        next[uuid] = { ...base, price: String(round(current * factor)) };
      }

      return next;
    });
    setMessage("");
  }

  function discardChanges() {
    setDrafts({});
    setSelected([]);
    setMessage("");
  }

  async function saveChanges() {
    if (draftCount === 0) {
      return;
    }

    setSaving(true);
    setMessage("");

    const items = Object.entries(drafts).map(([uuid, draft]) => ({
      uuid,
      price: draft.price === "" ? 0 : Number(draft.price),
      discountPrice:
        (!draft.discountPrice || draft.discountPrice === "") ? null : Number(draft.discountPrice),
      stock: parseInt(draft.stock, 10) || 0,
      variants: draft.variants.map((variant) => ({
        ...variant,
        price: variant.price === "" ? 0 : Number(variant.price),
        stock: parseInt(variant.stock, 10) || 0,
      })),
    }));

    try {
      const data = await bulkUpdateInventory(items);

      if (!data.success) {
        setMessage(data.message || "Unable to save changes");
        return;
      }

      setDrafts({});
      setSelected([]);
      setMessage(data.message || "Inventory updated");

      const refreshed = await listProducts({
        search: query,
        status,
        brandUuid,
        categoryUuid,
        page,
        limit,
      });

      if (refreshed.success) {
        setProducts(refreshed.products || []);
        setPagination(refreshed.pagination || null);
      }
    } catch {
      setMessage("Unable to connect to the server. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  const allSelected =
    products.length > 0 &&
    products.every((product) => selected.includes(product.uuid));

  return (
    <div className="filament-page">
      <Breadcrumb items={[{ label: "Stock & Price" }]} />

      {message && <div className="filament-alert">{message}</div>}

      <div className="filament-card">
        <div className="filament-card-header">
          <div className="filament-card-header-left">
            <h1>Stock &amp; Price</h1>
            <p className="filament-card-subtitle">
              Update price and stock for every product and variant, grouped by
              brand.
            </p>
          </div>
          {canEditInventory && draftCount > 0 && (
            <div className="filament-card-header-right">
              <button
                type="button"
                className="filament-btn filament-btn-outline"
                onClick={discardChanges}
                disabled={saving}
              >
                Discard
              </button>
              <button
                type="button"
                className="filament-btn filament-btn-primary"
                onClick={saveChanges}
                disabled={saving}
              >
                {saving ? "Saving..." : `Save ${draftCount} change(s)`}
              </button>
            </div>
          )}
        </div>

        <div className="inventory-filters">
          <input
            type="search"
            className="inventory-search"
            placeholder="Search by name or SKU"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          <select
            className="filter-select"
            value={brandUuid}
            onChange={(e) => {
              setBrandUuid(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All brands</option>
            {brands.map((brand) => (
              <option key={brand.uuid} value={brand.uuid}>
                {brand.name}
              </option>
            ))}
          </select>

          <select
            className="filter-select"
            value={categoryUuid}
            onChange={(e) => {
              setCategoryUuid(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All categories</option>
            {categories.map((category) => (
              <option key={category.uuid} value={category.uuid}>
                {(category.parent_name ? `${category.parent_name} / ` : "") +
                  category.name}
              </option>
            ))}
          </select>

          <select
            className="filter-select"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All statuses</option>
            {Object.entries(PRODUCT_STATUS).map(([key, value]) => (
              <option key={key} value={value}>
                {key.charAt(0) + key.slice(1).toLowerCase()}
              </option>
            ))}
          </select>
        </div>

        <div className="inventory-stats">
          <span>
            <strong>{pagination?.total ?? products.length}</strong> products
          </span>
          <span>
            <strong>{stats.low}</strong> low stock
          </span>
          <span>
            <strong>{stats.out}</strong> out of stock
          </span>
          <span>
            Page value <strong>{formatCurrency(stats.value)}</strong>
          </span>
        </div>

        {canEditInventory && (
        <div className="inventory-bulk">
          <div className="inventory-bulk-group">
            <span className="inventory-bulk-label">Stock</span>
            <input
              type="number"
              min="0"
              placeholder="0"
              value={bulkStock}
              onChange={(e) => setBulkStock(e.target.value)}
            />
            <button
              type="button"
              className="filament-btn filament-btn-outline"
              onClick={() => applyBulkStock("set")}
            >
              Set
            </button>
            <button
              type="button"
              className="filament-btn filament-btn-outline"
              onClick={() => applyBulkStock("add")}
            >
              + Add
            </button>
            <button
              type="button"
              className="filament-btn filament-btn-outline"
              onClick={() => applyBulkStock("sub")}
            >
              − Remove
            </button>
          </div>

          <div className="inventory-bulk-group">
            <span className="inventory-bulk-label">Price</span>
            <input
              type="number"
              min="0"
              step="0.01"
              placeholder="0.00"
              value={bulkPrice}
              onChange={(e) => setBulkPrice(e.target.value)}
            />
            <button
              type="button"
              className="filament-btn filament-btn-outline"
              onClick={applyBulkPrice}
            >
              Set
            </button>
            <input
              type="number"
              step="0.01"
              placeholder="%"
              className="inventory-percent"
              value={bulkPercent}
              onChange={(e) => setBulkPercent(e.target.value)}
            />
            <button
              type="button"
              className="filament-btn filament-btn-outline"
              onClick={() => adjustPriceByPercent("up")}
            >
              + %
            </button>
            <button
              type="button"
              className="filament-btn filament-btn-outline"
              onClick={() => adjustPriceByPercent("down")}
            >
              − %
            </button>
          </div>

          <span className="inventory-bulk-target">
            Applying to{" "}
            <strong>
              {selected.length > 0
                ? `${selected.length} selected`
                : `${products.length} on page`}
            </strong>
          </span>
        </div>
        )}

        <div className="inventory-table-wrap">
          <table className="inventory-table">
            <thead>
              <tr>
                <th className="inventory-check">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                  />
                </th>
                <th>Product</th>
                <th>Brand</th>
                <th>Price</th>
                <th>Discount</th>
                <th>Stock</th>
                <th>Variants</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan="8" className="filament-empty">
                    <div className="filament-spinner" />
                  </td>
                </tr>
              ) : products.length === 0 ? (
                <tr>
                  <td colSpan="8" className="filament-empty">
                    No products found.
                  </td>
                </tr>
              ) : (
                products.map((product) => {
                  const draft = drafts[product.uuid];
                  const price = draft ? draft.price : String(product.price);
                  const discount = draft
                    ? draft.discountPrice
                    : (product.discount_price ?? product.discountPrice) == null
                      ? ""
                      : String((product.discount_price ?? product.discountPrice));
                  const stock = draft ? draft.stock : String(product.stock);
                  const variants = draft
                    ? draft.variants
                    : Array.isArray(product.variants)
                      ? product.variants
                      : [];
                  const dirty = Boolean(draft);
                  const isOpen = expanded.includes(product.uuid);

                  return (
                    <Fragment key={product.uuid}>
                      <tr
                        key={product.uuid}
                        className={dirty ? "inventory-row-dirty" : ""}
                      >
                        <td className="inventory-check">
                          <input
                            type="checkbox"
                            checked={selected.includes(product.uuid)}
                            onChange={() => toggleSelected(product.uuid)}
                          />
                        </td>
                        <td>
                          <div className="inventory-product">
                            {product.images?.[0] ? (
                              <img
                                src={mediaUrl(product.images[0])}
                                alt={product.name}
                              />
                            ) : (
                              <span className="inventory-product-thumb" />
                            )}
                            <div>
                              <Link to={`/products/${product.uuid}`}>
                                {product.name}
                              </Link>
                              <small>{product.sku || product.slug}</small>
                            </div>
                          </div>
                        </td>
                        <td>
                          {product.brand_name ? (
                            <Link to={`/brands/${product.brand_uuid}`}>
                              {product.brand_name}
                            </Link>
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                        </td>
                        <td>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            className="inventory-input"
                            value={price}
                            readOnly={!canEditInventory}
                            onChange={(e) =>
                              updateDraft(product.uuid, {
                                price: e.target.value,
                              })
                            }
                          />
                        </td>
                        <td>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            className="inventory-input"
                            placeholder="—"
                            value={discount}
                            readOnly={!canEditInventory}
                            onChange={(e) =>
                              updateDraft(product.uuid, {
                                discountPrice: e.target.value,
                              })
                            }
                          />
                        </td>
                        <td>
                          <div className="inventory-stock-cell">
                            <input
                              type="number"
                              min="0"
                              className="inventory-input"
                              value={stock}
                              readOnly={!canEditInventory}
                              onChange={(e) =>
                                updateDraft(product.uuid, {
                                  stock: e.target.value,
                                })
                              }
                            />
                            <span
                              className={`stock-badge ${stockClass(stock, product.low_stock_threshold)}`}
                            >
                              {Number(stock) <= 0
                                ? "Out"
                                : Number(stock) <=
                                    (Number(product.low_stock_threshold) || 5)
                                  ? "Low"
                                  : "OK"}
                            </span>
                          </div>
                        </td>
                        <td>
                          {variants.length === 0 ? (
                            <span className="text-muted">—</span>
                          ) : (
                            <button
                              type="button"
                              className="inventory-variant-toggle"
                              onClick={() => toggleExpanded(product.uuid)}
                            >
                              {variants.length}{" "}
                              {variants.length === 1 ? "variant" : "variants"}{" "}
                              {isOpen ? "▲" : "▼"}
                            </button>
                          )}
                        </td>
                        <td>
                          <Link
                            className="filament-action-btn"
                            title="Open product"
                            to={`/products/${product.uuid}`}
                          >
                            <svg viewBox="0 0 24 24">
                              <path d="M12 4.5C7 4.5 2.7 8.1 1.5 12c1.2 3.9 5.5 7.5 10.5 7.5s9.3-3.6 10.5-7.5C21.3 8.1 17 4.5 12 4.5Zm0 12a4.5 4.5 0 1 1 0-9 4.5 4.5 0 0 1 0 9Zm0-7a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z" />
                            </svg>
                          </Link>
                        </td>
                      </tr>

                      {isOpen && variants.length > 0 && (
                        <tr
                          key={`${product.uuid}-variants`}
                          className="inventory-variant-row"
                        >
                          <td />
                          <td colSpan="7">
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
                                      {variant.attributes &&
                                      Object.keys(variant.attributes).length >
                                        0 ? (
                                        <div className="variant-combo">
                                          {Object.entries(
                                            variant.attributes
                                          ).map(([name, value]) => (
                                            <span
                                              className="variant-chip"
                                              key={name}
                                            >
                                              <em>{name}</em> {value}
                                            </span>
                                          ))}
                                        </div>
                                      ) : (
                                        variant.name ||
                                        `Variant ${index + 1}`
                                      )}
                                    </td>
                                    <td>{variant.sku || "—"}</td>
                                    <td>
                                      <input
                                        type="number"
                                        min="0"
                                        step="0.01"
                                        className="inventory-input"
                                        value={variant.price}
                                        readOnly={!canEditInventory}
                                        onChange={(e) =>
                                          updateVariant(
                                            product.uuid,
                                            index,
                                            "price",
                                            e.target.value
                                          )
                                        }
                                      />
                                    </td>
                                    <td>
                                      <input
                                        type="number"
                                        min="0"
                                        className="inventory-input"
                                        value={variant.stock}
                                        readOnly={!canEditInventory}
                                        onChange={(e) =>
                                          updateVariant(
                                            product.uuid,
                                            index,
                                            "stock",
                                            e.target.value
                                          )
                                        }
                                      />
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {pagination && (
          <Pagination
            pagination={pagination}
            onPageChange={(next) => setPage(next)}
            onLimitChange={(next) => {
              setLimit(next);
              setPage(1);
            }}
          />
        )}
      </div>

      {canEditInventory && draftCount > 0 && (
        <div className="inventory-save-bar">
          <span>
            {draftCount} product(s) with unsaved changes
            {selected.length > 0 ? ` · ${selected.length} selected` : ""}
          </span>
          <div>
            <button
              type="button"
              className="filament-btn filament-btn-outline"
              onClick={discardChanges}
              disabled={saving}
            >
              Discard
            </button>
            <button
              type="button"
              className="filament-btn filament-btn-primary"
              onClick={saveChanges}
              disabled={saving}
            >
              {saving ? "Saving..." : "Save changes"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
