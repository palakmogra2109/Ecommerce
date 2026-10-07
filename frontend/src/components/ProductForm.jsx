import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  getProduct,
  createProduct,
  updateProduct,
} from "../services/products";
import { listCategories } from "../services/categories";
import { listBrands } from "../services/brands";
import { listAttributes, createAttribute } from "../services/attributes";
import Breadcrumb from "./Breadcrumb";
import MediaPicker from "./MediaPicker";
import {
  PRODUCT_STATUS,
  INVENTORY_MODE,
  INVENTORY_MODES,
  INVENTORY_MODE_LABELS,
  slugify,
} from "@shared/constants";
import { useAuth } from "../context/AuthContext";

const SKU_SEPARATOR = "-";

function buildSku(base, combo) {
  const prefix = (base || "SKU")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, SKU_SEPARATOR)
    .replace(/^-+|-+$/g, "");

  const suffix = combo
    .map((item) => slugify(item.value).toUpperCase())
    .filter(Boolean)
    .join(SKU_SEPARATOR);

  return suffix ? `${prefix}${SKU_SEPARATOR}${suffix}` : prefix;
}

function combinationKey(combo) {
  return combo.map((item) => `${item.name}:${item.value}`).join("|");
}

function cartesian(groups) {
  return groups.reduce(
    (acc, group) =>
      acc.flatMap((combo) =>
        group.values.map((value) => [...combo, { name: group.name, value }])
      ),
    [[]]
  );
}

function groupAttributes(flat) {
  const map = new Map();

  for (const entry of flat) {
    const key = entry.attribute_uuid || entry.attributeUuid || entry.name;

    if (!key) {
      continue;
    }

    if (!map.has(key)) {
      map.set(key, {
        attribute_uuid: key,
        attributeUuid: key,
        name: entry.name || "",
        values: [],
      });
    }

    if (entry.value) {
      map.get(key).values.push(entry.value);
    }
  }

  return [...map.values()];
}

function pricingGroup(state) {
  return (
    (state.attributes || []).find(
      (attr) =>
        (attr.attribute_uuid || attr.attributeUuid) === state.pricingAttribute
    ) || null
  );
}

// Builds the per-attribute-value price/stock table used by the
// "by attribute" and "per SKU" inventory modes, seeded from the product's variants.
function buildOptionInventory(groups, variants, pricingUuid) {
  const group = (groups || []).find(
    (attr) => (attr.attribute_uuid || attr.attributeUuid) === pricingUuid
  );

  if (!group) {
    return {};
  }

  const table = {};

  for (const value of group.values || []) {
    table[value] = { price: "", stock: "" };
  }

  for (const variant of variants || []) {
    const value = (variant.attributes || {})[group.name];

    if (value == null) {
      continue;
    }

    table[value] = {
      price: variant.price == null ? "" : String(variant.price),
      discount_price: variant.discountPrice ?? variant.discount_price ?? "",
      stock: variant.stock == null ? "" : String(variant.stock),
    };
  }

  return table;
}

// Returns the price/stock a variant should inherit from the option table.
function optionFor(state, combo) {
  const group = pricingGroup(state);

  if (!group) {
    return null;
  }

  const match = combo.find((item) => item.name === group.name);

  if (!match) {
    return null;
  }

  return state.optionInventory[match.value] || null;
}

// For PER_SKU mode, builds a per-attribute-value price/stock table
// from all attribute groups so each variant can have its own price/stock.


export default function ProductForm({ productId = null }) {
  const isEdit = Boolean(productId);
  const { can } = useAuth();
  const canSubmit = can(isEdit ? "products.update" : "products.create");
  const navigate = useNavigate();

  const [form, setForm] = useState({
    name: "",
    slug: "",
    sku: "",
    shortDescription: "",
    description: "",
    price: "",
    discountPrice: "", discount_price: null,
    stock: 0,
    lowStockThreshold: 5,
    brandUuid: "",
    categoryUuid: "",
    images: [],
    attributes: [],
    variants: [],
    featured: false,
    status: PRODUCT_STATUS.DRAFT,
    inventoryMode: INVENTORY_MODE.SINGLE,
    pricingAttribute: "",
    optionInventory: {},
    expiryDate: "",
    metaTitle: "",
    metaDescription: "",
    metaKeywords: "",
  });

  const [categories, setCategories] = useState([]);
  const [brands, setBrands] = useState([]);
  const [attributes, setAttributes] = useState([]);
  const [creatingAttribute, setCreatingAttribute] = useState(false);
  const [loading, setLoading] = useState(isEdit);
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [bulkPrice, setBulkPrice] = useState("");

  useEffect(() => {
    let active = true;

    const run = async () => {
      try {
        const [catData, brandData, attrData] = await Promise.all([
          listCategories({ all: 1 }),
          listBrands({ all: 1 }),
          listAttributes({ all: 1 }),
        ]);

        if (active) {
          setCategories(catData.categories || []);
          setBrands(brandData.brands || []);
          setAttributes(attrData.attributes || []);
        }
      } catch {
        // Dropdown options are non-critical.
      }
    };

    run();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!isEdit) {
      return;
    }

    let active = true;

    const run = async () => {
      setLoading(true);
      setMessage("");

      try {
        const data = await getProduct(productId);

        if (!active) {
          return;
        }

        if (data.success) {
          const p = data.product;
          const groupedAttributes = groupAttributes(
            Array.isArray(p.attributes) ? p.attributes : []
          );
          const loadedVariants = Array.isArray(p.variants)
            ? p.variants.map((v) => ({
                ...v,
                discountPrice: v.discountPrice ?? v.discount_price ?? "", discount_price: v.discount_price ?? v.discountPrice ?? null,
              }))
            : [];
          const inventoryMode = p.inventory_mode || INVENTORY_MODE.SINGLE;
          const pricingAttribute = p.pricing_attribute_uuid || "";
          const groups = Array.isArray(p.attributes)
            ? groupAttributes(p.attributes).filter(
              (attr) => (attr.values || []).length > 0
            )
            : [];

          const optionInventory =
            inventoryMode === INVENTORY_MODE.BY_ATTRIBUTE
              ? buildOptionInventory(
                groupAttributes(Array.isArray(p.attributes) ? p.attributes : []),
                loadedVariants,
                pricingAttribute
              )
              : {};

          setForm({
            name: p.name,
            slug: p.slug,
            sku: p.sku || "",
            shortDescription: p.short_description || "",
            description: p.description || "",
            price: p.price ?? "",
            discountPrice: p.discount_price ?? "",
            stock: p.stock ?? 0,
            lowStockThreshold: p.low_stock_threshold ?? 5,
            brandUuid: p.brand_uuid || "",
            categoryUuid: p.category_uuid || "",
            images: Array.isArray(p.images) ? p.images : [],
            attributes: groupedAttributes,
            variants: loadedVariants,
            featured: Boolean(p.featured),
            status: p.status,
            inventoryMode,
            pricingAttribute,
            optionInventory,
            expiryDate: p.expiry_date
              ? String(p.expiry_date).slice(0, 10)
              : "",
            metaTitle: p.meta_title || "",
            metaDescription: p.meta_description || "",
            metaKeywords: p.meta_keywords || "",
          });
        } else {
          setMessage(data.message);
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
  }, [productId, isEdit]);

  function handleChange(e) {
    const { name, value, type, checked } = e.target;

    setForm((prev) => ({
      ...prev,
      [name]: type === "checkbox" ? checked : value,
    }));
    setErrors((prev) => ({ ...prev, [name]: "" }));
  }

  function handleInventoryModeChange(mode) {
    setForm((prev) => {
      const next = { ...prev, inventoryMode: mode };

      const groups = prev.attributes.filter(
        (attr) => (attr.values || []).length > 0
      );

      if (mode === INVENTORY_MODE.BY_ATTRIBUTE) {
        const selected = (prev.attributes || []).find(
          (attr) =>
            (attr.attribute_uuid || attr.attributeUuid) ===
            prev.pricingAttribute
        );
        const uuid =
          selected?.attribute_uuid ||
          selected?.attributeUuid ||
          groups[0]?.attribute_uuid ||
          groups[0]?.attributeUuid ||
          "";

        next.pricingAttribute = uuid;
        next.optionInventory = buildOptionInventory(
          prev.attributes,
          prev.variants,
          uuid
        );
      } else if (mode === INVENTORY_MODE.PER_SKU) {
        next.optionInventory = {};
      }

      return next;
    });
    setMessage("");
  }

  function handlePricingAttributeChange(uuid) {
    setForm((prev) => ({
      ...prev,
      pricingAttribute: uuid,
      optionInventory: buildOptionInventory(prev.attributes, prev.variants, uuid),
    }));
  }

  function updateOptionInventory(value, field, raw) {
    setForm((prev) => {
      const group = pricingGroup(prev);
      const optionInventory = {
        ...prev.optionInventory,
        [value]: { ...(prev.optionInventory[value] || {}), [field]: raw },
      };

      const variants = group
        ? prev.variants.map((variant) =>
          (variant.attributes || {})[group.name] === value
            ? { ...variant, [field]: raw }
            : variant
        )
        : prev.variants;

      return { ...prev, optionInventory, variants };
    });
  }

  // Rebuilds the by-attribute option table after attribute edits.
  function syncedOptions(prev, attributes, variants) {
    if (prev.inventoryMode !== INVENTORY_MODE.BY_ATTRIBUTE) {
      return {};
    }

    return {
      optionInventory: buildOptionInventory(
        attributes,
        variants ?? prev.variants,
        prev.pricingAttribute
      ),
    };
  }

  function handleAttributeSelect(index, uuid) {
    const meta = attributes.find((a) => a.uuid === uuid);

    setForm((prev) => {
      const list = [...prev.attributes];

      list[index] = {
        ...list[index],
        attribute_uuid: uuid,
        attributeUuid: uuid,
        name: meta ? meta.name : "",
      };

      return { ...prev, attributes: list };
    });
  }

  function addAttribute() {
    setForm((prev) => ({
      ...prev,
      attributes: [
        ...prev.attributes,
        {
          attribute_uuid: "",
          attributeUuid: "",
          name: "",
          values: [],
          draft: "",
        },
      ],
    }));
  }

  function removeAttribute(index) {
    setForm((prev) => ({
      ...prev,
      attributes: prev.attributes.filter((_, i) => i !== index),
    }));
  }

  function updateAttributeDraft(index, value) {
    setForm((prev) => {
      const list = [...prev.attributes];
      list[index] = { ...list[index], draft: value };
      return { ...prev, attributes: list };
    });
  }

  function commitAttributeValues(index, raw) {
    const parts = String(raw)
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);

    setForm((prev) => {
      const list = [...prev.attributes];
      const current = list[index] || { values: [] };
      const values = [...(current.values || [])];

      for (const part of parts) {
        if (!values.some((v) => v.toLowerCase() === part.toLowerCase())) {
          values.push(part);
        }
      }

      list[index] = { ...current, values, draft: "" };

      return { ...prev, attributes: list, ...syncedOptions(prev, list) };
    });
  }

  function removeAttributeValue(index, valueIndex) {
    setForm((prev) => {
      const list = [...prev.attributes];
      const current = list[index] || { values: [] };
      const removed = (current.values || [])[valueIndex];
      const values = current.values.filter((_, i) => i !== valueIndex);

      list[index] = { ...current, values };

      const isPricingAttribute =
        prev.inventoryMode === INVENTORY_MODE.BY_ATTRIBUTE &&
        (current.attribute_uuid || current.attributeUuid) ===
        prev.pricingAttribute;

      const variants =
        isPricingAttribute && removed != null
          ? prev.variants.filter(
            (variant) => (variant.attributes || {})[current.name] !== removed
          )
          : prev.variants;

      return {
        ...prev,
        attributes: list,
        variants,
        ...syncedOptions(prev, list, variants),
      };
    });
  }

  function updateVariant(index, field, value) {
    setForm((prev) => {
      const variants = [...prev.variants];
      variants[index] = { ...variants[index], [field]: value };
      return { ...prev, variants };
    });
  }

  function addVariant() {
    setForm((prev) => ({
      ...prev,
      variants: [
        ...prev.variants,
        { name: "", sku: "", price: prev.price || "", stock: 0, discountPrice: "", discount_price: null, attributes: {} },
      ],
    }));
  }

  function removeVariant(index) {
    setForm((prev) => ({
      ...prev,
      variants: prev.variants.filter((_, i) => i !== index),
    }));
  }

  function generateVariants() {
    const groups = form.attributes
      .map((attr) => ({
        name: attr.name || "Option",
        values: attr.values || [],
      }))
      .filter((group) => group.values.length > 0);

    if (groups.length === 0) {
      setMessage(
        "Add at least one attribute value (e.g. 5kg, 25kg) before generating variants."
      );
      return;
    }

    const combos = cartesian(groups);
    const baseSku = form.sku || form.name || "SKU";

    setForm((prev) => {
      const existingByKey = new Map();

      for (const variant of prev.variants) {
        const entries = Object.entries(variant.attributes || {});

        if (entries.length > 0) {
          existingByKey.set(
            entries.map(([name, value]) => `${name}:${value}`).join("|"),
            variant
          );
        }
      }

      const variants = combos.map((combo) => {
        const existing = existingByKey.get(combinationKey(combo));
        const option = optionFor(prev, combo);

        const price =
          option != null
            ? option.price ?? ""
            : existing?.price ?? (prev.price === "" ? "" : prev.price);
        const stock =
          option != null
            ? parseInt(option.stock, 10) || 0
            : existing?.stock ?? 0;

        return {
          name: combo.map((item) => item.value).join(" / "),
          sku: existing?.sku || buildSku(baseSku, combo),
          price,
          stock,
          attributes: Object.fromEntries(
            combo.map((item) => [item.name, item.value])
          ),
        };
      });

      return { ...prev, variants };
    });

    setMessage("");
  }

  function regenerateSkus() {
    const baseSku = form.sku || form.name || "SKU";

    setForm((prev) => ({
      ...prev,
      variants: prev.variants.map((variant) => {
        const combo = Object.entries(variant.attributes || {}).map(
          ([name, value]) => ({ name, value })
        );

        if (combo.length === 0) {
          return variant;
        }

        return { ...variant, sku: buildSku(baseSku, combo) };
      }),
    }));
  }

  function applyBulkPrice() {
    if (bulkPrice === "" || Number(bulkPrice) < 0) {
      setMessage("Enter a valid price to apply to all variants.");
      return;
    }

    setForm((prev) => ({
      ...prev,
      variants: prev.variants.map((variant) => ({
        ...variant,
        price: bulkPrice,
      })),
    }));
    setMessage("");
  }

  function useBasePrice() {
    setForm((prev) => ({
      ...prev,
      variants: prev.variants.map((variant) => ({
        ...variant,
        price: prev.price,
      })),
    }));
  }

  function validateForm() {
    const newErrors = {};

    if (!form.name.trim()) {
      newErrors.name = "Product name is required";
    }

    if (form.discountPrice !== "" && Number(form.discountPrice) < 0) {
      newErrors.discountPrice = "Discount price cannot be negative";
    }

    // Only checkable when the product already has a price, which it gets from a
    // received purchase invoice rather than from this form. On a brand new
    // product the price is 0 and any discount would look wrong, so the rule is
    // skipped until a price actually exists.
    if (
      form.discountPrice !== "" &&
      Number(form.price) > 0 &&
      Number(form.discountPrice) >= Number(form.price)
    ) {
      newErrors.discountPrice = "Discount price must be lower than the price";
    }

    if (form.inventoryMode === INVENTORY_MODE.BY_ATTRIBUTE) {
      const group = pricingGroup(form);

      if (!group) {
        newErrors.inventory =
          "Choose a pricing attribute for by-attribute inventory.";
      } else {
        for (const value of group.values || []) {
          const option = form.optionInventory[value];

          if (!option || option.price === "" || Number(option.price) < 0) {
            newErrors.inventory = `Set a valid price for "${value}".`;
            break;
          }
        }

        if (!newErrors.inventory && form.variants.length === 0) {
          newErrors.variants =
            "Generate variants from attributes to continue.";
        }
      }
    }

    const seenSkus = new Set();

    for (const variant of form.variants) {
      const sku = (variant.sku || "").trim().toUpperCase();

      if (sku && seenSkus.has(sku)) {
        newErrors.variants = `Duplicate variant SKU "${sku}". SKUs must be unique.`;
        break;
      }

      if (sku) {
        seenSkus.add(sku);
      }

      if (
        form.inventoryMode !== INVENTORY_MODE.BY_ATTRIBUTE &&
        (variant.price === "" || Number(variant.price) < 0)
      ) {
        newErrors.variants = "Every variant needs a valid price.";
        break;
      }

      if (
        form.inventoryMode === INVENTORY_MODE.PER_SKU &&
        variant.discountPrice !== "" &&
        Number(variant.discountPrice) < 0
      ) {
        newErrors.variants = "Discount price cannot be negative.";
        break;
      }

      if (
        form.inventoryMode === INVENTORY_MODE.PER_SKU &&
        variant.discountPrice !== "" &&
        variant.price !== "" &&
        Number(variant.discountPrice) >= Number(variant.price)
      ) {
        newErrors.variants = "Discount price must be lower than price.";
        break;
      }
    }

    setErrors(newErrors);

    return Object.keys(newErrors).length === 0;
  }

  async function handleSubmit(e) {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    setSaving(true);
    setMessage("");

    try {
      const payload = {
        name: form.name,
        slug: form.slug,
        sku: form.sku,
        shortDescription: form.shortDescription,
        description: form.description,
        // price and stock are deliberately absent. They belong to purchasing:
        // receiving a purchase invoice is what sets them. Sending them would be
        // ignored by the API and would suggest they were being saved.
        discountPrice: form.discountPrice === "" ? null : form.discountPrice,
        lowStockThreshold: parseInt(form.lowStockThreshold, 10) || 0,
        brandUuid: form.brandUuid || null,
        categoryUuid: form.categoryUuid || null,
        images: form.images,
        attributes: form.attributes.flatMap((attr) => {
          const attributeUuid = attr.attribute_uuid || attr.attributeUuid || null;

          return (attr.values || []).map((value) => ({
            attribute_uuid: attributeUuid,
            name: attr.name,
            value,
          }));
        }),
        variants: (form.inventoryMode === INVENTORY_MODE.SINGLE
          ? []
          : form.variants
        ).map((variant) => ({
          name: variant.name || "",
          sku: (variant.sku || "").trim(),
          price: variant.price === "" ? 0 : Number(variant.price),
          stock: parseInt(variant.stock, 10) || 0,
          discountPrice: variant.discountPrice === "" ? null : Number(variant.discountPrice),
          attributes:
            variant.attributes && Object.keys(variant.attributes).length > 0
              ? variant.attributes
              : {},
        })),
        inventoryMode: form.inventoryMode,
        pricingAttributeUuid:
          form.inventoryMode === INVENTORY_MODE.BY_ATTRIBUTE
            ? form.pricingAttribute || null
            : null,
        optionInventory:
          form.inventoryMode === INVENTORY_MODE.BY_ATTRIBUTE
            ? form.optionInventory
            : {},
        featured: form.featured,
        status: form.status,
        expiryDate: form.expiryDate || null,
        metaTitle: form.metaTitle,
        metaDescription: form.metaDescription,
        metaKeywords: form.metaKeywords,
      };

      const data = isEdit
        ? await updateProduct(productId, payload)
        : await createProduct(payload);

      if (!data.success) {
        setMessage(data.message);
        return;
      }

      navigate("/products");
    } catch {
      setMessage("Unable to connect to the server. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  const valueGroups = form.attributes.filter(
    (attr) => (attr.values || []).length > 0
  );
  const combinationCount = valueGroups.reduce(
    (total, group) => total * group.values.length,
    1
  );

  const activePricingGroup = pricingGroup(form);

  return (
    <div className="filament-page">
      <Breadcrumb
        items={[
          { label: "Products", to: "/products" },
          { label: isEdit ? "Edit Product" : "Create Product" },
        ]}
      />

      {message && <div className="filament-alert">{message}</div>}

      <div className="filament-card">
        <div className="filament-card-header">
          <div className="filament-card-header-left">
            <h1>{isEdit ? "Edit Product" : "Create Product"}</h1>
            <p className="filament-card-subtitle">
              {isEdit
                ? "Update product details, pricing, media and variants."
                : "Add a product with pricing, media, attributes and variants."}
            </p>
          </div>
          <div className="filament-card-header-right">
            <button
              type="button"
              className="filament-btn filament-btn-outline"
              onClick={() => navigate("/products")}
            >
              ← Back to Products
            </button>
          </div>
        </div>

        {loading ? (
          <div className="filament-empty">
            <div className="filament-spinner" />
          </div>
        ) : (
          <form className="admin-form resource-form" onSubmit={handleSubmit}>
            {/* ===== Basic details ===== */}
            <h2 className="form-section-title">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M21 19V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2ZM8.5 13.5l2.5 3 3.5-4.5 4.5 6H5l3.5-4.5Z" />
              </svg>
              Basic Details
            </h2>

            <div className="form-row">
              <label className="form-label">
                Name <span className="required">*</span>
              </label>
              <input
                type="text"
                name="name"
                value={form.name}
                onChange={handleChange}
                autoComplete="off"
              />
              {errors.name && <p className="input-error">{errors.name}</p>}
            </div>

            <div className="form-grid">
              <div className="form-row">
                <label className="form-label">
                  Slug{" "}
                  <span className="optional">(auto-generated if blank)</span>
                </label>
                <input
                  type="text"
                  name="slug"
                  value={form.slug}
                  onChange={handleChange}
                  autoComplete="off"
                />
              </div>

              <div className="form-row">
                <label className="form-label">SKU</label>
                <input
                  type="text"
                  name="sku"
                  value={form.sku}
                  onChange={handleChange}
                  autoComplete="off"
                />
              </div>

              <div className="form-row">
                <label className="form-label">Brand</label>
                <select
                  name="brandUuid"
                  value={form.brandUuid}
                  onChange={handleChange}
                >
                  <option value="">No brand</option>
                  {brands.map((brand) => (
                    <option key={brand.uuid} value={brand.uuid}>
                      {brand.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-row">
                <label className="form-label">Category</label>
                <select
                  name="categoryUuid"
                  value={form.categoryUuid}
                  onChange={handleChange}
                >
                  <option value="">No category</option>
                  {categories.map((category) => (
                    <option key={category.uuid} value={category.uuid}>
                      {(category.parent_name ? `${category.parent_name} / ` : "") + category.name}
                    </option>
                  ))}
                </select>
              </div>

              {form.inventoryMode === INVENTORY_MODE.SINGLE && (
              <>
              <div className="form-row">
                <p className="input-hint">
                  Price and stock are not set here. They come from purchasing:
                  add the goods on a
                  {" "}
                  <a href="/purchase-invoices">purchase invoice</a>, and receiving it
                  sets the stock and the selling price for this product.
                </p>
              </div>

              <div className="form-row">
                <label className="form-label">
                  Discount Price{" "}
                  <span className="optional">(leave blank if none)</span>
                </label>
                 <input
                   type="number"
                   name="discountPrice"
                   step="0.01"
                   min="0"
                   value={form.discountPrice}
                   onChange={handleChange}
                   readOnly={isEdit}
                 />
                {errors.discountPrice && (
                  <p className="input-error">{errors.discountPrice}</p>
                )}
              </div>

               <div className="form-row">
                 <label className="form-label">Low Stock Threshold</label>
                 <input
                   type="number"
                   name="lowStockThreshold"
                   min="0"
                   value={form.lowStockThreshold}
                   onChange={handleChange}
                   readOnly={isEdit}
                 />
               </div>
              </>
              )}

              {form.inventoryMode !== INVENTORY_MODE.SINGLE && (
                <div className="form-row">
                  <p className="input-hint">
                    Price and stock are not set here either — they come from
                    receiving a purchase invoice. Discount price is managed per
                    variant below.
                    {form.inventoryMode === INVENTORY_MODE.PER_SKU
                      ? ` Each of ${form.variants.length} variant(s) has its own discount price.`
                      : " Discount prices are shared across attribute values in the table below."}
                  </p>
                </div>
              )}

              <div className="form-row">
                <label className="form-label">Inventory Mode</label>
                <select
                  name="inventoryMode"
                  value={form.inventoryMode}
                  onChange={(e) => handleInventoryModeChange(e.target.value)}
                >
                  {INVENTORY_MODES.map((mode) => (
                    <option key={mode} value={mode}>
                      {INVENTORY_MODE_LABELS[mode]}
                    </option>
                  ))}
                </select>
                <p className="input-hint">
                  {form.inventoryMode === INVENTORY_MODE.SINGLE
                    ? "One price and one stock value for the whole product."
                    : form.inventoryMode === INVENTORY_MODE.PER_SKU
                      ? "Every variant keeps its own price and stock."
                      : "Price and stock are shared across all variants of the chosen attribute."}
                </p>
              </div>

              <div className="form-row">
                <label className="form-label">Expiry Date</label>
                <input
                  type="date"
                  name="expiryDate"
                  value={form.expiryDate}
                  onChange={handleChange}
                />
              </div>

              <div className="form-row">
                <label className="form-label">Status</label>
                <select name="status" value={form.status} onChange={handleChange}>
                  {Object.entries(PRODUCT_STATUS).map(([key, value]) => (
                    <option key={key} value={value}>
                      {key.charAt(0) + key.slice(1).toLowerCase()}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-row form-row-check">
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    name="featured"
                    checked={form.featured}
                    onChange={handleChange}
                  />
                  Featured on storefront
                </label>
              </div>
            </div>

            <div className="form-row">
              <label className="form-label">Short Description</label>
              <input
                type="text"
                name="shortDescription"
                value={form.shortDescription}
                onChange={handleChange}
                autoComplete="off"
              />
            </div>

            <div className="form-row">
              <label className="form-label">Full Description</label>
              <textarea
                name="description"
                rows="6"
                value={form.description}
                onChange={handleChange}
              />
            </div>

            {/* ===== Images ===== */}
            <h2 className="form-section-title">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M19 5v14H5V5h14Zm0-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2Zm-4.86 8.86-3 3.87L9 13.14 6 17h12l-3.86-5.14Z" />
              </svg>
              Images
            </h2>

            <div className="form-row">
              <MediaPicker
                label="Product Images"
                value={form.images}
                multiple
                onChange={(images) =>
                  setForm((prev) => ({ ...prev, images }))
                }
                hint="The first image is used as the storefront thumbnail."
              />
            </div>

            {/* ===== Attributes ===== */}
            <h2 className="form-section-title">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M17 7h-4V3h-2v4H7v2h4v4h2V9h4V7Zm-5 9a5 5 0 1 1-5-5v2.07A3 3 0 1 0 10 16.93V14Z" />
              </svg>
              Attributes
            </h2>

            <p className="input-hint">
              Pick an attribute and add its options (press Enter or comma to add
              each value). These options drive the variant combinations below.
            </p>

            {form.attributes.length === 0 && (
              <p className="input-hint">
                No attributes added yet. Add options such as Size (5kg, 25kg) or
                Colour (Red, Green).
              </p>
            )}

            {form.attributes.map((attr, index) => (
              <div className="repeater-row" key={index}>
                <div className="repeater-fields">
                  <select
                    className="repeater-select"
                    value={attr.attribute_uuid || attr.attributeUuid || ""}
                    onChange={(e) => handleAttributeSelect(index, e.target.value)}
                  >
                    <option value="">— Select attribute —</option>
                    {attributes.map((a) => (
                      <option key={a.uuid} value={a.uuid}>
                        {a.name}
                      </option>
                    ))}
                  </select>

                  <div className="attribute-values">
                    <div className="attribute-chips">
                      {(attr.values || []).map((value, valueIndex) => (
                        <span className="attribute-chip" key={value}>
                          {value}
                          <button
                            type="button"
                            className="attribute-chip-remove"
                            title="Remove value"
                            onClick={() => removeAttributeValue(index, valueIndex)}
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                    <input
                      type="text"
                      className="attribute-value-input"
                      placeholder="Add value, e.g. 5kg"
                      value={attr.draft || ""}
                      onChange={(e) =>
                        updateAttributeDraft(index, e.target.value)
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === ",") {
                          e.preventDefault();
                          commitAttributeValues(index, e.target.value);
                        }
                      }}
                      onBlur={(e) => commitAttributeValues(index, e.target.value)}
                    />
                  </div>
                </div>
                <button
                  type="button"
                  className="filament-action-btn filament-action-danger"
                  title="Remove"
                  onClick={() => removeAttribute(index)}
                >
                  <svg viewBox="0 0 24 24">
                    <path d="M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12ZM8 9h8v10H8V9Zm7.5-5-1-1h-5l-1 1H5v2h14V4h-3.5Z" />
                  </svg>
                </button>
              </div>
            ))}

            <div className="pf-attr-actions">
              <button
                type="button"
                className="filament-btn filament-btn-outline"
                onClick={addAttribute}
              >
                + Add Attribute
              </button>
              {/* Creating an attribute used to mean leaving this form for the
                  Attributes page and coming back, losing the half-filled product.
                  This does it in place and adds the new attribute straight to the
                  picker. */}
              <button
                type="button"
                className="filament-btn filament-btn-secondary"
                onClick={() => setCreatingAttribute(true)}
              >
                + New Attribute
              </button>
            </div>

            {creatingAttribute && (
              <NewAttributeModal
                onClose={() => setCreatingAttribute(false)}
                onCreated={async (created) => {
                  setAttributes((current) => [...current, created]);
                  setCreatingAttribute(false);
                  setMessage(`Attribute "${created.name}" created. Add it below.`);
                }}
              />
            )}

            {/* ===== Variants ===== */}
            <h2 className="form-section-title">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M3 13h8V3H3v10Zm0 8h8v-6H3v6Zm10 0h8V11h-8v10Zm0-18v6h8V3h-8Z" />
              </svg>
              {form.inventoryMode === INVENTORY_MODE.BY_ATTRIBUTE
                ? "Variants by Attribute"
                : "Variants"}
            </h2>

            {form.inventoryMode === INVENTORY_MODE.SINGLE ? (
              <p className="input-hint">
                Single stock for all: the base price and stock above apply to
                the whole product. Switch Inventory Mode to{" "}
                <strong>Per SKU</strong> or <strong>By attribute</strong> to
                manage variants.
              </p>
            ) : (
              <>
                {form.inventoryMode === INVENTORY_MODE.BY_ATTRIBUTE && (
                  <div className="option-pricing">
                    <div className="form-row">
                      <label className="form-label">Pricing attribute</label>
                      <select
                        value={form.pricingAttribute}
                        onChange={(e) =>
                          handlePricingAttributeChange(e.target.value)
                        }
                      >
                        <option value="">— Select attribute —</option>
                        {valueGroups.map((group) => {
                          const uuid =
                            group.attribute_uuid || group.attributeUuid;

                          return (
                            <option key={uuid} value={uuid}>
                              {group.name}
                            </option>
                          );
                        })}
                      </select>
                      <p className="input-hint">
                        Pick the attribute that decides price and stock (e.g.
                        Size). Every combination sharing a value inherits its
                        price and stock.
                      </p>
                    </div>

                    {activePricingGroup && (
                      <div className="variant-table-wrap">
                        <table className="variant-edit-table">
                          <thead>
                            <tr>
                              <th>{activePricingGroup.name}</th>
                              <th>Price</th>
                              <th>Discount Price</th>
                              <th>Stock</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(activePricingGroup.values || []).map((value) => (
                              <tr key={value}>
                                <td>
                                  <span className="variant-chip">{value}</span>
                                </td>
                                <td>
                                  <input
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    placeholder="Price"
                                    value={form.optionInventory[value]?.price ?? ""}
                                    readOnly={isEdit}
                                    onChange={(e) =>
                                      updateOptionInventory(value, "price", e.target.value)
                                    }
                                  />
                                </td>
                                <td>
                                  <input
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    placeholder="Discount"
                                    value={
                                      form.optionInventory[value]?.discount_price ?? ""
                                    }
                                    readOnly={isEdit}
                                    onChange={(e) =>
                                      updateOptionInventory(
                                        value,
                                        "discount_price",
                                        e.target.value
                                      )
                                    }
                                  />
                                </td>
                                <td>
                                  <input
                                    type="number"
                                    min="0"
                                    placeholder="Stock"
                                    value={form.optionInventory[value]?.stock ?? ""}
                                    readOnly={isEdit}
                                    onChange={(e) =>
                                      updateOptionInventory(value, "stock", e.target.value)
                                    }
                                  />
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}

                {form.inventoryMode === INVENTORY_MODE.PER_SKU && (
                  <div className="option-pricing">
                    <p className="input-hint">
                      Each variant has its own price and stock. Edit them
                      individually in the variant table below.
                    </p>
                  </div>
                )}

                <div className="variant-toolbar">
                  <button
                    type="button"
                    className="filament-btn filament-btn-primary"
                    onClick={generateVariants}
                    disabled={valueGroups.length === 0 || isEdit}
                  >
                    Generate from attributes
                    {valueGroups.length > 0 ? ` (${combinationCount})` : ""}
                  </button>
                  {form.inventoryMode === INVENTORY_MODE.PER_SKU && (
                    <button
                      type="button"
                      className="filament-btn filament-btn-outline"
                      onClick={addVariant}
                      disabled={isEdit}
                    >
                      + Add manually
                    </button>
                  )}
                  {form.variants.length > 0 && (
                    <button
                      type="button"
                      className="filament-btn filament-btn-outline"
                      onClick={regenerateSkus}
                    >
                      Regenerate SKUs
                    </button>
                  )}
                </div>

                {valueGroups.length === 0 ? (
                  <p className="input-hint">
                    Add attribute options above, then generate every
                    combination here.
                  </p>
                ) : (
                  <p className="input-hint">
                    {combinationCount}{" "}
                    {combinationCount === 1 ? "combination" : "combinations"}{" "}
                    from {valueGroups.map((group) => group.name).join(" × ")}.
                    {form.inventoryMode === INVENTORY_MODE.BY_ATTRIBUTE
                      ? " Prices and stock come from the attribute table above."
                      : " Each variant can keep the base price or set its own."}
                  </p>
                )}

                {errors.inventory && (
                  <p className="input-error">{errors.inventory}</p>
                )}
                {errors.variants && (
                  <p className="input-error">{errors.variants}</p>
                )}

                {form.inventoryMode === INVENTORY_MODE.PER_SKU &&
                  form.variants.length > 0 && (
                    <div className="variant-bulk">
                       <input
                         type="number"
                         min="0"
                         step="0.01"
                         placeholder="Bulk price"
                         value={bulkPrice}
                         readOnly={isEdit}
                         onChange={(e) => setBulkPrice(e.target.value)}
                       />
                       <button
                         type="button"
                         className="filament-btn filament-btn-outline"
                         onClick={applyBulkPrice}
                         disabled={isEdit}
                       >
                         Apply to all
                       </button>
                       <button
                         type="button"
                         className="filament-btn filament-btn-outline"
                         onClick={useBasePrice}
                         disabled={isEdit}
                       >
                         Use base price
                       </button>
                    </div>
                  )}

                {form.variants.length === 0 && (
                  <p className="input-hint">
                    No variants yet. Use “Generate from attributes” to create
                    them.
                  </p>
                )}

                {form.variants.length > 0 && (
                  <div className="variant-table-wrap">
                    <table className="variant-edit-table">
                      <thead>
                        <tr>
                          <th>Variant</th>
                          <th>SKU</th>
                          <th>Price</th>
                          <th>Discount Price</th>
                          <th>Stock</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {form.variants.map((variant, index) => (
                          <tr key={index}>
                            <td>
                              {variant.attributes &&
                                Object.keys(variant.attributes).length > 0 ? (
                                <div className="variant-combo">
                                  {Object.entries(variant.attributes).map(
                                    ([name, value]) => (
                                      <span className="variant-chip" key={name}>
                                        <em>{name}</em> {value}
                                      </span>
                                    )
                                  )}
                                </div>
                              ) : (
                                <input
                                  type="text"
                                  placeholder='Variant name, e.g. "5kg"'
                                  value={variant.name}
                                  onChange={(e) =>
                                    updateVariant(index, "name", e.target.value)
                                  }
                                />
                              )}
                            </td>
                            <td>
                              <input
                                type="text"
                                className="variant-input-sku"
                                placeholder="SKU"
                                value={variant.sku}
                                onChange={(e) =>
                                  updateVariant(index, "sku", e.target.value)
                                }
                              />
                            </td>
                            <td>
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                placeholder="Price"
                                value={variant.price ?? ""}
                                readOnly={isEdit}
                                onChange={(e) => updateVariant(index, "price", e.target.value)}
                              />
                            </td>
                            <td>
                              {form.inventoryMode ===
                                INVENTORY_MODE.BY_ATTRIBUTE ? (
                                <span className="variant-readonly">
                                  {(variant.discount_price || variant.discountPrice) ?? ""}
                                </span>
                               ) : (
                                <input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  placeholder="Discount"
                                  value={variant.discountPrice ?? variant.discount_price ?? ""}
                                  readOnly={isEdit}
                                  onChange={(e) =>
                                    updateVariant(index, "discountPrice", e.target.value)
                                  }
                                />
                              )}
                            </td>
                            <td>
                              <input
                                type="number"
                                min="0"
                                placeholder="Stock"
                                value={variant.stock ?? ""}
                                readOnly={isEdit}
                                onChange={(e) => updateVariant(index, "stock", e.target.value)}
                              />
                            </td>
                            <td>
                              <button
                                type="button"
                                className="filament-action-btn filament-action-danger"
                                title="Remove"
                                onClick={() => removeVariant(index)}
                                disabled={isEdit}
                              >
                                <svg viewBox="0 0 24 24">
                                  <path d="M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12ZM8 9h8v10H8V9Zm7.5-5-1-1h-5l-1 1H5v2h14V4h-3.5Z" />
                                </svg>
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}

            {/* ===== SEO ===== */}
            <h2 className="form-section-title">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5Zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14Z" />
              </svg>
              SEO
            </h2>

            <div className="form-row">
              <label className="form-label">Meta Title</label>
              <input
                type="text"
                name="metaTitle"
                value={form.metaTitle}
                onChange={handleChange}
                autoComplete="off"
              />
            </div>

            <div className="form-row">
              <label className="form-label">Meta Description</label>
              <textarea
                name="metaDescription"
                rows="2"
                value={form.metaDescription}
                onChange={handleChange}
              />
            </div>

            <div className="form-row">
              <label className="form-label">Meta Keywords</label>
              <input
                type="text"
                name="metaKeywords"
                value={form.metaKeywords}
                onChange={handleChange}
                autoComplete="off"
              />
            </div>

            <div className="form-actions form-actions-sticky">
              <button
                type="button"
                className="filament-btn filament-btn-outline"
                onClick={() => navigate("/products")}
              >
                Cancel
              </button>
              {canSubmit && (
                <button
                  type="submit"
                  className="filament-btn filament-btn-primary"
                  disabled={saving}
                >
                  {saving
                    ? "Saving..."
                    : isEdit
                      ? "Save Changes"
                      : "Create Product"}
                </button>
              )}
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

// ── Create attribute without leaving the product form ─────────────────────
//
// The Attributes page already has its own Create button. This is the one that
// saves you navigating away from a half-filled product: it posts through the same
// attributes API and hands the result back so the picker can use it immediately.

function NewAttributeModal({ onClose, onCreated }) {
  const [name, setName] = useState("");
  const [values, setValues] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Comma separated, matching how the Attributes page lists values.
  const parsedValues = values
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);

  const submit = async (event) => {
    event.preventDefault();
    if (busy || !name.trim()) return;
    setBusy(true);
    setError("");
    try {
      const created = await createAttribute({
        name: name.trim(),
        values: parsedValues,
      });
      onCreated(created);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="filament-modal-overlay" onClick={onClose}>
      <div
        className="filament-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="New attribute"
      >
        <div className="filament-modal-header">
          <div>
            <h2>New attribute</h2>
            <p className="filament-modal-sub">
              Created straight into your attribute list — no need to leave this product.
            </p>
          </div>
          <button type="button" className="filament-modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        <form onSubmit={submit}>
          <div className="filament-modal-body">
            {error && <div className="filament-alert filament-alert-info">{error}</div>}

            <label className="frm-field">
              <span>Attribute name *</span>
              <input
                type="text"
                value={name}
                onChange={(e) => { setName(e.target.value); setError(""); }}
                placeholder="e.g. Pack Size"
                autoFocus
                required
              />
            </label>

            <label className="frm-field">
              <span>Values</span>
              <input
                type="text"
                value={values}
                onChange={(e) => setValues(e.target.value)}
                placeholder="e.g. 5 Kg, 25 Kg, 50 Kg"
              />
              <small className="frm-hint">
                Separate values with commas. You can add or change values later.
              </small>
            </label>
          </div>

          <div className="filament-modal-footer">
            <button type="button" className="filament-btn filament-btn-outline" onClick={onClose}>
              Cancel
            </button>
            <button
              type="submit"
              className="filament-btn filament-btn-primary"
              disabled={busy || !name.trim()}
            >
              {busy ? "Creating…" : "Create attribute"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
