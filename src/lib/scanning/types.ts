export type ScanSource = 'physical_scanner' | 'phone_camera' | 'manual';
export type IdentifierProvenance = 'native' | 'legacy_source_alias' | 'unknown';
export type ValidationStatus = 'accepted' | 'warning' | 'blocked' | 'unknown';

export type ParsedGs1 = {
  itemIdentifier?: string;
  packDate?: string;
  serial?: string;
  netWeight?: number;
  weightUom?: 'LB';
  lot?: string;
  sscc?: string;
  warnings: string[];
};

export type NormalizedScanResult = {
  rawValue: string;
  scanSource: ScanSource;
  symbology?: string;
  matchedIdentifier?: string;
  identifierType?: string;
  identifierProvenance?: IdentifierProvenance;
  itemId?: string;
  itemCode?: string;
  itemDescription?: string;
  uom?: string;
  lot?: string;
  serial?: string;
  weight?: number;
  weightUom?: string;
  packDate?: string;
  pallet?: string;
  sscc?: string;
  warnings: string[];
  blockingErrors: string[];
  validationStatus: ValidationStatus;
};

export type WeightSource = 'station' | 'manual' | 'future_hid' | 'future_serial' | 'future_network';
export type WeightReading = {
  stationId: string;
  deviceId?: string;
  source: WeightSource;
  grossWeight?: number;
  tareWeight?: number;
  netWeight?: number;
  uom: 'LB';
  stable: boolean | 'unknown';
  zeroState: 'physical_zero_confirmed' | 'unknown';
  tareState: 'packaging_adjusted' | 'software_tare' | 'unknown';
  capturedAt: string;
  freshness: 'fresh' | 'consumed' | 'stale';
  rawPayload?: string;
  validationState: 'waiting' | 'reading' | 'stable' | 'ready' | 'invalid';
};

export type PrintRequest = {
  stationId: string;
  templateId: 'circle-r-case-label-v1';
  adapterStatus: 'preview_only' | 'unconfigured';
  caseId?: string;
  itemId?: string;
  itemCode?: string;
  itemIdentifier?: string;
  description: string;
  productionCode?: string;
  packDate: string;
  netWeight: number;
  uom: 'LB';
  serial?: string;
  barcodePayload?: string;
  humanReadableAi?: string;
};
