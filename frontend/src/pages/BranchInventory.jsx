import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { getBranch, getBranchInventory } from "../services/branches";
import { formatCurrency } from "@shared/constants";
import Breadcrumb from "../components/Breadcrumb";
import Pagination from "../components/Pagination";

function stockClass(stock, threshold) {
  const value = Number(stock) || 0;
  if (value <= 0) return "stock-badge-out";
  if (value <= (Number(threshold) || 5)) return "stock-badge-low";
  return "stock-badge-ok";
}

export default function BranchInventory() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [branch, setBranch] = useState(null);
  const [inventory, setInventory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0, pages: 1 });
  const [typeFilter, setTypeFilter] = useState("");

  useEffect(() => {
    let active = true;
    const run = async () => {
      setLoading(true);
      try {
        const branchData = await getBranch(id);
        if (branchData.success) setBranch(branchData.branch);

        const invData = await getBranchInventory(id, {
          type: typeFilter,
          page: pagination.page,
          limit: pagination.limit,
        });
        if (invData.success) {
          setInventory(invData.transactions || []);
          setPagination((prev) => ({ ...prev, total: invData.pagination?.total || 0, pages: invData.pagination?.pages || 1 }));
        }
      } catch {}
      if (active) setLoading(false);
    };
    run();
    return () => { active = false; };
  }, [id, typeFilter, pagination.page]);

  if (loading) return <div className="filament-empty"><div className="filament-spinner" /></div>;

  return (
    <div className="filament-page">
      <Breadcrumb items={[
        { label: "Branches", to: "/branches" },
        { label: branch?.name || "Branch", to: `/branches/${id}` },
        "Inventory",
      ]} />

      <h1 className="filament-title">Inventory — {branch?.name}</h1>
      <p className="filament-card-subtitle">Transaction history for {branch?.name}</p>

      <div className="form-actions" style={{ marginBottom: 16 }}>
        <select value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value); setPagination((p) => ({ ...p, page: 1 })); }}>
          <option value="">All Types</option>
          <option value="PURCHASE">Purchase</option>
          <option value="ORDER">Order</option>
          <option value="RETURN">Return</option>
          <option value="DAMAGE">Damage</option>
          <option value="ADJUSTMENT">Adjustment</option>
          <option value="TRANSFER_IN">Transfer In</option>
          <option value="TRANSFER_OUT">Transfer Out</option>
        </select>
      </div>

      {inventory.length === 0 ? (
        <div className="filament-empty"><p>No inventory transactions found.</p></div>
      ) : (
        <div className="variant-table-wrap">
          <table className="variant-edit-table">
            <thead>
              <tr>
                <th>Type</th>
                <th>Quantity</th>
                <th>Previous Stock</th>
                <th>New Stock</th>
                <th>Reference</th>
                <th>Reason</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {inventory.map((t, i) => (
                <tr key={t.uuid || i}>
                  <td><span className={`stock-badge-${t.transactionType === 'ORDER' ? 'out' : t.transactionType === 'RETURN' ? 'ok' : t.transactionType === 'DAMAGE' ? 'out' : 'ok'}`}>{t.transactionType}</span></td>
                  <td>
                    <span className={t.quantity >= 0 ? "stock-badge-ok" : "stock-badge-out"}>
                      {t.quantity >= 0 ? `+${t.quantity}` : t.quantity}
                    </span>
                  </td>
                  <td>{t.previousStock}</td>
                  <td>{t.newStock}</td>
                  <td>{t.referenceType} {t.referenceId ? `#${t.referenceId}` : ""}</td>
                  <td>{t.reason || "—"}</td>
                  <td>{new Date(t.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ marginTop: 16 }}>
        <Pagination pagination={pagination} onPageChange={(page) => setPagination((p) => ({ ...p, page }))} />
      </div>
    </div>
  );
}
