import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, CalendarDays, MapPin, PackageOpen, ShoppingBag, Trash2 } from 'lucide-react';
import { api, getErrorMessage, unwrap } from '../services/api.js';
import { useLoad } from '../hooks/useLoad.js';
import { EmptyState, ErrorState, FormField, Loading, PageHeading } from '../components/UI.jsx';
import { useLocale } from '../context/LocaleContext.jsx';

function dateInputValue(value) {
  return value ? new Date(value).toISOString().slice(0, 10) : '';
}

function CartLine({ item, busy, onUpdate, onRemove, onCheckout, t, formatCurrency, formatAddress }) {
  const [startDate, setStartDate] = useState(dateInputValue(item.startDate));
  const [endDate, setEndDate] = useState(dateInputValue(item.endDate));
  const equipment = item.equipment;
  const image = equipment.images?.[0];
  const location = formatAddress(equipment.location) || equipment.location?.city || '';

  return (
    <article className="cart-line">
      <Link className="cart-line-image" to={`/equipment/${equipment._id}`}>
        {image ? <img src={image} alt={equipment.name} /> : <PackageOpen size={24} />}
      </Link>
      <div className="cart-line-info">
        <div className="cart-line-heading">
          <div>
            <Link to={`/equipment/${equipment._id}`}><h2>{equipment.name}</h2></Link>
            <p><MapPin size={14} /> {location}</p>
          </div>
          <button className="icon-button cart-remove" type="button" aria-label={t('cartRemove')} title={t('cartRemove')} disabled={busy} onClick={onRemove}><Trash2 size={17} /></button>
        </div>
        <div className="cart-line-pricing">
          <strong>{formatCurrency(item.rentalSubtotal)}</strong>
          <span>{item.rentalDays} {t(item.rentalDays === 1 ? 'cartDay' : 'cartDays')} × {formatCurrency(equipment.dailyRate)} {t('perDay')}</span>
          <span>{t('cartDeposit')}: {formatCurrency(item.depositAmount)}</span>
        </div>
        <div className="cart-line-bottom">
          <form className="cart-date-form" onSubmit={(event) => { event.preventDefault(); onUpdate(startDate, endDate); }}>
            <FormField label={t('rentalStartDate')} type="date" value={startDate} min={new Date().toISOString().slice(0, 10)} required onChange={(event) => setStartDate(event.target.value)} />
            <FormField label={t('rentalEndDate')} type="date" value={endDate} min={startDate || new Date().toISOString().slice(0, 10)} required onChange={(event) => setEndDate(event.target.value)} />
            <button className="button button-outline button-small" disabled={busy || startDate === dateInputValue(item.startDate) && endDate === dateInputValue(item.endDate)}>{t('cartUpdateDates')}</button>
          </form>
          <button className="button button-green button-small" type="button" disabled={busy || equipment.status !== 'available' || equipment.active === false} onClick={onCheckout}>
            {busy ? t('cartProcessing') : t('cartRequestBooking')} <ArrowRight size={15} />
          </button>
        </div>
      </div>
    </article>
  );
}

export function CartPage() {
  const { t, formatCurrency, formatAddress } = useLocale();
  const { data, loading, error, reload } = useLoad('/cart');
  const [busyItem, setBusyItem] = useState('');
  const [notice, setNotice] = useState('');
  const [formError, setFormError] = useState('');
  const navigate = useNavigate();
  const cart = data?.cart ?? data ?? { items: [] };
  const items = cart.items ?? [];

  const updateDates = async (item, startDate, endDate) => {
    setBusyItem(String(item.equipment._id));
    setFormError('');
    setNotice('');
    try {
      const response = await api.patch(`/cart/items/${item.equipment._id}`, { startDate, endDate });
      setNotice(t('cartDatesSaved'));
      await reload();
      return unwrap(response.data);
    } catch (err) {
      setFormError(getErrorMessage(err));
    } finally {
      setBusyItem('');
    }
  };

  const removeItem = async (equipmentId) => {
    setBusyItem(String(equipmentId));
    setFormError('');
    setNotice('');
    try {
      await api.delete(`/cart/items/${equipmentId}`);
      await reload();
    } catch (err) {
      setFormError(getErrorMessage(err));
    } finally {
      setBusyItem('');
    }
  };

  const requestBooking = async (item) => {
    const equipmentId = String(item.equipment._id);
    setBusyItem(equipmentId);
    setFormError('');
    setNotice('');
    let holdId;
    try {
      const holdResponse = await api.post('/bookings/holds', {
        equipmentIds: [equipmentId],
        startDate: item.startDate,
        endDate: item.endDate
      });
      const hold = unwrap(holdResponse.data);
      holdId = hold?._id ?? hold?.id;
      if (!holdId) throw new Error(t('cartHoldUnavailable'));
      const bookingResponse = await api.post('/bookings', { holdId });
      const booking = unwrap(bookingResponse.data)?.booking ?? unwrap(bookingResponse.data);
      if (!booking) throw new Error(t('cartBookingNotCreated'));
      await api.delete(`/cart/items/${equipmentId}`);
      navigate('/customer/bookings', { state: { message: t('cartBookingCreated') } });
    } catch (err) {
      if (holdId) {
        try { await api.delete(`/bookings/holds/${holdId}`); } catch { /* Hold expiry remains the server-side fallback. */ }
      }
      setFormError(getErrorMessage(err));
    } finally {
      setBusyItem('');
    }
  };

  return (
    <section className="cart-page">
      <PageHeading eyebrow={t('cartEyebrow')} title={t('cartTitle')} description={t('cartDescription')} />
      {notice && <div className="inline-success page-notice" role="status">{notice}</div>}
      {formError && <div className="inline-error page-notice" role="alert">{formError}</div>}
      {loading ? <Loading label={t('cartLoading')} /> : error ? <ErrorState message={error} onRetry={reload} /> : items.length === 0 ? (
        <EmptyState title={t('cartEmptyTitle')} message={t('cartEmptyMessage')} action={<Link className="button button-green" to="/equipment">{t('cartBrowse')} <ArrowRight size={16} /></Link>} />
      ) : (
        <div className="cart-layout">
          <section className="cart-lines" aria-label={t('cartItems')}>
            {items.map((item) => {
              const itemId = String(item.equipment._id);
              return <CartLine key={itemId} item={item} busy={busyItem === itemId} t={t} formatCurrency={formatCurrency} formatAddress={formatAddress}
                onUpdate={(startDate, endDate) => updateDates(item, startDate, endDate)}
                onRemove={() => removeItem(itemId)} onCheckout={() => requestBooking(item)} />;
            })}
          </section>
          <aside className="cart-summary">
            <h2>{t('cartSummary')}</h2>
            <div><span>{t('cartRentalSubtotal')}</span><strong>{formatCurrency(cart.subtotal ?? 0)}</strong></div>
            <div><span>{t('cartDeposit')}</span><strong>{formatCurrency(cart.depositAmount ?? 0)}</strong></div>
            <div className="cart-summary-total"><span>{t('cartTotal')}</span><strong>{formatCurrency(cart.totalAmount ?? 0)}</strong></div>
            <p><CalendarDays size={15} /> {t('cartAvailabilityNote')}</p>
            <Link className="text-link" to="/equipment">{t('cartContinueBrowsing')} <ShoppingBag size={15} /></Link>
          </aside>
        </div>
      )}
    </section>
  );
}
