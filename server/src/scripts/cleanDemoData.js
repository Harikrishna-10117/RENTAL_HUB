require('dotenv').config();
const mongoose = require('mongoose');
const Booking = require('../models/Booking');
const Delivery = require('../models/Delivery');
const Equipment = require('../models/Equipment');
const EquipmentAsset = require('../models/EquipmentAsset');
const Package = require('../models/Package');
const ReservationHold = require('../models/ReservationHold');
const SwapRequest = require('../models/SwapRequest');
const connectDatabase = require('../config/db');

const demoAssetPattern = /^RH-(CMR|CAM|PWR|CMP|AUD|EVT|SPT|HME|CNS)-\d{2}-\d+$/;
const demoPackagePattern = /^(Repair a Home|Create a Video|Host an Event|Go Camping|Maintain a Garden|Power Tool Starter Kit|Creator Essentials Kit|Outdoor Weekend Kit|Event Presentation Kit|Creator Studio Bundle|Cordless Workshop Kit|Outdoor Camp Weekend|Live Event Setup|Garden Maintenance Bundle)$/;
const activeBookingStatuses = ['pending_payment', 'payment_processing', 'approved', 'confirmed', 'in_progress', 'return_pending'];
const activeDeliveryStatuses = ['ASSIGNED', 'ACCEPTED', 'PICKUP_PENDING', 'PICKED_UP', 'IN_TRANSIT', 'ARRIVED', 'CONDITION_CHECK', 'HANDOVER_PENDING', 'RETURN_ASSIGNED', 'RETURN_PICKUP_PENDING', 'RETURN_PICKED_UP', 'RETURN_IN_TRANSIT', 'RETURN_ARRIVED', 'RETURN_INSPECTION'];

async function hasActiveWork(asset, equipment) {
  const equipmentId = equipment?._id;
  const checks = [
    Booking.exists({ assets: asset._id, status: { $in: activeBookingStatuses } }),
    ReservationHold.exists({ assets: asset._id, status: 'active', expiresAt: { $gt: new Date() } })
  ];
  if (equipmentId) checks.push(
    Booking.exists({ equipment: equipmentId, status: { $in: activeBookingStatuses } }),
    ReservationHold.exists({ equipment: equipmentId, status: 'active', expiresAt: { $gt: new Date() } }),
    Delivery.exists({ equipment: equipmentId, status: { $in: activeDeliveryStatuses } }),
    SwapRequest.exists({ requestedEquipment: equipmentId, status: { $in: ['pending', 'accepted'] } }),
    SwapRequest.exists({ offeredEquipment: equipmentId, status: { $in: ['pending', 'accepted'] } })
  );
  return (await Promise.all(checks)).some(Boolean);
}

async function cleanDemoData({ apply = false } = {}) {
  await connectDatabase();
  const candidates = await EquipmentAsset.find({ assetId: demoAssetPattern });
  const deactivatable = [];
  const preserved = [];
  let alreadyInactive = 0;

  for (const asset of candidates) {
    const equipment = await Equipment.findOne({ assetId: asset.assetId });
    if (await hasActiveWork(asset, equipment)) preserved.push(asset.assetId);
    else if (asset.active || equipment?.active) deactivatable.push({ asset, equipment });
    else alreadyInactive += 1;
  }

  const packages = await Package.find({ name: demoPackagePattern, active: true });
  const packageCandidates = [];
  const preservedPackages = [];
  for (const item of packages) {
    const [booking, hold] = await Promise.all([
      Booking.exists({ package: item._id, status: { $in: activeBookingStatuses } }),
      ReservationHold.exists({ package: item._id, status: 'active', expiresAt: { $gt: new Date() } })
    ]);
    if (booking || hold) preservedPackages.push(item.name);
    else packageCandidates.push(item);
  }

  console.log(JSON.stringify({
    mode: apply ? 'apply' : 'preview',
    database: mongoose.connection.name,
    demoAssetsFound: candidates.length,
    assetsToDeactivate: deactivatable.length,
    assetsAlreadyInactive: alreadyInactive,
    assetsPreservedForActiveWork: preserved,
    demoPackagesFound: packages.length,
    packagesToDeactivate: packageCandidates.length,
    packagesPreservedForHistory: preservedPackages
  }, null, 2));

  if (apply) {
    for (const { asset, equipment } of deactivatable) {
      asset.active = false;
      asset.status = 'offline';
      asset.lifecycleState = 'retired';
      await asset.save();
      if (equipment) {
        equipment.active = false;
        equipment.status = 'unavailable';
        await equipment.save();
      }
    }
    await Package.updateMany(
      { _id: { $in: packageCandidates.map((item) => item._id) } },
      { $set: { active: false } }
    );
    console.log('Known demo inventory and packages were deactivated. Existing transaction history was preserved.');
  } else {
    console.log('Preview only. Run with --apply to deactivate these records.');
  }
}

if (require.main === module) {
  if (process.argv.includes('--help')) {
    console.log('Usage: npm run demo:clean [-- --apply]');
    process.exit(0);
  }
  cleanDemoData({ apply: process.argv.includes('--apply') })
    .catch((error) => {
      console.error(`Demo cleanup failed: ${error.message}`);
      process.exitCode = 1;
    })
    .finally(async () => mongoose.disconnect());
}

module.exports = { cleanDemoData, demoAssetPattern, demoPackagePattern };