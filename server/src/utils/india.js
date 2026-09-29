function normalizeIndianPhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  const local = digits.length === 12 && digits.startsWith('91') ? digits.slice(2)
    : digits.length === 11 && digits.startsWith('0') ? digits.slice(1) : digits;
  if (!/^[6-9]\d{9}$/.test(local)) return '';
  return `+91 ${local.slice(0, 5)} ${local.slice(5)}`;
}

module.exports = { normalizeIndianPhone };
