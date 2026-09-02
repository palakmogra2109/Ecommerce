export default function Orders() {
  return (
    <div className="admin-page">
      <div className="admin-header">
        <h1>Orders</h1>
      </div>

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Customer</th>
              <th>Total</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td colSpan="4" className="admin-empty">
                No orders found
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}