import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowDownUp, ArrowRight, BadgeCheck, Boxes, CalendarDays, Check, CircleDollarSign, ClipboardCheck, Eye, Package, Plus, ShieldCheck, Wrench, X } from 'lucide-react';
import { api, asList, getErrorMessage, unwrap } from '../lib/api.js';
import { useLoad } from '../lib/useLoad.js';
import { BookingsTable } from './CustomerPages.jsx';
import { EmptyState, ErrorState, FormField, Loading, PageHeading, StatusBadge } from '../components/UI.jsx';
import { formatIndianCurrency, formatIndianDate, formatIndianAddress, localizedName } from '../lib/india.js';
import { useLocale } from '../context/LocaleContext.jsx';

function itemId(item) { return item.id ?? item._id; }
function bookingName(item) { return item.equipment?.name ?? item.equipment?.[0]?.name ?? item.equipmentName ?? item.booking?.equipment?.name ?? item.booking?.equipment?.[0]?.name ?? item.item?.name ?? 'Rental booking'; }

export function OwnerDashboard() {
  const { t, locale } = useLocale();
  const { data: equipment, loading: equipmentLoading, error: equipmentError, reload: reloadEquipment } = useLoad('/owner/equipment', { list: true });
  const { data: bookings, loading: bookingsLoading, error: bookingsError, reload: reloadBookings } = useLoad('/owner/bookings', { list: true });
  const inventory = equipment ?? [];
  const requests = (bookings ?? []).filter((booking) => ['pending', 'requested'].includes(String(booking.status).toLowerCase()));
  return <><PageHeading eyebrow={t('ownerDashEyebrow')} title={t('ownerDashTitle')} description={t('ownerDashDescription')} action={<Link to="/owner/equipment/new" className="button button-green"><Plus size={16} /> {t('addEquipment')}</Link>} />
    <div className="metric-grid"><div className="metric-card"><span className="metric-icon metric-green"><Boxes size={18} /></span><small>{t('ownerListings')}</small><strong>{equipmentLoading ? '?' : inventory.filter((item) => String(item.status ?? 'active').toLowerCase() !== 'inactive').length}</strong><span className="metric-hint">{t('ownerListingsHint')}</span></div><div className="metric-card"><span className="metric-icon metric-amber"><CalendarDays size={18} /></span><small>{t('awaitingResponse')}</small><strong>{bookingsLoading ? '?' : requests.length}</strong><Link className="metric-inline-link" to="/owner/bookings">{t('reviewRequests')} <ArrowRight size={13} /></Link></div><div className="metric-card"><span className="metric-icon metric-blue"><CircleDollarSign size={18} /></span><small>{t('ownerStatus')}</small><strong className="metric-word">{t('readyGrow')}</strong><span className="metric-hint">{t('equipmentCanDoMore')}</span></div></div>
    <section className="dashboard-section"><div className="section-heading compact"><div><span className="eyebrow">{t('latestRequests')}</span><h2>{t('bookingActivity')}</h2></div><Link to="/owner/bookings" className="text-link">{t('allBookings')} <ArrowRight size={15} /></Link></div>{bookingsLoading ? <Loading label={t('loadingActivity')} /> : bookingsError ? <ErrorState message={bookingsError} onRetry={reloadBookings} /> : bookings?.length ? <BookingsTable bookings={bookings.slice(0, 5)} showOwner /> : <EmptyState title={t('noBookingActivity')} message={t('bookingActivityEmpty')} action={<Link className="button button-outline button-small" to="/owner/equipment/new">{t('addEquipment')}</Link>} />}</section>
    <section className="dashboard-section"><div className="section-heading compact"><div><span className="eyebrow">{t('ownerCatalog')}</span><h2>{t('listedEquipment')}</h2></div><Link to="/owner/equipment" className="text-link">{t('manageListings')} <ArrowRight size={15} /></Link></div>{equipmentLoading ? <Loading label={t('loadingListings')} /> : equipmentError ? <ErrorState message={equipmentError} onRetry={reloadEquipment} /> : inventory.length ? <div className="compact-list">{inventory.slice(0, 4).map((item) => <div className="compact-row" key={itemId(item)}><span className="table-thumb"><Wrench size={17} /></span><span className="compact-row-title"><b>{item.name ?? item.title ?? t('equipment')}</b><small>{localizedName(item.category, locale) || '?'}</small></span><StatusBadge>{item.status ?? 'active'}</StatusBadge><b className="compact-price">{formatIndianCurrency(item.dailyRate ?? item.pricePerDay ?? item.price)}<small> {t('perDay')}</small></b></div>)}</div> : <EmptyState title={t('inventoryStart')} message={t('inventoryEmpty')} action={<Link className="button button-green button-small" to="/owner/equipment/new"><Plus size={14} /> {t('addFirstListing')}</Link>} />}</section>
  </>;
}
export function OwnerEquipment() {
  const { locale } = useLocale();
  const { data, loading, error, reload } = useLoad('/owner/equipment', { list: true });
  const [busy, setBusy] = useState('');
  const [actionError, setActionError] = useState('');
  const setAvailability = async (item, status) => {
    setBusy(itemId(item)); setActionError('');
    try { await api.patch(`/owner/equipment/${itemId(item)}`, { status }); await reload(); }
    catch (err) { setActionError(getErrorMessage(err)); }
    finally { setBusy(''); }
  };
  const items = data ?? [];
  return <><PageHeading eyebrow="YOUR CATALOG" title="My equipment" description="Keep your listings accurate and ready for the next renter." action={<Link to="/owner/equipment/new" className="button button-green"><Plus size={16} /> Add equipment</Link>} />
    {actionError && <div className="inline-error page-notice">{actionError}</div>}
    {loading ? <Loading label="Loading your equipment…" /> : error ? <ErrorState message={error} onRetry={reload} /> : items.length ? <div className="equipment-listings">{items.map((item) => { const id = itemId(item); const image = item.imageUrl ?? item.image ?? item.images?.[0]; const isActive = String(item.status ?? 'active').toLowerCase() === 'active'; return <article className="listing-card" key={id}><div className="listing-photo">{image ? <img src={image} alt={item.name ?? item.title} /> : <span><Wrench size={22} /></span>}</div><div className="listing-info"><div className="listing-title-line"><h3>{item.name ?? item.title ?? 'Equipment'}</h3><StatusBadge>{item.status ?? 'active'}</StatusBadge></div><p>{localizedName(item.category, locale) || 'Uncategorized'} <span>·</span> {item.location ?? 'Location not set'}</p><strong>{formatIndianCurrency(item.dailyRate ?? item.pricePerDay ?? item.price)}<small> / day</small></strong></div><div className="listing-actions"><Link to={`/owner/equipment/${id}/edit`} className="button button-outline button-tiny">Edit listing</Link><button disabled={busy === id} className="button button-quiet button-tiny" onClick={() => setAvailability(item, isActive ? 'inactive' : 'active')}>{busy === id ? 'Saving…' : isActive ? 'Pause listing' : 'Activate'}</button></div></article>; })}</div> : <EmptyState title="No listings yet" message="Add your first piece of equipment and make it available to your community." action={<Link to="/owner/equipment/new" className="button button-green button-small"><Plus size={15} /> Add equipment</Link>} />}
  </>;
}

const emptyForm = { name: '', description: '', category: '', dailyRate: '', location: '', imageUrl: '', availability: 'available' };
export function EquipmentForm() {
  const { locale } = useLocale();
  const { id } = useParams();
  const navigate = useNavigate();
  const { data, loading: loadingItem, error: loadError } = useLoad(id ? `/owner/equipment/${id}` : '/owner/equipment', { enabled: Boolean(id) });
  const { data: categoryData } = useLoad('/categories', { list: true });
  const [values, setValues] = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const item = data?.equipment ?? data;
    if (id && item) setValues({ name: item.name ?? item.title ?? '', description: item.description ?? '', category: typeof item.category === 'object' ? item.category.id ?? item.category._id : item.category ?? '', dailyRate: item.dailyRate ?? item.pricePerDay ?? item.price ?? '', location: item.location ?? '', imageUrl: item.imageUrl ?? item.image ?? '', availability: item.availability ?? 'available' });
  }, [data, id]);
  const update = (key) => (e) => setValues((current) => ({ ...current, [key]: e.target.value }));
  const submit = async (e) => {
    e.preventDefault(); setSubmitting(true); setError('');
    const payload = { ...values, dailyRate: Number(values.dailyRate) };
    try {
      if (id) await api.put(`/owner/equipment/${id}`, payload);
      else await api.post('/owner/equipment', payload);
      navigate('/owner/equipment', { replace: true });
    } catch (err) { setError(getErrorMessage(err)); }
    finally { setSubmitting(false); }
  };
  if (id && loadingItem) return <Loading label="Loading your listing…" />;
  if (id && loadError) return <ErrorState message={loadError} />;
  return <><PageHeading eyebrow="YOUR CATALOG" title={id ? 'Edit equipment' : 'Add equipment'} description={id ? 'Keep your listing details clear, current, and useful.' : 'Give renters the details they need to book with confidence.'} action={<Link to="/owner/equipment" className="button button-outline">Cancel</Link>} />
    <form className="edit-form-card" onSubmit={submit}><div className="form-section-heading"><span><Package size={18} /></span><div><h2>Listing details</h2><p>Tell customers what makes this piece of equipment right for them.</p></div></div><div className="form-grid"><FormField className="form-span-2" label="Equipment name" value={values.name} onChange={update('name')} placeholder="e.g. Compact excavator" required /><FormField as="select" label="Category" value={values.category} onChange={update('category')} required><option value="">Choose a category</option>{(categoryData ?? []).map((cat) => <option key={cat.id ?? cat._id ?? cat.name} value={cat.id ?? cat._id ?? cat.name}>{localizedName(cat, locale)}</option>)}</FormField><FormField label="Daily rental rate (INR)" type="number" min="0" step="0.01" value={values.dailyRate} onChange={update('dailyRate')} placeholder="0.00" required /><FormField className="form-span-2" label="Description" as="textarea" rows="5" value={values.description} onChange={update('description')} placeholder="Share the condition, best uses, and any details that help renters make a great choice…" required /><FormField label="Pickup location" value={values.location} onChange={update('location')} placeholder="City or neighborhood" required /><FormField label="Photo URL (optional)" type="url" value={values.imageUrl} onChange={update('imageUrl')} placeholder="https://…" /><FormField as="select" label="Availability" value={values.availability} onChange={update('availability')}><option value="available">Available</option><option value="unavailable">Unavailable</option></FormField></div>{error && <div className="inline-error">{error}</div>}<div className="edit-form-footer"><span><ShieldCheck size={15} /> You can update these details any time.</span><button className="button button-green" disabled={submitting}>{submitting ? 'Saving listing…' : id ? 'Save changes' : 'Publish listing'} <ArrowRight size={15} /></button></div></form>
  </>;
}

export function OwnerBookings() {
  const { data, loading, error, reload } = useLoad('/owner/bookings', { list: true });
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [actionError, setActionError] = useState('');
  const [selected, setSelected] = useState(null);
  const [action, setAction] = useState('return');
  const [notes, setNotes] = useState('');
  const [condition, setCondition] = useState('good');
  const bookings = data ?? [];
  const updateStatus = async (booking, status) => {
    const id = itemId(booking); setBusy(id); setActionError(''); setMessage('');
    try { await api.patch(`/bookings/${id}/status`, { status }); setMessage(`Booking ${status}.`); await reload(); }
    catch (err) { setActionError(getErrorMessage(err)); }
    finally { setBusy(''); }
  };
  const submitAction = async (e) => {
    e.preventDefault(); const id = itemId(selected); setBusy(id); setActionError('');
    try {
      if (action === 'return') await api.post(`/bookings/${id}/return`, { notes });
      else await api.post(`/bookings/${id}/inspection`, { condition, notes });
      setMessage(action === 'return' ? 'Return recorded. Add an inspection when you’ve checked the equipment.' : 'Inspection saved.');
      setSelected(null); setNotes(''); await reload();
    } catch (err) { setActionError(getErrorMessage(err)); }
    finally { setBusy(''); }
  };
  return <><PageHeading eyebrow="RENTAL ACTIVITY" title="Booking requests" description="Respond to booking requests and keep each rental moving smoothly." />
    {message && <div className="inline-success page-notice"><Check size={17} />{message}</div>}{actionError && !selected && <div className="inline-error page-notice">{actionError}</div>}
    {loading ? <Loading label="Loading booking requests…" /> : error ? <ErrorState message={error} onRetry={reload} /> : bookings.length ? <div className="owner-bookings-list">{bookings.map((booking) => { const id = itemId(booking); const status = String(booking.status ?? 'pending').toLowerCase(); const customer = booking.customer?.name ?? booking.customerName ?? booking.user?.name ?? 'Customer'; return <article className="owner-booking-card" key={id}><div className="owner-booking-head"><span className="table-thumb"><CalendarDays size={17} /></span><div><h3>{bookingName(booking)}</h3><p>{customer} <span>·</span> {booking.startDate ? formatIndianDate(booking.startDate) : 'Dates to be confirmed'}</p></div><StatusBadge>{status}</StatusBadge></div><div className="owner-booking-bottom"><span>Booking #{String(id).slice(-7)} <b>·</b> {formatIndianCurrency(booking.totalAmount ?? booking.total ?? booking.amount)}</span><div className="owner-booking-actions">
      {['pending', 'requested'].includes(status) && <><button className="button button-outline button-tiny" disabled={busy === id} onClick={() => updateStatus(booking, 'rejected')}><X size={14} /> Decline</button><button className="button button-green button-tiny" disabled={busy === id} onClick={() => updateStatus(booking, 'confirmed')}><Check size={14} /> Accept booking</button></>}
      {['confirmed', 'approved', 'active', 'in_progress'].includes(status) && <><button className="button button-outline button-tiny" onClick={() => { setSelected(booking); setAction('return'); }}><Package size={14} /> Record return</button></>}
      {status === 'return_pending' && <><button className="button button-outline button-tiny" onClick={() => { setSelected(booking); setAction('inspection'); }}><ClipboardCheck size={14} /> Inspect item</button><button className="button button-green button-tiny" disabled={busy === id} onClick={() => updateStatus(booking, 'completed')}><Check size={14} /> Complete rental</button></>}
      </div></div></article>; })}</div> : <EmptyState title="No bookings to manage" message="New customer requests will appear here as soon as your equipment is booked." action={<Link to="/owner/equipment" className="button button-outline button-small">Manage equipment</Link>} />}
    {selected && <div className="modal-backdrop"><form className="modal-card" onSubmit={submitAction}><button type="button" className="modal-close" onClick={() => setSelected(null)}>×</button><span className="eyebrow">{action === 'return' ? 'RENTAL HANDOFF' : 'EQUIPMENT CHECK'}</span><h2>{action === 'return' ? 'Record equipment return' : 'Inspect equipment'}</h2><p>{bookingName(selected)} · {selected.customer?.name ?? selected.customerName ?? 'Customer'}</p>{action === 'inspection' && <FormField as="select" label="Equipment condition" value={condition} onChange={(e) => setCondition(e.target.value)}><option value="good">Good — no issues</option><option value="minor_damage">Minor damage</option><option value="needs_repair">Needs repair</option></FormField>}<FormField as="textarea" label={action === 'return' ? 'Return notes (optional)' : 'Inspection notes'} rows="3" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Add a note for your records…" />{selected && actionError && <div className="inline-error">{actionError}</div>}<div className="modal-actions"><button type="button" className="button button-outline" onClick={() => setSelected(null)}>Cancel</button><button className="button button-green" disabled={busy === itemId(selected)}>{busy === itemId(selected) ? 'Saving…' : action === 'return' ? 'Record return' : 'Save inspection'} <ArrowRight size={15} /></button></div></form></div>}
  </>;
}

export function OwnerSwaps() {
  const { data, loading, error, reload } = useLoad('/owner/swaps', { list: true });
  const [busy, setBusy] = useState('');
  const [actionError, setActionError] = useState('');
  const swaps = data ?? [];
  const respond = async (swap, status) => {
    setBusy(itemId(swap)); setActionError('');
    try { await api.patch(`/swaps/${itemId(swap)}/status`, { status }); await reload(); }
    catch (err) { setActionError(getErrorMessage(err)); }
    finally { setBusy(''); }
  };
  return <><PageHeading eyebrow="KEEP RENTALS MOVING" title="Swap requests" description="Review customer requests to upgrade, downgrade, or replace equipment." />
    {actionError && <div className="inline-error page-notice">{actionError}</div>}
    {loading ? <Loading label="Loading swap requests…" /> : error ? <ErrorState message={error} onRetry={reload} /> : swaps.length ? <div className="owner-bookings-list">{swaps.map((swap) => { const id = itemId(swap); const status = String(swap.status ?? 'pending').toLowerCase(); return <article className="owner-booking-card" key={id}><div className="owner-booking-head"><span className="table-thumb"><ArrowDownUp size={17} /></span><div><h3>{swap.booking?.equipment?.name ?? swap.booking?.equipmentName ?? 'Equipment swap request'}</h3><p>{swap.customer?.name ?? swap.customerName ?? swap.booking?.customer?.name ?? 'Customer'} <span>·</span> {swap.description ?? swap.notes ?? 'No extra details provided'}</p></div><StatusBadge>{status}</StatusBadge></div><div className="owner-booking-bottom"><span className="swap-type">{String(swap.type ?? 'UPGRADE').replace(/_/g, ' ')}</span><div className="owner-booking-actions">{status === 'pending' && <><button className="button button-outline button-tiny" disabled={busy === id} onClick={() => respond(swap, 'rejected')}><X size={14} /> Decline</button><button className="button button-green button-tiny" disabled={busy === id} onClick={() => respond(swap, 'approved')}><Check size={14} /> Approve swap</button></>}</div></div></article>; })}</div> : <EmptyState title="All clear on swaps" message="Customer swap requests will appear here for your review." action={<Link className="button button-outline button-small" to="/owner/bookings">View bookings</Link>} />}
  </>;
}
