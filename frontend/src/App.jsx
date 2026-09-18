import { Navigate, Route, Routes, useParams } from "react-router-dom";

import Login from "./pages/Login";
import Register from "./pages/Register";
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

export default function App() {
  return (
    <Routes>
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

      {/* Everything below requires login + shows the sidebar */}
      <Route
        element={
          <ProtectedRoute>
            <AdminLayout />
          </ProtectedRoute>
        }
      >
        {/* /dashboard → Dashboard */}
        <Route path="/dashboard" element={<Dashboard />} />

        {/* /users → User management */}
        <Route path="/users" element={<Users />} />
        <Route path="/users/new" element={<UserForm />} />
        <Route path="/users/:id" element={<UserView />} />
        <Route path="/users/:id/edit" element={<UserEditRoute />} />

        {/* /roles → Role management */}
        <Route path="/roles" element={<Roles />} />
        <Route path="/roles/new" element={<RoleForm />} />
        <Route path="/roles/:id/edit" element={<RoleEditRoute />} />

        {/* /email-templates → Email template management */}
        <Route
          path="/email-templates"
          element={<EmailTemplates />}
        />
        <Route
          path="/email-templates/:id/edit"
          element={<EmailTemplateEditRoute />}
        />

        {/* /products → Product listing + form */}
        <Route path="/products" element={<Products />} />
        <Route path="/products/new" element={<ProductForm />} />
        <Route path="/products/:id" element={<ProductView />} />
        <Route path="/products/:id/edit" element={<ProductEditRoute />} />

        {/* /inventory → Stock & price management */}
        <Route path="/inventory" element={<Inventory />} />

        {/* /orders → Order listing + detail */}
        <Route path="/orders" element={<Orders />} />
        <Route path="/orders/:id" element={<OrderView />} />

        {/* /customers → Customer management */}
        <Route path="/customers" element={<Customers />} />
        <Route path="/customers/:id" element={<CustomerView />} />

        {/* /categories → Category management */}
        <Route path="/categories" element={<Categories />} />
        <Route path="/categories/new" element={<CategoriesForm />} />
        <Route path="/categories/:id" element={<CategoryView />} />
        <Route path="/categories/:id/edit" element={<CategoryEditRoute />} />

        {/* /sub-categories → Sub category management */}
        <Route path="/sub-categories" element={<SubCategories />} />
        <Route
          path="/sub-categories/new"
          element={<CategoriesForm subCategory />}
        />
        <Route
          path="/sub-categories/:id"
          element={<CategoryView subCategory />}
        />
        <Route
          path="/sub-categories/:id/edit"
          element={<SubCategoryEditRoute />}
        />

        {/* /brands → Brand management */}
        <Route path="/brands" element={<Brands />} />
        <Route path="/brands/new" element={<BrandForm />} />
        <Route path="/brands/:id" element={<BrandView />} />
        <Route path="/brands/:id/edit" element={<BrandEditRoute />} />

        {/* /attributes → Attribute management */}
        <Route path="/attributes" element={<Attributes />} />
        <Route path="/attributes/new" element={<AttributeForm />} />
        <Route path="/attributes/:id" element={<AttributeView />} />
        <Route path="/attributes/:id/edit" element={<AttributeEditRoute />} />

        {/* /coupons → Coupon management */}
        <Route path="/coupons" element={<Coupons />} />
        <Route path="/coupons/new" element={<CouponForm />} />
        <Route path="/coupons/:id" element={<CouponView />} />
        <Route path="/coupons/:id/edit" element={<CouponEditRoute />} />

        {/* /reviews → Review moderation */}
        <Route path="/reviews" element={<Reviews />} />

        {/* /banners → Banner management */}
        <Route path="/banners" element={<Banners />} />
        <Route path="/banners/new" element={<BannerForm />} />
        <Route path="/banners/:id" element={<BannerView />} />
        <Route path="/banners/:id/edit" element={<BannerEditRoute />} />

        {/* /settings → Global settings + theme */}
        <Route path="/settings" element={<Settings />} />
      </Route>

      {/* Unknown URL → root */}
      <Route
        path="*"
        element={<Navigate to="/" replace />}
      />
    </Routes>
  );
}