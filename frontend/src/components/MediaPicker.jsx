import { useRef, useState } from "react";
import { uploadMedia, mediaUrl } from "../services/media";

// Reusable image picker used across module forms.
// single mode  -> value is a string path, onChange(path)
// multiple mode -> value is an array of paths, onChange([...paths])
export default function MediaPicker({
  value,
  onChange,
  label = "Image",
  multiple = false,
  hint = "",
}) {
  const inputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  const items = multiple ? (Array.isArray(value) ? value : []) : [value];

  async function handleFiles(files) {
    if (!files || files.length === 0) {
      return;
    }

    setUploading(true);
    setError("");

    try {
      const uploaded = [];

      for (const file of files) {
        const data = await uploadMedia(file);

        if (data.success) {
          uploaded.push(data.url);
        } else {
          setError(data.message || "Unable to upload image.");
        }
      }

      if (uploaded.length > 0) {
        if (multiple) {
          onChange([...items.filter(Boolean), ...uploaded]);
        } else {
          onChange(uploaded[uploaded.length - 1]);
        }
      }
    } catch {
      setError("Unable to upload image. Please try again.");
    } finally {
      setUploading(false);
      if (inputRef.current) {
        inputRef.current.value = "";
      }
    }
  }

  function removeItem(path) {
    if (multiple) {
      onChange(items.filter((item) => item !== path));
    } else {
      onChange("");
    }
  }

  return (
    <div className="media-picker">
      {label && <label className="form-label">{label}</label>}

      <div className="media-picker-row">
        {items.filter(Boolean).map((path) => (
          <div className="media-picker-item" key={path}>
            <img
              src={mediaUrl(path)}
              alt="preview"
              className="media-picker-thumb"
            />
            <button
              type="button"
              className="media-picker-remove"
              aria-label="Remove image"
              onClick={() => removeItem(path)}
            >
              &times;
            </button>
          </div>
        ))}

        <button
          type="button"
          className={`media-picker-add${uploading ? " media-picker-busy" : ""}`}
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? (
            <span className="filament-spinner" />
          ) : (
            <svg viewBox="0 0 24 24" className="media-picker-add-icon">
              <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" />
            </svg>
          )}
          <span>{uploading ? "Uploading…" : "Choose image"}</span>
        </button>

        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple={multiple}
          hidden
          onChange={(e) => handleFiles(e.target.files)}
        />
      </div>

      {hint && <p className="template-hint">{hint}</p>}
      {error && <p className="input-error">{error}</p>}
    </div>
  );
}