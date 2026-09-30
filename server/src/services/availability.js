const crypto = require('crypto');
const Booking = require('../models/Booking');
const ReservationHold = require('../models/ReservationHold');
const Equipment = require('../models/Equipment');
const EquipmentAsset = require('../models/EquipmentAsset');
const EquipmentBlockPeriod = require('../models/EquipmentBlockPeriod');
const { AppError } = require('../utils/api');

function validateDates(startDate, endDate) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start >= end) {
    throw new AppError('endDate must be later than startDate', 400, 'INVALID_DATE_RANGE');
  }
  start.setUTCHours(0, 0, 0, 0);
  end.setUTCHours(0, 0, 0, 0);
  if (start < new Date(new Date().setUTCHours(0, 0, 0, 0))) {
    throw new AppError('Rental start date cannot be in the past', 400, 'PAST_START_DATE');
  }
  return { start, end, rentalDays: Math.ceil((end - start) / 86400000) };
}

function quantityFor(lines, equipmentId, fallbackIds = []) {
  const line = (lines || []).find((entry) => String(entry.equipment) === String(equipmentId));
  if (line) return Number(line.quantity) || 1;
  return fallbackIds.some((id) => String(id) === String(equipmentId)) ? 1 : 0;
}

async function assertAvailable(equipmentIds, startDate, endDate, excludeHoldId, requestedLines = []) {
  const ids = [...new Set(equipmentIds.map(String))];
  const equipment = await Equipment.find({ _id: { $in: ids } }).select('_id assetRef quantity status').lean();
  const assetIds = equipment.map((item) => item.assetRef).filter(Boolean);
  const overlap = { startDate: { $lt: endDate }, endDate: { $gt: startDate } };
  const activeBookingStates = ['confirmed', 'in_progress', 'return_pending', 'preparing', 'in_transit', 'active', 'return_pending'];
  const [bookings, holds, blocks] = await Promise.all([
    Booking.find({
      ...overlap,
      $and: [
        { $or: [{ equipment: { $in: ids } }, ...(assetIds.length ? [{ assets: { $in: assetIds } }] : [])] },
        { $or: [
          { status: { $in: activeBookingStates } },
          { status: { $in: ['pending_payment', 'payment_processing', 'approved'] }, $or: [{ paymentExpiresAt: null }, { paymentExpiresAt: { $gt: new Date() } }] }
        ] }
      ]
    }).select('equipment equipmentQuantities assets startDate endDate'),
    ReservationHold.find({
      ...overlap,
      $or: [{ equipment: { $in: ids } }, ...(assetIds.length ? [{ assets: { $in: assetIds } }] : [])],
      status: 'active',
      expiresAt: { $gt: new Date() },
      ...(excludeHoldId ? { _id: { $ne: excludeHoldId } } : {})
    }).select('equipment equipmentQuantities startDate endDate'),
    EquipmentBlockPeriod.find({ equipment: { $in: ids }, active: true, ...overlap })
      .select('equipment quantity startDate endDate')
  ]);

  const start = new Date(startDate).getTime();
  const end = new Date(endDate).getTime();
  for (const item of equipment) {
    if (item.status !== 'available') {
      throw new AppError('One or more items cannot currently be reserved', 409, 'ITEM_UNAVAILABLE');
    }
    const requested = quantityFor(requestedLines, item._id, ids) || 1;
    const stock = item.quantity || 1;
    const intervals = [];
    for (const booking of bookings) {
      const quantity = quantityFor(booking.equipmentQuantities, item._id, booking.equipment);
      if (quantity) intervals.push({ start: booking.startDate.getTime(), end: booking.endDate.getTime(), quantity });
    }
    for (const hold of holds) {
      const quantity = quantityFor(hold.equipmentQuantities, item._id, hold.equipment);
      if (quantity) intervals.push({ start: hold.startDate.getTime(), end: hold.endDate.getTime(), quantity });
    }
    for (const block of blocks) {
      if (String(block.equipment) === String(item._id)) {
        intervals.push({
          start: block.startDate.getTime(),
          end: block.endDate.getTime(),
          quantity: block.quantity || stock
        });
      }
    }
    const candidateStarts = [start, ...intervals.map((interval) => Math.max(start, interval.start))]
      .filter((point) => point >= start && point < end);
    const peak = candidateStarts.reduce((maximum, point) => Math.max(maximum,
      intervals.reduce((total, interval) => total + (interval.start <= point && interval.end > point ? interval.quantity : 0), 0)
    ), 0);
    if (peak + requested > stock) {
      throw new AppError('One or more items are already reserved for those dates', 409, 'DATES_UNAVAILABLE');
    }
  }
}

async function findUnavailableAssetIds(startDate, endDate) {
  const now = new Date();
  const overlap = { startDate: { $lt: endDate }, endDate: { $gt: startDate } };
  const [bookings, holds] = await Promise.all([
    Booking.find({
      ...overlap,
      $or: [
        { status: { $in: ['confirmed', 'in_progress', 'return_pending'] } },
        { status: { $in: ['pending_payment', 'payment_processing', 'approved'] }, $or: [{ paymentExpiresAt: null }, { paymentExpiresAt: { $gt: now } }] }
      ]
    }).select('assets equipment').lean(),
    ReservationHold.find({
      ...overlap,
      status: 'active',
      expiresAt: { $gt: now }
    }).select('assets equipment').lean()
  ]);
  const assetIds = new Set();
  const legacyEquipmentIds = new Set();
  for (const record of [...bookings, ...holds]) {
    for (const id of record.assets || []) assetIds.add(String(id));
    for (const id of record.equipment || []) legacyEquipmentIds.add(String(id));
  }
  if (legacyEquipmentIds.size) {
    const legacyAssets = await Equipment.find({ _id: { $in: [...legacyEquipmentIds] } }).select('assetRef').lean();
    for (const item of legacyAssets) if (item.assetRef) assetIds.add(String(item.assetRef));
  }
  return [...assetIds];
}

async function withReservationLocks(equipmentIds, operation) {
  const ids = [...new Set(equipmentIds.map(String))].sort();
  const equipment = await Equipment.find({ _id: { $in: ids } }).select('_id assetRef').lean();
  if (equipment.length !== ids.length || equipment.some((item) => !item.assetRef)) {
    throw new AppError('Inventory asset is not initialized; run the inventory migration', 503, 'INVENTORY_NOT_READY');
  }
  const assetIds = equipment.map((item) => String(item.assetRef)).sort();
  const lockToken = crypto.randomUUID();
  const locked = [];
  try {
    for (const id of assetIds) {
      const item = await EquipmentAsset.findOneAndUpdate(
        {
          _id: id,
          $or: [
            { reservationLock: null },
            { reservationLock: { $exists: false } },
            { reservationLockUntil: { $lte: new Date() } }
          ]
        },
        { $set: { reservationLock: lockToken, reservationLockUntil: new Date(Date.now() + 15000) } },
        { new: true }
      ).select('_id status active');
      if (!item) throw new AppError('Reservation is busy; please retry', 409, 'RESERVATION_BUSY');
      locked.push(id);
      if (!item.active || item.status !== 'available') {
        throw new AppError('One or more items cannot currently be reserved', 409, 'ITEM_UNAVAILABLE');
      }
    }
    return await operation();
  } finally {
    if (locked.length) {
      await EquipmentAsset.updateMany(
        { _id: { $in: locked }, reservationLock: lockToken },
        { $set: { reservationLock: null, reservationLockUntil: null } }
      );
    }
  }
}

module.exports = { validateDates, assertAvailable, findUnavailableAssetIds, withReservationLocks };
