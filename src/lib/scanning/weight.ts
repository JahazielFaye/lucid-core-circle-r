import type { WeightReading, WeightSource } from './types';

// This is reference metadata only, not a configured database station or live connection.
export const ZM303_STATION = { id: 'unconfigured-station', name: 'Unconfigured station', indicatorFamily: 'Avery Weigh-Tronix ZM303', platform: 'Weigh-Tronix BS-20X20 A (suffix unverified)', capacityLb: 100, intervalLb: 0.02, connection: 'UNVERIFIED' as const };

export function manualWeightReading(netWeight: number, stationId = ZM303_STATION.id): WeightReading {
  return { stationId, source: 'manual', netWeight, uom: 'LB', stable: 'unknown', zeroState: 'unknown', tareState: 'unknown', capturedAt: new Date().toISOString(), freshness: 'fresh', validationState: netWeight > 0 ? 'ready' : 'invalid' };
}

export function validateWeight(reading: WeightReading, now = Date.now()) {
  const errors: string[] = []; const warnings: string[] = [];
  if (reading.netWeight == null) errors.push('Weight unavailable — enter manually.');
  else if (reading.netWeight <= 0) errors.push('A production case requires a positive net weight.');
  if (reading.freshness !== 'fresh') errors.push('Capture a fresh weight for the next case.');
  if (reading.source === 'station' && reading.netWeight != null && Math.abs(reading.netWeight / ZM303_STATION.intervalLb - Math.round(reading.netWeight / ZM303_STATION.intervalLb)) > 0.000001) warnings.push('Station reading does not match the marked 0.02 LB interval.');
  if (reading.stable === false) warnings.push('Waiting for stable weight.');
  if (Date.parse(reading.capturedAt) < now - 5 * 60_000) errors.push('Weight reading is stale. Capture a fresh weight.');
  return { errors, warnings, valid: errors.length === 0 };
}

export type WeightBand = { minimumWeight?: number | null; maximumWeight?: number | null; policyMode: 'warning' | 'block'; active?: boolean };
export function validateWeightBand(weight: number, band?: WeightBand | null) {
  if (!band || band.active === false) return { errors: [] as string[], warnings: [] as string[] };
  const outside = (band.minimumWeight != null && weight < band.minimumWeight) || (band.maximumWeight != null && weight > band.maximumWeight);
  if (!outside) return { errors: [] as string[], warnings: [] as string[] };
  const message = 'Weight outside allowed range.';
  return band.policyMode === 'block' ? { errors: [message], warnings: [] as string[] } : { errors: [] as string[], warnings: [message] };
}

export interface WeightSourceAdapter { source: WeightSource; status(): 'manual_ready' | 'unconfigured'; capture(): Promise<WeightReading | null>; }
export const manualWeightAdapter: WeightSourceAdapter = { source: 'manual', status: () => 'manual_ready', capture: async () => null };
