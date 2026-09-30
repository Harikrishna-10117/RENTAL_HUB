require('dotenv').config();
const crypto = require('node:crypto');
const mongoose = require('mongoose');
const Category = require('../models/Category');
const Equipment = require('../models/Equipment');
const EquipmentAsset = require('../models/EquipmentAsset');
const EquipmentType = require('../models/EquipmentType');
const Package = require('../models/Package');
const User = require('../models/User');
const connectDatabase = require('../config/db');
const { syncAssetForLegacy } = require('../services/inventory');
const demoProductImages = require('../seed/demoProductImages.json');

const demoOwnerEmail = process.env.DEMO_OWNER_EMAIL || 'rentalhub-demo-owner@example.test';
const demoCity = process.env.DEMO_LISTING_CITY || 'Bengaluru';
const demoRegion = process.env.DEMO_LISTING_REGION || 'Karnataka';
const categoryCodes = {
  'audio-music': 'AUD',
  'cameras-lenses': 'CAM',
  'camping-outdoors': 'CMP',
  'construction-industrial': 'CNS',
  'event-equipment': 'EVT',
  'home-garden': 'HME',
  'power-tools': 'PWR',
  'sports-fitness': 'SPT'
};
const packageDefinitions = [
  {
    name: 'Creator Studio Bundle',
    description: 'A camera, versatile lens, podcast microphone, and recording interface for a compact creator setup.',
    equipment: ['Canon EOS R50 Creator Kit', 'Sony FE 24-70mm Lens', 'Shure Podcast Microphone Kit', 'Focusrite Studio Recording Bundle']
  },
  {
    name: 'Cordless Workshop Kit',
    description: 'Everyday drilling, fastening, grinding, and cutting tools for a home workshop.',
    equipment: ['Bosch 18V Drill Driver Kit', 'Makita Impact Driver', 'Bosch Angle Grinder', 'Makita Circular Saw Kit']
  },
  {
    name: 'Outdoor Camp Weekend',
    description: 'Shelter, sleeping gear, cooking equipment, a trail backpack, and a cooler for a weekend outdoors.',
    equipment: ['Quechua 4-Person Camping Tent', 'Sleeping Bag and Mat Set', 'Coleman Portable Camping Stove', 'Trek 65L Hiking Backpack', 'Yeti Roadie 24 Cooler']
  },
  {
    name: 'Live Event Setup',
    description: 'Presentation, staging, lighting, tables, and microphones for a small event.',
    equipment: ['Epson Full HD Event Projector', 'Backdrop and Stand Kit', 'Portable LED Uplight Set', 'Folding Event Table Set', 'Wireless Event Microphone Pair']
  },
  {
    name: 'Garden Maintenance Bundle',
    description: 'Tools for trimming, mowing, washing, lifting, and cleaning around the home and garden.',
    equipment: ['Bosch Electric Hedge Trimmer', 'Electric Lawn Mower', 'Karcher Pressure Washer', 'Ladder and Tool Trolley Set', 'Wet and Dry Shop Vacuum']
  }
];

async function getDemoOwner() {
  let owner = await User.findOne({ email: demoOwnerEmail });
  if (owner) {
    if (owner.role !== 'owner' || !owner.active || !owner.ownerVerified) {
      throw new Error(`The configured demo listing owner ${demoOwnerEmail} exists but is not an active, verified owner.`);
    }
    return owner;
  }

  owner = await User.create({
    name: 'RentalHub Demo Owner',
    email: demoOwnerEmail,
    password: crypto.randomBytes(32).toString('hex'),
    role: 'owner',
    ownerVerified: true,
    verificationStatus: 'verified',
    preferredLanguage: 'en',
    address: { city: demoCity, region: demoRegion, country: 'India' },
    businessName: 'RentalHub Demo Rentals',
    businessType: 'Equipment rental'
  });
  return owner;
}

async function seedDemoListings({ apply = false } = {}) {
  await connectDatabase();
  const categories = await Category.find({ active: true }).sort({ slug: 1 });
  if (!categories.length) throw new Error('Create active categories before seeding demo listings.');
  const existingOwner = await User.findOne({ email: demoOwnerEmail }).select('_id');
  const existingPackages = existingOwner
    ? await Package.find({ owner: existingOwner._id, name: { $in: packageDefinitions.map((item) => item.name) } }).select('name active').lean()
    : [];
  const activePackageNames = new Set(existingPackages.filter((item) => item.active).map((item) => item.name));

  const plan = [];
  for (const category of categories) {
    const code = categoryCodes[category.slug];
    if (!code) throw new Error(`No demo asset code is configured for category ${category.slug}.`);
    const types = await EquipmentType.find({ category: category._id, active: true }).sort({ name: 1 });
    if (types.length !== 5) {
      throw new Error(`Expected 5 active product types in ${category.slug}; found ${types.length}.`);
    }
    for (const [index, type] of types.entries()) {
      const photo = demoProductImages[type.slug];
      if (!type.defaultDailyRate || !photo?.url || !/^https:\/\//i.test(photo.url)) {
        throw new Error(`Product type ${type.name} needs a positive daily rate and a mapped HTTPS product photo.`);
      }
      const assetId = `RH-${code}-99-${String(index + 1).padStart(2, '0')}`;
      const existing = await Equipment.findOne({ assetId }).select('_id active status name images');
      plan.push({ category, type, assetId, existing, photo });
    }
  }

  const summary = {
    mode: apply ? 'apply' : 'preview',
    categories: categories.length,
    productTypes: plan.length,
    newListings: plan.filter(({ existing }) => !existing).length,
    existingListings: plan.filter(({ existing }) => Boolean(existing)).length,
    images: plan.length,
    uniquePhotos: new Set(plan.map(({ photo }) => photo.url)).size,
    packages: packageDefinitions.length,
    newPackages: packageDefinitions.filter((item) => !activePackageNames.has(item.name)).length,
    dailyRateRangeINR: {
      minimum: Math.min(...plan.map(({ type }) => type.defaultDailyRate)),
      maximum: Math.max(...plan.map(({ type }) => type.defaultDailyRate))
    },
    owner: demoOwnerEmail,
    location: `${demoCity}, ${demoRegion}`
  };
  console.log(JSON.stringify(summary, null, 2));

  if (!apply) {
    console.log('Preview only. Pass --apply to create the demo owner and listings.');
    return summary;
  }

  const owner = await getDemoOwner();
  let created = 0;
  let skipped = 0;
  for (const { category, type, assetId, existing, photo } of plan) {
    type.imageUrls = [photo.url];
    await type.save();
    if (existing) {
      existing.images = [photo.url];
      await existing.save();
      await EquipmentAsset.updateOne(
        { $or: [{ legacyEquipment: existing._id }, { assetId }] },
        { $set: { images: [photo.url] } }
      );
      skipped += 1;
      continue;
    }
    const dailyRate = type.defaultDailyRate;
    const equipment = await Equipment.create({
      assetId,
      owner: owner._id,
      category: category._id,
      name: type.name,
      description: type.description || type.shortDescription,
      brand: type.brand || '',
      specifications: type.specs || [],
      dailyRate,
      quantity: 1,
      replacementValue: type.replacementValue || dailyRate * 10,
      depositAmount: type.depositAmount || 0,
      currency: type.currency || 'INR',
      location: { city: demoCity, region: demoRegion },
      images: [photo.url],
      condition: 'good',
      status: 'available',
      verificationStatus: 'verified',
      active: true
    });
    await syncAssetForLegacy(equipment);
    created += 1;
  }

  let packagesCreated = 0;
  let packagesSkipped = 0;
  for (const definition of packageDefinitions) {
    const existingPackage = await Package.findOne({ owner: owner._id, name: definition.name });
    if (existingPackage?.active) {
      packagesSkipped += 1;
      continue;
    }
    if (existingPackage) {
      throw new Error(`Demo package ${definition.name} is inactive; refusing to overwrite or reactivate its history.`);
    }
    const equipment = await Equipment.find({
      owner: owner._id,
      name: { $in: definition.equipment },
      active: true,
      status: 'available'
    }).select('_id name dailyRate');
    if (equipment.length !== definition.equipment.length) {
      throw new Error(`Package ${definition.name} needs ${definition.equipment.length} active demo listings; found ${equipment.length}.`);
    }
    const combinedRate = equipment.reduce((sum, item) => sum + item.dailyRate, 0);
    await Package.create({
      owner: owner._id,
      name: definition.name,
      description: definition.description,
      equipment: equipment.map((item) => item._id),
      dailyRate: Math.round(combinedRate * 0.85),
      currency: 'INR',
      active: true
    });
    packagesCreated += 1;
  }

  console.log(JSON.stringify({ created, skipped, packagesCreated, packagesSkipped, owner: demoOwnerEmail }, null, 2));
  return { ...summary, created, skipped, packagesCreated, packagesSkipped };
}

if (require.main === module) {
  seedDemoListings({ apply: process.argv.includes('--apply') })
    .catch((error) => {
      console.error(`Demo listing seed failed: ${error.message}`);
      process.exitCode = 1;
    })
    .finally(async () => mongoose.disconnect());
}

module.exports = { seedDemoListings, categoryCodes };