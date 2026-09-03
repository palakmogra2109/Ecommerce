import pool from "./db";

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export function parsePagination(searchParams) {
  const page = Math.max(
    1,
    parseInt(searchParams.get("page")) || DEFAULT_PAGE
  );
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, parseInt(searchParams.get("limit")) || DEFAULT_LIMIT)
  );
  const offset = (page - 1) * limit;
  return { page, limit, offset };
}

export function paginationMeta(total, page, limit) {
  const totalPages = Math.ceil(total / limit) || 1;
  return { page, limit, total, totalPages };
}

export async function paginate(
  { baseSql, countSql, params, orderBy },
  { page, limit, offset }
) {
  const dataSql = `${baseSql} ${orderBy} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;

  const [dataResult, countResult] = await Promise.all([
    pool.query(dataSql, [...params, limit, offset]),
    pool.query(countSql, params),
  ]);

  const total = parseInt(countResult.rows[0]?.count || "0", 10);

  return {
    rows: dataResult.rows,
    pagination: paginationMeta(total, page, limit),
  };
}
