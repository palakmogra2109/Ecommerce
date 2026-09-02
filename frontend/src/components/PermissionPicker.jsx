export default function PermissionPicker({
  permissions,
  selected = [],
  onChange,
}) {
  const grouped = permissions.reduce((acc, permission) => {
    if (!acc[permission.module]) {
      acc[permission.module] = [];
    }
    acc[permission.module].push(permission);
    return acc;
  }, {});

  function toggle(permissionId) {
    onChange(
      selected.includes(permissionId)
        ? selected.filter((id) => id !== permissionId)
        : [...selected, permissionId]
    );
  }

  function toggleModule(slug, ids) {
    const moduleIds = ids.map((p) => p.id);
    const allSelected = moduleIds.every((id) =>
      selected.includes(id)
    );

    onChange(
      allSelected
        ? selected.filter((id) => !moduleIds.includes(id))
        : [...new Set([...selected, ...moduleIds])]
    );
  }

  function selectAll() {
    onChange(permissions.map((p) => p.id));
  }

  function selectNone() {
    onChange([]);
  }

  return (
    <div className="perm-picker">
      <div className="perm-toolbar">
        <button
          type="button"
          className="btn-secondary btn-sm"
          onClick={selectAll}
        >
          Select all
        </button>
        <button
          type="button"
          className="btn-secondary btn-sm"
          onClick={selectNone}
        >
          Select none
        </button>
      </div>

      <div className="perm-groups-list">
        {Object.keys(grouped).length === 0 ? (
          <p className="admin-empty">
            No permissions available. Create some
            permissions first.
          </p>
        ) : (
          Object.entries(grouped).map(([slug, perms]) => (
            <div key={slug} className="perm-group">
              <label className="perm-group-header">
                <input
                  type="checkbox"
                  checked={perms.every((p) =>
                    selected.includes(p.id)
                  )}
                  onChange={() => toggleModule(slug, perms)}
                />
                <strong>{slug}</strong>
              </label>

              <div className="perm-list">
                {perms.map((permission) => (
                  <label key={permission.id} className="perm-item">
                    <input
                      type="checkbox"
                      checked={selected.includes(permission.id)}
                      onChange={() => toggle(permission.id)}
                    />
                    <span>
                      {permission.name}
                      <code>{permission.slug}</code>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}