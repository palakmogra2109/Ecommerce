import { useRef, useState } from "react";
import { uploadMedia, mediaUrl } from "../services/media";
import ImageEditorModal from "./ImageEditorModal";

// Reusable image picker used across module forms.
// single mode  -> value is a string path, onChange(path)
// multiple mode -> value is an array of paths, onChange([...paths])
//
// Every picked file first opens the crop & edit modal, and already
// uploaded images can be re-edited from their thumbnail.
export default function MediaPicker({
  value,
  onChange,
  label = "Image",
  multiple = false,
  hint = "",
  aspect = null,
  lockAspect = false,
}) {
  const inputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  /*
   * Editor state: files awaiting crop/upload are queued, and the modal is
   * shown for one file at a time. replacePath marks a re-edit of an
   * existing image instead of a fresh upload.
   */
  const queueRef = useRef([]);
  const busyRef = useRef(false);
  const resolveEditRef = useRef(null);
  const [editorRequest, setEditorRequest] = useState(null);
  const [editingThumb, setEditingThumb] = useState(false);

  const items = multiple ? (Array.isArray(value) ? value : []) : [value];

  function promptEdit(file, replacePath = null) {
    return new Promise((resolve) => {
      resolveEditRef.current = resolve;
      setEditorRequest({ file, replacePath });
    });
  }

  function settleEdit(result) {
    const resolve = resolveEditRef.current;

    resolveEditRef.current = null;
    setEditorRequest(null);

    resolve?.(result);
  }

  async function handleEditorApply(editedFile) {
    const request = editorRequest;

    settleEdit({ file: editedFile, replacePath: request?.replacePath ?? null });
  }

  function handleEditorCancel() {
    settleEdit(null);
  }

  async function uploadOne(file) {
    const data = await uploadMedia(file);

    if (data.success) {
      setError("");
      return data.url;
    }

    throw new Error(data.message || "Unable to upload image.");
  }

  function applyUpload(url, replacePath) {
    if (replacePath) {
      if (multiple) {
        onChange(items.map((item) => (item === replacePath ? url : item)));
      } else {
        onChange(url);
      }

      return;
    }

    if (multiple) {
      onChange([...items.filter(Boolean), url]);
    } else {
      onChange(url);
    }
  }

  /*
   * Process the queue: open the editor for each file, then upload the
   * cropped result (or skip cancelled files).
   */
  async function pumpQueue() {
    if (busyRef.current) {
      return;
    }

    busyRef.current = true;

    try {
      while (queueRef.current.length > 0) {
        const original = queueRef.current.shift();

        setEditingThumb(false);

        const edited = await promptEdit(original, null);

        if (!edited?.file) {
          continue;
        }

        setUploading(true);

        try {
          const url = await uploadOne(edited.file);

          applyUpload(url, null);
        } catch (uploadError) {
          setError(uploadError.message || "Unable to upload image. Please try again.");
        } finally {
          setUploading(false);
        }
      }
    } finally {
      busyRef.current = false;
    }
  }

  async function handleFiles(files) {
    const list = Array.from(files || []);

    if (list.length === 0) {
      return;
    }

    setError("");

    queueRef.current.push(...list);
    await pumpQueue();
  }

  /*
   * Re-edit an image that is already attached to the form: fetch it, run
   * it through the editor, and upload the cropped result as a replacement.
   */
  async function handleEditExisting(path) {
    if (editingThumb || busyRef.current) {
      return;
    }

    setEditingThumb(true);
    setError("");

    try {
      const response = await fetch(mediaUrl(path), { credentials: "include" });

      if (!response.ok) {
        throw new Error("Unable to load image.");
      }

      const blob = await response.blob();
      const extension = (path.split(".").pop() || "png").toLowerCase();
      const mimeType = blob.type || `image/${extension === "jpg" ? "jpeg" : extension}`;
      const fileName = path.split("/").pop() || `image.${extension}`;
      const file = new File([blob], fileName, { type: mimeType });

      busyRef.current = true;

      try {
        const edited = await promptEdit(file, path);

        if (edited?.file) {
          setUploading(true);

          try {
            const url = await uploadOne(edited.file);

            applyUpload(url, path);
          } catch (uploadError) {
            setError(uploadError.message || "Unable to upload image. Please try again.");
          } finally {
            setUploading(false);
          }
        }
      } finally {
        busyRef.current = false;
      }
    } catch {
      setError("Unable to load image for editing.");
    } finally {
      setEditingThumb(false);
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
              className="media-picker-edit"
              aria-label="Edit image"
              title="Crop & edit"
              disabled={editingThumb}
              onClick={() => handleEditExisting(path)}
            >
              <svg viewBox="0 0 24 24" className="media-picker-edit-icon">
                <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" />
              </svg>
            </button>
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
          onChange={(e) => {
            handleFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {hint && <p className="template-hint">{hint}</p>}
      {error && <p className="input-error">{error}</p>}

      <ImageEditorModal
        file={editorRequest?.file || null}
        title="Crop & edit image"
        initialAspect={aspect}
        lockAspect={lockAspect}
        onApply={handleEditorApply}
        onCancel={handleEditorCancel}
      />
    </div>
  );
}
