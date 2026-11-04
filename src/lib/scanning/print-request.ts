import type { CaseLabelData } from '@/lib/production/case-label';
import type { PrintRequest } from './types';

export function prepareCasePrintRequest(label: CaseLabelData, stationId = 'station-1'): PrintRequest {
  return { stationId, templateId: 'circle-r-case-label-v1', adapterStatus: 'preview_only', caseId: label.caseIdentifier, itemCode: label.itemId || undefined, itemIdentifier: label.gtin || undefined, description: label.itemDescription, productionCode: label.productionCode || undefined, packDate: label.packDate, netWeight: label.netWeight, uom: 'LB', barcodePayload: label.gs1BarcodeValue || undefined, humanReadableAi: label.gs1HumanReadable || undefined };
}
