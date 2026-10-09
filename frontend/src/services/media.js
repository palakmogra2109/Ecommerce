import { authHeaders } from "./http";

const API_URL = "/api";

export async function uploadMedia(file) {
  const formData = new FormData();

  formData.append("file", file);

  const response = await fetch(`${API_URL}/media/upload`, {
    headers: authHeaders(),
    method: "POST",
    credentials: "include",
    body: formData,
  });

  return await response.json();
}

export function mediaUrl(path) {
  if (!path) {
    return "";
  }

  if (path.startsWith("http")) {
    return path;
  }

  return path;
}