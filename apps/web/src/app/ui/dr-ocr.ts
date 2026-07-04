export type DrOcrItemSuggestion = {
  description: string;
  quantity?: string;
  unit?: string;
};

export type DrOcrConfidence = "High" | "Medium" | "Low" | "Missing";

export type DrOcrResult = {
  available: boolean;
  message: string;
  rawText: string;
  documentProfile?: {
    name: string;
    confidence: DrOcrConfidence;
    matchedKeywords: string[];
  };
  confidence: {
    drNumber: DrOcrConfidence;
    customerName: DrOcrConfidence;
    deliveryArea: DrOcrConfidence;
    items: DrOcrConfidence;
  };
  fields: {
    drNumber?: string;
    customerName?: string;
    dropOffPerson?: string;
    receiverName?: string;
    phone?: string;
    deliveryArea?: string;
    itemDescription?: string;
    quantity?: string;
    unit?: string;
  };
  parsedAddress?: ParsedPhilippineAddress;
  addresses: string[];
  items: DrOcrItemSuggestion[];
};

export type ParsedPhilippineAddress = {
  fullAddress: string;
  streetOrBuilding?: string;
  barangay?: string;
  city?: string;
  province?: string;
  confidence: DrOcrConfidence;
  notes: string[];
};

type NativeTextDetector = {
  detect: (source: ImageBitmap) => Promise<Array<{ rawValue?: string }>>;
};

type TesseractModule = {
  createWorker: (langs?: string, oem?: unknown, options?: { logger?: (message: { status?: string; progress?: number }) => void }) => Promise<{
    recognize: (image: File | Blob | string) => Promise<{ data: { text?: string } }>;
    setParameters?: (params: Record<string, string>) => Promise<unknown>;
    terminate: () => Promise<unknown>;
  }>;
};

export type DrOcrProgress = {
  stage: string;
  percent: number;
};

type ReadDeliveryReceiptPhotoOptions = {
  onProgress?: (progress: DrOcrProgress) => void;
  timeoutMs?: number;
};

const addressWords = [
  "street",
  "st.",
  "barangay",
  "brgy",
  "purok",
  "zone",
  "city",
  "municipality",
  "province",
  "albay",
  "camarines",
  "norte",
  "sur",
  "daet",
  "naga",
  "legazpi",
  "taguig",
  "pasig",
  "manila",
  "metro manila",
  "ncr",
  "philippines",
  "avenue",
  "ave.",
  "road",
  "rd.",
  "tower",
  "plaza",
  "building",
  "bldg",
  "floor",
  "high street",
  "corporate",
  "center",
  "centre",
  "complex",
  "bgc",
  "bonifacio"
];

const labelWords = [
  "delivery receipt",
  "invoice",
  "receipt",
  "date",
  "tin",
  "qty",
  "quantity",
  "unit",
  "amount",
  "total",
  "signature",
  "prepared",
  "checked",
  "approved",
  "customer information",
  "accounting information",
  "business style",
  "bus. style",
  "sales code",
  "terms and conditions"
];

const itemIgnoreWords = [
  "delivery fee",
  "terms and conditions",
  "prepared by",
  "approved by",
  "released by",
  "printed name",
  "signature",
  "printer",
  "document is not valid",
  "valid for",
  "interest",
  "attorney",
  "sales code",
  "customer information",
  "accounting information",
  "description"
];

const documentProfiles = [
  {
    name: "HJ Structured Technologies Delivery Receipt",
    keywords: ["hj structured technologies", "delivery receipt", "customer information", "accounting information"]
  },
  {
    name: "Generic delivery receipt",
    keywords: ["delivery receipt", "delivered to", "description", "qty"]
  },
  {
    name: "Generic invoice / DR",
    keywords: ["invoice", "customer information", "description", "terms and conditions"]
  }
];

const knownProvincePatterns = [
  /camarines\s+norte/i,
  /camarines\s+sur/i,
  /albay/i,
  /sorsogon/i,
  /catanduanes/i,
  /masbate/i,
  /ncr/i,
  /metro\s+manila/i
];

const knownCityPatterns = [
  /quezon\s+city/i,
  /legazpi/i,
  /daraga/i,
  /tabaco/i,
  /ligao/i,
  /naga/i,
  /daet/i,
  /basud/i,
  /taguig/i,
  /pasig/i,
  /makati/i,
  /manila/i,
  /paranaque/i,
  /pasay/i,
  /caloocan/i
];

const knownBarangayPatterns = [
  /fort\s+bonifacio/i,
  /pagsangahan/i
];

function uniqueValues(values: string[]) {
  const seen = new Set<string>();
  return values
    .map((value) => value.replace(/\s+/g, " ").trim())
    .filter((value) => {
      const key = value.toLowerCase();
      if (!value || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function emptyConfidence(): DrOcrResult["confidence"] {
  return {
    drNumber: "Missing",
    customerName: "Missing",
    deliveryArea: "Missing",
    items: "Missing"
  };
}

function scoreText(value: string | undefined, highLength = 8): DrOcrConfidence {
  const normalized = value?.replace(/\s+/g, " ").trim() ?? "";
  if (!normalized) return "Missing";
  if (normalized.length >= highLength) return "High";
  if (normalized.length >= 3) return "Medium";
  return "Low";
}

function scoreItems(items: DrOcrItemSuggestion[]): DrOcrConfidence {
  if (!items.length) return "Missing";
  if (items.length >= 2) return "High";
  return items[0]?.description && items[0].description.length >= 8 ? "Medium" : "Low";
}

function detectDocumentProfile(rawText: string): DrOcrResult["documentProfile"] | undefined {
  const lower = rawText.toLowerCase();
  const matches = documentProfiles
    .map((profile) => ({
      profile,
      matchedKeywords: profile.keywords.filter((keyword) => lower.includes(keyword))
    }))
    .filter((entry) => entry.matchedKeywords.length > 0)
    .sort((a, b) => b.matchedKeywords.length - a.matchedKeywords.length);

  const best = matches[0];
  if (!best) return undefined;
  const ratio = best.matchedKeywords.length / best.profile.keywords.length;
  return {
    name: best.profile.name,
    matchedKeywords: best.matchedKeywords,
    confidence: ratio >= 0.75 ? "High" : ratio >= 0.5 ? "Medium" : "Low"
  };
}

type ParsedDrText = Omit<DrOcrResult, "available" | "message" | "rawText" | "confidence" | "documentProfile">;

function buildConfidence(parsed: ParsedDrText): DrOcrResult["confidence"] {
  return {
    drNumber: scoreText(parsed.fields.drNumber, 4),
    customerName: scoreText(parsed.fields.customerName, 7),
    deliveryArea: scoreText(parsed.fields.deliveryArea, 18),
    items: scoreItems(parsed.items)
  };
}

function cleanLine(line: string) {
  return line.replace(/[|•]+/g, " ").replace(/\s+/g, " ").trim();
}

function cleanAddressPart(value: string) {
  return value
    .replace(/\b(address|delivered to|delivery address|ship to)\b\s*[:#-]?/gi, " ")
    .replace(/\bphilippines\b/gi, " ")
    .replace(/\s*,\s*/g, ", ")
    .replace(/\s+/g, " ")
    .replace(/^[,\s-]+|[,\s-]+$/g, "")
    .trim();
}

function firstPatternText(value: string, patterns: RegExp[]) {
  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (match?.[0]) return cleanAddressPart(match[0]);
  }
  return "";
}

function removeAddressPart(value: string, part?: string) {
  if (!part) return value;
  const escaped = part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return value.replace(new RegExp(`\\b${escaped}\\b`, "i"), " ");
}

export function parsePhilippineAddress(address: string): ParsedPhilippineAddress | undefined {
  const fullAddress = cleanAddressPart(address);
  if (fullAddress.length < 6) return undefined;
  const notes: string[] = [];
  const province = firstPatternText(fullAddress, knownProvincePatterns);
  const city = firstPatternText(fullAddress, knownCityPatterns);
  const explicitBarangay = fullAddress.match(/\b(?:brgy\.?|barangay|bgy\.?)\s+([^,]+?)(?=\s+(?:city|municipality|province)\b|,\s*|$)/i)?.[1];
  const barangay =
    cleanAddressPart(explicitBarangay ?? "") ||
    firstPatternText(fullAddress, knownBarangayPatterns);

  let streetOrBuilding = fullAddress;
  streetOrBuilding = removeAddressPart(streetOrBuilding, province);
  streetOrBuilding = removeAddressPart(streetOrBuilding, city);
  streetOrBuilding = removeAddressPart(streetOrBuilding, barangay);
  streetOrBuilding = cleanAddressPart(streetOrBuilding.replace(/\b(?:brgy\.?|barangay|bgy\.?)\b/gi, " "));

  if (!barangay) notes.push("Barangay not detected.");
  if (!city) notes.push("City/municipality not detected.");
  if (!province) notes.push("Province not detected.");
  if (!streetOrBuilding) notes.push("Street/building not detected.");

  const filledCount = [streetOrBuilding, barangay, city, province].filter(Boolean).length;
  const confidence: DrOcrConfidence = filledCount >= 3 ? "High" : filledCount === 2 ? "Medium" : filledCount === 1 ? "Low" : "Missing";

  return {
    fullAddress,
    streetOrBuilding: streetOrBuilding || undefined,
    barangay: barangay || undefined,
    city: city || undefined,
    province: province || undefined,
    confidence,
    notes
  };
}

function withoutLabel(line: string) {
  return line
    .replace(/^(customer|company|client|sold to|ship to|deliver to|delivered to|delivery address|address|receiver|consignee|received by|sender|from|dr|d\.r\.|delivery receipt|receipt no\.?|no\.?|n[º°o])\s*[:#-]?\s*/i, "")
    .trim();
}

function findAfterLabel(lines: string[], labels: RegExp[]) {
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line) continue;
    if (!labels.some((label) => label.test(line))) continue;
    const sameLine = withoutLabel(line);
    if (sameLine && sameLine !== line && sameLine.length >= 2) return sameLine;
    const next = lines[index + 1];
    if (next && !labelWords.some((word) => next.toLowerCase().includes(word))) return next;
  }
  return "";
}

function extractDrNumber(text: string) {
  const patterns = [
    /\b(?:N[º°o]|NO\.?|NUMBER)\s*[:#-]?\s*([A-Z0-9-]{2,})/i,
    /\b(?:DR|D\.R\.|delivery\s*receipt|receipt)\s*(?:no\.?|number|#)?\s*[:#-]?\s*([A-Z0-9-]{3,})/i,
    /\bno\.?\s*[:#-]?\s*([A-Z0-9-]{4,})/i
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1].trim();
  }
  return "";
}

function extractPhone(text: string) {
  const match = text.match(/(?:\+?63|0)\s?9\d{2}[\s-]?\d{3}[\s-]?\d{4}/);
  return match?.[0]?.replace(/\s+/g, " ").trim() ?? "";
}

function extractAddresses(lines: string[]) {
  const labeledAddresses: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line) continue;
    if (!/address/i.test(line)) continue;
    const sameLine = withoutLabel(line);
    const parts = [sameLine];
    for (const offset of [1, 2]) {
      const next = lines[index + offset];
      if (!next) continue;
      const lowerNext = next.toLowerCase();
      if (labelWords.some((word) => lowerNext === word || lowerNext.startsWith(`${word}:`))) break;
      if (/^(bus\.?\s*style|tin|qty|um|description)\b/i.test(next)) break;
      parts.push(next);
    }
    const address = parts.join(" ").replace(/\s+/g, " ").trim();
    if (address.length >= 12) labeledAddresses.push(address);
  }

  const wordBasedAddresses = lines
    .filter((line) => {
      const lower = line.toLowerCase();
      if (line.length < 8) return false;
      if (labelWords.some((word) => lower === word || lower.startsWith(`${word}:`))) return false;
      return addressWords.some((word) => lower.includes(word));
    })
    .map(withoutLabel)
    .filter((line) => line.length >= 8);

  return uniqueValues([...labeledAddresses, ...wordBasedAddresses]).slice(0, 5);
}

function normalizeUnit(unit: string) {
  const lower = unit.toLowerCase();
  if (["unit", "unt", "un", "um"].includes(lower)) return "unit";
  if (["pc", "pcs", "piece", "pieces"].includes(lower)) return "pcs";
  return unit;
}

function extractItems(lines: string[]): DrOcrItemSuggestion[] {
  const units = "(unit|unt|un|um|pcs?|pieces?|box(?:es)?|sacks?|bags?|bundles?|lengths?|sets?|rolls?|cartons?|crates?|pails?|kg|kilos?|meters?|m)";
  const quantityFirst = new RegExp(`^\\s*(\\d+(?:\\.\\d+)?)\\s*${units}\\b\\s+(.{3,})$`, "i");
  const descriptionFirst = new RegExp(`^\\s*(.{3,}?)\\s+(\\d+(?:\\.\\d+)?)\\s*${units}\\b\\s*$`, "i");
  const unitFirst = new RegExp(`^\\s*${units}\\b\\s+(.{3,})$`, "i");

  const suggestions: DrOcrItemSuggestion[] = [];
  for (const line of lines) {
    const lower = line.toLowerCase();
    if (labelWords.some((word) => lower === word || lower.startsWith(`${word}:`))) continue;
    if (itemIgnoreWords.some((word) => lower.includes(word))) continue;
    const first = line.match(quantityFirst);
    if (first?.[1] && first[3]) {
      suggestions.push({ quantity: first[1], unit: normalizeUnit(first[2] ?? "pcs"), description: first[3].trim() });
      continue;
    }
    const unitOnly = line.match(unitFirst);
    if (unitOnly?.[1] && unitOnly[2]) {
      suggestions.push({ quantity: "1", unit: normalizeUnit(unitOnly[1]), description: unitOnly[2].trim() });
      continue;
    }
    const second = line.match(descriptionFirst);
    if (second?.[1] && second[2]) {
      suggestions.push({ description: second[1].trim(), quantity: second[2], unit: normalizeUnit(second[3] ?? "pcs") });
    }
  }

  return uniqueValues(suggestions.map((item) => `${item.quantity ?? ""}|${item.unit ?? ""}|${item.description}`))
    .map((key) => {
      const [quantity, unit, description] = key.split("|");
      return { quantity: quantity || undefined, unit: unit || undefined, description: description ?? "" };
    })
    .filter((item) => item.description.length >= 3)
    .slice(0, 8);
}

function parseDrText(rawText: string): ParsedDrText {
  const lines = uniqueValues(rawText.split(/\r?\n/).map(cleanLine)).filter(Boolean);
  const addresses = extractAddresses(lines);
  const parsedAddress = parsePhilippineAddress(addresses[0] ?? "");
  const items = extractItems(lines);
  const customerName = findAfterLabel(lines, [/delivered\s*to/i, /customer/i, /company/i, /client/i, /sold\s*to/i]);
  const receiverName = findAfterLabel(lines, [/delivered\s*to/i, /receiver/i, /consignee/i, /received\s*by/i, /ship\s*to/i]);
  const dropOffPerson = findAfterLabel(lines, [/sender/i, /from/i, /delivered\s*by/i]);
  const drNumber = extractDrNumber(rawText);
  const phone = extractPhone(rawText);

  return {
    fields: {
      drNumber: drNumber || undefined,
      customerName: customerName || undefined,
      dropOffPerson: dropOffPerson || undefined,
      receiverName: receiverName || undefined,
      phone: phone || undefined,
      deliveryArea: addresses[0],
      itemDescription: items[0]?.description,
      quantity: items[0]?.quantity,
      unit: items[0]?.unit
    },
    parsedAddress,
    addresses,
    items
  };
}

function reportProgress(options: ReadDeliveryReceiptPhotoOptions | undefined, stage: string, percent: number) {
  options?.onProgress?.({ stage, percent: Math.max(0, Math.min(100, Math.round(percent))) });
}

async function canvasToBlob(canvas: HTMLCanvasElement, type = "image/jpeg", quality = 0.82) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Unable to prepare DR image for reading."));
    }, type, quality);
  });
}

async function prepareImageForOcr(file: File, options?: ReadDeliveryReceiptPhotoOptions): Promise<Blob | File> {
  if (typeof document === "undefined" || typeof createImageBitmap === "undefined") return file;
  reportProgress(options, "Preparing photo", 5);
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file);
    const maxSide = 1600;
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return file;
    context.drawImage(bitmap, 0, 0, width, height);
    const imageData = context.getImageData(0, 0, width, height);
    const data = imageData.data;
    for (let index = 0; index < data.length; index += 4) {
      const gray = (data[index] ?? 255) * 0.299 + (data[index + 1] ?? 255) * 0.587 + (data[index + 2] ?? 255) * 0.114;
      const contrasted = gray < 180 ? Math.max(0, gray - 20) : Math.min(255, gray + 18);
      data[index] = contrasted;
      data[index + 1] = contrasted;
      data[index + 2] = contrasted;
    }
    context.putImageData(imageData, 0, 0);
    reportProgress(options, "Photo prepared", 12);
    return await canvasToBlob(canvas);
  } catch {
    return file;
  } finally {
    bitmap?.close();
  }
}

async function prepareImageRegionForOcr(
  file: File,
  crop: { x: number; y: number; width: number; height: number },
  options?: ReadDeliveryReceiptPhotoOptions
): Promise<Blob | File> {
  if (typeof document === "undefined" || typeof createImageBitmap === "undefined") return file;
  reportProgress(options, "Checking address area", 12);
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file);
    const sourceX = Math.max(0, Math.round(bitmap.width * crop.x));
    const sourceY = Math.max(0, Math.round(bitmap.height * crop.y));
    const sourceWidth = Math.min(bitmap.width - sourceX, Math.round(bitmap.width * crop.width));
    const sourceHeight = Math.min(bitmap.height - sourceY, Math.round(bitmap.height * crop.height));
    if (sourceWidth <= 0 || sourceHeight <= 0) return file;
    const scale = 3;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, sourceWidth * scale);
    canvas.height = Math.max(1, sourceHeight * scale);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return file;
    context.imageSmoothingEnabled = true;
    context.drawImage(bitmap, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height);
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    for (let index = 0; index < data.length; index += 4) {
      const gray = (data[index] ?? 255) * 0.299 + (data[index + 1] ?? 255) * 0.587 + (data[index + 2] ?? 255) * 0.114;
      const contrasted = gray < 170 ? Math.max(0, gray - 35) : Math.min(255, gray + 25);
      data[index] = contrasted;
      data[index + 1] = contrasted;
      data[index + 2] = contrasted;
    }
    context.putImageData(imageData, 0, 0);
    return await canvasToBlob(canvas, "image/png");
  } catch {
    return file;
  } finally {
    bitmap?.close();
  }
}

async function readWithTesseract(file: File | Blob, options?: ReadDeliveryReceiptPhotoOptions): Promise<string> {
  const tesseract = await import("tesseract.js") as unknown as TesseractModule;
  reportProgress(options, "Starting reader", 15);
  const worker = await tesseract.createWorker("eng", undefined, {
    logger: (message) => {
      if (message.status?.toLowerCase().includes("recognizing text") && typeof message.progress === "number") {
        reportProgress(options, "Reading text", 20 + message.progress * 75);
      }
    }
  });
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    await worker.setParameters?.({ tessedit_pageseg_mode: "6", preserve_interword_spaces: "1" });
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        void worker.terminate();
        reject(new Error("DR reader is taking too long. Type the details manually, or try a brighter/closer photo."));
      }, options?.timeoutMs ?? 45000);
    });
    const result = await Promise.race([worker.recognize(file), timeout]);
    reportProgress(options, "Reading complete", 96);
    return result.data.text ?? "";
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    await worker.terminate().catch(() => undefined);
  }
}

async function readFocusedCustomerArea(file: File, options?: ReadDeliveryReceiptPhotoOptions) {
  const customerBlock = await prepareImageRegionForOcr(file, { x: 0.04, y: 0.17, width: 0.58, height: 0.16 }, options);
  return readWithTesseract(customerBlock, { ...options, timeoutMs: Math.min(options?.timeoutMs ?? 45000, 25000) });
}

function buildOcrResult(rawText: string, message: string): DrOcrResult {
  if (!rawText.trim()) {
    return {
      available: true,
      message: "No readable text found. Retake the photo closer and brighter, or type manually.",
      rawText,
      confidence: emptyConfidence(),
      fields: {},
      parsedAddress: undefined,
      addresses: [],
      items: []
    };
  }
  const parsed = parseDrText(rawText);
  const missingAddressHint = !parsed.fields.deliveryArea ? " Address was not clear; use saved customer address or type it manually." : "";
  const confidence = buildConfidence(parsed);
  const lowItemHint = confidence.items === "Missing" || confidence.items === "Low" ? " Items may need manual entry." : "";
  return {
    available: true,
    message: `${message}${missingAddressHint}${lowItemHint}`,
    rawText,
    documentProfile: detectDocumentProfile(rawText),
    confidence,
    ...parsed
  };
}

export async function readDeliveryReceiptPhoto(file: File, options?: ReadDeliveryReceiptPhotoOptions): Promise<DrOcrResult> {
  if (typeof window === "undefined") {
    return {
      available: false,
      message: "DR reader is not available on this device.",
      rawText: "",
      confidence: emptyConfidence(),
      fields: {},
      parsedAddress: undefined,
      addresses: [],
      items: []
    };
  }

  const Detector = (window as unknown as { TextDetector?: new () => NativeTextDetector }).TextDetector;
  if (!Detector || typeof createImageBitmap === "undefined") {
    try {
      const preparedFile = await prepareImageForOcr(file, options);
      let rawText = await readWithTesseract(preparedFile, options);
      if (!parseDrText(rawText).fields.deliveryArea) {
        const focusedText = await readFocusedCustomerArea(file, options).catch(() => "");
        if (focusedText.trim()) rawText = `${rawText}\n${focusedText}`;
      }
      reportProgress(options, "Done", 100);
      return buildOcrResult(rawText, "DR photo read. Please review the filled details before saving.");
    } catch (error) {
      return {
        available: false,
        message: error instanceof Error ? `DR reader failed: ${error.message}` : "DR reader failed. Manual entry is still available.",
        rawText: "",
        confidence: emptyConfidence(),
        fields: {},
        parsedAddress: undefined,
        addresses: [],
        items: []
      };
    }
  }

  let bitmap: ImageBitmap | null = null;
  try {
    reportProgress(options, "Checking device reader", 10);
    bitmap = await createImageBitmap(file);
    const detector = new Detector();
    const detections = await detector.detect(bitmap);
    const rawText = detections.map((item) => item.rawValue ?? "").filter(Boolean).join("\n");
    if (rawText.trim()) {
      reportProgress(options, "Done", 100);
      return buildOcrResult(rawText, "DR photo read. Please review the filled details before saving.");
    }
    const preparedFile = await prepareImageForOcr(file, options);
    let fallbackText = await readWithTesseract(preparedFile, options);
    if (!parseDrText(fallbackText).fields.deliveryArea) {
      const focusedText = await readFocusedCustomerArea(file, options).catch(() => "");
      if (focusedText.trim()) fallbackText = `${fallbackText}\n${focusedText}`;
    }
    reportProgress(options, "Done", 100);
    return buildOcrResult(fallbackText, "DR photo read. Please review the filled details before saving.");
  } catch (error) {
    try {
      const preparedFile = await prepareImageForOcr(file, options);
      let fallbackText = await readWithTesseract(preparedFile, options);
      if (!parseDrText(fallbackText).fields.deliveryArea) {
        const focusedText = await readFocusedCustomerArea(file, options).catch(() => "");
        if (focusedText.trim()) fallbackText = `${fallbackText}\n${focusedText}`;
      }
      reportProgress(options, "Done", 100);
      return buildOcrResult(fallbackText, "DR photo read. Please review the filled details before saving.");
    } catch (fallbackError) {
      return {
        available: false,
        message: fallbackError instanceof Error ? `Unable to read DR photo: ${fallbackError.message}` : error instanceof Error ? `Unable to read DR photo: ${error.message}` : "Unable to read DR photo.",
        rawText: "",
        confidence: emptyConfidence(),
        fields: {},
        parsedAddress: undefined,
        addresses: [],
        items: []
      };
    }
  } finally {
    bitmap?.close();
  }
}
