import { AlertCircle, ArrowRight, LoaderCircle, PackageOpen } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useState } from 'react';
import { useLocale } from '../context/LocaleContext.jsx';
import { localizedName } from '../lib/india.js';

function locationLabel(location) {
  if (typeof location === 'string') return location;
  if (location && typeof location === 'object') {
    return [location.city, location.region ?? location.state, location.country]
      .filter(Boolean)
      .join(', ');
  }
  return '';
}

function EquipmentPhoto({ src, alt }) {
  const [failed, setFailed] = useState(false);
  return src && !failed
    ? <img src={src} alt={alt} onError={() => setFailed(true)} />
    : <div className="image-placeholder"><span>RH</span></div>;
}

export function PageHeading({ eyebrow, title, description, action }) {
  return (
    <div className="page-heading">
      <div>
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function Loading({ label }) {
  const { t } = useLocale();
  return <div className="state-panel"><LoaderCircle className="spin" size={24} /><span>{label ?? t('loadingDefault')}</span></div>;
}

export function ErrorState({ message, onRetry }) {
  const { t } = useLocale();
  return (
    <div className="state-panel error-state">
      <AlertCircle size={23} /><div><strong>{t('loadError')}</strong><span>{message}</span></div>
      {onRetry && <button className="button button-outline button-small" onClick={onRetry}>{t('retry')}</button>}
    </div>
  );
}

export function EmptyState({ title, message, action }) {
  const { t } = useLocale();
  return (
    <div className="empty-state"><span className="empty-icon"><PackageOpen size={23} /></span>
      <h3>{title ?? t('emptyDefaultTitle')}</h3><p>{message ?? t('emptyDefaultBody')}</p>{action}</div>
  );
}

export function StatusBadge({ children }) {
  const value = String(children ?? 'pending').toLowerCase().replace(/[\s_]+/g, '-');
  return <span className={`status-badge status-${value}`}>{String(children || 'Pending').replace(/[_-]/g, ' ')}</span>;
}

export function EquipmentCard({ item }) {
  const { t, locale, formatCurrency, formatAddress } = useLocale();
  const id = item.id ?? item._id;
  const title = item.name ?? item.title ?? t('equipment');
  const image = item.imageUrl ?? item.image ?? item.images?.[0];
  const rate = item.dailyRate ?? item.pricePerDay ?? item.price ?? item.rate;
  return (
    <Link to={`/equipment/${id}`} className="equipment-card">
      <div className="equipment-image">
        <EquipmentPhoto src={image} alt={title} />
        {item.category && <span className="image-tag">{localizedName(item.category, locale)}</span>}
      </div>
      <div className="equipment-card-copy">
        <div className="card-title-line"><h3>{title}</h3>{item.rating && <span className="rating">★ {item.rating}</span>}</div>
        <p>{formatAddress(item.location ?? item.city) || locationLabel(item.location ?? item.city) || t('availableNearby')}</p>
        <div className="equipment-card-bottom"><strong>{rate != null ? formatCurrency(rate) : t('askRate')}<small> {t('perDay')}</small></strong><span className="card-arrow"><ArrowRight size={16} /></span></div>
      </div>
    </Link>
  );
}

export function FormField({ label, className = '', ...props }) {
  const { as, suffix, ...inputProps } = props;
  return <label className={`form-field ${className}`}><span>{label}</span>{suffix ? <span className="input-with-suffix"><input {...inputProps} />{suffix}</span> : as === 'textarea' ? <textarea {...inputProps} /> : as === 'select' ? <select {...inputProps} /> : <input {...inputProps} />}</label>;
}
