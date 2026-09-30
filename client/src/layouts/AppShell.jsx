import { useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Activity, AlertCircle, ArrowDownUp, Boxes, CalendarDays, ChevronDown, CircleUserRound, ClipboardCheck, CreditCard, LayoutDashboard, LogOut, Menu, Package, PackageOpen, Search, ShieldCheck, ShoppingCart, Sparkles, UserRound, Wrench, X } from 'lucide-react';
import { useAuth, userRole } from '../context/AuthContext.jsx';
import { LanguageSelector, useLocale } from '../context/LocaleContext.jsx';

const portalLinks = {
  customer: [
    { to: '/customer/dashboard', label: 'navOverview', icon: LayoutDashboard },
    { to: '/customer/bookings', label: 'navBookings', icon: CalendarDays },
    { to: '/customer/swaps', label: 'navSwaps', icon: ArrowDownUp },
    { to: '/customer/payments', label: 'navPayments', icon: CreditCard },
    { to: '/customer/cart', label: 'navCart', icon: ShoppingCart },
    { to: '/customer/returns', label: 'navReturns', icon: PackageOpen },
    { to: '/customer/disputes', label: 'navDisputes', icon: AlertCircle },
    { to: '/customer/profile', label: 'navProfile', icon: UserRound },
  ],
  owner: [
    { to: '/owner/dashboard', label: 'navOverview', icon: LayoutDashboard },
    { to: '/owner/profile', label: 'navProfile', icon: UserRound },
    { to: '/owner/equipment', label: 'navMyEquipment', icon: Boxes },
    { to: '/owner/packages', label: 'navPackages', icon: Package },
    { to: '/owner/returns', label: 'navReturns', icon: PackageOpen },
    { to: '/owner/disputes', label: 'navDisputes', icon: AlertCircle },
    { to: '/owner/maintenance', label: 'navMaintenance', icon: Wrench },
    { to: '/owner/analytics', label: 'navAnalytics', icon: Activity },
    { to: '/owner/bookings', label: 'navOwnerBookings', icon: CalendarDays },
    { to: '/owner/swaps', label: 'navSwapRequests', icon: ArrowDownUp },
  ],
  admin: [
    { to: '/admin/dashboard', label: 'navOverview', icon: LayoutDashboard },
    { to: '/admin/owners', label: 'navOwnerVerification', icon: ShieldCheck },
    { to: '/admin/categories', label: 'navCategories', icon: Package },
    { to: '/admin/catalog', label: 'navCatalogProducts', icon: PackageOpen },
    { to: '/admin/returns', label: 'navReturns', icon: ClipboardCheck },
    { to: '/admin/disputes', label: 'navDisputes', icon: AlertCircle },
  ],
  transporter: [
    { to: '/transporter/dashboard', label: 'navOverview', icon: LayoutDashboard },
    { to: '/transporter/profile', label: 'navProfile', icon: UserRound },
  ],
};

function roleHome(role) {
  if (role === 'owner') return '/owner/dashboard';
  if (role === 'admin') return '/admin/dashboard';
  if (role === 'transporter' || role === 'inspector') return '/transporter/dashboard';
  return '/customer/dashboard';
}

function profileHome(role) {
  if (role === 'owner') return '/owner/profile';
  if (role === 'transporter' || role === 'inspector') return '/transporter/profile';
  if (role === 'customer') return '/customer/profile';
  return roleHome(role);
}

function Brand({ light = false }) {
  return <Link to="/" className={`brand ${light ? 'brand-light' : ''}`}><span className="brand-mark"><Boxes size={19} /></span><span>rental<span>hub</span></span></Link>;
}

export function AppShell() {
  const { t } = useLocale();
  const { user, logout } = useAuth();
  const role = userRole(user);
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const links = portalLinks[role] ?? portalLinks.customer;
  const name = user?.name ?? user?.fullName ?? user?.email ?? 'Your account';
  const close = () => setMobileOpen(false);
  const signOut = async () => {
    try {
      await logout();
      navigate('/');
    } catch {
      navigate('/login', { state: { message: t('logoutRevokeFailed') }, replace: true });
    }
  };

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileOpen ? 'sidebar-open' : ''}`}>
        <div className="sidebar-top"><Brand light /><button className="icon-button sidebar-close" aria-label={t('closeMenu')} onClick={close}><X size={19} /></button></div>
        <div className="workspace-label">{t(role === 'owner' ? 'workspaceOwner' : role === 'admin' ? 'workspaceAdmin' : role === 'transporter' || role === 'inspector' ? 'workspaceTransporter' : 'workspaceCustomer')}</div>
        <nav className="sidebar-nav">
          {links.map(({ to, label, icon: Icon }) => <NavLink key={to} to={to} onClick={close} className={({ isActive }) => `side-link ${isActive ? 'active' : ''}`}><Icon size={18} /><span>{t(label)}</span></NavLink>)}
        </nav>
        <div className="sidebar-discover"><div className="discover-spark"><Sparkles size={17} /></div><strong>{t('discoverTitle')}</strong><p>{t('discoverBody')}</p><Link to="/equipment" onClick={close}>{t('browseMarketplace')} <span>↗</span></Link></div>
        <div className="sidebar-bottom">
          <NavLink to={profileHome(role)} className="account-card"><span className="avatar">{name.slice(0, 1).toUpperCase()}</span><span className="account-copy"><b>{name}</b><small>{role || 'customer'}</small></span><ChevronDown size={15} /></NavLink>
          <button className="side-link side-logout" onClick={signOut}><LogOut size={17} /><span>{t('navSignOut')}</span></button>
        </div>
      </aside>
      {mobileOpen && <button className="sidebar-backdrop" aria-label={t('closeNavigation')} onClick={close} />}
      <main className="workspace">
        <header className="workspace-topbar">
          <button className="icon-button mobile-menu" aria-label={t('openMenu')} onClick={() => setMobileOpen(true)}><Menu size={20} /></button>
          <div className="breadcrumb"><span>RentalHub</span><b>/</b><strong>{location.pathname.split('/').filter(Boolean).slice(-1)[0]?.replace(/-/g, ' ') || t('overview')}</strong></div>
          <div className="topbar-actions"><LanguageSelector /><Link to="/equipment" className="topbar-search"><Search size={16} /><span>{t('navFind')}</span></Link><Link to={profileHome(role)} className="avatar topbar-avatar" aria-label={name} title={t('navProfile')}>{name.slice(0, 1).toUpperCase()}</Link></div>
        </header>
        <div className="workspace-content"><Outlet /></div>
        <nav className="mobile-bottom-nav">
          {links.slice(0, 4).map(({ to, label, icon: Icon }) => <NavLink key={to} to={to} className={({ isActive }) => isActive ? 'mobile-nav-item active' : 'mobile-nav-item'}><Icon size={19} /><span>{t(label)}</span></NavLink>)}
        </nav>
      </main>
    </div>
  );
}

export function PublicHeader() {
  const { t } = useLocale();
  const { user } = useAuth();
  const role = userRole(user);
  const destination = roleHome(role);
  return <header className="public-header"><div className="public-header-inner"><Brand /><nav className="public-nav"><Link to="/equipment">{t('navExplore')}</Link><Link to="/packages">{t('navPackages')}</Link></nav><div className="public-header-actions"><LanguageSelector />{user ? <Link className="button button-dark button-small" to={destination}><CircleUserRound size={16} /> {t('navWorkspace')}</Link> : <><Link to="/login" className="login-link">{t('navLogin')}</Link><Link to="/register" className="button button-dark button-small">{t('navGetStarted')} <span>↗</span></Link></>}</div></div></header>;
}

export function PublicLayout() {
  const { t } = useLocale();
  return <><PublicHeader /><Outlet /><footer className="public-footer"><div><Brand /><p>{t('footerTagline')}</p></div><span>© {new Date().getFullYear()} RentalHub</span><Link to="/packages">{t('memberships')}</Link></footer></>;
}
