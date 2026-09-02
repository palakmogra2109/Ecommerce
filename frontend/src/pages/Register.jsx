import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import {
  validateName,
  validateEmail,
  validatePassword,
  validateConfirmPassword,
} from "../utils/validation";
import PasswordInput from "../components/PasswordInput";

export default function Register() {
  const { register } = useAuth();

  const navigate = useNavigate();

  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    confirmPassword: "",
  });

  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);


  function handleChange(e) {
    const { name, value } = e.target;

    setForm({
      ...form,
      [name]: value,
    });

    // Remove error for this field while typing
    setErrors({
      ...errors,
      [name]: "",
    });

    setMessage("");
  }


  async function handleSubmit(e) {
    e.preventDefault();

    setMessage("");

    const newErrors = {};

    const nameError = validateName(form.name);
    const emailError = validateEmail(form.email);
    const passwordError = validatePassword(
      form.password
    );
    const confirmError = validateConfirmPassword(
      form.password,
      form.confirmPassword
    );

    if (nameError) {
      newErrors.name = nameError;
    }

    if (emailError) {
      newErrors.email = emailError;
    }

    if (passwordError) {
      newErrors.password = passwordError;
    }

    if (confirmError) {
      newErrors.confirmPassword = confirmError;
    }

    setErrors(newErrors);

    // Stop API request if validation fails
    if (Object.keys(newErrors).length > 0) {
      return;
    }

    setLoading(true);

    try {
      const data = await register(
        form.name,
        form.email,
        form.password
      );

      if (data.success) {
        setForm({
          name: "",
          email: "",
          password: "",
          confirmPassword: "",
        });

        setErrors({});

        setMessage(data.message);

        setTimeout(() => {
          navigate("/login");
        }, 1000);
      } else {
        setMessage(data.message);
      }
    } catch (error) {
      console.error(error);

      setMessage(
        "Unable to connect to the server. Please try again."
      );
    } finally {
      setLoading(false);
    }
  }


  return (
    <div className="auth-container">
      <form
        className="auth-form"
        onSubmit={handleSubmit}
      >
        <h1>Register</h1>


        <input
          type="text"
          name="name"
          placeholder="Name"
          value={form.name}
          onChange={handleChange}
          autoComplete="name"
        />

        {errors.name && (
          <p className="input-error">
            {errors.name}
          </p>
        )}


        <input
          type="email"
          name="email"
          placeholder="Email"
          value={form.email}
          onChange={handleChange}
          autoComplete="email"
        />

        {errors.email && (
          <p className="input-error">
            {errors.email}
          </p>
        )}


        <PasswordInput
          name="password"
          placeholder="Password"
          value={form.password}
          onChange={handleChange}
          autoComplete="new-password"
        />

        {errors.password && (
          <p className="input-error">
            {errors.password}
          </p>
        )}


        <PasswordInput
          name="confirmPassword"
          placeholder="Confirm Password"
          value={form.confirmPassword}
          onChange={handleChange}
          autoComplete="new-password"
        />

        {errors.confirmPassword && (
          <p className="input-error">
            {errors.confirmPassword}
          </p>
        )}


        <button
          type="submit"
          disabled={loading}
        >
          {loading ? "Creating..." : "Register"}
        </button>


        {message && (
          <p className="form-message">
            {message}
          </p>
        )}


        <p>
          Already have an account?{" "}
          <Link to="/login">
            Login
          </Link>
        </p>
      </form>
    </div>
  );
}
