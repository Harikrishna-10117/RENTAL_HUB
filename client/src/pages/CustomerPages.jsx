import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowDownUp, ArrowRight, CalendarDays, Check, Clock3, CreditCard, Package, Plus, ShieldCheck, WalletCards } from 'lucide-react';
import { api, asList, getErrorMessage, unwrap } from '../services/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useLoad } from '../hooks/useLoad.js';
import { EmptyState, ErrorState, FormField, Loading, PageHeading, StatusBadge } from '../components/UI.jsx';
import { useLocale } from '../context/LocaleContext.jsx';
import { formatIndianCurrency, formatIndianDate, formatIndianPhone } from '../utils/india.js';

function bookingTitle(booking, t = (key) => key) {
  return booking.equipment?.name ?? booking.equipment?.[0]?.name ?? booking.equipmentName ?? booking.item?.name ?? booking.title ?? t('equipment');
}
function bookingDate(booking, t) {
  const start = booking.startDate ?? booking.start_date;
  const end = booking.endDate ?? booking.end_date;
  if (!start) return t('datesToConfirm');
  return `${formatIndianDate(start, { month: 'short', day: 'numeric' })}${end ? ` – ${formatIndianDate(end, { month: 'short', day: 'numeric' })}` : ''}`;
}
function displayAmount(value, formatCurrency = formatIndianCurrency) {
  const amount = value?.amount ?? value?.totalAmount ?? value?.total ?? value?.price;
  return amount == null ? '—' : formatCurrency(amount);
}

let razorpayScriptPromise;
function loadRazorpayCheckout() {
  if (window.Razorpay) return Promise.resolve();
  if (!razorpayScriptPromise) {
    razorpayScriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://checkout.razorpay.com/v1/checkout.js';
      script.async = true;
      script.onload = resolve;
      script.onerror = () => {
        razorpayScriptPromise = null;
        reject(new Error('Secure checkout could not be loaded. Please try again.'));
      };
      document.head.appendChild(script);
    });
  }
  return razorpayScriptPromise;
}

export function CustomerDashboard() {
  const { t, formatCurrency } = useLocale();
  const { user } = useAuth();
  const { data, loading, error, reload } = useLoad('/bookings/my', { list: true });
  const bookings = data ?? [];
  const now = Date.now();
  const completed = bookings.filter((booking) => String(booking.status).toLowerCase() === 'completed');
  const inProgress = bookings.filter((booking) => String(booking.status).toLowerCase() === 'in_progress');
  const upcoming = bookings
    .filter((booking) => ['confirmed', 'approved'].includes(String(booking.status).toLowerCase()) &&
      booking.startDate && new Date(booking.startDate).getTime() >= now)
    .sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime());
  const nextBooking = upcoming[0];
  const greeting = (user?.name ?? user?.fullName ?? 'there').split(' ')[0];
  return <div className="customer-dashboard">
    <section className="dashboard-welcome">
      <div><h1>{t('greeting', { name: greeting })}</h1><p>{t('dashboardDescription')}</p></div>
      <Link className="button button-green" to="/equipment"><Plus size={17} /> {t('findEquipment')}</Link>
    </section>
    <div className="dashboard-stat-grid">
      <div className="dashboard-stat"><strong>{loading ? '—' : inProgress.length}</strong><span>{t('rentalsInProgress')}</span></div>
      <div className="dashboard-stat"><strong>{loading ? '—' : upcoming.length}</strong><span>{t('upcomingRentals')}</span></div>
      <div className="dashboard-stat"><strong>{loading ? '—' : completed.length}</strong><span>{t('completedRentals')}</span></div>
    </div>
    {!loading && !error && <section className={`next-rental ${nextBooking ? '' : 'next-rental-empty'}`}>
      <div className="next-rental-label"><CalendarDays size={17} /><span>{t('nextRental')}</span></div>
      {nextBooking
        ? <div className="next-rental-details">
          <div><h2>{bookingTitle(nextBooking, t)}</h2><p>{bookingDate(nextBooking, t)}</p></div>
          <div className="next-rental-meta"><StatusBadge>{nextBooking.status}</StatusBadge><strong>{displayAmount(nextBooking, formatCurrency)}</strong></div>
          <Link className="text-link" to="/customer/bookings">{t('viewBooking')} <ArrowRight size={15} /></Link>
        </div>
        : <div className="next-rental-details"><div><h2>{t('noUpcomingRentals')}</h2><p>{t('upcomingRentalHint')}</p></div><Link className="text-link" to="/equipment">{t('browseEquipment')} <ArrowRight size={15} /></Link></div>}
    </section>}
    <section className="dashboard-section"><div className="section-heading compact"><div><h2>{t('recentBookings')}</h2></div><Link className="text-link" to="/customer/bookings">{t('allBookings')} <ArrowRight size={15} /></Link></div>
      {loading ? <Loading label={t('loadingBookings')} /> : error ? <ErrorState message={error} onRetry={reload} /> : bookings.length ? <BookingsTable bookings={bookings.slice(0, 5)} /> : <EmptyState title={t('projectStarts')} message={t('dashboardEmpty')} action={<Link className="button button-green button-small" to="/equipment">{t('homeSearchAction')} <ArrowRight size={15} /></Link>} />}
    </section>
  </div>;
}

export function BookingsTable({ bookings, showOwner = false }) {
  const { t, formatCurrency } = useLocale();
  return <div className="table-wrap"><table className="data-table"><thead><tr><th>{t('equipment')}</th>{showOwner && <th>{t('customer')}</th>}<th>{t('dates')}</th><th>{t('status')}</th><th>{t('amount')}</th></tr></thead><tbody>{bookings.map((booking) => <tr key={booking.id ?? booking._id}><td><div className="table-main"><span className="table-thumb"><Package size={17} /></span><span><b>{bookingTitle(booking, t)}</b><small>{booking.owner?.name ? t('listedBy', { name: booking.owner.name }) : t('bookingNumber', { id: String(booking.id ?? booking._id ?? '').slice(-6) })}</small></span></div></td>{showOwner && <td>{booking.customer?.name ?? booking.customerName ?? booking.user?.name ?? t('customer')}</td>}<td>{bookingDate(booking, t)}</td><td><StatusBadge>{booking.status ?? 'pending'}</StatusBadge></td><td><b>{displayAmount(booking, formatCurrency)}</b></td></tr>)}</tbody></table></div>;
}

function RentalReviewForm({ booking, onComplete }) {
  const [rating, setRating] = useState('5');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  if (booking.review) return <span className="status-badge">Reviewed · {booking.review.rating}/5</span>;
  const submit = async (event) => {
    event.preventDefault();
    setBusy(true); setError(''); setNotice('');
    try {
      await api.post(`/bookings/${booking._id}/reviews`, { rating: Number(rating), comment });
      setNotice('Review submitted.');
      await onComplete();
    } catch (err) { setError(getErrorMessage(err)); }
    finally { setBusy(false); }
  };
  return <details className="rental-review-control"><summary className="button button-outline button-tiny">Leave review</summary>
    <form className="profile-form" onSubmit={submit}>
      <FormField as="select" label="Rating" value={rating} onChange={(event) => setRating(event.target.value)}>
        {[5, 4, 3, 2, 1].map((value) => <option key={value} value={value}>{value} / 5</option>)}
      </FormField>
      <FormField as="textarea" label="Review (optional)" rows="2" maxLength={2000} value={comment} onChange={(event) => setComment(event.target.value)} />
      {error && <div className="inline-error" role="alert">{error}</div>}
      {notice && <div className="inline-success" role="status">{notice}</div>}
      <button className="button button-green button-tiny" disabled={busy}>{busy ? 'Submitting…' : 'Submit review'}</button>
    </form>
  </details>;
}

export function CustomerBookings() {
  const { data, loading, error, reload } = useLoad('/bookings/my', { list: true });
  const [actionId, setActionId] = useState('');
  const [message, setMessage] = useState('');
  const [formError, setFormError] = useState('');
  const [swap, setSwap] = useState(null);
  const [swapType, setSwapType] = useState('UPGRADE');
  const [swapNote, setSwapNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const bookings = data ?? [];
  const pay = async (id) => {
    setActionId(id); setFormError(''); setMessage('');
    try {
      const response = unwrap(await api.post(`/bookings/${id}/pay`));
      if (response?.provider === 'razorpay') {
        await loadRazorpayCheckout();
        const checkout = new window.Razorpay({
          key: response.checkout.keyId,
          order_id: response.checkout.orderId,
          amount: response.checkout.amount,
          currency: response.checkout.currency,
          name: response.checkout.name,
          description: response.checkout.description,
          prefill: response.checkout.prefill,
          handler: async (result) => {
            try {
              await api.post('/payments/razorpay/verify', result);
              setMessage('Payment verified. Your booking is confirmed.');
              await reload();
            } catch (err) {
              setFormError(getErrorMessage(err));
            }
          },
          modal: { ondismiss: () => setMessage('Checkout closed. Your reservation remains available until its hold expires.') }
        });
        checkout.on('payment.failed', (event) => {
          setFormError(event?.error?.description || 'Payment was not completed. You can try checkout again.');
        });
        checkout.open();
        setMessage('Complete your payment in the secure checkout window.');
      } else {
        setMessage('Payment complete. Your booking is confirmed.');
        await reload();
      }
    } catch (err) { setFormError(getErrorMessage(err)); }
    finally { setActionId(''); }
  };
  const cancel = async (id) => {
    setActionId(id); setFormError(''); setMessage('');
    try { await api.patch(`/bookings/${id}/status`, { status: 'cancelled' }); setMessage('Booking cancelled.'); await reload(); }
    catch (err) { setFormError(getErrorMessage(err)); }
    finally { setActionId(''); }
  };
  const requestReturn = async (booking) => {
    const id = booking.id ?? booking._id;
    setActionId(id); setFormError(''); setMessage('');
    try {
      await api.post(`/returns/rentals/${booking.rental._id}/request`, {});
      setMessage('Return pickup requested.');
      await reload();
    } catch (err) { setFormError(getErrorMessage(err)); }
    finally { setActionId(''); }
  };
  const submitSwap = async (e) => {
    e.preventDefault(); setSubmitting(true); setFormError(''); setMessage('');
    try {
      await api.post('/swaps', { bookingId: swap.id ?? swap._id, type: swapType, description: swapNote });
      setMessage('Swap request sent to the owner.'); setSwap(null); setSwapNote(''); await reload();
    } catch (err) { setFormError(getErrorMessage(err)); }
    finally { setSubmitting(false); }
  };
  return <><PageHeading eyebrow="YOUR ACTIVITY" title="My bookings" description="Track upcoming rentals, manage changes, and see what’s already done." action={<Link className="button button-green" to="/equipment"><Plus size={16} /> Book equipment</Link>} />
    {message && <div className="inline-success page-notice"><Check size={17} />{message}</div>}{formError && !swap && <div className="inline-error page-notice">{formError}</div>}
    {loading ? <Loading label="Loading your bookings…" /> : error ? <ErrorState message={error} onRetry={reload} /> : bookings.length ? <div className="table-panel"><BookingsTable bookings={bookings} /><div className="booking-actions-list">{bookings.map((booking) => { const id = booking.id ?? booking._id; const status = String(booking.status).toLowerCase(); return <div key={id} className="booking-action-row"><span>{bookingTitle(booking)}</span><div>{['pending', 'pending_payment', 'approved', 'requested'].includes(status) && <button className="button button-green button-tiny" disabled={actionId === id} onClick={() => pay(id)}>{actionId === id ? 'Processing…' : 'Pay now'}</button>}{['pending', 'pending_payment', 'approved', 'requested', 'confirmed'].includes(status) && <button className="button button-outline button-tiny" disabled={actionId === id} onClick={() => cancel(id)}>{actionId === id ? 'Updating…' : 'Cancel'}</button>}{booking.rental?.status === 'ACTIVE' && <button className="button button-outline button-tiny" disabled={actionId === id} onClick={() => requestReturn(booking)}>{actionId === id ? 'Requesting…' : 'Request return'}</button>}{status === 'completed' && <RentalReviewForm booking={booking} onComplete={reload} />}{status === 'in_progress' && <button className="button button-outline button-tiny" onClick={() => setSwap(booking)}>Request a swap</button>}</div></div>; })}</div></div> : <EmptyState title="No bookings yet" message="Once you find the right gear, your bookings will show up here." action={<Link className="button button-green button-small" to="/equipment">Find equipment <ArrowRight size={15} /></Link>} />}
    {swap && <div className="modal-backdrop" role="presentation"><form className="modal-card" onSubmit={submitSwap}><button type="button" className="modal-close" onClick={() => setSwap(null)}>×</button><span className="eyebrow">BOOKING CHANGE</span><h2>Request an equipment swap</h2><p>{bookingTitle(swap)}</p><FormField as="select" label="Swap type" value={swapType} onChange={(e) => setSwapType(e.target.value)}><option value="UPGRADE">UPGRADE — move to a higher-tier item</option><option value="DOWNGRADE">DOWNGRADE — switch to a simpler item</option><option value="FAILURE_REPLACEMENT">FAILURE REPLACEMENT — replace faulty equipment</option></FormField><FormField as="textarea" label="Tell the owner more (optional)" rows="3" placeholder="Share what you need…" value={swapNote} onChange={(e) => setSwapNote(e.target.value)} />{swap && formError && <div className="inline-error">{formError}</div>}<div className="modal-actions"><button type="button" className="button button-outline" onClick={() => setSwap(null)}>Not now</button><button className="button button-green" disabled={submitting}>{submitting ? 'Sending…' : 'Send request'} <ArrowRight size={15} /></button></div></form></div>}
  </>;
}

export function CustomerSwaps() {
  const { data, loading, error, reload } = useLoad('/swaps/my', { list: true });
  const swaps = data ?? [];
  return <><PageHeading eyebrow="BOOKING CHANGES" title="Swap requests" description="Keep your rental moving when your plans or equipment needs change." action={<Link className="button button-outline" to="/customer/bookings"><CalendarDays size={16} /> View bookings</Link>} />
    {loading ? <Loading label="Loading swap requests…" /> : error ? <ErrorState message={error} onRetry={reload} /> : swaps.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>BOOKING</th><th>SWAP TYPE</th><th>REQUESTED</th><th>STATUS</th></tr></thead><tbody>{swaps.map((item) => <tr key={item.id ?? item._id}><td><b>{bookingTitle(item.booking ?? item)}</b></td><td><span className="swap-type">{String(item.type ?? 'UPGRADE').replace(/_/g, ' ')}</span></td><td>{item.createdAt ? formatIndianDate(item.createdAt) : '—'}</td><td><StatusBadge>{item.status ?? 'pending'}</StatusBadge></td></tr>)}</tbody></table></div> : <EmptyState title="No swap requests" message="Need a different item during a rental? Start a swap request from your active booking." action={<Link to="/customer/bookings" className="button button-outline button-small">View my bookings</Link>} />}
  </>;
}

export function CustomerPayments() {
  const { formatCurrency, t } = useLocale();
  const { data, loading, error, reload } = useLoad('/payments/my', { list: true });
  const payments = data ?? [];
  const total = useMemo(() => payments.reduce((sum, item) => sum + Number(item.amount ?? item.total ?? 0), 0), [payments]);
  return <><PageHeading eyebrow="YOUR ACCOUNT" title="Payments" description="A clear view of what you’ve paid and what’s still in progress." />
    <div className="payment-summary"><span className="metric-icon metric-green"><WalletCards size={19} /></span><div><small>Total payment activity</small><strong>{loading ? '—' : formatCurrency(total)}</strong></div><span className="payment-secure"><ShieldCheck size={15} /> Securely processed</span></div>
    {loading ? <Loading label="Loading payments…" /> : error ? <ErrorState message={error} onRetry={reload} /> : payments.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>TRANSACTION</th><th>DATE</th><th>METHOD</th><th>STATUS</th><th>AMOUNT</th></tr></thead><tbody>{payments.map((payment) => <tr key={payment.id ?? payment._id}><td><div className="table-main"><span className="table-thumb"><CreditCard size={16} /></span><span><b>{payment.description ?? payment.booking?.equipment?.name ?? 'Equipment rental'}</b><small>#{String(payment.id ?? payment._id ?? '').slice(-8)}</small>{payment.refunds?.map((refund) => <small key={refund.id ?? refund._id}>Refund {formatCurrency(refund.amountMinor / 100)} · {refund.status.replace('_', ' ')}</small>)}</span></div></td><td>{payment.createdAt ? formatIndianDate(payment.createdAt) : '—'}</td><td>{payment.method ?? payment.paymentMethod ?? 'RentalHub secure checkout'}</td><td><StatusBadge>{payment.status ?? 'paid'}</StatusBadge></td><td><b>{displayAmount(payment, formatCurrency)}</b></td></tr>)}</tbody></table></div> : <EmptyState title="No payments yet" message="Your payment history will appear here after your first booking." action={<Link className="button button-green button-small" to="/equipment">{t('findEquipment')} <ArrowRight size={15} /></Link>} />}
  </>;
}

const emptyProfile = {
  name: '', email: '', phone: '',
  address: { line1: '', line2: '', city: '', region: '', postalCode: '', country: 'India' },
  profileImageUrl: '',
  preferredLanguage: 'en',
  businessName: '', businessType: '', businessDescription: '',
  vehicleInfo: { vehicleType: '', makeModel: '', registrationNumber: '' },
  serviceArea: { cities: '', states: '', pincodes: '' }
};

function profileFormValues(profile) {
  return {
    name: profile.name ?? '',
    email: profile.email ?? '',
    phone: formatIndianPhone(profile.phone),
    profileImageUrl: profile.profileImageUrl ?? '',
    preferredLanguage: profile.preferredLanguage ?? 'en',
    businessName: profile.businessName ?? '',
    businessType: profile.businessType ?? '',
    businessDescription: profile.businessDescription ?? '',
    vehicleInfo: { ...emptyProfile.vehicleInfo, ...(profile.vehicleInfo ?? {}) },
    serviceArea: Object.fromEntries(Object.keys(emptyProfile.serviceArea).map((field) => [
      field, (profile.serviceArea?.[field] ?? []).join(', ')
    ])),
    address: { ...emptyProfile.address, ...(profile.address ?? {}) }
  };
}

function AccountProfile({ owner = false }) {
  const queryClient = useQueryClient();
  const { user, updateUser, logout } = useAuth();
  const navigate = useNavigate();
  const { t } = useLocale();
  const { data, loading: loadingProfile, error: loadError, reload } = useLoad('/users/me');
  const profile = data?.profile ?? data;
  const [values, setValues] = useState(emptyProfile);
  const [loading, setLoading] = useState(false);
    const [uploadingImage, setUploadingImage] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [passwordValues, setPasswordValues] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [passwordSubmitting, setPasswordSubmitting] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  useEffect(() => {
    if (profile) setValues(profileFormValues(profile));
  }, [profile]);

  const setAddressField = (field, value) => setValues((current) => ({
    ...current,
    address: { ...current.address, [field]: value }
  }));

  const uploadProfileImage = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const form = new FormData();
    form.append('image', file);
    setUploadingImage(true);
    setError('');
    try {
      const response = await api.post('/uploads', form, { headers: { 'Content-Type': 'multipart/form-data' } });
      const url = response.data?.data?.url;
      if (!url) throw new Error('The upload service did not return an image URL.');
      setValues((current) => ({ ...current, profileImageUrl: url }));
      setNotice(t('profileImageUploaded'));
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setUploadingImage(false);
      event.target.value = '';
    }
  };

  const changePassword = async (event) => {
    event.preventDefault();
    setPasswordError('');
    if (passwordValues.newPassword !== passwordValues.confirmPassword) {
      setPasswordError(t('passwordsDoNotMatch'));
      return;
    }
    setPasswordSubmitting(true);
    try {
      await api.patch('/auth/password', {
        currentPassword: passwordValues.currentPassword,
        newPassword: passwordValues.newPassword
      });
      await logout().catch(() => {});
      navigate('/login', { replace: true, state: { message: t('passwordChangeDone') } });
    } catch (err) {
      setPasswordError(getErrorMessage(err));
    } finally {
      setPasswordSubmitting(false);
    }
  };

  const save = async (e) => {
    e.preventDefault(); setLoading(true); setError(''); setNotice('');
    try {
      const payload = {
        name: values.name,
        email: values.email,
        phone: values.phone,
        profileImageUrl: values.profileImageUrl,
        preferredLanguage: values.preferredLanguage,
        address: values.address
      };
      if (owner) Object.assign(payload, {
        businessName: values.businessName,
        businessType: values.businessType,
        businessDescription: values.businessDescription
      });
      if (profile?.role === 'transporter') Object.assign(payload, {
        vehicleInfo: values.vehicleInfo,
        serviceArea: Object.fromEntries(Object.entries(values.serviceArea).map(([field, input]) => [
          field, input.split(/[\n,]/).map((value) => value.trim()).filter(Boolean)
        ]))
      });
      const { data } = await api.patch('/users/me', payload);
      const updated = unwrap(data)?.profile ?? unwrap(data);
      if (!updated) throw new Error('The server did not return the updated profile.');
      updateUser({
        ...user,
        name: updated.name,
        email: updated.email,
        phone: updated.phone,
        profileImageUrl: updated.profileImageUrl,
        preferredLanguage: updated.preferredLanguage,
        ...(owner ? { ownerVerified: updated.ownerVerified, verificationStatus: updated.verificationStatus } : {})
      });
      queryClient.setQueryData(['api', '/users/me', 'item'], { profile: updated });
      setValues(profileFormValues(updated));
      setNotice(t('profileSaved'));
    } catch (err) { setError(getErrorMessage(err)); }
    finally { setLoading(false); }
  };
  const address = values.address;
  const verificationStatus = profile?.ownerVerified ? 'verified' : profile?.verificationStatus ?? 'pending';

  return <>
    <PageHeading eyebrow={owner ? t('ownerProfileTitle') : t('profileTitle')} title={owner ? t('ownerProfileTitle') : t('profileTitle')} description={owner ? t('ownerProfileDescription') : t('profileDescription')} />
    {loadingProfile ? <Loading label="Loading your profile…" /> : loadError ? <ErrorState message={loadError} onRetry={reload} /> : <div className="profile-card">
      <div className="profile-card-top">
        {values.profileImageUrl
          ? <img className="avatar profile-avatar" src={values.profileImageUrl} alt={values.name} />
          : <span className="avatar profile-avatar">{(values.name || 'U').slice(0, 1).toUpperCase()}</span>}
        <div><h2>{values.name || t('profileTitle')}</h2><p>{values.email}</p></div>
        {owner && <StatusBadge>{verificationStatus}</StatusBadge>}
      </div>
      <p className="profile-privacy">{t('profilePrivate')}</p>
      <form className="profile-form" onSubmit={save}>
        <FormField label={t('profileImage')} type="file" accept="image/jpeg,image/png,image/webp" onChange={uploadProfileImage} disabled={uploadingImage} />
        {uploadingImage && <p>{t('uploadingImage')}</p>}
        <FormField label={owner ? t('contactName') : t('fullName')} value={values.name} onChange={(e) => setValues({ ...values, name: e.target.value })} maxLength={100} autoComplete="name" required />
        {owner && <FormField label={t('businessNameOptional')} value={values.businessName} onChange={(e) => setValues({ ...values, businessName: e.target.value })} maxLength={120} autoComplete="organization" />}
        <FormField label={t('email')} type="email" value={values.email} onChange={(e) => setValues({ ...values, email: e.target.value })} maxLength={254} autoComplete="email" required />
        <FormField label={t('phone')} type="tel" autoComplete="tel" value={values.phone} onChange={(e) => setValues({ ...values, phone: e.target.value })} placeholder={t('phonePlaceholder')} />
        <FormField label={t('addressLine1')} value={address.line1} onChange={(e) => setAddressField('line1', e.target.value)} maxLength={160} autoComplete="address-line1" />
        <FormField label={t('addressLine2')} value={address.line2} onChange={(e) => setAddressField('line2', e.target.value)} maxLength={160} autoComplete="address-line2" />
        <FormField label={t('city')} value={address.city} onChange={(e) => setAddressField('city', e.target.value)} maxLength={100} autoComplete="address-level2" />
        <FormField label={t('stateRegion')} value={address.region} onChange={(e) => setAddressField('region', e.target.value)} maxLength={100} autoComplete="address-level1" />
        <FormField label={t('postalCode')} value={address.postalCode} onChange={(e) => setAddressField('postalCode', e.target.value)} maxLength={20} autoComplete="postal-code" />
        <FormField label={t('country')} value={address.country} onChange={(e) => setValues({ ...values, address: { ...address, country: e.target.value } })} maxLength={80} autoComplete="country-name" />
        <FormField as="select" label={t('preferredLanguage')} value={values.preferredLanguage} onChange={(e) => setValues({ ...values, preferredLanguage: e.target.value })}>
          <option value="en">{t('english')}</option><option value="hi">{t('hindi')}</option><option value="ta">{t('tamil')}</option>
        </FormField>
        {owner && <>
          <FormField label={t('businessTypeOptional')} value={values.businessType} onChange={(e) => setValues({ ...values, businessType: e.target.value })} maxLength={80} />
          <FormField as="textarea" label={t('businessInformationOptional')} value={values.businessDescription} onChange={(e) => setValues({ ...values, businessDescription: e.target.value })} maxLength={1000} />
        </>}
        {profile?.role === 'transporter' && <>
          <FormField label={t('vehicleType')} value={values.vehicleInfo.vehicleType} onChange={(event) => setValues((current) => ({ ...current, vehicleInfo: { ...current.vehicleInfo, vehicleType: event.target.value } }))} maxLength={80} />
          <FormField label={t('vehicleModel')} value={values.vehicleInfo.makeModel} onChange={(event) => setValues((current) => ({ ...current, vehicleInfo: { ...current.vehicleInfo, makeModel: event.target.value } }))} maxLength={120} />
          <FormField label={t('vehicleRegistration')} value={values.vehicleInfo.registrationNumber} onChange={(event) => setValues((current) => ({ ...current, vehicleInfo: { ...current.vehicleInfo, registrationNumber: event.target.value } }))} maxLength={30} />
        </>}
        {profile?.role === 'transporter' && <>
          <FormField label={t('serviceCities')} value={values.serviceArea.cities} onChange={(event) => setValues((current) => ({ ...current, serviceArea: { ...current.serviceArea, cities: event.target.value } }))} placeholder={t('commaSeparated')} />
          <FormField label={t('serviceStates')} value={values.serviceArea.states} onChange={(event) => setValues((current) => ({ ...current, serviceArea: { ...current.serviceArea, states: event.target.value } }))} placeholder={t('commaSeparated')} />
          <FormField label={t('servicePincodes')} value={values.serviceArea.pincodes} onChange={(event) => setValues((current) => ({ ...current, serviceArea: { ...current.serviceArea, pincodes: event.target.value } }))} placeholder={t('commaSeparated')} />
        </>}
        <div className="profile-account-info">
          <span>{t('accountType')} <b>{t(profile.role ? `role${profile.role[0].toUpperCase()}${profile.role.slice(1)}` : 'roleCustomer')}</b></span>
          <span>{t('memberSince')} <b>{profile.createdAt ? formatIndianDate(profile.createdAt) : '—'}</b></span>
          {owner && <span>{t('verification')} <b><StatusBadge>{verificationStatus}</StatusBadge></b></span>}
        </div>
        {error && <div className="inline-error" role="alert">{error}</div>}
        {notice && <div className="inline-success" role="status"><Check size={16} />{notice}</div>}
        <button className="button button-green" disabled={loading}>{loading ? t('savingChanges') : t('saveProfileChanges')} <ArrowRight size={15} /></button>
      </form>
    </div>}
    <section className="profile-card">
      <h2>{t('securityTitle')}</h2>
      <form className="profile-form" onSubmit={changePassword}>
        <FormField label={t('currentPassword')} type="password" autoComplete="current-password" value={passwordValues.currentPassword} onChange={(event) => setPasswordValues((current) => ({ ...current, currentPassword: event.target.value }))} required />
        <FormField label={t('newPassword')} type="password" autoComplete="new-password" minLength={8} maxLength={72} value={passwordValues.newPassword} onChange={(event) => setPasswordValues((current) => ({ ...current, newPassword: event.target.value }))} required />
        <FormField label={t('confirmPassword')} type="password" autoComplete="new-password" minLength={8} maxLength={72} value={passwordValues.confirmPassword} onChange={(event) => setPasswordValues((current) => ({ ...current, confirmPassword: event.target.value }))} required />
        {passwordError && <div className="inline-error" role="alert">{passwordError}</div>}
        <button className="button button-green" disabled={passwordSubmitting}>{passwordSubmitting ? t('savingPassword') : t('changePassword')}</button>
      </form>
    </section>
  </>;
}

export function CustomerProfile() { return <AccountProfile />; }
export function OwnerProfile() { return <AccountProfile owner />; }
export function RoleProfile() { return <AccountProfile />; }

export function ReturnHistory() {
  const { data, loading, error, reload } = useLoad('/returns', { list: true });
  const [selected, setSelected] = useState(null);
  const [loadError, setLoadError] = useState('');
  const returns = data ?? [];
  const inspect = async (returnRecord) => {
    setLoadError('');
    try {
      const response = await api.get(`/returns/${returnRecord._id}`);
      setSelected(unwrap(response.data));
    } catch (err) { setLoadError(getErrorMessage(err)); }
  };
  return <>
    <PageHeading eyebrow="RENTAL RETURNS" title="Returns" description="Review return pickup progress and recorded condition reports." />
    {loadError && <div className="inline-error" role="alert">{loadError}</div>}
    {loading ? <Loading label="Loading returns…" /> : error ? <ErrorState message={error} onRetry={reload} /> : returns.length ? (
      <div className="owner-bookings-list">{returns.map((record) => <article className="owner-booking-card" key={record._id}>
        <div className="owner-booking-head"><div><h3>{record.equipment?.map((item) => item.name).filter(Boolean).join(', ') || 'Rental return'}</h3><p>{record.createdAt ? formatIndianDate(record.createdAt) : 'Date unavailable'}</p></div><StatusBadge>{record.status}</StatusBadge></div>
        <div className="owner-booking-bottom"><span>Return #{String(record._id).slice(-8)}</span><button className="button button-outline button-small" onClick={() => inspect(record)}>View return</button></div>
      </article>)}</div>
    ) : <EmptyState title="No returns yet" message="Return requests and inspection history will appear here." />}
    {selected && <div className="modal-backdrop" role="presentation"><section className="modal-card" role="dialog" aria-modal="true" aria-label="Return details">
      <button type="button" className="modal-close" onClick={() => setSelected(null)}>×</button>
      <span className="eyebrow">RETURN DETAILS</span><h2>{selected.return?.status}</h2>
      <p>{selected.return?.notes || 'No return notes were recorded.'}</p>
      {selected.conditionReports?.map((report) => <div className="profile-section" key={report._id}>
        <h3>{report.equipment?.name || 'Equipment'} · {report.condition}</h3>
        <p>{report.damage || 'No damage was recorded in this inspection.'}</p>
        <p>{report.checklist?.meterReading ? `Meter reading: ${report.checklist.meterReading}` : 'Meter reading not recorded.'}</p>
        <div className="card-actions">{report.evidenceUrls?.map((url) => <a className="text-link" key={url} href={url} target="_blank" rel="noreferrer">View evidence</a>)}</div>
      </div>)}
    </section></div>}
  </>;
}

export function DisputeCenter() {
  const { user } = useAuth();
  const { data: rentals, loading: loadingRentals } = useLoad('/rentals', { list: true });
  const { data, loading, error, reload } = useLoad('/disputes', { list: true });
  const [rentalId, setRentalId] = useState('');
  const [disputeType, setDisputeType] = useState('other');
  const [summary, setSummary] = useState('');
  const [notes, setNotes] = useState('');
  const [attachments, setAttachments] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const disputes = data ?? [];
  const canCreate = ['customer', 'owner', 'transporter'].includes(user?.role);
  const createDispute = async (event) => {
    event.preventDefault(); setBusy(true); setFormError('');
    try {
      await api.post('/disputes', {
        rentalId, disputeType, summary, notes,
        attachments: attachments.split(/[\n,]/).map((value) => value.trim()).filter(Boolean)
      });
      setSummary(''); setNotes(''); setAttachments('');
      await reload();
    } catch (err) { setFormError(getErrorMessage(err)); }
    finally { setBusy(false); }
  };
  return <>
    <PageHeading eyebrow="RENTAL SUPPORT" title="Disputes" description="Review reported issues and keep evidence and responses attached to the Rental." />
    {formError && <div className="inline-error page-notice" role="alert">{formError}</div>}
    {canCreate && <section className="profile-card"><h2>Report a dispute</h2>
      {loadingRentals ? <Loading label="Loading rentals…" /> : <form className="profile-form" onSubmit={createDispute}>
        <FormField as="select" label="Rental" value={rentalId} onChange={(event) => setRentalId(event.target.value)} required>
          <option value="">Choose a rental</option>
          {(rentals || []).map((rental) => <option key={rental._id} value={rental._id}>{rental.equipment?.map((item) => item.name).filter(Boolean).join(', ') || `Rental ${String(rental._id).slice(-8)}`} · {rental.status}</option>)}
        </FormField>
        <FormField as="select" label="Dispute type" value={disputeType} onChange={(event) => setDisputeType(event.target.value)}>
          <option value="equipment_mismatch">Equipment mismatch</option><option value="damage">Damage</option><option value="late_delivery">Late delivery</option><option value="equipment_failure">Equipment failure</option><option value="cancellation">Cancellation</option><option value="payment">Payment</option><option value="transport">Transport</option><option value="other">Other</option>
        </FormField>
        <FormField label="Summary" value={summary} onChange={(event) => setSummary(event.target.value)} required maxLength={500} />
        <FormField className="form-span-2" as="textarea" label="Details" value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={4000} />
        <FormField className="form-span-2" as="textarea" label="Evidence URLs (optional, one per line)" value={attachments} onChange={(event) => setAttachments(event.target.value)} />
        <button className="button button-green" disabled={busy || !rentalId}>{busy ? 'Submitting…' : 'Submit dispute'}</button>
      </form>}
    </section>}
    {loading ? <Loading label="Loading disputes…" /> : error ? <ErrorState message={error} onRetry={reload} /> : disputes.length ? <div className="owner-bookings-list">{disputes.map((dispute) => <DisputeCard key={dispute._id} dispute={dispute} role={user?.role} onChange={reload} />)}</div> : <EmptyState title="No disputes" message="Disputes will appear here when a participant reports an issue with a Rental." />}
  </>;
}

function DisputeCard({ dispute, role, onChange }) {
  const [message, setMessage] = useState('');
  const [resolution, setResolution] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const reply = async (event) => {
    event.preventDefault(); setBusy(true); setError('');
    try { await api.post(`/disputes/${dispute._id}/responses`, { message }); setMessage(''); await onChange(); }
    catch (err) { setError(getErrorMessage(err)); }
    finally { setBusy(false); }
  };
  const updateStatus = async (status) => {
    setBusy(true); setError('');
    try { await api.patch(`/disputes/${dispute._id}/status`, { status, resolution }); await onChange(); }
    catch (err) { setError(getErrorMessage(err)); }
    finally { setBusy(false); }
  };
  const closed = ['resolved', 'closed'].includes(dispute.status);
  return <article className="owner-booking-card">
    <div className="owner-booking-head"><div><h3>{dispute.summary}</h3><p>{String(dispute.disputeType || 'other').replace(/_/g, ' ')} · {dispute.reporter?.name || 'Rental participant'} · {formatIndianDate(dispute.createdAt)}</p></div><StatusBadge>{dispute.status}</StatusBadge></div>
    {dispute.notes && <p>{dispute.notes}</p>}
    {dispute.attachments?.map((url) => <a className="text-link" key={url} href={url} target="_blank" rel="noreferrer">View evidence</a>)}
    {dispute.responses?.map((response) => <div className="profile-section" key={response._id}><b>{response.author?.name || response.authorRole}</b><p>{response.message}</p>{response.attachments?.map((url) => <a className="text-link" key={url} href={url} target="_blank" rel="noreferrer">Evidence</a>)}</div>)}
    {error && <div className="inline-error" role="alert">{error}</div>}
    {!closed && <form className="profile-form" onSubmit={reply}><FormField as="textarea" label="Add response" value={message} onChange={(event) => setMessage(event.target.value)} maxLength={4000} required /><button className="button button-outline button-tiny" disabled={busy}>{busy ? 'Saving…' : 'Send response'}</button></form>}
    {role === 'admin' && !closed && <div className="owner-booking-actions"><FormField label="Resolution" value={resolution} onChange={(event) => setResolution(event.target.value)} maxLength={4000} /><button className="button button-outline button-tiny" disabled={busy} onClick={() => updateStatus('under_review')}>Review</button><button className="button button-outline button-tiny" disabled={busy} onClick={() => updateStatus('action_required')}>Request action</button><button className="button button-green button-tiny" disabled={busy} onClick={() => updateStatus('resolved')}>Resolve</button></div>}
  </article>;
}
