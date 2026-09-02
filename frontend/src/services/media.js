const API_URL = "http://localhost:3000/api";

export async function uploadMedia(file) {
  const formData = new FormData();

  formData.append("file", file);

  const response = await fetch(`${API_URL}/media/upload`, {
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

  return `http://localhost:3000${path}`;
}