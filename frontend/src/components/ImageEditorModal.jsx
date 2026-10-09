import { useEffect, useRef, useState } from "react";
import Cropper from "react-easy-crop";

/*
 * Reusable crop & edit modal shown whenever an image is picked for upload.
 * Used by MediaPicker and the avatar upload in UserForm, so it is available
 * in both the admin panel and the store panel.
 *
 * Props:
 *  - file           File selected by the user (null hides the modal)
 *  - title          Modal heading
 *  - initialAspect  Aspect ratio preselected when the modal opens
 *  - lockAspect     Hide the ratio chips and force initialAspect
 *  - onApply(editedFile)  Called with the cropped File, or null when skipped
 *  - onCancel()     Called when the modal is dismissed
 */

const ASPECT_PRESETS = [
  { label: "Free", value: null },
  { label: "1:1", value: 1 },
  { label: "4:3", value: 4 / 3 },
  { label: "3:4", value: 3 / 4 },
  { label: "16:9", value: 16 / 9 }, 
];

/*
 * Ready-made output sizes. Selecting one locks the crop to the matching
 * ratio and resizes the saved image to exactly that many pixels.
 */
const SIZE_PRESETS = [
  { key: "sq400", label: "400 × 400 (Small square)", size: { width: 400, height: 400 } },
  { key: "sq800", label: "800 × 800 (Medium square)", size: { width: 800, height: 800 } },
  { key: "sq1024", label: "1024 × 1024 (Large square)", size: { width: 1024, height: 1024 } },
  { key: "ls800", label: "800 × 600 (Landscape)", size: { width: 800, height: 600 } },
  { key: "pt600", label: "600 × 800 (Portrait)", size: { width: 600, height: 800 } },
  { key: "hd1280", label: "1280 × 720 (Widescreen)", size: { width: 1280, height: 720 } },
  { key: "hd1500", label: "1280 × 1500 (Widescreen)", size: { width: 1280, height: 1500 } },
];

const MIN_SIZE = 16;

function parseSize(width, height) {
  const parsedWidth = parseInt(width, 10);
  const parsedHeight = parseInt(height, 10);

  if (Number.isFinite(parsedWidth) && Number.isFinite(parsedHeight) && parsedWidth >= MIN_SIZE && parsedHeight >= MIN_SIZE) {
    return { width: parsedWidth, height: parsedHeight };
  }

  return null;
}

function getRadianAngle(degrees) {
  return (degrees * Math.PI) / 180;
}

function rotateSize(width, height, rotation) {
  const rotRad = getRadianAngle(rotation);

  return {
    width: Math.abs(Math.cos(rotRad) * width) + Math.abs(Math.sin(rotRad) * height),
    height: Math.abs(Math.sin(rotRad) * width) + Math.abs(Math.cos(rotRad) * height),
  };
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();

    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Unable to load image"));
    image.src = src;
  });
}

/*
 * Render the selected crop area (with rotation applied) to a canvas and
 * return it as a File ready for upload.
 */
async function cropToImageFile(src, pixelCrop, rotation, originalFile, targetSize = null) {
  const image = await loadImage(src);
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Canvas is not supported in this browser");
  }

  const rotRad = getRadianAngle(rotation);
  const boundingBox = rotateSize(image.width, image.height, rotation);

  canvas.width = Math.round(boundingBox.width);
  canvas.height = Math.round(boundingBox.height);

  context.translate(canvas.width / 2, canvas.height / 2);
  context.rotate(rotRad);
  context.translate(-image.width / 2, -image.height / 2);
  context.drawImage(image, 0, 0);

  const output = document.createElement("canvas");
  const outputContext = output.getContext("2d");

  output.width = targetSize
    ? Math.round(targetSize.width)
    : Math.max(1, Math.round(pixelCrop.width));
  output.height = targetSize
    ? Math.round(targetSize.height)
    : Math.max(1, Math.round(pixelCrop.height));

  outputContext.imageSmoothingEnabled = true;
  outputContext.imageSmoothingQuality = "high";

  outputContext.drawImage(
    canvas,
    pixelCrop.x,
    pixelCrop.y,
    pixelCrop.width,
    pixelCrop.height,
    0,
    0,
    output.width,
    output.height
  );

  /*
   * Keep PNG for sources that may be transparent, JPEG otherwise so
   * photos stay small.
   */
  const sourceType = originalFile?.type || "image/jpeg";
  const keepPng =
    sourceType === "image/png" ||
    sourceType === "image/webp" ||
    sourceType === "image/svg+xml";
  const mimeType = keepPng ? "image/png" : "image/jpeg";
  const extension = keepPng ? "png" : "jpg";

  const blob = await new Promise((resolve, reject) => {
    output.toBlob(
      (result) => (result ? resolve(result) : reject(new Error("Unable to process image"))),
      mimeType,
      keepPng ? undefined : 0.92
    );
  });

  const baseName = (originalFile?.name || "image").replace(/\.[^.]+$/, "");

  return new File([blob], `${baseName}.${extension}`, { type: mimeType });
}

export default function ImageEditorModal(props) {
  /*
   * Mount a fresh editor for every file so all crop state resets between
   * images, and unmount completely while closed.
   */
  if (!props.file) {
    return null;
  }

  return (
    <ImageEditorInner
      key={`${props.file.name}-${props.file.size}-${props.file.lastModified}`}
      {...props}
    />
  );
}

function ImageEditorInner({
  file,
  title = "Edit image",
  initialAspect = null,
  lockAspect = false,
  onApply,
  onCancel,
}) {
  const [objectUrl] = useState(() => URL.createObjectURL(file));
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [aspect, setAspect] = useState(lockAspect ? initialAspect : initialAspect ?? null);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState(null);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState("");
  const applyLockRef = useRef(false);

  /*
   * Output size selection: "original" keeps the crop at natural resolution,
   * a preset key resizes to that exact size, "custom" uses the W × H inputs.
   */
  const [sizeChoice, setSizeChoice] = useState("original");
  const [size, setSize] = useState(null);
  const [customWidth, setCustomWidth] = useState("");
  const [customHeight, setCustomHeight] = useState("");

  /*
   * Revoke the preview URL when the editor unmounts
   */
  useEffect(
    () => () => {
      URL.revokeObjectURL(objectUrl);
    },
    [objectUrl]
  );

  useEffect(() => {
    if (applying) {
      return undefined;
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        onCancel();
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [applying, onCancel]);

  function handleCropComplete(_croppedArea, croppedPixels) {
    setCroppedAreaPixels(croppedPixels);
  }

  function resetEdits() {
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setRotation(0);
    setAspect(lockAspect ? initialAspect : null);
    setSizeChoice("original");
    setSize(null);
    setCustomWidth("");
    setCustomHeight("");
    setError("");
  }

  function handleSizeChange(choice) {
    setSizeChoice(choice);
    setError("");

    if (choice === "original") {
      setSize(null);
      return;
    }

    if (choice === "custom") {
      const parsed = parseSize(customWidth, customHeight);

      if (parsed) {
        setSize(parsed);
        setAspect(parsed.width / parsed.height);
      } else {
        setSize(null);
      }

      return;
    }

    const preset = SIZE_PRESETS.find((item) => item.key === choice);

    if (preset) {
      setSize(preset.size);
      setAspect(preset.size.width / preset.size.height);
    }
  }

  function handleCustomSize(width, height) {
    setCustomWidth(width);
    setCustomHeight(height);

    const parsed = parseSize(width, height);

    if (parsed) {
      setSize(parsed);
      setAspect(parsed.width / parsed.height);
      setError("");
    } else {
      setSize(null);
    }
  }

  async function handleApply() {
    if (applyLockRef.current) {
      return;
    }

    if (!croppedAreaPixels) {
      setError("Please wait for the image to load.");
      return;
    }

    if (sizeChoice === "custom" && !size) {
      setError(`Enter a width and height of at least ${MIN_SIZE}px.`);
      return;
    }

    applyLockRef.current = true;
    setApplying(true);
    setError("");

    try {
      const editedFile = await cropToImageFile(
        objectUrl,
        croppedAreaPixels,
        rotation,
        file,
        size
      );

      onApply(editedFile);
    } catch {
      setError("Unable to process this image. Try a different file.");
      setApplying(false);
      applyLockRef.current = false;
    }
  }

  return (
    <div
      className="image-editor-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !applying) {
          onCancel();
        }
      }}
    >
      <div className="image-editor">
        <div className="image-editor-header">
          <h2>{title}</h2>
          <button
            type="button"
            className="image-editor-close"
            aria-label="Close editor"
            onClick={onCancel}
            disabled={applying}
          >
            &times;
          </button>
        </div>

        <div className="image-editor-canvas">
          <Cropper
            image={objectUrl}
            crop={crop}
            zoom={zoom}
            rotation={rotation}
            aspect={aspect ?? undefined}
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onRotationChange={setRotation}
            onCropComplete={handleCropComplete}
            showGrid
            restrictPosition
            minZoom={0.5}
            maxZoom={4}
          />
        </div>

        <div className="image-editor-controls">
          <div className="image-editor-ratios">
            {lockAspect ? (
              <span className="image-editor-chip active">
                {initialAspect === 1 ? "1:1" : "Locked ratio"}
              </span>
            ) : (
              ASPECT_PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  className={`image-editor-chip${aspect === preset.value ? " active" : ""}`}
                  onClick={() => {
                    setAspect(preset.value);
                    setSizeChoice("original");
                    setSize(null);
                  }}
                >
                  {preset.label}
                </button>
              ))
            )}
          </div>

          <div className="image-editor-slider image-editor-size">
            <span className="image-editor-slider-label">Size</span>
            <select
              className="image-editor-select"
              value={sizeChoice}
              onChange={(event) => handleSizeChange(event.target.value)}
              disabled={applying}
            >
              <option value="original">Original</option>
              {SIZE_PRESETS.map((preset) => (
                <option key={preset.key} value={preset.key}>
                  {preset.label}
                </option>
              ))}
              <option value="custom">Custom size…</option>
            </select>

            {sizeChoice === "custom" && (
              <span className="image-editor-custom-size">
                <input
                  type="number"
                  min={MIN_SIZE}
                  max={8000}
                  placeholder="W"
                  aria-label="Custom width in pixels"
                  value={customWidth}
                  onChange={(event) =>
                    handleCustomSize(event.target.value, customHeight)
                  }
                />
                <span aria-hidden="true">×</span>
                <input
                  type="number"
                  min={MIN_SIZE}
                  max={8000}
                  placeholder="H"
                  aria-label="Custom height in pixels"
                  value={customHeight}
                  onChange={(event) =>
                    handleCustomSize(customWidth, event.target.value)
                  }
                />
                <span aria-hidden="true">px</span>
              </span>
            )}

            {size && (
              <span className="image-editor-size-hint">
                Output: {size.width} × {size.height} px
              </span>
            )}
          </div>

          <div className="image-editor-slider">
            <span className="image-editor-slider-label">Zoom</span>
            <input
              type="range"
              min={0.5}
              max={4}
              step={0.01}
              value={zoom}
              onChange={(event) => setZoom(Number(event.target.value))}
            />
          </div>

          <div className="image-editor-slider">
            <span className="image-editor-slider-label">Rotate</span>
            <button
              type="button"
              className="image-editor-icon-btn"
              aria-label="Rotate left 90 degrees"
              onClick={() => setRotation((prev) => (prev + 270) % 360)}
            >
              &#8634;
            </button>
            <input
              type="range"
              min={0}
              max={360}
              step={1}
              value={rotation}
              onChange={(event) => setRotation(Number(event.target.value))}
            />
            <button
              type="button"
              className="image-editor-icon-btn"
              aria-label="Rotate right 90 degrees"
              onClick={() => setRotation((prev) => (prev + 90) % 360)}
            >
              &#8635;
            </button>
          </div>
        </div>

        {error && <p className="input-error image-editor-error">{error}</p>}

        <div className="image-editor-footer">
          <button
            type="button"
            className="filament-btn filament-btn-outline"
            onClick={resetEdits}
            disabled={applying}
          >
            Reset
          </button>
          <div className="image-editor-footer-spacer" />
          <button
            type="button"
            className="filament-btn filament-btn-outline"
            onClick={onCancel}
            disabled={applying}
          >
            Cancel
          </button>
          <button
            type="button"
            className="filament-btn filament-btn-primary"
            onClick={handleApply}
            disabled={applying}
          >
            {applying ? "Processing…" : "Save & upload"}
          </button>
        </div>
      </div>
    </div>
  );
}
