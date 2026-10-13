import { useRef, useState } from "react";
import { uploadMedia, mediaUrl } from "../services/media";
import ImageEditorModal from "./ImageEditorModal";

// One compact image slot for a variant row in the variant table.
//
// `value` is an ARRAY of paths (see utils/variantImages — a variant holds
// several images, not one). A table cell has room for a single fixed square, so
// this shows the first image and, when there are more, a "+N" badge. Clicking
// opens the crop & edit modal and appends; the badge count is the only affordance
// for the rest, and the full set is editable from the By-attribute / All-SKU
// modes where there is space for a real thumbnail row.
//
// Deliberately NOT MediaPicker: that renders a label, a row of thumbnails and a
// "Choose image" button — a block sized for a form, which would force this cell
// wide and push the price and stock columns off a laptop screen. The upload path
// underneath is the same one, so the stored value is a /media/<uuid>.<ext> path
// exactly like a product image.
export default function VariantImageControl({
  value = [],
  onChange,
  readOnly = false,
}) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [request, setRequest] = useState(null);

  // The editor is a promise: pick a file, await the cropped result.
  const resolveEditRef = useRef(null);

  const images = Array.isArray(value) ? value.filter(Boolean) : [];

  function promptEdit(file) {
    return new Promise((resolve) => {
      resolveEditRef.current = resolve;
      setRequest(file);
    });
  }

  function settleEdit(result) {
    resolveEditRef.current?.(result);
    resolveEditRef.current = null;
    setRequest(null);
  }

  async function handleFiles(files) {
    const file = Array.from(files || [])[0];

    if (!file) {
      return;
    }

    setError("");

    const edited = await promptEdit(file);

    if (!edited) {
      return;
    }

    setBusy(true);

    try {
      const data = await uploadMedia(edited);

      if (data.success) {
        onChange([...images, data.url].filter(Boolean));
      } else {
        setError(data.message || "Unable to upload image.");
      }
    } catch {
      setError("Unable to upload image.");
    } finally {
      setBusy(false);
    }
  }

  function pick() {
    if (!readOnly && !busy) {
      inputRef.current?.click();
    }
  }

  function removeFirst() {
    onChange(images.slice(1));
  }

  return (
    <div className="variant-image">
      {images.length > 0 ? (
        <>
          <button
            type="button"
            className="variant-image-slot"
            title={readOnly ? "" : "Add another image"}
            aria-label="Add variant image"
            onClick={pick}
            disabled={readOnly || busy}
          >
            <img src={mediaUrl(images[0])} alt="" className="variant-image-thumb" />

            {images.length > 1 && (
              <span className="variant-image-count">+{images.length - 1}</span>
            )}

            {busy && <span className="variant-image-busy" />}
          </button>

          {!readOnly && (
            <button
              type="button"
              className="variant-image-clear"
              title="Remove image"
              aria-label="Remove variant image"
              onClick={removeFirst}
              disabled={busy}
            >
              &times;
            </button>
          )}
        </>
      ) : (
        <button
          type="button"
          className="variant-image-add"
          title={readOnly ? "" : "Add image"}
          aria-label="Add variant image"
          onClick={pick}
          disabled={readOnly || busy}
        >
          {busy ? (
            <span className="variant-image-busy" />
          ) : (
            <svg viewBox="0 0 24 24" className="variant-image-add-icon">
              <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" />
            </svg>
          )}
        </button>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = "";
        }}
      />

      {error && <p className="input-error">{error}</p>}

      <ImageEditorModal
        file={request}
        title="Crop & edit variant image"
        onApply={(editedFile) => settleEdit(editedFile)}
        onCancel={() => settleEdit(null)}
      />
    </div>
  );
}
