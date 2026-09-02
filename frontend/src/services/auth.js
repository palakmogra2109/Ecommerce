const API_URL = "http://localhost:3000/api";

export async function registerUser(data) {
  const response = await fetch(`${API_URL}/auth/register`, {
    method: "POST",

    headers: {
      "Content-Type": "application/json",
    },

    credentials: "include",

    body: JSON.stringify(data),
  });

  return await response.json();
}

export async function loginUser(data) {
  const response = await fetch(`${API_URL}/auth/login`, {
    method: "POST",

    headers: {
      "Content-Type": "application/json",
    },

    credentials: "include",

    body: JSON.stringify(data),
  });

  return await response.json();
}

export async function logoutUser() {
  const response = await fetch(`${API_URL}/auth/logout`, {
    method: "POST",

    credentials: "include",
  });

  return await response.json();
}

export async function getCurrentUser(timeoutMs = 5000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(
      `${API_URL}/auth/me`,
      {
        method: "GET",
        credentials: "include",
        signal: controller.signal,
      }
    );

    const data = await response.json();

    return {
      ...data,
      status: response.status,
    };
  } catch (error) {
    if (error.name === "AbortError") {
      return { success: false, message: "Request timed out", status: 408 };
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}