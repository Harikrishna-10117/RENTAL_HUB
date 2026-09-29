import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDownUp, ArrowRight, CalendarDays, Check, Clock3, CreditCard, Package, Plus, ShieldCheck, WalletCards } from 'lucide-react';
import { api, asList, getErrorMessage, unwrap } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useLoad } from '../lib/useLoad.js';
import { EmptyState, ErrorState, FormField, Loading, PageHeading, StatusBadge } from '../components/UI.jsx';
import { useLocale } from '../context/LocaleContext.jsx';
import { formatIndianCurrency, formatIndianDate, formatIndianPhone } from '../lib/india.js';

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
    {loading ? <Loading label="Loading your bookings…" /> : error ? <ErrorState message={error} onRetry={reload} /> : bookings.length ? <div className="table-panel"><BookingsTable bookings={bookings} /><div className="booking-actions-list">{bookings.map((booking) => { const id = booking.id ?? booking._id; const status = String(booking.status).toLowerCase(); return <div key={id} className="booking-action-row"><span>{bookingTitle(booking)}</span><div>{['pending', 'pending_payment', 'approved', 'requested'].includes(status) && <button className="button button-green button-tiny" disabled={actionId === id} onClick={() => pay(id)}>{actionId === id ? 'Processing…' : 'Pay now'}</button>}{['pending', 'pending_payment', 'approved', 'requested', 'confirmed'].includes(status) && <button className="button button-outline button-tiny" disabled={actionId === id} onClick={() => cancel(id)}>{actionId === id ? 'Updating…' : 'Cancel'}</button>}{status === 'in_progress' && <button className="button button-outline button-tiny" onClick={() => setSwap(booking)}>Request a swap</button>}</div></div>; })}</div></div> : <EmptyState title="No bookings yet" message="Once you find the right gear, your bookings will show up here." action={<Link className="button button-green button-small" to="/equipment">Find equipment <ArrowRight size={15} /></Link>} />}
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

export function CustomerProfile() {
  const { user, updateUser } = useAuth();
  const [values, setValues] = useState({ name: user?.name ?? user?.fullName ?? '', email: user?.email ?? '', phone: formatIndianPhone(user?.phone) });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const save = async (e) => {
    e.preventDefault(); setLoading(true); setError(''); setNotice('');
    try {
      const { data } = await api.patch('/users/me', values);
      const updated = { ...user, ...(unwrap(data)?.user ?? unwrap(data) ?? values) };
      updateUser(updated); setValues({ name: updated.name ?? updated.fullName ?? '', email: updated.email ?? '', phone: formatIndianPhone(updated.phone) }); setNotice('Your profile is up to date.');
    } catch (err) { setError(getErrorMessage(err)); }
    finally { setLoading(false); }
  };
  return <><PageHeading eyebrow="YOUR ACCOUNT" title="Profile settings" description="Keep your contact details current for a smooth rental experience." /><div className="profile-card"><div className="profile-card-top"><span className="avatar profile-avatar">{(values.name || 'U').slice(0, 1).toUpperCase()}</span><div><h2>{values.name || 'Your profile'}</h2><p>{values.email}</p></div></div><form className="profile-form" onSubmit={save}><FormField label="Full name" value={values.name} onChange={(e) => setValues({ ...values, name: e.target.value })} required /><FormField label="Email address" type="email" value={values.email} onChange={(e) => setValues({ ...values, email: e.target.value })} required /><FormField label="Phone number" type="tel" autoComplete="tel" value={values.phone} onChange={(e) => setValues({ ...values, phone: e.target.value })} placeholder="+91 98765 43210" />{error && <div className="inline-error">{error}</div>}{notice && <div className="inline-success"><Check size={16} />{notice}</div>}<button className="button button-green" disabled={loading}>{loading ? 'Saving changes…' : 'Save profile changes'} <ArrowRight size={15} /></button></form></div></>;
}
