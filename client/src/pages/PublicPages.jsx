import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowRight, BadgeCheck, CalendarDays, ChevronDown, ChevronLeft, ChevronRight, CircleCheck, Clock3, MapPin, Search, Shield, SlidersHorizontal, Sparkles, Star, Truck, Wrench } from 'lucide-react';
import { api, asList, getErrorMessage, unwrap } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useLoad } from '../lib/useLoad.js';
import { EmptyState, EquipmentCard, ErrorState, FormField, Loading, PageHeading, StatusBadge } from '../components/UI.jsx';
import { useLocale } from '../context/LocaleContext.jsx';
import { formatIndianCurrency, localizedName } from '../lib/india.js';

const taskCards = [
  { title: 'taskBuild', hint: 'taskBuildHint', query: 'taskBuildQuery', icon: '⌁' },
  { title: 'taskEvent', hint: 'taskEventHint', query: 'taskEventQuery', icon: '✧' },
  { title: 'taskCreate', hint: 'taskCreateHint', query: 'taskCreateQuery', icon: '◉' },
  { title: 'taskExplore', hint: 'taskExploreHint', query: 'taskExploreQuery', icon: '✳' },
];

function locationName(location) {
  if (typeof location === 'string') return location;
  if (location && typeof location === 'object') {
    return [location.city, location.region ?? location.state]
      .filter(Boolean)
      .join(', ');
  }
  return '';
}

export function HomePage() {
  const { t } = useLocale();
  const [query, setQuery] = useState('');
  const { data, loading, error } = useLoad('/equipment?featured=true&limit=4', { list: true });
  const navigate = useNavigate();
  const search = (e) => { e.preventDefault(); navigate(`/equipment?q=${encodeURIComponent(query)}`); };
  return (
    <main>
      <section className="hero-section">
        <div className="hero-noise" />
        <div className="hero-container">
          <div className="hero-copy"><span className="hero-kicker"><span className="kicker-dot" /> {t('homeKicker')}</span>
            <h1>{t('tagline')}</h1>
            <p>{t('homeDescription')}</p>
            <form className="hero-search" onSubmit={search}>
              <label className="hero-search-field"><Search size={18} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('homeSearchPlaceholder')} aria-label={t('searchEquipment')} /></label>
              <button className="button button-green">{t('homeSearchAction')} <ArrowRight size={16} /></button>
            </form>
            <div className="hero-trust"><span><BadgeCheck size={15} /> {t('homeVerified')}</span><span><Shield size={15} /> {t('homeProtected')}</span></div>
          </div>
          <div className="hero-visual" aria-label={t('homeDescription')}>
            <div className="visual-frame"><img src="https://images.unsplash.com/photo-1581092921461-eab62e97a780?auto=format&fit=crop&w=1100&q=85" alt={t('homeHeroAlt')} /><div className="visual-overlay" /></div>
            <div className="floating-note"><span className="floating-note-icon"><Wrench size={18} /></span><span><b>{t('homeMoreCapability')}</b><small>{t('homeWithoutCommitment')}</small></span><span className="note-check"><CircleCheck size={17} /></span></div>
            <div className="hero-roundel"><span>{t('homeBigIdeas')}</span><span className="roundel-star">✳</span></div>
          </div>
          <div className="hero-bottom-mark"><span>01 — 04</span><div /><span>{t('tagline')}</span></div>
        </div>
      </section>
      <section className="trust-strip"><div><span className="trust-icon"><Shield size={17} /></span><b>{t('homeTrustBooking')}</b><small>{t('homeTrustPayments')}</small></div><div><span className="trust-icon"><Truck size={17} /></span><b>{t('homeTrustLocal')}</b><small>{t('homeTrustLocation')}</small></div><div><span className="trust-icon"><Sparkles size={17} /></span><b>{t('homeTrustAccess')}</b><small>{t('homeTrustRent')}</small></div></section>
      <section className="section category-section"><div className="section-heading"><div><span className="eyebrow">{t('homeTasksEyebrow')}</span><h2>{t('homeTasksTitle')}</h2></div><Link className="text-link" to="/equipment">{t('homeBrowse')} <ArrowRight size={16} /></Link></div>
        <div className="category-grid">{taskCards.map((task, i) => <Link className={`category-card category-${i % 4}`} to={`/equipment?q=${encodeURIComponent(t(task.query))}`} key={task.title}><span className="category-icon">{task.icon}</span><div><h3>{t(task.title)}</h3><p>{t(task.hint)}</p></div><ArrowRight size={17} /></Link>)}</div>
      </section>
      <section className="section featured-section"><div className="section-heading"><div><span className="eyebrow">{t('homeFeaturedEyebrow')}</span><h2>{t('homeFeaturedTitle')}</h2><p>{t('homeFeaturedDescription')}</p></div><Link className="text-link" to="/equipment">{t('homeSeeAll')} <ArrowRight size={16} /></Link></div>
        {loading ? <Loading label={t('homeLoading')} /> : error ? <ErrorState message={error} /> : data?.length ? <div className="equipment-grid">{data.slice(0, 4).map((item) => <EquipmentCard key={item.id ?? item._id} item={item} />)}</div> : <EmptyState title={t('homeEmptyTitle')} message={t('homeEmptyBody')} action={<Link className="button button-outline button-small" to="/equipment">{t('homeMarketplace')}</Link>} />}
      </section>
      <section className="owner-callout"><div><span className="eyebrow">{t('homeOwnerEyebrow')}</span><h2>{t('homeOwnerTitle')}</h2><p>{t('homeOwnerBody')}</p><Link className="button button-light" to="/register?role=owner">{t('homeBecomeOwner')} <ArrowRight size={16} /></Link></div><span className="owner-callout-art"><BoxesMark /></span></section>
    </main>
  );
}

function BoxesMark() { return <span className="boxes-mark"><span>RH</span><i>✳</i></span>; }

export function SearchPage() {
  const { t, locale } = useLocale();
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState(params.get('q') || '');
  const [category, setCategory] = useState(params.get('category') || '');
  const [sort, setSort] = useState('newest');
  const [items, setItems] = useState([]);
  const [totalResults, setTotalResults] = useState(0);
  const [pagination, setPagination] = useState({ page: 1, pages: 0 });
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [categories, setCategories] = useState([]);
  const searchQuery = params.get('q') || '';
  const categoryFilter = params.get('category') || '';

  useEffect(() => {
    api.get('/categories').then(({ data }) => setCategories(asList(data))).catch(() => {});
  }, []);
  useEffect(() => setPage(1), [searchQuery, categoryFilter]);
  useEffect(() => {
    const timer = setTimeout(async () => {
      setLoading(true); setError('');
      try {
        const search = new URLSearchParams();
        if (searchQuery) search.set('q', searchQuery);
        if (categoryFilter) search.set('category', categoryFilter);
        if (sort) search.set('sort', sort);
        search.set('page', String(page));
        search.set('limit', '12');
        const { data } = await api.get(`/equipment?${search.toString()}`);
        const result = unwrap(data);
        setItems(asList(data));
        setTotalResults(result?.pagination?.total ?? asList(data).length);
        setPagination(result?.pagination ?? { page, pages: 1 });
      } catch (err) { setError(getErrorMessage(err)); }
      finally { setLoading(false); }
    }, 200);
    return () => clearTimeout(timer);
  }, [searchQuery, categoryFilter, sort, page]);
  const apply = (e) => { e.preventDefault(); setPage(1); setParams({ ...(query ? { q: query } : {}), ...(category ? { category } : {}) }); };
  return <main className="marketplace-page section"><PageHeading eyebrow={t('marketplaceEyebrow')} title={t('marketplaceTitle')} description={t('marketplaceDescription')} />
    <form className="marketplace-filters" onSubmit={apply}><label className="filter-search"><Search size={17} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('marketplaceSearchPlaceholder')} aria-label={t('searchEquipment')} /></label><label className="select-filter"><SlidersHorizontal size={16} /><select value={category} onChange={(e) => setCategory(e.target.value)} aria-label={t('allCategories')}><option value="">{t('allCategories')}</option>{categories.map((c) => <option key={c.id ?? c._id ?? c.name} value={c.name ?? c.id}>{localizedName(c, locale)}</option>)}</select><ChevronDown size={14} /></label><label className="select-filter"><select value={sort} onChange={(e) => setSort(e.target.value)} aria-label={t('search')}><option value="newest">{t('recentlyAdded')}</option><option value="price_asc">{t('priceLowHigh')}</option><option value="price_desc">{t('priceHighLow')}</option></select><ChevronDown size={14} /></label><button className="button button-dark">{t('search')}</button></form>
    <div className="results-meta"><span>{loading ? t('searching') : t(totalResults === 1 ? 'listingsOne' : 'listingsMany', { count: totalResults })}</span><span className="results-location"><MapPin size={15} /> {t('availableNearby')}</span></div>
    {loading ? <Loading label={t('findingRight')} /> : error ? <ErrorState message={error} onRetry={() => setParams({ ...(query ? { q: query } : {}), ...(category ? { category } : {}) })} /> : items.length ? <div className="equipment-grid">{items.map((item) => <EquipmentCard key={item.id ?? item._id} item={item} />)}</div> : <EmptyState title={t('noResults')} message={t('noResultsBody')} action={<button className="button button-outline button-small" onClick={() => { setQuery(''); setCategory(''); setParams({}); }}>{t('clearFilters')}</button>} />}
    {!loading && !error && pagination.pages > 1 && <nav className="pagination-controls" aria-label={t('pagination')}><button className="button button-outline button-small" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}><ChevronLeft size={15} /> {t('previousPage')}</button><span>{t('pageIndicator', { page, pages: pagination.pages })}</span><button className="button button-outline button-small" disabled={page >= pagination.pages} onClick={() => setPage((current) => current + 1)}>{t('nextPage')} <ChevronRight size={15} /></button></nav>}
  </main>;
}

export function EquipmentDetailPage() {
  const { t, locale } = useLocale();
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data, loading, error, reload } = useLoad(`/equipment/${id}`);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [hold, setHold] = useState(null);
  const [holdCountdown, setHoldCountdown] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState('');
  const [formError, setFormError] = useState('');
  useEffect(() => {
    if (!hold?.expiresAt) return undefined;
    const updateCountdown = () => {
      const seconds = Math.max(0, Math.floor((new Date(hold.expiresAt).getTime() - Date.now()) / 1000));
      setHoldCountdown(`${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`);
      if (seconds === 0) setHold(null);
    };
    updateCountdown();
    const interval = window.setInterval(updateCountdown, 1000);
    return () => window.clearInterval(interval);
  }, [hold]);
  if (loading) return <main className="section detail-page"><Loading label="Loading equipment details…" /></main>;
  if (error) return <main className="section detail-page"><ErrorState message={error} onRetry={reload} /></main>;
  const item = data?.equipment ?? data;
  const categoryName = localizedName(item?.category, locale);
  const title = item?.name ?? item?.title ?? 'Equipment';
  const image = item?.imageUrl ?? item?.image ?? item?.images?.[0];
  const price = item?.dailyRate ?? item?.pricePerDay ?? item?.price ?? 0;
  const book = async (e) => {
    e.preventDefault(); setFormError(''); setNotice('');
    if (new Date(endDate) <= new Date(startDate)) { setFormError('Your end date must be after your start date.'); return; }
    if (!user) { navigate('/login', { state: { from: `/equipment/${id}` } }); return; }
    setSubmitting(true);
    try {
      const payload = hold?.id ? { holdId: hold.id } : { equipmentId: id, startDate, endDate };
      const { data: bookingResponse } = await api.post('/bookings', payload);
      const booking = unwrap(bookingResponse)?.booking ?? unwrap(bookingResponse);
      const bookingId = booking?.id ?? booking?._id;
      if (bookingId && !hold?.id) {
        try {
          await api.post(`/bookings/${bookingId}/hold`);
          setNotice('Your booking is created and a hold has been placed. You can track it in My bookings.');
        } catch (holdError) {
          setNotice(`Your booking request was created, but we couldn’t place the hold yet. Track it in My bookings or contact support. ${getErrorMessage(holdError)}`);
        }
      } else setNotice('Your booking request is in. You can track it in My bookings.');
      setStartDate(''); setEndDate(''); setHold(null);
    } catch (err) { setFormError(getErrorMessage(err)); }
    finally { setSubmitting(false); }
  };
  const reserve = async () => {
    setFormError(''); setNotice('');
    if (!startDate || !endDate || new Date(endDate) <= new Date(startDate)) {
      setFormError('Choose a rental period with an end date after the start date.');
      return;
    }
    if (!user) { navigate('/login', { state: { from: `/equipment/${id}` } }); return; }
    setSubmitting(true);
    try {
      const { data: response } = await api.post('/bookings/holds', {
        equipmentIds: [id],
        startDate,
        endDate,
      });
      const reservation = unwrap(response);
      setHold({
        id: reservation?._id ?? reservation?.id,
        expiresAt: reservation?.expiresAt,
      });
      setNotice('Your dates are reserved for 10 minutes. Confirm the booking before the hold expires.');
    } catch (err) { setFormError(getErrorMessage(err)); }
    finally { setSubmitting(false); }
  };
  return <main className="detail-page section">
    <div className="detail-breadcrumb"><Link to="/equipment">{t('marketplaceTitle')}</Link><span>/</span><span>{categoryName || t('equipment')}</span></div>
    <div className="detail-layout"><div className="detail-main"><div className="detail-photo">{image ? <img src={image} alt={title} /> : <div className="image-placeholder"><span>RH</span></div>}</div>
      <div className="detail-title-row"><div><span className="eyebrow">{categoryName || t('tagline')}</span><h1>{title}</h1><p><MapPin size={16} /> {locationName(item?.location ?? item?.city) || 'Location shared after booking'} <span className="detail-dot">·</span> {item?.rating ? <><Star size={15} fill="currentColor" /> {item.rating} ({item.reviewCount ?? 0} reviews)</> : 'New listing'}</p></div><StatusBadge>{item?.status ?? 'available'}</StatusBadge></div>
      <div className="detail-info-grid"><div className="detail-info-card"><span><BadgeCheck size={18} /></span><div><b>Owner checked</b><small>Quality equipment, locally listed</small></div></div><div className="detail-info-card"><span><Clock3 size={18} /></span><div><b>Flexible rental</b><small>Choose the dates that work for you</small></div></div></div>
      <section className="detail-description"><h2>About this equipment</h2><p>{item?.description ?? 'A dependable piece of equipment, ready to help bring your next project to life. Contact the owner with any questions before booking.'}</p>
        {item?.specifications && <div className="spec-list">{Object.entries(item.specifications).map(([key, value]) => <div key={key}><span>{key}</span><b>{String(value)}</b></div>)}</div>}
      </section>
    </div>
    <aside className="booking-card"><span className="eyebrow">YOUR RENTAL</span><div className="booking-price"><strong>{formatIndianCurrency(price)}</strong><span>{t('perDay')}</span></div><p className="booking-caption">No surprise fees. You’ll review payment before confirming.</p><form onSubmit={book}><FormField label="Start date" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} min={new Date().toISOString().slice(0, 10)} required /><FormField label="End date" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} min={startDate || new Date().toISOString().slice(0, 10)} required />
      {formError && <div className="inline-error">{formError}</div>}{notice && <div className="inline-success"><CircleCheck size={17} />{notice}</div>}
      {hold && <div className="booking-security" role="status"><Clock3 size={15} /> Reservation expires in {holdCountdown}</div>}
      <button className="button button-green button-full" disabled={submitting}>{submitting ? 'Placing your booking…' : hold ? 'Confirm reserved dates' : 'Request to book'} <ArrowRight size={16} /></button>
      <button type="button" className="button button-outline button-full" disabled={submitting || Boolean(hold)} onClick={reserve}>{hold ? 'Dates reserved' : 'Reserve now, decide later'}</button>
      </form><div className="booking-security"><Shield size={15} /> Secure your dates with a booking hold</div><div className="owner-mini"><span className="avatar">{(item?.owner?.name ?? item?.ownerName ?? 'O').slice(0, 1).toUpperCase()}</span><span><b>{item?.owner?.name ?? item?.ownerName ?? 'RentalHub owner'}</b><small><BadgeCheck size={12} /> Verified owner</small></span></div></aside>
    </div>
  </main>;
}

export function PackagesPage() {
  const { t } = useLocale();
  const { data, loading, error, reload } = useLoad('/packages', { list: true });
  const { user } = useAuth();
  const navigate = useNavigate();
  const [selectedPackage, setSelectedPackage] = useState(null);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [hold, setHold] = useState(null);
  const [holdCountdown, setHoldCountdown] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    if (!hold?.expiresAt) return undefined;
    const updateCountdown = () => {
      const seconds = Math.max(0, Math.floor((new Date(hold.expiresAt).getTime() - Date.now()) / 1000));
      setHoldCountdown(`${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`);
      if (seconds === 0) setHold(null);
    };
    updateCountdown();
    const interval = window.setInterval(updateCountdown, 1000);
    return () => window.clearInterval(interval);
  }, [hold]);
  const clearDialog = () => {
    setSelectedPackage(null);
    setHold(null);
    setFormError('');
    setNotice('');
    setStartDate('');
    setEndDate('');
  };
  const reservePackage = async (event) => {
    event.preventDefault();
    setFormError('');
    if (!user) {
      navigate('/login', { state: { from: '/packages' } });
      return;
    }
    setSubmitting(true);
    try {
      if (!hold) {
        const { data: response } = await api.post('/bookings/holds', {
          packageId: selectedPackage._id ?? selectedPackage.id,
          startDate,
          endDate,
        });
        const reservation = unwrap(response);
        setHold({ id: reservation?._id ?? reservation?.id, expiresAt: reservation?.expiresAt });
        setNotice('Your package is held for 10 minutes. Confirm the booking before the hold expires.');
      } else {
        await api.post('/bookings', { holdId: hold.id });
        setNotice('Package booking created. Review and complete payment in My bookings.');
        setHold(null);
      }
    } catch (err) { setFormError(getErrorMessage(err)); }
    finally { setSubmitting(false); }
  };
  const packages = data ?? [];
  return <main className="packages-page"><section className="packages-hero"><span className="eyebrow">EQUIPMENT FOR THE WHOLE PROJECT</span><h1>More done,<br /><em>less searching.</em></h1><p>Task-ready equipment bundles, curated by local owners and priced together.</p><a href="#rental-kits" className="button button-green">Explore rental kits <ArrowRight size={16} /></a></section>
    <section className="section packages-plans" id="rental-kits"><div className="section-heading"><div><span className="eyebrow">CURATED FOR YOUR NEXT TASK</span><h2>Rental packages</h2><p>Book the equipment you need together, for one simple daily rate.</p></div></div>
      {loading ? <Loading label="Loading rental packages…" /> : error ? <ErrorState message={error} onRetry={reload} /> : packages.length ? <div className="plans-grid">{packages.map((rentalPackage) => <article key={rentalPackage._id ?? rentalPackage.id} className="plan-card"><span className="plan-name">{rentalPackage.name}</span><p>{rentalPackage.description || 'A practical bundle for your next project.'}</p><div className="plan-price"><strong>{formatIndianCurrency(rentalPackage.dailyRate ?? 0)}</strong><span>{t('perDay')}</span></div><div className="plan-rule" /><span className="plan-includes">IN THIS PACKAGE</span><ul>{(rentalPackage.equipment ?? []).map((item) => <li key={item._id ?? item.id}><CircleCheck size={16} />{item.name}</li>)}</ul><button className="button button-green button-full" onClick={() => { setSelectedPackage(rentalPackage); setFormError(''); setNotice(''); }}>Reserve this package <ArrowRight size={15} /></button></article>)}</div> : <EmptyState title="No rental packages yet" message="Curated equipment bundles will appear here when local owners publish them." action={<Link className="button button-outline button-small" to="/equipment">Browse individual equipment</Link>} />}
      <div className="package-note"><Shield size={17} /><span><b>One hold for the whole kit.</b> Availability and the package price are checked by the server.</span></div>
    </section>
    {selectedPackage && <div className="modal-backdrop" role="presentation"><form className="modal-card" onSubmit={reservePackage}><button type="button" className="modal-close" onClick={clearDialog}>×</button><span className="eyebrow">PACKAGE RESERVATION</span><h2>{hold ? 'Confirm your package booking' : `Reserve ${selectedPackage.name}`}</h2><p>{formatIndianCurrency(selectedPackage.dailyRate ?? 0)} per day · {selectedPackage.equipment?.length ?? 0} equipment items</p>{!hold && <><FormField label="Start date" type="date" value={startDate} min={new Date().toISOString().slice(0, 10)} onChange={(event) => setStartDate(event.target.value)} required /><FormField label="End date" type="date" value={endDate} min={startDate || new Date().toISOString().slice(0, 10)} onChange={(event) => setEndDate(event.target.value)} required /></>}{hold && <div className="booking-security" role="status"><Clock3 size={15} /> Reservation expires in {holdCountdown}</div>}{formError && <div className="inline-error">{formError}</div>}{notice && <div className="inline-success"><CircleCheck size={17} />{notice}</div>}<div className="modal-actions"><button type="button" className="button button-outline" onClick={clearDialog}>Close</button><button className="button button-green" disabled={submitting}>{submitting ? 'Please wait…' : hold ? 'Confirm booking' : 'Reserve for 10 minutes'} <ArrowRight size={15} /></button></div></form></div>}
  </main>;
}
