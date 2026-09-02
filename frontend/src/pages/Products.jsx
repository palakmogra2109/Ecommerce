export default function Products() {
  return (
    <div className="admin-page">
      <div className="admin-header">
        <h1>Products</h1>
      </div>

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Name</th>
              <th>Price</th>
              <th>Stock</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td colSpan="5" className="admin-empty">
                No products found
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}