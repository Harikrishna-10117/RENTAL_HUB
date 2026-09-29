import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Boxes, Check, Eye, EyeOff, ShieldCheck, Sparkles } from 'lucide-react';
import { useAuth, userRole } from '../context/AuthContext.jsx';
import { getErrorMessage } from '../lib/api.js';
import { FormField } from '../components/UI.jsx';
import { LanguageSelector, useLocale } from '../context/LocaleContext.jsx';

function AuthFrame({ title, description, children, mode }) {
  const { t } = useLocale();
  return <main className="auth-page"><div className="auth-decoration"><Link className="auth-brand" to="/"><span><Boxes size={20} /></span>rentalhub</Link><div className="auth-message"><span className="eyebrow">{t('homeKicker')}</span><h2>{t('authTitle')}</h2><p>{t('authDescription')}</p><div className="auth-proof"><span><ShieldCheck size={16} /> {t('authProof')}</span><span><Sparkles size={16} /> {t('authGear')}</span></div></div><span className="auth-decor-word">RENTALHUB</span></div>
    <div className="auth-content"><div className="auth-header-actions"><Link className="auth-back" to="/"><ArrowLeft size={15} /> {t('authBack')}</Link><LanguageSelector /></div><div className="auth-form-wrap"><span className="auth-mobile-brand"><Boxes size={18} /> rentalhub</span><span className="eyebrow">{t(mode === 'login' ? 'authWelcome' : 'authStart')}</span><h1>{title}</h1><p>{description}</p>{children}</div><span className="auth-footer">© {new Date().getFullYear()} RentalHub · {t('authFooter')}</span></div>
  </main>;
}

function goToRoleHome(user) {
  const role = userRole(user);
  return role === 'owner' ? '/owner/dashboard' : role === 'admin' ? '/admin/dashboard' : '/customer/dashboard';
}

export function LoginPage() {
  const { t } = useLocale();
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [values, setValues] = useState({ email: '', password: '' });
  if (user) return <Navigate to={goToRoleHome(user)} replace />;
  const update = (key) => (e) => setValues((current) => ({ ...current, [key]: e.target.value }));
  const submit = async (e) => { e.preventDefault(); setError(''); setSubmitting(true); try { const signedIn = await login(values); const destination = typeof location.state?.from === 'string' ? location.state.from : location.state?.from?.pathname; navigate(destination ?? goToRoleHome(signedIn), { replace: true }); } catch (err) { setError(getErrorMessage(err)); } finally { setSubmitting(false); } };
  return <AuthFrame mode="login" title={t('loginTitle')} description={t('loginDescription')}><form className="auth-form" onSubmit={submit}><FormField label={t('email')} type="email" autoComplete="email" placeholder={t('emailPlaceholder')} value={values.email} onChange={update('email')} required /><FormField label={t('password')} type={showPassword ? 'text' : 'password'} autoComplete="current-password" placeholder={t('passwordPlaceholder')} value={values.password} onChange={update('password')} required suffix={<button type="button" aria-label={t(showPassword ? 'hidePassword' : 'showPassword')} onClick={() => setShowPassword(!showPassword)}>{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button>} />{error && <div className="inline-error">{error}</div>}<button disabled={submitting} className="button button-dark button-full">{submitting ? t('signingIn') : t('login')} <ArrowRight size={16} /></button><div className="auth-divider"><span>{t('newToRentalHub')}</span></div><Link className="button button-outline button-full" to="/register">{t('createAccount')} <ArrowRight size={16} /></Link></form><p className="auth-legal">{t('legalAgree')} <Link to="/packages">{t('terms')}</Link> {t('and')} <Link to="/packages">{t('privacy')}</Link>.</p></AuthFrame>;
}

export function RegisterPage() {
  const { t } = useLocale();
  const { user, register } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [role, setRole] = useState(params.get('role') === 'owner' ? 'owner' : 'customer');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [values, setValues] = useState({ name: '', email: '', password: '' });
  if (user) return <Navigate to={goToRoleHome(user)} replace />;
  const update = (key) => (e) => setValues((current) => ({ ...current, [key]: e.target.value }));
  const submit = async (e) => {
    e.preventDefault(); setError(''); setSubmitting(true);
    try {
      const created = await register({ ...values, role });
      if (created) navigate(goToRoleHome(created), { replace: true });
      else navigate('/login', { replace: true, state: { message: 'Your account is ready. Sign in to continue.' } });
    } catch (err) { setError(getErrorMessage(err)); }
    finally { setSubmitting(false); }
  };
  return <AuthFrame mode="register" title={t('registerTitle')} description={t('registerDescription')}><div className="role-picker"><button type="button" onClick={() => setRole('customer')} className={role === 'customer' ? 'selected' : ''}><span className="role-radio">{role === 'customer' && <Check size={12} />}</span><span><b>{t('needEquipment')}</b><small>{t('joinCustomer')}</small></span></button><button type="button" onClick={() => setRole('owner')} className={role === 'owner' ? 'selected' : ''}><span className="role-radio">{role === 'owner' && <Check size={12} />}</span><span><b>{t('haveEquipment')}</b><small>{t('joinOwner')}</small></span></button></div><form className="auth-form register-form" onSubmit={submit}><FormField label={t('fullName')} autoComplete="name" placeholder={t('yourName')} value={values.name} onChange={update('name')} required /><FormField label={t('email')} type="email" autoComplete="email" placeholder={t('emailPlaceholder')} value={values.email} onChange={update('email')} required /><FormField label={t('password')} type={showPassword ? 'text' : 'password'} autoComplete="new-password" placeholder={t('passwordNewPlaceholder')} minLength={8} value={values.password} onChange={update('password')} required suffix={<button type="button" aria-label={t(showPassword ? 'hidePassword' : 'showPassword')} onClick={() => setShowPassword(!showPassword)}>{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button>} />{error && <div className="inline-error">{error}</div>}<button disabled={submitting} className="button button-dark button-full">{submitting ? t('creatingAccount') : t(role === 'owner' ? 'createOwnerAccount' : 'createCustomerAccount')} <ArrowRight size={16} /></button></form><p className="auth-bottom-note">{t('alreadyAccount')} <Link to="/login">{t('login')} <ArrowRight size={14} /></Link></p><p className="auth-legal">{t('legalCreate')} <Link to="/packages">{t('terms')}</Link> {t('and')} <Link to="/packages">{t('privacy')}</Link>.</p></AuthFrame>;
}
