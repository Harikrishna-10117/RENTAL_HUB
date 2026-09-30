function predictFromMaintenanceHistory(records, asOf = new Date()) {
  const serviceDates = (records || [])
    .filter((record) => record.status === 'COMPLETED' && record.serviceDate)
    .map((record) => new Date(record.serviceDate))
    .filter((date) => Number.isFinite(date.getTime()) && date <= asOf)
    .sort((left, right) => left - right);

  if (serviceDates.length < 3) {
    return {
      available: false,
      message: 'Insufficient usage history for a maintenance prediction.',
      completedServiceCount: serviceDates.length
    };
  }

  const intervals = serviceDates.slice(1).map((date, index) => Math.max(1,
    Math.round((date - serviceDates[index]) / 86400000)
  )).sort((left, right) => left - right);
  const middle = Math.floor(intervals.length / 2);
  const medianIntervalDays = intervals.length % 2
    ? intervals[middle]
    : Math.round((intervals[middle - 1] + intervals[middle]) / 2);
  const predictedNextServiceDate = new Date(serviceDates.at(-1).getTime() + medianIntervalDays * 86400000);

  return {
    available: true,
    predictedNextServiceDate,
    basis: { completedServiceCount: serviceDates.length, medianServiceIntervalDays: medianIntervalDays }
  };
}

module.exports = { predictFromMaintenanceHistory };