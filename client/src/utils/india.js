const indianCurrency = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' });

export function formatIndianCurrency(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? indianCurrency.format(amount) : '—';
}

export function formatIndianDate(value, options = {}) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('en-IN', options).format(date);
}

export function formatIndianPhone(value) {
  if (!value) return '';
  const raw = String(value).trim();
  const digits = raw.replace(/\D/g, '');
  const local = digits.length === 12 && digits.startsWith('91') ? digits.slice(2)
    : digits.length === 11 && digits.startsWith('0') ? digits.slice(1) : digits;
  if (/^\d{10}$/.test(local)) return `+91 ${local.slice(0, 5)} ${local.slice(5)}`;
  return raw;
}

export function formatIndianAddress(address) {
  if (typeof address === 'string') return address;
  if (!address || typeof address !== 'object') return '';
  return [
    address.line1 ?? address.addressLine1 ?? address.street,
    address.line2 ?? address.addressLine2,
    address.city,
    address.region ?? address.state,
    address.postalCode ?? address.pincode ?? address.zip,
    address.country,
  ].filter(Boolean).join(', ');
}

export function localizedName(value, locale = 'en') {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return '';
  return value.names?.find((entry) => entry.lang === locale)?.value ?? value.name ?? '';
}
