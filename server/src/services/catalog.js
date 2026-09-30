const EquipmentAsset = require('../models/EquipmentAsset');
const EquipmentType = require('../models/EquipmentType');

async function getCategorySummaries(categories) {
  const categoryIds = categories.map((category) => category._id);
  const [typeCounts, listingCounts] = await Promise.all([
    EquipmentType.aggregate([
      { $match: { category: { $in: categoryIds }, active: true } },
      { $group: { _id: '$category', count: { $sum: 1 } } }
    ]),
    EquipmentAsset.aggregate([
      { $match: { active: true, status: 'available', equipmentType: { $ne: null } } },
      { $lookup: { from: 'equipmenttypes', localField: 'equipmentType', foreignField: '_id', as: 'type' } },
      { $unwind: '$type' },
      { $match: { 'type.active': true, 'type.category': { $in: categoryIds } } },
      { $group: { _id: '$type.category', count: { $sum: 1 } } }
    ])
  ]);
  const productsByCategory = new Map(typeCounts.map((entry) => [String(entry._id), entry.count]));
  const listingsByCategory = new Map(listingCounts.map((entry) => [String(entry._id), entry.count]));
  return categories.map((category) => ({
    ...category.toObject(),
    productCount: productsByCategory.get(String(category._id)) || 0,
    availableListingCount: listingsByCategory.get(String(category._id)) || 0
  }));
}

async function getCategoryProducts(categoryId) {
  const products = await EquipmentType.find({ category: categoryId, active: true })
    .select('name slug description descriptions shortDescription brand names defaultDailyRate replacementValue depositAmount currency specs imageUrls')
    .sort('name')
    .lean();
  if (!products.length) return [];

  const counts = await EquipmentAsset.aggregate([
    { $match: { equipmentType: { $in: products.map((product) => product._id) }, active: true, status: 'available' } },
    { $group: { _id: '$equipmentType', count: { $sum: 1 } } }
  ]);
  const listingsByType = new Map(counts.map((entry) => [String(entry._id), entry.count]));
  return products.map((product) => ({
    ...product,
    availableListingCount: listingsByType.get(String(product._id)) || 0
  }));
}

module.exports = { getCategorySummaries, getCategoryProducts };
