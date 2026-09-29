const crypto = require('crypto');
const Booking = require('../models/Booking');
const ReservationHold = require('../models/ReservationHold');
const Equipment = require('../models/Equipment');
const EquipmentAsset = require('../models/EquipmentAsset');
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

async function assertAvailable(equipmentIds, startDate, endDate, excludeHoldId) {
  const assets = await Equipment.find({ _id: { $in: equipmentIds } }).select('assetRef').lean();
  const assetIds = assets.map((item) => item.assetRef).filter(Boolean);
  const [booking, hold] = await Promise.all([
    Booking.findOne({
      $and: [
        {
          $or: [
            { equipment: { $in: equipmentIds } },
            ...(assetIds.length ? [{ assets: { $in: assetIds } }] : [])
          ]
        },
        {
          $or: [
            { status: { $in: ['confirmed', 'in_progress', 'return_pending'] } },
            { status: { $in: ['pending_payment', 'payment_processing', 'approved'] }, $or: [{ paymentExpiresAt: null }, { paymentExpiresAt: { $gt: new Date() } }] }
          ]
        }
      ],
      startDate: { $lt: endDate },
      endDate: { $gt: startDate }
    }).select('_id'),
    ReservationHold.findOne({
      $or: [
        { equipment: { $in: equipmentIds } },
        ...(assetIds.length ? [{ assets: { $in: assetIds } }] : [])
      ],
      status: 'active',
      expiresAt: { $gt: new Date() },
      startDate: { $lt: endDate },
      endDate: { $gt: startDate },
      ...(excludeHoldId ? { _id: { $ne: excludeHoldId } } : {})
    }).select('_id')
  ]);
  if (booking || hold) throw new AppError('One or more items are already reserved for those dates', 409, 'DATES_UNAVAILABLE');
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

module.exports = { validateDates, assertAvailable, withReservationLocks };
