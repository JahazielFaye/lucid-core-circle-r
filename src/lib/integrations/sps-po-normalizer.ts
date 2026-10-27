import 'server-only';

import { XMLParser } from 'fast-xml-parser';

export type SpsPurchaseOrderDate = {
  qualifier: string | null;
  date: string | null;
};

export type SpsPurchaseOrderAddress = {
  locationNumber: string | null;
  name: string | null;
  alternateName?: string | null;
  address1: string | null;
  address2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
};

export type NormalizedSpsPurchaseOrder = {
  source: 'sps';
  transactionType: 'PO';
  sourceFile: string;
  purchaseOrderNumber: string | null;
  purchaseOrderDate: string | null;
  tradingPartnerId: string | null;
  purposeCode: string | null;
  poTypeCode: string | null;
  vendor: string | null;
  department: string | null;
  division: string | null;
  shipCompleteCode: string | null;
  // Supports the current SPS Sandbox spelling and a future corrected spelling.
  currency: string | null;
  headerDates: SpsPurchaseOrderDate[];
  billTo: SpsPurchaseOrderAddress | null;
  shipTo: SpsPurchaseOrderAddress | null;
  lines: Array<{
    lineNumber: string | null;
    buyerPartNumber: string | null;
    vendorPartNumber: string | null;
    gtin: string | null;
    consumerPackageCode: string | null;
    upcCaseCode: string | null;
    orderQty: number | null;
    orderQtyUom: string | null;
    purchasePrice: number | null;
    description: string | null;
    lineDates: SpsPurchaseOrderDate[];
  }>;
  headerQuantityTotal: number | null;
  headerQuantityUom: string | null;
  totalAmount: number | null;
  totalLineItemNumber: number | null;
  validation: {
    calculatedLineQuantity: number;
    quantityMatchesHeader: boolean | null;
    calculatedExtendedPurchaseAmount: number;
    reportedTotalAmount: number | null;
  };
};

const parser = new XMLParser({
  ignoreAttributes: false,
  parseTagValue: false,
  trimValues: false,
});

/** Converts an XML singleton or repeated node to a predictable array. */
function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value == null) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

/** Parses the confirmed SPS Order/Header/LineItem XML shape into Lucid JSON. */
export function normalizeSpsPurchaseOrder(
  xml: string,
  sourceFile: string,
): NormalizedSpsPurchaseOrder {
  const parsed = parser.parse(xml) as Record<string, unknown>;
  const order = parsed.Order as Record<string, unknown> | undefined;
  if (!order || typeof order !== 'object' || Array.isArray(order)) {
    throw new Error('SPS XML does not contain an Order element.');
  }

  const header = order.Header as Record<string, unknown> | undefined;
  const orderHeader = header?.OrderHeader as Record<string, unknown> | undefined;
  const quantityTotals = header?.QuantityTotals as Record<string, unknown> | undefined;
  const summary = order.Summary as Record<string, unknown> | undefined;
  const lines = asArray(order.LineItem).map(normalizeLineItem);
  const headerQuantityTotal = numberFrom(quantityTotals?.Quantity);
  const totalAmount = numberFrom(summary?.TotalAmount);
  const calculatedLineQuantity = lines.reduce(
    (total, line) => total + (line.orderQty ?? 0),
    0,
  );
  const calculatedExtendedPurchaseAmount = lines.reduce(
    (total, line) =>
      total + (line.orderQty !== null && line.purchasePrice !== null
        ? line.orderQty * line.purchasePrice
        : 0),
    0,
  );

  return {
    source: 'sps',
    transactionType: 'PO',
    sourceFile,
    purchaseOrderNumber: textValue(orderHeader?.PurchaseOrderNumber),
    purchaseOrderDate: textValue(orderHeader?.PurchaseOrderDate),
    tradingPartnerId: textValue(orderHeader?.TradingPartnerId),
    purposeCode: textValue(orderHeader?.TsetPurposeCode),
    poTypeCode: textValue(orderHeader?.PrimaryPOTypeCode),
    vendor: textValue(orderHeader?.Vendor),
    department: textValue(orderHeader?.Department),
    division: textValue(orderHeader?.Division),
    shipCompleteCode: textValue(orderHeader?.ShipCompleteCode),
    currency: textValue(
      orderHeader?.BuyserCurrency ?? orderHeader?.BuyerCurrency,
    ),
    headerDates: asArray(header?.Dates).map(normalizeDate),
    billTo: normalizeAddressByType(asArray(header?.Address), 'BT'),
    shipTo: normalizeAddressByType(asArray(header?.Address), 'ST'),
    lines,
    headerQuantityTotal,
    headerQuantityUom: textValue(quantityTotals?.QuantityUOM),
    totalAmount,
    totalLineItemNumber: numberFrom(summary?.TotalLineItemNumber),
    validation: {
      calculatedLineQuantity,
      quantityMatchesHeader:
        headerQuantityTotal === null
          ? null
          : calculatedLineQuantity === headerQuantityTotal,
      calculatedExtendedPurchaseAmount,
      reportedTotalAmount: totalAmount,
    },
  };
}

function normalizeLineItem(lineItemValue: unknown) {
  const lineItem = lineItemValue as Record<string, unknown> | null;
  const orderLine = lineItem?.OrderLine as Record<string, unknown> | undefined;
  return {
    lineNumber: textValue(orderLine?.LineSequenceNumber),
    buyerPartNumber: textValue(orderLine?.BuyerPartNumber),
    vendorPartNumber: textValue(orderLine?.VendorPartNumber),
    gtin: textValue(orderLine?.GTIN),
    consumerPackageCode: textValue(orderLine?.ConsumerPackageCode),
    upcCaseCode: textValue(orderLine?.UPCCaseCode),
    orderQty: numberFrom(orderLine?.OrderQty),
    orderQtyUom: textValue(orderLine?.OrderQtyUOM),
    // Do not substitute PriceInformation.UnitPrice for SPS PurchasePrice.
    purchasePrice: numberFrom(orderLine?.PurchasePrice),
    description: textValue(
      (lineItem?.ProductOrItemDescription as Record<string, unknown> | undefined)
        ?.ProductDescription,
    ),
    lineDates: asArray(lineItem?.Dates).map(normalizeDate),
  };
}

function normalizeAddressByType(
  addresses: unknown[],
  addressType: 'BT' | 'ST',
): SpsPurchaseOrderAddress | null {
  const address = addresses
    .filter(
      (candidate): candidate is Record<string, unknown> =>
        Boolean(candidate) && typeof candidate === 'object' && !Array.isArray(candidate),
    )
    .find((candidate) => textValue(candidate.AddressTypeCode) === addressType);

  if (!address) {
    return null;
  }

  return {
    locationNumber: textValue(address.AddressLocationNumber),
    name: textValue(address.AddressName),
    ...(addressType === 'ST'
      ? { alternateName: textValue(address.AddressAlternateName) }
      : {}),
    address1: textValue(address.Address1),
    address2: textValue(address.Address2),
    city: textValue(address.City),
    state: textValue(address.State),
    postalCode: textValue(address.PostalCode),
    country: textValue(address.Country),
  };
}

function normalizeDate(value: unknown): SpsPurchaseOrderDate {
  const date = value as Record<string, unknown> | null;
  return {
    qualifier: textValue(date?.DateTimeQualifier),
    date: textValue(date?.Date),
  };
}

function textValue(value: unknown): string | null {
  if (typeof value === 'string') {
    const text = value.trim();
    return text.length > 0 ? text : null;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (value && typeof value === 'object') {
    const text = (value as Record<string, unknown>)['#text'];
    return textValue(text);
  }

  return null;
}

function numberFrom(value: unknown): number | null {
  const text = textValue(value);
  if (text === null || text === '') {
    return null;
  }

  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}
