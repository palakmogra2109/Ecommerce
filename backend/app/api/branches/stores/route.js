import pool from "@/lib/db";
import { corsHeaders } from "@/lib/cors";
import { authorize } from "@/lib/authorization";
import { KEY_PERMISSIONS } from "@shared/constants";
import { parsePagination } from "@/lib/pagination";

export const runtime = "nodejs";

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

// All store accounts: every user with the store role, together with the
// branches they are linked to and their creating admin (parent).
export async function GET(request) {
  try {
    const auth = await authorize(KEY_PERMISSIONS.BRANCHES_VIEW);
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search") ?? "";
    const status = searchParams.get("status") ?? "";
    const { page, limit } = parsePagination(searchParams);

    const where = [];
    const params = [];

    if (search.trim()) {
      params.push(`%${search.trim()}%`);
      where.push(
        `(u.name ILIKE $${params.length} OR u.email ILIKE $${params.length} OR COALESCE(u.mobile, '') ILIKE $${params.length})`
      );
    }

    if (status) {
      params.push(status);
      where.push(`u.status = $${params.length}`);
    }

    where.push(
      `EXISTS (
        SELECT 1 FROM user_has_roles uhr
        JOIN roles r ON r.id = uhr.role_id
        WHERE uhr.user_id = u.id AND r.slug = 'store'
      )`
    );

    where.push(
      `NOT EXISTS (
        SELECT 1 FROM user_has_roles uhr2
        JOIN roles r2 ON r2.id = uhr2.role_id
        WHERE uhr2.user_id = u.id AND r2.slug = 'super_admin'
      )`
    );

    const whereSql = `WHERE ${where.join(" AND ")}`;

    const countResult = await pool.query(
      `SELECT count(*)::int AS total FROM users u ${whereSql}`,
      params
    );
    const total = countResult.rows[0].total;

    params.push(limit, (page - 1) * limit);

    const result = await pool.query(
      `SELECT u.uuid, u.name, u.email, u.mobile, u.avatar, u.status, u.created_at,
              u.parent_id,
              p.uuid AS parent_uuid, p.name AS parent_name,
              COALESCE(
                (SELECT json_agg(json_build_object('uuid', b.uuid, 'name', b.name, 'code', b.code) ORDER BY b.name)
                 FROM branch_users bu
                 JOIN branches b ON b.id = bu.branchid
                 WHERE bu.userid = u.id),
                '[]'::json
              ) AS branches
       FROM users u
       LEFT JOIN users p ON p.id = u.parent_id
       ${whereSql}
       ORDER BY u.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    const rows = result.rows.map(({ parent_id, ...row }) => ({
      ...row,
      parent: row.parent_uuid
        ? { uuid: row.parent_uuid, name: row.parent_name }
        : null,
    }));

    return Response.json(
      {
        success: true,
        stores: rows,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
      { headers: corsHeaders() }
    );
  } catch (error) {
    console.error("Stores list error:", error);

    return Response.json(
      { success: false, message: "Internal server error" },
      { status: 500, headers: corsHeaders() }
    );
  }
}