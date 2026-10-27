import 'server-only';

import type { NormalizedSpsPurchaseOrder } from './sps-po-normalizer';
import {
  circleRMockMappings,
  type CircleRItemMapping,
  type CircleRMappingConfiguration,
} from './circle-r-sps-mappings';

type MappingStatus = 'mapped' | 'unmapped';
type ItemMappingStatus = MappingStatus | 'ambiguous';
type ReviewStatus = 'ready' | 'needs_review' | 'unmapped';

export type CircleRMappingException = {
  code: string;
  severity: 'info' | 'warning' | 'blocking';
  field: string | null;
  lineNumber: string | null;
  message: string;
  suggestedActions: string[];
};

export type CircleROrderCandidate = {
  source: 'sps';
  status: ReviewStatus;
  mapping: {
    mappedFields: string[];
    unmappedFields: string[];
    confidence: 'high' | 'medium' | 'low';
  };
  order: {
    poNumber: string | null;
    poDate: string | null;
    requestedDate: string | null;
    tradingPartnerId: string | null;
    customer: {
      spsTradingPartnerId: string | null;
      spsName: string | null;
      foodConnexCustomerId: string | null;
      foodConnexCustomerName: string | null;
      mappingStatus: MappingStatus;
    };
    shipTo: {
      spsLocationCode: string | null;
      spsName: string | null;
      foodConnexShipToId: string | null;
      foodConnexShipToName: string | null;
      mappingStatus: MappingStatus;
    };
    lines: Array<{
      lineNumber: string | null;
      buyerPartNumber: string | null;
      vendorPartNumber: string | null;
      gtin: string | null;
      mappedFoodConnexItemId: string | null;
      mappedFoodConnexItemNumber: string | null;
      quantity: number | null;
      spsUom: string | null;
      foodConnexUom: string | null;
      spsPurchasePrice: number | null;
      approvedCircleRPrice: number | null;
      itemMappingStatus: ItemMappingStatus;
      priceStatus: 'match' | 'mismatch' | 'unknown';
      uomStatus: 'match' | 'mismatch' | 'unknown';
    }>;
  };
  exceptions: CircleRMappingException[];
};

/**
 * Maps normalized SPS data through explicit Circle R records only. It does not
 * create orders, choose a conflicting price, convert UOMs, or call Food Connex.
 */
export function mapSpsPurchaseOrderToCircleR(
  purchaseOrder: NormalizedSpsPurchaseOrder,
  mappings: CircleRMappingConfiguration = circleRMockMappings,
): CircleROrderCandidate {
  const exceptions: CircleRMappingException[] = [];
  const mappedFields: string[] = ['poNumber', 'poDate', 'tradingPartnerId'];
  const unmappedFields: string[] = [];
  const customerMapping = mappings.customers.find(
    (mapping) => mapping.spsTradingPartnerId === purchaseOrder.tradingPartnerId,
  );
  const shipToMapping = mappings.shipTos.find(
    (mapping) => mapping.spsLocationCode === purchaseOrder.shipTo?.locationNumber,
  );

  if (customerMapping) {
    mappedFields.push('customer');
  } else {
    unmappedFields.push('customer');
    exceptions.push(unmappedException('CUSTOMER_UNMAPPED', 'customer', null));
  }

  if (shipToMapping) {
    mappedFields.push('shipTo');
  } else {
    unmappedFields.push('shipTo');
    exceptions.push(unmappedException('SHIP_TO_UNMAPPED', 'shipTo', null));
  }

  // Date qualifier semantics must be configured before assigning a requested date.
  unmappedFields.push('requestedDate');
  exceptions.push({
    code: 'REQUESTED_DATE_UNMAPPED',
    severity: 'info',
    field: 'requestedDate',
    lineNumber: null,
    message: 'SPS date qualifier semantics are not configured for Circle R yet.',
    suggestedActions: ['Configure date qualifier mapping'],
  });

  if (purchaseOrder.validation.quantityMatchesHeader === false) {
    exceptions.push({
      code: 'HEADER_QUANTITY_MISMATCH',
      severity: 'warning',
      field: 'headerQuantityTotal',
      lineNumber: null,
      message: 'The calculated line quantity differs from the SPS header total.',
      suggestedActions: ['Review SPS order totals', 'Needs leadership review'],
    });
  }

  const lines = purchaseOrder.lines.map((line) => {
    const itemMatches = findItemMatches(line, mappings.items);
    const item = itemMatches.length === 1 ? itemMatches[0] : null;
    const itemMappingStatus: ItemMappingStatus = item
      ? 'mapped'
      : itemMatches.length > 1
        ? 'ambiguous'
        : 'unmapped';

    if (itemMappingStatus === 'mapped') {
      mappedFields.push(`lines.${line.lineNumber ?? 'unknown'}.item`);
    } else {
      unmappedFields.push(`lines.${line.lineNumber ?? 'unknown'}.item`);
      exceptions.push({
        code:
          itemMappingStatus === 'ambiguous'
            ? 'ITEM_MAPPING_AMBIGUOUS'
            : 'ITEM_UNMAPPED',
        severity: itemMappingStatus === 'ambiguous' ? 'warning' : 'blocking',
        field: 'item',
        lineNumber: line.lineNumber,
        message:
          itemMappingStatus === 'ambiguous'
            ? 'Multiple explicit item mappings match this SPS line.'
            : 'No explicit item mapping matches this SPS line.',
        suggestedActions: ['Review item mapping', 'Update mapping'],
      });
    }

    const priceStatus = getPriceStatus(line.purchasePrice, item?.approvedCircleRPrice);
    if (priceStatus === 'mismatch') {
      exceptions.push({
        code: 'PRICE_MISMATCH',
        severity: 'warning',
        field: 'price',
        lineNumber: line.lineNumber,
        message: 'SPS purchase price differs from the approved Circle R price.',
        suggestedActions: [
          'Use SPS price',
          'Use Approved Circle R Price',
          'Update mapping',
          'Needs leadership review',
        ],
      });
    }

    const uomStatus = getUomStatus(line.orderQtyUom, item?.foodConnexUom);
    if (uomStatus === 'mismatch') {
      exceptions.push({
        code: 'UOM_MISMATCH',
        severity: 'warning',
        field: 'uom',
        lineNumber: line.lineNumber,
        message: 'SPS UOM differs from the explicitly mapped Food Connex UOM.',
        suggestedActions: ['Review UOM mapping', 'Update mapping'],
      });
    }

    return {
      lineNumber: line.lineNumber,
      buyerPartNumber: line.buyerPartNumber,
      vendorPartNumber: line.vendorPartNumber,
      gtin: line.gtin,
      mappedFoodConnexItemId: item?.foodConnexItemId ?? null,
      mappedFoodConnexItemNumber: item?.foodConnexItemNumber ?? null,
      quantity: line.orderQty,
      spsUom: line.orderQtyUom,
      foodConnexUom: item?.foodConnexUom ?? null,
      spsPurchasePrice: line.purchasePrice,
      approvedCircleRPrice: item?.approvedCircleRPrice ?? null,
      itemMappingStatus,
      priceStatus,
      uomStatus,
    };
  });

  if (!purchaseOrder.purchaseOrderNumber) {
    unmappedFields.push('poNumber');
    exceptions.push(unmappedException('PO_NUMBER_MISSING', 'poNumber', null));
  }

  const hasUnmapped = exceptions.some((exception) => exception.severity === 'blocking');
  const hasReviewExceptions = exceptions.some(
    (exception) => exception.severity === 'warning',
  );

  return {
    source: 'sps',
    status: hasUnmapped ? 'unmapped' : hasReviewExceptions ? 'needs_review' : 'ready',
    mapping: {
      mappedFields,
      unmappedFields,
      confidence:
        hasUnmapped ? 'low' : hasReviewExceptions ? 'medium' : 'high',
    },
    order: {
      poNumber: purchaseOrder.purchaseOrderNumber,
      poDate: purchaseOrder.purchaseOrderDate,
      // SPS date qualifiers remain generic until Circle R config assigns meaning.
      requestedDate: null,
      tradingPartnerId: purchaseOrder.tradingPartnerId,
      customer: {
        spsTradingPartnerId: purchaseOrder.tradingPartnerId,
        spsName: purchaseOrder.billTo?.name ?? purchaseOrder.vendor,
        foodConnexCustomerId: customerMapping?.foodConnexCustomerId ?? null,
        foodConnexCustomerName: customerMapping?.foodConnexCustomerName ?? null,
        mappingStatus: customerMapping ? 'mapped' : 'unmapped',
      },
      shipTo: {
        spsLocationCode: purchaseOrder.shipTo?.locationNumber ?? null,
        spsName: purchaseOrder.shipTo?.name ?? null,
        foodConnexShipToId: shipToMapping?.foodConnexShipToId ?? null,
        foodConnexShipToName: shipToMapping?.foodConnexShipToName ?? null,
        mappingStatus: shipToMapping ? 'mapped' : 'unmapped',
      },
      lines,
    },
    exceptions,
  };
}

function findItemMatches(
  line: NormalizedSpsPurchaseOrder['lines'][number],
  mappings: CircleRItemMapping[],
): CircleRItemMapping[] {
  return mappings.filter(
    (mapping) =>
      (mapping.vendorPartNumber !== undefined &&
        mapping.vendorPartNumber === line.vendorPartNumber) ||
      (mapping.buyerPartNumber !== undefined &&
        mapping.buyerPartNumber === line.buyerPartNumber) ||
      (mapping.gtin !== undefined && mapping.gtin === line.gtin),
  );
}

function getPriceStatus(
  spsPrice: number | null,
  approvedPrice: number | undefined,
): 'match' | 'mismatch' | 'unknown' {
  if (spsPrice === null || approvedPrice === undefined) {
    return 'unknown';
  }

  return spsPrice === approvedPrice ? 'match' : 'mismatch';
}

function getUomStatus(
  spsUom: string | null,
  foodConnexUom: string | undefined,
): 'match' | 'mismatch' | 'unknown' {
  if (!spsUom || !foodConnexUom) {
    return 'unknown';
  }

  return spsUom === foodConnexUom ? 'match' : 'mismatch';
}

function unmappedException(
  code: string,
  field: string,
  lineNumber: string | null,
): CircleRMappingException {
  return {
    code,
    severity: 'blocking',
    field,
    lineNumber,
    message: `No explicit Circle R mapping exists for ${field}.`,
    suggestedActions: ['Create mapping', 'Needs leadership review'],
  };
}
