import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  getEmailTemplate,
  createEmailTemplate,
  updateEmailTemplate,
} from "../services/emailTemplates";
import Breadcrumb from "../components/Breadcrumb";
import { useSettings } from "../context/SettingsContext";
import { useAuth } from "../context/AuthContext";
import { STATUS, contrastText } from "@shared/constants";

const SAMPLE_VALUES = {
  appName: "Earth धान्य",
  userName: "John Doe",
  email: "john@example.com",
  password: "D3m0Pass!1",
  loginUrl: "/login",
  resetLink: "/reset-password?token=sample",
  themePrimary: "#3b82f6",
  themeOnPrimary: "#ffffff",
};

const SAMPLE_THEME_COLOR = "#3b82f6";

function buildSampleValues(themeColor) {
  return {
    ...SAMPLE_VALUES,
    themePrimary: themeColor || SAMPLE_THEME_COLOR,
    themeOnPrimary: contrastText(themeColor),
  };
}

// Collects unique {{...}} placeholders from the given source strings.
function detectVariables(...sources) {
  const found = new Set();

  for (const source of sources) {
    const matches = String(source || "").matchAll(/\{\{\s*([\w]+)\s*\}\}/g);

    for (const match of matches) {
      found.add(match[1]);
    }
  }

  return [...found].sort();
}

function replaceSample(source, sampleValues) {
  return String(source || "").replace(
    /\{\{\s*([\w]+)\s*\}\}/g,
    (match, key) =>
      Object.prototype.hasOwnProperty.call(sampleValues, key)
        ? sampleValues[key]
        : match
  );
}

// Returns [start, end) spans of every {{...}} placeholder in the source.
function getPlaceholderSpans(source) {
  const spans = [];
  const matches = String(source || "").matchAll(/\{\{\s*[\w]+\s*\}\}/g);

  for (const match of matches) {
    spans.push({
      start: match.index,
      end: match.index + match[0].length,
    });
  }

  return spans;
}

export default function EmailTemplateForm({ templateId = null }) {
  const isEdit = Boolean(templateId);
  const { can } = useAuth();
  const canSubmit = can(isEdit ? "email_templates.update" : "email_templates.create");
  const navigate = useNavigate();
  const { settings: ctxSettings } = useSettings();

  const [form, setForm] = useState({
    name: "",
    slug: "",
    subject: "",
    bodyHtml: "",
    bodyText: "",
    status: STATUS.ACTIVE,
  });

  const [loading, setLoading] = useState(isEdit);
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [insertSel, setInsertSel] = useState({
    subject: "",
    bodyHtml: "",
    bodyText: "",
  });

  const subjectRef = useRef(null);
  const bodyHtmlRef = useRef(null);
  const bodyTextRef = useRef(null);
  const fieldRefs = {
    subject: subjectRef,
    bodyHtml: bodyHtmlRef,
    bodyText: bodyTextRef,
  };
  const lastFocused = useRef("bodyHtml");

  useEffect(() => {
    if (!isEdit) {
      return;
    }

    let active = true;

    const run = async () => {
      setLoading(true);
      setMessage("");

      try {
        const data = await getEmailTemplate(templateId);

        if (!active) {
          return;
        }

        if (data.success) {
          const t = data.template;

          setForm({
            name: t.name,
            slug: t.slug,
            subject: t.subject,
            bodyHtml: t.body_html,
            bodyText: t.body_text,
            status: t.status,
          });
        } else {
          setMessage(data.message);
        }
      } catch {
        if (!active) {
          return;
        }

        setMessage(
          "Unable to connect to the server. Please try again."
        );
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
  }, [templateId, isEdit]);

  // Only detect placeholders; admin edits content, never dynamic values.
  const variables = detectVariables(
    form.subject,
    form.bodyHtml,
    form.bodyText
  );

  const liveSample = buildSampleValues(ctxSettings.theme_color);

  const insertableVars = [
    ...new Set([...Object.keys(liveSample), ...variables]),
  ];

  const previewSubject = replaceSample(form.subject, liveSample);
  const previewHtml = replaceSample(form.bodyHtml, liveSample);

  function handleChange(e) {
    const { name, value } = e.target;

    setForm((prev) => ({
      ...prev,
      [name]: value,
    }));

    setErrors((prev) => ({
      ...prev,
      [name]: "",
    }));
  }

  function handleFocus(field) {
    lastFocused.current = field;
  }

  function moveCaret(field, position) {
    const el = fieldRefs[field].current;

    if (!el) {
      return;
    }

    el.focus();

    setTimeout(() => {
      const target = Math.max(
        0,
        Math.min(position, el.value.length)
      );
      el.setSelectionRange(target, target);
    }, 0);
  }

  function insertToken(token) {
    const field = lastFocused.current;
    const el = fieldRefs[field].current;
    const current = form[field] ?? "";
    const start = el ? el.selectionStart : current.length;
    const end = el ? el.selectionEnd : current.length;

    setForm((prev) => ({
      ...prev,
      [field]:
        current.slice(0, start) +
        token +
        current.slice(end),
    }));

    moveCaret(field, start + token.length);
  }

  function removeToken(field, span) {
    const current = form[field] ?? "";

    setForm((prev) => ({
      ...prev,
      [field]:
        current.slice(0, span.start) + current.slice(span.end),
    }));

    moveCaret(field, span.start);
  }

  // Locks existing {{...}} placeholders so they can't be changed as plain text.
  function handleContentKeyDown(e, field) {
    const el = e.currentTarget;
    const { selectionStart, selectionEnd, value } = el;
    const spans = getPlaceholderSpans(value);

    if (selectionStart === selectionEnd) {
      const pos = selectionStart;

      if (e.key === "Backspace") {
        const whole = spans.find((s) => pos === s.end);

        if (whole) {
          e.preventDefault();
          removeToken(field, whole);
          return;
        }

        if (spans.some((s) => pos > s.start && pos <= s.end)) {
          e.preventDefault();
        }
        return;
      }

      if (e.key === "Delete") {
        if (spans.some((s) => pos >= s.start && pos < s.end)) {
          e.preventDefault();
        }
        return;
      }

      if (
        e.key.length === 1 &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        !e.isComposing
      ) {
        if (spans.some((s) => pos > s.start && pos < s.end)) {
          e.preventDefault();
        }
      }
      return;
    }

    const start = Math.min(selectionStart, selectionEnd);
    const end = Math.max(selectionStart, selectionEnd);
    const partial = spans.some(
      (s) =>
        start < s.end &&
        end > s.start &&
        !(start <= s.start && end >= s.end)
    );

    if (partial) {
      e.preventDefault();
    }
  }

  // Blocks paste / IME composition that would rewrite a placeholder.
  function handleBeforeInput(e) {
    const el = e.currentTarget;
    const { selectionStart, selectionEnd, value } = el;
    const spans = getPlaceholderSpans(value);
    const start = Math.min(selectionStart, selectionEnd);
    const end = Math.max(selectionStart, selectionEnd);

    const blocked = spans.some((s) => {
      if (start === end) {
        return start > s.start && start < s.end;
      }

      return (
        start < s.end &&
        end > s.start &&
        !(start <= s.start && end >= s.end)
      );
    });

    if (blocked) {
      e.preventDefault();
    }
  }

  function handleInsertClick(field) {
    const token = insertSel[field];

    if (!token) {
      return;
    }

    insertToken(`{{${token}}}`);

    setInsertSel((prev) => ({
      ...prev,
      [field]: "",
    }));
  }

  async function handleSubmit(e) {
    e.preventDefault();

    const newErrors = {};

    if (!form.name.trim()) {
      newErrors.name = "Template name is required";
    }

    if (form.slug && !/^[a-z0-9_]+$/.test(form.slug)) {
      newErrors.slug =
        "Slug can only contain lowercase letters, numbers, and underscores";
    }

    if (!form.subject.trim()) {
      newErrors.subject = "Subject is required";
    }

    if (!form.bodyHtml.trim()) {
      newErrors.bodyHtml = "HTML body is required";
    }

    setErrors(newErrors);

    if (Object.keys(newErrors).length > 0) {
      return;
    }

    setSaving(true);
    setMessage("");

    try {
      const payload = {
        name: form.name,
        slug: form.slug,
        subject: form.subject,
        bodyHtml: form.bodyHtml,
        bodyText: form.bodyText,
        variables,
        status: form.status,
      };

      const data = isEdit
        ? await updateEmailTemplate(templateId, payload)
        : await createEmailTemplate(payload);

      if (!data.success) {
        setMessage(data.message);
        return;
      }

      navigate("/email-templates");
    } catch {
      setMessage(
        "Unable to connect to the server. Please try again."
      );
    } finally {
      setSaving(false);
    }
  }

  function renderInsertBar(field, hint) {
    return (
      <div className="template-insertbar">
        <select
          value={insertSel[field]}
          onChange={(e) =>
            setInsertSel((prev) => ({
              ...prev,
              [field]: e.target.value,
            }))
          }
          onFocus={() => handleFocus(field)}
        >
          <option value="">Insert dynamic value…</option>
          {insertableVars.map((v) => (
            <option key={v} value={v}>
              {`{{${v}}}`}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="filament-btn filament-btn-outline"
          disabled={!insertSel[field]}
          onClick={() => handleInsertClick(field)}
        >
          Insert
        </button>
        {hint && <span className="template-hint">{hint}</span>}
      </div>
    );
  }

  return (
    <div className="filament-page">
      <Breadcrumb
        items={[
          { label: "Email Templates", to: "/email-templates" },
          {
            label: isEdit ? "Edit Template" : "Create Template",
          },
        ]}
      />

      {message && (
        <div className="filament-alert">{message}</div>
      )}

      <div className="filament-card">
        <div className="filament-card-header">
          <div className="filament-card-header-left">
            <h1>
              {isEdit ? "Edit Template" : "Create Template"}
            </h1>
          </div>
          <div className="filament-card-header-right">
            <button
              type="button"
              className="filament-btn filament-btn-outline"
              onClick={() => navigate("/email-templates")}
            >
              ← Back to Templates
            </button>
          </div>
        </div>

        {loading ? (
          <div className="filament-empty">
            <div className="filament-spinner" />
          </div>
        ) : (
          <form
            className="admin-form email-template-form"
            onSubmit={handleSubmit}
          >
            {/* =====================================
                BASIC DETAILS
            ====================================== */}

            <h2 className="template-section-title">
              Basic Details
            </h2>

            <div className="form-grid">
              <div className="form-row">
                <label className="form-label">
                  Name <span className="required">*</span>
                </label>
                <input
                  type="text"
                  name="name"
                  placeholder="e.g. Login Credentials"
                  value={form.name}
                  onChange={handleChange}
                  autoComplete="off"
                />
                {errors.name && (
                  <p className="input-error">{errors.name}</p>
                )}
              </div>

              <div className="form-row">
                <label className="form-label">
                  Slug{" "}
                  <span className="optional">
                    (auto-generated if blank)
                  </span>
                </label>
                <input
                  type="text"
                  name="slug"
                  placeholder="e.g. credentials"
                  value={form.slug}
                  onChange={handleChange}
                  autoComplete="off"
                  disabled={isEdit}
                />
                {errors.slug && (
                  <p className="input-error">{errors.slug}</p>
                )}
              </div>

              <div className="form-row">
                <label className="form-label">
                  Subject <span className="required">*</span>
                </label>
                <input
                  type="text"
                  name="subject"
                  placeholder="e.g. Your {{appName}} Account Credentials"
                  value={form.subject}
                  onChange={handleChange}
                  autoComplete="off"
                  ref={subjectRef}
                  onFocus={() => handleFocus("subject")}
                  onKeyDown={(e) =>
                    handleContentKeyDown(e, "subject")
                  }
                  onBeforeInput={(e) =>
                    handleBeforeInput(e, "subject")
                  }
                />
                {errors.subject && (
                  <p className="input-error">{errors.subject}</p>
                )}
                {renderInsertBar("subject")}
              </div>

              <div className="form-row">
                <label className="form-label">Status</label>
                <select
                  name="status"
                  value={form.status}
                  onChange={handleChange}
                >
                  <option value={STATUS.ACTIVE}>Active</option>
                  <option value={STATUS.INACTIVE}>Inactive</option>
                </select>
              </div>
            </div>

            {/* =====================================
                CONTENT
            ====================================== */}

            <h2 className="template-section-title">Content</h2>

            <div className="form-row">
              <label className="form-label">HTML Body</label>
              <textarea
                name="bodyHtml"
                className="template-code"
                placeholder="Write HTML with {{placeholders}} for dynamic values"
                value={form.bodyHtml}
                onChange={handleChange}
                rows="12"
                autoComplete="off"
                ref={bodyHtmlRef}
                onFocus={() => handleFocus("bodyHtml")}
                onKeyDown={(e) =>
                  handleContentKeyDown(e, "bodyHtml")
                }
                onBeforeInput={(e) =>
                  handleBeforeInput(e, "bodyHtml")
                }
              />
              {errors.bodyHtml && (
                <p className="input-error">{errors.bodyHtml}</p>
              )}
              {renderInsertBar(
                "bodyHtml",
                "Placeholders are locked — they cannot be typed or changed as text."
              )}
            </div>

            <div className="form-row">
              <label className="form-label">Plain Text Body</label>
              <textarea
                name="bodyText"
                className="template-code"
                placeholder="Fallback text version used by plain-text email clients"
                value={form.bodyText}
                onChange={handleChange}
                rows="6"
                autoComplete="off"
                ref={bodyTextRef}
                onFocus={() => handleFocus("bodyText")}
                onKeyDown={(e) =>
                  handleContentKeyDown(e, "bodyText")
                }
                onBeforeInput={(e) =>
                  handleBeforeInput(e, "bodyText")
                }
              />
              {renderInsertBar(
                "bodyText",
                "Placeholders are locked — they cannot be typed or changed as text."
              )}
            </div>

            <div className="form-row">
              <label className="form-label">
                Dynamic Values{" "}
                <span className="optional">
                  (auto-detected, locked)
                </span>
              </label>
              {variables.length > 0 ? (
                <div className="dtv-panel">
                  {variables.map((variable) => (
                    <span
                      key={variable}
                      className="dtv-chip dtv-chip-inuse"
                    >
                      {`{{${variable}}}`}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="template-hint">
                  No placeholders used yet. Insert one from the
                  “Insert dynamic value…” selector above.
                </p>
              )}
            </div>

            {/* =====================================
                PREVIEW
            ====================================== */}

            {previewHtml.trim() && (
              <div className="form-row">
                <h2 className="template-section-title">
                  Preview{" "}
                  <span className="optional">
                    (uses sample values)
                  </span>
                </h2>
                <div>
                  <div
                    style={{
                      border: "1px solid #e2e8f0",
                      borderRadius: "8px",
                      padding: "12px 16px",
                      marginBottom: "10px",
                      background: "#f8fafc",
                      color: "#1e293b",
                      fontSize: "14px",
                    }}
                  >
                    <strong>Subject:</strong>{" "}
                    {previewSubject || "—"}
                  </div>
                  <div
                    style={{
                      border: "1px solid #e2e8f0",
                      borderRadius: "8px",
                      overflow: "hidden",
                      background: "#ffffff",
                    }}
                  >
                    <iframe
                      title="Email preview"
                      sandbox=""
                      srcDoc={`<!doctype html><html><head><meta charset="utf-8" /><style>html,body{margin:0;padding:0;}</style></head><body>${previewHtml}</body></html>`}
                      className="template-preview-frame"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* =====================================
                ACTIONS
            ====================================== */}

            <div className="form-actions">
              <button
                type="button"
                className="filament-btn filament-btn-outline"
                onClick={() => navigate("/email-templates")}
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
                    : "Create Template"}
              </button>
              )}
            </div>
          </form>
        )}
      </div>
    </div>
  );
}