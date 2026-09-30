function normalizeSearchText(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('und');
}

module.exports = { normalizeSearchText };
