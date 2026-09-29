const mongoose = require('mongoose');

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function resolveTypeIds({ q, category }) {
  const typeFilter = {};
  if (category) {
    const Category = require('../models/Category');
    const isId = mongoose.Types.ObjectId.isValid(category);
    const categoryDoc = await Category.findOne(isId ? { _id: category, active: true } : {
      active: true,
      $or: [
        { slug: String(category).trim().toLowerCase() },
        { name: new RegExp(`^${escapeRegex(category)}$`, 'i') },
        { aliases: new RegExp(escapeRegex(category), 'i') },
        { 'names.value': new RegExp(`^${escapeRegex(category)}$`, 'i') }
      ]
    }).select('_id');
    if (categoryDoc) typeFilter.category = categoryDoc._id;
    else return [];
  }

  const typeQuery = { active: true, ...typeFilter };
  if (q) {
    const qValue = escapeRegex(q);
    typeQuery.$or = [
      { name: new RegExp(qValue, 'i') },
      { description: new RegExp(qValue, 'i') },
      { brand: new RegExp(qValue, 'i') },
      { aliases: { $regex: qValue, $options: 'i' } },
      { searchTerms: { $regex: qValue, $options: 'i' } },
      { taskTerms: { $regex: qValue, $options: 'i' } },
      { 'names.value': new RegExp(qValue, 'i') }
    ];
  }

  const types = await require('../models/EquipmentType').find(typeQuery).select('_id');
  return types.map((entry) => entry._id);
}

class SearchProvider {
  static async query(params = {}) {
    const q = String(params.q || '').trim();
    const category = String(params.category || '').trim();
    const city = String(params.city || '').trim();
    const condition = String(params.condition || '').trim();
    const page = Math.max(1, Number.parseInt(params.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, Number.parseInt(params.limit, 10) || 12));
    const skip = (page - 1) * limit;
    const sort = String(params.sort || 'newest');
    const minRate = params.minRate !== null && params.minRate !== undefined ? Number(params.minRate) : null;
    const maxRate = params.maxRate !== null && params.maxRate !== undefined ? Number(params.maxRate) : null;

    const typeIds = await resolveTypeIds({ q, category });
    const match = { active: true, status: 'available' };

    if (typeIds.length) {
      match.equipmentType = { $in: typeIds };
    } else if (q || category || condition) {
      match.equipmentType = { $in: [] };
    }

    if (city) {
      match.$or = [
        { 'location.city': new RegExp(escapeRegex(city), 'i') },
        { 'location.district': new RegExp(escapeRegex(city), 'i') },
        { 'location.state': new RegExp(escapeRegex(city), 'i') }
      ];
    }
    if (params.brand) match.$text = { $search: String(params.brand).trim() };
    if (condition) match.condition = condition;
    if (minRate !== null || maxRate !== null) {
      match.dailyRate = {};
      if (minRate !== null && Number.isFinite(minRate)) match.dailyRate.$gte = minRate;
      if (maxRate !== null && Number.isFinite(maxRate)) match.dailyRate.$lte = maxRate;
    }

    const sortMap = {
      price_asc: { dailyRate: 1 },
      price_desc: { dailyRate: -1 },
      newest: { createdAt: -1 },
      rating: { createdAt: -1 }
    };

    const [items, total] = await Promise.all([
      require('../models/EquipmentAsset').find(match)
        .populate({ path: 'equipmentType', populate: { path: 'category', select: 'name slug names aliases image' } })
        .populate('owner', 'name ownerVerified')
        .sort(sortMap[sort] || sortMap.newest)
        .skip(skip)
        .limit(limit)
        .lean(),
      require('../models/EquipmentAsset').countDocuments(match)
    ]);

    return {
      items,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit) || 0
      }
    };
  }
}

module.exports = { SearchProvider, searchProvider: SearchProvider };
