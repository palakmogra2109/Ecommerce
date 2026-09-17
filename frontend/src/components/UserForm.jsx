import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import {
  getUser,
  createUser,
  updateUser,
} from "../services/users";

import { listRoles } from "../services/roles";
import {
  uploadMedia,
  mediaUrl,
} from "../services/media";

import Breadcrumb from "../components/Breadcrumb";
import Avatar from "../components/Avatar";
import PhoneInput from "../components/PhoneInput";
import { validateMobile } from "../utils/validation";
import { isSuperAdmin } from "@shared/constants";

export default function UserForm({ userId = null }) {
  const isEdit = Boolean(userId);
  const navigate = useNavigate();

  const [form, setForm] = useState({
    name: "",
    email: "",
    mobile: "",
    avatar: null,
  });

  const [roles, setRoles] = useState([]);
  const [roleId, setRoleId] = useState("");

  const [preview, setPreview] = useState(null);

  const [loading, setLoading] = useState(isEdit);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState("");

  /*
   * Load roles and user data
   */
  useEffect(() => {
    let active = true;

    async function run() {
      setLoading(true);
      setMessage("");

      try {
        /*
         * Load roles
         */
        const rolesData = await listRoles();

        if (!active) {
          return;
        }

        if (rolesData.success) {
          setRoles(rolesData.roles || []);
        } else {
          setMessage(
            rolesData.message || "Unable to load roles."
          );
        }

        /*
         * Load user when editing
         */
        if (isEdit) {
          const userData = await getUser(userId);

          if (!active) {
            return;
          }

          if (userData.success) {
            const u = userData.user;

            setForm({
              name: u.name ?? "",
              email: u.email ?? "",
              mobile: u.mobile ?? "",
              avatar: u.avatar ?? null,
            });

            setPreview(
              u.avatar
                ? mediaUrl(u.avatar)
                : null
            );

            /*
             * Existing role
             */
            if (u.role) {
              setRoleId(String(u.role.uuid));
            } else if (u.roleId) {
              setRoleId(String(u.roleId));
            } else {
              setRoleId("");
            }
          } else {
            setMessage(
              userData.message ||
              "Unable to load user."
            );
          }
        }
      } catch (error) {
        console.error(error);

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
    }

    run();

    return () => {
      active = false;
    };
  }, [userId, isEdit]);

  /*
   * Input change
   */
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

    setMessage("");
  }

  /*
   * Role change
   */
  function handleRoleChange(e) {
    setRoleId(e.target.value);

    setErrors((prev) => ({
      ...prev,
      roleId: "",
    }));

    setMessage("");
  }

  /*
   * Upload avatar
   */
  async function handleAvatarChange(e) {
    const file = e.target.files?.[0];

    if (!file) {
      return;
    }

    setUploading(true);
    setMessage("");

    try {
      const data = await uploadMedia(file);

      if (data.success) {
        setForm((prev) => ({
          ...prev,
          avatar: data.url,
        }));

        setPreview(
          mediaUrl(data.url)
        );
      } else {
        setMessage(
          data.message ||
          "Unable to upload image."
        );
      }
    } catch (error) {
      console.error(error);

      setMessage(
        "Unable to upload image. Please try again."
      );
    } finally {
      setUploading(false);

      /*
       * Allow selecting the same image again
       */
      e.target.value = "";
    }
  }

  /*
   * Remove avatar
   */
  function handleRemoveAvatar() {
    setForm((prev) => ({
      ...prev,
      avatar: null,
    }));

    setPreview(null);
    setMessage("");
  }

  /*
   * Validate form
   */
  function validateForm() {
    const newErrors = {};

    /*
     * Name
     */
    if (!form.name.trim()) {
      newErrors.name = "Name is required";
    }

    /*
     * Email
     *
     * Email is required only while creating.
     */
    if (!isEdit && !form.email.trim()) {
      newErrors.email = "Email is required";
    } else if (
      !isEdit &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
        form.email.trim()
      )
    ) {
      newErrors.email =
        "Invalid email format";
    }

    /*
     * Mobile
     */
    const mobileError = validateMobile(form.mobile);

    if (mobileError) {
      newErrors.mobile = mobileError;
    }

    /*
     * Role
     */
    if (!roleId) {
      newErrors.roleId =
        "Role is required";
    }

    return newErrors;
  }

  /*
   * Submit
   */
  async function handleSubmit(e) {
    e.preventDefault();

    setMessage("");

    const newErrors = validateForm();

    setErrors(newErrors);

    /*
     * Stop if validation fails
     */
    if (
      Object.keys(newErrors).length > 0
    ) {
      return;
    }

    setSaving(true);

    try {
      let data;

      /*
       * Update existing user
       */
      if (isEdit) {
        data = await updateUser(
          userId,
          {
            name: form.name.trim(),
            mobile: form.mobile.trim(),
            avatar: form.avatar,
            roleId,
          }
        );
      }

      /*
       * Create new user
       */
      else {
        data = await createUser({
          name: form.name.trim(),
          email: form.email
            .trim()
            .toLowerCase(),
          mobile: form.mobile.trim(),
          avatar: form.avatar,
          roleId,
        });
      }

      /*
       * Success
       */
      if (data.success) {
        navigate("/users");
      } else {
        setMessage(
          data.message ||
          "Unable to save user."
        );
      }
    } catch (error) {
      console.error(error);

      setMessage(
        "Unable to connect to the server. Please try again."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="filament-page">

      {/* Breadcrumb */}
      <Breadcrumb
        items={[
          {
            label: "Users",
            to: "/users",
          },
          {
            label: isEdit
              ? "Edit User"
              : "Create User",
          },
        ]}
      />

      {/* Global message */}
      {message && (
        <div className="filament-alert">
          {message}
        </div>
      )}

      {/* Card */}
      <div className="filament-card">

        {/* Header */}
        <div className="filament-card-header">

          <div className="filament-card-header-left">
            <h1>
              {isEdit
                ? "Edit User"
                : "Create User"}
            </h1>
          </div>

          <div className="filament-card-header-right">

            <button
              type="button"
              className="filament-btn filament-btn-outline"
              onClick={() =>
                navigate("/users")
              }
            >
              Back
            </button>

          </div>
        </div>

        {/* Loading */}
        {loading ? (
          <div className="filament-empty">
            <div className="filament-spinner" />
          </div>
        ) : (

          <form
            className="admin-form user-form"
            onSubmit={handleSubmit}
          >

            {/* =====================================
                PROFILE IMAGE
            ====================================== */}

            <div className="profile-image-section">

              <div className="profile-image-preview">

                <Avatar
                  user={form}
                  size={100}
                />

              </div>

              <div className="avatar-upload-actions">

                <label
                  className="
                    filament-btn
                    filament-btn-outline
                    avatar-file-btn
                  "
                >
                  {uploading
                    ? "Uploading..."
                    : "Upload Image"}

                  <input
                    type="file"
                    accept="image/*"
                    onChange={
                      handleAvatarChange
                    }
                    disabled={uploading}
                  />
                </label>

                {(preview ||
                  form.avatar) && (
                    <button
                      type="button"
                      className="
                      filament-btn
                      filament-btn-danger
                    "
                      onClick={
                        handleRemoveAvatar
                      }
                    >
                      Remove
                    </button>
                  )}

              </div>
            </div>


            {/* =====================================
                FORM GRID
            ====================================== */}

            <div className="form-grid">

              {/* NAME */}
              <div className="form-row">

                <label className="form-label">
                  Name{" "}
                  <span className="required">
                    *
                  </span>
                </label>

                <input
                  type="text"
                  name="name"
                  placeholder="Full name"
                  value={form.name}
                  onChange={handleChange}
                  autoComplete="off"
                />

                {errors.name && (
                  <p className="input-error">
                    {errors.name}
                  </p>
                )}

              </div>


              {/* EMAIL */}
              {!isEdit && (
                <div className="form-row">

                  <label className="form-label">
                    Email{" "}
                    <span className="required">
                      *
                    </span>
                  </label>

                  <input
                    type="email"
                    name="email"
                    placeholder="user@example.com"
                    value={form.email}
                    onChange={handleChange}
                    autoComplete="off"
                  />

                  {errors.email && (
                    <p className="input-error">
                      {errors.email}
                    </p>
                  )}

                </div>
              )}


              {/* MOBILE */}
              <div className="form-row">

                <label className="form-label">
                  Mobile Number{" "}
                  <span className="required">
                    *
                  </span>
                </label>

                <PhoneInput
                  name="mobile"
                  value={form.mobile}
                  onChange={(e164) =>
                    handleChange({
                      target: { name: "mobile", value: e164 },
                    })
                  }
                  error={errors.mobile}
                  placeholder="12345678"
                />

              </div>


              {/* ROLE */}
              <div className="form-row">

                <label className="form-label">
                  Role{" "}
                  <span className="required">
                    *
                  </span>
                </label>

                <select name="roleId" value={roleId} onChange={handleRoleChange}>

                  <option value="">
                    Select role
                  </option>

                  {roles.filter((role) => !isSuperAdmin(role)).map((role) => (
                    <option
                      key={role.uuid}
                      value={role.uuid}
                    >
                      {role.name}
                    </option>
                  ))}
                </select>

                {errors.roleId && (
                  <p className="input-error">
                    {errors.roleId}
                  </p>
                )}

              </div>

            </div>


            {/* =====================================
                INFO BOX
            ====================================== */}

            {!isEdit && (
              <div className="filament-info-box">

                <svg
                  viewBox="0 0 24 24"
                  className="filament-info-icon"
                >
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z" />
                </svg>

                <span>
                  A random password will be
                  generated and sent to the
                  user's email address.
                </span>

              </div>
            )}


            {/* =====================================
                ACTIONS
            ====================================== */}

            <div className="form-actions">

              <button
                type="button"
                className="
                  filament-btn
                  filament-btn-outline
                "
                disabled={saving}
                onClick={() =>
                  navigate("/users")
                }
              >
                Cancel
              </button>

              <button
                type="submit"
                className="
                  filament-btn
                  filament-btn-primary
                "
                disabled={
                  saving ||
                  uploading
                }
              >
                {saving
                  ? "Saving..."
                  : isEdit
                    ? "Save Changes"
                    : "Create User"}
              </button>

            </div>

          </form>
        )}

      </div>
    </div>
  );
}