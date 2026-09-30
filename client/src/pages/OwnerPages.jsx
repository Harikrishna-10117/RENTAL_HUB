import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowDownUp, ArrowRight, BadgeCheck, Boxes, CalendarDays, Check, CircleDollarSign, ClipboardCheck, Eye, Package, Plus, ShieldCheck, Wrench, X } from 'lucide-react';
import { api, asList, getErrorMessage, unwrap } from '../services/api.js';
import { useLoad } from '../hooks/useLoad.js';
import { BookingsTable } from './CustomerPages.jsx';
import { EmptyState, ErrorState, FormField, Loading, PageHeading, StatusBadge } from '../components/UI.jsx';
import { formatIndianCurrency, formatIndianDate, formatIndianAddress, localizedName } from '../utils/india.js';
import { useAuth } from '../context/AuthContext.jsx';
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
    {loading ? <Loading label="Loading your equipment…" /> : error ? <ErrorState message={error} onRetry={reload} /> : items.length ? <div className="equipment-listings">{items.map((item) => { const id = itemId(item); const image = item.imageUrl ?? item.image ?? item.images?.[0]; const isActive = String(item.status ?? 'active').toLowerCase() === 'active'; return <article className="listing-card" key={id}><div className="listing-photo">{image ? <img src={image} alt={item.name ?? item.title} /> : <span><Wrench size={22} /></span>}</div><div className="listing-info"><div className="listing-title-line"><h3>{item.name ?? item.title ?? 'Equipment'}</h3><StatusBadge>{item.status ?? 'active'}</StatusBadge></div><p>{localizedName(item.category, locale) || 'Uncategorized'} <span>·</span> {item.location ?? 'Location not set'}</p><strong>{formatIndianCurrency(item.dailyRate ?? item.pricePerDay ?? item.price)}<small> / day</small></strong></div><div className="listing-actions"><Link to={`/owner/equipment/${id}/edit`} className="button button-outline button-tiny">Edit listing</Link><Link to={`/owner/equipment/${id}/passport`} className="button button-outline button-tiny">Passport</Link><button disabled={busy === id} className="button button-quiet button-tiny" onClick={() => setAvailability(item, isActive ? 'inactive' : 'active')}>{busy === id ? 'Saving…' : isActive ? 'Pause listing' : 'Activate'}</button></div></article>; })}</div> : <EmptyState title="No listings yet" message="Add your first piece of equipment and make it available to your community." action={<Link to="/owner/equipment/new" className="button button-green button-small"><Plus size={15} /> Add equipment</Link>} />}
  </>;
}

export function OwnerPackagesPage() {
  const { user } = useAuth();
  const { locale } = useLocale();
  const { data: equipmentData, loading: loadingEquipment, error: equipmentError, reload: reloadEquipment } = useLoad('/owner/equipment', { list: true });
  const { data: packageData, loading: loadingPackages, error: packageError, reload: reloadPackages } = useLoad('/packages/mine', { list: true });
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [dailyRate, setDailyRate] = useState('');
  const [selectedIds, setSelectedIds] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const equipment = (equipmentData ?? []).filter((item) => {
    const availability = String(item.availability ?? item.status ?? '').toLowerCase();
    return item.active !== false && ['available', 'active'].includes(availability);
  });
  const selectedEquipment = equipment.filter((item) => selectedIds.includes(itemId(item)));
  const combinedRate = selectedEquipment.reduce((sum, item) => sum + Number(item.dailyRate || 0), 0);

  const toggleEquipment = (id) => setSelectedIds((current) => current.includes(id)
    ? current.filter((selectedId) => selectedId !== id)
    : current.length < 10 ? [...current, id] : current);

  const createPackage = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    setNotice('');
    try {
      await api.post('/packages', {
        name,
        description,
        equipment: selectedIds,
        ...(dailyRate === '' ? {} : { dailyRate: Number(dailyRate) })
      });
      setName('');
      setDescription('');
      setDailyRate('');
      setSelectedIds([]);
      setNotice('Package published to the marketplace.');
      await reloadPackages();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const packages = packageData ?? [];
  return <>
    <PageHeading eyebrow="OWNER WORKSPACE" title="Rental packages" description="Bundle your own listings into task-ready offers for renters." />
    {notice && <div className="inline-success page-notice" role="status">{notice}</div>}
    <div className="owner-package-layout">
      <section className="edit-form-card owner-package-editor">
        <div className="form-section-heading"><span><Package size={18} /></span><div><h2>Create a package</h2><p>Select 1 to 10 available listings from your inventory.</p></div></div>
        {!user?.ownerVerified && <div className="inline-error page-notice" role="status">Verify your owner profile before publishing packages.</div>}
        {error && <div className="inline-error page-notice" role="alert">{error}</div>}
        {equipmentError && <ErrorState message={equipmentError} onRetry={reloadEquipment} />}
        {loadingEquipment ? <Loading label="Loading your available listings…" /> : <form className="owner-package-form" onSubmit={createPackage}>
          <FormField label="Package name" value={name} onChange={(event) => setName(event.target.value)} maxLength={140} required />
          <FormField label="Description" as="textarea" rows="3" value={description} onChange={(event) => setDescription(event.target.value)} maxLength={2000} />
          <FormField label="Daily bundle rate (INR, optional)" type="number" min="0" step="1" value={dailyRate} onChange={(event) => setDailyRate(event.target.value)} placeholder={combinedRate ? String(Math.round(combinedRate)) : 'Leave blank to use the combined rate'} />
          <fieldset className="owner-package-picker">
            <legend>Available equipment <span>{selectedIds.length}/10 selected</span></legend>
            {equipment.length ? equipment.map((item) => {
              const id = itemId(item);
              const checked = selectedIds.includes(id);
              return <label className="owner-package-option" key={id}>
                <input type="checkbox" checked={checked} disabled={!checked && selectedIds.length >= 10} onChange={() => toggleEquipment(id)} />
                {item.images?.[0] && <img src={item.images[0]} alt="" loading="lazy" />}
                <span><b>{item.name}</b><small>{localizedName(item.category, locale) || 'Equipment'} · {formatIndianCurrency(item.dailyRate)} / day</small></span>
              </label>;
            }) : <EmptyState title="No available listings" message="Add and verify equipment before creating a package." action={<Link to="/owner/equipment/new" className="button button-outline button-small">Add equipment</Link>} />}
          </fieldset>
          {selectedIds.length > 0 && <p className="owner-package-total">Combined individual rate: <b>{formatIndianCurrency(combinedRate)} / day</b></p>}
          <button className="button button-green" disabled={saving || !user?.ownerVerified || selectedIds.length === 0 || !name.trim()}>{saving ? 'Publishing…' : 'Publish package'} <ArrowRight size={15} /></button>
        </form>}
      </section>
      <section className="owner-package-list-section">
        <div className="section-heading compact"><div><span className="eyebrow">YOUR BUNDLES</span><h2>Published packages</h2></div></div>
        {loadingPackages ? <Loading label="Loading your packages…" /> : packageError ? <ErrorState message={packageError} onRetry={reloadPackages} /> : packages.length ? <div className="owner-package-list">{packages.map((item) => <article className="owner-booking-card owner-package-card" key={itemId(item)}>
          <div className="owner-booking-head"><div><h3>{item.name}</h3><p>{item.equipment?.length ?? 0} equipment items <span>·</span> {item.active ? 'Published' : 'Paused'}</p></div><StatusBadge>{item.active ? 'active' : 'inactive'}</StatusBadge></div>
          {item.description && <p>{item.description}</p>}
          <ul>{(item.equipment ?? []).map((equipmentItem) => <li key={itemId(equipmentItem)}>{equipmentItem.name}</li>)}</ul>
          <strong>{formatIndianCurrency(item.dailyRate)} <small>/ day</small></strong>
        </article>)}</div> : <EmptyState title="No packages published" message="Choose available listings to publish your first bundle." />}
      </section>
    </div>
  </>;
}

const emptyForm = {
  name: '', description: '', category: '', brand: '', model: '', manufacturingYear: '',
  dailyRate: '', replacementValue: '', depositAmount: '', location: '', imageUrls: '',
  availability: 'available', condition: 'good',
  specifications: [],
  dimensions: { length: '', width: '', height: '', unit: 'cm' },
  weight: { value: '', unit: 'kg' },
  operatingRequirements: { notes: '' },
  operatorRequirement: { required: false, notes: '' },
  transportRequirements: { required: false, method: '', notes: '' }
};

function numericOrUndefined(value) {
  return value === '' || value === undefined || value === null ? undefined : Number(value);
}

export function EquipmentForm() {
  const { locale } = useLocale();
  const { id } = useParams();
  const navigate = useNavigate();
  const { data, loading: loadingItem, error: loadError } = useLoad(id ? `/owner/equipment/${id}` : '/owner/equipment', { enabled: Boolean(id) });
  const { data: categoryData } = useLoad('/categories', { list: true });
  const [values, setValues] = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const item = data?.equipment ?? data;
    if (id && item) setValues({
      ...emptyForm,
      ...item,
      category: typeof item.category === 'object' ? item.category.id ?? item.category._id : item.category ?? '',
      dailyRate: item.dailyRate ?? item.pricePerDay ?? item.price ?? '',
      replacementValue: item.replacementValue ?? '',
      depositAmount: item.depositAmount ?? '',
      manufacturingYear: item.manufacturingYear ?? '',
      location: typeof item.location === 'object' ? item.location.city ?? '' : item.location ?? '',
      imageUrls: (item.images ?? (item.imageUrl ?? item.image ? [item.imageUrl ?? item.image] : [])).join('\n'),
      dimensions: { ...emptyForm.dimensions, ...(item.dimensions ?? {}) },
      weight: { ...emptyForm.weight, ...(item.weight ?? {}) },
      operatingRequirements: { ...emptyForm.operatingRequirements, ...(item.operatingRequirements ?? {}) },
      operatorRequirement: { ...emptyForm.operatorRequirement, ...(item.operatorRequirement ?? {}) },
      transportRequirements: { ...emptyForm.transportRequirements, ...(item.transportRequirements ?? {}) },
      specifications: item.specifications ?? []
    });
  }, [data, id]);
  const update = (key) => (e) => setValues((current) => ({ ...current, [key]: e.target.value }));
  const uploadImage = async (event) => {
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
      setValues((current) => ({
        ...current,
        imageUrls: [...current.imageUrls.split(/\r?\n/).filter(Boolean), url].join('\n')
      }));
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setUploadingImage(false);
      event.target.value = '';
    }
  };
  const updateNested = (group, key) => (e) => setValues((current) => ({
    ...current,
    [group]: { ...current[group], [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }
  }));
  const updateSpecification = (index, field) => (e) => setValues((current) => ({
    ...current,
    specifications: current.specifications.map((spec, specIndex) => specIndex === index
      ? { ...spec, [field]: e.target.value }
      : spec)
  }));
  const submit = async (e) => {
    e.preventDefault(); setSubmitting(true); setError('');
    const payload = {
      ...values,
      dailyRate: Number(values.dailyRate),
      replacementValue: numericOrUndefined(values.replacementValue),
      depositAmount: numericOrUndefined(values.depositAmount),
      manufacturingYear: numericOrUndefined(values.manufacturingYear),
      dimensions: {
        ...values.dimensions,
        length: numericOrUndefined(values.dimensions.length),
        width: numericOrUndefined(values.dimensions.width),
        height: numericOrUndefined(values.dimensions.height)
      },
      weight: { ...values.weight, value: numericOrUndefined(values.weight.value) },
      images: values.imageUrls.split(/\r?\n/).map((url) => url.trim()).filter(Boolean)
    };
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
    <form className="edit-form-card" onSubmit={submit}>
      <div className="form-section-heading"><span><Package size={18} /></span><div><h2>Listing details</h2><p>Tell customers what makes this piece of equipment right for them.</p></div></div>
      <div className="form-grid">
        <FormField className="form-span-2" label="Equipment name" value={values.name} onChange={update('name')} maxLength={140} placeholder="e.g. Compact excavator" required />
        <FormField as="select" label="Category" value={values.category} onChange={update('category')} required><option value="">Choose a category</option>{(categoryData ?? []).map((cat) => <option key={cat.id ?? cat._id ?? cat.name} value={cat.id ?? cat._id ?? cat.name}>{localizedName(cat, locale)}</option>)}</FormField>
        <FormField label="Brand" value={values.brand} onChange={update('brand')} maxLength={100} />
        <FormField label="Model" value={values.model} onChange={update('model')} maxLength={100} />
        <FormField label="Manufacturing year" type="number" min="1900" max={new Date().getFullYear() + 1} value={values.manufacturingYear} onChange={update('manufacturingYear')} />
        <FormField label="Condition" as="select" value={values.condition} onChange={update('condition')}><option value="new">New</option><option value="excellent">Excellent</option><option value="good">Good</option><option value="fair">Fair</option></FormField>
        <FormField label="Daily rental rate (INR)" type="number" min="0" step="0.01" value={values.dailyRate} onChange={update('dailyRate')} required />
        <FormField label="Security deposit (INR)" type="number" min="0" step="0.01" value={values.depositAmount} onChange={update('depositAmount')} />
        <FormField label="Replacement value (INR)" type="number" min="0" step="0.01" value={values.replacementValue} onChange={update('replacementValue')} />
        <FormField className="form-span-2" label="Description" as="textarea" rows="5" value={values.description} onChange={update('description')} maxLength={5000} required />
        <FormField label="Pickup city" value={values.location} onChange={update('location')} placeholder="City or neighborhood" required />
        <FormField className="form-span-2" label="Upload listing image" type="file" accept="image/jpeg,image/png,image/webp" onChange={uploadImage} disabled={uploadingImage} />
        {uploadingImage && <p className="form-span-2">Uploading image…</p>}
        <FormField className="form-span-2" label="Image URLs (one per line, optional)" as="textarea" rows="3" value={values.imageUrls} onChange={update('imageUrls')} placeholder="https://…" />
        <FormField as="select" label="Availability" value={values.availability} onChange={update('availability')}><option value="available">Available</option><option value="unavailable">Unavailable</option></FormField>
      </div>
      <div className="profile-section">
        <h3>Specifications</h3>
        {values.specifications.map((spec, index) => <div className="form-grid" key={index}>
          <FormField label="Specification" value={spec.key ?? ''} onChange={updateSpecification(index, 'key')} maxLength={80} />
          <FormField label="Value" value={spec.value ?? ''} onChange={updateSpecification(index, 'value')} maxLength={300} />
          <FormField label="Unit (optional)" value={spec.unit ?? ''} onChange={updateSpecification(index, 'unit')} maxLength={30} />
          <button type="button" className="button button-quiet button-tiny" onClick={() => setValues((current) => ({ ...current, specifications: current.specifications.filter((_, specIndex) => specIndex !== index) }))}>Remove specification</button>
        </div>)}
        <button type="button" className="button button-outline button-tiny" onClick={() => setValues((current) => ({ ...current, specifications: [...current.specifications, { key: '', value: '', unit: '' }] }))}>Add specification</button>
      </div>
      <div className="profile-section">
        <h3>Dimensions and operating requirements</h3>
        <div className="form-grid">
          <FormField label="Length" type="number" min="0" step="any" value={values.dimensions.length} onChange={updateNested('dimensions', 'length')} />
          <FormField label="Width" type="number" min="0" step="any" value={values.dimensions.width} onChange={updateNested('dimensions', 'width')} />
          <FormField label="Height" type="number" min="0" step="any" value={values.dimensions.height} onChange={updateNested('dimensions', 'height')} />
          <FormField as="select" label="Dimension unit" value={values.dimensions.unit} onChange={updateNested('dimensions', 'unit')}><option value="cm">cm</option><option value="mm">mm</option><option value="m">m</option><option value="in">in</option><option value="ft">ft</option></FormField>
          <FormField label="Weight" type="number" min="0" step="any" value={values.weight.value} onChange={updateNested('weight', 'value')} />
          <FormField as="select" label="Weight unit" value={values.weight.unit} onChange={updateNested('weight', 'unit')}><option value="kg">kg</option><option value="g">g</option><option value="lb">lb</option></FormField>
          <FormField className="form-span-2" label="Operating requirements" as="textarea" value={values.operatingRequirements.notes} onChange={updateNested('operatingRequirements', 'notes')} maxLength={1000} />
          <label className="form-check"><input type="checkbox" checked={values.operatorRequirement.required} onChange={updateNested('operatorRequirement', 'required')} /> Operator required</label>
          <FormField label="Operator details" value={values.operatorRequirement.notes} onChange={updateNested('operatorRequirement', 'notes')} maxLength={1000} />
          <label className="form-check"><input type="checkbox" checked={values.transportRequirements.required} onChange={updateNested('transportRequirements', 'required')} /> Special transport required</label>
          <FormField label="Transport method" value={values.transportRequirements.method} onChange={updateNested('transportRequirements', 'method')} maxLength={100} />
          <FormField className="form-span-2" label="Transport details" as="textarea" value={values.transportRequirements.notes} onChange={updateNested('transportRequirements', 'notes')} maxLength={1000} />
        </div>
      </div>
      {error && <div className="inline-error" role="alert">{error}</div>}
      <div className="edit-form-footer"><span><ShieldCheck size={15} /> Verification status is controlled by RentalHub administration.</span><button className="button button-green" disabled={submitting}>{submitting ? 'Saving listing…' : id ? 'Save changes' : 'Publish listing'} <ArrowRight size={15} /></button></div>
    </form>
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

export function OwnerEquipmentPassport() {
  const { id } = useParams();
  const { data, loading, error, reload } = useLoad(`/owner/equipment/${id}/passport`);
  const passport = data ?? {};
  const equipment = passport.equipment ?? {};
  return <>
    <PageHeading eyebrow="EQUIPMENT HISTORY" title={equipment.name || 'Equipment Passport'} description="Rental, inspection, maintenance, and review records linked to this equipment." action={<Link className="button button-outline" to="/owner/equipment">Back to equipment</Link>} />
    {loading ? <Loading label="Loading equipment history…" /> : error ? <ErrorState message={error} onRetry={reload} /> : <>
      <section className="profile-card">
        <h2>{equipment.name}</h2>
        <p>{[equipment.assetId, equipment.brand, equipment.model, equipment.condition].filter(Boolean).join(' · ') || 'No additional equipment identifiers recorded.'}</p>
        {equipment.images?.length > 0 && <div className="card-grid">{equipment.images.map((image) => <img key={image} src={image} alt={equipment.name} />)}</div>}
      </section>
      <PassportSection title="Rental history" items={passport.rentalHistory} render={(item) => <><strong>{formatIndianDate(item.startDate)} – {formatIndianDate(item.endDate)}</strong><StatusBadge>{item.status}</StatusBadge><span>{formatIndianCurrency(item.pricing?.rentalSubtotal || 0)}</span></>} />
      <PassportSection title="Delivery inspections" items={passport.deliveryInspections} render={(item) => <><strong>{item.overallCondition}</strong><span>{item.existingDamage || 'No damage recorded'}</span><time>{formatIndianDate(item.recordedAt)}</time></>} />
      <PassportSection title="Return inspections" items={passport.returnInspections} render={(item) => <><strong>{item.condition}</strong><span>{item.damage || 'No damage recorded'}</span><time>{formatIndianDate(item.inspectedAt)}</time></>} />
      <PassportSection title="Maintenance history" items={passport.maintenanceHistory} render={(item) => <><strong>{item.type}</strong><StatusBadge>{item.status}</StatusBadge><span>{item.notes || 'No notes'}</span><time>{formatIndianDate(item.startDate)}</time></>} />
      <PassportSection title="Reviews" items={passport.reviews} render={(item) => <><strong>{item.rating} / 5</strong><span>{item.comment || 'No written comment'}</span><time>{formatIndianDate(item.createdAt)}</time></>} />
    </>}
  </>;
}

function PassportSection({ title, items = [], render }) {
  return <section className="dashboard-section"><div className="section-heading compact"><h2>{title}</h2><span>{items.length}</span></div>
    {items.length ? <div className="compact-list">{items.map((item) => <div className="compact-row" key={item._id}>{render(item)}</div>)}</div> : <EmptyState title={`No ${title.toLowerCase()}`} message="This history will appear after a related record is created." />}
  </section>;
}

export function OwnerAnalyticsPage() {
  const { data, loading, error, reload } = useLoad('/owner/analytics');
  if (loading) return <Loading label="Loading rental analytics…" />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  const analytics = data ?? {};
  return <>
    <PageHeading eyebrow="ACTUAL RENTAL HISTORY" title="Equipment performance" description="Metrics below are calculated from saved rentals, deliveries, reviews, and maintenance records." />
    <div className="metric-grid">
      <div className="metric-card"><small>Completed rentals</small><strong>{analytics.rentals?.completed ?? 0}</strong></div>
      <div className="metric-card"><small>Cancellation rate</small><strong>{analytics.rentals?.cancellationRate ?? 0}%</strong></div>
      <div className="metric-card"><small>Review average</small><strong>{analytics.reviews?.averageRating ?? '—'}</strong><span className="metric-hint">{analytics.reviews?.count ?? 0} reviews</span></div>
      <div className="metric-card"><small>On-time handovers</small><strong>{analytics.delivery?.onTimeRate == null ? '—' : `${analytics.delivery.onTimeRate}%`}</strong><span className="metric-hint">{analytics.delivery?.scheduledCount ?? 0} scheduled deliveries</span></div>
    </div>
    <PassportSection title="Utilization by equipment" items={analytics.utilization} render={(item) => <><strong>{item.name}</strong><span>{item.utilizationPercent == null ? 'No available-day history' : `${item.utilizationPercent}%`}</span><small>{item.rentedAssetDays} rented item-days · {item.maintenanceAssetDays} maintenance item-days</small></>} />
    <PassportSection title="Pricing recommendations" items={analytics.pricingRecommendations} render={(item) => <><strong>{analytics.utilization?.find((entry) => String(entry.equipmentId) === String(item.equipmentId))?.name || 'Equipment'}</strong><span>{item.available ? formatIndianCurrency(item.recommendedDailyRate) : item.message}</span></>} />
  </>;
}

export function OwnerMaintenancePage() {
  const { data: records, loading, error, reload } = useLoad('/maintenance', { list: true });
  const { data: equipment, loading: loadingEquipment } = useLoad('/owner/equipment', { list: true });
  const [values, setValues] = useState({ equipmentId: '', startDate: '', endDate: '', type: 'scheduled', quantity: '1', notes: '' });
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [formError, setFormError] = useState('');
  useEffect(() => {
    if (!values.equipmentId && equipment?.length) setValues((current) => ({ ...current, equipmentId: String(equipment[0]._id) }));
  }, [equipment, values.equipmentId]);
  const schedule = async (event) => {
    event.preventDefault();
    setBusy('schedule'); setFormError(''); setMessage('');
    try {
      await api.post(`/maintenance/equipment/${values.equipmentId}`, {
        startDate: values.startDate, endDate: values.endDate, type: values.type,
        quantity: Number(values.quantity), notes: values.notes
      });
      setMessage('Maintenance scheduled and availability blocked.');
      await reload();
    } catch (err) { setFormError(getErrorMessage(err)); }
    finally { setBusy(''); }
  };
  const updateStatus = async (record, status) => {
    setBusy(String(record._id)); setFormError(''); setMessage('');
    try {
      await api.patch(`/maintenance/${record._id}/status`, { status });
      await reload();
    } catch (err) { setFormError(getErrorMessage(err)); }
    finally { setBusy(''); }
  };
  return <>
    <PageHeading eyebrow="EQUIPMENT CARE" title="Maintenance" description="Schedule service periods that also block equipment availability." />
    {message && <div className="inline-success page-notice" role="status">{message}</div>}
    {formError && <div className="inline-error page-notice" role="alert">{formError}</div>}
    <form className="edit-form-card" onSubmit={schedule}>
      <div className="form-grid">
        <FormField as="select" label="Equipment" value={values.equipmentId} onChange={(event) => setValues({ ...values, equipmentId: event.target.value })} required disabled={loadingEquipment}>
          {(equipment || []).map((item) => <option key={item._id} value={item._id}>{item.name}</option>)}
        </FormField>
        <FormField as="select" label="Maintenance type" value={values.type} onChange={(event) => setValues({ ...values, type: event.target.value })}><option value="scheduled">Scheduled</option><option value="repair">Repair</option><option value="inspection">Inspection</option></FormField>
        <FormField label="Start date" type="date" value={values.startDate} onChange={(event) => setValues({ ...values, startDate: event.target.value })} required />
        <FormField label="End date" type="date" min={values.startDate} value={values.endDate} onChange={(event) => setValues({ ...values, endDate: event.target.value })} required />
        <FormField label="Units unavailable" type="number" min="1" value={values.quantity} onChange={(event) => setValues({ ...values, quantity: event.target.value })} required />
        <FormField label="Service notes" value={values.notes} onChange={(event) => setValues({ ...values, notes: event.target.value })} maxLength={2000} />
      </div>
      <button className="button button-green" disabled={busy === 'schedule' || loadingEquipment || !equipment?.length}>{busy === 'schedule' ? 'Scheduling…' : 'Schedule maintenance'}</button>
    </form>
    {loading ? <Loading label="Loading maintenance records…" /> : error ? <ErrorState message={error} onRetry={reload} /> : records?.length ? <div className="owner-bookings-list">{records.map((record) => <article className="owner-booking-card" key={record._id}>
      <div className="owner-booking-head"><div><h3>{record.equipment?.name || 'Equipment'}</h3><p>{formatIndianDate(record.startDate)} – {formatIndianDate(record.endDate)} · {record.type}</p></div><StatusBadge>{record.status}</StatusBadge></div>
      {record.notes && <p>{record.notes}</p>}
      <div className="owner-booking-actions">{record.status === 'SCHEDULED' && <button className="button button-outline button-tiny" disabled={busy === String(record._id)} onClick={() => updateStatus(record, 'IN_PROGRESS')}>Start service</button>}{['SCHEDULED', 'IN_PROGRESS'].includes(record.status) && <><button className="button button-outline button-tiny" disabled={busy === String(record._id)} onClick={() => updateStatus(record, 'CANCELLED')}>Cancel</button><button className="button button-green button-tiny" disabled={busy === String(record._id)} onClick={() => updateStatus(record, 'COMPLETED')}>Complete</button></>}</div>
    </article>)}</div> : <EmptyState title="No maintenance records" message="Scheduled service and repairs will appear here." />}
  </>;
}

export function OwnerReturns() {
  const { data: returns, loading, error, reload } = useLoad('/returns', { list: true });
  const { data: transporters } = useLoad('/deliveries/transporters', { list: true });
  const { formatCurrency } = useLocale();
  const [transporterByDelivery, setTransporterByDelivery] = useState({});
  const [inspection, setInspection] = useState(null);
  const [inspectionValues, setInspectionValues] = useState({ condition: 'GOOD', damage: '', meterReading: '', notes: '', evidenceUrls: '' });
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [notice, setNotice] = useState('');
  const updateReturn = async () => { await reload(); };
  const assignTransporter = async (delivery) => {
    const transporterId = transporterByDelivery[delivery._id];
    if (!transporterId) return;
    setBusy(String(delivery._id)); setErrorMessage(''); setNotice('');
    try {
      await api.post(`/deliveries/${delivery._id}/assign`, { transporterId });
      setNotice('Return pickup assigned.');
      await updateReturn();
    } catch (err) { setErrorMessage(getErrorMessage(err)); }
    finally { setBusy(''); }
  };
  const uploadEvidence = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const form = new FormData(); form.append('image', file);
    setUploading(true); setErrorMessage('');
    try {
      const response = await api.post('/uploads', form, { headers: { 'Content-Type': 'multipart/form-data' } });
      const url = response.data?.data?.url;
      if (!url) throw new Error('Image upload did not return a URL.');
      setInspectionValues((current) => ({ ...current, evidenceUrls: [...current.evidenceUrls.split(/[\n,]/).filter(Boolean), url].join('\n') }));
    } catch (err) { setErrorMessage(getErrorMessage(err)); }
    finally { setUploading(false); event.target.value = ''; }
  };
  const submitInspection = async (event) => {
    event.preventDefault();
    setBusy('inspection'); setErrorMessage('');
    try {
      await api.post(`/returns/${inspection.returnId}/inspection`, {
        equipmentId: inspection.equipmentId,
        condition: inspectionValues.condition,
        damage: inspectionValues.damage,
        checklist: { meterReading: inspectionValues.meterReading, notes: inspectionValues.notes },
        evidenceUrls: inspectionValues.evidenceUrls.split(/[\n,]/).map((value) => value.trim()).filter(Boolean)
      });
      setNotice('Return inspection saved.'); setInspection(null);
      setInspectionValues({ condition: 'GOOD', damage: '', meterReading: '', notes: '', evidenceUrls: '' });
      await updateReturn();
    } catch (err) { setErrorMessage(getErrorMessage(err)); }
    finally { setBusy(''); }
  };
  const completeReturn = async (record) => {
    setBusy(String(record._id)); setErrorMessage(''); setNotice('');
    try {
      await api.post(`/returns/${record._id}/complete`);
      setNotice('Return completed.'); await updateReturn();
    } catch (err) { setErrorMessage(getErrorMessage(err)); }
    finally { setBusy(''); }
  };
  return <>
    <PageHeading eyebrow="RENTAL RETURNS" title="Return operations" description="Assign real return pickups, inspect each returned item, and complete only after deposit processing." />
    {notice && <div className="inline-success page-notice" role="status">{notice}</div>}
    {errorMessage && !inspection && <div className="inline-error page-notice" role="alert">{errorMessage}</div>}
    {loading ? <Loading label="Loading return records…" /> : error ? <ErrorState message={error} onRetry={reload} /> : returns?.length ? <div className="owner-bookings-list">{returns.map((record) => <article className="owner-booking-card" key={record._id}>
      <div className="owner-booking-head"><div><h3>{record.equipment?.map((item) => item.name).filter(Boolean).join(', ') || 'Rental return'}</h3><p>Return #{String(record._id).slice(-8)} · {formatIndianDate(record.createdAt)}</p></div><StatusBadge>{record.status}</StatusBadge></div>
      {(record.deliveries || []).map((delivery) => {
        const equipment = record.equipment?.find((item) => String(item._id) === String(delivery.equipment));
        return <div className="profile-section" key={delivery._id}>
          <h3>{equipment?.name || 'Equipment'} · {delivery.status}</h3>
          <p>{delivery.transporter?.name || 'No transporter assigned'}{delivery.transporter?.phone ? ` · ${delivery.transporter.phone}` : ''}</p>
          {delivery.status === 'RETURN_ASSIGNED' && <div className="owner-booking-actions">
            <FormField as="select" label="Assign return transporter" value={transporterByDelivery[delivery._id] || ''} onChange={(event) => setTransporterByDelivery((current) => ({ ...current, [delivery._id]: event.target.value }))}>
              <option value="">Choose transporter</option>{(transporters || []).map((transporter) => <option key={transporter._id} value={transporter._id}>{transporter.name}{transporter.phone ? ` · ${transporter.phone}` : ''}</option>)}
            </FormField>
            <button className="button button-green button-small" disabled={busy === String(delivery._id) || !transporterByDelivery[delivery._id]} onClick={() => assignTransporter(delivery)}>Assign pickup</button>
          </div>}
          {['RETURN_ARRIVED', 'RETURN_INSPECTION'].includes(delivery.status) && <button className="button button-outline button-small" onClick={() => setInspection({ returnId: record._id, equipmentId: equipment?._id || delivery.equipment })}>Record return inspection</button>}
        </div>;
      })}
      <button className="button button-outline button-small" disabled={busy === String(record._id) || !['RETURN_ARRIVED', 'RETURN_INSPECTION'].includes(record.status)} onClick={() => completeReturn(record)}>{busy === String(record._id) ? 'Completing…' : 'Complete return'}</button>
    </article>)}</div> : <EmptyState title="No return requests" message="Customer return requests will appear here when submitted." />}
    {inspection && <div className="modal-backdrop"><form className="modal-card" onSubmit={submitInspection}>
      <button type="button" className="modal-close" onClick={() => setInspection(null)}>×</button><span className="eyebrow">RETURN INSPECTION</span><h2>Compare returned condition</h2>
      <FormField as="select" label="Condition" value={inspectionValues.condition} onChange={(event) => setInspectionValues({ ...inspectionValues, condition: event.target.value })}><option value="EXCELLENT">Excellent</option><option value="GOOD">Good</option><option value="FAIR">Fair</option><option value="DAMAGED">Damaged</option><option value="CRITICAL">Critical</option></FormField>
      <FormField label="Possible damage (cause undetermined)" as="textarea" value={inspectionValues.damage} onChange={(event) => setInspectionValues({ ...inspectionValues, damage: event.target.value })} maxLength={2000} />
      <FormField label="Meter / usage reading" value={inspectionValues.meterReading} onChange={(event) => setInspectionValues({ ...inspectionValues, meterReading: event.target.value })} maxLength={100} />
      <FormField label="Inspection notes" as="textarea" value={inspectionValues.notes} onChange={(event) => setInspectionValues({ ...inspectionValues, notes: event.target.value })} maxLength={2000} />
      <FormField label="Upload evidence photo" type="file" accept="image/jpeg,image/png,image/webp" onChange={uploadEvidence} disabled={uploading} />
      {inspectionValues.evidenceUrls && <p>{inspectionValues.evidenceUrls.split(/[\n,]/).filter(Boolean).length} evidence images attached</p>}
      {errorMessage && <div className="inline-error" role="alert">{errorMessage}</div>}
      <div className="modal-actions"><button type="button" className="button button-outline" onClick={() => setInspection(null)}>Cancel</button><button className="button button-green" disabled={busy === 'inspection' || uploading}>{busy === 'inspection' ? 'Saving…' : 'Save inspection'}</button></div>
    </form></div>}
  </>;
}
