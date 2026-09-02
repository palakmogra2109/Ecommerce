Below is the clean, finalized Markdown file. Save it as ecommerce_backend_frontend_planning.md.

# E-Commerce Platform — Backend & Frontend Development Plan

> Production-oriented planning document for an e-commerce application built with Node.js, Express.js, React.js, PostgreSQL, and supporting services.

---

# Table of Contents

1. [Project Overview](#1-project-overview)
2. [Project Architecture](#2-project-architecture)
3. [Technology Stack](#3-technology-stack)
4. [Repository Structure](#4-repository-structure)
5. [Backend Architecture](#5-backend-architecture)
6. [Backend Modules](#6-backend-modules)
7. [Database Design](#7-database-design)
8. [Authentication & Authorization](#8-authentication--authorization)
9. [Admin Panel](#9-admin-panel)
10. [Product & Catalog Management](#10-product--catalog-management)
11. [Inventory Management](#11-inventory-management)
12. [Customer Management](#12-customer-management)
13. [Cart & Wishlist](#13-cart--wishlist)
14. [Order Management](#14-order-management)
15. [Payment Management](#15-payment-management)
16. [Shipping Management](#16-shipping-management)
17. [Coupon & Promotion Management](#17-coupon--promotion-management)
18. [Review & Rating](#18-review--rating)
19. [Return & Refund](#19-return--refund)
20. [Support & Chat](#20-support--chat)
21. [Notification System](#21-notification-system)
22. [Reports & Analytics](#22-reports--analytics)
23. [Customer Storefront](#23-customer-storefront)
24. [API Architecture](#24-api-architecture)
25. [Security](#25-security)
26. [Testing](#26-testing)
27. [Git & Development Workflow](#27-git--development-workflow)
28. [Environment Configuration](#28-environment-configuration)
29. [Production Architecture](#29-production-architecture)
30. [Development Roadmap](#30-development-roadmap)
31. [MVP Scope](#31-mvp-scope)
32. [V2 Scope](#32-v2-scope)
33. [V3 Scope](#33-v3-scope)
34. [Production Checklist](#34-production-checklist)
35. [Development Rules](#35-development-rules)

---

# 1. Project Overview

We will build a complete e-commerce platform with two separate React applications:

```text
E-Commerce Platform
│
├── Backend
│   └── Node.js + Express.js
│
├── Admin Frontend
│   └── React.js
│
└── Customer Frontend
    └── React.js

The backend will provide APIs for both applications.

                    E-COMMERCE PLATFORM
                           │
             ┌─────────────┴─────────────┐
             │                           │
       ADMIN FRONTEND              STORE FRONTEND
          React.js                    React.js
             │                           │
             └─────────────┬─────────────┘
                           │
                       REST API
                           │
                    NODE.JS BACKEND
                           │
             ┌─────────────┼─────────────┐
             │             │             │
         PostgreSQL      Redis       File Storage
             │
             ├── Users
             ├── Products
             ├── Customers
             ├── Orders
             ├── Payments
             ├── Inventory
             └── Other Modules
2. Project Architecture

We will use a modular architecture.

ecommerce/
│
├── backend/
│
├── admin-frontend/
│
├── store-frontend/
│
├── docs/
│
├── docker-compose.yml
│
├── .gitignore
│
└── README.md
Applications
Backend

Responsible for:

Business logic
Authentication
Authorization
Database
Products
Orders
Payments
Inventory
Customers
Coupons
Shipping
Notifications
Support
Reports
Admin Frontend

Responsible for:

Admin login
Dashboard
User management
Roles
Permissions
Product management
Category management
Inventory
Customers
Orders
Coupons
Reports
Support
Settings
Customer Frontend

Responsible for:

Homepage
Product browsing
Search
Filters
Product details
Cart
Wishlist
Checkout
Payment
Orders
Reviews
Customer profile
Support
3. Technology Stack
3.1 Backend
Requirement	Technology
Runtime	Node.js
Framework	Express.js
Language	TypeScript
Database	PostgreSQL
ORM	Prisma
Authentication	JWT
Password Hashing	Argon2 / bcrypt
Validation	Zod
API Documentation	OpenAPI / Swagger
Cache	Redis
Background Jobs	BullMQ
Real-time	Socket.IO
File Upload	Multer
File Storage	S3-compatible storage
Logging	Pino
Testing	Vitest/Jest + Supertest
Security	Helmet + CORS + Rate Limiting
Container	Docker
3.2 Admin Frontend
Requirement	Technology
Framework	React.js
Language	TypeScript
Build Tool	Vite
Routing	React Router
Server State	TanStack Query
Local State	Zustand
Forms	React Hook Form
Validation	Zod
HTTP Client	Axios
Tables	TanStack Table
Charts	Recharts
Styling	Tailwind CSS
UI Components	shadcn/ui
Testing	Vitest + React Testing Library
3.3 Customer Frontend
Requirement	Technology
Framework	React.js
Language	TypeScript
Build Tool	Vite
Routing	React Router
Server State	TanStack Query
Local State	Zustand
Forms	React Hook Form
Validation	Zod
HTTP Client	Axios
Styling	Tailwind CSS
Testing	Vitest + React Testing Library

If advanced SEO and server-side rendering become major requirements, the customer storefront can later be migrated to Next.js while keeping the same backend API.

4. Repository Structure

Recommended structure:

ecommerce/
│
├── backend/
│   │
│   ├── src/
│   │   ├── config/
│   │   │
│   │   ├── common/
│   │   │   ├── errors/
│   │   │   ├── middleware/
│   │   │   ├── utils/
│   │   │   ├── constants/
│   │   │   └── types/
│   │   │
│   │   ├── modules/
│   │   │   ├── auth/
│   │   │   ├── users/
│   │   │   ├── roles/
│   │   │   ├── permissions/
│   │   │   ├── customers/
│   │   │   ├── categories/
│   │   │   ├── brands/
│   │   │   ├── products/
│   │   │   ├── inventory/
│   │   │   ├── carts/
│   │   │   ├── wishlists/
│   │   │   ├── coupons/
│   │   │   ├── orders/
│   │   │   ├── payments/
│   │   │   ├── shipping/
│   │   │   ├── reviews/
│   │   │   ├── returns/
│   │   │   ├── refunds/
│   │   │   ├── support/
│   │   │   ├── notifications/
│   │   │   ├── reports/
│   │   │   ├── settings/
│   │   │   └── audit-logs/
│   │   │
│   │   ├── app.ts
│   │   └── server.ts
│   │
│   ├── prisma/
│   │   ├── schema.prisma
│   │   └── migrations/
│   │
│   ├── tests/
│   │
│   ├── .env
│   ├── .env.example
│   ├── package.json
│   └── Dockerfile
│
├── admin-frontend/
│   ├── src/
│   ├── public/
│   ├── .env
│   ├── .env.example
│   ├── package.json
│   └── Dockerfile
│
├── store-frontend/
│   ├── src/
│   ├── public/
│   ├── .env
│   ├── .env.example
│   ├── package.json
│   └── Dockerfile
│
├── docs/
│
├── docker-compose.yml
├── .gitignore
└── README.md
5. Backend Architecture

The backend should be modular.

Each business module should contain its own:

controller
service
repository
routes
schema
types
constants

Example:

products/
├── product.controller.ts
├── product.service.ts
├── product.repository.ts
├── product.routes.ts
├── product.schema.ts
├── product.types.ts
└── product.constants.ts
Request Flow
HTTP Request
     ↓
Route
     ↓
Authentication Middleware
     ↓
Authorization Middleware
     ↓
Validation
     ↓
Controller
     ↓
Service
     ↓
Repository
     ↓
Database
     ↓
Service
     ↓
Controller
     ↓
HTTP Response

Business logic should primarily live in the service layer.

6. Backend Modules

The complete backend will contain the following modules.

1. Configuration
2. Authentication
3. Users
4. Roles
5. Permissions
6. Customers
7. Categories
8. Brands
9. Products
10. Product Variants
11. Product Attributes
12. Inventory
13. Cart
14. Wishlist
15. Coupons
16. Orders
17. Payments
18. Shipping
19. Reviews
20. Returns
21. Refunds
22. Support
23. Chat
24. Notifications
25. Reports
26. Settings
27. Audit Logs
28. File Storage
29. Background Jobs
7. Database Design

Recommended database:

PostgreSQL

ORM:

Prisma
Core tables/entities
users
roles
permissions
user_roles
role_permissions

customers
customer_addresses

categories
brands

products
product_images
product_variants
product_attributes
product_attribute_values

inventory
inventory_transactions

carts
cart_items

wishlists
wishlist_items

coupons
coupon_usages

orders
order_items
order_addresses

payments
payment_transactions

shipping_methods
shipments

reviews

returns
refunds

support_tickets
support_messages

notifications

audit_logs

settings
7.1 Users
User
├── id
├── name
├── email
├── passwordHash
├── status
├── emailVerified
├── lastLoginAt
├── createdAt
└── updatedAt
7.2 Roles

Example roles:

SUPER_ADMIN
ADMIN
PRODUCT_MANAGER
ORDER_MANAGER
SUPPORT_AGENT
MARKETING_MANAGER
WAREHOUSE_MANAGER
ACCOUNTANT
7.3 Permissions

Example permissions:

user.view
user.create
user.update
user.delete

role.view
role.create
role.update
role.delete

product.view
product.create
product.update
product.delete

category.view
category.create
category.update
category.delete

order.view
order.update
order.cancel

customer.view
customer.update

coupon.view
coupon.create
coupon.update
coupon.delete

inventory.view
inventory.update

report.view
7.4 Customer
Customer
├── id
├── userId
├── firstName
├── lastName
├── phone
├── status
├── createdAt
└── updatedAt

Customer relationships:

Customer
├── Addresses
├── Orders
├── Cart
├── Wishlist
├── Reviews
├── Coupons
└── Support Tickets
7.5 Category

Support nested categories.

Example:

Electronics
├── Mobile
├── Laptop
├── Headphones
└── Accessories

Fields:

id
name
slug
description
image
parentId
status
sortOrder
metaTitle
metaDescription
createdAt
updatedAt
7.6 Brand

Fields:

id
name
slug
description
logo
status
createdAt
updatedAt
7.7 Product

Product should support:

Basic Information
Pricing
Images
Categories
Brand
Attributes
Variants
Inventory
SEO
Status

Example:

Product
├── Name
├── SKU
├── Description
├── Category
├── Brand
├── Images
├── Price
├── Discount
├── Attributes
├── Variants
├── Inventory
├── SEO
└── Status
7.8 Product Variants

Variants are important for products such as clothing.

Example:

T-Shirt
│
├── Red / S
├── Red / M
├── Red / L
├── Black / S
├── Black / M
└── Black / L

Each variant can contain:

SKU
Price
Stock
Barcode
Weight
Images
Attributes
Status
7.9 Product Attributes

Examples:

Color
Size
Material
Storage
RAM
Weight
Screen Size

Attributes should be dynamic.

Do not hard-code product properties into the application.

8. Authentication & Authorization

Authentication and authorization should be implemented before most admin functionality.

8.1 Authentication Features
Register
Login
Logout
Refresh Token
Forgot Password
Reset Password
Change Password
Email Verification
Get Current User
Update Profile
8.2 Authentication Flow
Login
  ↓
Validate credentials
  ↓
Generate access token
  ↓
Generate refresh token
  ↓
Authenticated request
  ↓
Access token expires
  ↓
Refresh token
  ↓
New access token
8.3 Authorization

Use Role-Based Access Control.

User
  ↓
Role
  ↓
Permissions
  ↓
API Access

Example:

PRODUCT_MANAGER

product.view
product.create
product.update
product.delete

The backend must enforce permissions.

Frontend permission checks are only for UI visibility.

9. Admin Panel

Admin Panel will be developed first.

9.1 Admin Navigation
Dashboard

Catalog
├── Categories
├── Brands
├── Attributes
└── Products

Inventory

Orders

Customers

Marketing
├── Coupons
├── Banners
└── Promotions

Reviews

Support

Reports

Users & Access
├── Users
├── Roles
└── Permissions

Settings
9.2 Admin Authentication Pages
/login
/forgot-password
/reset-password
9.3 Admin Dashboard

Dashboard should show:

Total Sales
Today's Sales
Total Orders
Pending Orders
Total Customers
Total Products
Low Stock Products
Revenue Chart
Recent Orders
Top Products

Dashboard should be implemented after the underlying modules are available.

9.4 Admin User Management

Features:

List Users
Search Users
Filter Users
Create User
View User
Update User
Deactivate User
Activate User
Assign Roles
Reset Password
View Activity
9.5 Admin Role Management

Features:

Create Role
Update Role
Delete Role
Assign Permissions
View Permissions

Example:

Role: Product Manager

✓ Product View
✓ Product Create
✓ Product Update
✓ Product Delete

✗ User Delete
✗ Order Delete
✗ Settings Update
9.6 Admin Customer Management

Features:

Customer List
Search
Filter
Customer Details
Customer Addresses
Customer Orders
Customer Reviews
Customer Activity
Activate/Deactivate Customer
10. Product & Catalog Management

Catalog includes:

Categories
Brands
Attributes
Products
Product Variants
Product Images
Pricing
SEO
10.1 Product Admin Features
Create Product
Update Product
View Product
Archive Product
Publish Product
Unpublish Product
Upload Images
Manage Variants
Manage Attributes
Manage Pricing
Manage SEO
10.2 Product Status

Recommended:

DRAFT
ACTIVE
INACTIVE
ARCHIVED
10.3 Product SEO

Fields:

slug
metaTitle
metaDescription
metaKeywords
canonicalUrl
11. Inventory Management

Inventory should not simply be:

stock = 50

We need inventory history.

Inventory
├── Current Stock
├── Reserved Stock
├── Available Stock
├── Low Stock Threshold
└── Inventory Transactions
11.1 Inventory Transactions

Example:

+100 Purchase
-2 Order #1001
-1 Order #1002
+1 Return #R1001
-5 Manual Adjustment
11.2 Inventory Features
View Inventory
Update Stock
Manual Adjustment
Stock History
Reserved Stock
Low Stock Alerts
Inventory Reports
12. Customer Management

Customer module should contain:

Customer Profile
Addresses
Orders
Wishlist
Reviews
Coupons
Support
Activity
12.1 Customer Details

Admin should be able to see:

Customer Information
Total Orders
Total Spending
Last Order
Addresses
Order History
Reviews
Support Tickets
13. Cart & Wishlist
13.1 Cart

Features:

Add Item
Remove Item
Update Quantity
Clear Cart
Apply Coupon
Remove Coupon
Calculate Subtotal
Calculate Discount
Calculate Tax
Calculate Shipping
Calculate Total

Important:

Never trust product prices or final totals sent from the frontend.

The backend must calculate the final amount.

13.2 Wishlist

Features:

Add Product
Remove Product
List Wishlist
Move Item to Cart
14. Order Management

Order lifecycle:

PENDING
   ↓
CONFIRMED
   ↓
PROCESSING
   ↓
PACKED
   ↓
SHIPPED
   ↓
OUT_FOR_DELIVERY
   ↓
DELIVERED

Alternative states:

CANCELLED
RETURN_REQUESTED
RETURNED
REFUNDED
PAYMENT_FAILED
14.1 Order Features

Admin:

View Orders
Search Orders
Filter Orders
View Order Details
Update Status
Cancel Order
Process Return
Process Refund
View Payment
View Customer
View Shipment
Generate Invoice

Customer:

Create Order
View Orders
View Order Details
Cancel Order
Track Order
Request Return
View Refund
14.2 Order Creation
Cart
 ↓
Checkout
 ↓
Validate Products
 ↓
Validate Stock
 ↓
Calculate Prices
 ↓
Apply Coupon
 ↓
Calculate Tax
 ↓
Calculate Shipping
 ↓
Create Order
 ↓
Payment
15. Payment Management

Payment should be independent from the Order module.

Order
 ↓
Payment Service
 ↓
Payment Provider
 ↓
Webhook
 ↓
Payment Verification
 ↓
Payment Status
15.1 Payment States
PENDING
PROCESSING
SUCCESS
FAILED
CANCELLED
REFUNDED
PARTIALLY_REFUNDED
15.2 Payment Features
Create Payment
Verify Payment
Payment Callback
Payment Webhook
Payment History
Refund
Partial Refund
Payment Failure Handling

Use a payment-provider abstraction.

PaymentService
    │
    ├── Provider A
    ├── Provider B
    └── Cash On Delivery
16. Shipping Management

Shipping module:

Shipping Methods
Shipping Zones
Shipping Charges
Delivery Estimates
Shipment
Tracking
Courier
Delivery Status

Example:

Standard Shipping
Express Shipping
Free Shipping
16.1 Shipment Lifecycle
ORDER_CONFIRMED
      ↓
PACKED
      ↓
SHIPMENT_CREATED
      ↓
SHIPPED
      ↓
OUT_FOR_DELIVERY
      ↓
DELIVERED
17. Coupon & Promotion Management

Coupon types:

Percentage Discount
Fixed Amount Discount

Coupon rules:

Minimum Order Amount
Maximum Discount
Start Date
End Date
Usage Limit
Per Customer Limit
Product Restriction
Category Restriction
Active/Inactive
17.1 Coupon Validation

Backend must check:

Coupon Exists?
   ↓
Active?
   ↓
Not Expired?
   ↓
Usage Limit Available?
   ↓
Customer Usage Limit Available?
   ↓
Minimum Order Met?
   ↓
Product Eligible?
   ↓
Category Eligible?
   ↓
Calculate Discount
18. Review & Rating

Customers should be able to review products they purchased.

Flow:

Customer
 ↓
Delivered Order
 ↓
Purchased Product
 ↓
Can Review

Review fields:

Customer
Product
Order
Rating
Comment
Images
Status
Admin Response
Verified Purchase

Admin features:

View Reviews
Approve Review
Reject Review
Delete Review
Reply to Review
19. Return & Refund

Return flow:

Customer Requests Return
        ↓
Admin Reviews
        ↓
Approved / Rejected
        ↓
Product Returned
        ↓
Inspection
        ↓
Refund
19.1 Return Status
REQUESTED
APPROVED
REJECTED
PICKUP_PENDING
RECEIVED
INSPECTING
COMPLETED
CANCELLED
19.2 Refund Status
PENDING
PROCESSING
SUCCESS
FAILED

Support:

Full Refund
Partial Refund
Payment Refund
Store Credit
20. Support & Chat

Start with support tickets.

20.1 Support Ticket
SupportTicket
├── Customer
├── Subject
├── Category
├── Priority
├── Status
├── Messages
└── Attachments
20.2 Ticket Status
OPEN
IN_PROGRESS
WAITING_FOR_CUSTOMER
RESOLVED
CLOSED
20.3 Real-Time Chat

Later implement:

React
  ↓
Socket.IO
  ↓
Node.js
  ↓
Chat Service
  ↓
Database

Features:

One-to-One Chat
Admin-to-Customer Chat
Online Status
Typing Indicator
Read Status
Attachments
Message History
21. Notification System

Notification channels:

Email
SMS
Push Notification
In-App Notification

Events:

Registration
Email Verification
Password Reset

Order Created
Payment Successful
Payment Failed
Order Shipped
Order Delivered

Return Requested
Refund Processed

Support Message
Low Stock
Coupon Expiring
21.1 Background Jobs

Use Redis + BullMQ.

Example:

Order Created
     ↓
Queue Job
     ↓
Notification Worker
     ↓
Send Email

This prevents slow email/SMS operations from blocking API requests.

22. Reports & Analytics

Admin reports:

Sales Report
Orders Report
Customer Report
Product Report
Inventory Report
Coupon Report
Payment Report
Refund Report
22.1 Dashboard Metrics
Total Revenue
Orders
Customers
Average Order Value
Top Products
Top Categories
Low Stock
Conversion Metrics
22.2 Report Filters
Today
Yesterday
This Week
This Month
Last Month
This Year
Custom Date Range

Exports:

CSV
Excel
PDF
23. Customer Storefront

Customer application will contain:

Home
Categories
Products
Search
Filters
Product Details
Wishlist
Cart
Checkout
Payment
Order Confirmation

Account
├── Profile
├── Addresses
├── Orders
├── Wishlist
├── Reviews
└── Support
23.1 Storefront Routes
/
 /products
 /products/:slug
 /categories/:slug
 /search

/cart
/checkout
/order-success

/login
/register
/forgot-password
/reset-password

/account
/account/profile
/account/addresses
/account/orders
/account/orders/:id
/account/wishlist
/account/reviews
/account/support
23.2 Homepage

Possible sections:

Hero Banner
Categories
Featured Products
New Arrivals
Best Sellers
Discount Products
Brands
Promotions
Recently Viewed
Recommended Products
Newsletter
23.3 Product Listing

Features:

Search
Category Filter
Brand Filter
Price Filter
Rating Filter
Attribute Filter
Sort
Pagination

Sort options:

Relevance
Newest
Price Low to High
Price High to Low
Popularity
Rating
23.4 Product Details

Product page:

Product Images
Product Name
Rating
Price
Discount
Variants
Attributes
Stock
Description
Specifications
Shipping Information
Reviews
Related Products
Add to Cart
Buy Now
Wishlist
23.5 Checkout

Checkout:

Cart
 ↓
Address
 ↓
Shipping Method
 ↓
Coupon
 ↓
Order Summary
 ↓
Payment
 ↓
Order Confirmation
24. API Architecture

All APIs should be versioned.

Base URL:

/api/v1
24.1 Authentication APIs
POST /api/v1/auth/register
POST /api/v1/auth/login
POST /api/v1/auth/logout
POST /api/v1/auth/refresh
POST /api/v1/auth/forgot-password
POST /api/v1/auth/reset-password
POST /api/v1/auth/verify-email

GET  /api/v1/auth/me
PATCH /api/v1/auth/profile
PATCH /api/v1/auth/change-password
24.2 User APIs
GET    /api/v1/users
POST   /api/v1/users
GET    /api/v1/users/:id
PATCH  /api/v1/users/:id
DELETE /api/v1/users/:id
24.3 Role APIs
GET    /api/v1/roles
POST   /api/v1/roles
GET    /api/v1/roles/:id
PATCH  /api/v1/roles/:id
DELETE /api/v1/roles/:id
24.4 Permission APIs
GET /api/v1/permissions
GET /api/v1/roles/:id/permissions
PUT /api/v1/roles/:id/permissions
24.5 Product APIs
GET    /api/v1/products
POST   /api/v1/products
GET    /api/v1/products/:id
PATCH  /api/v1/products/:id
DELETE /api/v1/products/:id
24.6 Category APIs
GET    /api/v1/categories
POST   /api/v1/categories
GET    /api/v1/categories/:id
PATCH  /api/v1/categories/:id
DELETE /api/v1/categories/:id
24.7 Order APIs
GET   /api/v1/orders
POST  /api/v1/orders
GET   /api/v1/orders/:id
PATCH /api/v1/orders/:id/status
POST  /api/v1/orders/:id/cancel
POST  /api/v1/orders/:id/return
24.8 Cart APIs
GET    /api/v1/cart
POST   /api/v1/cart/items
PATCH  /api/v1/cart/items/:id
DELETE /api/v1/cart/items/:id
DELETE /api/v1/cart
POST   /api/v1/cart/coupon
DELETE /api/v1/cart/coupon
24.9 Customer APIs
GET   /api/v1/customers
GET   /api/v1/customers/:id
PATCH /api/v1/customers/:id
24.10 Coupon APIs
GET    /api/v1/coupons
POST   /api/v1/coupons
GET    /api/v1/coupons/:id
PATCH  /api/v1/coupons/:id
DELETE /api/v1/coupons/:id
POST   /api/v1/coupons/validate
24.11 Payment APIs
POST /api/v1/payments/create
POST /api/v1/payments/verify
POST /api/v1/payments/webhook
POST /api/v1/payments/:id/refund
25. API Response Standard

All APIs should use a consistent response format.

25.1 Success
{
  "success": true,
  "message": "Product created successfully",
  "data": {}
}
25.2 List Response
{
  "success": true,
  "data": [],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 100,
    "totalPages": 5
  }
}
25.3 Error Response
{
  "success": false,
  "message": "Validation failed",
  "code": "VALIDATION_ERROR",
  "errors": []
}
26. Security

Security must be considered from the beginning.

26.1 Backend Security

Implement:

Helmet
CORS
Rate Limiting
Input Validation
Password Hashing
JWT Validation
Permission Checks
Request Size Limits
File Validation
Audit Logging
Secure Cookies Where Applicable
26.2 Password Security

Never store plain-text passwords.

Use:

Argon2

or:

bcrypt
26.3 Authorization

Never trust:

React permission checks

The backend must always validate:

Authentication
+
Authorization
+
Permission
26.4 File Upload Security

Validate:

File Type
File Size
File Extension
MIME Type
File Name

Do not allow arbitrary executable files.

26.5 Payment Security

Never trust payment success based only on frontend redirects.

Use payment-provider webhooks and server-side verification.

27. Testing

Testing should be implemented throughout development.

27.1 Backend Tests
Unit Tests
Integration Tests
API Tests
Authentication Tests
Authorization Tests
Product Tests
Inventory Tests
Cart Tests
Coupon Tests
Order Tests
Payment Tests
Refund Tests
27.2 Frontend Tests
Component Tests
Page Tests
Form Tests
State Tests
API Integration Tests
Permission UI Tests
27.3 End-to-End Tests

Important flows:

Register
Login
Browse Product
Search Product
Filter Product
Add Product to Cart
Update Cart
Apply Coupon
Checkout
Payment
Order Creation
Admin Login
Create Product
Update Product
Update Inventory
Update Order
Process Refund
28. Git & Development Workflow

Branches:

main
develop

Feature branches:

feature/auth
feature/users
feature/roles
feature/products
feature/inventory
feature/orders
feature/cart
feature/payment
feature/admin-dashboard
28.1 Commit Convention

Examples:

feat(auth): add login API

feat(product): add product CRUD

feat(order): add order status workflow

fix(cart): prevent negative quantity

fix(auth): handle expired refresh token

refactor(product): simplify product service

test(order): add order service tests
29. Environment Configuration

Example:

NODE_ENV=development

PORT=5000

DATABASE_URL=

JWT_ACCESS_SECRET=
JWT_REFRESH_SECRET=

REDIS_URL=

S3_ENDPOINT=
S3_BUCKET=
S3_ACCESS_KEY=
S3_SECRET_KEY=

SMTP_HOST=
SMTP_PORT=
SMTP_USER=
SMTP_PASSWORD=

PAYMENT_SECRET_KEY=
PAYMENT_WEBHOOK_SECRET=

FRONTEND_URL=
ADMIN_FRONTEND_URL=

Never commit:

.env

Commit:

.env.example
30. Development Roadmap

This is the recommended development sequence.

Phase 1 — Backend Foundation
1. Create Node.js project
2. Configure TypeScript
3. Configure Express
4. Configure PostgreSQL
5. Configure Prisma
6. Configure environment variables
7. Configure project structure
8. Configure error handling
9. Configure validation
10. Configure logging
11. Configure security middleware
12. Configure API versioning
Phase 2 — Authentication
1. User model
2. Register
3. Login
4. Logout
5. Access token
6. Refresh token
7. Forgot password
8. Reset password
9. Email verification
10. Current user
11. Profile
12. Change password
Phase 3 — Authorization
1. Role model
2. Permission model
3. User-role mapping
4. Role-permission mapping
5. Authentication middleware
6. Permission middleware
7. Admin access
Phase 4 — Admin Frontend Foundation
1. React + Vite
2. TypeScript
3. Tailwind CSS
4. React Router
5. Axios
6. TanStack Query
7. Zustand
8. React Hook Form
9. Zod
10. Admin layout
11. Sidebar
12. Header
13. Protected routes
14. Permission-based navigation
15. API integration
Phase 5 — Admin Users & Roles
1. Users list
2. Create user
3. Edit user
4. User details
5. Assign role
6. Roles list
7. Create role
8. Edit role
9. Permission assignment
Phase 6 — Catalog
1. Categories
2. Brands
3. Attributes
4. Products
5. Product images
6. Product variants
7. Pricing
8. SEO
9. Product status
Phase 7 — Inventory
1. Inventory list
2. Stock adjustment
3. Inventory transactions
4. Reserved stock
5. Available stock
6. Low-stock alerts
Phase 8 — Customers
1. Customer list
2. Customer details
3. Customer addresses
4. Customer orders
5. Customer activity
6. Customer status
Phase 9 — Orders
1. Order model
2. Order items
3. Order creation
4. Order status
5. Order details
6. Cancellation
7. Invoice
8. Return structure
9. Refund structure
Phase 10 — Coupons
1. Coupon CRUD
2. Percentage discount
3. Fixed discount
4. Minimum order
5. Maximum discount
6. Expiration
7. Usage limit
8. Customer limit
9. Product restriction
10. Category restriction
Phase 11 — Customer Storefront
1. Store React application
2. Homepage
3. Header
4. Footer
5. Categories
6. Product listing
7. Search
8. Filters
9. Product details
10. Product variants
11. Wishlist
12. Cart
Phase 12 — Checkout
1. Customer address
2. Shipping method
3. Coupon
4. Tax
5. Order summary
6. Backend price calculation
7. Order creation
Phase 13 — Payment
1. Payment abstraction
2. Payment initiation
3. Payment verification
4. Payment webhook
5. Payment success
6. Payment failure
7. Refund
Phase 14 — Shipping
1. Shipping methods
2. Shipping zones
3. Shipping charges
4. Shipment
5. Tracking number
6. Delivery status
Phase 15 — Post-Purchase
1. Customer order history
2. Order details
3. Order tracking
4. Reviews
5. Returns
6. Refunds
7. Notifications
Phase 16 — Support
1. Support tickets
2. Ticket categories
3. Ticket priority
4. Ticket messages
5. Attachments
6. Admin support dashboard
7. Socket.IO chat
8. Real-time messaging
Phase 17 — Reports
1. Sales reports
2. Order reports
3. Customer reports
4. Product reports
5. Inventory reports
6. Coupon reports
7. Payment reports
8. Refund reports
9. CSV export
10. Excel export
11. PDF export
Phase 18 — Production
1. Unit testing
2. Integration testing
3. E2E testing
4. Security testing
5. Performance testing
6. Database backups
7. Monitoring
8. Error tracking
9. Docker
10. CI/CD
11. Production environment
12. Production deployment
31. MVP Scope

The first version should not contain every possible feature.

The MVP should focus on the complete shopping flow.

31.1 MVP Admin
✓ Admin Login
✓ Logout
✓ Users
✓ Roles
✓ Permissions
✓ Customers
✓ Categories
✓ Brands
✓ Products
✓ Product Variants
✓ Product Attributes
✓ Inventory
✓ Orders
✓ Coupons
✓ Basic Dashboard
31.2 MVP Customer
✓ Register
✓ Login
✓ Logout
✓ Home
✓ Categories
✓ Product Listing
✓ Search
✓ Filters
✓ Product Details
✓ Product Variants
✓ Cart
✓ Address
✓ Checkout
✓ Payment
✓ Order Confirmation
✓ Order History
✓ Profile
31.3 MVP Flow

The MVP should support this complete flow:

Admin
 ↓
Create Category
 ↓
Create Product
 ↓
Add Stock
 ↓
Publish Product
 ↓
Customer
 ↓
Browse Product
 ↓
Add to Cart
 ↓
Checkout
 ↓
Payment
 ↓
Order Created
 ↓
Admin
 ↓
Process Order
 ↓
Ship Order
 ↓
Customer
 ↓
Receive Order

If this flow works correctly, the core e-commerce system is functional.

32. V2 Scope

After MVP is stable:

Wishlist
Reviews
Returns
Refunds
Shipping Integration
Notifications
Support Tickets
Real-Time Chat
Advanced Reports
Email Automation
SMS Notifications
33. V3 Scope

Advanced functionality:

Product Recommendations
Recently Viewed Products
Abandoned Cart
Flash Sales
Loyalty Points
Gift Cards
Referral System
Advanced Analytics
Marketing Automation
Multi-Warehouse
Multi-Currency
Multi-Language
Multi-Vendor
34. Production Architecture

Recommended deployment architecture:

                         INTERNET
                            │
                     Reverse Proxy
                            │
             ┌──────────────┴──────────────┐
             │                             │
       ADMIN FRONTEND               STORE FRONTEND
             │                             │
             └──────────────┬──────────────┘
                            │
                         API SERVER
                            │
              ┌─────────────┼─────────────┐
              │             │             │
          PostgreSQL      Redis      Object Storage
              │             │
              │          BullMQ
              │             │
              │      Background Workers
              │
              └──────────────┐
                             │
                     External Services
                     ├── Payment
                     ├── Email
                     ├── SMS
                     └── Shipping
34.1 Docker Services

Possible services:

backend
admin-frontend
store-frontend
postgres
redis
worker
nginx
35. Production Checklist

Before deployment:

[ ] Environment variables configured
[ ] Database migrations completed
[ ] Database backups configured
[ ] HTTPS enabled
[ ] CORS configured
[ ] Rate limiting enabled
[ ] Secure authentication
[ ] Password hashing enabled
[ ] Input validation enabled
[ ] File upload validation enabled
[ ] Error logging configured
[ ] Monitoring configured
[ ] Payment webhooks verified
[ ] Email tested
[ ] Shipping tested
[ ] Order flow tested
[ ] Inventory tested
[ ] Coupon tested
[ ] Refund tested
[ ] Admin permissions tested
[ ] E2E tests passed
[ ] Production build tested
[ ] Docker tested
[ ] CI/CD configured
36. Important Business Rules

These rules should be treated as mandatory.

36.1 Never Trust Frontend Prices

Frontend should send:

{
  "productId": "123",
  "variantId": "456",
  "quantity": 2
}

Backend should retrieve:

Current Product
Current Variant
Current Price
Current Stock

Then calculate:

Price
 ×
Quantity
 ↓
Subtotal
 ↓
Coupon
 ↓
Tax
 ↓
Shipping
 ↓
Grand Total
36.2 Inventory Must Be Server Controlled

Do not allow React to decide whether an item is in stock.

Backend must validate:

Available Stock
Reserved Stock
Requested Quantity
36.3 Coupon Must Be Server Controlled

Backend must validate:

Coupon Exists
Coupon Active
Coupon Not Expired
Usage Limit
Customer Limit
Minimum Order
Product Eligibility
Category Eligibility
36.4 Payment Must Be Server Verified

Never do:

Frontend says payment successful
        ↓
Create paid order

Instead:

Frontend starts payment
        ↓
Payment Provider
        ↓
Provider Callback/Webhook
        ↓
Backend Verification
        ↓
Payment Confirmed
        ↓
Order Updated
36.5 Authorization Must Be Backend Controlled

Frontend:

Hide Delete Button

is not security.

Backend:

Check authentication
       ↓
Check role
       ↓
Check permission
       ↓
Allow / Reject

is security.

36.6 Use Transactions for Critical Operations

Database transactions should be used for operations such as:

Order Creation
Inventory Reservation
Inventory Deduction
Payment Confirmation
Refund Processing
Return Processing

Example:

Create Order
    +
Create Order Items
    +
Reserve Inventory
    +
Create Payment Record

These operations should be handled safely as a transaction where appropriate.

37. Admin Page Structure

Recommended page structure:

admin-frontend/
│
└── src/
    ├── api/
    │
    ├── assets/
    │
    ├── components/
    │   ├── common/
    │   ├── forms/
    │   ├── tables/
    │   ├── modals/
    │   └── charts/
    │
    ├── layouts/
    │   ├── AdminLayout.tsx
    │   └── AuthLayout.tsx
    │
    ├── pages/
    │   ├── auth/
    │   ├── dashboard/
    │   ├── users/
    │   ├── roles/
    │   ├── permissions/
    │   ├── customers/
    │   ├── categories/
    │   ├── brands/
    │   ├── products/
    │   ├── inventory/
    │   ├── orders/
    │   ├── coupons/
    │   ├── reviews/
    │   ├── support/
    │   ├── reports/
    │   └── settings/
    │
    ├── routes/
    ├── hooks/
    ├── store/
    ├── utils/
    └── App.tsx
38. Store Frontend Structure
store-frontend/
│
└── src/
    ├── api/
    │
    ├── assets/
    │
    ├── components/
    │   ├── common/
    │   ├── product/
    │   ├── cart/
    │   ├── checkout/
    │   └── account/
    │
    ├── layouts/
    │   ├── StoreLayout.tsx
    │   └── AuthLayout.tsx
    │
    ├── pages/
    │   ├── home/
    │   ├── products/
    │   ├── categories/
    │   ├── cart/
    │   ├── checkout/
    │   ├── auth/
    │   ├── account/
    │   ├── orders/
    │   ├── wishlist/
    │   ├── reviews/
    │   └── support/
    │
    ├── routes/
    ├── hooks/
    ├── store/
    ├── utils/
    └── App.tsx
39. Admin UI Standards

Every major listing page should support:

Search
Filter
Sort
Pagination
Create
View
Edit
Archive/Delete
Bulk Actions
Export

Example:

-------------------------------------------------------
Products

[ Search Products... ] [Category] [Status] [Filter]

                                      [+ Add Product]

-------------------------------------------------------
Image | Name | SKU | Category | Price | Stock | Status
-------------------------------------------------------
      |      |     |          |       |       |
-------------------------------------------------------

                  < 1 2 3 4 5 >
-------------------------------------------------------
40. Recommended Development Order

The most important rule is:

Build the system module by module, not all modules simultaneously.

Recommended order:

STEP 01
Backend Foundation

STEP 02
Database

STEP 03
Authentication

STEP 04
Users

STEP 05
Roles

STEP 06
Permissions

STEP 07
Admin React Foundation

STEP 08
Admin Authentication

STEP 09
Admin Dashboard Skeleton

STEP 10
Categories

STEP 11
Brands

STEP 12
Attributes

STEP 13
Products

STEP 14
Product Variants

STEP 15
Inventory

STEP 16
Customers

STEP 17
Orders

STEP 18
Coupons

STEP 19
Customer React Store

STEP 20
Product Listing

STEP 21
Product Details

STEP 22
Cart

STEP 23
Wishlist

STEP 24
Checkout

STEP 25
Payment

STEP 26
Shipping

STEP 27
Reviews

STEP 28
Returns

STEP 29
Refunds

STEP 30
Notifications

STEP 31
Support Tickets

STEP 32
Real-Time Chat

STEP 33
Reports

STEP 34
Analytics

STEP 35
Testing

STEP 36
Security Review

STEP 37
Docker

STEP 38
CI/CD

STEP 39
Production Deployment
41. Vertical Slice Development

For each module, follow this process:

Database
   ↓
Migration
   ↓
Model
   ↓
Repository
   ↓
Service
   ↓
Controller
   ↓
Routes
   ↓
Validation
   ↓
Permissions
   ↓
API Tests
   ↓
Frontend API
   ↓
Frontend Page
   ↓
Frontend Tests
   ↓
Complete Module

Example:

PRODUCT MODULE

Database
   ↓
Product Model
   ↓
Product Repository
   ↓
Product Service
   ↓
Product Controller
   ↓
Product Routes
   ↓
Product Permissions
   ↓
Product API Tests
   ↓
Admin Product API
   ↓
Admin Product List
   ↓
Create Product
   ↓
Edit Product
   ↓
Product Details
   ↓
Testing
   ↓
DONE

Then move to Inventory.

42. Final Module Priority
Must Build First
1. Configuration
2. Database
3. Authentication
4. Users
5. Roles
6. Permissions
Admin Core
7. Categories
8. Brands
9. Attributes
10. Products
11. Variants
12. Inventory
13. Customers
14. Orders
15. Coupons
16. Dashboard
Customer Core
17. Storefront
18. Product Listing
19. Product Details
20. Cart
21. Wishlist
22. Checkout
23. Payment
24. Shipping
25. Orders
Post-Purchase
26. Reviews
27. Returns
28. Refunds
29. Notifications
30. Support
31. Chat
Advanced
32. Reports
33. Analytics
34. Recommendations
35. Abandoned Cart
36. Loyalty
37. Referral
38. Gift Cards
39. Multi-Warehouse
40. Multi-Vendor
43. Project Completion Definition

The project should be considered MVP-complete when this entire journey works:

ADMIN

Login
 ↓
Create Category
 ↓
Create Brand
 ↓
Create Product
 ↓
Create Product Variant
 ↓
Add Inventory
 ↓
Publish Product
 ↓
View Dashboard


CUSTOMER

Register
 ↓
Login
 ↓
Browse Products
 ↓
Search
 ↓
Filter
 ↓
Open Product
 ↓
Select Variant
 ↓
Add to Cart
 ↓
Apply Coupon
 ↓
Checkout
 ↓
Select Address
 ↓
Select Shipping
 ↓
Pay
 ↓
Order Created
 ↓
View Order


ADMIN

View Order
 ↓
Confirm Order
 ↓
Process Order
 ↓
Pack
 ↓
Ship
 ↓
Update Tracking
 ↓
Deliver


CUSTOMER

Receive Order
 ↓
Review Product

If this complete flow works reliably, the application has a strong e-commerce MVP foundation.

44. Long-Term Architecture Goal

Final architecture:

                         E-COMMERCE PLATFORM
                                  │
              ┌───────────────────┼───────────────────┐
              │                   │                   │
        ADMIN FRONTEND      STORE FRONTEND       FUTURE APPS
              │                   │                   │
              └───────────────────┼───────────────────┘
                                  │
                              API LAYER
                                  │
                         NODE.JS + EXPRESS
                                  │
       ┌───────────────┬──────────┼──────────┬───────────────┐
       │               │          │          │               │
 PostgreSQL          Redis     Storage    Queue          WebSocket
       │               │          │          │               │
       │               │          │          │               │
       └───────────────┴──────────┴──────────┴───────────────┘
                                  │
                         External Services
                                  │
              ┌───────────────────┼───────────────────┐
              │                   │                   │
           Payment              Email              Shipping
45. Golden Rules
Build the backend foundation first.
Build authentication before business modules.
Build roles and permissions before the full admin panel.
Keep Admin Frontend and Store Frontend separate.
Keep business logic inside backend services.
Never trust frontend prices.
Never trust frontend inventory.
Never trust frontend payment success.
Always validate permissions on the backend.
Use database transactions for critical operations.
Keep payment logic independent from orders.
Keep shipping logic independent from orders.
Keep notification logic independent from business modules.
Store inventory transactions for auditability.
Use API versioning from the beginning.
Write tests while building modules.
Do not build advanced features before the MVP is stable.
Build one complete vertical slice at a time.
Keep secrets in environment variables.
Design for production from the beginning, but do not over-engineer the MVP.
46. First Development Milestone

The first actual coding milestone should be:

PROJECT SETUP

Backend
├── Node.js
├── TypeScript
├── Express
├── PostgreSQL
├── Prisma
├── Environment Config
├── Error Handling
├── Validation
├── Logging
└── Security

Then:

AUTHENTICATION
├── User Model
├── Register
├── Login
├── Logout
├── Refresh Token
├── Forgot Password
├── Reset Password
└── Current User

Then:

AUTHORIZATION
├── Roles
├── Permissions
├── User Roles
├── Role Permissions
└── Permission Middleware

Then:

ADMIN FRONTEND
├── React
├── TypeScript
├── Vite
├── Tailwind
├── Router
├── API Client
├── Auth
├── Protected Routes
├── Layout
└── Dashboard

After these are complete, begin:

CATEGORIES
    ↓
BRANDS
    ↓
ATTRIBUTES
    ↓
PRODUCTS
    ↓
VARIANTS
    ↓
INVENTORY
    ↓
CUSTOMERS
    ↓
ORDERS
47. Final Goal

The final platform will provide:

Admin
Authentication
Authorization
Users
Roles
Permissions
Dashboard
Customers
Categories
Brands
Products
Variants
Attributes
Inventory
Orders
Coupons
Payments
Shipping
Reviews
Returns
Refunds
Support
Chat
Notifications
Reports
Analytics
Settings
Audit Logs
Customer
Authentication
Home
Categories
Products
Search
Filters
Product Details
Variants
Wishlist
Cart
Coupons
Addresses
Checkout
Payments
Orders
Order Tracking
Reviews
Returns
Refunds
Notifications
Support
Chat
Profile
Infrastructure
Node.js
Express.js
TypeScript
PostgreSQL
Prisma
Redis
BullMQ
Socket.IO
Docker
CI/CD
Monitoring
Logging
Backups
END
Next Implementation Step

Do not start by creating every module.

Start with:

01. Backend Project Setup
02. PostgreSQL + Prisma
03. Database Base Configuration
04. Express Application
05. Error Handling
06. Validation
07. Authentication
08. Users
09. Roles
10. Permissions
11. Admin React Setup
12. Admin Login
13. Admin Layout


Product Model Needs to Change

For normal e-commerce, this is often enough:

Product
 └── Variant

For your business, we need:

Product
   │
   ├── Category
   ├── Brand
   ├── Attributes
   ├── Variants
   ├── Packaging
   ├── Batch/Lot
   ├── Inventory
   ├── Pricing
   ├── Documents
   └── Quality Information

For example:

Product:
Basmati Rice

Category:
Rice

Brand:
ABC

Variants:
├── 1 KG
├── 5 KG
├── 10 KG
├── 25 KG
└── 50 KG

But packaging is not necessarily the same thing as the commercial variant.

We should therefore model it separately.

2. Units of Measurement

This is one of the most important additions.

Your products may be sold by:

KG
GRAM
TON
LITRE
ML
BAG
BOX
BOTTLE
CAN
DRUM
PALLET
CONTAINER

For example:

Rice
5 KG Bag

Oil
1 L Bottle

Oil
5 L Can

Dal
25 KG Bag

Beans
50 KG Bag

So we'll have:

UnitOfMeasure
├── id
├── name
├── code
├── type
└── conversionFactor

Example:

KG
LITRE
GRAM
ML
3. Product Packaging

We should add a packaging system.

Example:

Product: Sunflower Oil

Packaging
├── 500 ML Bottle
├── 1 L Bottle
├── 5 L Can
└── 20 L Can

For export:

Rice

Packaging
├── 5 KG Bag
├── 10 KG Bag
├── 25 KG Bag
├── 50 KG Bag
└── 1 MT Bulk Bag

This becomes extremely useful for:

Inventory
Shipping
Pricing
Export
Weight calculation
Container planning
4. B2C + B2B

Your system should support both.

Retail
Customer
 ↓
1 × 5 KG Rice
 ↓
Online Payment
 ↓
Delivery
Wholesale
Business Customer
 ↓
500 KG Rice
 ↓
Request Quote
 ↓
Negotiated Price
 ↓
Invoice
 ↓
Payment
 ↓
Shipment
Export
Importer
 ↓
Request Quote
 ↓
Product Specification
 ↓
Quantity
 ↓
Destination Country
 ↓
Incoterm
 ↓
Shipping
 ↓
Export Documents
 ↓
Payment
 ↓
Shipment

Therefore add:

Customer Type

INDIVIDUAL
BUSINESS
WHOLESALE
EXPORTER
IMPORTER
DISTRIBUTOR
5. Wholesale Pricing

Normal e-commerce has:

Product → Price

Your business needs:

Product
   │
   ├── Retail Price
   ├── Wholesale Price
   ├── Distributor Price
   └── Export Price

And potentially:

Quantity
   ↓
Price Tier

Example:

1–9 bags       → ₹2,000
10–49 bags     → ₹1,900
50–199 bags    → ₹1,800
200+ bags      → ₹1,700

So we'll add:

PriceList
PriceTier
CustomerPrice
6. Minimum Order Quantity

Export and wholesale frequently need MOQ.

Example:

Basmati Rice

Retail MOQ:
1 bag

Wholesale MOQ:
50 bags

Export MOQ:
1 MT

Therefore Product/Variant should support:

minimumOrderQuantity
maximumOrderQuantity
orderQuantityStep

For example:

MOQ = 100 KG
Order step = 25 KG

Customer can order:

100 KG
125 KG
150 KG
175 KG
...

but not:

110 KG

if the business sells in 25-KG increments.

7. Batch / Lot Management

For food products, I strongly recommend batch tracking.

Example:

Basmati Rice
      │
      ├── Batch BR2026A
      │     ├── Manufacturing Date
      │     ├── Best Before
      │     ├── Quantity
      │     └── Warehouse
      │
      └── Batch BR2026B
            ├── Manufacturing Date
            ├── Best Before
            ├── Quantity
            └── Warehouse

Database:

ProductBatch
├── id
├── productId
├── variantId
├── batchNumber
├── manufacturingDate
├── expiryDate
├── receivedDate
├── quantity
├── status
└── warehouseId

This will help with:

Traceability
Expiry management
Returns
Recalls
Quality control
Inventory
8. FIFO / FEFO

For food inventory, we should support:

FIFO
First In
   ↓
First Out

And preferably:

FEFO
First Expired
   ↓
First Out

For products with expiry/best-before dates, FEFO is usually more appropriate.

The inventory service should therefore be designed around inventory lots rather than just:

stock = 500
9. Warehouse Management

Your original plan has inventory but export makes warehouses more important.

We'll support:

Warehouse
├── Main Warehouse
├── Export Warehouse
├── Ahmedabad Warehouse
├── Mumbai Warehouse
└── Future Warehouses

Then:

Product
 ↓
Warehouse
 ↓
Batch
 ↓
Stock

For example:

Basmati Rice

Ahmedabad Warehouse
├── Batch A → 500 KG
└── Batch B → 800 KG

Mumbai Warehouse
├── Batch C → 2,000 KG
└── Batch D → 1,000 KG
10. Export Countries

We should have proper geographic entities.

Country
State/Province
City
Port

And:

ShippingZone

Example:

India
 ├── Gujarat
 ├── Maharashtra
 └── Punjab

UAE
USA
UK
Saudi Arabia
Qatar
Oman
Canada
Australia
...

Don't hard-code country names throughout the application.

11. Multiple Currencies

Because you are exporting, pricing must support currencies.

Example:

INR
USD
EUR
GBP
AED
SAR

We should create:

Currency
ExchangeRate
Price

For example:

Product
Basmati Rice

INR
₹150 / KG

USD
$1.80 / KG

AED
AED 6.60 / KG

However, don't blindly convert prices on every request.

We'll eventually decide whether export prices are:

dynamically converted,
manually maintained,
or a combination.

For B2B/export, manually maintained price lists are often better.

12. GST / Tax

Since you're operating from India, the system should separate tax calculation from the generic order logic.

For example:

Tax
├── Tax Region
├── Tax Type
├── Tax Rate
└── Applicability

Domestic and export orders can have different tax treatment.

We should not hard-code tax rates in React or product records.

Instead:

Order
 ↓
Customer Country
 ↓
Shipping Country
 ↓
Tax Rules
 ↓
Tax Calculation

The exact tax treatment should be configured according to your accountant/tax advisor's requirements rather than assumed in application code.

13. HS Code

For international trade, this is a major addition.

Products should support:

HS Code

Example conceptually:

Product
├── HS Code
├── Country of Origin
├── Product Description
├── Net Weight
├── Gross Weight
└── Export Classification

Don't hard-code HS codes without validating them for the actual commodity/product and destination requirements.

14. Country of Origin

Export products need:

countryOfOrigin

Example:

Country of Origin:
India

This should be stored against the product/lot where appropriate.

15. Export Documentation

This is a significant new module.

Export
   │
   ├── Commercial Invoice
   ├── Packing List
   ├── Certificate of Origin
   ├── Shipping Documents
   ├── Inspection Certificate
   ├── Quality Certificate
   └── Other Documents

Database:

ExportDocument
├── id
├── exportOrderId
├── documentType
├── documentNumber
├── fileUrl
├── issuedDate
├── expiryDate
└── status

Files should go into S3-compatible object storage rather than PostgreSQL.

16. Export Order

I recommend separating a normal order from export-specific information.

Order
   │
   └── ExportOrder

For example:

Order
├── Customer
├── Items
├── Payment
├── Shipment
└── Export Details
      ├── Destination Country
      ├── Port
      ├── HS Code
      ├── Incoterm
      ├── Currency
      ├── Container
      └── Documents
17. Incoterms

For export/B2B orders, we'll need support for commercial terms such as:

EXW
FOB
CFR
CIF
DAP
DDP

Don't make these just free-text strings.

We can create:

Incoterm

and associate it with the quote/order.

18. Ports

International shipment planning needs:

Origin Port
Destination Port

For example:

India
 ↓
Mundra Port
 ↓
Dubai

or:

India
 ↓
Nhava Sheva
 ↓
Destination Port

So:

Port
├── name
├── code
├── countryId
└── status
19. Container Management

This becomes useful for bulk export.

Example:

Export Order
     │
     ├── Container 1
     │     ├── Product
     │     ├── Packages
     │     ├── Net Weight
     │     └── Gross Weight
     │
     └── Container 2

Eventually:

Shipment
 ├── Container
 ├── Container Number
 ├── Seal Number
 ├── Gross Weight
 ├── Net Weight
 └── Package Count
20. Quote Management

This is probably one of the biggest additions to your original plan.

A customer may not immediately buy an export order.

They may say:

I need 20 MT of basmati rice delivered to Dubai.

So:

Customer
 ↓
Request Quote
 ↓
Sales/Admin
 ↓
Calculate Price
 ↓
Shipping
 ↓
Taxes/Duties if applicable
 ↓
Negotiation
 ↓
Quote
 ↓
Customer Accepts
 ↓
Order

Add:

quotes
quote_items
quote_addresses
quote_versions

Quote status:

DRAFT
SENT
NEGOTIATING
ACCEPTED
REJECTED
EXPIRED
CONVERTED
CANCELLED
21. B2B Customer

We should have:

Customer
   │
   └── BusinessProfile

Business information:

Company Name
Registration Number
Tax Number
VAT/GST Number
Country
Address
Contact Person
Email
Phone

For export customers, additional information may be needed depending on your compliance requirements.

22. Customer Documents

B2B/export customers may provide documents.

Customer
 ├── Business Documents
 ├── Tax Documents
 ├── Import Documents
 └── Other Documents

Again:

Database → metadata
Object Storage → actual file
23. Quality Management

For agricultural/food products, consider adding:

QualityCertificate
Inspection
TestReport

Example:

Batch
 ↓
Quality Inspection
 ↓
Moisture
Purity
Grade
Foreign Matter
Other Measurements
 ↓
Quality Result

Don't hard-code the actual test parameters prematurely because different commodities can have different specifications.

Instead:

QualityParameter
QualityTest
QualityResult
24. Product Grade

Your products may eventually have grades:

Rice
├── Premium
├── Standard
└── Economy

Or commodity-specific grades.

So we can support:

ProductGrade

rather than assuming every product has the same attributes.

25. Product Specifications

For your type of business, specifications should be dynamic.

Example:

Basmati Rice

Origin:
India

Grain Type:
Long Grain

Grade:
Premium

Moisture:
...

Broken Grains:
...

Packaging:
25 KG

For oil:

Sunflower Oil

Origin:
India

Type:
Refined

Packaging:
5 L

Shelf Life:
...

Therefore:

ProductAttribute
ProductAttributeValue

is a very good decision from your original plan.

26. Revised Backend Modules

Your original modules become:

1. Configuration

2. Authentication

3. Users

4. Roles

5. Permissions

6. Customers
   └── Business Profiles

7. Countries & Regions

8. Categories

9. Brands

10. Products

11. Product Attributes

12. Product Variants

13. Packaging

14. Units of Measurement

15. Product Grades

16. Product Specifications

17. Product Documents

18. Inventory

19. Warehouses

20. Inventory Batches/Lots

21. Inventory Transactions

22. Carts

23. Wishlists

24. Pricing

25. Wholesale Pricing

26. Export Pricing

27. Coupons

28. Quotes

29. Orders

30. Payments

31. Tax

32. Shipping

33. Shipments

34. Containers

35. Ports

36. Incoterms

37. Export Orders

38. Export Documents

39. Quality Management

40. Reviews

41. Returns

42. Refunds

43. Notifications

44. Support Tickets

45. Chat

46. Reports

47. Analytics

48. Settings

49. Audit Logs

50. File Storage

51. Background Jobs
27. Revised Database

Instead of creating only the original tables, we'll gradually build toward:

USERS
├── users
├── roles
├── permissions
├── user_roles
└── role_permissions

CUSTOMERS
├── customers
├── business_profiles
├── customer_addresses
└── customer_documents

GEOGRAPHY
├── countries
├── regions
├── cities
└── ports

CATALOG
├── categories
├── brands
├── products
├── product_variants
├── product_images
├── product_attributes
├── product_attribute_values
├── product_grades
├── product_specifications
├── packaging
└── units_of_measure

PRICING
├── price_lists
├── price_tiers
├── product_prices
└── customer_prices

INVENTORY
├── warehouses
├── inventory
├── inventory_batches
└── inventory_transactions

COMMERCE
├── carts
├── cart_items
├── wishlists
├── wishlist_items
├── coupons
└── coupon_usages

QUOTES
├── quotes
├── quote_items
└── quote_versions

ORDERS
├── orders
├── order_items
├── order_addresses
└── order_status_history

PAYMENTS
├── payments
└── payment_transactions

SHIPPING
├── shipping_methods
├── shipping_zones
├── shipments
├── shipment_items
├── containers
└── tracking_events

EXPORT
├── export_orders
├── export_documents
├── incoterms
├── customs_information
└── certificates

QUALITY
├── quality_parameters
├── quality_inspections
└── quality_results

POST PURCHASE
├── reviews
├── returns
└── refunds

COMMUNICATION
├── notifications
├── support_tickets
├── support_messages
└── chat_messages

SYSTEM
├── settings
├── audit_logs
└── files
28. Revised Customer Applications

I would actually plan for three user experiences, even if initially we implement only two React applications.

Admin
admin.yourdomain.com
Customer Store
www.yourdomain.com
B2B / Export

Potentially:

b2b.yourdomain.com

But don't build a third frontend immediately.

Initially:

Admin
    ↓
Customer Store
    ↓
B2B/Export features inside Store

Later, if B2B becomes large enough, split it into a dedicated application.

29. Revised Storefront

The customer frontend should support:

HOME

PRODUCTS
├── Rice
├── Dals
├── Beans
├── Pulses
├── Edible Oils
├── Grains
└── Other Products

PRODUCT DETAILS

CART

CHECKOUT

ACCOUNT

ORDERS

WISHLIST

REVIEWS

SUPPORT

BULK ORDER
REQUEST QUOTE
EXPORT INQUIRY
30. Important: Bulk Order Flow

Add:

/request-quote

Example:

Product:
Basmati Rice

Quantity:
10,000 KG

Packaging:
25 KG Bags

Destination:
Dubai, UAE

Preferred Incoterm:
FOB

Message:
Need quotation for regular monthly supply.

Then:

Customer
 ↓
Quote Request
 ↓
Admin
 ↓
Quotation
 ↓
Customer
 ↓
Accept
 ↓
Order

This is much more appropriate for your business than forcing every large export customer through the normal retail cart.

31. Revised Admin Navigation

Your admin should eventually look like:

Dashboard

Catalog
├── Products
├── Categories
├── Brands
├── Attributes
├── Grades
├── Packaging
└── Product Documents

Inventory
├── Warehouses
├── Stock
├── Batches/Lots
├── Transactions
└── Low Stock / Expiry

Customers
├── Customers
├── Businesses
├── Addresses
└── Documents

Sales
├── Orders
├── Quotes
├── Payments
├── Returns
└── Refunds

Marketing
├── Coupons
├── Promotions
└── Banners

Shipping
├── Methods
├── Zones
├── Shipments
├── Tracking
├── Containers
└── Ports

Export
├── Export Orders
├── Export Documents
├── Incoterms
├── Customs
├── Certificates
└── Export Reports

Quality
├── Inspections
├── Test Reports
└── Certificates

Customers Support
├── Tickets
├── Chat
└── Notifications

Reports
├── Sales
├── Inventory
├── Customers
├── Export
├── Payments
└── Products

Users & Access
├── Users
├── Roles
└── Permissions

Settings
32. Revised Development Roadmap

I would change your development order to:

PHASE 1
Project Foundation

PHASE 2
PostgreSQL + Prisma

PHASE 3
Authentication

PHASE 4
Users

PHASE 5
Roles & Permissions

PHASE 6
Admin React Foundation

PHASE 7
Countries / Currency / Basic Settings

PHASE 8
Categories

PHASE 9
Brands

PHASE 10
Units & Packaging

PHASE 11
Product Attributes

PHASE 12
Products

PHASE 13
Product Variants

PHASE 14
Warehouses

PHASE 15
Inventory + Batches

PHASE 16
Customers

PHASE 17
Pricing

PHASE 18
Orders

PHASE 19
Coupons

PHASE 20
Customer Storefront

PHASE 21
Cart

PHASE 22
Checkout

PHASE 23
Payment

PHASE 24
Shipping

PHASE 25
Quotes / Bulk Orders

PHASE 26
B2B Customers

PHASE 27
Export Orders

PHASE 28
Export Documents

PHASE 29
Ports / Containers / Incoterms

PHASE 30
Quality Management

PHASE 31
Reviews

PHASE 32
Returns / Refunds

PHASE 33
Notifications

PHASE 34
Support

PHASE 35
Reports

PHASE 36
Testing

PHASE 37
Security

PHASE 38
Docker

PHASE 39
CI/CD

PHASE 40
Production
33. MVP Should Also Change

For your business, I would define MVP as:

Admin
✓ Login
✓ Roles
✓ Permissions
✓ Customers
✓ Countries
✓ Categories
✓ Brands
✓ Units
✓ Packaging
✓ Products
✓ Variants
✓ Warehouses
✓ Inventory
✓ Batches
✓ Orders
✓ Basic Pricing
✓ Coupons
✓ Basic Dashboard
Customer
✓ Register
✓ Login
✓ Products
✓ Search
✓ Filters
✓ Product Details
✓ Packaging/Variant Selection
✓ Cart
✓ Address
✓ Checkout
✓ Payment
✓ Orders
✓ Profile
B2B/Export
✓ Business Customer
✓ Bulk Order
✓ Request Quote
✓ Quote Management
✓ Destination Country
✓ Currency
✓ Basic Export Order

Then V2:

Shipping Integration
Export Documents
Containers
Ports
Incoterms
Quality Certificates
Advanced Pricing
Advanced Reports
Notifications
Support
Reviews
Returns
Refunds
34. One Very Important Architectural Decision

Don't create a separate "export database".

Use one unified commerce system:

                         ORDER
                           │
              ┌────────────┴────────────┐
              │                         │
          DOMESTIC                   EXPORT
              │                         │
         India → India            India → UAE
              │                         │
         Local Tax                  Export Rules
              │                         │
         Local Shipping            International
                                        │
                                   Documents
                                        │
                                   Customs
                                        │
                                   Containers

This means:

Order
├── Domestic information
└── Export information (nullable)

That is much easier to maintain.

35. Database Strategy

And this is why I recommend not writing the entire Prisma schema right now.

We'll build it incrementally.

Migration 1
users
roles
permissions
user_roles
role_permissions
Migration 2
countries
currencies
Migration 3
categories
brands
units
packaging
Migration 4
products
product_variants
attributes
Migration 5
warehouses
inventory
batches
inventory_transactions
Migration 6
customers
business_profiles
addresses
Migration 7
pricing
Migration 8
carts
wishlists
Migration 9
orders
order_items

And so on.

This gives us small, understandable migrations instead of one enormous database schema.

36. What We Should Do Right Now

You were previously at:

01. Backend Project Setup
02. PostgreSQL + Prisma
03. Database Base Configuration
04. Express Application