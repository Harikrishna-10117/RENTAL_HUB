const EquipmentAsset = require('../models/EquipmentAsset');
const EquipmentType = require('../models/EquipmentType');
const Category = require('../models/Category');
const Equipment = require('../models/Equipment');

async function toLegacyAsset(assetDocument) {
  const doc = assetDocument && assetDocument.toObject ? assetDocument.toObject() : { ...assetDocument };
  let type = doc.equipmentType && typeof doc.equipmentType === 'object' && doc.equipmentType.name
    ? doc.equipmentType
    : null;
  const typeId = type ? type._id : doc.equipmentType;
  if (typeId && !type) {
    type = await EquipmentType.findById(typeId).populate('category').lean();
  }
  const category = type && type.category && typeof type.category === 'object' ? type.category : null;
  const legacyName = type?.name || doc.name || doc.assetId || 'Asset';
  return {
    ...doc,
    _id: doc.legacyEquipment || doc._id,
    owner: doc.owner,
    category: category || (type ? type.category : null),
    name: doc.name || legacyName,
    description: doc.description || (type ? (type.description || type.shortDescription || '') : ''),
    brand: doc.brand || (type ? (type.brand || '') : ''),
    model: doc.model || '',
    manufacturingYear: doc.manufacturingYear ?? null,
    specifications: doc.specifications?.length ? doc.specifications : type?.specs || [],
    dimensions: doc.dimensions || {},
    weight: doc.weight || {},
    operatingRequirements: doc.operatingRequirements || {},
    operatorRequirement: doc.operatorRequirement || {},
    transportRequirements: doc.transportRequirements || {},
    dailyRate: doc.dailyRate ?? (type ? type.defaultDailyRate ?? 0 : 0),
    quantity: doc.quantity || 1,
    replacementValue: doc.replacementValue ?? (type ? type.replacementValue ?? 0 : 0),
    depositAmount: doc.depositAmount ?? (type ? type.depositAmount ?? 0 : 0),
    currency: doc.currency || (type ? type.currency : 'INR') || 'INR',
    currency: doc.currency || (type ? type.currency : 'INR') || 'INR',
    location: doc.location && (doc.location.city || doc.location.state)
      ? { city: doc.location.city || doc.location.state, region: doc.location.state || '' }
      : { city: doc.location?.city || 'Bengaluru', region: doc.location?.state || 'Karnataka' },
    images: doc.images && doc.images.length ? doc.images : (type?.imageUrls || []),
    condition: doc.condition || 'good',
    status: doc.status || 'available',
    verificationStatus: doc.verificationStatus || 'pending',
    active: doc.active !== false,
    assetId: doc.assetId,
    equipmentType: type?._id || doc.equipmentType,
    catalog: type || null
  };
}

async function ensureTypeForLegacy(item, categoryId) {
  const category = await Category.findById(categoryId);
  const fallbackName = String(item.name || item.title || 'equipment').trim();
  const fallbackSlug = fallbackName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'legacy-equipment';
  const slug = `${category ? category.slug : 'equipment'}-${fallbackSlug}`;
  const type = await EquipmentType.findOne({ category: categoryId, slug });
  if (type) return type;
  const created = await EquipmentType.create({
    category: categoryId,
    typeCode: `LEG-${Date.now().toString().slice(-6)}`,
    name: fallbackName || 'Legacy equipment',
    slug,
    description: item.description || '',
    brand: item.brand || '',
    model: item.model || '',
    manufacturingYear: item.manufacturingYear ?? null,
    specifications: item.specifications || [],
    dimensions: item.dimensions || {},
    weight: item.weight || {},
    operatingRequirements: item.operatingRequirements || {},
    operatorRequirement: item.operatorRequirement || {},
    transportRequirements: item.transportRequirements || {},
    defaultDailyRate: Number(item.dailyRate || item.pricePerDay || item.price || 0),
    replacementValue: Number(item.replacementValue || item.dailyRate * 10 || 0),
    depositAmount: Number(item.depositAmount || 0),
    currency: item.currency || 'INR',
    currency: item.currency || 'INR',
    aliases: [fallbackName || 'Legacy equipment'],
    searchTerms: [fallbackName || 'Legacy equipment'],
    taskTerms: [fallbackName || 'rental'],
    imageUrls: item.images || []
  });
  return created;
}

async function syncAssetForLegacy(item) {
  const value = item.toObject ? item.toObject() : item;
  const type = await ensureTypeForLegacy(value, value.category);
  const asset = await EquipmentAsset.findOneAndUpdate(
    { $or: [{ legacyEquipment: value._id }, ...(value.assetRef ? [{ _id: value.assetRef }] : [])] },
    {
      $set: {
        legacyEquipment: value._id,
        equipmentType: type._id,
        owner: value.owner,
        name: value.name,
        description: value.description,
        brand: value.brand || '',
        model: value.model || '',
        manufacturingYear: value.manufacturingYear ?? null,
        specifications: value.specifications || [],
        dimensions: value.dimensions || {},
        weight: value.weight || {},
        operatingRequirements: value.operatingRequirements || {},
        operatorRequirement: value.operatorRequirement || {},
        transportRequirements: value.transportRequirements || {},
        assetId: value.assetId || `RH-${String(value._id).toUpperCase()}`,
        status: value.status === 'unavailable' ? 'offline' : value.status,
        condition: value.condition || 'good',
        lifecycleState: value.active === false ? 'retired' : 'listed',
        dailyRate: value.dailyRate,
        quantity: value.quantity || 1,
        replacementValue: value.replacementValue,
        depositAmount: value.depositAmount,
        currency: value.currency || 'INR',
        currency: value.currency || 'INR',
        location: {
          city: value.location?.city || 'Bengaluru',
          state: value.location?.region || value.location?.state || 'Karnataka',
          pincode: value.location?.pincode || '',
          coordinates: value.location?.coordinates || [77.5946, 12.9716],
          formatted: value.location?.formatted || [value.location?.city, value.location?.region].filter(Boolean).join(', ')
        },
        images: value.images || [],
        verificationStatus: value.verificationStatus || 'pending',
        active: value.active !== false,
        searchText: [type.name, type.description, type.brand, ...type.aliases, ...type.searchTerms, ...type.taskTerms].filter(Boolean).join(' ')
      }
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
  if (String(value.assetRef || '') !== String(asset._id)) {
    await Equipment.updateOne(
      { _id: value._id, $or: [{ assetRef: { $ne: asset._id } }, { assetId: { $exists: false } }] },
      { $set: { assetRef: asset._id, assetId: asset.assetId } }
    );
  }
  return asset;
}

async function migrateLegacyInventory() {
  const legacyItems = await Equipment.find({}).lean();
  for (const item of legacyItems) {
    if (item.assetRef && await EquipmentAsset.exists({ _id: item.assetRef, legacyEquipment: item._id })) continue;
    const assetId = item.assetId || `legacy-${String(item._id)}`;
    const type = await ensureTypeForLegacy(item, item.category);
    const asset = await EquipmentAsset.findOneAndUpdate(
      { $or: [{ legacyEquipment: item._id }, { assetId }] },
      { $set: {
      legacyEquipment: item._id,
      assetId,
      equipmentType: type._id,
      owner: item.owner,
      name: item.name || type.name,
      description: item.description || type.description || '',
      brand: item.brand || type.brand || '',
      model: item.model || '',
      manufacturingYear: item.manufacturingYear ?? null,
      specifications: item.specifications || type.specs || [],
      dimensions: item.dimensions || {},
      weight: item.weight || {},
      operatingRequirements: item.operatingRequirements || {},
      operatorRequirement: item.operatorRequirement || {},
      transportRequirements: item.transportRequirements || {},
      dailyRate: item.dailyRate || 0,
      quantity: item.quantity || 1,
      replacementValue: item.replacementValue || 0,
      depositAmount: item.depositAmount || 0,
      currency: item.currency || 'INR',
      currency: item.currency || 'INR',
      status: item.status === 'unavailable' ? 'offline' : item.status || 'available',
      condition: item.condition || 'good',
      verificationStatus: item.verificationStatus || 'pending',
      lifecycleState: 'listed',
      location: {
        city: item.location?.city || 'Bengaluru',
        state: item.location?.region || 'Karnataka',
        pincode: '',
        coordinates: [77.5946, 12.9716],
        formatted: `${item.location?.city || 'Bengaluru'}, ${item.location?.region || 'Karnataka'}`
      },
      images: item.images || type.imageUrls || [],
      active: item.active !== false,
      notes: item.description || '',
      searchText: [type.name, type.description, type.brand, ...type.aliases, ...type.searchTerms, ...type.taskTerms].filter(Boolean).join(' ')
    } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    await Equipment.updateOne(
      { _id: item._id, $or: [{ assetRef: { $ne: asset._id } }, { assetId: { $exists: false } }] },
      { $set: { assetRef: asset._id, assetId: asset.assetId } }
    );
  }
}

async function resolveLegacyEquipmentIds(ids) {
  const requested = ids.map(String);
  const equipment = await Equipment.find({ _id: { $in: requested } }).select('_id').lean();
  const byId = new Map(equipment.map((item) => [String(item._id), String(item._id)]));
  const unresolved = requested.filter((id) => !byId.has(id));
  if (unresolved.length) {
    const assets = await EquipmentAsset.find({ _id: { $in: unresolved } }).select('_id legacyEquipment').lean();
    for (const asset of assets) {
      if (asset.legacyEquipment) byId.set(String(asset._id), String(asset.legacyEquipment));
    }
  }
  const result = requested.map((id) => byId.get(id)).filter(Boolean);
  if (result.length !== requested.length) {
    const { AppError } = require('../utils/api');
    throw new AppError('One or more inventory assets could not be found', 404, 'ITEM_UNAVAILABLE');
  }
  return result;
}

async function setAssetsLifecycle(equipmentIds, lifecycleState) {
  return EquipmentAsset.updateMany(
    {
      legacyEquipment: { $in: equipmentIds },
      ...(lifecycleState === 'listed' ? { status: { $ne: 'maintenance' } } : {})
    },
    { $set: { lifecycleState } }
  );
}

async function inspectAssets(equipmentIds, condition) {
  const needsMaintenance = condition === 'needs_repair';
  const legacyCondition = ['new', 'excellent', 'good', 'fair'].includes(condition)
    ? condition
    : needsMaintenance || condition === 'minor_damage' ? 'fair' : 'good';
  const inspectedAt = new Date();
  await Promise.all([
    EquipmentAsset.updateMany(
      { legacyEquipment: { $in: equipmentIds } },
      {
        $set: {
          condition: legacyCondition,
          status: needsMaintenance ? 'maintenance' : 'available',
          lifecycleState: needsMaintenance ? 'maintenance' : 'listed',
          lastInspectionAt: inspectedAt
        }
      }
    ),
    Equipment.updateMany(
      { _id: { $in: equipmentIds } },
      { $set: { condition: legacyCondition, status: needsMaintenance ? 'maintenance' : 'available' } }
    )
  ]);
}

module.exports = {
  toLegacyAsset,
  ensureTypeForLegacy,
  syncAssetForLegacy,
  migrateLegacyInventory,
  resolveLegacyEquipmentIds,
  setAssetsLifecycle,
  inspectAssets
};
