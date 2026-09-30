import { useEffect } from 'react';
import { CustomerDashboard, CustomerBookings, CustomerSwaps, CustomerPayments, CustomerProfile, OwnerProfile, RoleProfile, ReturnHistory, DisputeCenter } from './pages/CustomerPages.jsx';
import { CartPage } from './pages/CartPage.jsx';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth, userRole } from './context/AuthContext.jsx';
import { AppShell, PublicLayout } from './layouts/AppShell.jsx';
import { Loading } from './components/UI.jsx';
import { HomePage, SearchPage, EquipmentDetailPage, PackagesPage, CategoryPage } from './pages/PublicPages.jsx';
import { ForgotPasswordPage, LoginPage, RegisterPage, ResetPasswordPage, RoleWorkspacePage } from './pages/AuthPages.jsx';
import { OwnerDashboard, OwnerEquipment, EquipmentForm, OwnerPackagesPage, OwnerBookings, OwnerSwaps, OwnerEquipmentPassport, OwnerAnalyticsPage, OwnerMaintenancePage, OwnerReturns } from './pages/OwnerPages.jsx';
import { AdminDashboard, OwnerVerification, CategoriesPage, CatalogProductsPage } from './pages/AdminPages.jsx';
import { useLocale } from './context/LocaleContext.jsx';

function roleHome(role) {
  if (role === 'owner') return '/owner/dashboard';
  if (role === 'admin') return '/admin/dashboard';
  if (role === 'transporter' || role === 'inspector') return '/transporter/dashboard';
  return '/customer/dashboard';
}

function Protected({ roles, children }) {
  const { user, loading } = useAuth();
  const { t } = useLocale();
  const location = useLocation();
  if (loading) return <Loading label={t('loadingWorkspace')} />;
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;
  if (!roles.includes(userRole(user))) return <Navigate to={roleHome(userRole(user))} replace />;
  return children;
}

function Portal({ role, children }) {
  return <Protected roles={[role]}><AppShell /></Protected>;
}

function RoleRedirect() {
  const { user } = useAuth();
  return <Navigate to={roleHome(userRole(user))} replace />;
}

function ScrollToTop() {
  const { pathname } = useLocation();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return null;
}

export default function App() {
  const { loading } = useAuth();
  const { t } = useLocale();
  if (loading) return <div className="initial-loader"><Loading label={t('loadingWorkspace')} /></div>;
  return (
    <>
      <ScrollToTop />
      <Routes>
        <Route element={<PublicLayout />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/equipment" element={<SearchPage />} />
          <Route path="/equipment/:id" element={<EquipmentDetailPage />} />
          <Route path="/categories/:slug" element={<CategoryPage />} />
          <Route path="/packages" element={<PackagesPage />} />
        </Route>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/customer" element={<Protected roles={['customer']}><AppShell /></Protected>}>
          <Route index element={<Navigate to="dashboard" replace />} />
          <Route path="dashboard" element={<CustomerDashboard />} />
          <Route path="bookings" element={<CustomerBookings />} />
          <Route path="swaps" element={<CustomerSwaps />} />
          <Route path="payments" element={<CustomerPayments />} />
          <Route path="cart" element={<CartPage />} />
          <Route path="profile" element={<CustomerProfile />} />
          <Route path="returns" element={<OwnerReturns />} />
          <Route path="disputes" element={<DisputeCenter />} />
        </Route>
        <Route path="/owner" element={<Protected roles={['owner']}><AppShell /></Protected>}>
          <Route index element={<Navigate to="dashboard" replace />} />
          <Route path="dashboard" element={<OwnerDashboard />} />
          <Route path="profile" element={<OwnerProfile />} />
          <Route path="equipment" element={<OwnerEquipment />} />
          <Route path="packages" element={<OwnerPackagesPage />} />
          <Route path="equipment/new" element={<EquipmentForm />} />
          <Route path="equipment/:id/edit" element={<EquipmentForm />} />
          <Route path="equipment/:id/passport" element={<OwnerEquipmentPassport />} />
          <Route path="bookings" element={<OwnerBookings />} />
          <Route path="swaps" element={<OwnerSwaps />} />
          <Route path="returns" element={<ReturnHistory />} />
          <Route path="disputes" element={<DisputeCenter />} />
          <Route path="maintenance" element={<OwnerMaintenancePage />} />
          <Route path="analytics" element={<OwnerAnalyticsPage />} />
        </Route>
        <Route path="/admin" element={<Protected roles={['admin']}><AppShell /></Protected>}>
          <Route index element={<Navigate to="dashboard" replace />} />
          <Route path="dashboard" element={<AdminDashboard />} />
          <Route path="owners" element={<OwnerVerification />} />
          <Route path="categories" element={<CategoriesPage />} />
          <Route path="catalog" element={<CatalogProductsPage />} />
          <Route path="returns" element={<ReturnHistory />} />
          <Route path="disputes" element={<DisputeCenter />} />
        </Route>
        <Route path="/transporter" element={<Protected roles={['transporter']}><AppShell /></Protected>}>
          <Route index element={<Navigate to="dashboard" replace />} />
          <Route path="dashboard" element={<RoleWorkspacePage role="transporter" />} />
          <Route path="profile" element={<RoleProfile />} />
        </Route>
        <Route path="/dashboard" element={<RoleRedirect />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}
