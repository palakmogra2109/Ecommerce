import { Navigate, Outlet, Route, Routes, useParams } from "react-router-dom";

import Login from "./pages/Login";
import Register from "./pages/Register";
import Storefront from "./pages/Storefront";
import Dashboard from "./pages/Dashboard";
import Users from "./pages/Users";
import UserView from "./pages/UserView";
import UserForm from "./components/UserForm";
import Roles from "./pages/Roles";
import RoleForm from "./components/RoleForm";
import EmailTemplates from "./pages/EmailTemplates";
import EmailTemplateForm from "./components/EmailTemplateForm";
import Products from "./pages/Products";
import Inventory from "./pages/Inventory";
import Orders from "./pages/Orders";
import OrderView from "./pages/OrderView";
import Customers from "./pages/Customers";
import CustomerView from "./pages/CustomerView";
import Categories from "./pages/Categories";
import SubCategories from "./pages/SubCategories";
import CategoryView from "./pages/CategoryView";
import Brands from "./pages/Brands";
import BrandView from "./pages/BrandView";
import Attributes from "./pages/Attributes";
import AttributeView from "./pages/AttributeView";
import Coupons from "./pages/Coupons";
import CouponView from "./pages/CouponView";
import Reviews from "./pages/Reviews";
import Banners from "./pages/Banners";
import BannerView from "./pages/BannerView";
import Settings from "./pages/Settings";
import ProductForm from "./components/ProductForm";
import ProductView from "./pages/ProductView";
import CategoriesForm from "./components/CategoriesForm";
import BrandForm from "./components/BrandForm";
import AttributeForm from "./components/AttributeForm";
import CouponForm from "./components/CouponForm";
import BannerForm from "./components/BannerForm";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import ProtectedRoute from "./components/ProtectedRoute";
import PublicRoute from "./components/PublicRoute";
import AdminLayout from "./components/AdminLayout";
import PermissionRoute from "./components/PermissionRoute";

function UserEditRoute() {
  const { id } = useParams();

  if (!id || id === "undefined" || id === "null") {
    return <Navigate to="/users" replace />;
  }

  return <UserForm userId={id} />;
}

function RoleEditRoute() {
  const { id } = useParams();

  if (!id || id === "undefined" || id === "null") {
    return <Navigate to="/roles" replace />;
  }

  return <RoleForm roleId={id} />;
}

function EmailTemplateEditRoute() {
  const { id } = useParams();

  if (!id || id === "undefined" || id === "null") {
    return <Navigate to="/email-templates" replace />;
  }

  return <EmailTemplateForm templateId={id} />;
}

function CategoryEditRoute() {
  const { id } = useParams();

  if (!id || id === "undefined" || id === "null") {
    return <Navigate to="/categories" replace />;
  }

  return <CategoriesForm categoryId={id} />;
}

function SubCategoryEditRoute() {
  const { id } = useParams();

  if (!id || id === "undefined" || id === "null") {
    return <Navigate to="/sub-categories" replace />;
  }

  return <CategoriesForm categoryId={id} subCategory />;
}

function BrandEditRoute() {
  const { id } = useParams();

  if (!id || id === "undefined" || id === "null") {
    return <Navigate to="/brands" replace />;
  }

  return <BrandForm brandId={id} />;
}

function AttributeEditRoute() {
  const { id } = useParams();

  if (!id || id === "undefined" || id === "null") {
    return <Navigate to="/attributes" replace />;
  }

  return <AttributeForm attributeId={id} />;
}

function ProductEditRoute() {
  const { id } = useParams();

  if (!id || id === "undefined" || id === "null") {
    return <Navigate to="/products" replace />;
  }

  return <ProductForm productId={id} />;
}

function CouponEditRoute() {
  const { id } = useParams();

  if (!id || id === "undefined" || id === "null") {
    return <Navigate to="/coupons" replace />;
  }

  return <CouponForm couponId={id} />;
}

function BannerEditRoute() {
  const { id } = useParams();

  if (!id || id === "undefined" || id === "null") {
    return <Navigate to="/banners" replace />;
  }

  return <BannerForm bannerId={id} />;
}

// Common props for a permission-gated admin section.
function adminGuard(
  permission,
  permissionLabel,
  component
) {
  return (
    <PermissionRoute
      permission={permission}
      permissionLabel={permissionLabel}
    >
      <AdminLayout>{component}</AdminLayout>
    </PermissionRoute>
  );
}

export default function App() {
  return (
    <Routes>
        <Route path="/store" element={<Storefront />} />
      {/* Root → Login if logged out */}
      <Route
        path="/"
        element={
          <PublicRoute>
            <Login />
          </PublicRoute>
        }
      />

      {/* /login → Login if logged out */}
      <Route
        path="/login"
        element={
          <PublicRoute>
            <Login />
          </PublicRoute>
        }
      />

      {/* /register → Register if logged out */}
      <Route
        path="/register"
        element={
          <PublicRoute>
            <Register />
          </PublicRoute>
        }
      />

      {/* /forgot-password → ForgotPassword if logged out */}
      <Route
        path="/forgot-password"
        element={
          <PublicRoute>
            <ForgotPassword />
          </PublicRoute>
        }
      />

      <Route
        path="/reset-password"
        element={
          <PublicRoute>
            <ResetPassword />
          </PublicRoute>
        }
      />

      {/* Everything below requires login */}
      <Route
        element={
          <ProtectedRoute>
            <Outlet />
          </ProtectedRoute>
        }
      >
        {/* Dashboard */}
        <Route
          path="/dashboard"
          element={adminGuard("dashboard.view", "Dashboard", <Dashboard />)}
        />

        {/* Users */}
        <Route
          path="/users"
          element={adminGuard("users.view", "Users", <Users />)}
        />
        <Route
          path="/users/new"
          element={adminGuard("users.create", "Create Users", <UserForm />)}
        />
        <Route
          path="/users/:id"
          element={adminGuard("users.view", "Users", <UserView />)}
        />
        <Route
          path="/users/:id/edit"
          element={
            adminGuard("users.update", "Update Users", <UserEditRoute />)
          }
        />

        {/* Roles */}
        <Route
          path="/roles"
          element={adminGuard("roles.view", "Roles", <Roles />)}
        />
        <Route
          path="/roles/new"
          element={adminGuard("roles.create", "Create Roles", <RoleForm />)}
        />
        <Route
          path="/roles/:id/edit"
          element={adminGuard("roles.update", "Update Roles", <RoleEditRoute />)}
        />

        {/* Email templates */}
        <Route
          path="/email-templates"
          element={
            adminGuard("email_templates.view", "Email Templates", <EmailTemplates />)
          }
        />
        <Route
          path="/email-templates/:id/edit"
          element={
            adminGuard(
              "email_templates.update",
              "Update Email Templates",
              <EmailTemplateEditRoute />
            )
          }
        />

        {/* Products */}
        <Route
          path="/products"
          element={adminGuard("products.view", "Products", <Products />)}
        />
        <Route
          path="/products/new"
          element={adminGuard("products.create", "Create Products", <ProductForm />)}
        />
        <Route
          path="/products/:id"
          element={adminGuard("products.view", "Products", <ProductView />)}
        />
        <Route
          path="/products/:id/edit"
          element={
            adminGuard("products.update", "Update Products", <ProductEditRoute />)
          }
        />

        {/* Inventory */}
        <Route
          path="/inventory"
          element={adminGuard("products.view", "Products", <Inventory />)}
        />

        {/* Orders */}
        <Route
          path="/orders"
          element={adminGuard("orders.view", "Orders", <Orders />)}
        />
        <Route
          path="/orders/:id"
          element={adminGuard("orders.view", "Orders", <OrderView />)}
        />

        {/* Customers */}
        <Route
          path="/customers"
          element={adminGuard("customers.view", "Customers", <Customers />)}
        />
        <Route
          path="/customers/:id"
          element={adminGuard("customers.view", "Customers", <CustomerView />)}
        />

        {/* Categories */}
        <Route
          path="/categories"
          element={adminGuard("categories.view", "Categories", <Categories />)}
        />
        <Route
          path="/categories/new"
          element={
            adminGuard("categories.create", "Create Categories", <CategoriesForm />)
          }
        />
        <Route
          path="/categories/:id"
          element={adminGuard("categories.view", "Categories", <CategoryView />)}
        />
        <Route
          path="/categories/:id/edit"
          element={
            adminGuard("categories.update", "Update Categories", <CategoryEditRoute />)
          }
        />

        {/* Sub categories */}
        <Route
          path="/sub-categories"
          element={
            adminGuard("categories.view", "Categories", <SubCategories />)
          }
        />
        <Route
          path="/sub-categories/new"
          element={
            adminGuard(
              "categories.create",
              "Create Categories",
              <CategoriesForm subCategory />
            )
          }
        />
        <Route
          path="/sub-categories/:id"
          element={
            adminGuard("categories.view", "Categories", <CategoryView subCategory />)
          }
        />
        <Route
          path="/sub-categories/:id/edit"
          element={
            adminGuard(
              "categories.update",
              "Update Categories",
              <SubCategoryEditRoute />
            )
          }
        />

        {/* Brands */}
        <Route
          path="/brands"
          element={adminGuard("brands.view", "Brands", <Brands />)}
        />
        <Route
          path="/brands/new"
          element={adminGuard("brands.create", "Create Brands", <BrandForm />)}
        />
        <Route
          path="/brands/:id"
          element={adminGuard("brands.view", "Brands", <BrandView />)}
        />
        <Route
          path="/brands/:id/edit"
          element={
            adminGuard("brands.update", "Update Brands", <BrandEditRoute />)
          }
        />

        {/* Attributes */}
        <Route
          path="/attributes"
          element={adminGuard("attributes.view", "Attributes", <Attributes />)}
        />
        <Route
          path="/attributes/new"
          element={
            adminGuard("attributes.create", "Create Attributes", <AttributeForm />)
          }
        />
        <Route
          path="/attributes/:id"
          element={adminGuard("attributes.view", "Attributes", <AttributeView />)}
        />
        <Route
          path="/attributes/:id/edit"
          element={
            adminGuard("attributes.update", "Update Attributes", <AttributeEditRoute />)
          }
        />

        {/* Coupons */}
        <Route
          path="/coupons"
          element={adminGuard("coupons.view", "Coupons", <Coupons />)}
        />
        <Route
          path="/coupons/new"
          element={adminGuard("coupons.create", "Create Coupons", <CouponForm />)}
        />
        <Route
          path="/coupons/:id"
          element={adminGuard("coupons.view", "Coupons", <CouponView />)}
        />
        <Route
          path="/coupons/:id/edit"
          element={
            adminGuard("coupons.update", "Update Coupons", <CouponEditRoute />)
          }
        />

        {/* Reviews */}
        <Route
          path="/reviews"
          element={adminGuard("reviews.view", "Reviews", <Reviews />)}
        />

        {/* Banners */}
        <Route
          path="/banners"
          element={adminGuard("banners.view", "Banners", <Banners />)}
        />
        <Route
          path="/banners/new"
          element={adminGuard("banners.create", "Create Banners", <BannerForm />)}
        />
        <Route
          path="/banners/:id"
          element={adminGuard("banners.view", "Banners", <BannerView />)}
        />
        <Route
          path="/banners/:id/edit"
          element={
            adminGuard("banners.update", "Update Banners", <BannerEditRoute />)
          }
        />

        {/* Settings */}
        <Route
          path="/settings"
          element={adminGuard("settings.view", "Settings", <Settings />)}
        />
      </Route>

      {/* Unknown URL → root */}
      <Route
        path="*"
        element={<Navigate to="/" replace />}
      />
    </Routes>
  );
}