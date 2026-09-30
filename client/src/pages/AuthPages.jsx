import { useEffect, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Boxes, Eye, EyeOff, ShieldCheck, Sparkles } from 'lucide-react';
import { useAuth, userRole } from '../context/AuthContext.jsx';
import { api, asList, getErrorMessage } from '../services/api.js';
import { EmptyState, FormField, PageHeading, StatusBadge } from '../components/UI.jsx';
import { LanguageSelector, useLocale } from '../context/LocaleContext.jsx';

const registerableRoles = ['customer', 'owner', 'transporter'];

function AuthFrame({ title, description, children, mode }) {
  const { t } = useLocale();
  return <main className="auth-page"><div className="auth-decoration"><Link className="auth-brand" to="/"><span><Boxes size={20} /></span>rentalhub</Link><div className="auth-message"><span className="eyebrow">{t('homeKicker')}</span><h2>{t('authTitle')}</h2><p>{t('authDescription')}</p><div className="auth-proof"><span><ShieldCheck size={16} /> {t('authProof')}</span><span><Sparkles size={16} /> {t('authGear')}</span></div></div><span className="auth-decor-word">RENTALHUB</span></div>
    <div className="auth-content"><div className="auth-header-actions"><Link className="auth-back" to="/"><ArrowLeft size={15} /> {t('authBack')}</Link><LanguageSelector /></div><div className="auth-form-wrap"><span className="auth-mobile-brand"><Boxes size={18} /> rentalhub</span><span className="eyebrow">{t(mode === 'login' ? 'authWelcome' : 'authStart')}</span><h1>{title}</h1><p>{description}</p>{children}</div><span className="auth-footer">© {new Date().getFullYear()} RentalHub · {t('authFooter')}</span></div>
  </main>;
}

function goToRoleHome(user) {
  const role = userRole(user);
  if (role === 'owner') return '/owner/dashboard';
  if (role === 'admin') return '/admin/dashboard';
  if (role === 'transporter' || role === 'inspector') return '/transporter/dashboard';
  return '/customer/dashboard';
}

function roleLabel(role, t) {
  return t(`role${role[0].toUpperCase()}${role.slice(1)}`);
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
  const submit = async (e) => {
    e.preventDefault(); setError(''); setSubmitting(true);
    try {
      const signedIn = await login(values);
      const destination = typeof location.state?.from === 'string' ? location.state.from : location.state?.from?.pathname;
      navigate(destination ?? goToRoleHome(signedIn), { replace: true });
    } catch (err) { setError(getErrorMessage(err)); }
    finally { setSubmitting(false); }
  };
  return <AuthFrame mode="login" title={t('loginTitle')} description={t('loginDescription')}>
    {location.state?.message && <div className="inline-error page-notice" role="alert">{location.state.message}</div>}
    <form className="auth-form" onSubmit={submit}>
      <FormField label={t('email')} type="email" autoComplete="email" placeholder={t('emailPlaceholder')} value={values.email} onChange={update('email')} required />
      <FormField label={t('password')} type={showPassword ? 'text' : 'password'} autoComplete="current-password" placeholder={t('passwordPlaceholder')} value={values.password} onChange={update('password')} required suffix={<button type="button" aria-label={t(showPassword ? 'hidePassword' : 'showPassword')} onClick={() => setShowPassword(!showPassword)}>{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button>} />
      <Link className="auth-bottom-note" to="/forgot-password">{t('forgotPassword')}</Link>
      {error && <div className="inline-error" role="alert">{error}</div>}
      <button disabled={submitting} className="button button-dark button-full">{submitting ? t('signingIn') : t('login')} <ArrowRight size={16} /></button>
      <div className="auth-divider"><span>{t('newToRentalHub')}</span></div>
      <Link className="button button-outline button-full" to="/register">{t('createAccount')} <ArrowRight size={16} /></Link>
    </form>
    <p className="auth-legal">{t('legalAgree')} <Link to="/packages">{t('terms')}</Link> {t('and')} <Link to="/packages">{t('privacy')}</Link>.</p>
  </AuthFrame>;
}

export function ForgotPasswordPage() {
  const { t } = useLocale();
  const { user } = useAuth();
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  if (user) return <Navigate to={goToRoleHome(user)} replace />;
  const submit = async (event) => {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await api.post('/auth/forgot-password', { email });
      setSent(true);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };
  return <AuthFrame mode="login" title={t('forgotPasswordTitle')} description={t('forgotPasswordDescription')}>
    {sent ? <div className="inline-success" role="status">{t('resetEmailSent')}</div> : <form className="auth-form" onSubmit={submit}>
      <FormField label={t('email')} type="email" autoComplete="email" placeholder={t('emailPlaceholder')} value={email} onChange={(event) => setEmail(event.target.value)} required />
      {error && <div className="inline-error" role="alert">{error}</div>}
      <button disabled={submitting} className="button button-dark button-full">{submitting ? t('sendingResetLink') : t('sendResetLink')} <ArrowRight size={16} /></button>
    </form>}
    <p className="auth-bottom-note"><Link to="/login">{t('login')}</Link></p>
  </AuthFrame>;
}

export function ResetPasswordPage() {
  const { t } = useLocale();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  if (user) return <Navigate to={goToRoleHome(user)} replace />;
  const submit = async (event) => {
    event.preventDefault();
    setError('');
    if (password !== confirmPassword) {
      setError(t('passwordsDoNotMatch'));
      return;
    }
    setSubmitting(true);
    try {
      await api.post('/auth/reset-password', { token, newPassword: password });
      navigate('/login', { replace: true, state: { message: t('passwordResetDone') } });
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };
  return <AuthFrame mode="login" title={t('resetPasswordTitle')} description={t('resetPasswordDescription')}>
    {!token ? <div className="inline-error" role="alert">{t('invalidResetLink')}</div> : <form className="auth-form" onSubmit={submit}>
      <FormField label={t('newPassword')} type="password" autoComplete="new-password" minLength={8} maxLength={72} value={password} onChange={(event) => setPassword(event.target.value)} required />
      <FormField label={t('confirmPassword')} type="password" autoComplete="new-password" minLength={8} maxLength={72} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required />
      {error && <div className="inline-error" role="alert">{error}</div>}
      <button disabled={submitting} className="button button-dark button-full">{submitting ? t('resettingPassword') : t('resetPassword')} <ArrowRight size={16} /></button>
    </form>}
  </AuthFrame>;
}

export function RegisterPage() {
  const { t, locale } = useLocale();
  const { user, register } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const requestedRole = params.get('role')?.toLowerCase();
  const [role, setRole] = useState(registerableRoles.includes(requestedRole) ? requestedRole : 'customer');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [otpChallengeId, setOtpChallengeId] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [otpSending, setOtpSending] = useState(false);
  const [otpVerifying, setOtpVerifying] = useState(false);
  const [phoneVerified, setPhoneVerified] = useState(false);
  const [developmentCode, setDevelopmentCode] = useState('');
  const [otpError, setOtpError] = useState('');
  const [error, setError] = useState('');
  const [values, setValues] = useState({ name: '', email: '', phone: '', password: '' });
  if (user) return <Navigate to={goToRoleHome(user)} replace />;
  const update = (key) => (e) => setValues((current) => ({ ...current, [key]: e.target.value }));
  const updatePhone = (event) => {
    setValues((current) => ({ ...current, phone: event.target.value }));
    setOtpChallengeId('');
    setOtpCode('');
    setPhoneVerified(false);
    setDevelopmentCode('');
    setOtpError('');
  };
  const requestPhoneOtp = async () => {
    setOtpError('');
    setOtpSending(true);
    try {
      const response = await api.post('/auth/phone/otp/request', { phone: values.phone, purpose: 'registration' });
      const result = response.data?.data;
      if (!result?.challengeId) {
        setOtpError(t('otpRequestFailed'));
        return;
      }
      setOtpChallengeId(result.challengeId);
      setDevelopmentCode(result.developmentCode || '');
    } catch (err) {
      setOtpError(getErrorMessage(err));
    } finally {
      setOtpSending(false);
    }
  };
  const verifyPhoneOtp = async () => {
    setOtpError('');
    setOtpVerifying(true);
    try {
      await api.post('/auth/phone/otp/verify', {
        phone: values.phone,
        challengeId: otpChallengeId,
        code: otpCode
      });
      setPhoneVerified(true);
    } catch (err) {
      setOtpError(getErrorMessage(err));
    } finally {
      setOtpVerifying(false);
    }
  };
  const submit = async (e) => {
    e.preventDefault(); setError(''); setSubmitting(true);
    if (values.phone && (!phoneVerified || !otpChallengeId)) {
      setError(t('verifyPhoneBeforeRegistration'));
      setSubmitting(false);
      return;
    }
    try {
      const created = await register({
        ...values,
        role,
        preferredLanguage: locale,
        ...(values.phone ? { phoneOtpChallengeId: otpChallengeId } : {})
      });
      if (created) navigate(goToRoleHome(created), { replace: true });
      else navigate('/login', { replace: true, state: { message: 'Your account is ready. Sign in to continue.' } });
    } catch (err) { setError(getErrorMessage(err)); }
    finally { setSubmitting(false); }
  };

  return <AuthFrame mode="register" title={t('registerTitle')} description={t('registerDescription')}>
    <form className="auth-form register-form" onSubmit={submit}>
      <FormField label={t('fullName')} autoComplete="name" placeholder={t('yourName')} value={values.name} onChange={update('name')} required maxLength={100} />
      <FormField label={t('email')} type="email" autoComplete="email" placeholder={t('emailPlaceholder')} value={values.email} onChange={update('email')} required />
      <FormField label={t('phone')} type="tel" inputMode="tel" autoComplete="tel" placeholder={t('phonePlaceholder')} value={values.phone} onChange={updatePhone} />
      {values.phone && <div className="form-span-2">
        {!otpChallengeId && <button type="button" className="button button-outline button-small" onClick={requestPhoneOtp} disabled={otpSending}>
          {otpSending ? t('sendingOtp') : t('requestOtp')}
        </button>}
        {otpChallengeId && !phoneVerified && <div className="auth-form">
          {developmentCode && <div className="inline-success" role="status">{t('developmentOtpNotice')} <strong>{developmentCode}</strong></div>}
          <FormField label={t('enterOtp')} inputMode="numeric" autoComplete="one-time-code" value={otpCode} onChange={(event) => setOtpCode(event.target.value)} required pattern="[0-9]{6}" />
          <button type="button" className="button button-outline button-small" onClick={verifyPhoneOtp} disabled={otpVerifying || !otpCode}>
            {otpVerifying ? t('verifyingOtp') : t('verifyOtp')}
          </button>
        </div>}
        {phoneVerified && <div className="inline-success" role="status">{t('phoneVerified')}</div>}
        {otpError && <div className="inline-error" role="alert">{otpError}</div>}
      </div>}
      <FormField label={t('role')} as="select" value={role} onChange={(event) => setRole(event.target.value)}>
        {registerableRoles.map((option) => <option key={option} value={option}>{roleLabel(option, t)}</option>)}
      </FormField>
      <FormField label={t('password')} type={showPassword ? 'text' : 'password'} autoComplete="new-password" placeholder={t('passwordNewPlaceholder')} minLength={8} maxLength={72} value={values.password} onChange={update('password')} required suffix={<button type="button" aria-label={t(showPassword ? 'hidePassword' : 'showPassword')} onClick={() => setShowPassword(!showPassword)}>{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button>} />
      {error && <div className="inline-error" role="alert">{error}</div>}
      <button disabled={submitting} className="button button-dark button-full">{submitting ? t('creatingAccount') : t('createRoleAccount', { role: roleLabel(role, t).toLowerCase() })} <ArrowRight size={16} /></button>
    </form>
    <p className="auth-bottom-note">{t('alreadyAccount')} <Link to="/login">{t('login')} <ArrowRight size={14} /></Link></p>
    <p className="auth-legal">{t('legalCreate')} <Link to="/packages">{t('terms')}</Link> {t('and')} <Link to="/packages">{t('privacy')}</Link>.</p>
  </AuthFrame>;
}

export function RoleWorkspacePage({ role }) {
  const { t } = useLocale();
  const label = roleLabel(role, t);
  const [deliveries, setDeliveries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actioning, setActioning] = useState('');
  const [inspectionDelivery, setInspectionDelivery] = useState('');
  const [inspection, setInspection] = useState({
    overallCondition: 'GOOD',
    scratches: '',
    dents: '',
    cracks: '',
    missingComponents: '',
    existingDamage: '',
    meterReading: '',
    notes: '',
    photoUrl: ''
  });

  useEffect(() => {
    if (role !== 'transporter') return undefined;
    let mounted = true;
    const fetchDeliveries = async () => {
      setLoading(true);
      setError('');
      try {
        const response = await api.get('/deliveries');
        const items = await Promise.all(asList(response.data).map(async (delivery) => {
          try {
            const detail = await api.get(`/deliveries/${delivery._id}`);
            return { ...delivery, conditionReport: detail.data.data.conditionReport };
          } catch {
            return delivery;
          }
        }));
        if (mounted) setDeliveries(items);
      } catch (err) {
        if (mounted) setError(getErrorMessage(err));
      } finally {
        if (mounted) setLoading(false);
      }
    };
    fetchDeliveries();
    return () => { mounted = false; };
  }, [role]);

  const refreshDeliveries = async () => {
    const response = await api.get('/deliveries');
    const items = await Promise.all(asList(response.data).map(async (delivery) => {
      try {
        const detail = await api.get(`/deliveries/${delivery._id}`);
        return { ...delivery, conditionReport: detail.data.data.conditionReport };
      } catch {
        return delivery;
      }
    }));
    setDeliveries(items);
  };

  const advanceDelivery = async (delivery) => {
    const status = delivery.status || 'ASSIGNED';
    const nextStatus = {
      ASSIGNED: 'ACCEPTED',
      ACCEPTED: 'PICKUP_PENDING',
      PICKUP_PENDING: 'PICKED_UP',
      PICKED_UP: 'IN_TRANSIT',
      IN_TRANSIT: 'ARRIVED',
      ARRIVED: 'CONDITION_CHECK',
      RETURN_ASSIGNED: 'RETURN_PICKUP_PENDING',
      RETURN_PICKUP_PENDING: 'RETURN_PICKED_UP',
      RETURN_PICKED_UP: 'RETURN_IN_TRANSIT',
      RETURN_IN_TRANSIT: 'RETURN_ARRIVED',
      RETURN_ARRIVED: 'RETURN_INSPECTION'
    }[status];
    if (!nextStatus) return;
    setActioning(delivery._id);
    try {
      await api.patch(`/deliveries/${delivery._id}/status`, { status: nextStatus });
      await refreshDeliveries();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setActioning('');
    }
  };

  const recordInspection = async (event, deliveryId) => {
    event.preventDefault();
    setActioning(deliveryId);
    setError('');
    const delivery = deliveries.find((item) => item._id === deliveryId);
    const nextStatus = delivery?.status === 'RETURN_INSPECTION' ? 'RETURN_COMPLETED' : 'HANDOVER_PENDING';
    try {
      await api.post(`/deliveries/${deliveryId}/condition-report`, {
        overallCondition: inspection.overallCondition,
        checklist: {
          scratches: inspection.scratches,
          dents: inspection.dents,
          cracks: inspection.cracks,
          missingComponents: inspection.missingComponents,
          existingDamage: inspection.existingDamage,
          meterReading: inspection.meterReading,
          notes: inspection.notes
        },
        existingDamage: inspection.existingDamage,
        missingComponents: inspection.missingComponents ? inspection.missingComponents.split(',').map((item) => item.trim()).filter(Boolean) : [],
        notes: inspection.notes,
        photos: inspection.photoUrl ? [{ type: 'inspection', category: 'delivery', url: inspection.photoUrl }] : []
      });
      await api.patch(`/deliveries/${deliveryId}/status`, { status: nextStatus });
      setInspectionDelivery('');
      setInspection({ overallCondition: 'GOOD', scratches: '', dents: '', cracks: '', missingComponents: '', existingDamage: '', meterReading: '', notes: '', photoUrl: '' });
      await refreshDeliveries();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setActioning('');
    }
  };

  const completeInspection = async (delivery) => {
    setActioning(delivery._id);
    setError('');
    const nextStatus = delivery.status === 'RETURN_INSPECTION' ? 'RETURN_COMPLETED' : 'HANDOVER_PENDING';
    try {
      await api.patch(`/deliveries/${delivery._id}/status`, { status: nextStatus });
      await refreshDeliveries();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setActioning('');
    }
  };

  if (role !== 'transporter') {
    return <main className="section">
      <PageHeading eyebrow="RENTALHUB" title={t('roleWorkspaceTitle', { role: label })} description={t('roleWorkspaceDescription', { role: label.toLowerCase() })} />
      <EmptyState title={t('roleWorkspaceTitle', { role: label })} message={t('roleWorkspaceDescription', { role: label.toLowerCase() })} action={<Link className="button button-outline button-small" to="/">{t('authBack')}</Link>} />
    </main>;
  }

  return <main className="section">
    <PageHeading eyebrow="TRANSPORTER" title="Delivery inspection dashboard" description="Manage pickup and delivery steps, inspect equipment condition, and record return checks for your assigned jobs." />
    {error && <div className="inline-error" role="alert">{error}</div>}
    {loading ? <div className="state-panel"><span>Loading assigned deliveries…</span></div> : deliveries.length === 0 ? (
      <EmptyState title="No deliveries assigned" message="New pickup and handover assignments will appear here when they are scheduled." action={<Link className="button button-outline button-small" to="/">{t('authBack')}</Link>} />
    ) : (
      <div className="card-grid">
        {deliveries.map((delivery) => {
          const equipment = delivery.equipment || {};
          const customer = delivery.customer || {};
          const status = delivery.status || 'ASSIGNED';
          const nextStatus = {
            ASSIGNED: 'ACCEPTED', ACCEPTED: 'PICKUP_PENDING', PICKUP_PENDING: 'PICKED_UP',
            PICKED_UP: 'IN_TRANSIT', IN_TRANSIT: 'ARRIVED', ARRIVED: 'CONDITION_CHECK',
            RETURN_ASSIGNED: 'RETURN_PICKUP_PENDING', RETURN_PICKUP_PENDING: 'RETURN_PICKED_UP',
            RETURN_PICKED_UP: 'RETURN_IN_TRANSIT', RETURN_IN_TRANSIT: 'RETURN_ARRIVED',
            RETURN_ARRIVED: 'RETURN_INSPECTION'
          }[status];
          const inspectionStage = ['CONDITION_CHECK', 'RETURN_INSPECTION'].includes(status);
          const awaitingCustomer = status === 'HANDOVER_PENDING';
          const inspectionFormOpen = inspectionDelivery === delivery._id;
          return <article key={delivery._id} className="panel-card booking-card">
            <div className="booking-header">
              <div>
                <span className="eyebrow">{equipment.name || 'Equipment delivery'}</span>
                <h3>{customer.name || 'Customer'}</h3>
              </div>
              <StatusBadge>{status}</StatusBadge>
            </div>
            <div className="meta-list">
              <div><strong>Address</strong><span>{delivery.address || 'Delivery location pending'}</span></div>
              <div><strong>Status</strong><span>{status}</span></div>
              <div><strong>Rental</strong><span>{delivery.rental?._id || delivery.rental || 'Linked booking'}</span></div>
            </div>
            <div className="card-actions">
              {nextStatus && (
                <button className="button button-dark button-small" disabled={actioning === delivery._id} onClick={() => advanceDelivery(delivery)}>
                  {actioning === delivery._id ? 'Updating…' : status === 'ARRIVED' || status === 'RETURN_ARRIVED' ? 'Start inspection' : `Mark ${nextStatus.replaceAll('_', ' ').toLowerCase()}`}
                </button>
              )}
              {inspectionStage && !delivery.conditionReport && !inspectionFormOpen && (
                <button className="button button-outline button-small" onClick={() => setInspectionDelivery(delivery._id)}>Open condition checklist</button>
              )}
              {inspectionStage && delivery.conditionReport && (
                <button className="button button-outline button-small" disabled={actioning === delivery._id} onClick={() => completeInspection(delivery)}>
                  {actioning === delivery._id ? 'Updating…' : status === 'RETURN_INSPECTION' ? 'Complete return inspection' : 'Send to handover'}
                </button>
              )}
              {awaitingCustomer && <span className="muted-copy">Condition recorded. Awaiting customer handover acknowledgement.</span>}
            </div>
            {delivery.conditionReport && <p className="muted-copy">Inspection recorded: {delivery.conditionReport.overallCondition || delivery.conditionReport.conditionStatus}</p>}
            {inspectionFormOpen && inspectionStage && <form className="auth-form" onSubmit={(event) => recordInspection(event, delivery._id)}>
              <FormField label="Overall condition" as="select" value={inspection.overallCondition} onChange={(event) => setInspection((current) => ({ ...current, overallCondition: event.target.value }))}>
                {['EXCELLENT', 'GOOD', 'FAIR', 'DAMAGED', 'CRITICAL'].map((condition) => <option key={condition} value={condition}>{condition}</option>)}
              </FormField>
              <FormField label="Scratches" as="textarea" value={inspection.scratches} onChange={(event) => setInspection((current) => ({ ...current, scratches: event.target.value }))} maxLength={500} />
              <FormField label="Dents" as="textarea" value={inspection.dents} onChange={(event) => setInspection((current) => ({ ...current, dents: event.target.value }))} maxLength={500} />
              <FormField label="Cracks or broken components" as="textarea" value={inspection.cracks} onChange={(event) => setInspection((current) => ({ ...current, cracks: event.target.value }))} maxLength={500} />
              <FormField label="Missing components (comma-separated)" value={inspection.missingComponents} onChange={(event) => setInspection((current) => ({ ...current, missingComponents: event.target.value }))} maxLength={500} />
              <FormField label="Existing damage" as="textarea" value={inspection.existingDamage} onChange={(event) => setInspection((current) => ({ ...current, existingDamage: event.target.value }))} maxLength={1000} />
              <FormField label="Meter reading" value={inspection.meterReading} onChange={(event) => setInspection((current) => ({ ...current, meterReading: event.target.value }))} maxLength={100} />
              <FormField label="Photo evidence URL (optional)" type="url" value={inspection.photoUrl} onChange={(event) => setInspection((current) => ({ ...current, photoUrl: event.target.value }))} placeholder="https://..." />
              <FormField label="Inspection notes" as="textarea" value={inspection.notes} onChange={(event) => setInspection((current) => ({ ...current, notes: event.target.value }))} maxLength={2000} />
              <div className="card-actions">
                <button className="button button-dark button-small" disabled={actioning === delivery._id}>{actioning === delivery._id ? 'Saving…' : 'Save inspection'}</button>
                <button type="button" className="button button-outline button-small" onClick={() => setInspectionDelivery('')}>Cancel</button>
              </div>
            </form>}
          </article>;
        })}
      </div>
    )}
  </main>;
}
