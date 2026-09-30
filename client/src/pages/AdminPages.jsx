import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, BadgeCheck, Boxes, Check, CircleAlert, Plus, ShieldCheck, Users, X } from 'lucide-react';
import { api, getErrorMessage } from '../services/api.js';
import { useLoad } from '../hooks/useLoad.js';
import { EmptyState, ErrorState, FormField, Loading, PageHeading, StatusBadge } from '../components/UI.jsx';
import { useLocale } from '../context/LocaleContext.jsx';
import { formatIndianDate, formatIndianPhone, localizedName } from '../utils/india.js';

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
  const { locale, t } = useLocale();
  const { data, loading, error, reload } = useLoad('/admin/categories', { list: true });
  const [values, setValues] = useState({ name: '', slug: '', description: '', nameHindi: '', nameTamil: '', descriptionHindi: '', descriptionTamil: '' });
  const [editing, setEditing] = useState('');
  const [busy, setBusy] = useState('');
  const [formError, setFormError] = useState('');
  const [message, setMessage] = useState('');
  const emptyValues = { name: '', slug: '', description: '', nameHindi: '', nameTamil: '', descriptionHindi: '', descriptionTamil: '' };
  const save = async (e) => { e.preventDefault(); setBusy(editing || 'add'); setFormError(''); setMessage(''); const names = [{ lang: 'en', value: values.name }, ...[['hi', values.nameHindi], ['ta', values.nameTamil]].filter(([, value]) => value.trim()).map(([lang, value]) => ({ lang, value }))]; const descriptions = [{ lang: 'en', value: values.description }, ...[['hi', values.descriptionHindi], ['ta', values.descriptionTamil]].filter(([, value]) => value.trim()).map(([lang, value]) => ({ lang, value }))]; const payload = { name: values.name, description: values.description, names, descriptions, ...(values.slug.trim() ? { slug: values.slug.trim() } : {}) }; try { if (editing) await api.patch(`/admin/categories/${editing}`, payload); else await api.post('/admin/categories', payload); setValues(emptyValues); setEditing(''); setMessage(editing ? t('categoryUpdated') : t('categoryAdded')); await reload(); } catch (err) { setFormError(getErrorMessage(err)); } finally { setBusy(''); } };
  const edit = (category) => { setEditing(idOf(category)); setValues({ ...emptyValues, name: category.name, slug: category.slug || '', description: category.description || '', nameHindi: category.names?.find((entry) => entry.lang === 'hi')?.value || '', nameTamil: category.names?.find((entry) => entry.lang === 'ta')?.value || '', descriptionHindi: category.descriptions?.find((entry) => entry.lang === 'hi')?.value || '', descriptionTamil: category.descriptions?.find((entry) => entry.lang === 'ta')?.value || '' }); setFormError(''); setMessage(''); };
  const cancelEdit = () => { setEditing(''); setValues(emptyValues); setFormError(''); };
  const toggle = async (category) => { const id = idOf(category); const active = category.active ?? category.isActive ?? true; setBusy(id); setFormError(''); try { if (active) await api.delete(`/admin/categories/${id}`); else await api.patch(`/admin/categories/${id}`, { active: true }); await reload(); } catch (err) { setFormError(getErrorMessage(err)); } finally { setBusy(''); } };
  const categories = data ?? [];
  return <><PageHeading eyebrow={t('marketplaceOrganization')} title={t('categoriesPageTitle')} description={t('categoriesPageDescription')} action={<Link className="button button-outline button-small" to="/admin/catalog">{t('manageCatalogProducts')} <ArrowRight size={14} /></Link>} />
    <div className="admin-category-layout"><section className="edit-form-card category-create"><div className="form-section-heading"><span><Plus size={18} /></span><div><h2>{editing ? t('editCategory') : t('addCategory')}</h2><p>{t('categoryFormHint')}</p></div></div><form className="category-form" onSubmit={save}><FormField label={t('categoryNameEnglish')} value={values.name} onChange={(e) => setValues({ ...values, name: e.target.value })} placeholder="e.g. Power tools" required /><FormField label={t('categoryNameHindi')} value={values.nameHindi} onChange={(e) => setValues({ ...values, nameHindi: e.target.value })} /><FormField label={t('categoryNameTamil')} value={values.nameTamil} onChange={(e) => setValues({ ...values, nameTamil: e.target.value })} /><FormField label={t('urlSlugOptional')} value={values.slug} onChange={(e) => setValues({ ...values, slug: e.target.value })} placeholder="e.g. power-tools" /><FormField label={t('categoryDescriptionOptional')} value={values.description} onChange={(e) => setValues({ ...values, description: e.target.value })} placeholder="What belongs in this category?" /><FormField label={t('categoryDescriptionHindi')} value={values.descriptionHindi} onChange={(e) => setValues({ ...values, descriptionHindi: e.target.value })} /><FormField label={t('categoryDescriptionTamil')} value={values.descriptionTamil} onChange={(e) => setValues({ ...values, descriptionTamil: e.target.value })} />{formError && <div className="inline-error">{formError}</div>}{message && <div className="inline-success"><Check size={16} />{message}</div>}<div className="category-form-actions"><button className="button button-green" disabled={Boolean(busy)}>{busy ? t('saving') : editing ? t('saveCategory') : t('addCategoryAction')} <ArrowRight size={15} /></button>{editing && <button type="button" className="button button-outline" onClick={cancelEdit}>{t('cancel')}</button>}</div></form></section>
      <section className="edit-form-card category-manage"><div className="form-section-heading"><span><Boxes size={18} /></span><div><h2>{t('categoryCurrentTitle')}</h2><p>{t('categoryCountHint')}</p></div></div>{loading ? <Loading label={t('categoryLoading')} /> : error ? <ErrorState message={error} onRetry={reload} /> : categories.length ? <div className="category-admin-list">{categories.map((category) => { const id = idOf(category); const active = category.active ?? category.isActive ?? true; return <div className="category-admin-item" key={id}><span className="category-admin-icon"><Boxes size={17} /></span><span><b>{localizedName(category, locale)}</b><small>{t('productCount', { count: category.productCount ?? 0 })} · {t('availableListings', { count: category.availableListingCount ?? 0 })}</small></span><StatusBadge>{active ? 'active' : 'inactive'}</StatusBadge><button className="button button-outline button-tiny" disabled={Boolean(busy)} onClick={() => edit(category)}>{t('edit')}</button><button className="button button-outline button-tiny" disabled={Boolean(busy)} onClick={() => toggle(category)}>{busy === id ? t('saving') : active ? t('deactivate') : t('activate')}</button></div>; })}</div> : <EmptyState title={t('noCategoryYet')} message={t('addCategoryEmptyHint')} />}</section>
    </div>
  </>;
}

export function CatalogProductsPage() {
  const { data: categories, loading: categoriesLoading, error: categoriesError, reload: reloadCategories } = useLoad('/admin/categories', { list: true });
  const { data: products, loading, error, reload } = useLoad('/admin/equipment-types', { list: true });
  const { t, locale } = useLocale();
  const emptyValues = { category: '', name: '', nameHindi: '', nameTamil: '', brand: '', description: '', descriptionHindi: '', descriptionTamil: '', searchTermsHindi: '', searchTermsTamil: '', defaultDailyRate: '' };
  const [values, setValues] = useState(emptyValues);
  const [editing, setEditing] = useState('');
  const [busy, setBusy] = useState('');
  const [actionError, setActionError] = useState('');
  const [message, setMessage] = useState('');
  const catalogCategories = (categories ?? []).filter((category) => category.active);
  const save = async (event) => {
    event.preventDefault();
    setBusy(editing || 'add');
    setActionError('');
    setMessage('');
    const names = [{ lang: 'en', value: values.name }, ...[['hi', values.nameHindi], ['ta', values.nameTamil]].filter(([, value]) => value.trim()).map(([lang, value]) => ({ lang, value }))];
    const descriptions = [{ lang: 'en', value: values.description }, ...[['hi', values.descriptionHindi], ['ta', values.descriptionTamil]].filter(([, value]) => value.trim()).map(([lang, value]) => ({ lang, value }))];
    const payload = {
      category: values.category, name: values.name, names, descriptions, brand: values.brand,
      description: values.description, defaultDailyRate: Number(values.defaultDailyRate || 0),
      searchTerms: [...values.searchTermsHindi.split(','), ...values.searchTermsTamil.split(',')].map((term) => term.trim()).filter(Boolean)
    };
    try {
      if (editing) await api.patch(`/admin/equipment-types/${editing}`, payload);
      else await api.post('/admin/equipment-types', payload);
      setValues(emptyValues);
      setEditing('');
      setMessage(editing ? 'Catalog product updated.' : 'Catalog product added.');
      await reload();
      await reloadCategories();
    } catch (err) { setActionError(getErrorMessage(err)); }
    finally { setBusy(''); }
  };
  const startEdit = (product) => {
    setEditing(idOf(product));
    setValues({
      category: product.category?._id ?? product.category ?? '',
      name: product.name || '',
      nameHindi: product.names?.find((entry) => entry.lang === 'hi')?.value || '',
      nameTamil: product.names?.find((entry) => entry.lang === 'ta')?.value || '',
      brand: product.brand || '',
      description: product.description || '',
      descriptionHindi: product.descriptions?.find((entry) => entry.lang === 'hi')?.value || '',
      descriptionTamil: product.descriptions?.find((entry) => entry.lang === 'ta')?.value || '',
      searchTermsHindi: product.searchTerms?.filter((term) => /[\u0900-\u097F]/.test(term)).join(', ') || '',
      searchTermsTamil: product.searchTerms?.filter((term) => /[\u0B80-\u0BFF]/.test(term)).join(', ') || '',
      defaultDailyRate: String(product.defaultDailyRate ?? '')
    });
    setActionError('');
    setMessage('');
  };
  const deactivate = async (product) => {
    const id = idOf(product);
    setBusy(id);
    setActionError('');
    try { await api.delete(`/admin/equipment-types/${id}`); await reload(); }
    catch (err) { setActionError(getErrorMessage(err)); }
    finally { setBusy(''); }
  };
  return <><PageHeading eyebrow={t('marketplaceOrganization')} title={t('catalogProductsTitle')} description={t('catalogPageDescription')} action={<Link className="button button-outline button-small" to="/admin/categories">{t('navCategories')} <ArrowRight size={14} /></Link>} />
    <div className="admin-category-layout catalog-admin-layout"><section className="edit-form-card category-create"><div className="form-section-heading"><span><Plus size={18} /></span><div><h2>{editing ? t('editCatalogProduct') : t('addCatalogProduct')}</h2><p>{t('productFormHint')}</p></div></div>{categoriesError ? <ErrorState message={categoriesError} onRetry={reloadCategories} /> : categoriesLoading ? <Loading label={t('categoryLoading')} /> : catalogCategories.length ? <form className="category-form" onSubmit={save}><label className="form-field"><span>{t('categoryField')}</span><select value={values.category} onChange={(event) => setValues({ ...values, category: event.target.value })} required><option value="">{t('selectCategory')}</option>{catalogCategories.map((category) => <option key={idOf(category)} value={idOf(category)}>{localizedName(category, locale)}</option>)}</select></label><FormField label={t('productNameEnglish')} value={values.name} onChange={(event) => setValues({ ...values, name: event.target.value })} maxLength={180} required /><FormField label={t('productNameHindi')} value={values.nameHindi} onChange={(event) => setValues({ ...values, nameHindi: event.target.value })} maxLength={180} /><FormField label={t('productNameTamil')} value={values.nameTamil} onChange={(event) => setValues({ ...values, nameTamil: event.target.value })} maxLength={180} /><FormField label={t('brandField')} value={values.brand} onChange={(event) => setValues({ ...values, brand: event.target.value })} maxLength={100} /><FormField as="textarea" label={t('descriptionField')} value={values.description} onChange={(event) => setValues({ ...values, description: event.target.value })} maxLength={2000} /><FormField as="textarea" label={t('productDescriptionHindi')} value={values.descriptionHindi} onChange={(event) => setValues({ ...values, descriptionHindi: event.target.value })} maxLength={2000} /><FormField as="textarea" label={t('productDescriptionTamil')} value={values.descriptionTamil} onChange={(event) => setValues({ ...values, descriptionTamil: event.target.value })} maxLength={2000} /><FormField label={t('searchTermsHindi')} value={values.searchTermsHindi} onChange={(event) => setValues({ ...values, searchTermsHindi: event.target.value })} /><FormField label={t('searchTermsTamil')} value={values.searchTermsTamil} onChange={(event) => setValues({ ...values, searchTermsTamil: event.target.value })} /><FormField label={t('defaultDailyRate')} type="number" min="0" step="0.01" value={values.defaultDailyRate} onChange={(event) => setValues({ ...values, defaultDailyRate: event.target.value })} />{actionError && <div className="inline-error">{actionError}</div>}{message && <div className="inline-success"><Check size={16} />{message}</div>}<div className="category-form-actions"><button className="button button-green" disabled={Boolean(busy)}>{busy ? t('savingChanges') : editing ? t('saveProduct') : t('addProduct')} <ArrowRight size={15} /></button>{editing && <button type="button" className="button button-outline" onClick={() => { setEditing(''); setValues(emptyValues); }}>{t('cancel')}</button>}</div></form> : <EmptyState title={t('addCategoryFirst')} message={t('catalogCategoryRequired')} />}</section>
      <section className="edit-form-card category-manage"><div className="form-section-heading"><span><Boxes size={18} /></span><div><h2>{t('catalogProductsTitle')}</h2><p>{t('catalogProductCount', { count: (products ?? []).length })}</p></div></div>{loading ? <Loading label={t('catalogLoading')} /> : error ? <ErrorState message={error} onRetry={reload} /> : products?.length ? <div className="catalog-admin-list">{products.map((product) => <div className="catalog-admin-item" key={idOf(product)}><span className="category-admin-icon"><Boxes size={17} /></span><span className="catalog-admin-copy"><b>{localizedName(product, locale) || product.name}</b><small>{localizedName(product.category, locale) || t('uncategorized')} · {product.brand || t('brandNotSet')} · {t(product.active ? 'statusActive' : 'statusInactive')}</small></span><button className="button button-outline button-tiny" disabled={Boolean(busy)} onClick={() => startEdit(product)}>{t('edit')}</button>{product.active && <button className="button button-outline button-tiny" disabled={Boolean(busy)} onClick={() => deactivate(product)}>{busy === idOf(product) ? t('saving') : t('deactivate')}</button>}</div>)}</div> : <EmptyState title={t('noCatalogProducts')} message={t('addProductEmptyHint')} />}</section>
    </div>
  </>;
}
