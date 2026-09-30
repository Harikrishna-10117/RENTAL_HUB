const mongoose = require('mongoose');
const { normalizeSearchText } = require('../utils/searchText');
const { validateDates, findUnavailableAssetIds } = require('./availability');
const Category = require('../models/Category');
const EquipmentType = require('../models/EquipmentType');
const EquipmentAsset = require('../models/EquipmentAsset');
const { AppError } = require('../utils/api');

function escapeRegex(value) {
  return normalizeSearchText(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function resolveTypeIds({ q, category, equipmentType }) {
  const typeFilter = { category: { $in: await Category.distinct('_id', { active: true }) } };
  if (category) {
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
  if (equipmentType) {
    if (mongoose.Types.ObjectId.isValid(equipmentType)) typeQuery._id = equipmentType;
    else {
      const typePattern = new RegExp(escapeRegex(equipmentType), 'i');
      typeQuery.$and = [{
        $or: [
          { slug: typePattern }, { name: typePattern }, { aliases: typePattern },
          { searchTerms: typePattern }, { taskTerms: typePattern }, { 'names.value': typePattern },
          { normalizedSearchTerms: typePattern }
        ]
      }];
    }
  }
  if (q) {
    const qValue = escapeRegex(q);
    const originalQuery = String(q).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    typeQuery.$and = [
      ...(typeQuery.$and || []),
      { $or: [
        { name: new RegExp(originalQuery, 'i') },
        { description: new RegExp(originalQuery, 'i') },
        { 'descriptions.value': new RegExp(originalQuery, 'i') },
        { brand: new RegExp(originalQuery, 'i') },
        { aliases: { $regex: originalQuery, $options: 'i' } },
        { searchTerms: { $regex: originalQuery, $options: 'i' } },
        { taskTerms: { $regex: originalQuery, $options: 'i' } },
        { 'names.value': new RegExp(originalQuery, 'i') },
        { normalizedSearchTerms: new RegExp(qValue, 'i') }
      ] }
    ];
  }

  const types = await EquipmentType.find(typeQuery).select('_id');
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
    const sort = String(params.sort || (q ? 'relevance' : 'newest'));
    const minRate = params.minRate !== null && params.minRate !== undefined ? Number(params.minRate) : null;
    const maxRate = params.maxRate !== null && params.maxRate !== undefined ? Number(params.maxRate) : null;
    const operatorRequired = params.operatorRequired === undefined ? null : params.operatorRequired === true || params.operatorRequired === 'true';
    const transportRequired = params.transportRequired === undefined ? null : params.transportRequired === true || params.transportRequired === 'true';

    if (params.startDate || params.endDate) {
      if (!params.startDate || !params.endDate) throw new AppError('Both rental dates are required', 400, 'INVALID_DATE_RANGE');
    }
    if (q.length > 200 || category.length > 120 || city.length > 120) {
      throw new AppError('Search filters exceed the allowed length', 400, 'INVALID_FILTER');
    }
    if (condition && !['new', 'excellent', 'good', 'fair', 'poor'].includes(condition)) {
      throw new AppError('Condition is not supported', 400, 'INVALID_CONDITION');
    }
    if ((minRate !== null && (!Number.isFinite(minRate) || minRate < 0)) ||
      (maxRate !== null && (!Number.isFinite(maxRate) || maxRate < 0)) ||
      (minRate !== null && maxRate !== null && minRate > maxRate)) {
      throw new AppError('Price range is invalid', 400, 'INVALID_PRICE_RANGE');
    }
    for (const value of [params.operatorRequired, params.transportRequired]) {
      if (value !== undefined && ![true, false, 'true', 'false'].includes(value)) {
        throw new AppError('Requirement filters must be true or false', 400, 'INVALID_FILTER');
      }
    }

    const requestedType = String(params.equipmentType || '').trim();
    const constrainedTypeIds = await resolveTypeIds({ category, equipmentType: requestedType });
    const typeIds = q ? await resolveTypeIds({ q, category, equipmentType: requestedType }) : constrainedTypeIds;
    const match = { active: true, status: 'available' };

    if (category || requestedType) {
      if (!constrainedTypeIds.length) match.equipmentType = { $in: [] };
      else match.equipmentType = { $in: constrainedTypeIds };
    }
    if (q) {
      const originalQuery = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const queryMatches = [
        ...(typeIds.length ? [{ equipmentType: { $in: typeIds } }] : []),
        { name: new RegExp(originalQuery, 'i') },
        { description: new RegExp(originalQuery, 'i') },
        { brand: new RegExp(originalQuery, 'i') },
        { model: new RegExp(originalQuery, 'i') },
        { searchText: new RegExp(escapeRegex(q), 'i') }
      ];
      match.$and = [{ $or: queryMatches }];
    } else if (!category && !requestedType && typeIds.length) {
      match.equipmentType = { $in: typeIds };
    }

    if (city) {
      match.$or = [
        { 'location.city': new RegExp(escapeRegex(city), 'i') },
        { 'location.district': new RegExp(escapeRegex(city), 'i') },
        { 'location.state': new RegExp(escapeRegex(city), 'i') }
      ];
    }
    if (params.brand) match.brand = new RegExp(escapeRegex(String(params.brand).trim()), 'i');
    if (condition) match.condition = condition;
    if (minRate !== null || maxRate !== null) {
      match.dailyRate = {};
      if (minRate !== null) match.dailyRate.$gte = minRate;
      if (maxRate !== null) match.dailyRate.$lte = maxRate;
    }
    if (operatorRequired !== null) match['operatorRequirement.required'] = operatorRequired;
    if (transportRequired !== null) match['transportRequirements.required'] = transportRequired;
    if (params.startDate && params.endDate) {
      const { start, end } = validateDates(params.startDate, params.endDate);
      match._id = { $nin: await findUnavailableAssetIds(start, end) };
    }
    if (requestedType && !constrainedTypeIds.length) {
      match.equipmentType = { $in: [] };
    }

    const sortMap = {
      price_asc: { dailyRate: 1 },
      price_desc: { dailyRate: -1 },
      newest: { createdAt: -1 },
      relevance: { createdAt: -1 }
    };

    const queryPattern = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const relevance = { $add: [
      { $cond: [{ $in: ['$equipmentType', typeIds] }, 10, 0] },
      ...['name', 'description', 'brand', 'model', 'searchText'].map((field) => ({
        $cond: [
          { $regexMatch: { input: { $ifNull: [`$${field}`, ''] }, regex: queryPattern, options: 'i' } },
          2,
          0
        ]
      }))
    ] };
    const itemQuery = sort === 'relevance' && q
      ? EquipmentAsset.aggregate([
        { $match: match },
        { $addFields: { _searchRelevance: relevance } },
        { $sort: { _searchRelevance: -1, createdAt: -1 } },
        { $skip: skip },
        { $limit: limit }
      ]).then((items) => EquipmentAsset.populate(items, [
        { path: 'equipmentType', populate: { path: 'category', select: 'name slug names aliases image' } },
        { path: 'owner', select: 'name ownerVerified verificationStatus' }
      ]))
      : EquipmentAsset.find(match)
        .populate({ path: 'equipmentType', populate: { path: 'category', select: 'name slug names aliases image' } })
        .populate('owner', 'name ownerVerified verificationStatus')
        .sort(sortMap[sort] || sortMap.newest)
        .skip(skip)
        .limit(limit)
        .lean();

    const [items, total] = await Promise.all([
      itemQuery,
      EquipmentAsset.countDocuments(match)
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
