import { mediaUrl } from "../services/media";

export default function Avatar({ user = {}, size = 40 }) {
  const name = user.name || user.email || "?";

  const initials = name
    .split(/[\s@]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("");

  const style = { width: size, height: size, fontSize: size / 2.5 };

  if (user.avatar) {
    return (
      <img
        className="avatar avatar-img"
        style={style}
        src={mediaUrl(user.avatar)}
        alt={name}
      />
    );
  }

  return (
    <span className="avatar avatar-initials" style={style}>
      {initials}
    </span>
  );
}