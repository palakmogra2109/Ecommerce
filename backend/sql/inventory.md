# Live column inventory (Phase 1)

Authoritative reference for all branch-inventory SQL work. Captured by read-only
introspection of `information_schema.columns` against the live database
(not from `sql/schema.sql`).

**Do not hand-edit the column names below to match expectations.** A later task that
needs a different spelling must ship a migration, then regenerate this file.
`node scripts/verify-phase1.mjs` fails if this file drifts from the live schema.

- Database: `ecommerce`
- Schema: `public`
- Server: PostgreSQL 16.15 (Ubuntu 16.15-1.pgdg22.04+2) on x86_64-pc-linux-gnu
- Captured: 2026-09-29T08:49:35.808Z

## Naming conventions actually in the database

| Group | Tables | Convention | Examples |
| --- | --- | --- | --- |
| folded | branches, branch_products, branch_stock_transfers, branch_transfer_items, branch_inventory_transactions | lowercase, no separators; multiword names concatenated | `addressline1`, `stockquantity`, `sourcebranchid`, `previousstocksource` |
| snake_case | orders, users | lowercase with underscores | `order_number`, `created_at`, `payment_method`, `parent_id` |

Two tables are mixed, so the convention must be checked per column, never per table:

- `branches` has folded names (`addressline1`, `createdat`) alongside snake_case
  (`onboarding_completed`).
- `orders` has snake_case names (`order_number`) alongside folded ones (`branchid`)
  and a mixed one (`estimated_delivery_at`).

## Columns

### branches

30 columns.

```
id  bigint
uuid  uuid
name  text
code  text
phone  text
email  text
address  text
addressline1  text
addressline2  text
city  text
state  text
country  text
postalcode  text
latitude  numeric
longitude  numeric
openingtime  time without time zone
closingtime  time without time zone
timezone  text
status  text
deliveryenabled  boolean
pickupenabled  boolean
deliveryradius  numeric
createdat  timestamp with time zone
updatedat  timestamp with time zone
onboarding_completed  boolean
description  text
logo  text
countryid  uuid
stateid  uuid
cityid  uuid
```

### branch_products

17 columns.

```
id  bigint
uuid  uuid
branchid  bigint
productid  bigint
productuuid  uuid
variantid  text
sellingprice  numeric
compareatprice  numeric
costprice  numeric
stockquantity  integer
reservedquantity  integer
availablequantity  integer
lowstockthreshold  integer
isavailable  boolean
status  text
createdat  timestamp with time zone
updatedat  timestamp with time zone
```

### branch_stock_transfers

12 columns.

```
id  bigint
uuid  uuid
transfernumber  text
sourcebranchid  bigint
destinationbranchid  bigint
status  text
requestbyid  bigint
approvedbyid  bigint
receivedbyid  bigint
reason  text
createdat  timestamp with time zone
updatedat  timestamp with time zone
```

### branch_transfer_items

10 columns.

```
id  bigint
uuid  uuid
transferid  bigint
productid  bigint
productuuid  uuid
variantid  text
quantity  integer
previousstocksource  integer
previousstockdest  integer
createdat  timestamp with time zone
```

### branch_inventory_transactions

15 columns.

```
id  bigint
uuid  uuid
branchid  bigint
productid  bigint
productuuid  uuid
variantid  text
transactiontype  text
quantity  integer
previousstock  integer
newstock  integer
referencetype  text
referenceid  uuid
reason  text
createdby  bigint
createdat  timestamp with time zone
```

### orders

20 columns.

```
id  bigint
uuid  uuid
order_number  text
customer_id  bigint
customer_name  text
customer_email  text
customer_mobile  text
shipping_address  jsonb
subtotal  numeric
discount  numeric
total  numeric
coupon_id  bigint
coupon_code  text
payment_method  text
payment_status  text
status  text
created_at  timestamp with time zone
updated_at  timestamp with time zone
branchid  bigint
estimated_delivery_at  timestamp with time zone
```

### users

12 columns.

```
id  integer
name  character varying
email  character varying
password  character varying
created_at  timestamp without time zone
status  text
updated_at  timestamp with time zone
mobile  text
avatar  text
uuid  uuid
parent_id  bigint
countrycode  text
```

