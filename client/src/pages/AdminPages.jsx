import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, BadgeCheck, Boxes, Check, CircleAlert, Plus, ShieldCheck, Users, X } from 'lucide-react';
import { api, getErrorMessage } from '../lib/api.js';
import { useLoad } from '../lib/useLoad.js';
import { EmptyState, ErrorState, FormField, Loading, PageHeading, StatusBadge } from '../components/UI.jsx';
import { useLocale } from '../context/LocaleContext.jsx';
import { formatIndianDate, formatIndianPhone, localizedName } from '../lib/india.js';

function idOf(item) { return item.id ?? item._id; }
export function AdminDashboard() {
  const { t } = useLocale();
  const { data: owners, loading: ownerLoading, error: ownerError, reload: reloadOwners } = useLoad('/admin/owners?status=pending', { list: true });
  const { data: categories, loading: categoryLoading } = useLoad('/admin/categories', { list: true });
  const pending = owners ?? [];
  return <><PageHeading eyebrow={t('adminDashEyebrow')} title={t('adminDashTitle')} description={t('adminDashDescription')} />
    <div className="metric-grid"><div className="metric-card"><span className="metric-icon metric-amber"><CircleAlert size={18} /></span><small>{t('ownersAwaiting')}</small><strong>{ownerLoading ? '?' : pending.length}</strong><Link className="metric-inline-link" to="/admin/owners">{t('reviewOwners')} <ArrowRight size={13} /></Link></div><div className="metric-card"><span className="metric-icon metric-green"><Boxes size={18} /></span><small>{t('marketplaceCategories')}</small><strong>{categoryLoading ? '?' : (categories ?? []).length}</strong><Link className="metric-inline-link" to="/admin/categories">{t('manageCategories')} <ArrowRight size={13} /></Link></div><div className="metric-card"><span className="metric-icon metric-blue"><ShieldCheck size={18} /></span><small>{t('marketplaceHealth')}</small><strong className="metric-word">{t('goodHands')}</strong><span className="metric-hint">{t('thankYouAdmin')}</span></div></div>
    <section className="dashboard-section"><div className="section-heading compact"><div><span className="eyebrow">{t('attention')}</span><h2>{t('ownerQueue')}</h2></div><Link to="/admin/owners" className="text-link">{t('viewQueue')} <ArrowRight size={15} /></Link></div>{ownerLoading ? <Loading label={t('loadingQueue')} /> : ownerError ? <ErrorState message={ownerError} onRetry={reloadOwners} /> : pending.length ? <div className="compact-list">{pending.slice(0, 5).map((owner) => <div className="compact-row" key={idOf(owner)}><span className="avatar">{(owner.name ?? owner.fullName ?? owner.email ?? 'O').slice(0, 1).toUpperCase()}</span><span className="compact-row-title"><b>{owner.name ?? owner.fullName ?? 'New owner'}</b><small>{owner.email}</small></span><StatusBadge>{owner.verificationStatus ?? owner.status ?? 'pending'}</StatusBadge><Link className="button button-outline button-tiny" to="/admin/owners">{t('reviewOwners')}</Link></div>)}</div> : <EmptyState title={t('noOwnersWaiting')} message={t('newOwnerRequests')} />}</section>
  </>;
}
export function OwnerVerification() {
  const { data, loading, error, reload } = useLoad('/admin/owners', { list: true });
  const [filter, setFilter] = useState('pending');
  const [busy, setBusy] = useState('');
  const [actionError, setActionError] = useState('');
  const [message, setMessage] = useState('');
  const all = data ?? [];
  const filtered = filter === 'all' ? all : all.filter((item) => String(item.verificationStatus ?? item.status ?? 'pending').toLowerCase() === filter);
  const verify = async (owner, status) => {
    setBusy(idOf(owner)); setActionError(''); setMessage('');
    try {
      await api.patch(`/admin/owners/${idOf(owner)}/verification`, { status });
      setMessage(`Owner ${status === 'verified' ? 'verified' : 'rejected'}.`); await reload();
    } catch (err) { setActionError(getErrorMessage(err)); }
    finally { setBusy(''); }
  };
  return <><PageHeading eyebrow="TRUST & SAFETY" title="Owner verification" description="Review owner details and approve trustworthy equipment providers." />
    <div className="filter-pills">{['pending', 'verified', 'rejected', 'all'].map((status) => <button key={status} onClick={() => setFilter(status)} className={filter === status ? 'selected' : ''}>{status === 'all' ? 'All owners' : status.replace(/^./, (c) => c.toUpperCase())}{status === 'pending' && <span>{all.filter((item) => String(item.verificationStatus ?? item.status ?? 'pending').toLowerCase() === 'pending').length}</span>}</button>)}</div>
    {message && <div className="inline-success page-notice"><Check size={17} />{message}</div>}{actionError && <div className="inline-error page-notice">{actionError}</div>}
    {loading ? <Loading label="Loading owner applications…" /> : error ? <ErrorState message={error} onRetry={reload} /> : filtered.length ? <div className="verification-list">{filtered.map((owner) => { const id = idOf(owner); const status = String(owner.verificationStatus ?? owner.status ?? 'pending').toLowerCase(); return <article className="verification-card" key={id}><span className="avatar verification-avatar">{(owner.name ?? owner.fullName ?? owner.email ?? 'O').slice(0, 1).toUpperCase()}</span><div className="verification-info"><div className="verification-name"><h3>{owner.name ?? owner.fullName ?? 'Owner account'}</h3><StatusBadge>{status}</StatusBadge></div><p>{owner.email ?? 'No email on file'} <span>·</span> Joined {owner.createdAt ? formatIndianDate(owner.createdAt) : 'date unavailable'}</p><div className="verification-meta"><span><Users size={14} /> {owner.businessName ?? owner.companyName ?? 'Independent owner'}</span><span><BadgeCheck size={14} /> {formatIndianPhone(owner.phone) || 'No phone provided'}</span></div>{owner.verificationNotes && <p className="verification-note">{owner.verificationNotes}</p>}</div><div className="verification-actions">{status === 'pending' && <><button className="button button-outline button-tiny" disabled={busy === id} onClick={() => verify(owner, 'rejected')}><X size={14} /> Decline</button><button className="button button-green button-tiny" disabled={busy === id} onClick={() => verify(owner, 'verified')}><Check size={14} /> Verify owner</button></>}</div></article>; })}</div> : <EmptyState title={filter === 'pending' ? 'Verification queue is clear' : `No ${filter === 'all' ? '' : `${filter} `}owners found`} message={filter === 'pending' ? 'New owner applications will appear here for review.' : 'Try another filter to see more owner accounts.'} />}
  </>;
}

export function CategoriesPage() {
  const { locale } = useLocale();
  const { data, loading, error, reload } = useLoad('/admin/categories', { list: true });
  const [values, setValues] = useState({ name: '', description: '' });
  const [busy, setBusy] = useState('');
  const [formError, setFormError] = useState('');
  const [message, setMessage] = useState('');
  const add = async (e) => { e.preventDefault(); setBusy('add'); setFormError(''); setMessage(''); try { await api.post('/admin/categories', values); setValues({ name: '', description: '' }); setMessage('Category added.'); await reload(); } catch (err) { setFormError(getErrorMessage(err)); } finally { setBusy(''); } };
  const toggle = async (category) => { const id = idOf(category); setBusy(id); setFormError(''); try { await api.patch(`/admin/categories/${id}`, { active: !(category.active ?? category.isActive ?? true) }); await reload(); } catch (err) { setFormError(getErrorMessage(err)); } finally { setBusy(''); } };
  const categories = data ?? [];
  return <><PageHeading eyebrow="MARKETPLACE ORGANIZATION" title="Equipment categories" description="Keep the marketplace easy to browse by maintaining its category list." />
    <div className="admin-category-layout"><section className="edit-form-card category-create"><div className="form-section-heading"><span><Plus size={18} /></span><div><h2>Add a category</h2><p>Give owners a clear place to list their equipment.</p></div></div><form className="category-form" onSubmit={add}><FormField label="Category name" value={values.name} onChange={(e) => setValues({ ...values, name: e.target.value })} placeholder="e.g. Power tools" required /><FormField label="Description (optional)" value={values.description} onChange={(e) => setValues({ ...values, description: e.target.value })} placeholder="What belongs in this category?" />{formError && <div className="inline-error">{formError}</div>}{message && <div className="inline-success"><Check size={16} />{message}</div>}<button className="button button-green" disabled={busy === 'add'}>{busy === 'add' ? 'Adding…' : 'Add category'} <ArrowRight size={15} /></button></form></section>
      <section className="edit-form-card category-manage"><div className="form-section-heading"><span><Boxes size={18} /></span><div><h2>Current categories</h2><p>Control which categories owners can use.</p></div></div>{loading ? <Loading label="Loading categories…" /> : error ? <ErrorState message={error} onRetry={reload} /> : categories.length ? <div className="category-admin-list">{categories.map((category) => { const id = idOf(category); const active = category.active ?? category.isActive ?? true; return <div className="category-admin-item" key={id}><span className="category-admin-icon"><Boxes size={17} /></span><span><b>{localizedName(category, locale)}</b><small>{category.description ?? 'No description'}</small></span><StatusBadge>{active ? 'active' : 'inactive'}</StatusBadge><button className="button button-outline button-tiny" disabled={busy === id} onClick={() => toggle(category)}>{busy === id ? 'Saving…' : active ? 'Deactivate' : 'Activate'}</button></div>; })}</div> : <EmptyState title="No categories yet" message="Add a category to help customers find what they need." />}</section>
    </div>
  </>;
}
