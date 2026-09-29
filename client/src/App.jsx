import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth, userRole } from './context/AuthContext.jsx';
import { AppShell, PublicLayout } from './components/AppShell.jsx';
import { Loading } from './components/UI.jsx';
import { HomePage, SearchPage, EquipmentDetailPage, PackagesPage } from './pages/PublicPages.jsx';
import { LoginPage, RegisterPage } from './pages/AuthPages.jsx';
import { CustomerDashboard, CustomerBookings, CustomerSwaps, CustomerPayments, CustomerProfile } from './pages/CustomerPages.jsx';
import { OwnerDashboard, OwnerEquipment, EquipmentForm, OwnerBookings, OwnerSwaps } from './pages/OwnerPages.jsx';
import { AdminDashboard, OwnerVerification, CategoriesPage } from './pages/AdminPages.jsx';
import { useLocale } from './context/LocaleContext.jsx';

function Protected({ roles, children }) {
  const { user, loading } = useAuth();
  const { t } = useLocale();
  const location = useLocation();
  if (loading) return <Loading label={t('loadingWorkspace')} />;
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;
  if (!roles.includes(userRole(user))) return <Navigate to={userRole(user) === 'owner' ? '/owner/dashboard' : userRole(user) === 'admin' ? '/admin/dashboard' : '/customer/dashboard'} replace />;
  return children;
}

function Portal({ role, children }) {
  return <Protected roles={[role]}><AppShell /></Protected>;
}

function RoleRedirect() {
  const { user } = useAuth();
  const role = userRole(user);
  return <Navigate to={role === 'owner' ? '/owner/dashboard' : role === 'admin' ? '/admin/dashboard' : '/customer/dashboard'} replace />;
}

export default function App() {
  const { loading } = useAuth();
  const { t } = useLocale();
  if (loading) return <div className="initial-loader"><Loading label={t('loadingWorkspace')} /></div>;
  return (
    <Routes>
      <Route element={<PublicLayout />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/equipment" element={<SearchPage />} />
        <Route path="/equipment/:id" element={<EquipmentDetailPage />} />
        <Route path="/packages" element={<PackagesPage />} />
      </Route>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/customer" element={<Protected roles={['customer']}><AppShell /></Protected>}>
        <Route index element={<Navigate to="dashboard" replace />} />
        <Route path="dashboard" element={<CustomerDashboard />} />
        <Route path="bookings" element={<CustomerBookings />} />
        <Route path="swaps" element={<CustomerSwaps />} />
        <Route path="payments" element={<CustomerPayments />} />
        <Route path="profile" element={<CustomerProfile />} />
      </Route>
      <Route path="/owner" element={<Protected roles={['owner']}><AppShell /></Protected>}>
        <Route index element={<Navigate to="dashboard" replace />} />
        <Route path="dashboard" element={<OwnerDashboard />} />
        <Route path="equipment" element={<OwnerEquipment />} />
        <Route path="equipment/new" element={<EquipmentForm />} />
        <Route path="equipment/:id/edit" element={<EquipmentForm />} />
        <Route path="bookings" element={<OwnerBookings />} />
        <Route path="swaps" element={<OwnerSwaps />} />
      </Route>
      <Route path="/admin" element={<Protected roles={['admin']}><AppShell /></Protected>}>
        <Route index element={<Navigate to="dashboard" replace />} />
        <Route path="dashboard" element={<AdminDashboard />} />
        <Route path="owners" element={<OwnerVerification />} />
        <Route path="categories" element={<CategoriesPage />} />
      </Route>
      <Route path="/dashboard" element={<RoleRedirect />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
