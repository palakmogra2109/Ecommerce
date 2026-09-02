import { Link } from "react-router-dom";

export default function Breadcrumb({ items }) {
  return (
    <nav className="breadcrumb" aria-label="Breadcrumb">
      {items.map((item, index) => {
        const isLast = index === items.length - 1;

        return (
          <span key={index}>
            {item.to && !isLast ? (
              <Link to={item.to}>{item.label}</Link>
            ) : (
              <span className="breadcrumb-current">
                {item.label}
              </span>
            )}

            {!isLast && (
              <span className="breadcrumb-sep">/</span>
            )}
          </span>
        );
      })}
    </nav>
  );
}