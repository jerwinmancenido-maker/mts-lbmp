"use client";

import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  ChevronDown,
  ClipboardList,
  CreditCard,
  LayoutDashboard,
  MessageCircle,
  PackagePlus,
  Plus,
  Printer,
  QrCode,
  ReceiptText,
  ScanLine,
  Search,
  Settings,
  ShieldCheck,
  Smartphone,
  Truck,
  UserCog,
  WalletCards,
  X
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Ref } from "react";
import type { PackageCondition } from "@mts-lbmp/shared";
import { apiGet, apiPatch, apiPost, setApiToken } from "./api";
import { appendDiagnosticLog, clearCachedRecords, clearDiagnosticLogs, deleteQueuedPhoto, enqueueOfflineAction, getOfflineStorageSummary, listDiagnosticLogs, listOfflineQueue, listQueuedPhotos, readCachedRecord, readCachedValue, replaceQueuedPhotoReferences, requestPersistentStorage, updateOfflineQueueRecord, updateQueuedPhoto, writeCachedValue, type DiagnosticLogRecord, type OfflineQueueRecord, type OfflineStorageSummary, type QueuedPhotoRecord } from "./cache";
import { parsePhilippineAddress, readDeliveryReceiptPhoto, type DrOcrConfidence, type DrOcrProgress, type DrOcrResult } from "./dr-ocr";
import { setPhotoAuditUser, setPhotoUploadContext, takeNativeCameraPhoto, uploadCompressedImage } from "./media";
import { printNativeText } from "./native-printer";
import type { AuditLog, BillingInvoice, BootstrapData, Branch, CargoPackage, DashboardData, ExpenseRecord, HardwareTestRecord, OperationChatThread, PaymentRecord, ProductMaster, Trip } from "./types";

type Tab =
  | "dashboard"
  | "receiving"
  | "packages"
  | "trips"
  | "delivery"
  | "payments"
  | "expenses"
  | "customer"
  | "chat"
  | "admin"
  | "settings"
  | "hardware";

type OperatorUser = BootstrapData["users"][number];

type ShellCacheData = {
  bootstrap: BootstrapData;
  dashboard: DashboardData;
};

type ModuleCacheData = {
  packages?: CargoPackage[];
  productMasters?: ProductMaster[];
  trips?: Trip[];
  payments?: PaymentRecord[];
  expenses?: ExpenseRecord[];
  auditLogs?: AuditLog[];
  hardwareTests?: HardwareTestRecord[];
  operationChats?: OperationChatThread[];
};

type SyncState = "Online" | "Refreshing" | "Cached" | "Offline" | "Pending sync" | "Sync failed" | "Syncing";
type QueueablePost = <T>(type: OfflineQueueRecord["type"], path: string, body?: unknown) => Promise<{ queued: true } | { queued: false; result: T }>;
type PhotoUploadResult = Awaited<ReturnType<typeof uploadCompressedImage>>;
type AppView = { kind: "home" } | { kind: "account" } | { kind: "tab"; tab: Tab };
type UserIssueLevel = "success" | DiagnosticLogRecord["level"];
type UserIssueInput = {
  level?: UserIssueLevel;
  title: string;
  message: string;
  source?: DiagnosticLogRecord["source"];
  details?: unknown;
  module?: string;
};
type UserIssue = UserIssueInput & {
  id: string;
  level: UserIssueLevel;
  createdAt: string;
};

function emitUserIssue(issue: UserIssueInput) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<UserIssueInput>("mts-user-issue", { detail: issue }));
}

const tabs: Array<{ id: Tab; label: string; icon: React.ElementType }> = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "receiving", label: "Receive", icon: PackagePlus },
  { id: "packages", label: "Cargo", icon: QrCode },
  { id: "trips", label: "Trips", icon: Truck },
  { id: "delivery", label: "Deliver", icon: CheckCircle2 },
  { id: "payments", label: "Payments", icon: CreditCard },
  { id: "expenses", label: "Expenses", icon: WalletCards },
  { id: "customer", label: "Customers", icon: ReceiptText },
  { id: "chat", label: "Chat", icon: MessageCircle },
  { id: "admin", label: "Admin", icon: ShieldCheck },
  { id: "settings", label: "Settings", icon: Settings },
  { id: "hardware", label: "Device", icon: Smartphone }
];

const tabsByRole: Record<string, Tab[]> = {
  Administrator: ["dashboard", "receiving", "packages", "trips", "delivery", "payments", "expenses", "customer", "chat", "admin", "settings", "hardware"],
  "System Admin": ["dashboard", "receiving", "packages", "trips", "delivery", "payments", "expenses", "customer", "chat", "admin", "settings", "hardware"],
  "Daet Owner": ["dashboard", "receiving", "packages", "trips", "delivery", "payments", "expenses", "customer", "chat", "admin", "settings", "hardware"],
  "Naga Owner": ["dashboard", "receiving", "packages", "trips", "delivery", "payments", "expenses", "customer", "chat", "admin", "settings", "hardware"],
  "Receiving Staff": ["dashboard", "receiving", "packages", "trips", "payments", "expenses", "chat", "hardware"],
  "Delivery Staff": ["dashboard", "packages", "delivery", "payments", "expenses", "chat", "hardware"],
  "Delivery Admin": ["dashboard", "packages", "delivery", "payments", "expenses", "customer", "chat", "hardware"],
  "Customer Owner": ["dashboard", "packages", "customer"]
};

const LIST_PAGE_SIZE = 25;
const MODULE_FETCH_LIMIT = 250;
const DEVICE_PAPER_WIDTH_KEY = "mts-lbmp-device-paper-width";
const DEVICE_CAMERA_UNAVAILABLE_KEY = "mts-lbmp-device-camera-unavailable";

function readDevicePaperWidth(): "58mm" | "80mm" {
  if (typeof window === "undefined") return "58mm";
  return window.localStorage.getItem(DEVICE_PAPER_WIDTH_KEY) === "80mm" ? "80mm" : "58mm";
}

function readDeviceCameraUnavailable() {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(DEVICE_CAMERA_UNAVAILABLE_KEY) === "1";
}

function markDeviceCameraUnavailable() {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(DEVICE_CAMERA_UNAVAILABLE_KEY, "1");
}

function resetDeviceCameraCheck() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(DEVICE_CAMERA_UNAVAILABLE_KEY);
}

function isNativeCameraUnavailableMessage(message: string) {
  return /unable to resolve camera activity|no available camera|camera unavailable|native camera failed/i.test(message);
}

function visibleTabsForRole(role: string) {
  const allowed = new Set(tabsByRole[role] ?? tabsByRole.Administrator);
  return tabs.filter((tab) => allowed.has(tab.id));
}

interface SearchResultItem {
  id: string;
  tab: Tab;
  type: string;
  customerName: string;
  documentNumber: string;
  date: string;
  status: string;
  details: string;
  amount?: string;
  priority: number;
}

function matchesSearch(values: unknown[], query: string) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return true;
  return values.some((value) => String(value ?? "").toLowerCase().includes(normalizedQuery));
}

function apiQuery(path: string, params: Record<string, string | number | undefined>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `${path}?${query}` : path;
}

function shellCacheKey(userId: string) {
  return `shell:${userId}`;
}

function moduleCacheKey(tab: Tab, userId: string, branch?: string) {
  return `module:${userId}:${branch || "all"}:${tab}`;
}

function formatSyncTime(value?: string) {
  if (!value) return "";
  return new Date(value).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0 KB";
  if (value < 1024 * 1024) return `${Math.ceil(value / 1024)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function isQueuedPhotoUpload(uploaded: PhotoUploadResult) {
  return "queued" in uploaded && uploaded.queued === true;
}

function photoUploadStatus(uploaded: PhotoUploadResult, uploadedMessage: string) {
  return isQueuedPhotoUpload(uploaded) ? "Photo saved on tablet - needs sync." : uploadedMessage;
}

function sameAppView(left: AppView, right: AppView) {
  return left.kind === right.kind && (left.kind !== "tab" || (right.kind === "tab" && left.tab === right.tab));
}

async function capturePhotoOrOpenPicker(
  inputRef: { current: HTMLInputElement | null },
  fileName: string,
  onFile: (file: File) => Promise<void> | void,
  onFallback?: (message: string) => void
) {
  if (readDeviceCameraUnavailable()) {
    onFallback?.("This device has no camera app. Use another phone/iPhone web app for photos, or attach the image later from Records.");
    return;
  }

  let file: File | null = null;
  try {
    file = await takeNativeCameraPhoto(fileName);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (isNativeCameraUnavailableMessage(message)) {
      markDeviceCameraUnavailable();
      onFallback?.("This tablet has no camera app. Photo buttons are disabled for this device. Use another phone/iPhone web app for photos, or attach later from Records.");
      return;
    }
    onFallback?.("Camera is not available. Check device setup or choose an existing image.");
    inputRef.current?.click();
    return;
  }
  if (file) {
    await onFile(file);
    return;
  }
  inputRef.current?.click();
}

function roleClass(role: string) {
  if (role === "Daet Owner") return "role-admin";
  if (role === "Naga Owner") return "role-delivery";
  if (role === "Receiving Staff") return "role-receiving";
  if (role === "Delivery Staff") return "role-delivery";
  if (role === "Customer" || role === "Customer Owner") return "role-customer";
  return "role-admin";
}

function paymentCollectionPointForRole(role: string): PaymentRecord["collectionPoint"] {
  if (role === "Receiving Staff") return "Receiving";
  if (role === "Delivery Staff" || role === "Delivery Admin") return "Delivery";
  if (["Administrator", "System Admin", "Daet Owner", "Naga Owner"].includes(role)) return "Owner";
  return "Other";
}

function branchScopeForUser(user: { role: string; branchAccess?: string }, activeBranchContext?: string) {
  if (user.role === "Daet Owner") return "Daet";
  if (user.role === "Naga Owner") return "Naga";
  if (user.role === "Customer Owner") return undefined;
  if (activeBranchContext && activeBranchContext !== "All branches") return activeBranchContext;
  return undefined;
}

function operationalBranchNames(branches: Branch[] = []) {
  return branches
    .filter((branch) => branch.status === "Active" && branch.canDeliver)
    .map((branch) => branch.name);
}

function weightToKg(value?: number | null, unit = "kg") {
  if (value == null || !Number.isFinite(value)) return 0;
  if (unit === "g") return value / 1000;
  if (unit === "ton") return value * 1000;
  if (unit === "lb") return value * 0.453592;
  return value;
}

function dimensionToCm(value?: number | null, unit = "cm") {
  if (value == null || !Number.isFinite(value)) return 0;
  if (unit === "m") return value * 100;
  if (unit === "inch") return value * 2.54;
  if (unit === "ft") return value * 30.48;
  return value;
}

function packageWeightKg(pkg: CargoPackage) {
  return weightToKg(pkg.weight, pkg.weightUnit ?? "kg");
}

function packageVolumeCbm(pkg: CargoPackage) {
  const lengthCm = dimensionToCm(pkg.length, pkg.dimensionUnit ?? "cm");
  const widthCm = dimensionToCm(pkg.width, pkg.dimensionUnit ?? "cm");
  const heightCm = dimensionToCm(pkg.height, pkg.dimensionUnit ?? "cm");
  if (!lengthCm || !widthCm || !heightCm) return 0;
  return (lengthCm * widthCm * heightCm) / 1_000_000;
}

function packageVolumetricWeightKg(pkg: CargoPackage) {
  const lengthCm = dimensionToCm(pkg.length, pkg.dimensionUnit ?? "cm");
  const widthCm = dimensionToCm(pkg.width, pkg.dimensionUnit ?? "cm");
  const heightCm = dimensionToCm(pkg.height, pkg.dimensionUnit ?? "cm");
  if (!lengthCm || !widthCm || !heightCm) return 0;
  return (lengthCm * widthCm * heightCm) / 5000;
}

function hasLoadingMeasurements(pkg: CargoPackage) {
  return packageWeightKg(pkg) > 0 && packageVolumeCbm(pkg) > 0;
}

function formatNumber(value: number, fractionDigits = 2) {
  return value.toLocaleString(undefined, { maximumFractionDigits: fractionDigits });
}

function documentTitleFromPrintText(text: string) {
  if (/LOADING MANIFEST/i.test(text)) return "Loading Manifest";
  if (/RECEIVING RECEIPT|RECEIVING DOCUMENT|RECEIVING SLIP/i.test(text)) return "Receiving Receipt";
  if (/DELIVERY RECEIPT|PROOF OF DELIVERY/i.test(text)) return "Delivery Receipt";
  if (/QR LABEL|LABEL/i.test(text)) return "QR Label";
  return "Print Document";
}

function documentNumberFromPrintText(text: string) {
  return text.match(/\b(RR|TR|PKG|DR)-\d{4}-\d{2}-\d{6}\b/)?.[0] ?? "Document number pending";
}

function branchOptionsForUser(user: { role: string; branchAccess?: string }, branches: Branch[] = []) {
  const operationalBranches = operationalBranchNames(branches);
  if (user.role === "Customer Owner") return ["Customer portal"];
  if (user.role === "System Admin") return ["All branches", ...operationalBranches];
  if (user.role === "Daet Owner") return operationalBranches.includes("Daet") ? ["Daet"] : ["Daet"];
  if (user.role === "Naga Owner") return operationalBranches.includes("Naga") ? ["Naga"] : ["Naga"];
  const access = user.branchAccess ?? "";
  if (/all branches|origin warehouse|daet\s*\/\s*naga/i.test(access)) return operationalBranches.length ? operationalBranches : ["Daet", "Naga"];
  const selected = operationalBranches.filter((branch) => access.toLowerCase().includes(branch.toLowerCase()));
  return selected.length ? selected : operationalBranches.length ? operationalBranches : ["Daet", "Naga"];
}

function isOwnerRole(role: string) {
  return ["Administrator", "System Admin", "Daet Owner", "Naga Owner"].includes(role);
}

function demoEmailForRole(role: string) {
  if (role === "Daet Owner") return "daet.owner@mts.local";
  if (role === "Naga Owner") return "naga.owner@mts.local";
  if (role === "System Admin") return "admin@mts.local";
  if (role === "Receiving Staff") return "receiving@mts.local";
  if (role === "Delivery Staff") return "delivery@mts.local";
  if (role === "Customer Owner") return "customer@mts.local";
  return "daet.owner@mts.local";
}

function demoEmailForParam(demo?: string) {
  if (demo === "receiving") return "receiving@mts.local";
  if (demo === "delivery") return "delivery@mts.local";
  if (demo === "naga" || demo === "naga-owner") return "naga.owner@mts.local";
  if (demo === "admin" || demo === "system-admin") return "admin@mts.local";
  if (demo === "customer" || demo === "customer-owner") return "customer@mts.local";
  if (demo === "owner" || demo === "daet" || demo === "daet-owner") return "daet.owner@mts.local";
  return undefined;
}

function demoEmailFromCurrentUrl() {
  if (typeof window === "undefined") return undefined;
  const demo = new URLSearchParams(window.location.search).get("demo")?.toLowerCase();
  return demoEmailForParam(demo);
}

function formatSearchDate(value?: string) {
  if (!value) return "No date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

function rankSearchResult(values: unknown[], query: string) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return 1;
  return values.reduce<number>((score, value, index) => {
    const text = String(value ?? "").toLowerCase();
    if (!text) return score;
    if (text === normalizedQuery) return Math.max(score, 100 - index);
    if (text.startsWith(normalizedQuery)) return Math.max(score, 80 - index);
    if (text.includes(normalizedQuery)) return Math.max(score, 50 - index);
    return score;
  }, 0);
}

function normalizeMatchText(value: unknown) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function diceSimilarity(a: string, b: string) {
  const first = normalizeMatchText(a).replace(/\s+/g, "");
  const second = normalizeMatchText(b).replace(/\s+/g, "");
  if (!first || !second) return 0;
  if (first === second) return 1;
  if (first.includes(second) || second.includes(first)) return 0.82;
  if (first.length < 3 || second.length < 3) return 0;
  const pairs = new Map<string, number>();
  for (let index = 0; index < first.length - 1; index += 1) {
    const pair = first.slice(index, index + 2);
    pairs.set(pair, (pairs.get(pair) ?? 0) + 1);
  }
  let intersection = 0;
  for (let index = 0; index < second.length - 1; index += 1) {
    const pair = second.slice(index, index + 2);
    const count = pairs.get(pair) ?? 0;
    if (count > 0) {
      intersection += 1;
      pairs.set(pair, count - 1);
    }
  }
  return (2 * intersection) / (first.length + second.length - 2);
}

function confidenceClass(confidence: DrOcrConfidence) {
  return `ocrConfidencePill ${confidence.toLowerCase()}`;
}

function OcrConfidenceGrid({ result }: { result: DrOcrResult }) {
  const entries: Array<[string, DrOcrConfidence]> = [
    ["DR", result.confidence.drNumber],
    ["Customer", result.confidence.customerName],
    ["Address", result.confidence.deliveryArea],
    ["Items", result.confidence.items]
  ];
  return (
    <div className="ocrConfidenceGrid">
      {result.documentProfile && (
        <div className={confidenceClass(result.documentProfile.confidence)}>
          <span>Template</span>
          <strong>{result.documentProfile.name}</strong>
        </div>
      )}
      {entries.map(([label, confidence]) => (
        <div className={confidenceClass(confidence)} key={label}>
          <span>{label}</span>
          <strong>{confidence}</strong>
        </div>
      ))}
    </div>
  );
}

function AutocompleteField<T>({
  label,
  value,
  placeholder,
  items,
  selectedLabel,
  noResultsText,
  minChars = 2,
  inputRef,
  getLabel,
  getMeta,
  getSearchValues,
  getExactValues,
  onChange,
  onSelect,
  onInputEnter
}: {
  label?: string;
  value: string;
  placeholder?: string;
  items: T[];
  selectedLabel?: string;
  noResultsText: string;
  minChars?: number;
  inputRef?: Ref<HTMLInputElement>;
  getLabel: (item: T) => string;
  getMeta?: (item: T) => string;
  getSearchValues?: (item: T) => unknown[];
  getExactValues?: (item: T) => unknown[];
  onChange: (value: string) => void;
  onSelect: (item: T) => void;
  onInputEnter?: (value: string, suggestions: T[]) => void;
}) {
  const query = value.trim();
  const showSuggestions = query.length >= minChars && selectedLabel !== query;
  const suggestionEntries = showSuggestions
    ? items
      .map((item) => ({
        item,
        score: rankSearchResult(getSearchValues ? getSearchValues(item) : [getLabel(item)], query)
      }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
    : [];
  const suggestions = suggestionEntries.map((entry) => entry.item);
  const exactMatch = query
    ? items.find((item) => {
      const exactValues = getExactValues ? getExactValues(item) : [getLabel(item), ...(getSearchValues ? getSearchValues(item) : [])];
      return exactValues.some((entry) => String(entry ?? "").trim().toLowerCase() === query.toLowerCase());
    })
    : undefined;

  return (
    <div className="autocompleteField">
      <label>
        {label && <span>{label}</span>}
        <input
          ref={inputRef}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            if (exactMatch) {
              onSelect(exactMatch);
              return;
            }
            if (suggestions.length === 1) {
              const [onlySuggestion] = suggestions;
              if (onlySuggestion) onSelect(onlySuggestion);
              return;
            }
            onInputEnter?.(query, suggestions);
          }}
          placeholder={placeholder}
          autoComplete="off"
        />
      </label>
      {showSuggestions && (
        <div className="suggestionList autocompleteSuggestions">
          {suggestions.map((item) => (
            <button className="suggestionButton" key={getLabel(item)} onClick={() => onSelect(item)}>
              <span>{getLabel(item)}</span>
              {getMeta && <small>{getMeta(item)}</small>}
            </button>
          ))}
          {!suggestions.length && <p className="muted">{noResultsText}</p>}
        </div>
      )}
    </div>
  );
}

function LongTextField({
  label,
  value,
  onChange,
  placeholder,
  threshold = 42,
  rows = 3,
  disabled = false,
  className
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  threshold?: number;
  rows?: number;
  disabled?: boolean;
  className?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const isLong = value.trim().length > threshold;

  useEffect(() => {
    if (!value.trim() || value.trim().length <= threshold) setExpanded(false);
  }, [threshold, value]);

  return (
    <div className={`longTextField ${className ?? ""}`}>
      <label>
        <span>{label}</span>
        <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} disabled={disabled} />
      </label>
      {value.trim() && (isLong || expanded) && (
        <div className="longTextEditBox">
          <div className="longTextEditHeader">
            <span>{isLong ? `Long ${label.toLowerCase()}` : label}</span>
            <button className="textButton" type="button" onClick={() => setExpanded((current) => !current)}>
              {expanded ? "Done" : "Edit Full"}
            </button>
          </div>
          {expanded ? (
            <textarea value={value} onChange={(event) => onChange(event.target.value)} rows={rows} placeholder={placeholder} disabled={disabled} />
          ) : (
            <button className="longTextPreview" type="button" onClick={() => setExpanded(true)}>
              {value}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function PrintPanel({ text, autoPrintKey = 0, onClose }: { text: string; autoPrintKey?: number; onClose: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [printMessage, setPrintMessage] = useState("Ready to print");
  const [isPrinting, setIsPrinting] = useState(false);
  const [paperWidth, setPaperWidth] = useState<"58mm" | "80mm">(() => readDevicePaperWidth());
  const panelRef = useRef<HTMLElement | null>(null);
  const receiptRef = useRef<HTMLPreElement | null>(null);
  const lastAutoPrintKeyRef = useRef(0);
  const title = documentTitleFromPrintText(text);
  const documentNumber = documentNumberFromPrintText(text);

  useEffect(() => {
    setPaperWidth(readDevicePaperWidth());
  }, []);

  async function printDocument(label: string) {
    setIsPrinting(true);
    setPrintMessage(`${label} started...`);
    try {
      const result = await printNativeText(text, documentNumber || title, paperWidth);
      if (result.ok) {
        setPrintMessage(`${label} request sent. Check if paper came out.`);
        return;
      }

      window.print();
      setPrintMessage(`${label} opened browser print fallback.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : `${label} failed. Check Device setup or try again.`;
      setPrintMessage(message);
      emitUserIssue({
        level: "error",
        title: `${label} failed`,
        message,
        source: "printer",
        details: { paperWidth, documentNumber, title, textLength: text.length },
        module: "printing"
      });
    } finally {
      setIsPrinting(false);
    }
  }

  useEffect(() => {
    if (!autoPrintKey || lastAutoPrintKeyRef.current === autoPrintKey) return;
    lastAutoPrintKeyRef.current = autoPrintKey;
    window.setTimeout(() => {
      void printDocument("Print");
    }, 120);
  }, [autoPrintKey]);

  useEffect(() => {
    window.setTimeout(() => {
      panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);
  }, [text]);

  useEffect(() => {
    if (!expanded) return;
    window.setTimeout(() => {
      receiptRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, 80);
  }, [expanded]);

  return (
    <section ref={panelRef} className="panel printArea printPanel">
      <div className="sectionHeader">
        <div>
          <p className="eyebrow">Print Ready</p>
          <h3>{title}</h3>
          <p className="muted">{documentNumber} - choose the paper size installed in the device</p>
        </div>
        <button className="iconOnlyButton" aria-label="Close print preview" onClick={onClose}><X size={18} /></button>
      </div>
      <div className="printStatusGrid">
        <div><span>Status</span><strong>{isPrinting ? "Printing..." : printMessage}</strong></div>
        <label>
          <span>Available Paper</span>
          <select
            value={paperWidth}
            onChange={(event) => {
              const value = event.target.value === "58mm" ? "58mm" : "80mm";
              setPaperWidth(value);
              window.localStorage.setItem(DEVICE_PAPER_WIDTH_KEY, value);
            }}
          >
            <option value="80mm">80mm</option>
            <option value="58mm">58mm</option>
          </select>
        </label>
        <div><span>Audit</span><strong>Tracked</strong></div>
      </div>
      <p className="notice">{printMessage}</p>
      <p className="muted">If no paper comes out, open Device and check the printer setup.</p>
      <div className="printPanelActions">
        <button className="primaryButton printPanelPrimaryButton" disabled={isPrinting} onClick={() => printDocument("Print")}><Printer /> Print</button>
        <div className="printPanelSecondaryActions">
          <button className="smallButton printPanelSecondaryButton" disabled={isPrinting} onClick={() => printDocument("Reprint")}><Printer /> Reprint</button>
          <button className="smallButton printPanelSecondaryButton" onClick={() => setExpanded((value) => !value)}>{expanded ? "Hide Preview" : "View Preview"}</button>
        </div>
      </div>
      <pre ref={receiptRef} className={expanded ? "receipt" : "receipt receiptCollapsed"}>{text}</pre>
    </section>
  );
}

function GlobalIssueBanner({
  issue,
  issueCount,
  onClose,
  onOpenLogs
}: {
  issue: UserIssue;
  issueCount: number;
  onClose: () => void;
  onOpenLogs: () => void;
}) {
  const icon = issue.level === "success" ? <CheckCircle2 size={20} /> : <AlertTriangle size={20} />;
  return (
    <section className={`globalIssueBanner ${issue.level}`} role="alert" aria-live="assertive">
      <div className="globalIssueIcon">{icon}</div>
      <div className="globalIssueBody">
        <strong>{issue.title}</strong>
        <p>{issue.message}</p>
        <small>Saved in blackbox{issueCount > 1 ? ` • ${issueCount} issues this session` : ""}</small>
      </div>
      <div className="globalIssueActions">
        <button className="smallButton" type="button" onClick={onOpenLogs}>Device Logs</button>
        <button className="iconOnlyButton" type="button" aria-label="Close issue prompt" onClick={onClose}><X size={18} /></button>
      </div>
    </section>
  );
}

export function AppShell() {
  const [activeTab, setActiveTab] = useState<Tab>("dashboard");
  const [homeOpen, setHomeOpen] = useState(true);
  const [bootstrap, setBootstrap] = useState<BootstrapData | null>(null);
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [packages, setPackages] = useState<CargoPackage[]>([]);
  const [productMasters, setProductMasters] = useState<ProductMaster[]>([]);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [expenses, setExpenses] = useState<ExpenseRecord[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [hardwareTests, setHardwareTests] = useState<HardwareTestRecord[]>([]);
  const [operationChats, setOperationChats] = useState<OperationChatThread[]>([]);
  const [receiptPreview, setReceiptPreview] = useState("");
  const [receiptAutoPrintKey, setReceiptAutoPrintKey] = useState(0);
  const [status, setStatus] = useState("Ready");
  const [searchQuery, setSearchQuery] = useState("");
  const [language, setLanguage] = useState<"English" | "Tagalog">("English");
  const [activeUser, setActiveUser] = useState<OperatorUser>({
    id: "user_daet_owner",
    name: "Daet Owner Demo",
    email: "daet.owner@mts.local",
    role: "Daet Owner",
    branchId: "branch_daet",
    branchAccess: "Daet",
    permissionPreset: "Branch Owner",
    canApprove: ["Daet prices", "Daet expenses", "Mixed trips"],
    hasStaffCode: true
  });
  const [activeBranchContext, setActiveBranchContext] = useState("Daet");
  const [touchStartX, setTouchStartX] = useState<number | null>(null);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [navBackStack, setNavBackStack] = useState<AppView[]>([]);
  const [navForwardStack, setNavForwardStack] = useState<AppView[]>([]);
  const [isOnline, setIsOnline] = useState(true);
  const [lastSyncedAt, setLastSyncedAt] = useState("");
  const [lastCachedAt, setLastCachedAt] = useState("");
  const [syncState, setSyncState] = useState<SyncState>("Online");
  const [pendingSyncCount, setPendingSyncCount] = useState(0);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const demoLoginAppliedRef = useRef(false);
  const visibleTabs = useMemo(() => visibleTabsForRole(activeUser.role), [activeUser.role]);
  const [globalIssue, setGlobalIssue] = useState<UserIssue | null>(null);
  const [issueCount, setIssueCount] = useState(0);

  const showGlobalIssue = useCallback((input: UserIssueInput) => {
    const level = input.level ?? "error";
    const issue: UserIssue = {
      ...input,
      id: `issue_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      level,
      createdAt: new Date().toISOString()
    };
    setGlobalIssue(issue);
    if (level !== "success") setIssueCount((count) => count + 1);
    void appendDiagnosticLog({
      level: level === "success" ? "info" : level,
      source: input.source ?? "action",
      message: `${input.title}: ${input.message}`,
      details: input.details,
      userId: activeUser.id,
      branch: branchScopeForUser(activeUser, activeBranchContext),
      module: input.module ?? activeTab
    });
  }, [activeBranchContext, activeTab, activeUser]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleUserIssue = (event: Event) => {
      const detail = (event as CustomEvent<UserIssueInput>).detail;
      if (!detail?.title || !detail.message) return;
      showGlobalIssue(detail);
    };
    window.addEventListener("mts-user-issue", handleUserIssue);
    return () => window.removeEventListener("mts-user-issue", handleUserIssue);
  }, [showGlobalIssue]);

  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    if (window.location.protocol !== "https:" && window.location.hostname !== "localhost") return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // The app still works without shell caching; operational cache is handled separately.
    });
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const logRuntimeError = (event: ErrorEvent) => {
      showGlobalIssue({
        level: "error",
        source: "runtime",
        title: "App error",
        message: event.message || "Runtime error",
        details: { filename: event.filename, lineno: event.lineno, colno: event.colno, error: event.error },
        module: activeTab
      });
    };
    const logUnhandledRejection = (event: PromiseRejectionEvent) => {
      const message = event.reason instanceof Error ? event.reason.message : "Something failed while the app was running.";
      showGlobalIssue({
        level: "error",
        source: "runtime",
        title: "App action failed",
        message,
        details: event.reason,
        module: activeTab
      });
    };
    window.addEventListener("error", logRuntimeError);
    window.addEventListener("unhandledrejection", logUnhandledRejection);
    return () => {
      window.removeEventListener("error", logRuntimeError);
      window.removeEventListener("unhandledrejection", logUnhandledRejection);
    };
  }, [activeTab, showGlobalIssue]);

  function currentView(): AppView {
    if (accountOpen) return { kind: "account" };
    if (homeOpen) return { kind: "home" };
    return { kind: "tab", tab: activeTab };
  }

  function applyView(view: AppView) {
    if (view.kind === "home") {
      setHomeOpen(true);
      setAccountOpen(false);
    } else if (view.kind === "account") {
      setHomeOpen(false);
      setAccountOpen(true);
    } else {
      setActiveTab(view.tab);
      setHomeOpen(false);
      setAccountOpen(false);
    }
    setMobileSearchOpen(false);
    setReceiptPreview("");
  }

  function navigateTo(view: AppView) {
    const previous = currentView();
    if (sameAppView(previous, view)) {
      applyView(view);
      return;
    }
    setNavBackStack((stack) => [...stack.slice(-9), previous]);
    setNavForwardStack([]);
    applyView(view);
  }

  function navigateBack() {
    setNavBackStack((stack) => {
      const previous = stack.at(-1);
      if (!previous) {
        applyView({ kind: "home" });
        return stack;
      }
      setNavForwardStack((forwardStack) => [currentView(), ...forwardStack.slice(0, 9)]);
      applyView(previous);
      return stack.slice(0, -1);
    });
  }

  function navigateForward() {
    setNavForwardStack((stack) => {
      const next = stack[0];
      if (!next) return stack;
      setNavBackStack((backStack) => [...backStack.slice(-9), currentView()]);
      applyView(next);
      return stack.slice(1);
    });
  }
  const canAccessReceiving = visibleTabs.some((tab) => tab.id === "receiving");
  const activeBranchOptions = useMemo(() => branchOptionsForUser(activeUser, bootstrap?.branches ?? []), [activeUser, bootstrap?.branches]);

  useEffect(() => {
    setPhotoAuditUser({
      id: activeUser.id,
      name: activeUser.name,
      role: activeUser.role
    });
  }, [activeUser.id, activeUser.name, activeUser.role]);

  const refresh = useCallback(async () => {
    const cacheKey = shellCacheKey(activeUser.id);
    const cached = await readCachedRecord<ShellCacheData>(cacheKey);
    if (cached) {
      setBootstrap(cached.value.bootstrap);
      setDashboard(cached.value.dashboard);
      setLastCachedAt(formatSyncTime(cached.savedAt));
      setSyncState("Cached");
      setStatus(`Cached${formatSyncTime(cached.savedAt) ? ` ${formatSyncTime(cached.savedAt)}` : ""} / Syncing`);
    }
    try {
      setSyncState("Refreshing");
      const [boot, dash] = await Promise.all([
        apiGet<BootstrapData>("/bootstrap"),
        apiGet<DashboardData>("/dashboard")
      ]);
      setBootstrap(boot);
      setDashboard(dash);
      await writeCachedValue(cacheKey, { bootstrap: boot, dashboard: dash }, { source: "server", userId: activeUser.id, branch: activeBranchContext, module: "shell" });
      setLastSyncedAt(new Date().toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }));
      setSyncState("Online");
    } catch (error) {
      if (cached) {
        setSyncState("Offline");
        setStatus("Offline: showing cached app data.");
        return;
      }
      setSyncState("Sync failed");
      throw error;
    }
  }, [activeBranchContext, activeUser.id]);

  useEffect(() => {
    const demoEmail = demoEmailFromCurrentUrl();
    if (demoEmail && !demoLoginAppliedRef.current) return;
    refresh().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "Unable to load app data";
      setStatus(message);
      showGlobalIssue({
        level: "error",
        title: "Cannot load app data",
        message,
        source: "api",
        details: error,
        module: "shell"
      });
    });
  }, [refresh, showGlobalIssue]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setIsOnline(window.navigator.onLine);
    const markOnline = () => setIsOnline(true);
    const markOffline = () => setIsOnline(false);
    window.addEventListener("online", markOnline);
    window.addEventListener("offline", markOffline);
    return () => {
      window.removeEventListener("online", markOnline);
      window.removeEventListener("offline", markOffline);
    };
  }, []);

  useEffect(() => {
    if (!activeBranchOptions.length) return;
    if (!activeBranchOptions.includes(activeBranchContext)) {
      setActiveBranchContext(activeBranchOptions[0] ?? "Daet");
    }
  }, [activeBranchContext, activeBranchOptions]);

  const branchScope = branchScopeForUser(activeUser, activeBranchContext);
  const branchScopedPackages = branchScope ? packages.filter((pkg) => pkg.handlingBranchName === branchScope || pkg.destination === branchScope) : packages;
  const branchScopedPackageIds = useMemo(() => new Set(branchScopedPackages.map((pkg) => pkg.id)), [branchScopedPackages]);
  const branchScopedTrips = branchScope ? trips.filter((trip) => trip.destination === branchScope || trip.cargoPackageIds.some((packageId) => branchScopedPackageIds.has(packageId))) : trips;
  const branchScopedTripIds = useMemo(() => new Set(branchScopedTrips.map((trip) => trip.id)), [branchScopedTrips]);
  const branchScopedPayments = branchScope ? payments.filter((payment) => payment.branchName === branchScope || branchScopedPackageIds.has(payment.cargoPackageId)) : payments;
  const branchScopedExpenses = branchScope ? expenses.filter((expense) => expense.tripId && branchScopedTripIds.has(expense.tripId)) : expenses;
  const packageById = useMemo(() => new Map(branchScopedPackages.map((pkg) => [pkg.id, pkg])), [branchScopedPackages]);

  useEffect(() => {
    setPhotoUploadContext({
      userId: activeUser.id,
      branch: branchScope
    });
  }, [activeUser.id, branchScope]);

  async function refreshPendingSyncCount() {
    const [queue, photos] = await Promise.all([listOfflineQueue(), listQueuedPhotos()]);
    const pendingActions = queue.filter((record) => record.status === "Pending" || record.status === "Failed" || record.status === "Syncing").length;
    const pendingPhotos = photos.filter((record) => record.status === "Pending" || record.status === "Failed" || record.status === "Syncing").length;
    setPendingSyncCount(pendingActions + pendingPhotos);
  }

  function isNetworkError(error: unknown) {
    if (!isOnline) return true;
    if (typeof navigator !== "undefined" && !navigator.onLine) return true;
    const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
    return message.includes("failed to fetch") || message.includes("network") || message.includes("offline");
  }

  async function queueablePost<T>(type: OfflineQueueRecord["type"], path: string, body?: unknown) {
    if (!isOnline || (typeof navigator !== "undefined" && !navigator.onLine)) {
      await enqueueOfflineAction({ type, method: "POST", path, body, userId: activeUser.id, branch: branchScope });
      void appendDiagnosticLog({ level: "warning", source: "offline", message: `Queued offline ${type}`, details: { path, body }, userId: activeUser.id, branch: branchScope, module: activeTab });
      await refreshPendingSyncCount();
      setSyncState("Pending sync");
      setStatus("Saved on tablet - needs sync.");
      return { queued: true as const };
    }
    try {
      const result = await apiPost<T>(path, body);
      return { queued: false as const, result };
    } catch (error) {
      if (!isNetworkError(error)) throw error;
      await enqueueOfflineAction({ type, method: "POST", path, body, userId: activeUser.id, branch: branchScope });
      void appendDiagnosticLog({ level: "warning", source: "offline", message: `Queued failed ${type}`, details: { path, body, error }, userId: activeUser.id, branch: branchScope, module: activeTab });
      await refreshPendingSyncCount();
      setSyncState("Pending sync");
      setStatus("Saved on tablet - needs sync.");
      return { queued: true as const };
    }
  }

  function blobToDataUrl(blob: Blob) {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error ?? new Error("Unable to read queued photo"));
      reader.readAsDataURL(blob);
    });
  }

  async function uploadQueuedPhoto(record: QueuedPhotoRecord) {
    const dataUrl = await blobToDataUrl(record.compressedBlob);
    return apiPost<{ fileUrl: string; size: number; mimeType: string; type: string }>("/uploads", {
      dataUrl,
      fileName: record.fileName,
      type: record.photoType,
      entityId: record.entityId
    });
  }

  async function processQueuedPhotos() {
    if (!isOnline || (typeof navigator !== "undefined" && !navigator.onLine)) return;
    const photos = (await listQueuedPhotos()).filter((record) => record.status === "Pending" || record.status === "Failed");
    if (!photos.length) return;
    setSyncState("Syncing");
    for (const record of photos) {
      const syncingRecord = { ...record, status: "Syncing" as const, attempts: record.attempts + 1, lastError: undefined };
      await updateQueuedPhoto(syncingRecord);
      await refreshPendingSyncCount();
      try {
        const uploaded = await uploadQueuedPhoto(record);
        await replaceQueuedPhotoReferences(record.localPhotoId, uploaded.fileUrl);
        await updateQueuedPhoto({ ...syncingRecord, status: "Synced", serverUrl: uploaded.fileUrl });
        await deleteQueuedPhoto(record.localPhotoId);
      } catch (error) {
        void appendDiagnosticLog({ level: "error", source: "sync", message: "Queued photo sync failed", details: { localPhotoId: record.localPhotoId, error }, userId: activeUser.id, branch: branchScope, module: activeTab });
        await updateQueuedPhoto({
          ...syncingRecord,
          status: "Failed",
          lastError: error instanceof Error ? error.message : "Photo sync failed"
        });
      }
    }
    await refreshPendingSyncCount();
  }

  async function processOfflineQueue() {
    if (!isOnline || (typeof navigator !== "undefined" && !navigator.onLine)) return;
    await processQueuedPhotos();
    const queue = (await listOfflineQueue()).filter((record) => record.status === "Pending" || record.status === "Failed");
    if (!queue.length) {
      await refreshPendingSyncCount();
      return;
    }
    setSyncState("Syncing");
    for (const record of queue) {
      const syncingRecord = { ...record, status: "Syncing" as const, attempts: record.attempts + 1, lastError: undefined };
      await updateOfflineQueueRecord(syncingRecord);
      await refreshPendingSyncCount();
      try {
        if (record.method === "PATCH") {
          await apiPatch(record.path, record.body);
        } else {
          await apiPost(record.path, record.body);
        }
        await updateOfflineQueueRecord({ ...syncingRecord, status: "Synced" });
      } catch (error) {
        void appendDiagnosticLog({ level: "error", source: "sync", message: "Queued action sync failed", details: { id: record.id, type: record.type, path: record.path, error }, userId: activeUser.id, branch: branchScope, module: activeTab });
        await updateOfflineQueueRecord({
          ...syncingRecord,
          status: "Failed",
          lastError: error instanceof Error ? error.message : "Sync failed"
        });
      }
    }
    await refreshPendingSyncCount();
    const remaining = (await listOfflineQueue()).filter((record) => record.status === "Pending" || record.status === "Failed").length;
    setSyncState(remaining ? "Sync failed" : "Online");
    if (!remaining) {
      await refresh();
      await refreshCurrentTabData(activeTab);
      setStatus("Pending tablet actions synced.");
    } else {
      setStatus(`${remaining} tablet action(s) still need sync.`);
    }
  }

  const searchedPackages = branchScopedPackages.filter((pkg) =>
    matchesSearch(
      [
        pkg.packageNumber,
        pkg.receivingRecordNumber,
        pkg.customerName,
        pkg.description,
        pkg.destination,
        pkg.condition,
        pkg.status,
        pkg.price,
        pkg.qrValue,
        pkg.createdAt
      ],
      searchQuery
    )
  );
  const searchedTrips = branchScopedTrips.filter((trip) =>
    matchesSearch(
      [
        trip.tripNumber,
        trip.origin,
        trip.destination,
        trip.status,
        trip.vehicleDescription,
        trip.driverName,
        trip.cargoPackageIds.join(" ")
      ],
      searchQuery
    )
  );
  const searchedPayments = branchScopedPayments.filter((payment) => {
    const pkg = packageById.get(payment.cargoPackageId);
    return matchesSearch(
      [
        payment.amountDue,
        payment.amountPaid,
        payment.balance,
        payment.method,
        payment.status,
        payment.createdAt,
        pkg?.packageNumber,
        pkg?.description,
        pkg?.destination,
        pkg?.customerName
      ],
      searchQuery
    );
  });
  const searchedExpenses = branchScopedExpenses.filter((expense) =>
    matchesSearch([expense.category, expense.amount, expense.description, expense.status, expense.tripId, expense.createdAt], searchQuery)
  );
  const searchedAuditLogs = auditLogs.filter((log) =>
    matchesSearch([log.action, log.entityType, log.entityId, log.reason, log.createdAt], searchQuery)
  );
  const searchedHardwareTests = hardwareTests.filter((test) =>
    matchesSearch(
      [
        test.deviceName,
        test.scannerResult,
        test.printerResult,
        test.cameraResult,
        test.signatureResult,
        test.pwaResult,
        test.notes,
        test.createdAt
      ],
      searchQuery
    )
  );
  const searchedCustomers = (bootstrap?.customers ?? []).filter((customer) =>
    matchesSearch([customer.businessName, customer.contactPerson, customer.phone, customer.billingTerm, customer.status], searchQuery)
  );
  const searchedOperationChats = operationChats.filter((thread) =>
    matchesSearch(
      [
        thread.title,
        thread.scope,
        thread.status,
        thread.branchName,
        thread.packageNumber,
        thread.customerName,
        thread.description,
        thread.proposedPrice,
        thread.approvedPrice,
        thread.messages.map((message) => `${message.senderName} ${message.body}`).join(" ")
      ],
      searchQuery
    )
  );
  const pricedPackages = searchedPackages.filter((pkg) => pkg.price != null);
  const loadablePackages = pricedPackages.filter((pkg) => ["Waiting for Loading", "Received"].includes(pkg.status));
  const deliveryPackages = searchedPackages.filter((pkg) => ["Arrived", "Ready for Delivery", "Failed Delivery", "Exception"].includes(pkg.status));
  const deliveredPackages = searchedPackages.filter((pkg) => pkg.status === "Delivered");
  const paymentPackages = Array.from(new Map([...deliveredPackages, ...pricedPackages].map((pkg) => [pkg.id, pkg])).values());
  const activeCollectionPoint = paymentCollectionPointForRole(activeUser.role);
  const roleScopedPayments =
    isOwnerRole(activeUser.role)
      ? searchedPayments
      : searchedPayments.filter((payment) => payment.collectionPoint === activeCollectionPoint || payment.collectedByUserId === activeUser.id);
  const unpaidResponsibilityPackages =
    isOwnerRole(activeUser.role)
      ? paymentPackages.filter((pkg) => pkg.price != null && !payments.some((payment) => payment.cargoPackageId === pkg.id && payment.status === "Paid"))
      : paymentPackages.filter((pkg) => {
          const hasPaid = payments.some((payment) => payment.cargoPackageId === pkg.id && payment.status === "Paid");
          if (hasPaid) return false;
          if (activeUser.role === "Receiving Staff") return ["Waiting for Loading", "Received", "Waiting for Price"].includes(pkg.status);
          if (activeUser.role === "Delivery Staff" || activeUser.role === "Delivery Admin") return ["Arrived", "Ready for Delivery", "In Transit", "Loaded", "Delivered"].includes(pkg.status);
          return false;
        });

  function applyModuleData(data: ModuleCacheData) {
    if (data.packages) setPackages(data.packages);
    if (data.productMasters) setProductMasters(data.productMasters);
    if (data.trips) setTrips(data.trips);
    if (data.payments) setPayments(data.payments);
    if (data.expenses) setExpenses(data.expenses);
    if (data.auditLogs) setAuditLogs(data.auditLogs);
    if (data.hardwareTests) setHardwareTests(data.hardwareTests);
    if (data.operationChats) setOperationChats(data.operationChats);
  }

  async function refreshCurrentTabData(tab = activeTab) {
    const branch = branchScope;
    const params = { limit: MODULE_FETCH_LIMIT, branch };
    const cacheKey = moduleCacheKey(tab, activeUser.id, branch);
    const cached = await readCachedRecord<ModuleCacheData>(cacheKey);
    if (cached) {
      applyModuleData(cached.value);
      setLastCachedAt(formatSyncTime(cached.savedAt));
      setSyncState("Cached");
      setStatus("Cached / Syncing");
    }

    if (tab === "dashboard") return;

    setSyncState("Refreshing");

    if (tab === "receiving") {
      const [productList, cargo] = await Promise.all([
        apiGet<ProductMaster[]>(apiQuery("/products", { limit: 500 })),
        apiGet<CargoPackage[]>(apiQuery("/packages", { ...params, status: "Waiting for Loading,Received,Waiting for Price" }))
      ]);
      const data = { productMasters: productList, packages: cargo };
      applyModuleData(data);
      await writeCachedValue(cacheKey, data, { source: "server", userId: activeUser.id, branch, module: tab });
      setSyncState("Online");
      return;
    }

    if (tab === "packages") {
      const [cargo, tripList] = await Promise.all([
        apiGet<CargoPackage[]>(apiQuery("/packages", params)),
        apiGet<Trip[]>(apiQuery("/trips", params))
      ]);
      const data = { packages: cargo, trips: tripList };
      applyModuleData(data);
      await writeCachedValue(cacheKey, data, { source: "server", userId: activeUser.id, branch, module: tab });
      setSyncState("Online");
      return;
    }

    if (tab === "trips") {
      const [cargo, tripList] = await Promise.all([
        apiGet<CargoPackage[]>(apiQuery("/packages", { ...params, limit: 500, status: "Waiting for Loading,Received,Waiting for Price,Loaded,In Transit,Arrived" })),
        apiGet<Trip[]>(apiQuery("/trips", params))
      ]);
      const data = { packages: cargo, trips: tripList };
      applyModuleData(data);
      await writeCachedValue(cacheKey, data, { source: "server", userId: activeUser.id, branch, module: tab });
      setSyncState("Online");
      return;
    }

    if (tab === "delivery") {
      const [cargo, paymentList] = await Promise.all([
        apiGet<CargoPackage[]>(apiQuery("/packages", { ...params, status: "Arrived,Ready for Delivery,Failed Delivery,Exception,Delivered" })),
        apiGet<PaymentRecord[]>(apiQuery("/payments", params))
      ]);
      const data = { packages: cargo, payments: paymentList };
      applyModuleData(data);
      await writeCachedValue(cacheKey, data, { source: "server", userId: activeUser.id, branch, module: tab });
      setSyncState("Online");
      return;
    }

    if (tab === "payments") {
      const [cargo, paymentList] = await Promise.all([
        apiGet<CargoPackage[]>(apiQuery("/packages", { ...params, limit: 500 })),
        apiGet<PaymentRecord[]>(apiQuery("/payments", { ...params, limit: 500 }))
      ]);
      const data = { packages: cargo, payments: paymentList };
      applyModuleData(data);
      await writeCachedValue(cacheKey, data, { source: "server", userId: activeUser.id, branch, module: tab });
      setSyncState("Online");
      return;
    }

    if (tab === "expenses") {
      const [expenseList, tripList] = await Promise.all([
        apiGet<ExpenseRecord[]>(apiQuery("/expenses", params)),
        apiGet<Trip[]>(apiQuery("/trips", params))
      ]);
      const data = { expenses: expenseList, trips: tripList };
      applyModuleData(data);
      await writeCachedValue(cacheKey, data, { source: "server", userId: activeUser.id, branch, module: tab });
      setSyncState("Online");
      return;
    }

    if (tab === "customer") {
      const [cargo, paymentList] = await Promise.all([
        apiGet<CargoPackage[]>(apiQuery("/packages", { ...params, limit: 500 })),
        apiGet<PaymentRecord[]>(apiQuery("/payments", { ...params, limit: 500 }))
      ]);
      const data = { packages: cargo, payments: paymentList };
      applyModuleData(data);
      await writeCachedValue(cacheKey, data, { source: "server", userId: activeUser.id, branch, module: tab });
      setSyncState("Online");
      return;
    }

    if (tab === "chat") {
      const [threads, cargo] = await Promise.all([
        apiGet<OperationChatThread[]>("/operation-chats"),
        apiGet<CargoPackage[]>(apiQuery("/packages", { ...params, limit: 500 }))
      ]);
      const data = { operationChats: threads, packages: cargo };
      applyModuleData(data);
      await writeCachedValue(cacheKey, data, { source: "server", userId: activeUser.id, branch, module: tab });
      setSyncState("Online");
      return;
    }

    if (tab === "admin") {
      const [cargo, logs] = await Promise.all([
        apiGet<CargoPackage[]>(apiQuery("/packages", { ...params, limit: 100 })),
        apiGet<AuditLog[]>(apiQuery("/audit", { limit: MODULE_FETCH_LIMIT }))
      ]);
      const data = { packages: cargo, auditLogs: logs };
      applyModuleData(data);
      await writeCachedValue(cacheKey, data, { source: "server", userId: activeUser.id, branch, module: tab });
      setSyncState("Online");
      return;
    }

    if (tab === "hardware") {
      try {
        const tests = await apiGet<HardwareTestRecord[]>("/hardware/tests");
        const data = { hardwareTests: tests };
        applyModuleData(data);
        await writeCachedValue(cacheKey, data, { source: "server", userId: activeUser.id, branch, module: tab });
        setSyncState("Online");
      } catch {
        setHardwareTests([]);
        setSyncState(cached ? "Offline" : "Sync failed");
      }
    }
  }

  useEffect(() => {
    if (!bootstrap || homeOpen || accountOpen) return;
    refreshCurrentTabData(activeTab).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "Unable to load module data";
      setSyncState(isOnline ? "Sync failed" : "Offline");
      setStatus(message);
      showGlobalIssue({
        level: isOnline ? "error" : "warning",
        title: isOnline ? "Cannot refresh this screen" : "Offline mode",
        message: isOnline ? message : "Showing saved data. Some latest records may be missing until the tablet syncs.",
        source: "sync",
        details: error,
        module: activeTab
      });
    });
  }, [activeTab, branchScope, bootstrap, homeOpen, accountOpen, isOnline, showGlobalIssue]);

  useEffect(() => {
    refreshPendingSyncCount().catch(() => undefined);
  }, [activeUser.id, branchScope]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const refreshQueuedPhotos = () => {
      refreshPendingSyncCount().catch(() => undefined);
      setSyncState("Pending sync");
    };
    window.addEventListener("mts-photo-queued", refreshQueuedPhotos);
    return () => window.removeEventListener("mts-photo-queued", refreshQueuedPhotos);
  }, [activeUser.id, branchScope]);

  useEffect(() => {
    if (!isOnline) {
      setSyncState(pendingSyncCount > 0 ? "Pending sync" : "Offline");
      return;
    }
    processOfflineQueue().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "Unable to sync tablet actions.";
      setSyncState("Sync failed");
      setStatus(message);
      showGlobalIssue({
        level: "error",
        title: "Sync failed",
        message,
        source: "sync",
        details: error,
        module: activeTab
      });
    });
  }, [activeTab, isOnline, pendingSyncCount, showGlobalIssue]);

  useEffect(() => {
    if (pendingSyncCount <= 0 || typeof window === "undefined") return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "Some tablet photos or actions still need sync.";
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [pendingSyncCount]);

  async function runAction<T>(label: string, action: () => Promise<T>) {
    setStatus(`${label}...`);
    void appendDiagnosticLog({ level: "info", source: "action", message: `${label} started`, userId: activeUser.id, branch: branchScope, module: activeTab });
    try {
      await action();
      await refresh();
      await refreshCurrentTabData(activeTab);
      setStatus(`${label} completed`);
      void appendDiagnosticLog({ level: "info", source: "action", message: `${label} completed`, userId: activeUser.id, branch: branchScope, module: activeTab });
    } catch (error) {
      const message = error instanceof Error ? error.message : `${label} failed`;
      setStatus(message);
      showGlobalIssue({
        level: "error",
        title: `${label} failed`,
        message,
        source: "action",
        details: error,
        module: activeTab
      });
      void appendDiagnosticLog({ level: "error", source: "action", message: `${label} failed`, details: error, userId: activeUser.id, branch: branchScope, module: activeTab });
    }
  }

  function selectTab(tab: Tab) {
    const allowed = visibleTabs.some((item) => item.id === tab);
    navigateTo({ kind: "tab", tab: allowed ? tab : "dashboard" });
  }

  function openHome() {
    navigateTo({ kind: "home" });
  }

  function openAccount() {
    navigateTo({ kind: "account" });
  }

  function openSearch() {
    setAccountOpen(false);
    setMobileSearchOpen(true);
  }

  function chooseSearchResult(tab: Tab) {
    selectTab(tab);
  }

  async function switchUser(user: OperatorUser) {
    const email = demoEmailForRole(user.role);
    const result = await apiPost<{ token: string; user: OperatorUser }>("/auth/login", {
      email,
      password: "password"
    });
    setApiToken(result.token);
    setActiveUser(result.user);
    await refresh();
  }

  async function switchUserByStaffCode(staffCode: string) {
    const result = await apiPost<{ token: string; user: OperatorUser }>("/auth/staff-code", { staffCode });
    setApiToken(result.token);
    setActiveUser(result.user);
    await refresh();
    setStatus(`Operator switched to ${result.user.name}`);
  }

  useEffect(() => {
    if (demoLoginAppliedRef.current || typeof window === "undefined") return;
    const email = demoEmailFromCurrentUrl();
    if (!email) return;

    demoLoginAppliedRef.current = true;
    apiPost<{ token: string; user: OperatorUser }>("/auth/login", { email, password: "password" })
      .then(async (result) => {
        setApiToken(result.token);
        setActiveUser(result.user);
        setStatus(`Demo session: ${result.user.name}`);
      })
      .catch((error: unknown) => setStatus(error instanceof Error ? error.message : "Unable to start demo session"));
  }, [refresh]);

  function currentTabIndex() {
    return visibleTabs.findIndex((tab) => tab.id === activeTab);
  }

  function goToRelativeTab(direction: 1 | -1) {
    const index = currentTabIndex();
    const next = visibleTabs[index + direction];
    if (next) selectTab(next.id);
  }

  function tileCountForTab(tab: Tab) {
    const waitingCargo = dashboard?.cargoWaiting ?? branchScopedPackages.filter((pkg) => ["Waiting for Loading", "Received"].includes(pkg.status)).length;
    const noPrice = dashboard?.cargoWithoutPrice ?? branchScopedPackages.filter((pkg) => pkg.price == null).length;
    const activeTrips = dashboard?.activeTrips ?? branchScopedTrips.filter((trip) => !["Completed", "Cancelled"].includes(trip.status)).length;
    const failedDeliveries = dashboard?.failedDeliveries ?? branchScopedPackages.filter((pkg) => pkg.status === "Failed Delivery").length;
    const submittedExpenses = dashboard?.expensesAwaitingApproval ?? branchScopedExpenses.filter((expense) => expense.status === "Submitted").length;
    const pendingCustomers = dashboard?.pendingCustomers ?? (bootstrap?.customers ?? []).filter((customer) => customer.status === "Pending").length;
    const pendingChatApprovals = operationChats.filter((thread) => thread.status === "Needs Approval").length;
    const deviceNeedsSetup = hardwareTests.some((test) => [test.scannerResult, test.printerResult, test.cameraResult, test.signatureResult, test.pwaResult].includes("Fail"))
      || !hardwareTests.length;

    if (tab === "dashboard") return failedDeliveries + noPrice + submittedExpenses + pendingCustomers;
    if (tab === "receiving") return noPrice;
    if (tab === "packages") return waitingCargo + noPrice;
    if (tab === "trips") return activeTrips;
    if (tab === "delivery") return failedDeliveries || deliveryPackages.length;
    if (tab === "payments") return unpaidResponsibilityPackages.length;
    if (tab === "expenses") return submittedExpenses;
    if (tab === "customer") return pendingCustomers;
    if (tab === "chat") return pendingChatApprovals;
    if (tab === "admin") return auditLogs.slice(-24).length;
    if (tab === "hardware") return deviceNeedsSetup ? 1 : 0;
    return 0;
  }

  function tileNoteForTab(tab: Tab) {
    const waitingCargo = dashboard?.cargoWaiting ?? branchScopedPackages.filter((pkg) => ["Waiting for Loading", "Received"].includes(pkg.status)).length;
    const noPrice = dashboard?.cargoWithoutPrice ?? branchScopedPackages.filter((pkg) => pkg.price == null).length;
    const activeTrips = dashboard?.activeTrips ?? branchScopedTrips.filter((trip) => !["Completed", "Cancelled"].includes(trip.status)).length;
    const failedDeliveries = dashboard?.failedDeliveries ?? branchScopedPackages.filter((pkg) => pkg.status === "Failed Delivery").length;
    const submittedExpenses = dashboard?.expensesAwaitingApproval ?? branchScopedExpenses.filter((expense) => expense.status === "Submitted").length;
    const pendingCustomers = dashboard?.pendingCustomers ?? (bootstrap?.customers ?? []).filter((customer) => customer.status === "Pending").length;
    const pendingChatApprovals = operationChats.filter((thread) => thread.status === "Needs Approval").length;

    if (tab === "dashboard") return "Business overview";
    if (tab === "receiving") return noPrice ? `${noPrice} without price` : "New receiving";
    if (tab === "packages") return waitingCargo ? `${waitingCargo} waiting` : "Cargo records";
    if (tab === "trips") return activeTrips ? `${activeTrips} active` : "Loading and trips";
    if (tab === "delivery") return failedDeliveries ? `${failedDeliveries} failed` : "Proof of delivery";
    if (tab === "payments") return unpaidResponsibilityPackages.length ? `${unpaidResponsibilityPackages.length} unpaid` : "Collected money";
    if (tab === "expenses") return submittedExpenses ? `${submittedExpenses} review` : "Add expenses";
    if (tab === "customer") return pendingCustomers ? `${pendingCustomers} pending` : "Customers";
    if (tab === "chat") return pendingChatApprovals ? `${pendingChatApprovals} approvals` : "Team chat";
    if (tab === "admin") return "Users and audit";
    if (tab === "settings") return "Configuration";
    if (tab === "hardware") return hardwareTests.length ? "Device setup" : "Needs setup";
    return "";
  }

  function tileToneForTab(tab: Tab) {
    const count = tileCountForTab(tab);
    const urgent =
      tab === "delivery" && (dashboard?.failedDeliveries ?? 0) > 0 ||
      tab === "expenses" && branchScopedExpenses.some((expense) => expense.status === "Submitted") ||
      tab === "chat" && operationChats.some((thread) => thread.status === "Needs Approval");
    if (urgent || count >= 3) return "dark";
    if (count > 0) return "medium";
    return "light";
  }

  function shouldIgnoreSwipe(target: EventTarget | null) {
    if (!(target instanceof HTMLElement)) return false;
    return Boolean(target.closest("input, textarea, select, button, a, pre, .modalLayer, .searchFocusLayer, .printPanel, .list, .suggestionList, .publicSuggestionList"));
  }

  const greeting = useMemo(() => {
    const waiting = dashboard?.cargoWaiting ?? 0;
    const approvals = dashboard?.expensesAwaitingApproval ?? 0;
    return language === "Tagalog"
      ? `Magandang araw. May ${waiting} package na naghihintay at ${approvals} expense na kailangang tingnan.`
      : `Good day. You have ${waiting} packages waiting and ${approvals} expenses needing review.`;
  }, [dashboard, language]);

  const searchResults = useMemo<SearchResultItem[]>(() => {
    const results: SearchResultItem[] = [];
    const query = searchQuery.trim();

    for (const pkg of branchScopedPackages) {
      const priority = rankSearchResult(
        [
          pkg.customerName,
          pkg.receivingRecordNumber,
          pkg.packageNumber,
          formatSearchDate(pkg.createdAt),
          pkg.destination,
          pkg.description,
          pkg.status
        ],
        query
      );
      if (query && priority === 0) continue;
      results.push({
        id: `package-${pkg.id}`,
        tab: "packages",
        type: "Package",
        customerName: pkg.customerName,
        documentNumber: pkg.receivingRecordNumber || pkg.packageNumber,
        date: formatSearchDate(pkg.createdAt),
        status: pkg.status,
        details: `${pkg.packageNumber} - ${pkg.description} - ${pkg.destination}`,
        amount: pkg.price == null ? "No price" : `PHP ${pkg.price.toLocaleString()}`,
        priority
      });
    }

    for (const trip of branchScopedTrips) {
      const relatedPackages = trip.cargoPackageIds.map((id) => packageById.get(id)).filter(Boolean) as CargoPackage[];
      const customerNames = Array.from(new Set(relatedPackages.map((pkg) => pkg.customerName))).join(", ");
      const priority = rankSearchResult(
        [
          customerNames,
          trip.tripNumber,
          trip.origin,
          trip.destination,
          trip.status,
          trip.vehicleDescription,
          trip.driverName
        ],
        query
      );
      if (query && priority === 0) continue;
      results.push({
        id: `trip-${trip.id}`,
        tab: "trips",
        type: "Trip",
        customerName: customerNames || "Multiple customers",
        documentNumber: trip.tripNumber,
        date: "Trip date pending",
        status: trip.status,
        details: `${trip.origin} to ${trip.destination} - ${trip.cargoPackageIds.length} package(s)`,
        priority
      });
    }

    for (const payment of branchScopedPayments) {
      const pkg = packageById.get(payment.cargoPackageId);
      const priority = rankSearchResult(
        [
          pkg?.customerName,
          pkg?.receivingRecordNumber,
          pkg?.packageNumber,
          formatSearchDate(payment.createdAt),
          payment.method,
          payment.status,
          payment.amountPaid,
          payment.balance
        ],
        query
      );
      if (query && priority === 0) continue;
      results.push({
        id: `payment-${payment.id}`,
        tab: "payments",
        type: "Payment",
        customerName: pkg?.customerName ?? "Customer not linked",
        documentNumber: pkg?.receivingRecordNumber ?? pkg?.packageNumber ?? "Payment record",
        date: formatSearchDate(payment.createdAt),
        status: payment.status,
        details: `${payment.method} - paid PHP ${payment.amountPaid.toLocaleString()} - balance PHP ${payment.balance.toLocaleString()}`,
        amount: `Due PHP ${payment.amountDue.toLocaleString()}`,
        priority
      });
    }

    for (const expense of branchScopedExpenses) {
      const priority = rankSearchResult(
        [expense.category, expense.description, expense.status, expense.tripId, formatSearchDate(expense.createdAt), expense.amount],
        query
      );
      if (query && priority === 0) continue;
      results.push({
        id: `expense-${expense.id}`,
        tab: "expenses",
        type: "Expense",
        customerName: "Operations",
        documentNumber: expense.tripId ?? "General expense",
        date: formatSearchDate(expense.createdAt),
        status: expense.status,
        details: `${expense.category} - ${expense.description ?? "No description"}`,
        amount: `PHP ${expense.amount.toLocaleString()}`,
        priority
      });
    }

    for (const customer of bootstrap?.customers ?? []) {
      const priority = rankSearchResult(
        [customer.businessName, customer.contactPerson, customer.phone, customer.billingTerm, customer.status],
        query
      );
      if (query && priority === 0) continue;
      results.push({
        id: `customer-${customer.id}`,
        tab: "customer",
        type: "Customer",
        customerName: customer.businessName,
        documentNumber: customer.phone ?? "No phone",
        date: customer.billingTerm ?? "No billing term",
        status: customer.status,
        details: customer.contactPerson ?? "Customer profile",
        priority
      });
    }

    for (const log of auditLogs) {
      const priority = rankSearchResult([log.action, log.entityType, log.entityId, log.reason, formatSearchDate(log.createdAt)], query);
      if (query && priority === 0) continue;
      results.push({
        id: `audit-${log.id}`,
        tab: "admin",
        type: "Audit",
        customerName: "System audit",
        documentNumber: log.entityId,
        date: formatSearchDate(log.createdAt),
        status: log.action,
        details: `${log.entityType}${log.reason ? ` - ${log.reason}` : ""}`,
        priority
      });
    }

    for (const test of hardwareTests) {
      const priority = rankSearchResult(
        [test.deviceName, test.scannerResult, test.printerResult, test.cameraResult, test.signatureResult, test.pwaResult, test.notes, formatSearchDate(test.createdAt)],
        query
      );
      if (query && priority === 0) continue;
      results.push({
        id: `hardware-${test.id}`,
        tab: "hardware",
        type: "Hardware",
        customerName: "Device test",
        documentNumber: test.deviceName,
        date: formatSearchDate(test.createdAt),
        status: test.pwaResult,
        details: `Scanner ${test.scannerResult} - Printer ${test.printerResult}`,
        priority
      });
    }

    return results
      .filter((item) => visibleTabs.some((tab) => tab.id === item.tab))
      .sort((a, b) => b.priority - a.priority || b.date.localeCompare(a.date))
      .slice(0, query ? 16 : 10);
  }, [auditLogs, bootstrap?.customers, branchScopedExpenses, branchScopedPackages, branchScopedPayments, branchScopedTrips, hardwareTests, packageById, searchQuery, visibleTabs]);

  useEffect(() => {
    if (!mobileSearchOpen) return;
    const timer = window.setTimeout(() => searchInputRef.current?.focus(), 50);
    return () => window.clearTimeout(timer);
  }, [mobileSearchOpen]);

  useEffect(() => {
    if (!visibleTabs.some((tab) => tab.id === activeTab)) {
      setActiveTab("dashboard");
      setReceiptPreview("");
    }
  }, [activeTab, visibleTabs]);

  const syncLabel = pendingSyncCount > 0
    ? `Needs Sync: ${pendingSyncCount}`
    : syncState === "Refreshing"
      ? "Syncing"
      : syncState === "Cached"
        ? `Cached${lastCachedAt ? ` ${lastCachedAt}` : ""}`
        : syncState === "Offline"
          ? "Offline"
          : syncState === "Sync failed"
            ? "Sync failed"
            : lastSyncedAt
              ? `Synced ${lastSyncedAt}`
              : "Online";
  const syncToneClass =
    pendingSyncCount > 0 ? "pending" :
    syncState === "Offline" || syncState === "Sync failed" ? "offline" :
    syncState === "Cached" ? "cached" :
    syncState === "Refreshing" || syncState === "Syncing" ? "syncing" :
    "";

  return (
    <main className={`app ${roleClass(activeUser.role)}`}>
      <section className="content">
        <div className={mobileSearchOpen ? "mobileTopbar searchOpen" : "mobileTopbar"}>
          <div className="mobileAppBar">
            {(!homeOpen || accountOpen) && (
              <button className="mobileBackButton" onClick={navigateBack} aria-label="Back">
                ‹
              </button>
            )}
            <button className="mobileBrand" onClick={openHome} aria-label="Go to home">
              <strong>LBMP</strong>
              <span>{activeUser.role} • {accountOpen ? "Account" : homeOpen ? "Home" : visibleTabs.find((tab) => tab.id === activeTab)?.label} • {activeBranchContext === "All branches" ? "All branches" : `${activeBranchContext} workspace`}</span>
            </button>
            <div className="mobileHeaderActions">
              <button className="mobileIconButton" aria-label={canAccessReceiving ? "New receiving" : "Dashboard"} onClick={() => selectTab(canAccessReceiving ? "receiving" : "dashboard")}><Plus size={28} /></button>
              <button className="mobileIconButton" aria-label="Search" onClick={openSearch}><Search size={28} /></button>
              <button className="mobileAccountButton" aria-label="Account details" onClick={openAccount}>
                <UserCog size={26} />
              </button>
            </div>
          </div>
          <div className={`mobileSyncLine ${syncToneClass}`}>
            {syncLabel}
          </div>
        </div>

        {mobileSearchOpen && (
          <div className="searchFocusLayer" role="dialog" aria-label="Search records">
            <button className="searchBackdrop" aria-label="Close search" onClick={() => setMobileSearchOpen(false)} />
            <section className="searchFocusPanel">
              <div className="searchFocusBox">
                <Search size={24} />
                <input
                  ref={searchInputRef}
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Search customer, document no., date..."
                />
                <button aria-label="Close search" onClick={() => setMobileSearchOpen(false)}><X size={22} /></button>
              </div>
              <div className="searchResults">
                {searchResults.length > 0 && (
                  <div className="searchListHeader">
                    <span>Customer</span>
                    <span>Document No.</span>
                    <span>Date</span>
                  </div>
                )}
                {searchResults.map((item) => (
                  <button className="searchRecordButton" key={item.id} onClick={() => chooseSearchResult(item.tab)}>
                    <div className="searchRecordTop">
                      <strong>{item.customerName}</strong>
                      <span className="searchTypeBadge">{item.type}</span>
                    </div>
                    <div className="searchRecordMain">
                      <strong>{item.documentNumber}</strong>
                      <span>{item.date}</span>
                    </div>
                    <p>{item.details}</p>
                    <div className="searchRecordMeta">
                      <span>{item.status}</span>
                      {item.amount && <span>{item.amount}</span>}
                    </div>
                  </button>
                ))}
                {!searchResults.length && (
                  <div className="searchEmpty">
                    <strong>No matching records</strong>
                    <p>Try customer name, document number, date, destination, package description, or payment method.</p>
                  </div>
                )}
              </div>
            </section>
          </div>
        )}

        <header className="topbar">
          <div>
            <p className="eyebrow">{accountOpen ? "Account details" : homeOpen ? "Home" : visibleTabs.find((tab) => tab.id === activeTab)?.label}</p>
            <h2>{accountOpen ? `${activeUser.name} settings` : homeOpen ? greeting : visibleTabs.find((tab) => tab.id === activeTab)?.label}</h2>
          </div>
          {(accountOpen || !homeOpen) && (
            <button className="backToHomeButton" onClick={openHome}>‹ Home</button>
          )}
          {!accountOpen && (
            <label className="searchBox" aria-label="Search records">
              <Search size={18} />
              <input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search packages, trips, payments..." />
            </label>
          )}
          {!accountOpen && (
            <button className="accountHeaderButton" aria-label="Account details" onClick={openAccount}>
              <UserCog size={22} />
              Account
            </button>
          )}
          <div className={`syncPill ${syncToneClass}`}>
            {syncLabel}
          </div>
          <div className="statusPill">{status}</div>
        </header>

        {globalIssue && (
          <GlobalIssueBanner
            issue={globalIssue}
            issueCount={issueCount}
            onClose={() => setGlobalIssue(null)}
            onOpenLogs={() => {
              setGlobalIssue(null);
              selectTab("hardware");
            }}
          />
        )}

        {accountOpen ? (
          <AccountPanel
            activeUser={activeUser}
            users={bootstrap?.users ?? []}
            language={language}
            setLanguage={setLanguage}
            switchUser={switchUser}
            switchUserByStaffCode={switchUserByStaffCode}
            apiConnected={Boolean(bootstrap)}
          />
        ) : (
          homeOpen ? (
            <HomeTiles
              tabs={visibleTabs}
              activeUser={activeUser}
              activeBranchContext={activeBranchContext}
              tileCountForTab={tileCountForTab}
              tileNoteForTab={tileNoteForTab}
              tileToneForTab={tileToneForTab}
              onSelect={selectTab}
            />
          ) : (
          <section
          className="swipeContent"
          onTouchStart={(event) => {
            if (shouldIgnoreSwipe(event.target)) return;
            setTouchStartX(event.touches[0]?.clientX ?? null);
          }}
          onTouchEnd={(event) => {
            if (touchStartX == null || shouldIgnoreSwipe(event.target)) return;
            const endX = event.changedTouches[0]?.clientX ?? touchStartX;
            const delta = endX - touchStartX;
            setTouchStartX(null);
            if (Math.abs(delta) < 70) return;
            if (delta > 0 && touchStartX < 56) {
              navigateBack();
              return;
            }
            if (delta < 0 && navForwardStack.length > 0) navigateForward();
          }}
        >
          {activeTab === "dashboard" && (
            <Dashboard
              dashboard={dashboard}
              bootstrap={bootstrap}
              packages={searchedPackages}
              trips={searchedTrips}
              payments={roleScopedPayments}
              unpaidPackages={unpaidResponsibilityPackages}
              activeUser={activeUser}
            />
          )}
          {activeTab === "receiving" && (
            <Receiving
              customers={bootstrap?.customers ?? []}
              branches={bootstrap?.branches ?? []}
              activeBranchContext={activeBranchContext}
              branchOptions={activeBranchOptions.filter((branch) => branch !== "All branches")}
              packages={searchedPackages}
              productMasters={productMasters}
              activeUser={activeUser}
              activeUserRole={activeUser.role}
              paymentMethods={bootstrap?.defaultPaymentMethods ?? []}
              setReceiptPreview={setReceiptPreview}
              triggerReceiptAutoPrint={() => setReceiptAutoPrintKey(Date.now())}
              onAction={runAction}
              queueablePost={queueablePost}
            />
          )}
          {activeTab === "packages" && (
            <Packages packages={searchedPackages} trips={searchedTrips} receiptPreview={receiptPreview} setReceiptPreview={setReceiptPreview} onAction={runAction} />
          )}
          {activeTab === "trips" && (
            <Trips packages={searchedPackages} loadablePackages={loadablePackages} trips={searchedTrips} trucks={bootstrap?.trucks ?? []} activeUserRole={activeUser.role} setReceiptPreview={setReceiptPreview} onAction={runAction} queueablePost={queueablePost} />
          )}
          {activeTab === "delivery" && (
            <Delivery
              packages={deliveryPackages}
              payments={roleScopedPayments}
              methods={bootstrap?.defaultPaymentMethods ?? []}
              activeUser={activeUser}
              setReceiptPreview={setReceiptPreview}
              onAction={runAction}
              queueablePost={queueablePost}
            />
          )}
          {activeTab === "payments" && (
            <Payments
              packages={paymentPackages}
              payments={roleScopedPayments}
              unpaidPackages={unpaidResponsibilityPackages}
              methods={bootstrap?.defaultPaymentMethods ?? []}
              activeUser={activeUser}
              onAction={runAction}
              queueablePost={queueablePost}
            />
          )}
          {activeTab === "expenses" && (
            <Expenses categories={bootstrap?.defaultExpenseCategories ?? []} expenses={searchedExpenses} trips={searchedTrips} activeUser={activeUser} onAction={runAction} queueablePost={queueablePost} />
          )}
          {activeTab === "customer" && (
            <CustomerPortal
              customers={bootstrap?.customers ?? []}
              packages={searchedPackages}
              payments={roleScopedPayments}
              setReceiptPreview={setReceiptPreview}
              onAction={runAction}
            />
          )}
          {activeTab === "chat" && (
            <OperationsChat
              activeUser={activeUser}
              threads={searchedOperationChats}
              packages={searchedPackages}
              onAction={runAction}
            />
          )}
          {activeTab === "admin" && <AdminAudit packages={searchedPackages} auditLogs={searchedAuditLogs} onAction={runAction} />}
          {activeTab === "settings" && <OwnerSettings bootstrap={bootstrap} activeUser={activeUser} onAction={runAction} />}
          {activeTab === "hardware" && <HardwarePrototype hardwareTests={searchedHardwareTests} setReceiptPreview={setReceiptPreview} onAction={runAction} />}
          {receiptPreview && <PrintPanel text={receiptPreview} autoPrintKey={receiptAutoPrintKey} onClose={() => {
            setReceiptPreview("");
            setReceiptAutoPrintKey(0);
          }} />}
          </section>
          )
        )}
      </section>
    </main>
  );
}

function HomeTiles({
  tabs,
  activeUser,
  activeBranchContext,
  tileCountForTab,
  tileNoteForTab,
  tileToneForTab,
  onSelect
}: {
  tabs: Array<{ id: Tab; label: string; icon: React.ElementType }>;
  activeUser: OperatorUser;
  activeBranchContext: string;
  tileCountForTab: (tab: Tab) => number;
  tileNoteForTab: (tab: Tab) => string;
  tileToneForTab: (tab: Tab) => "light" | "medium" | "dark";
  onSelect: (tab: Tab) => void;
}) {
  return (
    <section className="homeScreen" aria-label="LBMP home">
      <div className="homeTileGrid">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const count = tileCountForTab(tab.id);
          const tone = tileToneForTab(tab.id);
          return (
            <button className={`homeTile ${tone}`} key={tab.id} onClick={() => onSelect(tab.id)}>
              <div className="homeTileTop">
                <Icon size={30} />
                {count > 0 && <span className="homeTileBadge">{count}</span>}
              </div>
              <strong>{tab.label}</strong>
              <span>{tileNoteForTab(tab.id)}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function HardwarePrototype({
  hardwareTests,
  setReceiptPreview,
  onAction
}: {
  hardwareTests: HardwareTestRecord[];
  setReceiptPreview: (value: string) => void;
  onAction: <T>(label: string, action: () => Promise<T>) => Promise<void>;
}) {
  const [mode, setMode] = useState<"home" | "setup" | "history">("home");
  const [scanValue, setScanValue] = useState("MTS:PKG:SCAN-TEST");
  const [signature, setSignature] = useState("Receiver Signature");
  const [photoUrl, setPhotoUrl] = useState("");
  const [scannerResult, setScannerResult] = useState<HardwareTestRecord["scannerResult"]>("Not Tested");
  const [printerResult, setPrinterResult] = useState<HardwareTestRecord["printerResult"]>("Not Tested");
  const [cameraResult, setCameraResult] = useState<HardwareTestRecord["cameraResult"]>("Not Tested");
  const [signatureResult, setSignatureResult] = useState<HardwareTestRecord["signatureResult"]>("Not Tested");
  const [pwaResult, setPwaResult] = useState<HardwareTestRecord["pwaResult"]>("Not Tested");
  const [gpsResult, setGpsResult] = useState<"Pass" | "Fail" | "Not Tested">("Not Tested");
  const [deviceName, setDeviceName] = useState("NB80 Android POS - Receiving 1");
  const [assignedBranch, setAssignedBranch] = useState("Origin Warehouse");
  const [paperWidth, setPaperWidth] = useState<"58mm" | "80mm">(() => readDevicePaperWidth());
  const [printProtocol, setPrintProtocol] = useState("ESC/POS");
  const [scannerMode, setScannerMode] = useState("Auto-enter after scan");
  const [notes, setNotes] = useState("Device setup validation");
  const [deviceStatus, setDeviceStatus] = useState("Run each device check before using the tablet for live operation.");
  const [storageSummary, setStorageSummary] = useState<OfflineStorageSummary | null>(null);
  const [diagnosticPreview, setDiagnosticPreview] = useState<DiagnosticLogRecord[]>([]);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const scannerInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setPaperWidth(readDevicePaperWidth());
  }, []);

  async function refreshStorageSummary() {
    const [summary, logs] = await Promise.all([getOfflineStorageSummary(), listDiagnosticLogs(5)]);
    setStorageSummary(summary);
    setDiagnosticPreview(logs);
    const pending = summary.offlineQueue.pending + summary.offlineQueue.failed + summary.photoQueue.pending + summary.photoQueue.failed;
    setDeviceStatus(pending > 0 ? `${pending} item(s) saved on tablet still need sync.` : "Tablet cache is ready. No pending uploads or actions.");
    return summary;
  }

  async function exportDiagnosticLogs() {
    const logs = await listDiagnosticLogs(10000);
    const payload = {
      exportedAt: new Date().toISOString(),
      deviceName,
      assignedBranch,
      paperWidth,
      printProtocol,
      scannerMode,
      logs
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `lbmp-diagnostic-logs-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setDeviceStatus(`${logs.length} diagnostic log(s) exported.`);
  }

  useEffect(() => {
    if (mode !== "setup") return;
    refreshStorageSummary().catch(() => undefined);
  }, [mode]);

  async function attachDevicePhoto(file: File, inputElement?: HTMLInputElement) {
    setDeviceStatus("Saving device test photo...");
    const uploaded = await uploadCompressedImage(file, "hardware-test");
    setPhotoUrl(uploaded.fileUrl);
    setCameraResult("Pass");
    setDeviceStatus(photoUploadStatus(uploaded, "Device test photo uploaded."));
    if (inputElement) inputElement.value = "";
  }

  function testGps() {
    if (typeof window === "undefined" || !window.navigator.geolocation) {
      setGpsResult("Fail");
      setDeviceStatus("GPS is not available in this app context.");
      return;
    }
    setDeviceStatus("Requesting GPS location...");
    window.navigator.geolocation.getCurrentPosition(
      (position) => {
        setGpsResult("Pass");
        setDeviceStatus(`GPS detected: ${position.coords.latitude.toFixed(5)}, ${position.coords.longitude.toFixed(5)} (+/- ${Math.round(position.coords.accuracy)}m).`);
      },
      () => {
        setGpsResult("Fail");
        setDeviceStatus("GPS permission denied or unavailable. Photo stamps will show GPS unavailable.");
      },
      { enableHighAccuracy: true, timeout: 6000, maximumAge: 30000 }
    );
  }

  return (
    <div className="stack">
      {mode === "home" && (
        <ModuleTileLauncher
          eyebrow="Device"
          title="What do you want to do?"
          description="Test the NB80 scanner, printer layout, and offline behavior before live operation."
          actions={[
            { key: "setup", label: "Device Setup", note: "Scanner / printer / offline", icon: Smartphone, tone: "dark", onClick: () => setMode("setup") },
            { key: "history", label: "Test History", note: `${hardwareTests.length} records`, icon: ClipboardList, count: hardwareTests.length, tone: hardwareTests.length ? "medium" : "light", onClick: () => setMode("history") },
            { key: "scanner", label: "Scanner", note: scannerResult, icon: ScanLine, tone: scannerResult === "Fail" ? "dark" : "light", onClick: () => setMode("setup") },
            { key: "printer", label: "Printer", note: printerResult, icon: Printer, tone: printerResult === "Fail" ? "dark" : "light", onClick: () => setMode("setup") },
            { key: "image", label: "Image Attach", note: cameraResult, icon: Camera, tone: cameraResult === "Fail" ? "dark" : "light", onClick: () => setMode("setup") },
            { key: "gps", label: "GPS", note: gpsResult, icon: ShieldCheck, tone: gpsResult === "Fail" ? "dark" : "light", onClick: () => setMode("setup") },
            { key: "offline", label: "Offline Storage", note: pwaResult, icon: ShieldCheck, tone: pwaResult === "Fail" ? "dark" : "light", onClick: () => setMode("setup") }
          ]}
        />
      )}
      {mode === "setup" && (
      <section className="panel workflow">
        <div className="sectionHeader">
          <div>
            <h3>Device Setup</h3>
            <p className="muted">This NB80 uses a hardware scanner that types into the active field. Select the installed paper width, then test scanner input and printer output before live operations.</p>
          </div>
          <button className="smallButton" onClick={() => setMode("home")}>Back</button>
        </div>
        <div className="formGrid">
          <label>Device Name<input value={deviceName} onChange={(event) => setDeviceName(event.target.value)} /></label>
          <label>Assigned Branch<select value={assignedBranch} onChange={(event) => setAssignedBranch(event.target.value)}><option>Origin Warehouse</option><option>Daet</option><option>Naga</option><option>Mobile Truck</option></select></label>
          <label>Available Paper<select value={paperWidth} onChange={(event) => {
            const value = event.target.value === "58mm" ? "58mm" : "80mm";
            setPaperWidth(value);
            window.localStorage.setItem(DEVICE_PAPER_WIDTH_KEY, value);
          }}><option value="80mm">80mm</option><option value="58mm">58mm</option></select></label>
          <label>Printer Route<select value={printProtocol} onChange={(event) => setPrintProtocol(event.target.value)}><option>NB80 Gateway Test</option><option>Browser Print Fallback</option><option>Vendor SDK Required</option></select></label>
          <label>Scanner Mode<select value={scannerMode} onChange={(event) => setScannerMode(event.target.value)}><option>Hardware side button</option><option>Auto-enter after scan</option><option>Manual confirm after scan</option></select></label>
        <LongTextField label="Notes" value={notes} onChange={setNotes} threshold={36} />
        </div>
        <div className="buttonGrid">
          <button className="actionButton" onClick={() => {
            setScanValue("");
            setScannerResult("Not Tested");
            setDeviceStatus("Scanner ready. Keep this input focused, aim at the QR/barcode, then press the side scan trigger.");
            window.setTimeout(() => {
              scannerInputRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
              scannerInputRef.current?.focus();
            }, 50);
          }}><ScanLine /> Ready Scanner</button>
          <button
            className="actionButton"
            onClick={() =>
              onAction("Generate ESC/POS test", async () => {
                setDeviceStatus("Generating printer test...");
                const text = `LBMP DEVICE TEST\nDevice: ${deviceName}\nPaper: ${paperWidth}\nRoute: ${printProtocol}\nBranch: ${assignedBranch}\nScan: ${scanValue}\nSignature: ${signature}\n`;
                const result = await apiPost<{ bytes: number[]; text: string }>("/printing/escpos-preview", { text });
                setReceiptPreview(`${result.text}\nESC/POS bytes: ${result.bytes.length}`);
                setPrinterResult("Not Tested");
                setDeviceStatus(result.bytes.length > 0 ? "Print panel opened. Tap Print, then confirm if paper comes out. If not, vendor SDK bridge is required." : "Printer preview failed.");
              })
            }
          >
            <Printer /> Test Print
          </button>
          <button className="actionButton" onClick={() => {
            setPwaResult("Pass");
            setDeviceStatus("PWA open test passed.");
          }}><Smartphone /> PWA Opens</button>
          <button className="actionButton" onClick={() => void capturePhotoOrOpenPicker(cameraInputRef, `device-test-${Date.now()}.jpg`, attachDevicePhoto)}><Camera /> Attach Image</button>
          <button className="actionButton" onClick={() => {
            resetDeviceCameraCheck();
            setCameraResult("Not Tested");
            setDeviceStatus("Camera check reset. Tap Attach Image only if this device has a working camera app.");
          }}><Camera /> Reset Camera Check</button>
          <button className="actionButton" onClick={testGps}><ShieldCheck /> Test GPS</button>
        </div>
        <input ref={cameraInputRef} className="hiddenInput" type="file" accept="image/*" onChange={(event) => {
          const inputElement = event.currentTarget;
          const file = event.target.files?.[0];
          if (!file) return;
          void onAction("Upload device photo", () => attachDevicePhoto(file, inputElement));
        }} />
        <div className="formGrid">
          <label>Scanner Input<input
            className={scanValue.trim() ? "" : "scannerReadyInput"}
            ref={scannerInputRef}
            value={scanValue}
            onChange={(event) => {
              setScanValue(event.target.value);
              if (event.target.value.trim()) {
                setScannerResult("Pass");
                setDeviceStatus("Scanner input detected. If the code is complete, scanner setup is ready.");
              }
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                setScannerResult(scanValue.trim() ? "Pass" : "Fail");
                setDeviceStatus(scanValue.trim() ? "Scanner test passed with Enter suffix." : "Scanner test failed. No code was received.");
              }
            }}
            placeholder="Tap Ready Scanner, then press the NB80 scan trigger"
          /></label>
          <label>Signature<input value={signature} onChange={(event) => {
            setSignature(event.target.value);
            setSignatureResult(event.target.value ? "Pass" : "Fail");
          }} /></label>
        </div>
        {photoUrl && <p className="muted">Hardware photo uploaded: {photoUrl}</p>}
        <p className="notice">{deviceStatus}</p>
        <OfflineStoragePanel
          summary={storageSummary}
          onRefresh={() => onAction("Refresh offline storage", refreshStorageSummary)}
          onProtect={() =>
            onAction("Protect tablet storage", async () => {
              const state = await requestPersistentStorage();
              const summary = await getOfflineStorageSummary();
              setStorageSummary({ ...summary, persistentStorage: state });
              setPwaResult(state === "Unsupported" ? "Not Tested" : state === "Granted" ? "Pass" : "Fail");
              setDeviceStatus(state === "Granted" ? "Tablet storage protection is enabled." : "Tablet storage protection is not available or was denied.");
            })
          }
          onClearScreens={() =>
            onAction("Clear saved screens", async () => {
              const summary = await getOfflineStorageSummary();
              const pending = summary.offlineQueue.pending + summary.offlineQueue.failed + summary.photoQueue.pending + summary.photoQueue.failed;
              if (pending > 0 && typeof window !== "undefined" && !window.confirm(`${pending} item(s) still need sync. Clear saved screens only? Pending work/photos will remain.`)) {
                return;
              }
              await clearCachedRecords();
              setStorageSummary(await getOfflineStorageSummary());
              setDeviceStatus("Saved screens cleared. Pending tablet work/photos were kept.");
            })
          }
          onExportLogs={() => onAction("Export diagnostic logs", exportDiagnosticLogs)}
          onClearLogs={() =>
            onAction("Clear diagnostic logs", async () => {
              await clearDiagnosticLogs();
              await refreshStorageSummary();
              setDeviceStatus("Diagnostic logs cleared.");
            })
          }
          diagnosticPreview={diagnosticPreview}
        />
        <div className="buttonGrid">
          <StatusSelect label="Scanner" value={scannerResult} setValue={setScannerResult} />
          <StatusSelect label="Printer" value={printerResult} setValue={setPrinterResult} />
          <StatusSelect label="Image Attach" value={cameraResult} setValue={setCameraResult} />
          <StatusSelect label="GPS" value={gpsResult} setValue={setGpsResult} />
          <StatusSelect label="Signature" value={signatureResult} setValue={setSignatureResult} />
          <StatusSelect label="PWA" value={pwaResult} setValue={setPwaResult} />
        </div>
        <button
          className="primaryButton"
          onClick={() =>
            onAction("Save device setup", () =>
              apiPost("/hardware/tests", {
                deviceName,
                scannerResult,
                printerResult,
                cameraResult,
                signatureResult,
                pwaResult,
                notes: `${assignedBranch}; ${paperWidth}; ${printProtocol}; ${scannerMode}; ${notes}`
              })
            )
          }
        >
          Save Device Setup
        </button>
      </section>
      )}
      {mode === "history" && (
      <section className="panel">
        <div className="sectionHeader">
          <div>
            <h3>Hardware Test History</h3>
            <p className="muted">Review previous NB80/device checks.</p>
          </div>
          <button className="smallButton" onClick={() => setMode("home")}>Back</button>
        </div>
          <div className="list">
            {hardwareTests.map((test) => (
            <div className="row" key={test.id}>
              <Smartphone />
              <div>
                <strong>{test.deviceName}</strong>
                <p>Scanner {test.scannerResult} / Printer {test.printerResult} / Image {test.cameraResult} / Signature {test.signatureResult} / PWA {test.pwaResult}</p>
                {test.notes && <p className="muted">{test.notes}</p>}
              </div>
              <span className="badge">{new Date(test.createdAt).toLocaleString()}</span>
            </div>
          ))}
          {!hardwareTests.length && <p className="muted">No hardware test records found.</p>}
        </div>
      </section>
      )}
    </div>
  );
}

function OfflineStoragePanel({
  summary,
  onRefresh,
  onProtect,
  onClearScreens,
  onExportLogs,
  onClearLogs,
  diagnosticPreview
}: {
  summary: OfflineStorageSummary | null;
  onRefresh: () => void;
  onProtect: () => void;
  onClearScreens: () => void;
  onExportLogs: () => void;
  onClearLogs: () => void;
  diagnosticPreview: DiagnosticLogRecord[];
}) {
  const pendingActions = summary ? summary.offlineQueue.pending + summary.offlineQueue.failed + summary.offlineQueue.syncing : 0;
  const pendingPhotos = summary ? summary.photoQueue.pending + summary.photoQueue.failed + summary.photoQueue.syncing : 0;
  const hasPendingWork = pendingActions + pendingPhotos > 0;
  return (
    <section className="subPanel">
      <div className="sectionHeader compact">
        <div>
          <h4>Offline Storage</h4>
          <p className="muted">Saved screens open faster. Pending work/photos stay on this tablet until synced.</p>
        </div>
        <span className={hasPendingWork ? "badge warning" : "badge"}>{hasPendingWork ? "Needs Sync" : "Ready"}</span>
      </div>
      <div className="metricGrid compactMetrics">
        <button className="metricCard" type="button" onClick={onRefresh}>
          <span>Saved Screens</span>
          <strong>{summary ? summary.cachedRecords : "..."}</strong>
          <small>{summary ? formatBytes(summary.cachedBytes) : "Checking"}</small>
        </button>
        <button className="metricCard" type="button" onClick={onRefresh}>
          <span>Actions</span>
          <strong>{pendingActions}</strong>
          <small>{summary ? `${summary.offlineQueue.synced} synced` : "Checking"}</small>
        </button>
        <button className="metricCard" type="button" onClick={onRefresh}>
          <span>Photos</span>
          <strong>{pendingPhotos}</strong>
          <small>{summary ? formatBytes(summary.photoQueue.bytes) : "Checking"}</small>
        </button>
        <button className="metricCard" type="button" onClick={onProtect}>
          <span>Protection</span>
          <strong>{summary?.persistentStorage ?? "..."}</strong>
          <small>Ask device to keep app data</small>
        </button>
        <button className="metricCard" type="button" onClick={onExportLogs}>
          <span>Logs</span>
          <strong>{summary ? summary.diagnosticLogs.total : "..."}</strong>
          <small>{summary ? formatBytes(summary.diagnosticLogs.bytes) : "Checking"}</small>
        </button>
      </div>
      <div className="buttonGrid two">
        <button className="actionButton" type="button" onClick={onRefresh}><ShieldCheck /> Refresh Status</button>
        <button className="actionButton" type="button" onClick={onClearScreens}><X /> Clear Saved Screens</button>
        <button className="actionButton" type="button" onClick={onExportLogs}><ClipboardList /> Export Logs</button>
        <button className="actionButton" type="button" onClick={onClearLogs}><X /> Clear Logs</button>
      </div>
      {diagnosticPreview.length > 0 && (
        <div className="list compactList">
          {diagnosticPreview.map((log) => (
            <div className="row compactRow" key={log.id}>
              <AlertTriangle />
              <div>
                <strong>{log.message}</strong>
                <p>{log.source} / {log.level} / {new Date(log.createdAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</p>
              </div>
            </div>
          ))}
        </div>
      )}
      <p className={hasPendingWork ? "notice warningNotice" : "muted"}>
        {hasPendingWork
          ? "Do not clear Android app data yet. Some work or photos are still saved only on this tablet."
          : "Safe state: no pending offline work. Clearing saved screens will not delete synced records."}
      </p>
    </section>
  );
}

function StatusSelect({
  label,
  value,
  setValue
}: {
  label: string;
  value: "Pass" | "Fail" | "Not Tested";
  setValue: (value: "Pass" | "Fail" | "Not Tested") => void;
}) {
  return (
    <label>
      {label}
      <select value={value} onChange={(event) => setValue(event.target.value as "Pass" | "Fail" | "Not Tested")}>
        <option>Not Tested</option>
        <option>Pass</option>
        <option>Fail</option>
      </select>
    </label>
  );
}

function OwnerSettings({
  bootstrap,
  activeUser,
  onAction
}: {
  bootstrap: BootstrapData | null;
  activeUser: OperatorUser;
  onAction: <T>(label: string, action: () => Promise<T>) => Promise<void>;
}) {
  const [mode, setMode] = useState<"home" | "company" | "branches" | "staff" | "payments" | "expenses">("home");
  const [companyName, setCompanyName] = useState(bootstrap?.companyProfile.companyName ?? "Mancenido Trucking Services");
  const [address, setAddress] = useState(bootstrap?.companyProfile.address ?? "");
  const [phone, setPhone] = useState(bootstrap?.companyProfile.phone ?? "");
  const [email, setEmail] = useState(bootstrap?.companyProfile.email ?? "");
  const [branchName, setBranchName] = useState("New Branch");
  const [branchCode, setBranchCode] = useState("NEW");
  const [branchEdits, setBranchEdits] = useState<Record<string, Branch>>({});
  const [paymentMethods, setPaymentMethods] = useState((bootstrap?.defaultPaymentMethods ?? []).join("\n"));
  const [expenseCategories, setExpenseCategories] = useState((bootstrap?.defaultExpenseCategories ?? []).join("\n"));
  const [userBranchSelections, setUserBranchSelections] = useState<Record<string, string>>({});
  const [userRoleSelections, setUserRoleSelections] = useState<Record<string, string>>({});
  const [userStatusSelections, setUserStatusSelections] = useState<Record<string, "Active" | "Inactive">>({});
  const [userStaffCodeUpdates, setUserStaffCodeUpdates] = useState<Record<string, string>>({});
  const [newStaffName, setNewStaffName] = useState("");
  const [newStaffPhone, setNewStaffPhone] = useState("");
  const [newStaffRole, setNewStaffRole] = useState("Delivery Staff");
  const [newStaffBranchAccess, setNewStaffBranchAccess] = useState("Naga");
  const [newStaffCode, setNewStaffCode] = useState("");

  useEffect(() => {
    if (!bootstrap) return;
    setCompanyName(bootstrap.companyProfile.companyName);
    setAddress(bootstrap.companyProfile.address);
    setPhone(bootstrap.companyProfile.phone);
    setEmail(bootstrap.companyProfile.email);
    setPaymentMethods(bootstrap.defaultPaymentMethods.join("\n"));
    setExpenseCategories(bootstrap.defaultExpenseCategories.join("\n"));
    setBranchEdits(Object.fromEntries(bootstrap.branches.map((branch) => [branch.id, { ...branch }])));
    setUserBranchSelections(Object.fromEntries(bootstrap.users.map((user) => [user.id, user.branchAccess ?? "Daet / Naga"])));
    setUserRoleSelections(Object.fromEntries(bootstrap.users.map((user) => [user.id, user.role])));
    setUserStatusSelections(Object.fromEntries(bootstrap.users.map((user) => [user.id, user.status ?? "Active"])));
  }, [bootstrap]);

  const canCreateBranches = ["Administrator", "System Admin"].includes(activeUser.role);
  function canEditBranch(branch: Branch) {
    if (["Administrator", "System Admin"].includes(activeUser.role)) return true;
    if (activeUser.role === "Daet Owner") return branch.name === "Daet" || branch.code === "DAET";
    if (activeUser.role === "Naga Owner") return branch.name === "Naga" || branch.code === "NAGA";
    return false;
  }

  function updateBranchEdit(branchId: string, updates: Partial<Branch>) {
    const sourceBranch = bootstrap?.branches.find((branch) => branch.id === branchId);
    if (!sourceBranch) return;
    setBranchEdits((current) => ({
      ...current,
      [branchId]: {
        ...sourceBranch,
        ...current[branchId],
        ...updates
      }
    }));
  }

  const branchAccessOptions = useMemo(() => {
    const branchNames = operationalBranchNames(bootstrap?.branches ?? []);
    return ["All branches", "Origin Warehouse", "Daet / Naga", ...branchNames];
  }, [bootstrap?.branches]);
  const staffRoleOptions = ["Receiving Staff", "Delivery Staff", "Delivery Admin"];

  async function createStaffFromSettings() {
    await apiPost("/settings/users", {
      name: newStaffName,
      phone: newStaffPhone,
      role: newStaffRole,
      branchAccess: newStaffBranchAccess,
      staffCode: newStaffCode,
      status: "Active"
    });
    setNewStaffName("");
    setNewStaffPhone("");
    setNewStaffRole("Delivery Staff");
    setNewStaffBranchAccess("Naga");
    setNewStaffCode("");
  }

  return (
    <div className="stack">
      {mode === "home" && (
        <ModuleTileLauncher
          eyebrow="Settings"
          title="What do you want to do?"
          description="Manage company setup, branches, staff access, payment methods, and expense categories."
          actions={[
            { key: "company", label: "Company", note: "Profile details", icon: Settings, tone: "dark", onClick: () => setMode("company") },
            { key: "branches", label: "Branches", note: `${bootstrap?.branches.length ?? 0} branches`, icon: LayoutDashboard, count: bootstrap?.branches.length ?? 0, tone: "light", onClick: () => setMode("branches") },
            { key: "staff", label: "Staff", note: `${bootstrap?.users.length ?? 0} users`, icon: UserCog, count: bootstrap?.users.length ?? 0, tone: "light", onClick: () => setMode("staff") },
            { key: "payments", label: "Payments", note: `${bootstrap?.defaultPaymentMethods.length ?? 0} methods`, icon: CreditCard, count: bootstrap?.defaultPaymentMethods.length ?? 0, tone: "light", onClick: () => setMode("payments") },
            { key: "expenses", label: "Expenses", note: `${bootstrap?.defaultExpenseCategories.length ?? 0} categories`, icon: WalletCards, count: bootstrap?.defaultExpenseCategories.length ?? 0, tone: "light", onClick: () => setMode("expenses") }
          ]}
        />
      )}
      {mode === "company" && (
      <section className="panel compact">
        <div className="sectionHeader">
          <div>
            <h3>Company Profile</h3>
            <p className="muted">Company details used on documents and receipts.</p>
          </div>
          <button className="smallButton" onClick={() => setMode("home")}>Back</button>
        </div>
        <div className="formGrid">
          <label>Company Name<input value={companyName} onChange={(event) => setCompanyName(event.target.value)} /></label>
          <label>Phone<input value={phone} onChange={(event) => setPhone(event.target.value)} /></label>
          <label>Email<input value={email} onChange={(event) => setEmail(event.target.value)} /></label>
          <LongTextField label="Address" value={address} onChange={setAddress} threshold={36} />
        </div>
        <button className="primaryButton" onClick={() => onAction("Save company profile", () => apiPatch("/settings/company", { companyName, phone, email, address }))}>Save Company Profile</button>
      </section>
      )}

      {mode === "branches" && (
      <section className="panel compact">
        <div className="sectionHeader">
          <div>
            <h3>Branches</h3>
            <p className="muted">System Admin can manage all branches. Branch owners can update their own branch profile only.</p>
          </div>
          <button className="smallButton" onClick={() => setMode("home")}>Back</button>
        </div>
        <div className="list">
          {bootstrap?.branches.map((branch) => {
            const editable = canEditBranch(branch);
            const draft = branchEdits[branch.id] ?? branch;
            return (
              <div className="row editableRow branchEditRow" key={branch.id}>
                <Settings />
                <div>
                  <strong>{branch.name}</strong>
                  <p>{branch.code} - {branch.status}</p>
                  <p className="muted">
                    Receive {branch.canReceive ? "Yes" : "No"} / Dispatch {branch.canDispatch ? "Yes" : "No"} / Deliver {branch.canDeliver ? "Yes" : "No"} / Return {branch.canReturn ? "Yes" : "No"} / Stage {branch.canStage ? "Yes" : "No"}
                  </p>
                </div>
                <label>
                  Branch Name
                  <input value={draft.name} disabled={!editable} onChange={(event) => updateBranchEdit(branch.id, { name: event.target.value })} />
                </label>
                <label>
                  Code
                  <input value={draft.code} disabled={!editable || activeUser.role !== "System Admin"} onChange={(event) => updateBranchEdit(branch.id, { code: event.target.value.toUpperCase() })} />
                </label>
                <label>
                  Address
                  <input value={draft.address ?? ""} disabled={!editable} onChange={(event) => updateBranchEdit(branch.id, { address: event.target.value })} />
                </label>
                <label>
                  Status
                  <select value={draft.status} disabled={!editable || activeUser.role !== "System Admin"} onChange={(event) => updateBranchEdit(branch.id, { status: event.target.value as Branch["status"] })}>
                    <option>Active</option>
                    <option>Inactive</option>
                  </select>
                </label>
                <div className="branchToggleGrid">
                  <label className="checkboxLabel"><input type="checkbox" checked={draft.canReceive} disabled={!editable} onChange={(event) => updateBranchEdit(branch.id, { canReceive: event.target.checked })} /> Receive</label>
                  <label className="checkboxLabel"><input type="checkbox" checked={draft.canDispatch} disabled={!editable} onChange={(event) => updateBranchEdit(branch.id, { canDispatch: event.target.checked })} /> Dispatch</label>
                  <label className="checkboxLabel"><input type="checkbox" checked={draft.canDeliver} disabled={!editable} onChange={(event) => updateBranchEdit(branch.id, { canDeliver: event.target.checked })} /> Deliver</label>
                  <label className="checkboxLabel"><input type="checkbox" checked={draft.canReturn} disabled={!editable} onChange={(event) => updateBranchEdit(branch.id, { canReturn: event.target.checked })} /> Return</label>
                  <label className="checkboxLabel"><input type="checkbox" checked={draft.canStage} disabled={!editable} onChange={(event) => updateBranchEdit(branch.id, { canStage: event.target.checked })} /> Stage</label>
                </div>
                <button
                  className="smallButton"
                  disabled={!editable || !draft.name.trim() || !draft.code.trim()}
                  onClick={() => onAction("Save branch", () => apiPatch(`/settings/branches/${branch.id}`, draft))}
                >
                  Save
                </button>
              </div>
            );
          })}
        </div>
        {canCreateBranches && (
          <>
            <div className="formGrid">
              <label>New Branch Name<input value={branchName} onChange={(event) => setBranchName(event.target.value)} /></label>
              <label>Code<input value={branchCode} onChange={(event) => setBranchCode(event.target.value.toUpperCase())} /></label>
            </div>
            <button
              className="primaryButton"
              disabled={!branchName.trim() || !branchCode.trim()}
              onClick={() => onAction("Create branch", () => apiPost("/settings/branches", { name: branchName, code: branchCode, canReceive: true, canDispatch: false, canDeliver: true, canReturn: true, canStage: true }))}
            >
              Create Branch
            </button>
          </>
        )}
      </section>
      )}

      {mode === "staff" && (
      <section className="panel compact">
        <div className="sectionHeader">
          <div>
            <h3>Staff & Access</h3>
            <p className="muted">Owners can add receiving or delivery personnel, assign branch access, and set staff PINs for shared tablet login.</p>
          </div>
          <button className="smallButton" onClick={() => setMode("home")}>Back</button>
        </div>
        <section className="subPanel">
          <h4>Add Staff</h4>
          <div className="formGrid">
            <label>Full Name<input value={newStaffName} onChange={(event) => setNewStaffName(event.target.value)} placeholder="Example: Juan Delivery" /></label>
            <label>Mobile Number<input value={newStaffPhone} onChange={(event) => setNewStaffPhone(event.target.value)} placeholder="" /></label>
            <label>Role<select value={newStaffRole} onChange={(event) => setNewStaffRole(event.target.value)}>{staffRoleOptions.map((role) => <option key={role}>{role}</option>)}</select></label>
            <label>Branch Access<select value={newStaffBranchAccess} onChange={(event) => setNewStaffBranchAccess(event.target.value)}>{branchAccessOptions.map((option) => <option key={option}>{option}</option>)}</select></label>
            <label>Staff PIN<input value={newStaffCode} onChange={(event) => setNewStaffCode(event.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" placeholder="4-6 digits" /></label>
          </div>
          <button className="primaryButton" disabled={!newStaffName.trim() || !newStaffCode.trim()} onClick={() => onAction("Create staff user", createStaffFromSettings)}>
            Add Staff User
          </button>
        </section>
        <div className="list">
          {bootstrap?.users.map((user) => {
            const canEdit = activeUser.role === "System Admin" || user.id === activeUser.id || user.role.includes("Staff");
            const editableRole = staffRoleOptions.includes(user.role);
            return (
              <div className="row editableRow" key={user.id}>
                <UserCog />
                <div>
                  <strong>{user.name}</strong>
                  <p>{user.phone ?? user.email ?? "No contact saved"}</p>
                  <p className="muted">PIN: {user.hasStaffCode ? "Enabled" : "Not set"}</p>
                </div>
                <label>
                  Role
                  <select
                    value={userRoleSelections[user.id] ?? user.role}
                    disabled={!canEdit || !editableRole}
                    onChange={(event) => setUserRoleSelections((values) => ({ ...values, [user.id]: event.target.value }))}
                  >
                    {(editableRole ? staffRoleOptions : [user.role]).map((role) => <option key={role}>{role}</option>)}
                  </select>
                </label>
                <label>
                  Branch Access
                  <select
                    value={userBranchSelections[user.id] ?? user.branchAccess ?? "Daet / Naga"}
                    disabled={!canEdit}
                    onChange={(event) => setUserBranchSelections((values) => ({ ...values, [user.id]: event.target.value }))}
                  >
                    {branchAccessOptions.map((option) => <option key={option}>{option}</option>)}
                  </select>
                </label>
                <label>
                  Status
                  <select
                    value={userStatusSelections[user.id] ?? user.status ?? "Active"}
                    disabled={!canEdit || user.id === activeUser.id}
                    onChange={(event) => setUserStatusSelections((values) => ({ ...values, [user.id]: event.target.value as "Active" | "Inactive" }))}
                  >
                    <option>Active</option>
                    <option>Inactive</option>
                  </select>
                </label>
                <label>
                  New PIN
                  <input
                    value={userStaffCodeUpdates[user.id] ?? ""}
                    disabled={!canEdit}
                    onChange={(event) => setUserStaffCodeUpdates((values) => ({ ...values, [user.id]: event.target.value.replace(/\D/g, "").slice(0, 6) }))}
                    inputMode="numeric"
                    placeholder="Keep current"
                  />
                </label>
                <button
                  className="smallButton"
                  disabled={!canEdit}
                  onClick={() =>
                    onAction("Save staff access", () =>
                      apiPatch(`/settings/users/${user.id}`, {
                        role: editableRole ? userRoleSelections[user.id] ?? user.role : user.role,
                        branchAccess: userBranchSelections[user.id] ?? user.branchAccess,
                        status: userStatusSelections[user.id] ?? user.status ?? "Active",
                        staffCode: userStaffCodeUpdates[user.id] || undefined
                      })
                    )
                  }
                >
                  Save
                </button>
              </div>
            );
          })}
        </div>
      </section>
      )}

      {mode === "payments" && (
      <section className="panel compact">
        <div className="sectionHeader">
          <div>
            <h3>Payment Methods</h3>
            <p className="muted">Default payment method list.</p>
          </div>
          <button className="smallButton" onClick={() => setMode("home")}>Back</button>
        </div>
        <label>One per line<textarea value={paymentMethods} onChange={(event) => setPaymentMethods(event.target.value)} /></label>
        <button className="primaryButton" onClick={() => onAction("Save payment methods", () => apiPatch("/settings/payment-methods", { methods: paymentMethods.split("\n") }))}>Save Payment Methods</button>
      </section>
      )}

      {mode === "expenses" && (
      <section className="panel compact">
        <div className="sectionHeader">
          <div>
            <h3>Expense Categories</h3>
            <p className="muted">Default expense category list.</p>
          </div>
          <button className="smallButton" onClick={() => setMode("home")}>Back</button>
        </div>
        <label>One per line<textarea value={expenseCategories} onChange={(event) => setExpenseCategories(event.target.value)} /></label>
        <button className="primaryButton" onClick={() => onAction("Save expense categories", () => apiPatch("/settings/expense-categories", { categories: expenseCategories.split("\n") }))}>Save Expense Categories</button>
      </section>
      )}
    </div>
  );
}

function AdminAudit({
  packages,
  auditLogs,
  onAction
}: {
  packages: CargoPackage[];
  auditLogs: AuditLog[];
  onAction: <T>(label: string, action: () => Promise<T>) => Promise<void>;
}) {
  const [mode, setMode] = useState<"home" | "actions" | "audit">("home");
  const [selectedPackage, setSelectedPackage] = useState("");
  const [reason, setReason] = useState("Owner review cleanup");
  const selectedCargo = packages.find((pkg) => pkg.id === selectedPackage);
  return (
    <div className="stack">
      {mode === "home" && (
        <ModuleTileLauncher
          eyebrow="Admin"
          title="What do you want to do?"
          description="Open admin actions or review the audit trail. User and branch setup remains in Settings."
          actions={[
            { key: "actions", label: "Admin Actions", note: "Delete / restore", icon: ShieldCheck, tone: "dark", onClick: () => setMode("actions") },
            { key: "audit", label: "Audit Trail", note: `${auditLogs.length} logs`, icon: ClipboardList, count: auditLogs.length, tone: auditLogs.length ? "dark" : "light", onClick: () => setMode("audit") },
            { key: "users", label: "Users", note: "Use Settings", icon: UserCog, tone: "light", onClick: () => setMode("actions") },
            { key: "branches", label: "Branches", note: "Use Settings", icon: Settings, tone: "light", onClick: () => setMode("actions") }
          ]}
        />
      )}
      {mode === "actions" && (
      <section className="panel compact">
        <div className="sectionHeader">
          <div>
            <h3>Admin Actions</h3>
            <p className="muted">Only admin/owner can soft delete or restore records. A reason is always required.</p>
          </div>
          <button className="smallButton" onClick={() => setMode("home")}>Back</button>
        </div>
        <div className="formGrid">
          <label>Package<select value={selectedPackage} onChange={(event) => setSelectedPackage(event.target.value)}><option value="">Select package</option>{packages.map((pkg) => <option key={pkg.id} value={pkg.id}>{pkg.packageNumber} - {pkg.description} - {pkg.status}</option>)}</select></label>
          <LongTextField label="Reason" value={reason} onChange={setReason} threshold={36} />
        </div>
        {selectedCargo && <p className="notice">Selected: {selectedCargo.description} - {selectedCargo.packageNumber}</p>}
        <div className="buttonGrid two">
          <button className="dangerButton" disabled={!selectedPackage} onClick={() => onAction("Soft delete package", () => apiPost(`/packages/${selectedPackage}/soft-delete`, { reason }))}>Soft Delete</button>
          <button className="primaryButton" disabled={!selectedPackage} onClick={() => onAction("Restore package", () => apiPost(`/packages/${selectedPackage}/restore`, { reason }))}>Restore</button>
        </div>
      </section>
      )}
      {mode === "audit" && (
      <section className="panel">
        <div className="sectionHeader">
          <div>
            <h3>Audit Trail</h3>
            <p className="muted">Review recent audited activity.</p>
          </div>
          <button className="smallButton" onClick={() => setMode("home")}>Back</button>
        </div>
        <div className="list">
          {auditLogs.map((log) => (
            <div className="row" key={log.id}>
              <ShieldCheck />
              <div>
                <strong>{log.action}</strong>
                <p>{log.entityType}: {log.entityId}</p>
                {log.reason && <p className="muted">Reason: {log.reason}</p>}
              </div>
              <span className="badge">{new Date(log.createdAt).toLocaleString()}</span>
            </div>
          ))}
          {!auditLogs.length && <p className="muted">No audit records found.</p>}
        </div>
      </section>
      )}
    </div>
  );
}

function Dashboard({
  dashboard,
  bootstrap,
  packages,
  trips,
  payments,
  unpaidPackages,
  activeUser
}: {
  dashboard: DashboardData | null;
  bootstrap: BootstrapData | null;
  packages: CargoPackage[];
  trips: Trip[];
  payments: PaymentRecord[];
  unpaidPackages: CargoPackage[];
  activeUser: OperatorUser;
}) {
  type MetricKey = "waiting" | "withoutPrice" | "pendingCustomers" | "activeTrips" | "delivered" | "failedDelivery" | "collected" | "unpaid" | "payments" | "expenses" | "profit";
  const [selectedMetric, setSelectedMetric] = useState<MetricKey>("waiting");
  const canViewFinancialSummary = isOwnerRole(activeUser.role);
  const collectedTotal = payments.reduce((sum, payment) => sum + payment.amountPaid, 0);
  const visibleCargoWaiting = packages.filter((pkg) => ["Waiting for Loading", "Received"].includes(pkg.status)).length;
  const visibleCargoWithoutPrice = packages.filter((pkg) => pkg.price == null).length;
  const visibleActiveTrips = trips.filter((trip) => !["Completed", "Cancelled"].includes(trip.status)).length;
  const visibleDelivered = packages.filter((pkg) => pkg.status === "Delivered").length;
  const visibleFailedDeliveries = packages.filter((pkg) => pkg.status === "Failed Delivery").length;
  const cards = useMemo(
    () =>
      [
        { key: "waiting", label: "Cargo Waiting", value: visibleCargoWaiting },
        { key: "withoutPrice", label: "Without Price", value: visibleCargoWithoutPrice },
        { key: "pendingCustomers", label: "Customer Pending", value: dashboard?.pendingCustomers ?? 0 },
        { key: "activeTrips", label: "Active Trips", value: visibleActiveTrips },
        { key: "delivered", label: "Delivered", value: visibleDelivered },
        { key: "failedDelivery", label: "Failed Delivery", value: visibleFailedDeliveries },
        ...(canViewFinancialSummary
          ? [
              { key: "payments" as MetricKey, label: "Payments", value: `PHP ${(dashboard?.paymentsCollected ?? 0).toLocaleString()}` },
              { key: "expenses" as MetricKey, label: "Expenses Review", value: dashboard?.expensesAwaitingApproval ?? 0 },
              { key: "profit" as MetricKey, label: "Est. Profit", value: `PHP ${(dashboard?.estimatedProfit ?? 0).toLocaleString()}` }
            ]
          : [
              { key: "collected" as MetricKey, label: "Collected Here", value: `PHP ${collectedTotal.toLocaleString()}` },
              { key: "unpaid" as MetricKey, label: "Need Collection", value: unpaidPackages.length }
            ])
      ] satisfies Array<{ key: MetricKey; label: string; value: string | number }>,
    [canViewFinancialSummary, collectedTotal, dashboard, unpaidPackages.length, visibleActiveTrips, visibleCargoWaiting, visibleCargoWithoutPrice, visibleDelivered, visibleFailedDeliveries]
  );

  useEffect(() => {
    if (!cards.some((card) => card.key === selectedMetric)) {
      setSelectedMetric("waiting");
    }
  }, [cards, selectedMetric]);

  const visiblePackages =
    selectedMetric === "waiting"
      ? packages.filter((pkg) => ["Waiting for Loading", "Received", "Waiting for Price"].includes(pkg.status))
      : selectedMetric === "withoutPrice"
        ? packages.filter((pkg) => pkg.price == null)
        : selectedMetric === "delivered"
          ? packages.filter((pkg) => pkg.status === "Delivered")
            : selectedMetric === "failedDelivery"
              ? packages.filter((pkg) => pkg.status === "Failed Delivery")
              : selectedMetric === "unpaid"
                ? unpaidPackages
              : [];
  const visiblePayments = selectedMetric === "collected" ? payments : [];
  const visibleTrips =
    selectedMetric === "activeTrips"
      ? trips.filter((trip) => !["Completed", "Cancelled"].includes(trip.status))
      : [];
  const selectedLabel = cards.find((card) => card.key === selectedMetric)?.label ?? "Records";
  const visibleCustomers = selectedMetric === "pendingCustomers" ? (bootstrap?.customers ?? []).filter((customer) => customer.status === "Pending") : [];

  return (
    <div className="stack">
      <div className="grid metrics">
        {cards.map((card) => (
          <button
            className={selectedMetric === card.key ? "metric active" : "metric"}
            key={card.key}
            onClick={() => setSelectedMetric(card.key)}
          >
            <span>{card.label}</span>
            <strong>{card.value}</strong>
          </button>
        ))}
      </div>
      <section className="panel">
        <h3>{selectedLabel}</h3>
        <div className="list">
          {visiblePackages.map((pkg) => (
            <div className="row" key={pkg.id}>
              <QrCode size={22} />
              <div>
                <strong>{pkg.packageNumber}</strong>
                <p>{pkg.description} to {pkg.destination}</p>
                <p className="muted">{pkg.receivingRecordNumber} - {pkg.customerName}</p>
              </div>
              <span className="badge">{pkg.status}</span>
              <span className="badge">{pkg.price == null ? "No Price" : `PHP ${pkg.price}`}</span>
            </div>
          ))}
          {visibleTrips.map((trip) => (
            <div className="row" key={trip.id}>
              <Truck size={22} />
              <div>
                <strong>{trip.tripNumber}</strong>
                <p>{trip.origin} to {trip.destination}</p>
                <p className="muted">{trip.vehicleDescription ?? "Vehicle not set"} - {trip.driverName ?? "Driver not set"}</p>
              </div>
              <span className="badge">{trip.status}</span>
            </div>
          ))}
          {visibleCustomers.map((customer) => (
            <div className="row" key={customer.id}>
              <AlertTriangle size={22} />
              <div>
                <strong>{customer.businessName}</strong>
                <p>{customer.phone ?? "No phone yet"}</p>
                <p className="muted">Finalize customer before loading cargo.</p>
              </div>
              <span className="badge warning">{customer.status}</span>
            </div>
          ))}
          {visiblePayments.map((payment) => (
            <div className="row" key={payment.id}>
              <CreditCard size={22} />
              <div>
                <strong>PHP {payment.amountPaid.toLocaleString()} - {payment.method}</strong>
                <p>{payment.collectedByName ?? activeUser.name} - {payment.collectionPoint ?? "Collection"}</p>
                <p className="muted">{new Date(payment.createdAt).toLocaleString()}</p>
              </div>
              <span className="badge">{payment.status}</span>
            </div>
          ))}
          {!visiblePackages.length && !visibleTrips.length && !visibleCustomers.length && !visiblePayments.length && (
            <p className="muted">
              {["payments", "expenses", "profit"].includes(selectedMetric)
                ? "This tile is a summary value. Detailed drill-down will be added when the full report view is expanded."
                : "No records found for this tile."}
            </p>
          )}
        </div>
      </section>
      <section className="panel">
        <h3>Notification Center</h3>
        <div className="list">
          {(dashboard?.notifications ?? []).map((notification) => (
            <div className="row" key={notification.id}>
              <AlertTriangle size={20} />
              <div>
                <strong>{notification.title}</strong>
                <p>{notification.message}</p>
              </div>
              <span className="badge">{notification.priority}</span>
            </div>
          ))}
          {!dashboard?.notifications.length && <p className="muted">No alerts yet.</p>}
        </div>
      </section>
    </div>
  );
}

function AccountPanel({
  activeUser,
  users,
  language,
  setLanguage,
  switchUser,
  switchUserByStaffCode,
  apiConnected
}: {
  activeUser: OperatorUser;
  users: OperatorUser[];
  language: "English" | "Tagalog";
  setLanguage: (language: "English" | "Tagalog") => void;
  switchUser: (user: OperatorUser) => Promise<void>;
  switchUserByStaffCode: (staffCode: string) => Promise<void>;
  apiConnected: boolean;
}) {
  const [staffCode, setStaffCode] = useState("");
  const [operatorStatus, setOperatorStatus] = useState("Enter staff code to switch operator.");
  const codeButtons = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "Clear", "0", "Enter"];

  async function submitStaffCode(code = staffCode) {
    if (code.trim().length < 4) {
      setOperatorStatus("Enter the 4-digit staff code.");
      return;
    }
    try {
      setOperatorStatus("Checking staff code...");
      await switchUserByStaffCode(code);
      setStaffCode("");
      setOperatorStatus("Operator switched.");
    } catch (error) {
      setOperatorStatus(error instanceof Error ? "Invalid staff code." : "Unable to switch operator.");
    }
  }

  function handleCodeButton(value: string) {
    if (value === "Clear") {
      setStaffCode("");
      setOperatorStatus("Enter staff code to switch operator.");
      return;
    }
    if (value === "Enter") {
      void submitStaffCode();
      return;
    }
    setStaffCode((current) => (current + value).slice(0, 6));
  }

  function handleStaffCodeChange(value: string) {
    setStaffCode(value.replace(/\D/g, "").slice(0, 6));
    setOperatorStatus("Press Enter or tap Enter to switch operator.");
  }

  return (
    <section className="panel accountPanel">
      <div className="accountSummary">
        <div className="accountAvatar"><UserCog size={28} /></div>
        <div>
          <h3>{activeUser.name}</h3>
          <p className="muted">{activeUser.role} - {activeUser.branchAccess ?? "Branch access not set"}</p>
        </div>
        <span className={`roleBadge ${roleClass(activeUser.role)}`}>{activeUser.role}</span>
      </div>

      <div className="grid accountInfoGrid">
        <div className="settingTile">
          <span>Email</span>
          <strong>{activeUser.email ?? "Not configured"}</strong>
        </div>
        <div className="settingTile">
          <span>Permission Preset</span>
          <strong>{activeUser.permissionPreset ?? activeUser.role}</strong>
        </div>
        <div className="settingTile">
          <span>Branch Access</span>
          <strong>{activeUser.branchAccess ?? "Not configured"}</strong>
        </div>
        <div className="settingTile">
          <span>Last Login</span>
          <strong>{activeUser.lastLogin ? new Date(activeUser.lastLogin).toLocaleString() : "Current session"}</strong>
        </div>
      </div>

      <div className="accountSection">
        <h3>Preferences</h3>
        <div className="segmentedControl">
          <button className={language === "English" ? "active" : ""} onClick={() => setLanguage("English")}>English</button>
          <button className={language === "Tagalog" ? "active" : ""} onClick={() => setLanguage("Tagalog")}>Tagalog</button>
        </div>
      </div>

      <div className="accountSection">
        <h3>Access</h3>
        <div className="accessList">
          <span>Role color: {activeUser.role}</span>
          <span>Can approve: {activeUser.canApprove?.length ? activeUser.canApprove.join(", ") : "No approval rights"}</span>
          <span>Staff code: {activeUser.hasStaffCode ? "Enabled" : "Not enabled"}</span>
        </div>
      </div>

      <div className="accountSection">
        <h3>Switch Operator</h3>
        <p className="muted">For shared receiving and delivery tablets. Each action will be audited under the active operator.</p>
        <label className="operatorCodeInput">
          <span>Staff Code</span>
          <input
            value={staffCode}
            onChange={(event) => handleStaffCodeChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void submitStaffCode();
              }
            }}
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={6}
            type="password"
            autoComplete="off"
            placeholder="Type code or use keypad"
            aria-label="Staff code"
          />
        </label>
        <div className="operatorCodeDisplay" aria-hidden="true">
          {Array.from({ length: Math.max(4, staffCode.length || 4) }).map((_, index) => (
            <span className={staffCode[index] ? "filled" : ""} key={index}>{staffCode[index] ? "•" : ""}</span>
          ))}
        </div>
        <div className="keypad">
          {codeButtons.map((button) => (
            <button className={button === "Enter" ? "enter" : ""} key={button} onClick={() => handleCodeButton(button)}>{button}</button>
          ))}
        </div>
        <p className="muted">{operatorStatus}</p>
      </div>

      <div className="accountSection">
        <h3>Developer Demo Users</h3>
        <p className="muted">Demo only. Production will hide this and use secure PIN management, lockouts, and owner reset.</p>
        <div className="grid loginGrid">
          {users.map((user) => (
            <button className="userSwitchButton" key={user.id} onClick={() => switchUser(user)}>
              <span className={`userDot ${roleClass(user.role)}`} />
              <div>
                <strong>{user.name}</strong>
                <p>{user.role} - {user.branchAccess ?? "No branch set"}</p>
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="accountSection">
        <h3>Security</h3>
        <div className="buttonGrid two">
          <button className="actionButton" type="button">Change Password</button>
          <button className="actionButton" type="button">Logout</button>
        </div>
      </div>

      <div className="accountSection systemGrid">
        <div><span>Device</span><strong>Browser / NB80 ready</strong></div>
        <div><span>API</span><strong>{apiConnected ? "Connected" : "Disconnected"}</strong></div>
        <div><span>Version</span><strong>LBMP v0.1</strong></div>
      </div>
    </section>
  );
}

type TileTone = "light" | "medium" | "dark";

type ModuleTileAction = {
  key: string;
  label: string;
  note: string;
  icon: React.ElementType;
  count?: number;
  tone?: TileTone;
  onClick: () => void;
};

function ModuleTileLauncher({
  eyebrow,
  title,
  description,
  actions
}: {
  eyebrow: string;
  title: string;
  description: string;
  actions: ModuleTileAction[];
}) {
  return (
    <section className="panel workflow moduleHome">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h3>{title}</h3>
        <p className="muted">{description}</p>
      </div>
      <div className="homeTileGrid moduleTileGrid">
        {actions.map((action) => {
          const Icon = action.icon;
          const count = action.count ?? 0;
          return (
            <button className={`homeTile ${action.tone ?? (count > 0 ? "dark" : "light")}`} key={action.key} onClick={action.onClick}>
              <div className="homeTileTop">
                <Icon size={30} />
                {count > 0 && <span className="homeTileBadge">{count}</span>}
              </div>
              <strong>{action.label}</strong>
              <span>{action.note}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

interface ReceivingLineDraft {
  tempId: string;
  productSku?: string;
  productBarcode?: string;
  productBrand?: string;
  productCategory?: string;
  description: string;
  quantity: string;
  unit: string;
  handlingBranchName: string;
  deliveryType: string;
  consigneeName: string;
  deliveryBusinessName: string;
  addressLine: string;
  barangay: string;
  city: string;
  province: string;
  landmark: string;
  deliveryPhone: string;
  deliveryNotes: string;
  condition: string;
  unitPrice?: string;
  price: string;
  weight?: string;
  weightUnit?: string;
  lengthValue?: string;
  widthValue?: string;
  heightValue?: string;
  dimensionUnit?: string;
  photoUrl?: string;
}

interface ReceivingSaveResponse {
  id: string;
  recordNumber: string;
  customerDrNumber?: string;
  sender?: string;
  consignee?: string;
  customerName: string;
  destination: string;
  drPhotoUrl?: string;
  createdAt?: string;
  packages: Array<{
    id: string;
    packageNumber: string;
    productId?: string;
    productSku?: string;
    productBarcode?: string;
    description: string;
    quantity?: number;
    unit?: string;
    destination: string;
    handlingBranchName?: string;
    deliveryType?: string;
    city?: string;
    province?: string;
    condition: string;
    unitPrice?: number | null;
    price: number | null;
    weight?: number | null;
    weightUnit?: string;
    length?: number | null;
    width?: number | null;
    height?: number | null;
    dimensionUnit?: string;
    status?: string;
  }>;
}

interface SavedReceivingSummary {
  branchSummary: string;
  amountDue: number;
  paymentStatus: "Unpaid" | "Paid" | "Partial" | "Advance Payment";
  amountPaid: number;
  balance: number;
}

type ReceivingRecordEditor = ReceivingSaveResponse;

interface ContactSuggestion {
  id: string;
  name: string;
  phone: string;
  role: string;
  company: string;
  notes: string;
  source: string;
  addressLine?: string;
  barangay?: string;
  city?: string;
  province?: string;
}

interface ReceivingDraftRecord {
  id: string;
  draftNumber: string;
  status: "Draft" | "Finalized" | "Cancelled";
  customerId?: string;
  customerNameSnapshot?: string;
  customerStatusSnapshot?: string;
  customerDrNumber?: string;
  destination?: string;
  drPhotoUrl?: string;
  formState: Partial<{
    selectedCustomerId: string;
    customerQuery: string;
    pendingCustomerName: string;
    pendingContactPerson: string;
    pendingCustomerPhone: string;
    pendingCustomerAddress: string;
    pendingBillingAddress: string;
    pendingShippingAddress: string;
    showPendingCustomerForm: boolean;
    customerDrNumber: string;
    senderName: string;
    senderPhone: string;
    senderType: string;
    senderCompany: string;
    senderNotes: string;
    showSenderDetails: boolean;
    selectedSenderLabel: string;
    selectedConsigneeLabel: string;
    description: string;
    quantity: string;
    unit: string;
    handlingBranchName: string;
    deliveryType: string;
    deliverySummary: string;
    showAddressDetails: boolean;
    consigneeName: string;
    deliveryBusinessName: string;
    addressLine: string;
    barangay: string;
    city: string;
    province: string;
    landmark: string;
    deliveryPhone: string;
    deliveryNotes: string;
    condition: string;
    price: string;
    weight: string;
    weightUnit: string;
    lengthValue: string;
    widthValue: string;
    heightValue: string;
    dimensionUnit: string;
    showMeasurementDetails: boolean;
    barcode: string;
    productSku: string;
    productBrand: string;
    productCategory: string;
    receivingPaymentStatus: "Unpaid" | "Paid" | "Partial" | "Advance Payment";
    receivingAmountPaid: string;
    receivingPaymentMethod: string;
    receivingPaymentReference: string;
    receivingPaymentProofUrl: string;
    receivingPaymentNotes: string;
    drPhotoUrl: string;
  }>;
  productLines: ReceivingLineDraft[];
  createdBy: string;
  updatedAt: string;
}

interface ReceivingIntakeTask {
  id: string;
  intakeNumber: string;
  status: "Pending Review" | "In Review" | "Converted" | "Cancelled";
  source: "Wall QR";
  warehouseCode: string;
  duplicateCount: number;
  customerId?: string;
  customerNameTyped: string;
  customerMatched: boolean;
  customerDrNumber?: string;
  dropOffPerson?: string;
  dropOffPhone?: string;
  consigneeName?: string;
  receiverMatched: boolean;
  destinationBranch?: string;
  deliveryArea?: string;
  productId?: string;
  productMatched: boolean;
  itemDescription?: string;
  quantity?: number;
  unit?: string;
  drPhotoUrl?: string;
  extraPhotoUrls: string[];
  notes?: string;
  duplicateNotes: Array<{ id: string; note?: string; photoUrl?: string; createdAt: string }>;
  convertedReceivingId?: string;
  createdAt: string;
  updatedAt: string;
}

type ReceivingMode = "home" | "receive" | "saved" | "records" | "company" | "product" | "intake";

interface PriceSuggestion {
  suggestedPrice: number | null;
  confidence: "High" | "Medium" | "Low" | "None";
  reason: string;
  source: string;
  warnings: string[];
}

function Receiving({
  customers,
  branches,
  activeBranchContext,
  branchOptions,
  packages,
  productMasters,
  activeUser,
  activeUserRole,
  paymentMethods,
  setReceiptPreview,
  triggerReceiptAutoPrint,
  onAction,
  queueablePost
}: {
  customers: BootstrapData["customers"];
  branches: Branch[];
  activeBranchContext: string;
  branchOptions: string[];
  packages: CargoPackage[];
  productMasters: ProductMaster[];
  activeUser: OperatorUser;
  activeUserRole: string;
  paymentMethods: string[];
  setReceiptPreview: (value: string) => void;
  triggerReceiptAutoPrint: () => void;
  onAction: <T>(label: string, action: () => Promise<T>) => Promise<void>;
  queueablePost: QueueablePost;
}) {
  const receivingBranchOptions = branchOptions.length ? branchOptions : operationalBranchNames(branches);
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [customerQuery, setCustomerQuery] = useState("");
  const [pendingCustomerName, setPendingCustomerName] = useState("");
  const [pendingTin, setPendingTin] = useState("");
  const [pendingCompanyPhone, setPendingCompanyPhone] = useState("");
  const [pendingContactPerson, setPendingContactPerson] = useState("");
  const [pendingContactRole, setPendingContactRole] = useState("Operations");
  const [pendingContactCustomRole, setPendingContactCustomRole] = useState("");
  const [pendingContactEmail, setPendingContactEmail] = useState("");
  const [pendingDefaultContact, setPendingDefaultContact] = useState(true);
  const [pendingCustomerPhone, setPendingCustomerPhone] = useState("");
  const [pendingCustomerAddress, setPendingCustomerAddress] = useState("");
  const [pendingBillingAddress, setPendingBillingAddress] = useState("");
  const [pendingShippingAddress, setPendingShippingAddress] = useState("");
  const [pendingShippingSameAsBilling, setPendingShippingSameAsBilling] = useState(false);
  const [showPendingAddressDetails, setShowPendingAddressDetails] = useState(false);
  const [showPendingCustomerForm, setShowPendingCustomerForm] = useState(false);
  const [customerDrNumber, setCustomerDrNumber] = useState("");
  const [senderName, setSenderName] = useState("");
  const [senderPhone, setSenderPhone] = useState("");
  const [senderType, setSenderType] = useState("Sales Agent");
  const [senderCompany, setSenderCompany] = useState("");
  const [senderNotes, setSenderNotes] = useState("");
  const [showSenderDetails, setShowSenderDetails] = useState(false);
  const [selectedSenderLabel, setSelectedSenderLabel] = useState("");
  const [description, setDescription] = useState("");
  const [showProductDescriptionEditor, setShowProductDescriptionEditor] = useState(false);
  const [quantity, setQuantity] = useState("1");
  const [unit, setUnit] = useState("pcs");
  const [handlingBranchName, setHandlingBranchName] = useState("");
  const [deliveryType, setDeliveryType] = useState("Deliver to consignee");
  const [deliverySummary, setDeliverySummary] = useState("");
  const [showAddressDetails, setShowAddressDetails] = useState(false);
  const [consigneeName, setConsigneeName] = useState("");
  const [selectedConsigneeLabel, setSelectedConsigneeLabel] = useState("");
  const [consigneeType, setConsigneeType] = useState("Receiver");
  const [showConsigneeDetails, setShowConsigneeDetails] = useState(false);
  const [deliveryBusinessName, setDeliveryBusinessName] = useState("");
  const [addressLine, setAddressLine] = useState("");
  const [barangay, setBarangay] = useState("");
  const [city, setCity] = useState("");
  const [province, setProvince] = useState("");
  const [landmark, setLandmark] = useState("");
  const [deliveryPhone, setDeliveryPhone] = useState("");
  const [deliveryNotes, setDeliveryNotes] = useState("");
  const [condition, setCondition] = useState("Good");
  const [price, setPrice] = useState("");
  const [showMeasurementDetails, setShowMeasurementDetails] = useState(false);
  const [weight, setWeight] = useState("");
  const [weightUnit, setWeightUnit] = useState("kg");
  const [lengthValue, setLengthValue] = useState("");
  const [widthValue, setWidthValue] = useState("");
  const [heightValue, setHeightValue] = useState("");
  const [dimensionUnit, setDimensionUnit] = useState("cm");
  const [priceSuggestion, setPriceSuggestion] = useState<PriceSuggestion | null>(null);
  const [barcode, setBarcode] = useState("");
  const [productSku, setProductSku] = useState("");
  const [productBrand, setProductBrand] = useState("");
  const [productCategory, setProductCategory] = useState("General Merchandise");
  const [productDefaultPrice, setProductDefaultPrice] = useState("");
  const [productNotes, setProductNotes] = useState("");
  const [photoUrl, setPhotoUrl] = useState("");
  const [drPhotoUrl, setDrPhotoUrl] = useState("");
  const [drPhotoFile, setDrPhotoFile] = useState<File | null>(null);
  const [drOcrResult, setDrOcrResult] = useState<DrOcrResult | null>(null);
  const [drOcrBusy, setDrOcrBusy] = useState(false);
  const [drOcrProgress, setDrOcrProgress] = useState<DrOcrProgress | null>(null);
  const [receivingPaymentStatus, setReceivingPaymentStatus] = useState<"Unpaid" | "Paid" | "Partial" | "Advance Payment">("Unpaid");
  const [receivingAmountPaid, setReceivingAmountPaid] = useState("");
  const [receivingPaymentMethod, setReceivingPaymentMethod] = useState(paymentMethods[0] ?? "Cash");
  const [receivingPaymentReference, setReceivingPaymentReference] = useState("");
  const [receivingPaymentProofUrl, setReceivingPaymentProofUrl] = useState("");
  const [receivingPaymentNotes, setReceivingPaymentNotes] = useState("");
  const [productLines, setProductLines] = useState<ReceivingLineDraft[]>([]);
  const [recordedReceiving, setRecordedReceiving] = useState<ReceivingSaveResponse | null>(null);
  const [savedReceivingSummary, setSavedReceivingSummary] = useState<SavedReceivingSummary | null>(null);
  const [savedItemsExpanded, setSavedItemsExpanded] = useState(false);
  const [savedPaperWidth, setSavedPaperWidth] = useState<"58mm" | "80mm">(() => readDevicePaperWidth());
  const [receiveMessage, setReceiveMessage] = useState("Start by scanning a DR/photo or adding the first product.");
  const [printStatus, setPrintStatus] = useState("");
  const [draftSaveStatus, setDraftSaveStatus] = useState("");
  const [drafts, setDrafts] = useState<ReceivingDraftRecord[]>([]);
  const [draftFilter, setDraftFilter] = useState<"Draft" | "Cancelled">("Draft");
  const [recordsView, setRecordsView] = useState<"saved" | "drafts" | "cancelled">("saved");
  const [intakeTasks, setIntakeTasks] = useState<ReceivingIntakeTask[]>([]);
  const [mode, setMode] = useState<ReceivingMode>("home");
  const [activeIntakeId, setActiveIntakeId] = useState("");
  const [activeDraftId, setActiveDraftId] = useState("");
  const [activeDraftNumber, setActiveDraftNumber] = useState("");
  const [attachDrSearch, setAttachDrSearch] = useState("");
  const [companySearch, setCompanySearch] = useState("");
  const [companyModalOpen, setCompanyModalOpen] = useState(false);
  const [productSearch, setProductSearch] = useState("");
  const [productModalOpen, setProductModalOpen] = useState(false);
  const [contactsModalCompanyId, setContactsModalCompanyId] = useState("");
  const [customerEditOpen, setCustomerEditOpen] = useState(false);
  const [editCompanyName, setEditCompanyName] = useState("");
  const [editTin, setEditTin] = useState("");
  const [editCompanyPhone, setEditCompanyPhone] = useState("");
  const [editCompanyAddress, setEditCompanyAddress] = useState("");
  const [editBillingAddress, setEditBillingAddress] = useState("");
  const [editShippingAddress, setEditShippingAddress] = useState("");
  const [editBillingSameAsCompany, setEditBillingSameAsCompany] = useState(false);
  const [editShippingSameAsCompany, setEditShippingSameAsCompany] = useState(false);
  const [newContactName, setNewContactName] = useState("");
  const [newContactRole, setNewContactRole] = useState("Operations");
  const [newContactCustomRole, setNewContactCustomRole] = useState("");
  const [newContactPhone, setNewContactPhone] = useState("");
  const [newContactEmail, setNewContactEmail] = useState("");
  const [newContactAddress, setNewContactAddress] = useState("");
  const [newContactBillingAddress, setNewContactBillingAddress] = useState("");
  const [newContactShippingAddress, setNewContactShippingAddress] = useState("");
  const [newContactSameAddress, setNewContactSameAddress] = useState(true);
  const [newContactPrimary, setNewContactPrimary] = useState(false);
  const [newContactNotes, setNewContactNotes] = useState("");
  const [contactFormOpen, setContactFormOpen] = useState(false);
  const [selectedAttachRecord, setSelectedAttachRecord] = useState("");
  const [attachReason, setAttachReason] = useState("Forgot to attach during receiving");
  const [existingReceivingRecords, setExistingReceivingRecords] = useState<ReceivingRecordEditor[]>([]);
  const [editingReceivingRecord, setEditingReceivingRecord] = useState<ReceivingRecordEditor | null>(null);
  const [recordAuditLogs, setRecordAuditLogs] = useState<AuditLog[]>([]);
  const [recordEditReason, setRecordEditReason] = useState("Correction before loading");
  const [confirmReceivingOpen, setConfirmReceivingOpen] = useState(false);
  const [drOverrideReason, setDrOverrideReason] = useState("");
  const [drDuplicateOverride, setDrDuplicateOverride] = useState(false);
  const [autoAddressNotice, setAutoAddressNotice] = useState("");
  const [receiveWarning, setReceiveWarning] = useState<{ message: string; target: string; time: number } | null>(null);
  const [collapsedReceiveSections, setCollapsedReceiveSections] = useState<Record<string, boolean>>({
    itemsAdded: true,
    payment: true
  });
  const receiveWarningRef = useRef<HTMLDivElement | null>(null);
  const receiveSummaryRef = useRef<HTMLDivElement | null>(null);
  const receiveCustomerRef = useRef<HTMLElement | null>(null);
  const receivePeopleRef = useRef<HTMLElement | null>(null);
  const receiveItemRef = useRef<HTMLElement | null>(null);
  const receivePaymentRef = useRef<HTMLElement | null>(null);
  const receiveSaveRef = useRef<HTMLButtonElement | null>(null);
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const attachDrPhotoInputRef = useRef<HTMLInputElement | null>(null);
  const productPhotoInputRef = useRef<HTMLInputElement | null>(null);
  const receivingPaymentProofInputRef = useRef<HTMLInputElement | null>(null);
  const barcodeInputRef = useRef<HTMLInputElement | null>(null);
  const autoFilledPriceRef = useRef<string | null>(null);
  const lastAutoSavedDraftRef = useRef("");
  const visibleCustomers = customers.filter((customer) => !/(demo|test)/i.test(customer.businessName));
  const selectedCustomer = customers.find((customer) => customer.id === selectedCustomerId);
  const canOverrideDuplicateDr = isOwnerRole(activeUserRole);
  const normalizedCustomerDrNumber = customerDrNumber.trim().toLowerCase();
  const hasOpenModal = companyModalOpen || productModalOpen || Boolean(contactsModalCompanyId) || Boolean(editingReceivingRecord) || confirmReceivingOpen;

  function showReceiveWarning(message: string, target: "customer" | "branch" | "item" | "address" | "photo" | "payment" | "dr" | "save") {
    setReceiveMessage(message);
    setReceiveWarning({ message, target, time: Date.now() });
    emitUserIssue({
      level: "warning",
      title: "Cannot continue yet",
      message,
      source: "action",
      details: {
        workflow: "receiving",
        target,
        customer: selectedCustomer?.businessName ?? customerQuery,
        branch: handlingBranchName,
        itemCount: productLines.length
      },
      module: "receiving"
    });
    window.setTimeout(() => {
      const targetElement =
        target === "customer" ? receiveCustomerRef.current :
        target === "branch" || target === "dr" ? receiveSummaryRef.current :
        target === "address" ? receiveCustomerRef.current :
        target === "payment" ? receivePaymentRef.current :
        target === "save" ? receiveSaveRef.current :
        receiveItemRef.current;
      (targetElement ?? receiveWarningRef.current)?.scrollIntoView({ block: "center", behavior: "smooth" });
      if (target === "item") barcodeInputRef.current?.focus();
    }, 40);
  }

  function receiveSectionCollapsed(section: string, warningTargets: string[] = []) {
    return Boolean(collapsedReceiveSections[section]) && !warningTargets.includes(receiveWarning?.target ?? "");
  }

  function toggleReceiveSection(section: string) {
    setCollapsedReceiveSections((current) => ({ ...current, [section]: !current[section] }));
  }

  function receiveCollapseButton(section: string, summary: string, warningTargets: string[] = []) {
    const collapsed = receiveSectionCollapsed(section, warningTargets);
    return (
      <button className="collapseButton" type="button" onClick={() => toggleReceiveSection(section)} aria-expanded={!collapsed}>
        <span>{collapsed ? summary : "Hide"}</span>
        <ChevronDown className={collapsed ? "" : "open"} size={18} />
      </button>
    );
  }

  useEffect(() => {
    if (!hasOpenModal) return;
    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverscroll = document.documentElement.style.overscrollBehavior;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overscrollBehavior = "none";
    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overscrollBehavior = previousHtmlOverscroll;
    };
  }, [hasOpenModal]);

  const customerAddressSuggestion = useMemo(() => {
    if (!selectedCustomer) return null;
    const latestPackage = packages
      .filter((pkg) => pkg.customerName === selectedCustomer.businessName && [pkg.addressLine, pkg.barangay, pkg.city, pkg.province, pkg.deliveryPhone].some(Boolean))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
    if (latestPackage) {
      const area = [latestPackage.addressLine, latestPackage.barangay, latestPackage.city, latestPackage.province].filter(Boolean).join(", ");
      return {
        source: "last delivery history",
        area: area || latestPackage.city || latestPackage.destination,
        addressLine: latestPackage.addressLine ?? "",
        barangay: latestPackage.barangay ?? "",
        city: latestPackage.city ?? "",
        province: latestPackage.province ?? "",
        phone: latestPackage.deliveryPhone ?? ""
      };
    }
    const fallback = selectedCustomer.shippingAddress || selectedCustomer.billingAddress || selectedCustomer.address || "";
    if (!fallback) return null;
    return {
      source: selectedCustomer.shippingAddress ? "saved shipping address" : selectedCustomer.billingAddress ? "saved billing address" : "company address",
      area: fallback,
      addressLine: fallback,
      barangay: "",
      city: "",
      province: "",
      phone: selectedCustomer.phone ?? ""
    };
  }, [packages, selectedCustomer]);
  const customerNameToCreate = customerQuery.trim();
  const matchingCustomerCount = customerNameToCreate.length >= 2
    ? visibleCustomers.filter((customer) =>
        rankSearchResult([customer.businessName, customer.tin, customer.companyPhone, customer.contactPerson, customer.phone], customerNameToCreate) > 0
      ).length
    : 0;
  const canCreateNewCustomer = !selectedCustomer && !showPendingCustomerForm && customerNameToCreate.length >= 4 && matchingCustomerCount === 0;
  const senderContactOptions = useMemo<ContactSuggestion[]>(() => {
    if (!selectedCustomer) return [];

    const byName = new Map<string, ContactSuggestion>();
    const addOption = (option: ContactSuggestion) => {
      const key = `${option.name.trim().toLowerCase()}|${option.phone.trim().toLowerCase()}|${option.role.trim().toLowerCase()}`;
      if (!option.name.trim() || byName.has(key)) return;
      byName.set(key, option);
    };

    for (const contact of selectedCustomer.contacts ?? []) {
      addOption({
          id: contact.id,
          name: contact.name,
          phone: contact.phone ?? "",
          role: contact.role ?? "Customer Contact",
          company: selectedCustomer.businessName,
          notes: contact.notes ?? "",
          source: "Saved contact",
          addressLine: contact.address
      });
    }

    if (!selectedCustomer.contacts?.length && selectedCustomer.contactPerson) {
      addOption({
        id: `${selectedCustomer.id}-primary`,
        name: selectedCustomer.contactPerson,
        phone: selectedCustomer.phone ?? "",
        role: "Customer Contact",
        company: selectedCustomer.businessName,
        notes: "",
        source: "Company primary contact",
        addressLine: selectedCustomer.address
      });
    }

    for (const record of existingReceivingRecords) {
      if (record.customerName !== selectedCustomer.businessName || !record.sender) continue;
      addOption({
        id: `${record.recordNumber}-sender`,
        name: record.sender,
        phone: "",
        role: "Drop-off Person",
        company: selectedCustomer.businessName,
        notes: `Used in ${record.recordNumber}`,
        source: "Receiving history"
      });
    }

    return Array.from(byName.values());
  }, [existingReceivingRecords, selectedCustomer]);

  const consigneeContactOptions = useMemo<ContactSuggestion[]>(() => {
    if (!selectedCustomer) return [];

    const byName = new Map<string, ContactSuggestion>();
    const addOption = (option: ContactSuggestion) => {
      const key = `${option.name.trim().toLowerCase()}|${option.phone.trim().toLowerCase()}|${option.company.trim().toLowerCase()}`;
      if (!option.name.trim() || byName.has(key)) return;
      byName.set(key, option);
    };

    for (const contact of selectedCustomer.contacts ?? []) {
      addOption({
        id: `${contact.id}-receiver`,
        name: contact.name,
        phone: contact.phone ?? "",
        role: contact.role ?? "Receiver / Consignee",
        company: selectedCustomer.businessName,
        notes: contact.notes ?? "",
        source: "Saved contact",
        addressLine: contact.address
      });
    }

    for (const pkg of packages) {
      if (pkg.customerName !== selectedCustomer.businessName || !pkg.consigneeName) continue;
      addOption({
        id: `${pkg.id}-consignee`,
        name: pkg.consigneeName,
        phone: pkg.deliveryPhone ?? "",
        role: "Receiver / Consignee",
        company: pkg.customerName,
        notes: `${pkg.destination} - ${pkg.receivingRecordNumber}`,
        source: "Delivery history",
        addressLine: pkg.addressLine,
        barangay: pkg.barangay,
        city: pkg.city,
        province: pkg.province
      });
    }

    for (const record of existingReceivingRecords) {
      if (record.customerName !== selectedCustomer.businessName || !record.consignee) continue;
      addOption({
        id: `${record.recordNumber}-consignee`,
        name: record.consignee,
        phone: "",
        role: "Receiver / Consignee",
        company: selectedCustomer.businessName,
        notes: `Used in ${record.recordNumber}`,
        source: "Receiving history"
      });
    }

    return Array.from(byName.values());
  }, [existingReceivingRecords, packages, selectedCustomer]);

  const senderNameToCreate = senderName.trim();
  const matchingSenderCount = senderNameToCreate.length >= 2
    ? senderContactOptions.filter((contact) => rankSearchResult([contact.name, contact.phone, contact.role, contact.company], senderNameToCreate) > 0).length
    : 0;
  const canAddDropOffPerson = Boolean(selectedCustomer) && !showSenderDetails && selectedSenderLabel !== senderNameToCreate && senderNameToCreate.length >= 3 && matchingSenderCount === 0;
  const consigneeNameToCreate = consigneeName.trim();
  const matchingConsigneeCount = consigneeNameToCreate.length >= 2
    ? consigneeContactOptions.filter((contact) => rankSearchResult([contact.name, contact.phone, contact.role, contact.company, contact.notes], consigneeNameToCreate) > 0).length
    : 0;
  const canAddConsigneeContact = Boolean(selectedCustomerId) && selectedConsigneeLabel !== consigneeNameToCreate && consigneeNameToCreate.length >= 3 && matchingConsigneeCount === 0;
  const companyList = visibleCustomers
    .filter((customer) => {
      const query = companySearch.trim().toLowerCase();
      if (!query) return true;
      return [
        customer.businessName,
        customer.tin,
        customer.companyPhone,
        customer.contactPerson,
        customer.phone,
        customer.address,
        customer.billingAddress,
        customer.shippingAddress,
        customer.status
      ].some((value) => String(value ?? "").toLowerCase().includes(query));
    })
    .slice(0, 12);
  const productList = productMasters
    .filter((product) => {
      const query = productSearch.trim().toLowerCase();
      if (!query) return true;
      return [
        product.name,
        product.barcode,
        product.brand,
        product.category,
        product.defaultUnit,
        product.defaultPrice,
        product.notes
      ].some((value) => String(value ?? "").toLowerCase().includes(query));
    })
    .slice(0, 16);
  const contactsModalCompany = customers.find((customer) => customer.id === contactsModalCompanyId);

  useEffect(() => {
    if (!contactsModalCompany) return;
    setEditCompanyName(contactsModalCompany.businessName ?? "");
    setEditTin(contactsModalCompany.tin ?? "");
    setEditCompanyPhone(contactsModalCompany.companyPhone ?? contactsModalCompany.phone ?? "");
    setEditCompanyAddress(contactsModalCompany.address ?? "");
    setEditBillingAddress(contactsModalCompany.billingAddress ?? "");
    setEditShippingAddress(contactsModalCompany.shippingAddress ?? "");
    setEditBillingSameAsCompany(Boolean(contactsModalCompany.address && contactsModalCompany.billingAddress === contactsModalCompany.address));
    setEditShippingSameAsCompany(Boolean(contactsModalCompany.address && contactsModalCompany.shippingAddress === contactsModalCompany.address));
    setCustomerEditOpen(false);
    setContactFormOpen(false);
  }, [contactsModalCompany]);
  const visibleDrafts = drafts.filter((draft) => draft.status === draftFilter);
  const receivingRecordOptions = useMemo(() => {
    const records = existingReceivingRecords.length
      ? existingReceivingRecords.map((record) => ({
          recordNumber: record.recordNumber,
          customerName: record.customerName,
          createdAt: record.createdAt ?? "",
          packageCount: record.packages.length,
          descriptions: record.packages.map((pkg) => pkg.description),
          packageNumbers: record.packages.map((pkg) => pkg.packageNumber),
          statuses: record.packages.map((pkg) => pkg.status ?? ""),
          destinations: Array.from(new Set(record.packages.map((pkg) => pkg.handlingBranchName || pkg.destination).filter(Boolean)))
        }))
      : Array.from(
          packages.reduce((grouped, pkg) => {
            const current = grouped.get(pkg.receivingRecordNumber) ?? {
              recordNumber: pkg.receivingRecordNumber,
              customerName: pkg.customerName,
              createdAt: pkg.createdAt,
              packageCount: 0,
              descriptions: [] as string[],
              packageNumbers: [] as string[],
              statuses: [] as string[],
              destinations: [] as string[]
            };
            current.packageCount += 1;
            current.descriptions.push(pkg.description);
            current.packageNumbers.push(pkg.packageNumber);
            current.statuses.push(pkg.status);
            if (pkg.destination) current.destinations.push(pkg.destination);
            if (new Date(pkg.createdAt).getTime() > new Date(current.createdAt).getTime()) current.createdAt = pkg.createdAt;
            grouped.set(pkg.receivingRecordNumber, current);
            return grouped;
          }, new Map<string, { recordNumber: string; customerName: string; createdAt: string; packageCount: number; descriptions: string[]; packageNumbers: string[]; statuses: string[]; destinations: string[] }>())
            .values()
        );
    const query = attachDrSearch.trim().toLowerCase();
    const sequenceNumber = (recordNumber: string) => Number(recordNumber.match(/(\d+)$/)?.[1] ?? 0);
    return records
      .filter((record) => {
        if (!query) return true;
        return [
          record.recordNumber,
          record.customerName,
          record.createdAt,
          record.descriptions.join(" "),
          record.packageNumbers.join(" "),
          record.destinations.join(" "),
          record.statuses.join(" ")
        ].some((value) => value.toLowerCase().includes(query));
      })
      .sort((a, b) => {
        const byDate = new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
        return byDate || sequenceNumber(b.recordNumber) - sequenceNumber(a.recordNumber);
      })
      .slice(0, 8);
  }, [attachDrSearch, existingReceivingRecords, packages]);

  const duplicateDraftByDr = normalizedCustomerDrNumber
    ? drafts.find((draft) => {
        if (draft.status !== "Draft" || draft.id === activeDraftId) return false;
        const draftDr = (draft.customerDrNumber || draft.formState?.customerDrNumber || "").trim().toLowerCase();
        return draftDr === normalizedCustomerDrNumber;
      })
    : undefined;
  const duplicateRecordByDr = normalizedCustomerDrNumber
    ? existingReceivingRecords.find((record) => (record.customerDrNumber ?? "").trim().toLowerCase() === normalizedCustomerDrNumber)
    : undefined;
  const duplicateDrCustomerMismatch = Boolean(
    (duplicateDraftByDr?.customerId && selectedCustomerId && duplicateDraftByDr.customerId !== selectedCustomerId) ||
    (duplicateRecordByDr?.customerName && selectedCustomer && duplicateRecordByDr.customerName !== selectedCustomer.businessName)
  );

  const loadDrafts = useCallback(async () => {
    setDrafts(await apiGet<ReceivingDraftRecord[]>("/receiving/drafts"));
  }, []);

  const loadIntakeTasks = useCallback(async () => {
    setIntakeTasks(await apiGet<ReceivingIntakeTask[]>(apiQuery("/receiving/intake", { status: "Pending Review,In Review" })));
  }, []);

  useEffect(() => {
    loadDrafts().catch(() => setDrafts([]));
  }, [loadDrafts]);

  useEffect(() => {
    loadIntakeTasks().catch(() => setIntakeTasks([]));
  }, [loadIntakeTasks]);

  const loadExistingReceivingRecords = useCallback(async () => {
    const records = await apiGet<ReceivingRecordEditor[]>("/receiving");
    setExistingReceivingRecords(records);
    return records;
  }, []);

  async function loadRecordAudit(recordNumber: string) {
    setRecordAuditLogs(await apiGet<AuditLog[]>(`/receiving/${recordNumber}/audit`));
  }

  useEffect(() => {
    if (mode !== "records") return;
    loadExistingReceivingRecords().catch(() => setExistingReceivingRecords([]));
  }, [loadExistingReceivingRecords, mode]);

  useEffect(() => {
    if (mode !== "intake" && mode !== "home") return;
    loadIntakeTasks().catch(() => setIntakeTasks([]));
  }, [loadIntakeTasks, mode]);

  useEffect(() => {
    if (mode !== "receive" || existingReceivingRecords.length) return;
    loadExistingReceivingRecords().catch(() => undefined);
  }, [existingReceivingRecords.length, loadExistingReceivingRecords, mode]);

  useEffect(() => {
    setDrDuplicateOverride(false);
    setDrOverrideReason("");
  }, [customerDrNumber, selectedCustomerId]);

  useEffect(() => {
    if (!selectedCustomer || !customerAddressSuggestion || deliverySummary.trim()) return;
    setDeliverySummary(customerAddressSuggestion.area);
    setAutoAddressNotice(`Delivery area filled from ${customerAddressSuggestion.source}. You can edit it.`);
    if (customerAddressSuggestion.addressLine) setAddressLine(customerAddressSuggestion.addressLine);
    if (customerAddressSuggestion.barangay) setBarangay(customerAddressSuggestion.barangay);
    if (customerAddressSuggestion.city) setCity(customerAddressSuggestion.city);
    if (customerAddressSuggestion.province) setProvince(customerAddressSuggestion.province);
    if (customerAddressSuggestion.phone) setDeliveryPhone(customerAddressSuggestion.phone);
  }, [customerAddressSuggestion, deliverySummary, selectedCustomer]);

  useEffect(() => {
    if (!paymentMethods.length || paymentMethods.includes(receivingPaymentMethod)) return;
    setReceivingPaymentMethod(paymentMethods[0] ?? "Cash");
  }, [paymentMethods, receivingPaymentMethod]);

  async function openExistingReceivingRecord(recordNumber: string) {
    setSelectedAttachRecord(recordNumber);
    setPrintStatus("");
    const records = existingReceivingRecords.length ? existingReceivingRecords : await loadExistingReceivingRecords();
    const record = records.find((item) => item.recordNumber === recordNumber || item.id === recordNumber) ?? null;
    setEditingReceivingRecord(record ? structuredClone(record) : null);
    setRecordEditReason("Correction before loading");
    if (record) await loadRecordAudit(record.recordNumber);
  }

  function updateEditingPackage(packageId: string, updates: Partial<ReceivingRecordEditor["packages"][number]>) {
    setEditingReceivingRecord((record) => {
      if (!record) return record;
      return {
        ...record,
        packages: record.packages.map((pkg) => pkg.id === packageId ? { ...pkg, ...updates } : pkg)
      };
    });
  }

  async function saveReceivingRecordEdits() {
    if (!editingReceivingRecord) return;
    const updated = await apiPatch<ReceivingRecordEditor>(`/receiving/${editingReceivingRecord.recordNumber}`, {
      customerDrNumber: editingReceivingRecord.customerDrNumber,
      sender: editingReceivingRecord.sender,
      consignee: editingReceivingRecord.consignee,
      destination: editingReceivingRecord.destination,
      reason: recordEditReason,
      packages: editingReceivingRecord.packages.map((pkg) => ({
        id: pkg.id,
        description: pkg.description,
        quantity: Number(pkg.quantity ?? 1),
        unit: pkg.unit,
        destination: pkg.handlingBranchName ?? pkg.destination,
        handlingBranchName: pkg.handlingBranchName ?? pkg.destination,
        condition: pkg.condition as PackageCondition,
        unitPrice: pkg.unitPrice == null ? null : Number(pkg.unitPrice),
        price: pkg.price == null ? null : Number(pkg.price)
      }))
    });
    setEditingReceivingRecord(updated);
    await loadExistingReceivingRecords();
    await loadRecordAudit(updated.recordNumber);
    setReceiveMessage(`${updated.recordNumber} updated. Audit trail recorded at the bottom.`);
  }

  function calculateLineTotal(unitPriceValue: string, quantityValue: string) {
    const numericPrice = Number(unitPriceValue);
    const numericQuantity = Number(quantityValue);
    if (!unitPriceValue || !Number.isFinite(numericPrice) || !Number.isFinite(numericQuantity) || numericPrice < 0 || numericQuantity <= 0) return "";
    return String(Number((numericPrice * numericQuantity).toFixed(2)));
  }

  function formatReceivingMoney(value: string | number | undefined | null) {
    if (value === undefined || value === null || value === "") return "";
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) return String(value);
    return numericValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function productSearchValues(product: ProductMaster) {
    return [
      product.name,
      product.sku,
      product.barcode,
      product.brand,
      product.category,
      product.defaultUnit,
      product.defaultPrice,
      product.notes
    ];
  }

  function productMeta(product: ProductMaster) {
    const parts = [
      product.sku ? `SKU ${product.sku}` : "",
      product.barcode,
      product.brand,
      product.category,
      product.defaultUnit,
      product.defaultPrice == null ? "" : `PHP ${formatReceivingMoney(product.defaultPrice)}`
    ].filter(Boolean);
    return parts.join(" / ") || "Saved product";
  }

  function selectProductMaster(product: ProductMaster) {
    setDescription(product.name);
    setBarcode(product.barcode ?? "");
    setProductSku(product.sku ?? "");
    setShowProductDescriptionEditor(false);
    setUnit(product.defaultUnit || "pcs");
    setProductBrand(product.brand ?? "");
    setProductCategory(product.category ?? "General Merchandise");
    setProductDefaultPrice(product.defaultPrice == null ? "" : String(product.defaultPrice));
    if (!price && product.defaultPrice != null) {
      const nextPrice = String(product.defaultPrice);
      autoFilledPriceRef.current = nextPrice;
      setPrice(nextPrice);
    }
    setReceiveMessage(`${product.name} selected from saved products.`);
  }

  function findProductFromOcrItem(item: DrOcrResult["items"][number]) {
    const query = item.description.trim();
    if (query.length < 3) return undefined;
    const ranked = productMasters
      .filter((product) => product.status !== "Archived")
      .map((product) => {
        const searchScore = rankSearchResult(productSearchValues(product), query);
        const fuzzyScore = Math.max(
          diceSimilarity(product.name, query),
          diceSimilarity([product.brand, product.name].filter(Boolean).join(" "), query),
          product.sku ? diceSimilarity(product.sku, query) : 0,
          product.barcode ? diceSimilarity(product.barcode, query) : 0
        );
        return { product, score: searchScore + Math.round(fuzzyScore * 100) };
      })
      .sort((a, b) => b.score - a.score);
    const best = ranked[0];
    return best && best.score >= 68 ? best.product : undefined;
  }

  function findCustomerFromOcrName(name: string) {
    const query = name.trim();
    if (query.length < 3) return undefined;
    const normalizedQuery = query.toLowerCase().replace(/[^a-z0-9]/g, "");
    const ranked = visibleCustomers
      .map((customer) => {
        const normalizedName = customer.businessName.toLowerCase().replace(/[^a-z0-9]/g, "");
        const exactScore = normalizedName === normalizedQuery ? 100 : normalizedName.includes(normalizedQuery) || normalizedQuery.includes(normalizedName) ? 75 : 0;
        const rankScore = rankSearchResult([customer.businessName, customer.tin, customer.contactPerson], query);
        return { customer, score: exactScore + rankScore };
      })
      .sort((a, b) => b.score - a.score);
    const best = ranked[0];
    return best && best.score >= 50 ? best.customer : undefined;
  }

  function fillAddressFromCustomer(customer: BootstrapData["customers"][number]) {
    const latestPackage = packages
      .filter((pkg) => pkg.customerName === customer.businessName && [pkg.addressLine, pkg.barangay, pkg.city, pkg.province, pkg.deliveryPhone].some(Boolean))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
    if (latestPackage) {
      const area = [latestPackage.addressLine, latestPackage.barangay, latestPackage.city, latestPackage.province].filter(Boolean).join(", ");
      if (area && !deliverySummary.trim()) setDeliverySummary(area);
      if (latestPackage.addressLine && !addressLine.trim()) setAddressLine(latestPackage.addressLine);
      if (latestPackage.barangay && !barangay.trim()) setBarangay(latestPackage.barangay);
      if (latestPackage.city && !city.trim()) setCity(latestPackage.city);
      if (latestPackage.province && !province.trim()) setProvince(latestPackage.province);
      if (latestPackage.deliveryPhone && !deliveryPhone.trim()) setDeliveryPhone(latestPackage.deliveryPhone);
      return Boolean(area);
    }
    const fallback = customer.shippingAddress || customer.billingAddress || customer.address || "";
    if (!fallback) return false;
    if (!deliverySummary.trim()) setDeliverySummary(fallback);
    if (!addressLine.trim()) setAddressLine(fallback);
    return true;
  }

  function applyCustomerHistorySuggestions(customer: BootstrapData["customers"][number], options: { replaceCurrent?: boolean } = {}) {
    const replaceCurrent = Boolean(options.replaceCurrent);
    const latestPackages = packages
      .filter((pkg) => pkg.customerName === customer.businessName)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const latestReceiverPackage = latestPackages.find((pkg) => pkg.consigneeName || pkg.deliveryPhone || pkg.addressLine || pkg.city || pkg.province);
    const latestReceivingRecord = existingReceivingRecords
      .filter((record) => record.customerName === customer.businessName)
      .sort((a, b) => new Date(b.createdAt ?? "").getTime() - new Date(a.createdAt ?? "").getTime())[0];
    const defaultContact = customer.contacts?.find((contact) => contact.isPrimary && contact.status !== "Inactive") ?? customer.contacts?.find((contact) => contact.status !== "Inactive");

    if (replaceCurrent || !senderName.trim()) {
      const senderCandidate = latestReceivingRecord?.sender?.split("|")[0]?.trim() || defaultContact?.name || customer.contactPerson || "";
      if (senderCandidate) {
        setSenderName(senderCandidate);
        setSelectedSenderLabel(senderCandidate);
        setSenderPhone(defaultContact?.phone ?? customer.phone ?? "");
        setSenderCompany(customer.businessName);
        setSenderType(defaultContact?.role ?? "Customer Contact");
      }
    }

    if (replaceCurrent || !consigneeName.trim()) {
      const receiverCandidate = latestReceiverPackage?.consigneeName || latestReceivingRecord?.consignee || "";
      if (receiverCandidate) {
        setConsigneeName(receiverCandidate);
        setSelectedConsigneeLabel(receiverCandidate);
      }
    }

    if ((replaceCurrent || !deliveryPhone.trim()) && latestReceiverPackage?.deliveryPhone) setDeliveryPhone(latestReceiverPackage.deliveryPhone);
    if ((replaceCurrent || !deliveryBusinessName.trim()) && customer.businessName) setDeliveryBusinessName(customer.businessName);
    if (replaceCurrent || !deliverySummary.trim()) {
      const latestArea = latestReceiverPackage
        ? [latestReceiverPackage.addressLine, latestReceiverPackage.barangay, latestReceiverPackage.city, latestReceiverPackage.province].filter(Boolean).join(", ")
        : "";
      if (latestArea) {
        setDeliverySummary(latestArea);
        setAddressLine(latestReceiverPackage?.addressLine ?? "");
        setBarangay(latestReceiverPackage?.barangay ?? "");
        setCity(latestReceiverPackage?.city ?? "");
        setProvince(latestReceiverPackage?.province ?? "");
        setAutoAddressNotice("Delivery area filled from this customer's recent delivery history. You can edit it.");
        return;
      }
      const addressFilled = fillAddressFromCustomer(customer);
      if (addressFilled) setAutoAddressNotice("Delivery area filled from saved customer address. You can edit it.");
    }
  }

  function applyParsedAddress(address: string, source: string) {
    const parsed = parsePhilippineAddress(address);
    if (!parsed) {
      setAutoAddressNotice("Address could not be split. Keep the full address summary and type details if needed.");
      setShowAddressDetails(true);
      return false;
    }
    if (parsed.streetOrBuilding && !addressLine.trim()) setAddressLine(parsed.streetOrBuilding);
    if (parsed.barangay && !barangay.trim()) setBarangay(parsed.barangay);
    if (parsed.city && !city.trim()) setCity(parsed.city);
    if (parsed.province && !province.trim()) setProvince(parsed.province);
    setShowAddressDetails(true);
    const missingNote = parsed.notes.length ? ` Review: ${parsed.notes.join(" ")}` : "";
    setAutoAddressNotice(`Address details split from ${source} with ${parsed.confidence.toLowerCase()} confidence.${missingNote}`);
    return true;
  }

  function formatMeasurements(line: ReceivingLineDraft) {
    const parts: string[] = [];
    if (line.weight) parts.push(`${line.weight} ${line.weightUnit ?? "kg"}`);
    const dimensions = [line.lengthValue, line.widthValue, line.heightValue].filter(Boolean);
    if (dimensions.length) parts.push(`${line.lengthValue || "?"} x ${line.widthValue || "?"} x ${line.heightValue || "?"} ${line.dimensionUnit ?? "cm"}`);
    return parts.join(" / ");
  }

  function clearMeasurementFields() {
    setWeight("");
    setWeightUnit("kg");
    setLengthValue("");
    setWidthValue("");
    setHeightValue("");
    setDimensionUnit("cm");
    setShowMeasurementDetails(false);
  }

  function buildCurrentLine(): ReceivingLineDraft | null {
    if (!description.trim()) {
      showReceiveWarning("Type or scan the product before adding it.", "item");
      return null;
    }
    if (!handlingBranchName.trim()) {
      showReceiveWarning("Select the branch before adding an item.", "branch");
      return null;
    }
    const numericQuantity = Number(quantity);
    if (!Number.isFinite(numericQuantity) || numericQuantity <= 0) {
      showReceiveWarning("Enter a valid quantity before adding the item.", "item");
      return null;
    }
    if (deliveryType === "Deliver to consignee" && !deliverySummary.trim()) {
      showReceiveWarning("Enter the delivery area before adding the item.", "address");
      return null;
    }
    if (condition !== "Good" && !photoUrl) {
      showReceiveWarning("Attach an item image when condition is not Good.", "photo");
      return null;
    }
    const lineTotal = calculateLineTotal(price, quantity);
    return {
      tempId: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      productSku: productSku.trim() || undefined,
      productBarcode: barcode.trim() || undefined,
      productBrand: productBrand.trim() || undefined,
      productCategory: productCategory.trim() || undefined,
      description: description.trim(),
      quantity,
      unit,
      handlingBranchName: handlingBranchName.trim(),
      deliveryType,
      deliveryNotes: deliveryNotes || deliverySummary,
      consigneeName,
      deliveryBusinessName,
      addressLine: addressLine || deliverySummary,
      barangay,
      city,
      province,
      landmark,
      deliveryPhone,
      condition,
      unitPrice: price,
      price: lineTotal,
      weight,
      weightUnit,
      lengthValue,
      widthValue,
      heightValue,
      dimensionUnit,
      photoUrl
    };
  }

  function addProductLine() {
    const line = buildCurrentLine();
    if (!line) return;
    setProductLines((items) => [...items, line]);
    setReceiveMessage(`Added ${line.description}. Add another product or save the receiving document.`);
    setDescription("");
    setShowProductDescriptionEditor(false);
    setQuantity("1");
    setUnit("pcs");
    setPrice("");
    autoFilledPriceRef.current = null;
    setPriceSuggestion(null);
    clearMeasurementFields();
    setBarcode("");
    setProductSku("");
    setProductBrand("");
    setProductCategory("General Merchandise");
    setPhotoUrl("");
    setSelectedConsigneeLabel("");
    setRecordedReceiving(null);
  }

  function buildLineFromOcrItem(item: DrOcrResult["items"][number]): ReceivingLineDraft {
    const matchedProduct = findProductFromOcrItem(item);
    const itemQuantity = item.quantity && Number(item.quantity) > 0 ? item.quantity : "1";
    const itemUnit = matchedProduct?.defaultUnit || item.unit || unit || "pcs";
    const itemUnitPrice = matchedProduct?.defaultPrice == null ? "" : String(matchedProduct.defaultPrice);
    const lineTotal = calculateLineTotal(itemUnitPrice, itemQuantity);
    return {
      tempId: `ocr-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      productSku: matchedProduct?.sku ?? undefined,
      productBarcode: matchedProduct?.barcode ?? undefined,
      productBrand: matchedProduct?.brand ?? undefined,
      productCategory: matchedProduct?.category ?? undefined,
      description: matchedProduct?.name ?? item.description.trim(),
      quantity: itemQuantity,
      unit: itemUnit,
      handlingBranchName: handlingBranchName.trim(),
      deliveryType,
      deliveryNotes: deliveryNotes || deliverySummary,
      consigneeName,
      deliveryBusinessName,
      addressLine: addressLine || deliverySummary,
      barangay,
      city,
      province,
      landmark,
      deliveryPhone,
      condition,
      unitPrice: itemUnitPrice,
      price: lineTotal,
      weight: "",
      weightUnit,
      lengthValue: "",
      widthValue: "",
      heightValue: "",
      dimensionUnit,
      photoUrl: ""
    };
  }

  function appendOcrItemLines(items: DrOcrResult["items"]) {
    const usableItems = items.filter((item) => item.description.trim());
    if (!usableItems.length) return 0;
    const nextLines = usableItems.map((item) => buildLineFromOcrItem(item));
    const existingKeys = new Set(
      productLines.map((line) => `${line.description.trim().toLowerCase()}|${line.quantity}|${line.unit.toLowerCase()}`)
    );
    const uniqueLines = nextLines.filter((line) => {
      const key = `${line.description.trim().toLowerCase()}|${line.quantity}|${line.unit.toLowerCase()}`;
      if (existingKeys.has(key)) return false;
      existingKeys.add(key);
      return true;
    });
    if (uniqueLines.length) setProductLines((currentLines) => [...currentLines, ...uniqueLines]);
    return uniqueLines.length;
  }

  function clearCurrentProduct() {
    setDescription("");
    setBarcode("");
    setProductSku("");
    setProductBrand("");
    setProductCategory("General Merchandise");
    setQuantity("1");
    setUnit("pcs");
    setPrice("");
    autoFilledPriceRef.current = null;
    setPriceSuggestion(null);
    clearMeasurementFields();
    setPhotoUrl("");
    setDeliverySummary("");
    setShowAddressDetails(false);
    setConsigneeName("");
    setSelectedConsigneeLabel("");
    setConsigneeType("Receiver");
    setShowConsigneeDetails(false);
    setDeliveryBusinessName("");
    setAddressLine("");
    setBarangay("");
    setCity("");
    setProvince("");
    setLandmark("");
    setDeliveryPhone("");
    setDeliveryNotes("");
    setReceiveMessage("Product fields cleared. DR details were kept.");
  }

  async function recordReceivingPayments(receiving: ReceivingSaveResponse) {
    if (receivingPaymentStatus === "Unpaid") return;
    const totalPaid = Number(receivingAmountPaid || 0);
    if (!Number.isFinite(totalPaid) || totalPaid <= 0) return;

    let remaining = receivingPaymentStatus === "Paid" && totalPaid === 0 ? receivingAmountDue : totalPaid;
    for (const [index, pkg] of receiving.packages.entries()) {
      const amountDue = Number(pkg.price ?? 0);
      const isLastPackage = index === receiving.packages.length - 1;
      const amountPaid = receivingPaymentStatus === "Advance Payment" && index === 0 && totalPaid > receivingAmountDue
        ? totalPaid - receiving.packages.slice(1).reduce((sum, item) => sum + Number(item.price ?? 0), 0)
        : Math.min(Math.max(remaining, 0), amountDue);
      if (amountPaid <= 0 && !isLastPackage) continue;
      if (amountPaid <= 0) break;
      remaining -= amountPaid;
      await apiPost("/payments", {
        cargoPackageId: pkg.id,
        amountDue,
        amountPaid,
        method: receivingPaymentMethod,
        collectionPoint: "Receiving",
        collectedByUserId: activeUser.id,
        collectedByName: activeUser.name,
        collectedByRole: activeUser.role,
        branchName: pkg.handlingBranchName ?? pkg.destination,
        proofUrl: receivingPaymentProofUrl || undefined,
        notes: [
          `Collected during receiving ${receiving.recordNumber}`,
          receivingPaymentStatus,
          receivingPaymentReference ? `Reference: ${receivingPaymentReference}` : "",
          receivingPaymentNotes,
          receivingPaymentStatus === "Advance Payment" && totalPaid > receivingAmountDue ? `Advance/excess: PHP ${formatReceivingMoney(totalPaid - receivingAmountDue)}` : ""
        ].filter(Boolean).join(" | ")
      });
      if (remaining <= 0 && receivingPaymentStatus !== "Advance Payment") break;
    }
  }

  function editProductLine(line: ReceivingLineDraft) {
    setDescription(line.description);
    setBarcode(line.productBarcode ?? "");
    setProductSku(line.productSku ?? "");
    setShowProductDescriptionEditor(line.description.length > 42);
    setProductBrand(line.productBrand ?? "");
    setProductCategory(line.productCategory ?? "General Merchandise");
    setQuantity(line.quantity);
    setUnit(line.unit);
    setHandlingBranchName(line.handlingBranchName);
    setDeliveryType(line.deliveryType);
    setDeliverySummary(line.deliveryNotes || line.addressLine || line.city || "");
    setAutoAddressNotice("");
    setShowAddressDetails(Boolean(line.consigneeName || line.deliveryBusinessName || line.barangay || line.city || line.province || line.landmark || line.deliveryPhone));
    setConsigneeName(line.consigneeName);
    setSelectedConsigneeLabel(line.consigneeName);
    setConsigneeType("Receiver");
    setShowConsigneeDetails(false);
    setDeliveryBusinessName(line.deliveryBusinessName);
    setAddressLine(line.addressLine);
    setBarangay(line.barangay);
    setCity(line.city);
    setProvince(line.province);
    setLandmark(line.landmark);
    setDeliveryPhone(line.deliveryPhone);
    setDeliveryNotes(line.deliveryNotes);
    setCondition(line.condition);
    setPrice(line.unitPrice ?? line.price);
    setPriceSuggestion(null);
    setWeight(line.weight ?? "");
    setWeightUnit(line.weightUnit ?? "kg");
    setLengthValue(line.lengthValue ?? "");
    setWidthValue(line.widthValue ?? "");
    setHeightValue(line.heightValue ?? "");
    setDimensionUnit(line.dimensionUnit ?? "cm");
    setShowMeasurementDetails(Boolean(line.weight || line.lengthValue || line.widthValue || line.heightValue));
    setPhotoUrl(line.photoUrl ?? "");
    setProductLines((items) => items.filter((item) => item.tempId !== line.tempId));
    setReceiveMessage("Product loaded for editing. Update the fields, then tap Add Product to List.");
  }

  const productDescriptionIsLong = description.trim().length > 42;
  const productsToSave = productLines;
  const receivingAmountDue = productsToSave.reduce((sum, line) => {
    const numericPrice = Number(line.price);
    return Number.isFinite(numericPrice) && numericPrice > 0 ? sum + numericPrice : sum;
  }, 0);
  const numericReceivingAmountPaid = Number(receivingAmountPaid || 0);
  const receivingPaymentBalance = Math.max(receivingAmountDue - (Number.isFinite(numericReceivingAmountPaid) ? numericReceivingAmountPaid : 0), 0);
  const showReceivingPaymentDetails = receivingPaymentStatus !== "Unpaid";

  function buildDraftPayload(options: { linesOverride?: ReceivingLineDraft[]; drPhotoUrlOverride?: string } = {}) {
    const nextDrPhotoUrl = options.drPhotoUrlOverride ?? drPhotoUrl;
    const formState = {
      selectedCustomerId,
      customerQuery,
      pendingCustomerName,
      pendingContactPerson,
      pendingCustomerPhone,
      pendingCustomerAddress,
      pendingBillingAddress,
      pendingShippingAddress,
      showPendingCustomerForm,
      customerDrNumber,
      senderName,
      senderPhone,
      senderType,
      senderCompany,
      senderNotes,
      showSenderDetails,
      selectedSenderLabel,
      selectedConsigneeLabel,
      description,
      quantity,
      unit,
      handlingBranchName,
      deliveryType,
      deliverySummary,
      showAddressDetails,
      consigneeName,
      deliveryBusinessName,
      addressLine,
      barangay,
      city,
      province,
      landmark,
      deliveryPhone,
      deliveryNotes,
      condition,
      price,
      weight,
      weightUnit,
      lengthValue,
      widthValue,
      heightValue,
      dimensionUnit,
      showMeasurementDetails,
      barcode,
      productSku,
      productBrand,
      productCategory,
      receivingPaymentStatus,
      receivingAmountPaid,
      receivingPaymentMethod,
      receivingPaymentReference,
      receivingPaymentProofUrl,
      receivingPaymentNotes,
      drPhotoUrl: nextDrPhotoUrl
    };
    return {
      customerId: selectedCustomerId || undefined,
      customerDrNumber: customerDrNumber || undefined,
      destination: handlingBranchName,
      drPhotoUrl: nextDrPhotoUrl || undefined,
      formState,
      productLines: options.linesOverride ?? productLines
    };
  }

  async function saveDraft(options: { silent?: boolean; linesOverride?: ReceivingLineDraft[]; drPhotoUrlOverride?: string } = {}) {
    const payload = buildDraftPayload(options);
    if (!activeDraftId) {
      const result = await queueablePost<ReceivingDraftRecord>("receivingDraft", "/receiving/drafts", payload);
      if (result.queued) {
        const localDraftNumber = `LOCAL-DRAFT-${Date.now().toString().slice(-6)}`;
        setActiveDraftNumber(localDraftNumber);
        setDraftSaveStatus(`${localDraftNumber} saved on tablet`);
        if (!options.silent) setReceiveMessage("Draft saved on tablet. It will sync when online.");
        return {
          id: localDraftNumber,
          draftNumber: localDraftNumber,
          status: "Draft",
          customerId: payload.customerId,
          customerDrNumber: payload.customerDrNumber,
          destination: payload.destination,
          drPhotoUrl: payload.drPhotoUrl,
          formState: payload.formState,
          productLines: payload.productLines,
          createdBy: activeUser.name,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        } as ReceivingDraftRecord;
      }
      const draft = result.result;
      setActiveDraftId(draft.id);
      setActiveDraftNumber(draft.draftNumber);
      const savedAt = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      setDraftSaveStatus(`${draft.draftNumber} saved ${savedAt}`);
      if (!options.silent) setReceiveMessage(`${draft.draftNumber} saved. You can find it in Records.`);
      await loadDrafts();
      return draft;
    }
    const draft = await apiPatch<ReceivingDraftRecord>(`/receiving/drafts/${activeDraftId}`, payload);
    setActiveDraftId(draft.id);
    setActiveDraftNumber(draft.draftNumber);
    const savedAt = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    setDraftSaveStatus(`${draft.draftNumber} saved ${savedAt}`);
    if (!options.silent) setReceiveMessage(`${draft.draftNumber} saved. You can find it in Records.`);
    await loadDrafts();
    return draft;
  }

  useEffect(() => {
    if (mode !== "receive") return;
    if (!productLines.length && !activeDraftId) return;

    const snapshot = JSON.stringify({
      activeDraftId,
      selectedCustomerId,
      customerDrNumber,
      senderName,
      consigneeName,
      handlingBranchName,
      deliveryType,
      deliverySummary,
      drPhotoUrl,
      receivingPaymentStatus,
      receivingAmountPaid,
      receivingPaymentMethod,
      receivingPaymentReference,
      receivingPaymentProofUrl,
      receivingPaymentNotes,
      productLines
    });
    if (snapshot === lastAutoSavedDraftRef.current) return;

    setDraftSaveStatus("Auto-saving draft...");
    let cancelled = false;
    const timer = window.setTimeout(() => {
      saveDraft({ silent: true, linesOverride: productLines })
        .then((draft) => {
          if (cancelled) return;
          lastAutoSavedDraftRef.current = JSON.stringify({ activeDraftId: draft.id, productLines });
        })
        .catch(() => {
          if (!cancelled) setDraftSaveStatus("Auto-save failed. Tap Save Draft.");
        });
    }, 650);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [activeDraftId, consigneeName, customerDrNumber, deliverySummary, deliveryType, drPhotoUrl, handlingBranchName, mode, productLines, receivingAmountPaid, receivingPaymentMethod, receivingPaymentNotes, receivingPaymentProofUrl, receivingPaymentReference, receivingPaymentStatus, selectedCustomerId, senderName]);

  function resumeDraft(draft: ReceivingDraftRecord) {
    const state = draft.formState ?? {};
    setActiveDraftId(draft.id);
    setActiveDraftNumber(draft.draftNumber);
    setSelectedCustomerId(state.selectedCustomerId ?? draft.customerId ?? "");
    setCustomerQuery(state.customerQuery ?? draft.customerNameSnapshot ?? "");
    setPendingCustomerName(state.pendingCustomerName ?? "");
    setPendingContactPerson(state.pendingContactPerson ?? "");
    setPendingCustomerPhone(state.pendingCustomerPhone ?? "");
    setPendingCustomerAddress(state.pendingCustomerAddress ?? "");
    setPendingBillingAddress(state.pendingBillingAddress ?? "");
    setPendingShippingAddress(state.pendingShippingAddress ?? "");
    setPendingShippingSameAsBilling(false);
    setShowPendingAddressDetails(false);
    setShowPendingCustomerForm(state.showPendingCustomerForm ?? false);
    setCustomerDrNumber(state.customerDrNumber ?? draft.customerDrNumber ?? "");
    setSenderName(state.senderName ?? "");
    setSenderPhone(state.senderPhone ?? "");
    setSenderType(state.senderType ?? "Sales Agent");
    setSenderCompany(state.senderCompany ?? "");
    setSenderNotes(state.senderNotes ?? "");
    setShowSenderDetails(state.showSenderDetails ?? false);
    setSelectedSenderLabel(state.selectedSenderLabel ?? "");
    setDescription(state.description ?? "");
    setQuantity(state.quantity ?? "1");
    setUnit(state.unit ?? "pcs");
    setHandlingBranchName(state.handlingBranchName ?? draft.destination ?? "");
    setDeliveryType(state.deliveryType ?? "Deliver to consignee");
    setDeliverySummary(state.deliverySummary ?? "");
    setAutoAddressNotice("");
    setShowAddressDetails(state.showAddressDetails ?? false);
    setConsigneeName(state.consigneeName ?? "");
    setSelectedConsigneeLabel(state.selectedConsigneeLabel ?? state.consigneeName ?? "");
    setConsigneeType("Receiver");
    setShowConsigneeDetails(false);
    setDeliveryBusinessName(state.deliveryBusinessName ?? "");
    setAddressLine(state.addressLine ?? "");
    setBarangay(state.barangay ?? "");
    setCity(state.city ?? "");
    setProvince(state.province ?? "");
    setLandmark(state.landmark ?? "");
    setDeliveryPhone(state.deliveryPhone ?? "");
    setDeliveryNotes(state.deliveryNotes ?? "");
    setCondition(state.condition ?? "Good");
    setPrice(state.price ?? "");
    setWeight(state.weight ?? "");
    setWeightUnit(state.weightUnit ?? "kg");
    setLengthValue(state.lengthValue ?? "");
    setWidthValue(state.widthValue ?? "");
    setHeightValue(state.heightValue ?? "");
    setDimensionUnit(state.dimensionUnit ?? "cm");
    setShowMeasurementDetails(state.showMeasurementDetails ?? Boolean(state.weight || state.lengthValue || state.widthValue || state.heightValue));
    setPriceSuggestion(null);
    setBarcode(state.barcode ?? "");
    setProductSku(state.productSku ?? "");
    setProductBrand(state.productBrand ?? "");
    setProductCategory(state.productCategory ?? "General Merchandise");
    setProductBrand("");
    setProductCategory("");
    setProductDefaultPrice("");
    setProductNotes("");
    setDrPhotoUrl(state.drPhotoUrl ?? draft.drPhotoUrl ?? "");
    setDrPhotoFile(null);
    setDrOcrResult(null);
    setReceivingPaymentStatus(state.receivingPaymentStatus ?? "Unpaid");
    setReceivingAmountPaid(state.receivingAmountPaid ?? "");
    setReceivingPaymentMethod(state.receivingPaymentMethod ?? paymentMethods[0] ?? "Cash");
    setReceivingPaymentReference(state.receivingPaymentReference ?? "");
    setReceivingPaymentProofUrl(state.receivingPaymentProofUrl ?? "");
    setReceivingPaymentNotes(state.receivingPaymentNotes ?? "");
    setProductLines(draft.productLines ?? []);
    setMode("receive");
    setDraftSaveStatus(`${draft.draftNumber} resumed`);
    lastAutoSavedDraftRef.current = "";
    setReceiveMessage(`${draft.draftNumber} resumed. Review before finalizing.`);
  }

  function newReceiving() {
    setActiveIntakeId("");
    setActiveDraftId("");
    setActiveDraftNumber("");
    setSelectedCustomerId("");
    setCustomerQuery("");
    setPendingCustomerName("");
    setPendingContactPerson("");
    setPendingCustomerPhone("");
    setPendingCustomerAddress("");
    setPendingBillingAddress("");
    setPendingShippingAddress("");
    setPendingShippingSameAsBilling(false);
    setShowPendingAddressDetails(false);
    setShowPendingCustomerForm(false);
    setCustomerDrNumber("");
    setSenderName("");
    setSenderPhone("");
    setSenderType("Sales Agent");
    setSenderCompany("");
    setSenderNotes("");
    setShowSenderDetails(false);
    setSelectedSenderLabel("");
    setDescription("");
    setShowProductDescriptionEditor(false);
    setQuantity("1");
    setUnit("pcs");
    setHandlingBranchName("");
    setDeliveryType("Deliver to consignee");
    setDeliverySummary("");
    setAutoAddressNotice("");
    setShowAddressDetails(false);
    setConsigneeName("");
    setSelectedConsigneeLabel("");
    setConsigneeType("Receiver");
    setShowConsigneeDetails(false);
    setDeliveryBusinessName("");
    setAddressLine("");
    setBarangay("");
    setCity("");
    setProvince("");
    setLandmark("");
    setDeliveryPhone("");
    setDeliveryNotes("");
    setCondition("Good");
    setPrice("");
    clearMeasurementFields();
    setPriceSuggestion(null);
    setBarcode("");
    setProductSku("");
    setProductBrand("");
    setProductCategory("General Merchandise");
    setProductDefaultPrice("");
    setProductNotes("");
    setPhotoUrl("");
    setDrPhotoUrl("");
    setDrPhotoFile(null);
    setDrOcrResult(null);
    setDrOcrBusy(false);
    setReceivingPaymentStatus("Unpaid");
    setReceivingAmountPaid("");
    setReceivingPaymentMethod(paymentMethods[0] ?? "Cash");
    setReceivingPaymentReference("");
    setReceivingPaymentProofUrl("");
    setReceivingPaymentNotes("");
    setProductLines([]);
    setRecordedReceiving(null);
    setSavedReceivingSummary(null);
    setSavedItemsExpanded(false);
    setPrintStatus("");
    setDraftSaveStatus("");
    lastAutoSavedDraftRef.current = "";
    setMode("receive");
    setReceiveMessage("New receiving started.");
  }

  function reviewIntakeTask(task: ReceivingIntakeTask) {
    newReceiving();
    setActiveIntakeId(task.id);
    setSelectedCustomerId(task.customerId ?? "");
    setCustomerQuery(task.customerMatched ? task.customerNameTyped : "");
    setPendingCustomerName(task.customerMatched ? "" : task.customerNameTyped);
    setPendingContactPerson(task.dropOffPerson ?? "");
    setPendingCustomerPhone(task.dropOffPhone ?? "");
    setShowPendingCustomerForm(!task.customerMatched);
    setCustomerDrNumber(task.customerDrNumber ?? "");
    setSenderName(task.dropOffPerson ?? "");
    setSenderPhone(task.dropOffPhone ?? "");
    setSenderType("Drop-off Person");
    setSelectedSenderLabel(task.dropOffPerson ?? "");
    setConsigneeName(task.consigneeName ?? "");
    setSelectedConsigneeLabel(task.consigneeName ?? "");
    setHandlingBranchName(task.destinationBranch ?? "");
    setDeliverySummary(task.deliveryArea ?? "");
    setCity(task.deliveryArea ?? "");
    setDescription(task.itemDescription ?? "");
    setQuantity(String(task.quantity ?? 1));
    setUnit(task.unit ?? "pcs");
    setDrPhotoUrl(task.drPhotoUrl ?? "");
    setDrPhotoFile(null);
    setDrOcrResult(null);
    setProductLines([]);
    setMode("receive");
    setReceiveMessage(`${task.intakeNumber} loaded from wall QR. Review details, add price, then save.`);
  }

  async function readReceivingDrPhoto() {
    if (!drPhotoFile) {
      setReceiveMessage("Take a DR photo first, then tap Read DR Photo.");
      return;
    }
    setDrOcrBusy(true);
    setDrOcrProgress({ stage: "Starting reader", percent: 0 });
    setReceiveMessage("Reading DR photo 0%...");
    try {
      const result = await readDeliveryReceiptPhoto(drPhotoFile, {
        onProgress: (progress) => {
          setDrOcrProgress(progress);
          setReceiveMessage(`${progress.stage} ${progress.percent}%...`);
        }
      });
      setDrOcrResult(result);
      if (result.fields.drNumber && !customerDrNumber.trim()) setCustomerDrNumber(result.fields.drNumber);
      let matchedCustomerFromOcr: BootstrapData["customers"][number] | undefined;
      if (result.fields.customerName && !selectedCustomer) {
        matchedCustomerFromOcr = findCustomerFromOcrName(result.fields.customerName);
        if (matchedCustomerFromOcr) {
          setSelectedCustomerId(matchedCustomerFromOcr.id);
          setCustomerQuery(matchedCustomerFromOcr.businessName);
        } else if (!customerQuery.trim()) {
          setCustomerQuery(result.fields.customerName);
        }
      }
      if (result.fields.dropOffPerson && !senderName.trim()) setSenderName(result.fields.dropOffPerson);
      if (result.fields.receiverName && !consigneeName.trim()) setConsigneeName(result.fields.receiverName);
      if (result.fields.phone && !senderPhone.trim()) setSenderPhone(result.fields.phone);
      if (result.fields.deliveryArea && !deliverySummary.trim()) {
        setDeliverySummary(result.fields.deliveryArea);
        applyParsedAddress(result.fields.deliveryArea, "DR reader");
      } else if (!result.fields.deliveryArea && matchedCustomerFromOcr && !deliverySummary.trim()) {
        const addressFilled = fillAddressFromCustomer(matchedCustomerFromOcr);
        if (addressFilled) setAutoAddressNotice("Address filled from saved customer details because the DR address was not clear.");
      } else if (result.parsedAddress && ![addressLine, barangay, city, province].some((value) => value.trim())) {
        applyParsedAddress(result.parsedAddress.fullAddress, "DR reader");
      }
      if (result.items.length && handlingBranchName.trim()) {
        const matchedProductCount = result.items.filter((item) => findProductFromOcrItem(item)).length;
        const addedCount = appendOcrItemLines(result.items);
        if (addedCount > 0) {
          setDescription("");
          setShowProductDescriptionEditor(false);
          setQuantity("1");
          setUnit("pcs");
          const productMatchNote = matchedProductCount ? ` ${matchedProductCount} matched saved product${matchedProductCount === 1 ? "" : "s"}.` : "";
          setReceiveMessage(`${result.message} Added ${addedCount} item line${addedCount === 1 ? "" : "s"} from the DR.${productMatchNote} Review before saving.`);
        } else {
          setReceiveMessage(`${result.message} The detected item lines are already in the list.`);
        }
      } else {
        if (result.fields.itemDescription && !description.trim()) {
          setDescription(result.fields.itemDescription);
          setShowProductDescriptionEditor(result.fields.itemDescription.length > 42);
        }
        if (result.fields.quantity && quantity === "1") setQuantity(result.fields.quantity);
        if (result.fields.unit && unit === "pcs") setUnit(result.fields.unit);
        if (result.items.length && !handlingBranchName.trim()) {
          setReceiveMessage(`${result.message} Select the branch first, then read again to add detected items to the list.`);
        } else if (matchedCustomerFromOcr && !result.fields.deliveryArea) {
          setReceiveMessage(`${result.message} Customer matched; saved address was filled because the DR address was not clear.`);
        } else if (result.fields.customerName && !selectedCustomer) {
          setReceiveMessage(`${result.message} Type/select the matching customer if suggestions appear.`);
        } else {
          setReceiveMessage(result.message);
        }
      }
    } finally {
      setDrOcrBusy(false);
      setDrOcrProgress(null);
    }
  }

  async function attachReceivingDrPhoto(file: File, inputElement?: HTMLInputElement) {
    setDrPhotoFile(file);
    setDrOcrResult(null);
    setReceiveMessage("Processing DR photo. Please wait...");
    try {
      const uploaded = await uploadCompressedImage(file, "receiving-dr-photo", activeDraftId || customerDrNumber || "new-receiving");
      setDrPhotoUrl(uploaded.fileUrl);
      const draft = await saveDraft({ silent: true, drPhotoUrlOverride: uploaded.fileUrl });
      setReceiveMessage(photoUploadStatus(uploaded, `DR photo attached successfully and saved to ${draft.draftNumber}.`));
      if (inputElement) inputElement.value = "";
    } catch (error) {
      setReceiveMessage(error instanceof Error ? `DR photo upload failed: ${error.message}` : "DR photo upload failed. Try again.");
      throw error;
    }
  }

  async function attachCurrentProductPhoto(file: File, inputElement?: HTMLInputElement) {
    setReceiveMessage("Processing product photo. Please wait...");
    try {
      const uploaded = await uploadCompressedImage(file, "product-photo");
      setPhotoUrl(uploaded.fileUrl);
      setReceiveMessage(photoUploadStatus(uploaded, "Product photo attached successfully to the current item."));
      if (inputElement) inputElement.value = "";
    } catch (error) {
      setReceiveMessage(error instanceof Error ? `Product photo upload failed: ${error.message}` : "Product photo upload failed. Try again.");
      throw error;
    }
  }

  async function attachReceivingPaymentProof(file: File, inputElement?: HTMLInputElement) {
    setReceiveMessage("Uploading receiving payment proof...");
    const uploaded = await uploadCompressedImage(file, "receiving-payment-proof", activeDraftId || customerDrNumber || "new-receiving");
    setReceivingPaymentProofUrl(uploaded.fileUrl);
    setReceiveMessage(photoUploadStatus(uploaded, "Receiving payment proof attached."));
    if (inputElement) inputElement.value = "";
  }

  function openDrafts() {
    setMode("records");
    loadDrafts().catch(() => setReceiveMessage("Unable to load drafts."));
    loadExistingReceivingRecords().catch(() => setExistingReceivingRecords([]));
  }

  function useCustomerContactAsSender() {
    if (!selectedCustomer) {
      setReceiveMessage("Select a customer first, then use customer contact as sender.");
      return;
    }
    setSenderName(selectedCustomer.contactPerson ?? selectedCustomer.businessName);
    setSenderPhone(selectedCustomer.phone ?? "");
    setSenderCompany(selectedCustomer.businessName);
    setSenderType("Customer Contact");
    setReceiveMessage("Sender filled from customer contact.");
  }

  function copySenderToReceiver() {
    if (!senderName.trim()) {
      setReceiveMessage("Enter sender name first before copying to receiver.");
      return;
    }
    setConsigneeName(senderName);
    setDeliveryPhone(senderPhone);
    setDeliveryBusinessName(senderCompany);
    setDeliveryNotes(senderNotes);
    setShowAddressDetails(true);
    setReceiveMessage("Sender copied to receiver/consignee details.");
  }

  async function createPendingCompany(source: string) {
    const shippingAddress = pendingShippingSameAsBilling ? pendingBillingAddress : pendingShippingAddress;
    const customer = await apiPost<BootstrapData["customers"][number]>("/customers/pending", {
      businessName: pendingCustomerName,
      tin: pendingTin,
      companyPhone: pendingCompanyPhone,
      contactPerson: pendingContactPerson,
      contactRole: pendingContactRole === "Other" ? pendingContactCustomRole || "Other" : pendingContactRole,
      contactEmail: pendingContactEmail,
      contactIsPrimary: pendingDefaultContact,
      phone: pendingCustomerPhone,
      address: pendingBillingAddress || shippingAddress || pendingCustomerAddress,
      billingAddress: pendingBillingAddress,
      shippingAddress,
      notes: source
    });
    setSelectedCustomerId(customer.id);
    setCustomerQuery(customer.businessName);
    setPendingCustomerName("");
    setPendingTin("");
    setPendingCompanyPhone("");
    setPendingContactPerson("");
    setPendingContactRole("Operations");
    setPendingContactCustomRole("");
    setPendingContactEmail("");
    setPendingDefaultContact(true);
    setPendingCustomerPhone("");
    setPendingCustomerAddress("");
    setPendingBillingAddress("");
    setPendingShippingAddress("");
    setPendingShippingSameAsBilling(false);
    setShowPendingAddressDetails(false);
    setCompanyModalOpen(false);
    setReceiveMessage(`${customer.businessName} saved for branch owner review. Operations may continue.`);
  }

  async function addCompanyContact() {
    if (!contactsModalCompanyId) return;
    const customer = await apiPost<BootstrapData["customers"][number]>(`/customers/${contactsModalCompanyId}/contacts`, {
      name: newContactName,
      role: newContactRole === "Other" ? newContactCustomRole || "Other" : newContactRole,
      phone: newContactPhone,
      email: newContactEmail,
      address: newContactAddress,
      billingAddress: newContactSameAddress ? newContactAddress : newContactBillingAddress,
      shippingAddress: newContactSameAddress ? newContactAddress : newContactShippingAddress,
      isPrimary: newContactPrimary,
      notes: newContactNotes
    });
    setNewContactName("");
    setNewContactRole("Operations");
    setNewContactCustomRole("");
    setNewContactPhone("");
    setNewContactEmail("");
    setNewContactAddress("");
    setNewContactBillingAddress("");
    setNewContactShippingAddress("");
    setNewContactSameAddress(true);
    setNewContactPrimary(false);
    setNewContactNotes("");
    setContactFormOpen(false);
    setReceiveMessage(`Contact added to ${customer.businessName}.`);
  }

  async function saveCustomerMasterDetails() {
    if (!contactsModalCompanyId) return;
    const companyAddress = editCompanyAddress.trim();
    await apiPatch(`/customers/${contactsModalCompanyId}`, {
      businessName: editCompanyName,
      tin: editTin,
      companyPhone: editCompanyPhone,
      phone: editCompanyPhone,
      address: companyAddress,
      billingAddress: editBillingSameAsCompany ? companyAddress : editBillingAddress,
      shippingAddress: editShippingSameAsCompany ? companyAddress : editShippingAddress,
      status: "Active"
    });
    setCustomerEditOpen(false);
    setReceiveMessage(`${editCompanyName || "Company"} details updated.`);
  }

  async function addConsigneeContactFromReceiving() {
    if (!selectedCustomerId || !consigneeNameToCreate) return;
    const address = [addressLine, barangay, city, province].filter(Boolean).join(", ") || deliverySummary;
    await apiPost<BootstrapData["customers"][number]>(`/customers/${selectedCustomerId}/contacts`, {
      name: consigneeNameToCreate,
      role: consigneeType,
      phone: deliveryPhone,
      address,
      isPrimary: false,
      notes: [
        deliveryBusinessName ? `Company/Agency: ${deliveryBusinessName}` : "",
        deliveryNotes || `Added during receiving${handlingBranchName ? ` for ${handlingBranchName}` : ""}`
      ].filter(Boolean).join(" | ")
    });
    setSelectedConsigneeLabel(consigneeNameToCreate);
    setShowConsigneeDetails(false);
    setReceiveMessage(`${consigneeNameToCreate} added as receiver contact for ${selectedCustomer?.businessName ?? "customer"}.`);
  }

  useEffect(() => {
    const productName = description.trim();
    const productCode = barcode.trim();
    const destination = (handlingBranchName || deliverySummary).trim();
    if (!selectedCustomerId || (!productName && !productCode) || !destination) {
      setPriceSuggestion(null);
      if (autoFilledPriceRef.current && price === autoFilledPriceRef.current) {
        autoFilledPriceRef.current = null;
        setPrice("");
      }
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      apiPost<PriceSuggestion>("/pricing/suggest", {
        customerId: selectedCustomerId,
        productName: productName || undefined,
        barcode: productCode || undefined,
        destination,
        deliveryType
      })
        .then((suggestion) => {
          if (cancelled) return;
          setPriceSuggestion(suggestion.suggestedPrice == null ? null : suggestion);
          const canAutoReplace = !price || Boolean(autoFilledPriceRef.current && price === autoFilledPriceRef.current);
          if (suggestion.suggestedPrice != null && canAutoReplace) {
            const nextPrice = String(suggestion.suggestedPrice);
            autoFilledPriceRef.current = nextPrice;
            setPrice(nextPrice);
            return;
          }
          if (suggestion.suggestedPrice == null && autoFilledPriceRef.current && price === autoFilledPriceRef.current) {
            autoFilledPriceRef.current = null;
            setPrice("");
          }
        })
        .catch(() => {
          if (!cancelled) setPriceSuggestion(null);
        });
    }, 350);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [barcode, deliverySummary, deliveryType, description, handlingBranchName, price, selectedCustomerId]);

  useEffect(() => {
    const query = description.trim();
    if (!query) return;
    const lowerQuery = query.toLowerCase();
    const exactProduct = productMasters.find((product) => {
      if (product.status === "Archived") return false;
      return [product.barcode, product.sku, product.name].some((value) => String(value ?? "").trim().toLowerCase() === lowerQuery);
    });
    const alreadyFilled = exactProduct
      && exactProduct.name === description
      && (exactProduct.barcode ?? "") === barcode
      && (exactProduct.defaultUnit || "pcs") === unit;
    if (!exactProduct || alreadyFilled) return;

    const timer = window.setTimeout(() => {
      selectProductMaster(exactProduct);
      setReceiveMessage(`${exactProduct.name} matched from product list.`);
    }, 180);

    return () => window.clearTimeout(timer);
  }, [description, productMasters]);

  async function scanCurrentProductCode(scannedValue?: string) {
    const nextBarcode = scannedValue?.trim() || barcode.trim();
    if (!nextBarcode) {
      barcodeInputRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
      barcodeInputRef.current?.focus();
      setReceiveMessage("Code field ready. Use the side scanner or type the code.");
      return;
    }

    const cleanBarcode = nextBarcode;
    setBarcode(cleanBarcode);
    setReceiveMessage(`Checking barcode ${cleanBarcode}...`);
    const result = await apiPost<{ found: boolean; product: ProductMaster | null }>("/products/scan", {
      barcode: cleanBarcode
    });
    if (result.product) {
      setDescription(result.product.name);
      setProductSku(result.product.sku ?? "");
      setBarcode(result.product.barcode ?? cleanBarcode);
      setUnit(result.product.defaultUnit || "pcs");
      setProductBrand(result.product.brand ?? "");
      setProductCategory(result.product.category ?? "General Merchandise");
      setProductDefaultPrice(result.product.defaultPrice == null ? "" : String(result.product.defaultPrice));
      setReceiveMessage("Product code found. Product name was filled automatically.");
      const suggestion = await apiPost<PriceSuggestion>("/pricing/suggest", {
        customerId: selectedCustomerId || undefined,
        productName: result.product.name,
        barcode: result.product.barcode ?? cleanBarcode,
        destination: handlingBranchName || deliverySummary || undefined,
        deliveryType
      });
      setPriceSuggestion(suggestion.suggestedPrice == null ? null : suggestion);
      if (suggestion.suggestedPrice != null && !price) {
        const nextPrice = String(suggestion.suggestedPrice);
        autoFilledPriceRef.current = nextPrice;
        setPrice(nextPrice);
      }
    }
    if (!result.found) {
      if (description.trim()) {
        await apiPost("/products", {
          name: description,
          sku: productSku,
          barcode: cleanBarcode,
          brand: productBrand,
          category: productCategory,
          defaultUnit: unit,
          defaultPrice: productDefaultPrice ? Number(productDefaultPrice) : null
        });
        setReceiveMessage(`New barcode ${cleanBarcode} saved for ${description}.`);
      } else {
        setReceiveMessage(`Barcode ${cleanBarcode} not found. Type product name, then press Enter in the barcode field to save it.`);
      }
    }
    window.setTimeout(() => {
      barcodeInputRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
      barcodeInputRef.current?.focus();
    }, 50);
  }

  const productBranchCounts = productsToSave.reduce<Record<string, number>>((counts, line) => {
    counts[line.handlingBranchName] = (counts[line.handlingBranchName] ?? 0) + 1;
    return counts;
  }, {});

  function getTypedCustomerMatch() {
    const typedName = customerQuery.trim().toLowerCase();
    if (!typedName) return undefined;
    return visibleCustomers.find((customer) => customer.businessName.trim().toLowerCase() === typedName);
  }

  function prepareReceivingConfirmation() {
    const hasCustomerForSave = Boolean(selectedCustomerId || getTypedCustomerMatch() || customerQuery.trim());
    if (!hasCustomerForSave) {
      showReceiveWarning("Type or select the customer before saving.", "customer");
      return;
    }
    if (!productsToSave.length) {
      showReceiveWarning("Add at least one item before saving the receipt.", "item");
      return;
    }
    const missingDeliveryAddress = productsToSave.some((line) => {
      if (line.deliveryType !== "Deliver to consignee") return false;
      return ![
        line.deliveryNotes,
        line.addressLine,
        line.barangay,
        line.city,
        line.province
      ].some((value) => String(value ?? "").trim());
    });
    if (missingDeliveryAddress) {
      showReceiveWarning("Delivery address is required before saving. Type the delivery area, then add the item again.", "address");
      return;
    }
    if (duplicateRecordByDr && (!canOverrideDuplicateDr || !drDuplicateOverride || !drOverrideReason.trim())) {
      showReceiveWarning("This DR number was already received. Owner/admin override reason is required.", "dr");
      return;
    }
    if (receivingPaymentStatus !== "Unpaid") {
      const paid = Number(receivingAmountPaid || 0);
      if (!receivingAmountDue) {
        showReceiveWarning("Add item prices before recording payment at receiving.", "payment");
        return;
      }
      if (!Number.isFinite(paid) || paid <= 0) {
        showReceiveWarning("Enter the amount paid before saving payment at receiving.", "payment");
        return;
      }
      if (receivingPaymentStatus === "Paid" && paid < receivingAmountDue) {
        showReceiveWarning("Amount is less than total due. Choose Partial or update the amount.", "payment");
        return;
      }
      if (receivingPaymentStatus === "Paid" && paid > receivingAmountDue) {
        showReceiveWarning("Amount is higher than total due. Choose Advance Payment or update the amount.", "payment");
        return;
      }
      if (receivingPaymentStatus === "Partial" && paid >= receivingAmountDue) {
        showReceiveWarning("Amount covers the total due. Choose Paid or lower the amount.", "payment");
        return;
      }
      if (receivingPaymentStatus === "Advance Payment" && paid <= receivingAmountDue) {
        showReceiveWarning("Advance payment should be higher than the current amount due.", "payment");
        return;
      }
    }
    setReceiveWarning(null);
    setConfirmReceivingOpen(true);
  }

  async function resolveReceivingCustomerId() {
    if (selectedCustomerId) return selectedCustomerId;

    const matchedCustomer = getTypedCustomerMatch();
    if (matchedCustomer) {
      setSelectedCustomerId(matchedCustomer.id);
      setCustomerQuery(matchedCustomer.businessName);
      return matchedCustomer.id;
    }

    const typedCustomerName = customerQuery.trim();
    if (!typedCustomerName) {
      throw new Error("Type or select the customer before saving.");
    }
    if (!handlingBranchName.trim()) {
      throw new Error("Select the branch first so the correct branch owner is notified.");
    }

    const shippingAddress = pendingShippingSameAsBilling ? pendingCustomerAddress : pendingShippingAddress;
    const customer = await apiPost<BootstrapData["customers"][number]>("/customers/pending", {
      businessName: typedCustomerName,
      tin: pendingTin,
      companyPhone: pendingCompanyPhone,
      contactPerson: pendingContactPerson || senderName,
      contactRole: pendingContactRole === "Other" ? pendingContactCustomRole || "Other" : pendingContactRole,
      contactEmail: pendingContactEmail,
      contactIsPrimary: pendingDefaultContact,
      phone: pendingCustomerPhone || senderPhone,
      address: pendingCustomerAddress || deliverySummary || addressLine,
      billingAddress: pendingBillingAddress || pendingCustomerAddress,
      shippingAddress: shippingAddress || pendingCustomerAddress || deliverySummary || addressLine,
      reviewBranchName: handlingBranchName,
      notes: `Created during receiving for ${handlingBranchName} review`
    });
    setSelectedCustomerId(customer.id);
    setCustomerQuery(customer.businessName);
    setPendingCustomerName("");
    setPendingTin("");
    setPendingCompanyPhone("");
    setPendingContactPerson("");
    setPendingContactRole("Operations");
    setPendingContactCustomRole("");
    setPendingContactEmail("");
    setPendingDefaultContact(true);
    setPendingCustomerPhone("");
    setPendingCustomerAddress("");
    setPendingBillingAddress("");
    setPendingShippingAddress("");
    setPendingShippingSameAsBilling(false);
    setShowPendingAddressDetails(false);
    setShowPendingCustomerForm(false);
    setReceiveMessage(`${customer.businessName} saved for ${handlingBranchName} owner review. Receiving will continue.`);
    return customer.id;
  }

  async function submitReceivingDocument() {
    if (!productsToSave.length) return;
    setConfirmReceivingOpen(false);
    await onAction("Save receiving", async () => {
      const saveSummary: SavedReceivingSummary = {
        branchSummary: Object.keys(productBranchCounts).join(" / ") || handlingBranchName,
        amountDue: receivingAmountDue,
        paymentStatus: receivingPaymentStatus,
        amountPaid: Number.isFinite(numericReceivingAmountPaid) ? numericReceivingAmountPaid : 0,
        balance: receivingPaymentBalance
      };
      const receivingCustomerId = await resolveReceivingCustomerId();
      const receivingPayload = {
        customerId: receivingCustomerId,
        customerDrNumber: customerDrNumber.trim() || `DR-${Date.now().toString().slice(-5)}`,
        sender: [
          senderName || "Not provided",
          senderType,
          senderCompany ? `Company: ${senderCompany}` : "",
          senderPhone ? `Phone: ${senderPhone}` : "",
          senderNotes ? `Notes: ${senderNotes}` : "",
          duplicateRecordByDr && drOverrideReason ? `Duplicate DR override: ${drOverrideReason}` : ""
        ].filter(Boolean).join(" | "),
        consignee: productsToSave[0]?.consigneeName || senderName || "See product lines",
        destination: productsToSave[0]?.handlingBranchName ?? handlingBranchName,
        drPhotoUrl: drPhotoUrl || undefined,
        packages: productsToSave.map((line) => ({
          sku: line.productSku,
          productBarcode: line.productBarcode,
          brand: line.productBrand,
          category: line.productCategory,
          description: line.description,
          quantity: Number(line.quantity),
          unit: line.unit,
          destination: line.handlingBranchName,
          handlingBranchId: line.handlingBranchName.toLowerCase().replace(/[^a-z0-9]+/g, "_"),
          handlingBranchName: line.handlingBranchName,
          deliveryType: line.deliveryType,
          consigneeName: line.consigneeName,
          deliveryBusinessName: line.deliveryBusinessName,
          addressLine: line.addressLine || line.deliveryNotes,
          barangay: line.barangay,
          city: line.city || line.deliveryNotes,
          province: line.province,
          landmark: line.landmark,
          deliveryPhone: line.deliveryPhone,
          deliveryNotes: line.deliveryNotes,
          condition: line.condition,
          conditionNotes: line.condition === "Good" ? undefined : "For owner review",
          unitPrice: line.unitPrice ? Number(line.unitPrice) : null,
          price: line.price ? Number(line.price) : null,
          weight: line.weight ? Number(line.weight) : null,
          weightUnit: line.weight ? line.weightUnit : undefined,
          length: line.lengthValue ? Number(line.lengthValue) : null,
          width: line.widthValue ? Number(line.widthValue) : null,
          height: line.heightValue ? Number(line.heightValue) : null,
          dimensionUnit: [line.lengthValue, line.widthValue, line.heightValue].some(Boolean) ? line.dimensionUnit : undefined,
          photoUrls: [line.photoUrl].filter(Boolean)
        }))
      };
      const receiving = activeDraftId
        ? (await apiPost<{ receiving: ReceivingSaveResponse }>(`/receiving/drafts/${activeDraftId}/finalize`, receivingPayload)).receiving
        : await apiPost<ReceivingSaveResponse>("/receiving", receivingPayload);

      // The official RR is already created here. Move staff to the print-ready page
      // before doing any secondary cleanup so they never get stranded in the form.
      setRecordedReceiving(receiving);
      setSavedReceivingSummary(saveSummary);
      setSavedItemsExpanded(false);
      setSavedPaperWidth(readDevicePaperWidth());
      setReceiptPreview("");
      setMode("saved");
      setPrintStatus(`${receiving.recordNumber} saved. Print the receiving receipt when ready.`);
      window.setTimeout(() => window.scrollTo({ top: 0, behavior: "smooth" }), 0);

      try {
        await recordReceivingPayments(receiving);
      } catch (error) {
        setPrintStatus(`${receiving.recordNumber} saved. Payment recording needs review: ${error instanceof Error ? error.message : "unable to record payment"}.`);
      }
      if (activeIntakeId) {
        apiPost(`/receiving/intake/${activeIntakeId}/convert`, { receivingId: receiving.id })
          .catch(() => setReceiveMessage("Receiving saved. Wall QR intake link was not updated; check Intake Tasks later."));
      }
      setActiveIntakeId("");
      setActiveDraftId("");
      setActiveDraftNumber("");
      setProductLines([]);
      setDraftSaveStatus("");
      lastAutoSavedDraftRef.current = "";
      setCustomerDrNumber("");
      setDrPhotoUrl("");
      setReceivingPaymentStatus("Unpaid");
      setReceivingAmountPaid("");
      setReceivingPaymentReference("");
      setReceivingPaymentProofUrl("");
      setReceivingPaymentNotes("");
      loadDrafts().catch(() => setReceiveMessage("Receiving saved. Draft list refresh failed; open Records later."));
      loadIntakeTasks().catch(() => setReceiveMessage("Receiving saved. Intake list refresh failed; open Intake Tasks later."));
    });
  }

  async function printSavedReceivingReceipt(receiving: ReceivingSaveResponse) {
    const slip = await apiGet<{ text: string }>(`/receiving/${receiving.id}/receiving-document`);
    const result = await printNativeText(slip.text, receiving.recordNumber, savedPaperWidth);
    const message = result.ok
      ? `Print request sent to NB80 (${savedPaperWidth}). Check if paper came out.`
      : result.message ?? "Print failed. Open Device > Printer Test.";
    setPrintStatus(message);
    emitUserIssue({
      level: result.ok ? "success" : "error",
      title: result.ok ? "Print request sent" : "Print failed",
      message,
      source: "printer",
      details: { recordNumber: receiving.recordNumber, paperWidth: savedPaperWidth },
      module: "receiving"
    });
  }

  async function printReceivingRecordReceipt(record: ReceivingRecordEditor) {
    const slip = await apiGet<{ text: string }>(`/receiving/${record.id}/receiving-document`);
    const result = await printNativeText(slip.text, record.recordNumber, savedPaperWidth);
    const message = result.ok
      ? `Print request sent to NB80 (${savedPaperWidth}). Check if paper came out.`
      : result.message ?? "Print failed. Open Device > Printer Test.";
    setPrintStatus(message);
    setReceiveMessage(message);
    emitUserIssue({
      level: result.ok ? "success" : "error",
      title: result.ok ? "Print request sent" : "Print failed",
      message,
      source: "printer",
      details: { recordNumber: record.recordNumber, paperWidth: savedPaperWidth },
      module: "receiving"
    });
  }

  async function previewReceivingRecordReceipt(record: ReceivingRecordEditor) {
    const slip = await apiGet<{ text: string }>(`/receiving/${record.id}/receiving-document`);
    setEditingReceivingRecord(null);
    setReceiptPreview(slip.text);
    setPrintStatus(`${record.recordNumber} preview opened. Use Print if the details are correct.`);
  }

  return (
    <div className="stack">
      {mode === "home" && (
        <ModuleTileLauncher
          eyebrow="Receiving Counter"
          title="What do you want to do?"
          description="Choose one clear task. Records contains saved receiving, drafts, cancelled drafts, edits, DR photos, and audit trail."
          actions={[
            { key: "new", label: "New", note: "Receive items", icon: PackagePlus, tone: "dark", onClick: newReceiving },
            {
              key: "records",
              label: "Records",
              note: "Saved, drafts, audit",
              icon: ClipboardList,
              onClick: () => {
                setMode("records");
                loadDrafts().catch(() => setReceiveMessage("Unable to load drafts."));
                loadExistingReceivingRecords().catch(() => setExistingReceivingRecords([]));
              }
            },
            {
              key: "intake",
              label: "Intake Tasks",
              note: `${intakeTasks.length} wall QR`,
              icon: QrCode,
              count: intakeTasks.length,
              onClick: () => {
                setMode("intake");
                loadIntakeTasks().catch(() => setReceiveMessage("Unable to load intake tasks."));
              }
            },
            { key: "company", label: "Companies", note: "List or add", icon: UserCog, onClick: () => setMode("company") },
            { key: "product", label: "Products", note: "List or add", icon: ScanLine, onClick: () => setMode("product") }
          ]}
        />
      )}

      {mode === "saved" && recordedReceiving && (
        <section className="panel successPanel">
          <div className="sectionHeader">
            <div>
              <p className="eyebrow">Receiving Saved</p>
              <h3>{recordedReceiving.recordNumber}</h3>
              <p className="muted">{recordedReceiving.customerName}</p>
              <p className="muted">
                {recordedReceiving.packages.length} item line{recordedReceiving.packages.length === 1 ? "" : "s"}
                {savedReceivingSummary?.branchSummary ? ` - ${savedReceivingSummary.branchSummary}` : ""}
                {savedReceivingSummary ? ` - PHP ${formatReceivingMoney(savedReceivingSummary.amountDue)}` : ""}
              </p>
            </div>
            <span className="badge">Ready to Print</span>
          </div>
          {savedReceivingSummary && (
            <div className="grid accountInfoGrid receiveSavedSummary">
              <div className="settingTile">
                <span>Payment</span>
                <strong>{savedReceivingSummary.paymentStatus}</strong>
              </div>
              <div className="settingTile">
                <span>Paid</span>
                <strong>PHP {formatReceivingMoney(savedReceivingSummary.amountPaid)}</strong>
              </div>
              <div className="settingTile">
                <span>Balance</span>
                <strong>PHP {formatReceivingMoney(savedReceivingSummary.balance)}</strong>
              </div>
            </div>
          )}
          {printStatus && <p className="notice">{printStatus}</p>}
          <button
            className="primaryButton receivePrintPrimary"
            onClick={() => onAction("Print receiving receipt", () => printSavedReceivingReceipt(recordedReceiving))}
          >
            <Printer /> Print Receipt
          </button>
          <div className="savedReceiptControls">
            <label>
              <span>Paper</span>
              <select
                value={savedPaperWidth}
                onChange={(event) => {
                  const next = event.target.value === "58mm" ? "58mm" : "80mm";
                  setSavedPaperWidth(next);
                  window.localStorage.setItem(DEVICE_PAPER_WIDTH_KEY, next);
                }}
              >
                <option value="80mm">80mm</option>
                <option value="58mm">58mm</option>
              </select>
            </label>
            <span className="muted">Use the paper loaded in the NB80 printer.</span>
          </div>
          <div className="buttonGrid savedReceiptSecondaryGrid">
            <button
              className="smallButton savedReceiptSecondaryButton"
              onClick={() => onAction("Preview receiving receipt", async () => {
                const slip = await apiGet<{ text: string }>(`/receiving/${recordedReceiving.id}/receiving-document`);
                setReceiptPreview(slip.text);
                setPrintStatus("Receipt preview opened.");
              })}
            >
              <Printer /> Preview
            </button>
            <button className="smallButton savedReceiptSecondaryButton" onClick={newReceiving}>
              <PackagePlus /> New Receiving
            </button>
            <button className="smallButton savedReceiptSecondaryButton" onClick={() => {
              setMode("records");
              setRecordsView("saved");
              loadExistingReceivingRecords().catch(() => setExistingReceivingRecords([]));
            }}>
              <ClipboardList /> Records
            </button>
          </div>
          <button className="smallButton savedReceiptSecondaryButton savedItemsToggle" onClick={() => setSavedItemsExpanded((value) => !value)}>
            {savedItemsExpanded ? "Hide Items" : `View ${recordedReceiving.packages.length} Items`}
          </button>
          {savedItemsExpanded && (
            <div className="list compactList">
              {recordedReceiving.packages.map((pkg) => (
                <div className="row compactDataRow" key={pkg.id}>
                  <div>
                    <strong>{pkg.description}</strong>
                    <p>{pkg.packageNumber} - {pkg.quantity ?? 1} {pkg.unit ?? "pcs"} - {pkg.handlingBranchName ?? pkg.destination}</p>
                  </div>
                  <span className="badge">{pkg.price == null ? "No Price" : `PHP ${pkg.price}`}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {mode === "intake" && (
        <section className="panel workflow">
          <div className="sectionHeader">
            <div>
              <h3>Intake Tasks</h3>
              <p className="muted">Wall QR submissions. Review, edit, then save through Receive Items.</p>
            </div>
            <div className="customerCardActions">
              <button className="smallButton" onClick={() => loadIntakeTasks().catch(() => setReceiveMessage("Unable to load intake tasks."))}>Refresh</button>
              <button className="smallButton" onClick={() => setMode("home")}>Back</button>
            </div>
          </div>
          <div className="list compactList">
            {intakeTasks.map((task) => (
              <div className="row denseRow" key={task.id}>
                <QrCode size={20} />
                <div>
                  <strong>{task.customerNameTyped}</strong>
                  <p>{task.intakeNumber}{task.customerDrNumber ? ` - DR ${task.customerDrNumber}` : ""}</p>
                  <p className="muted">{task.itemDescription || "No item description"} / {task.destinationBranch || "No branch"} / {task.deliveryArea || "No address"}</p>
                  <p className="muted">
                    {task.customerMatched ? "Company found" : "Company for review"} / {task.productMatched ? "Product found" : "Product for review"} / {task.drPhotoUrl ? "DR photo attached" : "No DR photo"}
                  </p>
                  {task.duplicateCount > 1 && <p className="notice">Submitted {task.duplicateCount} times. Extra notes/photos are grouped here.</p>}
                </div>
                <div className="rowActions">
                  <span className={task.duplicateCount > 1 ? "badge warning" : "badge"}>{task.status}</span>
                  <button className="smallButton" onClick={() => reviewIntakeTask(task)}>Review</button>
                  <button
                    className="smallButton"
                    onClick={() =>
                      onAction("Cancel intake task", async () => {
                        await apiPost(`/receiving/intake/${task.id}/cancel`, { reason: "Cancelled by receiving staff" });
                        await loadIntakeTasks();
                      })
                    }
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ))}
            {!intakeTasks.length && <p className="muted">No pending wall QR intake tasks.</p>}
          </div>
          <p className="notice">{receiveMessage}</p>
        </section>
      )}

      {mode === "company" && (
        <section className="panel workflow">
          <div className="sectionHeader">
            <div>
              <h3>Companies</h3>
              <p className="muted">View existing companies or add a new company.</p>
            </div>
            <div className="customerCardActions">
              <button className="primaryButton" onClick={() => setCompanyModalOpen(true)}><Plus size={18} /> Add Company</button>
              <button className="smallButton" onClick={() => setMode("home")}>Back</button>
            </div>
          </div>
          <section className="subPanel">
            <h4>Company List</h4>
            <label>Search Company<input value={companySearch} onChange={(event) => setCompanySearch(event.target.value)} placeholder="Search name, contact, phone, address, status" /></label>
            <div className="list compactList">
              {companyList.map((customer) => (
                <button className="row denseRow tappableRow" key={customer.id} onClick={() => {
                  setContactsModalCompanyId(customer.id);
                  setContactFormOpen(false);
                }}>
                  <div>
                    <strong>{customer.businessName}</strong>
                    <p>{customer.contactPerson ?? "No contact"}{customer.phone ? ` - ${customer.phone}` : ""}</p>
                    <p className="muted">
                      {customer.address ?? "Address missing"} - {customer.contacts?.length ?? 0} contact{(customer.contacts?.length ?? 0) === 1 ? "" : "s"}
                    </p>
                    {(customer.tin || customer.companyPhone || customer.billingAddress || customer.shippingAddress) && (
                      <p className="muted">
                        {[customer.tin ? `TIN ${customer.tin}` : "", customer.companyPhone ? `Company ${customer.companyPhone}` : "", customer.billingAddress ? "Billing set" : "", customer.shippingAddress ? "Shipping set" : ""].filter(Boolean).join(" / ")}
                      </p>
                    )}
                  </div>
                  <span className="rowChevron">Open</span>
                </button>
              ))}
              {!companyList.length && <p className="muted">No company found.</p>}
            </div>
          </section>
          {contactsModalCompany && (
            <div className="modalLayer" role="dialog" aria-label="Company contacts">
              <div className="modalBackdrop" aria-hidden="true" />
              <section className="modalPanel">
                <div className="sectionHeader">
                  <div>
                    <h3>{contactsModalCompany.businessName} Contacts</h3>
                    <p className="muted">A company can have multiple contacts for accounting, warehouse, sales, delivery, or operations.</p>
                  </div>
                  <button className="smallButton" onClick={() => setContactsModalCompanyId("")}>Close</button>
                </div>
                <section className="subPanel">
                  <div className="sectionHeader">
                    <div>
                      <h4>Company Details</h4>
                      <p className="muted">{[contactsModalCompany.tin ? `TIN ${contactsModalCompany.tin}` : "", contactsModalCompany.companyPhone ? `Phone ${contactsModalCompany.companyPhone}` : ""].filter(Boolean).join(" / ") || "TIN and company phone not completed."}</p>
                    </div>
                    <button className="smallButton" onClick={() => setCustomerEditOpen((current) => !current)}>{customerEditOpen ? "Cancel" : "Edit"}</button>
                  </div>
                  {!customerEditOpen ? (
                    <div className="compactDetails">
                      <p><strong>Company:</strong> {contactsModalCompany.address || "Address missing"}</p>
                      <p><strong>Billing:</strong> {contactsModalCompany.billingAddress || "Not set"}</p>
                      <p><strong>Shipping:</strong> {contactsModalCompany.shippingAddress || "Not set"}</p>
                    </div>
                  ) : (
                    <div className="stack">
                      <div className="formGrid">
                        <label>Company Name<input value={editCompanyName} onChange={(event) => setEditCompanyName(event.target.value)} /></label>
                        <label>TIN<input value={editTin} onChange={(event) => setEditTin(event.target.value)} placeholder="" /></label>
                        <label>Company Phone<input value={editCompanyPhone} onChange={(event) => setEditCompanyPhone(event.target.value)} placeholder="Main company phone" /></label>
                        <LongTextField label="Company Address" value={editCompanyAddress} onChange={setEditCompanyAddress} placeholder="Company address" threshold={36} />
                        <label className="checkboxLabel"><input type="checkbox" checked={editBillingSameAsCompany} onChange={(event) => setEditBillingSameAsCompany(event.target.checked)} /> Billing same as company address</label>
                        {!editBillingSameAsCompany && <LongTextField label="Billing Address" value={editBillingAddress} onChange={setEditBillingAddress} placeholder="Billing address" threshold={36} />}
                        <label className="checkboxLabel"><input type="checkbox" checked={editShippingSameAsCompany} onChange={(event) => setEditShippingSameAsCompany(event.target.checked)} /> Shipping same as company address</label>
                        {!editShippingSameAsCompany && <LongTextField label="Shipping Address" value={editShippingAddress} onChange={setEditShippingAddress} placeholder="Shipping address" threshold={36} />}
                      </div>
                      <button className="primaryButton" disabled={!editCompanyName.trim()} onClick={() => onAction("Save company details", saveCustomerMasterDetails)}>Save Company Details</button>
                    </div>
                  )}
                </section>
                <div className="list compactList">
                  {(contactsModalCompany.contacts ?? []).map((contact) => (
                    <div className="row compactDataRow" key={contact.id}>
                      <div>
                        <strong>{contact.name}</strong>
                        <p>{contact.role ?? "Contact"} {contact.phone ? `- ${contact.phone}` : ""}</p>
                        <p className="muted">{[contact.email, contact.address, contact.billingAddress ? "Billing set" : "", contact.shippingAddress ? "Shipping set" : "", contact.notes].filter(Boolean).join(" - ") || "No details yet"}</p>
                      </div>
                      <span className={contact.isPrimary ? "badge" : "badge warning"}>{contact.isPrimary ? "Primary" : contact.status}</span>
                    </div>
                  ))}
                  {!(contactsModalCompany.contacts ?? []).length && <p className="muted">No contacts saved for this company yet.</p>}
                </div>
                {!contactFormOpen ? (
                  <button className="primaryButton" onClick={() => setContactFormOpen(true)}><Plus size={18} /> Add Contact</button>
                ) : (
                <section className="subPanel">
                  <div className="sectionHeader">
                    <div>
                      <h4>Add Contact</h4>
                      <p className="muted">Fill only what is available. Address fields can be completed later.</p>
                    </div>
                    <button className="smallButton" onClick={() => setContactFormOpen(false)}>Cancel</button>
                  </div>
                  <div className="formGrid">
                    <label>Contact Name<input value={newContactName} onChange={(event) => setNewContactName(event.target.value)} placeholder="Person name" /></label>
                    <label>Role / Type<select value={newContactRole} onChange={(event) => setNewContactRole(event.target.value)}><option>Owner</option><option>Accounting</option><option>Operations</option><option>Warehouse</option><option>Sales Agent</option><option>Driver</option><option>Receiver</option><option>Other</option></select></label>
                    {newContactRole === "Other" && <label>Custom Role<input value={newContactCustomRole} onChange={(event) => setNewContactCustomRole(event.target.value)} placeholder="Type custom role" /></label>}
                    <label>Phone<input value={newContactPhone} onChange={(event) => setNewContactPhone(event.target.value)} placeholder="" /></label>
                    <label>Email<input value={newContactEmail} onChange={(event) => setNewContactEmail(event.target.value)} placeholder="" /></label>
                    <LongTextField label="Contact Address" value={newContactAddress} onChange={setNewContactAddress} placeholder="Contact address" threshold={36} />
                    <label className="checkboxLabel"><input type="checkbox" checked={newContactSameAddress} onChange={(event) => setNewContactSameAddress(event.target.checked)} /> Billing and shipping same as contact address</label>
                    {!newContactSameAddress && (
                      <>
                        <LongTextField label="Billing Address" value={newContactBillingAddress} onChange={setNewContactBillingAddress} placeholder="Billing address" threshold={36} />
                        <LongTextField label="Shipping Address" value={newContactShippingAddress} onChange={setNewContactShippingAddress} placeholder="Shipping address" threshold={36} />
                      </>
                    )}
                    <LongTextField label="Notes" value={newContactNotes} onChange={setNewContactNotes} threshold={36} />
                    <label className="checkboxLabel"><input type="checkbox" checked={newContactPrimary} onChange={(event) => setNewContactPrimary(event.target.checked)} /> Set as primary contact</label>
                  </div>
                  <button className="primaryButton" disabled={!newContactName.trim()} onClick={() => onAction("Add company contact", addCompanyContact)}>Add Contact</button>
                </section>
                )}
              </section>
            </div>
          )}
          {companyModalOpen && (
            <div className="modalLayer" role="dialog" aria-label="Add company">
              <div className="modalBackdrop" aria-hidden="true" />
              <section className="modalPanel">
                <div className="sectionHeader">
                  <div>
                    <h3>Add Company</h3>
                    <p className="muted">Add company details, default contact, and billing/shipping addresses.</p>
                  </div>
                  <button className="smallButton" onClick={() => setCompanyModalOpen(false)}>Close</button>
                </div>
                <section className="subPanel">
                  <h4>Company Details</h4>
                  <div className="formGrid">
                    <label>Company Name<input value={pendingCustomerName} onChange={(event) => setPendingCustomerName(event.target.value)} placeholder="Business or customer name" /></label>
                    <label>TIN<input value={pendingTin} onChange={(event) => setPendingTin(event.target.value)} placeholder="TIN" /></label>
                    <label>Company Phone<input value={pendingCompanyPhone} onChange={(event) => setPendingCompanyPhone(event.target.value)} placeholder="Main company phone" /></label>
                  </div>
                </section>
                <section className="subPanel">
                  <h4>Default Contact</h4>
                  <div className="formGrid">
                    <label>Contact Name<input value={pendingContactPerson} onChange={(event) => setPendingContactPerson(event.target.value)} placeholder="Owner, manager, or coordinator" /></label>
                    <label>Role / Type<select value={pendingContactRole} onChange={(event) => setPendingContactRole(event.target.value)}><option>Owner</option><option>Accounting</option><option>Operations</option><option>Warehouse</option><option>Sales Agent</option><option>Driver</option><option>Receiver</option><option>Other</option></select></label>
                    {pendingContactRole === "Other" && <label>Custom Role<input value={pendingContactCustomRole} onChange={(event) => setPendingContactCustomRole(event.target.value)} placeholder="Type custom role" /></label>}
                    <label>Contact Phone<input value={pendingCustomerPhone} onChange={(event) => setPendingCustomerPhone(event.target.value)} placeholder="Contact mobile/phone" /></label>
                    <label>Email<input value={pendingContactEmail} onChange={(event) => setPendingContactEmail(event.target.value)} placeholder="Email" /></label>
                    <label className="checkboxLabel"><input type="checkbox" checked={pendingDefaultContact} onChange={(event) => setPendingDefaultContact(event.target.checked)} /> Default contact</label>
                  </div>
                </section>
                <section className="subPanel">
                  <h4>Address</h4>
                  <div className="formGrid">
                    <LongTextField label="Billing Address" value={pendingBillingAddress} onChange={(value) => {
                      setPendingBillingAddress(value);
                      if (pendingShippingSameAsBilling) setPendingShippingAddress(value);
                    }} placeholder="Billing address" threshold={36} />
                    <LongTextField label="Shipping Address" value={pendingShippingSameAsBilling ? pendingBillingAddress : pendingShippingAddress} onChange={setPendingShippingAddress} placeholder="Shipping address" threshold={36} />
                    <label className="checkboxLabel"><input type="checkbox" checked={pendingShippingSameAsBilling} onChange={(event) => {
                      setPendingShippingSameAsBilling(event.target.checked);
                      if (event.target.checked) setPendingShippingAddress(pendingBillingAddress);
                    }} /> Shipping same as billing</label>
                  </div>
                </section>
                <button
                  className="primaryButton"
                  disabled={!pendingCustomerName.trim()}
                  onClick={() => onAction("Add company", () => createPendingCompany("Created from Receive > Companies"))}
                >
                  Add Company
                </button>
              </section>
            </div>
          )}
        </section>
      )}

      {mode === "product" && (
        <section className="panel workflow">
          <div className="sectionHeader">
            <div>
              <h3>Products</h3>
              <p className="muted">View reusable product masters or add a new product for any customer to use later.</p>
            </div>
            <div className="rowActions">
              <button className="primaryButton" onClick={() => setProductModalOpen(true)}><Plus size={18} /> Add Product</button>
              <button className="smallButton" onClick={() => setMode("home")}>Back</button>
            </div>
          </div>
          <section className="subPanel">
            <h4>Product List</h4>
            <label>Search Product<input value={productSearch} onChange={(event) => setProductSearch(event.target.value)} placeholder="Search product, SKU, barcode, brand, category, unit, price" /></label>
            <div className="list compactList">
              {productList.map((product) => (
                <div className="row compactDataRow" key={product.id}>
                  <div>
                    <strong>{product.name}</strong>
                    <p>{[product.brand, product.sku ? `SKU ${product.sku}` : "", product.barcode ? `Code ${product.barcode}` : ""].filter(Boolean).join(" - ") || "No brand/code yet"}</p>
                    <p className="muted">{[product.category, product.defaultUnit, product.defaultPrice == null ? "" : `PHP ${product.defaultPrice}`].filter(Boolean).join(" / ")}</p>
                  </div>
                </div>
              ))}
              {!productList.length && <p className="muted">No products found.</p>}
            </div>
          </section>
          {productModalOpen && (
            <div className="modalLayer" role="dialog" aria-label="Add product">
              <div className="modalBackdrop" aria-hidden="true" />
              <section className="modalPanel">
                <div className="sectionHeader">
                  <div>
                    <h3>Add Product</h3>
                    <p className="muted">Save common merchandise once, then reuse it during receiving.</p>
                  </div>
                  <button className="smallButton" onClick={() => setProductModalOpen(false)}>Close</button>
                </div>
                <section className="subPanel">
                  <h4>Product Details</h4>
                  <div className="formGrid">
                    <AutocompleteField<ProductMaster>
                      label="Product / SKU / Barcode"
                      value={description}
                      placeholder="Type product, SKU, or scan barcode"
                      items={productMasters.filter((product) => product.status !== "Archived")}
                      selectedLabel={productMasters.find((product) => product.name === description)?.name ?? ""}
                      minChars={1}
                      noResultsText="No saved product found. Continue typing to save a new product."
                      getLabel={(product) => product.name}
                      getMeta={productMeta}
                      getSearchValues={productSearchValues}
                      getExactValues={(product) => [product.barcode, product.sku, product.name]}
                      onChange={setDescription}
                      onSelect={selectProductMaster}
                      onInputEnter={(value, suggestions) => {
                        if (suggestions.length > 1) {
                          setReceiveMessage("Multiple saved products found. Tap the correct product from the list.");
                          return;
                        }
                        setReceiveMessage(value ? "No exact product found. Continue typing the product name, then save." : "Type product name or scan barcode.");
                      }}
                    />
                    <label>SKU / Product No.<input value={productSku} onChange={(event) => setProductSku(event.target.value)} placeholder="Auto if blank" /></label>
                    <label>Barcode<input ref={barcodeInputRef} value={barcode} onChange={(event) => setBarcode(event.target.value)} onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void onAction("Scan product barcode", scanCurrentProductCode);
                      }
                    }} placeholder="Product code if available" /></label>
                    <label>Brand<input value={productBrand} onChange={(event) => setProductBrand(event.target.value)} placeholder="Example: APO, SteelAsia, no brand" /></label>
                    <label>Category<input value={productCategory} onChange={(event) => setProductCategory(event.target.value)} placeholder="Hardware, grocery, appliance, assorted goods" /></label>
                    <label>Default Unit<select value={unit} onChange={(event) => setUnit(event.target.value)}><option>pcs</option><option>package</option><option>bundle</option><option>sack</option><option>box</option><option>roll</option><option>length</option><option>kg</option><option>set</option><option>custom</option></select></label>
                    <label>Default Price<input type="number" min="0" step="0.01" value={productDefaultPrice} onChange={(event) => setProductDefaultPrice(event.target.value)} placeholder="Reference price only" /></label>
                    <LongTextField label="Notes" value={productNotes} onChange={setProductNotes} placeholder="Product details" threshold={36} />
                  </div>
                  <div className="buttonGrid">
                    <button className="actionButton" onClick={() => void capturePhotoOrOpenPicker(productPhotoInputRef, `product-photo-${Date.now()}.jpg`, (file) => attachCurrentProductPhoto(file))}><Camera /> Add Product Image</button>
                  </div>
                  {photoUrl && <p className="muted">Product photo attached to this product master entry.</p>}
                </section>
                <button
                  className="primaryButton"
                  disabled={!description.trim()}
                  onClick={() =>
                    onAction("Add product", async () => {
                      await apiPost<ProductMaster>("/products", {
                        name: description,
                        sku: productSku,
                        barcode,
                        brand: productBrand,
                        category: productCategory,
                        defaultUnit: unit,
                        defaultPrice: productDefaultPrice ? Number(productDefaultPrice) : null,
                        notes: productNotes,
                        photoUrl: photoUrl || undefined
                      });
                      setReceiveMessage(`${description} saved as a general product. Any customer can use it during receiving.`);
                      setBarcode("");
                      setProductSku("");
                      setDescription("");
                      setProductBrand("");
                      setProductCategory("General Merchandise");
                      setProductDefaultPrice("");
                      setProductNotes("");
                      setPhotoUrl("");
                      setProductModalOpen(false);
                    })
                  }
                >
                  Save Product
                </button>
              </section>
            </div>
          )}
        </section>
      )}

      {mode === "records" && (
        <section className="panel workflow">
          <div className="sectionHeader">
            <div>
              <h3>Records</h3>
              <p className="muted">Find saved receiving records, open drafts, attach DR photos, edit records, and review audit history.</p>
            </div>
            <div className="headerActionGroup">
              <button className="smallButton" onClick={() => setMode("home")}>Back</button>
            </div>
          </div>
          <div className="buttonGrid three compactTabs">
            <button className={recordsView === "saved" ? "actionButton active" : "actionButton"} onClick={() => setRecordsView("saved")}>
              <ClipboardList /> Saved Records
            </button>
            <button className={recordsView === "drafts" ? "actionButton active" : "actionButton"} onClick={() => {
              setRecordsView("drafts");
              setDraftFilter("Draft");
              loadDrafts().catch(() => setReceiveMessage("Unable to load drafts."));
            }}>
              <ClipboardList /> Active Drafts
            </button>
            <button className={recordsView === "cancelled" ? "actionButton active" : "actionButton"} onClick={() => {
              setRecordsView("cancelled");
              setDraftFilter("Cancelled");
              loadDrafts().catch(() => setReceiveMessage("Unable to load drafts."));
            }}>
              <X /> Cancelled
            </button>
          </div>
          {recordsView === "saved" && (
          <section className="subPanel">
            <h4>Saved Records</h4>
            <p className="muted">Tap a receiving record to open details. Edit, attach DR photo, and audit trail appear only after selecting a record.</p>
            <label>Find record<input value={attachDrSearch} onChange={(event) => setAttachDrSearch(event.target.value)} placeholder="Customer, RR number, package, status, date" /></label>
            <div className="list compactList">
              {receivingRecordOptions.map((record) => (
                <button
                  className={selectedAttachRecord === record.recordNumber ? "recordSelectButton active" : "recordSelectButton"}
                  key={record.recordNumber}
                  onClick={() => void openExistingReceivingRecord(record.recordNumber)}
                >
                  <div>
                    <strong>{record.customerName}</strong>
                    <p>{record.recordNumber} - {record.packageCount} item{record.packageCount === 1 ? "" : "s"}</p>
                    <p className="muted">{record.descriptions.slice(0, 2).join(", ")}</p>
                  </div>
                  <span className="badge">{new Date(record.createdAt).toLocaleDateString()}</span>
                </button>
              ))}
              {!receivingRecordOptions.length && <p className="muted">No matching receiving records found.</p>}
            </div>
            <input ref={attachDrPhotoInputRef} className="hiddenInput" type="file" accept="image/*" onChange={(event) => {
              const inputElement = event.currentTarget;
              const file = event.target.files?.[0];
              if (!file || !selectedAttachRecord) return;
              onAction("Attach DR photo", async () => {
                const uploaded = await uploadCompressedImage(file, "receiving-dr-photo", selectedAttachRecord);
                await queueablePost("photo", `/receiving/${selectedAttachRecord}/dr-photo`, {
                  drPhotoUrl: uploaded.fileUrl,
                  reason: attachReason || "Late DR attachment"
                });
                await openExistingReceivingRecord(selectedAttachRecord);
                setReceiveMessage(photoUploadStatus(uploaded, `DR photo attached to ${selectedAttachRecord}.`));
                inputElement.value = "";
              });
            }} />
          </section>
          )}
          {recordsView !== "saved" && (
          <section className="subPanel">
            <div className="sectionHeader">
              <div>
                <h4>{recordsView === "drafts" ? "Active Drafts" : "Cancelled Drafts"}</h4>
                <p className="muted">{recordsView === "drafts" ? "Unfinished receiving work that can be resumed." : "Cancelled drafts are retained as read-only history."}</p>
              </div>
              <button className="smallButton" onClick={() => loadDrafts().catch(() => setReceiveMessage("Unable to load drafts."))}>Refresh</button>
            </div>
            <div className="list compactList">
              {visibleDrafts.map((draft) => (
                <div className="row denseRow" key={draft.id}>
                  <div>
                    <strong>{draft.draftNumber}</strong>
                    <p>{draft.customerNameSnapshot ?? "No customer yet"} - {draft.productLines.length} item{draft.productLines.length === 1 ? "" : "s"}</p>
                    <p className="muted">Updated {new Date(draft.updatedAt).toLocaleString()}</p>
                  </div>
                  <span className={draft.status === "Cancelled" ? "badge warning" : "badge"}>{draft.status}</span>
                  <div className="rowActions">
                    {draft.status === "Draft" && <button className="smallButton" onClick={() => resumeDraft(draft)}>Resume</button>}
                    {draft.status === "Draft" && (
                      <button
                        className="smallButton"
                        onClick={() =>
                          onAction("Cancel draft", async () => {
                            await apiPost(`/receiving/drafts/${draft.id}/cancel`, {});
                            await loadDrafts();
                            setRecordsView("cancelled");
                            setDraftFilter("Cancelled");
                          })
                        }
                      >
                        Cancel
                      </button>
                    )}
                    {draft.status === "Cancelled" && <span className="muted">Read-only</span>}
                  </div>
                </div>
              ))}
              {!visibleDrafts.length && <p className="muted">{draftFilter === "Draft" ? "No active drafts." : "No cancelled drafts."}</p>}
            </div>
          </section>
          )}
        </section>
      )}

      {editingReceivingRecord && (
        <div className="modalLayer" role="dialog" aria-label="Receiving record actions">
          <div className="modalBackdrop" aria-hidden="true" />
          <section className="modalPanel recordActionModal">
            <div className="sectionHeader">
              <div>
                <h3>{editingReceivingRecord.recordNumber}</h3>
                <p className="muted">{editingReceivingRecord.customerName} - {editingReceivingRecord.packages.length} item{editingReceivingRecord.packages.length === 1 ? "" : "s"}</p>
              </div>
              <div className="rowActions">
                <span className="badge">{editingReceivingRecord.drPhotoUrl ? "DR photo saved" : "No DR photo"}</span>
                <button className="smallButton" onClick={() => setEditingReceivingRecord(null)}>Close</button>
              </div>
            </div>
            {printStatus && <p className="notice">{printStatus}</p>}
            <div className="formGrid">
              <label>Customer DR Number<input value={editingReceivingRecord.customerDrNumber ?? ""} onChange={(event) => setEditingReceivingRecord({ ...editingReceivingRecord, customerDrNumber: event.target.value })} /></label>
              <label>Sender<input value={editingReceivingRecord.sender ?? ""} onChange={(event) => setEditingReceivingRecord({ ...editingReceivingRecord, sender: event.target.value })} /></label>
              <label>Consignee<input value={editingReceivingRecord.consignee ?? ""} onChange={(event) => setEditingReceivingRecord({ ...editingReceivingRecord, consignee: event.target.value })} /></label>
              <label>Main Destination<input value={editingReceivingRecord.destination} onChange={(event) => setEditingReceivingRecord({ ...editingReceivingRecord, destination: event.target.value })} /></label>
            </div>
            <div className="list">
              {editingReceivingRecord.packages.map((pkg) => (
                <div className="row editableRow" key={pkg.id}>
                  <PackagePlus size={20} />
                  <div className="stack">
                    <strong>{pkg.packageNumber}</strong>
                    <div className="formGrid">
                      <label>Product<input value={pkg.description} onChange={(event) => updateEditingPackage(pkg.id, { description: event.target.value })} /></label>
                      <label>Quantity<input type="number" min="0.01" step="0.01" value={pkg.quantity ?? 1} onChange={(event) => updateEditingPackage(pkg.id, { quantity: Number(event.target.value) })} /></label>
                      <label>Unit<input value={pkg.unit ?? "pcs"} onChange={(event) => updateEditingPackage(pkg.id, { unit: event.target.value })} /></label>
                      <label>Destination<input value={pkg.handlingBranchName ?? pkg.destination} onChange={(event) => updateEditingPackage(pkg.id, { handlingBranchName: event.target.value, destination: event.target.value })} /></label>
                      <label>Condition<select value={pkg.condition} onChange={(event) => updateEditingPackage(pkg.id, { condition: event.target.value })}><option>Good</option><option>Damaged</option><option>Wet</option><option>Incomplete</option><option>For Checking</option><option>Other</option></select></label>
                      <label>Price<input type="number" min="0" step="0.01" value={pkg.price ?? ""} onChange={(event) => updateEditingPackage(pkg.id, { price: event.target.value ? Number(event.target.value) : null })} /></label>
                    </div>
                    {pkg.status && <p className="muted">Status: {pkg.status}</p>}
                  </div>
                </div>
              ))}
            </div>
            <LongTextField label="Edit Reason" value={recordEditReason} onChange={setRecordEditReason} placeholder="Required: explain why this record is being changed" threshold={36} />
            <LongTextField label="DR Photo Reason" value={attachReason} onChange={setAttachReason} placeholder="Example: Forgot to attach during receiving" threshold={36} />
            <div className="buttonGrid recordActionGrid">
              <button className="primaryButton" disabled={!recordEditReason.trim()} onClick={() => onAction("Save receiving record edits", saveReceivingRecordEdits)}>
                Save Changes with Audit
              </button>
              <button className="actionButton" onClick={() => onAction("Reprint receiving receipt", () => printReceivingRecordReceipt(editingReceivingRecord))}>
                <Printer /> Reprint Receipt
              </button>
              <button className="actionButton" onClick={() => onAction("Preview receiving receipt", () => previewReceivingRecordReceipt(editingReceivingRecord))}>
                <Printer /> Preview Receipt
              </button>
              <button className="actionButton" disabled={!selectedAttachRecord} onClick={() => void capturePhotoOrOpenPicker(attachDrPhotoInputRef, `receiving-dr-photo-${Date.now()}.jpg`, async (file) => {
                const uploaded = await uploadCompressedImage(file, "receiving-dr-photo", selectedAttachRecord);
                await queueablePost("photo", `/receiving/${selectedAttachRecord}/dr-photo`, {
                  drPhotoUrl: uploaded.fileUrl,
                  reason: attachReason || "Late DR attachment"
                });
                await openExistingReceivingRecord(selectedAttachRecord);
                setReceiveMessage(photoUploadStatus(uploaded, `DR photo attached to ${selectedAttachRecord}.`));
              })}>
                <Camera /> Add DR Image
              </button>
            </div>
            <div className="subPanel">
              <h4>Audit Trail</h4>
              <div className="list">
                {recordAuditLogs.map((log) => (
                  <div className="row" key={log.id}>
                    <ShieldCheck size={20} />
                    <div>
                      <strong>{log.action}</strong>
                      <p>{log.entityType}: {log.entityId}</p>
                      {log.reason && <p className="muted">{log.reason}</p>}
                    </div>
                    <span className="badge">{new Date(log.createdAt).toLocaleString()}</span>
                  </div>
                ))}
                {!recordAuditLogs.length && <p className="muted">No audit entries yet for this record.</p>}
              </div>
            </div>
          </section>
        </div>
      )}

      {false && (
        <section className="subPanel">
          <div className="sectionHeader">
            <div>
              <h4>My Drafts</h4>
              <p className="muted">Drafts only. Official receiving records are not shown here.</p>
            </div>
            <button className="smallButton" onClick={() => setMode("home")}>Back</button>
          </div>
          <div className="segmentedControl">
            <button className={draftFilter === "Draft" ? "active" : ""} onClick={() => setDraftFilter("Draft")}>Active Drafts</button>
            <button className={draftFilter === "Cancelled" ? "active" : ""} onClick={() => setDraftFilter("Cancelled")}>Cancelled Drafts</button>
          </div>
          <div className="list compactList">
            {visibleDrafts.map((draft) => (
              <div className="row denseRow" key={draft.id}>
                <div>
                  <strong>{draft.draftNumber}</strong>
                  <p>{draft.customerNameSnapshot ?? "No customer yet"} - {draft.productLines.length} item{draft.productLines.length === 1 ? "" : "s"}</p>
                  <p className="muted">Updated {new Date(draft.updatedAt).toLocaleString()}</p>
                </div>
                <span className={draft.status === "Cancelled" ? "badge warning" : "badge"}>{draft.status}</span>
                <div className="rowActions">
                  {draft.status === "Draft" && <button className="smallButton" onClick={() => resumeDraft(draft)}>Resume</button>}
                  {draft.status === "Draft" && (
                    <button
                      className="smallButton"
                      onClick={() =>
                        onAction("Cancel draft", async () => {
                          await apiPost(`/receiving/drafts/${draft.id}/cancel`, {});
                          await loadDrafts();
                          setRecordsView("cancelled");
                          setDraftFilter("Cancelled");
                        })
                      }
                    >
                      Cancel
                    </button>
                  )}
                  {draft.status === "Cancelled" && <span className="muted">Read-only</span>}
                </div>
              </div>
            ))}
            {!visibleDrafts.length && <p className="muted">{draftFilter === "Draft" ? "No active drafts." : "No cancelled drafts."}</p>}
          </div>
        </section>
      )}
      {mode === "receive" && (
        <>
      <section className="panel workflow receiveWorkflow">
      <div className="sectionHeader">
        <div>
          <h3>Receive Items</h3>
          {activeDraftNumber && <p className="muted">Editing {activeDraftNumber}</p>}
        </div>
        <div className="headerActionGroup">
          <button className="smallButton" onClick={() => setMode("home")}>Back</button>
          <button className="smallButton" onClick={openDrafts}>Records</button>
          <button className="smallButton" onClick={() => onAction("Save draft", saveDraft)}>Save Draft</button>
        </div>
      </div>
      <p className="notice">{receiveMessage}</p>
      {receiveWarning && (
        <div ref={receiveWarningRef} className="validationWarning" role="alert" key={receiveWarning.time}>
          <AlertTriangle size={20} />
          <div>
            <strong>Cannot continue yet</strong>
            <p>{receiveWarning.message}</p>
          </div>
          <button className="smallButton" onClick={() => setReceiveWarning(null)}>OK</button>
        </div>
      )}
      <div
        ref={receiveSummaryRef}
        className={`receiveStickySummary ${receiveWarning?.target === "branch" || receiveWarning?.target === "dr" ? "needsAttention" : ""}`}
      >
        <div className={`summarySelectTile ${receiveWarning?.target === "branch" ? "needsAttention" : ""}`}>
          <label>
            <span>Branch</span>
            <select value={handlingBranchName} onChange={(event) => setHandlingBranchName(event.target.value)}>
              <option value="">Select branch</option>
              {receivingBranchOptions.map((branch) => <option key={branch}>{branch}</option>)}
            </select>
          </label>
        </div>
        <div className={`summaryInputTile ${receiveWarning?.target === "dr" ? "needsAttention" : ""}`}>
          <label>
            <span>DR Number</span>
            <input value={customerDrNumber} onChange={(event) => setCustomerDrNumber(event.target.value)} placeholder="DR number" />
          </label>
        </div>
        <div className={`summaryDrPhotoTile ${drPhotoUrl ? "attached" : ""} ${receiveWarning?.target === "dr" ? "needsAttention" : ""}`}>
          <div className="summaryTileText">
            <span>Photo</span>
            <strong>{drPhotoUrl ? "Attached" : "No photo"}</strong>
          </div>
          <div className="summaryMiniActions">
            <button className="smallButton" onClick={() => void capturePhotoOrOpenPicker(
              photoInputRef,
              `receiving-dr-photo-${Date.now()}.jpg`,
              (file) => onAction("Upload DR photo", () => attachReceivingDrPhoto(file)),
              setReceiveMessage
            )}><Camera size={16} /> Add</button>
            <button className="smallButton" disabled={!drPhotoFile || drOcrBusy} onClick={() => onAction("Read DR photo", readReceivingDrPhoto)}>
              <ClipboardList size={16} /> {drOcrBusy ? `${drOcrProgress?.percent ?? 0}%` : "Read"}
            </button>
            {(customerDrNumber || drPhotoUrl) && (
              <button className="smallButton iconOnlyButton" aria-label="Clear DR" onClick={() => {
                setCustomerDrNumber("");
                setDrPhotoUrl("");
                setDrPhotoFile(null);
                setDrOcrResult(null);
                setDrDuplicateOverride(false);
                setDrOverrideReason("");
                setReceiveMessage("DR fields cleared.");
              }}><X size={16} /></button>
            )}
          </div>
        </div>
        <div className="summaryStatusTile">
          <span>Items</span>
          <strong>{productsToSave.length}</strong>
        </div>
      </div>
      <input ref={photoInputRef} className="hiddenInput" type="file" accept="image/*" onChange={(event) => {
          const inputElement = event.currentTarget;
          const file = event.target.files?.[0];
          if (!file) {
            setReceiveMessage("No DR photo selected.");
            return;
          }
          void onAction("Upload DR photo", () => attachReceivingDrPhoto(file, inputElement));
        }} />
      <input ref={productPhotoInputRef} className="hiddenInput" type="file" accept="image/*" onChange={(event) => {
          const inputElement = event.currentTarget;
          const file = event.target.files?.[0];
          if (!file) {
            setReceiveMessage("No product photo selected.");
            return;
          }
          void onAction("Upload product photo", () => attachCurrentProductPhoto(file, inputElement));
        }} />

      {drOcrResult && (
        <div className="subPanel compactPanel">
          <h4>DR Reader Result</h4>
          <p className="muted">{drOcrResult.message}</p>
          <OcrConfidenceGrid result={drOcrResult} />
          {drOcrResult.addresses.length > 1 && (
            <>
              <p className="muted">Multiple addresses found. Choose the correct delivery address.</p>
              <div className="compactActionGrid">
                {drOcrResult.addresses.map((address) => (
	                  <button key={address} className="smallButton" onClick={() => {
	                    setDeliverySummary(address);
	                    applyParsedAddress(address, "selected DR address");
	                    setShowAddressDetails(true);
	                    setReceiveMessage("Delivery address selected from DR reader.");
	                  }}>
                    {address}
                  </button>
                ))}
              </div>
            </>
          )}
          {drOcrResult.items.length > 1 && (
            <>
              <p className="muted">Multiple item lines found. Choose one, then review quantity and price.</p>
              <div className="compactActionGrid">
                {drOcrResult.items.map((item) => (
                  <button key={`${item.description}-${item.quantity}-${item.unit}`} className="smallButton" onClick={() => {
                    setDescription(item.description);
                    setShowProductDescriptionEditor(item.description.length > 42);
                    if (item.quantity) setQuantity(item.quantity);
                    if (item.unit) setUnit(item.unit);
                    setReceiveMessage("Item selected from DR reader. Review before adding to list.");
                  }}>
                    {[item.quantity, item.unit, item.description].filter(Boolean).join(" ")}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
      {(duplicateDraftByDr || duplicateRecordByDr) && (
        <div className={duplicateRecordByDr ? "duplicateDrWarning blocking" : "duplicateDrWarning"}>
          <div>
            <strong>
              {duplicateRecordByDr
                ? `DR already received under ${duplicateRecordByDr.recordNumber}`
                : `DR already saved as ${duplicateDraftByDr?.draftNumber}`}
            </strong>
            <p>
              {duplicateDrCustomerMismatch
                ? "The DR number matches another customer. Review carefully before continuing."
                : duplicateRecordByDr
                  ? "This may duplicate an official receiving record."
                  : "Resume the existing draft if this is the same transaction."}
            </p>
          </div>
          <div className="rowActions">
            {duplicateDraftByDr && <button className="smallButton" onClick={() => resumeDraft(duplicateDraftByDr)}>Resume Draft</button>}
            {duplicateRecordByDr && <button className="smallButton" onClick={() => void openExistingReceivingRecord(duplicateRecordByDr.recordNumber)}>Open Record</button>}
          </div>
          {duplicateRecordByDr && canOverrideDuplicateDr && (
            <div className="formGrid">
              <LongTextField label="Owner Override Reason" value={drOverrideReason} onChange={setDrOverrideReason} placeholder="Required to continue with duplicate DR" threshold={36} />
              <button className="smallButton" disabled={!drOverrideReason.trim()} onClick={() => {
                setDrDuplicateOverride(true);
                setReceiveMessage("Duplicate DR override recorded for this receiving. Audit reason will be included in notes.");
              }}>Allow Duplicate</button>
            </div>
          )}
        </div>
      )}

      <div className="receiveTwoColumn">
      <section ref={receiveCustomerRef} className={`subPanel receiveCompactPanel ${receiveWarning?.target === "customer" || receiveWarning?.target === "address" ? "needsAttention" : ""}`}>
        <div className="collapsibleSectionHeader">
          <div>
            <h4>Customer</h4>
            <p>{selectedCustomer?.businessName || customerQuery || "No customer yet"}</p>
          </div>
          {receiveCollapseButton("customer", selectedCustomer?.businessName || customerQuery || "Open", ["customer", "address"])}
        </div>
        {!receiveSectionCollapsed("customer", ["customer", "address"]) && (
        <>
        {selectedCustomer && (
          <div className="selectedCard">
            <div>
              <strong>{selectedCustomer.businessName}</strong>
              <p>{selectedCustomer.status === "Pending" ? "Pending review - branch owner has not reviewed yet" : "Active customer"}</p>
              <p>{selectedCustomer.shippingAddress || selectedCustomer.address || selectedCustomer.billingAddress || "No default address saved"}</p>
            </div>
            <div className="rowActions">
              <span className={selectedCustomer.status === "Pending" ? "badge warning" : "badge"}>{selectedCustomer.status}</span>
              <button className="smallButton" onClick={() => {
                setSelectedCustomerId("");
                setCustomerQuery("");
                setSelectedSenderLabel("");
                setSenderName("");
                setSenderPhone("");
                setSenderCompany("");
                setSenderNotes("");
                setShowSenderDetails(false);
                setConsigneeName("");
                setSelectedConsigneeLabel("");
                setConsigneeType("Receiver");
                setShowConsigneeDetails(false);
                setDeliveryPhone("");
                setDeliveryBusinessName("");
                setAutoAddressNotice("");
                setReceiveMessage("Customer cleared. Type customer name to select again.");
              }}>Change</button>
            </div>
          </div>
        )}
        {!selectedCustomer && <AutocompleteField<BootstrapData["customers"][number]>
          value={customerQuery}
          placeholder="Type customer name"
          items={visibleCustomers}
          selectedLabel=""
          minChars={1}
          noResultsText="No company found. Tap Create Customer for Review."
          getLabel={(customer) => customer.businessName}
          getMeta={(customer) => customer.status}
          getSearchValues={(customer) => [customer.businessName, customer.tin, customer.companyPhone, customer.contactPerson, customer.phone]}
          onChange={(value) => {
            setCustomerQuery(value);
            if (selectedCustomerId) setSelectedCustomerId("");
          }}
          onSelect={(customer) => {
            setSelectedCustomerId(customer.id);
            setCustomerQuery(customer.businessName);
            setSenderName("");
            setSelectedSenderLabel("");
            setConsigneeName("");
            setSelectedConsigneeLabel("");
            setConsigneeType("Receiver");
            setShowConsigneeDetails(false);
            setAutoAddressNotice("");
            applyCustomerHistorySuggestions(customer, { replaceCurrent: true });
            setReceiveMessage(`${customer.businessName} selected. Recent receiver and address details were suggested when available.`);
          }}
        />}
        {canCreateNewCustomer && (
          <button
            className="actionButton"
            onClick={() => {
              setPendingCustomerName(customerNameToCreate);
              setShowPendingCustomerForm(true);
              setReceiveMessage("Enter new customer details. The selected branch owner will be notified for review.");
            }}
          >
            <PackagePlus /> Create Customer for Review
          </button>
        )}
        {showPendingCustomerForm && (
          <div className="subPanel">
            <div className="sectionHeader">
              <div>
                <h4>Customer for Review</h4>
                <p className="muted">Use only when the customer is not yet in the list. Operations may continue while the selected branch owner reviews it.</p>
              </div>
              <button className="smallButton" onClick={() => setShowPendingCustomerForm(false)}>Cancel</button>
            </div>
            <div className="formGrid">
              <label>Customer Name<input value={pendingCustomerName} onChange={(event) => setPendingCustomerName(event.target.value)} placeholder="Business or customer name" /></label>
              <label>Contact Person<input value={pendingContactPerson} onChange={(event) => setPendingContactPerson(event.target.value)} placeholder="Person in charge" /></label>
              <label>Phone<input value={pendingCustomerPhone} onChange={(event) => setPendingCustomerPhone(event.target.value)} placeholder="" /></label>
              <LongTextField label="Company Address" value={pendingCustomerAddress} onChange={(value) => {
                setPendingCustomerAddress(value);
                if (pendingShippingSameAsBilling) {
                  setPendingBillingAddress(value);
                  setPendingShippingAddress(value);
                }
              }} placeholder="Street, barangay, city/province" threshold={36} />
              <label className="checkboxLabel"><input type="checkbox" checked={pendingShippingSameAsBilling} onChange={(event) => {
                setPendingShippingSameAsBilling(event.target.checked);
                if (event.target.checked) {
                  setPendingBillingAddress(pendingCustomerAddress);
                  setPendingShippingAddress(pendingCustomerAddress);
                  setShowPendingAddressDetails(false);
                }
              }} /> Use company address for billing and shipping</label>
            </div>
            {!pendingShippingSameAsBilling && (
          <button className="smallButton" onClick={() => setShowPendingAddressDetails((value) => !value)}>
                {showPendingAddressDetails ? "Hide Details" : "Address Details"}
              </button>
            )}
            {showPendingAddressDetails && !pendingShippingSameAsBilling && (
              <div className="formGrid">
                <LongTextField label="Billing Address" value={pendingBillingAddress} onChange={setPendingBillingAddress} placeholder="Only if different" threshold={36} />
                <LongTextField label="Shipping Address" value={pendingShippingAddress} onChange={setPendingShippingAddress} placeholder="Only if different" threshold={36} />
              </div>
            )}
            <button
              className="actionButton"
              onClick={() => {
                if (!pendingCustomerName.trim()) {
                  setReceiveMessage("Enter the new customer name first.");
                  return;
                }
                if (!handlingBranchName.trim()) {
                  setReceiveMessage("Select the branch first so the correct branch owner is notified.");
                  return;
                }
                onAction("Create pending customer", async () => {
                  const customer = await apiPost<BootstrapData["customers"][number]>("/customers/pending", {
                    businessName: pendingCustomerName,
                    contactPerson: pendingContactPerson,
                    phone: pendingCustomerPhone,
                    address: pendingCustomerAddress,
                    billingAddress: pendingShippingSameAsBilling ? pendingCustomerAddress : pendingBillingAddress,
                    shippingAddress: pendingShippingSameAsBilling ? pendingCustomerAddress : pendingShippingAddress,
                    reviewBranchName: handlingBranchName,
                    notes: `Created during receiving for ${handlingBranchName} review`
                  });
                  setSelectedCustomerId(customer.id);
                  setCustomerQuery(customer.businessName);
                  setPendingCustomerName("");
                  setPendingContactPerson("");
                  setPendingCustomerPhone("");
                  setPendingCustomerAddress("");
                  setPendingBillingAddress("");
                  setPendingShippingAddress("");
                  setPendingShippingSameAsBilling(false);
                  setShowPendingAddressDetails(false);
                  setShowPendingCustomerForm(false);
                  setReceiveMessage(`${customer.businessName} created for ${handlingBranchName} owner review. Operations may continue.`);
                });
              }}
            >
              <PackagePlus /> Save Customer for Review
            </button>
          </div>
        )}
        <div className={`deliveryAreaBox ${receiveWarning?.target === "address" ? "needsAttention" : ""}`}>
          <h4>Delivery Area</h4>
          <LongTextField label="Area / Address Summary" value={deliverySummary} onChange={setDeliverySummary} placeholder="Example: Legazpi City, Albay" threshold={36} />
          {autoAddressNotice && <p className="muted">{autoAddressNotice}</p>}
          {customerAddressSuggestion && deliverySummary.trim() && deliverySummary !== customerAddressSuggestion.area && (
            <button className="smallButton" onClick={() => {
              setDeliverySummary(customerAddressSuggestion.area);
              setAddressLine(customerAddressSuggestion.addressLine);
              setBarangay(customerAddressSuggestion.barangay);
              setCity(customerAddressSuggestion.city);
              setProvince(customerAddressSuggestion.province);
              if (customerAddressSuggestion.phone) setDeliveryPhone(customerAddressSuggestion.phone);
              setAutoAddressNotice(`Delivery area filled from ${customerAddressSuggestion.source}. You can edit it.`);
            }}>Use Suggested Address</button>
          )}
	          <button className="smallButton" onClick={() => setShowAddressDetails((value) => !value)}>
	            {showAddressDetails ? "Hide Details" : "Address Details"}
	          </button>
	          {deliverySummary.trim() && (
	            <button className="smallButton" onClick={() => applyParsedAddress(deliverySummary, "address summary")}>
	              Split Address
	            </button>
	          )}
	          {showAddressDetails && (
            <div className="formGrid">
              <label>Store / Business<input value={deliveryBusinessName} onChange={(event) => setDeliveryBusinessName(event.target.value)} placeholder="" /></label>
              <label>Street / Building<input value={addressLine} onChange={(event) => setAddressLine(event.target.value)} placeholder="Street or building" /></label>
              <label>Barangay<input value={barangay} onChange={(event) => setBarangay(event.target.value)} /></label>
              <label>City / Municipality<input value={city} onChange={(event) => setCity(event.target.value)} /></label>
              <label>Province<input value={province} onChange={(event) => setProvince(event.target.value)} /></label>
              <label>Landmark<input value={landmark} onChange={(event) => setLandmark(event.target.value)} /></label>
              <label>Phone<input value={deliveryPhone} onChange={(event) => setDeliveryPhone(event.target.value)} /></label>
              <LongTextField label="Delivery Notes" value={deliveryNotes} onChange={setDeliveryNotes} threshold={36} />
            </div>
          )}
        </div>
        </>
        )}
      </section>

      <section ref={receivePeopleRef} className="subPanel receiveCompactPanel">
        <div className="collapsibleSectionHeader">
          <div>
            <h4>People</h4>
            <p>{[senderName || "No drop-off", consigneeName || "No receiver"].join(" / ")}</p>
          </div>
          {receiveCollapseButton("people", senderName || consigneeName || "Open")}
        </div>
        {!receiveSectionCollapsed("people") && (
        <>
        <h4>Drop-off Person</h4>
        <AutocompleteField
          value={senderName}
          placeholder="Type drop-off name"
          items={senderContactOptions}
          selectedLabel={selectedSenderLabel}
          noResultsText="No saved contact found. Add this drop-off person below."
          getLabel={(contact) => contact.name}
          getMeta={(contact) => `${contact.role} - ${contact.source}`}
          getSearchValues={(contact) => [contact.name, contact.phone, contact.role, contact.company, contact.notes, contact.source]}
          onChange={(value) => {
            setSenderName(value);
            if (selectedSenderLabel && selectedSenderLabel !== value) setSelectedSenderLabel("");
            if (showSenderDetails && !value.trim()) setShowSenderDetails(false);
          }}
          onSelect={(contact) => {
            setSenderName(contact.name);
            setSelectedSenderLabel(contact.name);
            setSenderPhone(contact.phone);
            setSenderType(contact.role);
            setSenderCompany(contact.company);
            setSenderNotes(contact.notes);
            setShowSenderDetails(false);
            setReceiveMessage(`${contact.name} selected as drop-off person.`);
          }}
        />
        {canAddDropOffPerson && (
          <button className="actionButton" onClick={() => {
            setShowSenderDetails(true);
            setSenderCompany(senderCompany || selectedCustomer?.businessName || "");
            setReceiveMessage("Enter drop-off person details. This will be saved with the receiving record.");
          }}>
            <PackagePlus /> Add New Drop-off Person
          </button>
        )}
        {showSenderDetails && (
          <div className="formGrid">
            <label>Phone<input value={senderPhone} onChange={(event) => setSenderPhone(event.target.value)} placeholder="Phone number" /></label>
            <label>Type<select value={senderType} onChange={(event) => setSenderType(event.target.value)}><option>Customer Contact</option><option>Sales Agent</option><option>Company Driver</option><option>Warehouse Staff</option><option>Third-party Driver</option><option>Owner</option><option>Other</option></select></label>
            <label>Company / Agency<input value={senderCompany} onChange={(event) => setSenderCompany(event.target.value)} placeholder="Company or agency" /></label>
            <LongTextField label="Notes" value={senderNotes} onChange={setSenderNotes} threshold={36} />
          </div>
        )}
        <h4>Receiver / Consignee</h4>
        <AutocompleteField
          value={consigneeName}
          placeholder="Type receiver name"
          items={consigneeContactOptions}
          selectedLabel={selectedConsigneeLabel}
          noResultsText="No saved receiver found. Add this receiver below."
          getLabel={(contact) => contact.name}
          getMeta={(contact) => `${contact.source}${contact.city ? ` - ${contact.city}` : ""}`}
          getSearchValues={(contact) => [contact.name, contact.phone, contact.role, contact.company, contact.notes, contact.addressLine, contact.barangay, contact.city, contact.province]}
          onChange={(value) => {
            setConsigneeName(value);
            if (selectedConsigneeLabel && selectedConsigneeLabel !== value) setSelectedConsigneeLabel("");
            if (showConsigneeDetails && !value.trim()) setShowConsigneeDetails(false);
          }}
          onSelect={(contact) => {
            setConsigneeName(contact.name);
            setSelectedConsigneeLabel(contact.name);
            setConsigneeType(contact.role || "Receiver");
            if (contact.phone) setDeliveryPhone(contact.phone);
            if (contact.company && !deliveryBusinessName) setDeliveryBusinessName(contact.company);
            if (contact.addressLine) {
              setAddressLine(contact.addressLine);
              setShowAddressDetails(true);
            }
            if (contact.barangay) setBarangay(contact.barangay);
            if (contact.city) {
              setCity(contact.city);
              setDeliverySummary(contact.city);
              setShowAddressDetails(true);
            }
            if (contact.province) setProvince(contact.province);
            setShowConsigneeDetails(false);
            setReceiveMessage(`${contact.name} selected as receiver/consignee.`);
          }}
        />
        {canAddConsigneeContact && (
          <button className="actionButton" onClick={() => {
            setShowConsigneeDetails(true);
            setConsigneeType("Receiver");
            setDeliveryBusinessName(deliveryBusinessName || selectedCustomer?.businessName || "");
            setReceiveMessage("Enter receiver details. This will be saved to the customer contact list.");
          }}>
            <PackagePlus /> Add New Receiver Contact
          </button>
        )}
        {showConsigneeDetails && (
          <div className="formGrid">
            <label>Phone<input value={deliveryPhone} onChange={(event) => setDeliveryPhone(event.target.value)} placeholder="Phone number" /></label>
            <label>Type<select value={consigneeType} onChange={(event) => setConsigneeType(event.target.value)}><option>Receiver</option><option>Consignee</option><option>Store Staff</option><option>Warehouse Staff</option><option>Sales Agent</option><option>Owner</option><option>Customer Contact</option><option>Other</option></select></label>
            <label>Company / Agency<input value={deliveryBusinessName} onChange={(event) => setDeliveryBusinessName(event.target.value)} placeholder="Company, store, or agency" /></label>
            <LongTextField label="Notes" value={deliveryNotes} onChange={setDeliveryNotes} threshold={36} />
            <button className="primaryButton" disabled={!consigneeNameToCreate} onClick={() => onAction("Add receiver contact", addConsigneeContactFromReceiving)}>
              Save Receiver Contact
            </button>
          </div>
        )}
        <div className="deliveryTypeBox">
          <h4>Delivery Type</h4>
          <label><select value={deliveryType} onChange={(event) => setDeliveryType(event.target.value)}><option>Deliver to consignee</option><option>Customer pickup at branch</option><option>Hold at branch</option><option>Return cargo</option></select></label>
        </div>
        </>
        )}
      </section>
      </div>

      <section ref={receiveItemRef} className={`subPanel receiveItemEntry ${receiveWarning?.target === "item" || receiveWarning?.target === "photo" ? "needsAttention" : ""}`}>
        <div className="sectionHeader">
          <div>
            <h4>Add Item</h4>
            <p className="muted">Type the product, SKU, or barcode. The side scanner fills this same field.</p>
          </div>
          {receiveCollapseButton("item", description || "Open", ["item", "photo"])}
        </div>

        {!receiveSectionCollapsed("item", ["item", "photo"]) && (
        <>
        <div className="itemEntryGrid">
          <div className="descriptionField">
            <AutocompleteField<ProductMaster>
              label="Product / SKU / Barcode"
              inputRef={barcodeInputRef}
              value={description}
              placeholder="Type product, SKU, or scan barcode"
              items={productMasters.filter((product) => product.status !== "Archived")}
              selectedLabel={productMasters.find((product) => product.name === description)?.name ?? ""}
              minChars={1}
              noResultsText="No saved product found. Type the new product name and continue."
              getLabel={(product) => product.name}
              getMeta={productMeta}
              getSearchValues={productSearchValues}
              getExactValues={(product) => [product.barcode, product.sku, product.name]}
              onChange={(value) => {
                setDescription(value);
                setBarcode(value);
                setProductSku("");
                if (value.trim().length <= 42) setShowProductDescriptionEditor(false);
                if (!value.trim()) {
                  setBarcode("");
                  setProductSku("");
                  setShowProductDescriptionEditor(false);
                  setProductBrand("");
                  setProductCategory("General Merchandise");
                  setProductDefaultPrice("");
                }
              }}
              onSelect={selectProductMaster}
              onInputEnter={(value, suggestions) => {
                if (suggestions.length > 1) {
                  setReceiveMessage("Multiple products found. Tap the correct product from the list.");
                  return;
                }
                setBarcode(value);
                setReceiveMessage("No exact saved product found. Continue as a new item or tap a suggestion.");
              }}
            />
            {description.trim() && (productDescriptionIsLong || showProductDescriptionEditor) && (
              <div className="longTextEditBox">
                <div className="longTextEditHeader">
                  <span>{productDescriptionIsLong ? "Long product name" : "Product name"}</span>
                  <button className="textButton" type="button" onClick={() => setShowProductDescriptionEditor((value) => !value)}>
                    {showProductDescriptionEditor ? "Done" : "Edit Full"}
                  </button>
                </div>
                {showProductDescriptionEditor ? (
                  <textarea
                    value={description}
                    onChange={(event) => {
                  setDescription(event.target.value);
                  setBarcode(event.target.value);
                  setProductSku("");
                    }}
                    rows={3}
                    placeholder="Edit full product description"
                  />
                ) : (
                  <button className="longTextPreview" type="button" onClick={() => setShowProductDescriptionEditor(true)}>
                    {description}
                  </button>
                )}
              </div>
            )}
          </div>
          <label>Qty<input value={quantity} onChange={(event) => setQuantity(event.target.value)} inputMode="decimal" /></label>
          <label>Unit<select value={unit} onChange={(event) => setUnit(event.target.value)}><option>pcs</option><option>package</option><option>bundle</option><option>sack</option><option>box</option><option>roll</option><option>length</option><option>kg</option><option>set</option><option>custom</option></select></label>
          <label>Condition<select value={condition} onChange={(event) => setCondition(event.target.value)}><option>Good</option><option>Damaged</option><option>Wet</option><option>Incomplete</option><option>For Checking</option><option>Other</option></select></label>
          <label>Unit Price<input type="number" min="0" step="0.01" value={price} onChange={(event) => {
            autoFilledPriceRef.current = null;
            setPrice(event.target.value);
          }} placeholder="Auto if history exists" /></label>
        </div>
        {price && calculateLineTotal(price, quantity) && (
          <p className="muted lineTotalHint">Line total: PHP {formatReceivingMoney(calculateLineTotal(price, quantity))} ({quantity || 0} {unit} x PHP {formatReceivingMoney(price)})</p>
        )}
        {priceSuggestion && (
          <div className="priceSuggestionBox">
            <div>
              <strong>{priceSuggestion.suggestedPrice == null ? "No historical unit price found" : `Auto unit price PHP ${formatReceivingMoney(priceSuggestion.suggestedPrice)}`}</strong>
              <p>{priceSuggestion.suggestedPrice == null ? "Unit price stays blank. Staff may enter it manually." : priceSuggestion.reason}</p>
              {priceSuggestion.warnings.length > 0 && <p>{priceSuggestion.warnings.join(" ")}</p>}
            </div>
          </div>
        )}
        <button className="smallButton measurementToggle" onClick={() => setShowMeasurementDetails((value) => !value)}>
          {showMeasurementDetails ? "Hide Weight / Size" : "Add Weight / Size"}
        </button>
        {showMeasurementDetails && (
          <div className="measurementGrid">
            <label>Weight<input type="number" min="0" step="0.01" inputMode="decimal" value={weight} onChange={(event) => setWeight(event.target.value)} placeholder="Example: 12.5" /></label>
            <label>Weight Unit<select value={weightUnit} onChange={(event) => setWeightUnit(event.target.value)}><option>kg</option><option>g</option><option>ton</option><option>lb</option></select></label>
            <label>Length<input type="number" min="0" step="0.01" inputMode="decimal" value={lengthValue} onChange={(event) => setLengthValue(event.target.value)} placeholder="L" /></label>
            <label>Width<input type="number" min="0" step="0.01" inputMode="decimal" value={widthValue} onChange={(event) => setWidthValue(event.target.value)} placeholder="W" /></label>
            <label>Height<input type="number" min="0" step="0.01" inputMode="decimal" value={heightValue} onChange={(event) => setHeightValue(event.target.value)} placeholder="H" /></label>
            <label>Size Unit<select value={dimensionUnit} onChange={(event) => setDimensionUnit(event.target.value)}><option>cm</option><option>m</option><option>inch</option><option>ft</option></select></label>
          </div>
        )}
        <div className="itemActionRow">
          <button className="actionButton secondaryItemAction" onClick={() => void capturePhotoOrOpenPicker(productPhotoInputRef, `item-photo-${Date.now()}.jpg`, (file) => onAction("Upload product photo", () => attachCurrentProductPhoto(file)))}><Camera /> Item Image</button>
          <button className="primaryButton addItemButton" onClick={addProductLine}><PackagePlus /> Add Item</button>
        </div>
        {photoUrl && <p className="muted">Product photo attached to this item.</p>}
        <button className="smallButton clearItemButton" onClick={clearCurrentProduct}><ClipboardList size={16} /> Clear</button>
        </>
        )}
      </section>

      <section className="subPanel receiveItemsPanel">
        <div className="sectionHeader">
          <div>
            <h4>Items Added</h4>
            <p className="muted">{draftSaveStatus || "Items are auto-saved after they are added."}</p>
          </div>
          {receiveCollapseButton("itemsAdded", `${productLines.length} item${productLines.length === 1 ? "" : "s"}`)}
        </div>
        {!receiveSectionCollapsed("itemsAdded") && (
        <div className="list">
          {productLines.map((line, index) => (
            <div className="receiveLineRow" key={line.tempId}>
              <span className="lineIndex">{index + 1}</span>
              <button className="lineMain" onClick={() => editProductLine(line)} aria-label={`Edit ${line.description}`}>
                <strong>{line.description}</strong>
                <span>{line.quantity} {line.unit} · {line.condition} · {line.handlingBranchName}</span>
              </button>
              <span className="linePrice">
                {line.price ? `PHP ${formatReceivingMoney(line.price)}` : "No price"}
              </span>
              <span className="lineMeta">
                {formatMeasurements(line) || (line.photoUrl ? "Photo" : "No size")}
              </span>
              <button className="lineRemoveButton" aria-label={`Remove ${line.description}`} onClick={() => {
                  if (!window.confirm(`Remove ${line.description} from this receiving?`)) return;
                  setProductLines((items) => items.filter((item) => item.tempId !== line.tempId));
                  setReceiveMessage(`${line.description} removed. Draft will auto-save.`);
                }}>
                <X size={16} />
              </button>
            </div>
          ))}
          {!productLines.length && <p className="muted">No items added yet. Type or scan a product, then tap Add Item.</p>}
        </div>
        )}
      </section>

      <section ref={receivePaymentRef} className={`subPanel receivePaymentPanel ${receiveWarning?.target === "payment" ? "needsAttention" : ""}`}>
        <div className="sectionHeader">
          <div>
            <h4>Payment at Receiving</h4>
            <p className="muted">Operational collection only. Default is unpaid.</p>
          </div>
          <div className="headerActionGroup">
            <span className="badge">Due PHP {formatReceivingMoney(receivingAmountDue)}</span>
            {receiveCollapseButton("payment", receivingPaymentStatus, ["payment"])}
          </div>
        </div>
        {!receiveSectionCollapsed("payment", ["payment"]) && (
        <>
        <div className="segmentedControl paymentStatusControl">
          {(["Unpaid", "Paid", "Partial", "Advance Payment"] as const).map((status) => (
            <button
              key={status}
              className={receivingPaymentStatus === status ? "active" : ""}
              onClick={() => {
                setReceivingPaymentStatus(status);
                if (status === "Unpaid") {
                  setReceivingAmountPaid("");
                  setReceivingPaymentReference("");
                  setReceivingPaymentProofUrl("");
                }
                if (status === "Paid") setReceivingAmountPaid(receivingAmountDue ? String(receivingAmountDue) : "");
              }}
            >
              {status === "Advance Payment" ? "Advance" : status}
            </button>
          ))}
        </div>
        {showReceivingPaymentDetails && (
          <div className="formGrid paymentFormGrid">
            <label>Amount Paid<input type="number" min="0" step="0.01" inputMode="decimal" value={receivingAmountPaid} onChange={(event) => setReceivingAmountPaid(event.target.value)} placeholder="0.00" /></label>
            <label>Balance<input value={`PHP ${formatReceivingMoney(receivingPaymentBalance)}`} readOnly /></label>
            <label>Payment Method<select value={receivingPaymentMethod} onChange={(event) => setReceivingPaymentMethod(event.target.value)}>{(paymentMethods.length ? paymentMethods : ["Cash", "GCash", "Bank Transfer", "Check", "Other"]).map((method) => <option key={method}>{method}</option>)}</select></label>
            <label>Reference<input value={receivingPaymentReference} onChange={(event) => setReceivingPaymentReference(event.target.value)} placeholder="Reference no." /></label>
            <LongTextField className="fullSpan" label="Notes" value={receivingPaymentNotes} onChange={setReceivingPaymentNotes} placeholder="Payment note" threshold={36} />
            <button className="actionButton fullSpan" onClick={() => void capturePhotoOrOpenPicker(receivingPaymentProofInputRef, `receiving-payment-proof-${Date.now()}.jpg`, (file) => onAction("Upload receiving payment proof", () => attachReceivingPaymentProof(file)))}><Camera /> Add Proof Image</button>
            <input
              ref={receivingPaymentProofInputRef}
              className="hiddenInput"
              type="file"
              accept="image/*"
              onChange={(event) => {
                const inputElement = event.currentTarget;
                const file = event.target.files?.[0];
                if (!file) return;
                void onAction("Upload receiving payment proof", async () => {
                  await attachReceivingPaymentProof(file, inputElement);
                });
              }}
            />
            {receivingPaymentProofUrl && <p className="muted fullSpan">Proof photo attached.</p>}
          </div>
        )}
        </>
        )}
      </section>

      <p className="receiveActionFeedback">{receiveMessage}</p>
      <button
        ref={receiveSaveRef}
        className="primaryButton receiveBottomAction"
        disabled={!productsToSave.length}
        onClick={prepareReceivingConfirmation}
      >
        <span>{productsToSave.length ? "Save Receiving" : "Add Item First"}</span>
        <small>{customerDrNumber ? `DR ${customerDrNumber}` : "No DR number"} - {productsToSave.length} item{productsToSave.length === 1 ? "" : "s"} - 1 receipt</small>
      </button>

      {confirmReceivingOpen && (
        <div className="modalLayer" role="dialog" aria-label="Confirm receiving branch">
          <div className="modalBackdrop" aria-hidden="true" />
          <section className="modalPanel reviewReceivingPanel">
            <div className="sectionHeader">
              <div>
                <h3>Review Receiving</h3>
                <p className="muted">Check details before saving. Use Edit if something is wrong.</p>
              </div>
              <button className="smallButton" onClick={() => setConfirmReceivingOpen(false)}>Back</button>
            </div>
            <div className="reviewActionRow">
              <button className="actionButton" onClick={() => {
                setConfirmReceivingOpen(false);
                receiveCustomerRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
              }}>Edit Details</button>
              <button className="actionButton" onClick={() => {
                setConfirmReceivingOpen(false);
                receiveItemRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
                window.setTimeout(() => barcodeInputRef.current?.focus(), 80);
              }}>Edit Items</button>
            </div>
            <div className="grid accountInfoGrid">
              <div className="settingTile"><span>Customer</span><strong>{selectedCustomer?.businessName ?? getTypedCustomerMatch()?.businessName ?? customerQuery}</strong></div>
              <div className="settingTile"><span>Items</span><strong>{productsToSave.length}</strong></div>
              <div className="settingTile"><span>Customer DR</span><strong>{customerDrNumber || "Auto / not provided"}</strong></div>
              <div className="settingTile"><span>Photo</span><strong>{drPhotoUrl ? "Attached" : "No DR photo"}</strong></div>
              <div className="settingTile"><span>Receiver</span><strong>{productsToSave[0]?.consigneeName || consigneeName || "Not set"}</strong></div>
              <div className="settingTile"><span>Area</span><strong>{productsToSave[0]?.deliveryNotes || deliverySummary || "Not set"}</strong></div>
              <div className="settingTile"><span>Payment</span><strong>{receivingPaymentStatus}</strong></div>
              <div className="settingTile"><span>Paid</span><strong>PHP {formatReceivingMoney(receivingAmountPaid || 0)}</strong></div>
            </div>
            <section className="subPanel reviewItemsPanel">
              <div className="sectionHeader">
                <div>
                  <h4>Items to Save</h4>
                  <p className="muted">One receiving receipt will include all lines below.</p>
                </div>
                <span className="badge">PHP {formatReceivingMoney(receivingAmountDue)}</span>
              </div>
              <div className="list compactList">
                {productsToSave.slice(0, 5).map((line, index) => (
                  <div className="row compactDataRow" key={`${line.tempId}-${index}`}>
                    <div>
                      <strong>{line.description}</strong>
                      <p>{line.quantity} {line.unit} - {line.handlingBranchName} - {line.condition}</p>
                      {(line.productSku || line.productBarcode) && <p className="muted">{[line.productSku ? `SKU ${line.productSku}` : "", line.productBarcode ? `Code ${line.productBarcode}` : ""].filter(Boolean).join(" / ")}</p>}
                    </div>
                    <span className="badge">{line.price ? `PHP ${formatReceivingMoney(line.price)}` : "No Price"}</span>
                  </div>
                ))}
                {productsToSave.length > 5 && <p className="muted">+ {productsToSave.length - 5} more item line{productsToSave.length - 5 === 1 ? "" : "s"}.</p>}
              </div>
            </section>
            <div className="list">
              {Object.entries(productBranchCounts).map(([branch, count]) => (
                <div className="row" key={branch}>
                  <PackagePlus size={20} />
                  <div>
                    <strong>{branch}</strong>
                    <p>{count} item{count === 1 ? "" : "s"} will be recorded for this branch.</p>
                  </div>
                  <span className="badge">{branch === activeBranchContext ? "Active profile" : "Changed line"}</span>
                </div>
              ))}
            </div>
            {Object.keys(productBranchCounts).length > 1 && (
              <p className="notice">This receiving document has items for more than one branch. Loading must validate each package again.</p>
            )}
            <button className="primaryButton" onClick={() => void submitReceivingDocument()}>
              Save Receiving
            </button>
          </section>
        </div>
      )}

      </section>
        </>
      )}
    </div>
  );
}

function Packages({
  packages,
  trips,
  receiptPreview,
  setReceiptPreview,
  onAction
}: {
  packages: CargoPackage[];
  trips: Trip[];
  receiptPreview: string;
  setReceiptPreview: (value: string) => void;
  onAction: <T>(label: string, action: () => Promise<T>) => Promise<void>;
}) {
  const [mode, setMode] = useState<"home" | "records">("home");
  const [selectedPackage, setSelectedPackage] = useState("");
  const [price, setPrice] = useState("350");
  const [priceEditorOpen, setPriceEditorOpen] = useState(false);
  const [measurementEditorOpen, setMeasurementEditorOpen] = useState(false);
  const [cargoWeight, setCargoWeight] = useState("");
  const [cargoWeightUnit, setCargoWeightUnit] = useState("kg");
  const [cargoLength, setCargoLength] = useState("");
  const [cargoWidth, setCargoWidth] = useState("");
  const [cargoHeight, setCargoHeight] = useState("");
  const [cargoDimensionUnit, setCargoDimensionUnit] = useState("cm");
  const [measurementReason, setMeasurementReason] = useState("Loading measurement update");
  const [qrOpen, setQrOpen] = useState(false);
  const [cargoSearch, setCargoSearch] = useState("");
  const [cargoStatusFilter, setCargoStatusFilter] = useState<"Action" | "Waiting" | "Moving" | "Delivery" | "Done" | "Issue" | "All">("Action");
  const [cargoListLimit, setCargoListLimit] = useState(LIST_PAGE_SIZE);
  const selectedCargo = packages.find((pkg) => pkg.id === selectedPackage);
  const selectedTrip = selectedCargo ? trips.find((trip) => trip.cargoPackageIds.includes(selectedCargo.id)) : undefined;
  const selectedCargoWeightKg = selectedCargo ? packageWeightKg(selectedCargo) : 0;
  const selectedCargoVolumeCbm = selectedCargo ? packageVolumeCbm(selectedCargo) : 0;
  const selectedCargoVolumetricWeightKg = selectedCargo ? packageVolumetricWeightKg(selectedCargo) : 0;
  const cargoFilterOptions = [
    { key: "Action", label: "Action" },
    { key: "Waiting", label: "Waiting" },
    { key: "Moving", label: "Moving" },
    { key: "Delivery", label: "Delivery" },
    { key: "Done", label: "Done" },
    { key: "Issue", label: "Issue" },
    { key: "All", label: "All" }
  ] as const;
  const cargoNeedsAction = (pkg: CargoPackage) =>
    pkg.price == null ||
    !hasLoadingMeasurements(pkg) ||
    ["Arrived", "Failed Delivery", "Exception", "Waiting for Price"].includes(pkg.status);
  const cargoMatchesFilter = (pkg: CargoPackage, filter: typeof cargoStatusFilter) => {
    if (filter === "All") return true;
    if (filter === "Action") return cargoNeedsAction(pkg);
    if (filter === "Waiting") return ["Waiting for Loading", "Received", "Waiting for Price"].includes(pkg.status);
    if (filter === "Moving") return ["Loaded", "In Transit"].includes(pkg.status);
    if (filter === "Delivery") return ["Arrived", "Ready for Delivery"].includes(pkg.status);
    if (filter === "Done") return pkg.status === "Delivered";
    if (filter === "Issue") return ["Failed Delivery", "Exception", "Cancelled"].includes(pkg.status);
    return true;
  };
  const cargoFilterCount = (filter: typeof cargoStatusFilter) => packages.filter((pkg) => cargoMatchesFilter(pkg, filter)).length;
  const visibleCargoRecords = packages
    .filter((pkg) => cargoMatchesFilter(pkg, cargoStatusFilter))
    .filter((pkg) => matchesSearch([
      pkg.packageNumber,
      pkg.qrValue,
      pkg.receivingRecordNumber,
      pkg.customerName,
      pkg.description,
      pkg.consigneeName,
      pkg.destination,
      pkg.handlingBranchName,
      pkg.status,
      pkg.price
    ], cargoSearch));
  const displayedCargoRecords = visibleCargoRecords.slice(0, cargoListLimit);
  const cargoNextAction = (pkg: CargoPackage) => {
    if (pkg.status === "Cancelled") return "Review cancelled record";
    if (pkg.price == null) return "Set price";
    if (!hasLoadingMeasurements(pkg)) return "Add weight/size";
    if (["Waiting for Loading", "Received"].includes(pkg.status)) return "Ready for loading";
    if (["Loaded", "In Transit"].includes(pkg.status)) return "Track trip";
    if (pkg.status === "Arrived") return "Verify at branch";
    if (pkg.status === "Ready for Delivery") return "Deliver / collect";
    if (pkg.status === "Failed Delivery") return "Return or reschedule";
    if (pkg.status === "Exception") return "Owner review";
    if (pkg.status === "Delivered") return "Completed";
    return "Review";
  };

  useEffect(() => {
    if (!selectedCargo) return;
    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverscroll = document.documentElement.style.overscrollBehavior;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overscrollBehavior = "none";
    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overscrollBehavior = previousHtmlOverscroll;
    };
  }, [selectedCargo]);

  useEffect(() => {
    setCargoListLimit(LIST_PAGE_SIZE);
  }, [cargoSearch, cargoStatusFilter]);

  function openCargo(pkg: CargoPackage) {
    setSelectedPackage(pkg.id);
    setPrice(pkg.price == null ? "" : String(pkg.price));
    setPriceEditorOpen(pkg.price == null);
    setMeasurementEditorOpen(!hasLoadingMeasurements(pkg));
    setCargoWeight(pkg.weight == null ? "" : String(pkg.weight));
    setCargoWeightUnit(pkg.weightUnit ?? "kg");
    setCargoLength(pkg.length == null ? "" : String(pkg.length));
    setCargoWidth(pkg.width == null ? "" : String(pkg.width));
    setCargoHeight(pkg.height == null ? "" : String(pkg.height));
    setCargoDimensionUnit(pkg.dimensionUnit ?? "cm");
    setMeasurementReason("Loading measurement update");
    setQrOpen(false);
  }

  function openCargoRecords(filter: typeof cargoStatusFilter) {
    setCargoStatusFilter(filter);
    setMode("records");
  }

  return (
    <div className="stack">
      {mode === "home" && (
        <ModuleTileLauncher
          eyebrow="Cargo"
          title="What do you want to do?"
          description="Find cargo, fix missing details, view movement, and print documents."
          actions={[
            { key: "action", label: "Action Needed", note: "Price, size, issues", icon: AlertTriangle, count: cargoFilterCount("Action"), tone: cargoFilterCount("Action") > 0 ? "dark" : "light", onClick: () => openCargoRecords("Action") },
            { key: "waiting", label: "Waiting", note: "Ready for loading", icon: QrCode, count: cargoFilterCount("Waiting"), tone: cargoFilterCount("Waiting") > 0 ? "dark" : "light", onClick: () => openCargoRecords("Waiting") },
            { key: "moving", label: "Moving", note: "Loaded or transit", icon: Truck, count: cargoFilterCount("Moving"), tone: cargoFilterCount("Moving") > 0 ? "medium" : "light", onClick: () => openCargoRecords("Moving") },
            { key: "delivery", label: "Delivery", note: "Arrived / ready", icon: CheckCircle2, count: cargoFilterCount("Delivery"), tone: cargoFilterCount("Delivery") > 0 ? "medium" : "light", onClick: () => openCargoRecords("Delivery") },
            { key: "issue", label: "Issues", note: "Failed or exception", icon: X, count: cargoFilterCount("Issue"), tone: cargoFilterCount("Issue") > 0 ? "dark" : "light", onClick: () => openCargoRecords("Issue") },
            { key: "all", label: "All Cargo", note: `${cargoFilterCount("All")} records`, icon: ClipboardList, count: cargoFilterCount("All"), tone: "light", onClick: () => openCargoRecords("All") }
          ]}
        />
      )}
      {mode === "records" && (
      <section className="panel">
        <div className="sectionHeader">
          <div>
            <h3>Cargo Records</h3>
            <p className="muted">Find cargo, fix missing details, view movement, and print documents.</p>
          </div>
          <button className="smallButton" onClick={() => setMode("home")}>Back</button>
        </div>
        <label>Search Cargo<input value={cargoSearch} onChange={(event) => setCargoSearch(event.target.value)} placeholder="Package, customer, item, DR, branch" /></label>
        <div className="statusFilterStrip">
          {cargoFilterOptions.map((filter) => (
            <button
              className={cargoStatusFilter === filter.key ? "statusFilterButton active" : "statusFilterButton"}
              key={filter.key}
              onClick={() => setCargoStatusFilter(filter.key)}
              type="button"
            >
              <span>{filter.label}</span>
              <strong>{cargoFilterCount(filter.key)}</strong>
            </button>
          ))}
        </div>
        <div className="list compactList">
          {displayedCargoRecords.map((pkg) => (
            <button className="row tappableRow compactDataRow cargoListRow" key={pkg.id} onClick={() => openCargo(pkg)}>
              <div>
                <strong>{pkg.description}</strong>
                <p>{pkg.customerName} / {pkg.packageNumber}</p>
                <p className="muted">{pkg.handlingBranchName ?? pkg.destination} / {cargoNextAction(pkg)}</p>
              </div>
              <div className="compactRowMeta cargoListMeta">
                <span className="badge">{pkg.status}</span>
                <span className={pkg.price == null ? "badge warning" : "badge"}>{pkg.price == null ? "No Price" : `PHP ${pkg.price}`}</span>
              </div>
            </button>
          ))}
          {!visibleCargoRecords.length && <p className="muted">No cargo found for this filter.</p>}
          {visibleCargoRecords.length > displayedCargoRecords.length && (
            <button className="loadMoreButton" type="button" onClick={() => setCargoListLimit((limit) => limit + LIST_PAGE_SIZE)}>
              Show more cargo ({visibleCargoRecords.length - displayedCargoRecords.length} left)
            </button>
          )}
        </div>
      </section>
      )}
      {selectedCargo && (
        <div className="modalLayer" role="dialog" aria-label="Cargo details">
          <div className="modalBackdrop" aria-hidden="true" />
          <section className="modalPanel">
            <div className="sectionHeader">
              <div>
                <h3>{selectedCargo.description}</h3>
                <p className="muted">{selectedCargo.packageNumber} - {selectedCargo.customerName}</p>
              </div>
              <div className="headerActionGroup">
                <span className="badge">{selectedCargo.status}</span>
                <button className="smallButton" onClick={() => setSelectedPackage("")}>Close</button>
              </div>
            </div>
            <section className="subPanel">
              <div className="notice">
                <strong>Next action: {cargoNextAction(selectedCargo)}</strong>
                <p className="muted">{selectedCargo.status === "Delivered" ? "Cargo is closed. Use documents or audit for review." : "Use only the section needed below. Every change is audited."}</p>
              </div>
              <div className="sectionHeader">
                <div>
                  <h4>{selectedCargo.price == null ? "Price needed before loading" : `Price: PHP ${selectedCargo.price.toLocaleString()}`}</h4>
                  <p className="muted">Update only if price changed or was missing.</p>
                </div>
                <button className="smallButton" onClick={() => setPriceEditorOpen((current) => !current)}>{priceEditorOpen ? "Hide" : "Edit Price"}</button>
              </div>
              {priceEditorOpen && (
                <div className="stack">
                  <div className="formGrid">
                    <label>Unit Price<input inputMode="decimal" value={price} onChange={(event) => setPrice(event.target.value.replace(/[^\d.]/g, ""))} placeholder="Enter price" /></label>
                  </div>
                  <button className="primaryButton" disabled={!price} onClick={() => onAction("Update price", () => apiPatch(`/packages/${selectedCargo.id}/price`, { price: Number(price), reason: "Manual cargo update" }))}>Save Price</button>
                </div>
              )}
              <div className="buttonGrid two">
                <button
                  className="actionButton"
                  onClick={() =>
                    onAction("Load receiving slip", async () => {
                      const result = await apiGet<{ text: string }>(`/packages/${selectedCargo.id}/receiving-slip`);
                      setReceiptPreview(result.text);
                    })
                  }
                >
                  <Printer size={18} />
                  Preview Slip
                </button>
                <button
                  className="actionButton"
                  onClick={() =>
                    onAction("Load QR label", async () => {
                      const result = await apiGet<{ text: string }>(`/packages/${selectedCargo.id}/qr-label`);
                      setReceiptPreview(result.text);
                    })
                  }
                >
                  <QrCode size={18} />
                  Preview Label
                </button>
              </div>
            </section>
            <section className="subPanel">
              <h4>Details</h4>
              <div className="detailGrid compactDetailGrid">
                <div><span>Receiving</span><strong>{selectedCargo.receivingRecordNumber}</strong></div>
                <div><span>Branch</span><strong>{selectedCargo.handlingBranchName ?? selectedCargo.destination}</strong></div>
                <div><span>Consignee</span><strong>{selectedCargo.consigneeName ?? "Not set"}</strong></div>
                <div><span>Quantity</span><strong>{selectedCargo.quantity ?? 1} {selectedCargo.unit ?? "pcs"}</strong></div>
                <div><span>Condition</span><strong>{selectedCargo.condition}</strong></div>
              </div>
              <button className="smallButton" onClick={() => setQrOpen((current) => !current)}>{qrOpen ? "Hide QR Value" : "Show QR Value"}</button>
              {qrOpen && <p className="notice">{selectedCargo.qrValue}</p>}
            </section>
            <section className="subPanel">
              <div className="sectionHeader">
                <div>
                  <h4>{hasLoadingMeasurements(selectedCargo) ? "Measurements Ready" : "Measurements Needed Before Loading"}</h4>
                  <p className="muted">Weight and dimensions are required before loading so trip totals are accurate.</p>
                </div>
                <button className="smallButton" onClick={() => setMeasurementEditorOpen((current) => !current)}>{measurementEditorOpen ? "Hide" : "Edit"}</button>
              </div>
              {!measurementEditorOpen && (
                <div className="measurementSummary">
                  <div><span>Weight</span><strong>{selectedCargo.weight == null ? "Missing" : `${selectedCargo.weight} ${selectedCargo.weightUnit ?? "kg"}`}</strong></div>
                  <div><span>Size</span><strong>{[selectedCargo.length, selectedCargo.width, selectedCargo.height].some((value) => value != null) ? `${selectedCargo.length ?? "?"} x ${selectedCargo.width ?? "?"} x ${selectedCargo.height ?? "?"} ${selectedCargo.dimensionUnit ?? "cm"}` : "Missing"}</strong></div>
                  <div><span>Vol. Wt.</span><strong>{selectedCargoVolumetricWeightKg ? `${formatNumber(selectedCargoVolumetricWeightKg)} kg` : "Missing"}</strong></div>
                </div>
              )}
              {measurementEditorOpen && (
                <div className="stack">
                  <div className="measurementEditor">
                    <div className="measurementRow">
                      <div className="measurementField">
                        <span>Weight</span>
                        <input type="number" min="0" step="0.01" inputMode="decimal" value={cargoWeight} onChange={(event) => setCargoWeight(event.target.value)} placeholder="12.5" />
                      </div>
                      <div className="measurementUnit">
                        <span>Unit</span>
                        <select value={cargoWeightUnit} onChange={(event) => setCargoWeightUnit(event.target.value)}><option>kg</option><option>g</option><option>ton</option><option>lb</option></select>
                      </div>
                    </div>
                    <div className="dimensionRow">
                      <div className="measurementField">
                        <span>L</span>
                        <input type="number" min="0" step="0.01" inputMode="decimal" value={cargoLength} onChange={(event) => setCargoLength(event.target.value)} placeholder="L" />
                      </div>
                      <div className="measurementField">
                        <span>W</span>
                        <input type="number" min="0" step="0.01" inputMode="decimal" value={cargoWidth} onChange={(event) => setCargoWidth(event.target.value)} placeholder="W" />
                      </div>
                      <div className="measurementField">
                        <span>H</span>
                        <input type="number" min="0" step="0.01" inputMode="decimal" value={cargoHeight} onChange={(event) => setCargoHeight(event.target.value)} placeholder="H" />
                      </div>
                      <div className="measurementUnit">
                        <span>Unit</span>
                        <select value={cargoDimensionUnit} onChange={(event) => setCargoDimensionUnit(event.target.value)}><option>cm</option><option>m</option><option>inch</option><option>ft</option></select>
                      </div>
                    </div>
                    <LongTextField className="measurementReasonField wide" label="Reason" value={measurementReason} onChange={setMeasurementReason} placeholder="Required audit reason" threshold={36} />
                  </div>
                  <button
                    className="primaryButton"
                    disabled={!cargoWeight || !cargoLength || !cargoWidth || !cargoHeight || !measurementReason.trim()}
                    onClick={() => onAction("Save cargo measurements", () => apiPatch(`/packages/${selectedCargo.id}/measurements`, {
                      weight: Number(cargoWeight),
                      weightUnit: cargoWeightUnit,
                      length: Number(cargoLength),
                      width: Number(cargoWidth),
                      height: Number(cargoHeight),
                      dimensionUnit: cargoDimensionUnit,
                      reason: measurementReason
                    }))}
                  >
                    Save Measurements
                  </button>
                </div>
              )}
            </section>
            <section className="subPanel">
              <h4>Movement</h4>
              {selectedTrip ? (
                <div className="detailGrid compactDetailGrid">
                  <div><span>Trip</span><strong>{selectedTrip.tripNumber}</strong></div>
                  <div><span>Trip Status</span><strong>{selectedTrip.status}</strong></div>
                  <div><span>Origin</span><strong>{selectedTrip.origin}</strong></div>
                  <div><span>Destination</span><strong>{selectedTrip.destination}</strong></div>
                  <div><span>Plate Number</span><strong>{selectedTrip.plateNumber ?? selectedTrip.vehicleDescription ?? "Not set"}</strong></div>
                  <div><span>Driver</span><strong>{selectedTrip.driverName ?? "Not set"}</strong></div>
                  <div><span>Contact</span><strong>{selectedTrip.driverContactNumber ?? "Not set"}</strong></div>
                  <div><span>Owner / Provider</span><strong>{selectedTrip.truckOwnerName ?? "Not set"}</strong></div>
                  <div><span>Trip Type</span><strong>{selectedTrip.isMixedTrip ? "Mixed trip" : "Regular trip"}</strong></div>
                  <div><span>Cargo Count</span><strong>{selectedTrip.cargoPackageIds.length} item{selectedTrip.cargoPackageIds.length === 1 ? "" : "s"}</strong></div>
                </div>
              ) : (
                <p className="notice">Not loaded to a truck yet. Trucking details will appear here after loading in Trips.</p>
              )}
            </section>
          </section>
        </div>
      )}
    </div>
  );
}

function Trips({
  packages,
  loadablePackages,
  trips,
  trucks,
  activeUserRole,
  setReceiptPreview,
  onAction,
  queueablePost
}: {
  packages: CargoPackage[];
  loadablePackages: CargoPackage[];
  trips: Trip[];
  trucks: BootstrapData["trucks"];
  activeUserRole: string;
  setReceiptPreview: (value: string) => void;
  onAction: <T>(label: string, action: () => Promise<T>) => Promise<void>;
  queueablePost: QueueablePost;
}) {
  const [mode, setMode] = useState<"home" | "create" | "active" | "records" | "trucks" | "returns">("home");
  const [destination, setDestination] = useState("Daet");
  const [plateNumber, setPlateNumber] = useState("");
  const [driverName, setDriverName] = useState("");
  const [driverContactNumber, setDriverContactNumber] = useState("");
  const [truckOwnerName, setTruckOwnerName] = useState("");
  const [selectedPackage, setSelectedPackage] = useState("");
  const [selectedTripId, setSelectedTripId] = useState("");
  const [tripStatusFilter, setTripStatusFilter] = useState<"Loading" | "Planned" | "Departed" | "Arrived" | "Cancelled">(
    activeUserRole === "Receiving Staff" ? "Loading" : activeUserRole === "Delivery Staff" || activeUserRole === "Delivery Admin" ? "Departed" : "Loading"
  );
  const [tripListLimit, setTripListLimit] = useState(LIST_PAGE_SIZE);
  const [cargoSearch, setCargoSearch] = useState("");
  const [tripStatus, setTripStatus] = useState("Select cargo and confirm loading. Branch mismatch will ask for confirmation.");
  const loadingPhotoInputRef = useRef<HTMLInputElement | null>(null);
  const cargoSearchInputRef = useRef<HTMLInputElement | null>(null);
  const packageById = new Map(packages.map((pkg) => [pkg.id, pkg]));
  const activeTrips = trips.filter((trip) => !["Completed", "Cancelled"].includes(trip.status));
  const activeTrip = selectedTripId ? trips.find((trip) => trip.id === selectedTripId) : undefined;
  const tripRecords = [...trips].reverse();
  const selectedCargo = selectedPackage ? packageById.get(selectedPackage) : undefined;
  const loadedPackageIds = new Set(trips.flatMap((trip) => trip.cargoPackageIds));
  const activeTripLoadedPackages = activeTrip ? activeTrip.cargoPackageIds.map((id) => packageById.get(id)).filter(Boolean) as CargoPackage[] : [];
  const activeTripActualWeightKg = activeTripLoadedPackages.reduce((total, pkg) => total + packageWeightKg(pkg), 0);
  const activeTripVolumeCbm = activeTripLoadedPackages.reduce((total, pkg) => total + packageVolumeCbm(pkg), 0);
  const activeTripVolumetricWeightKg = activeTripLoadedPackages.reduce((total, pkg) => total + packageVolumetricWeightKg(pkg), 0);
  const isDeliveryOnlyTripUser = activeUserRole === "Delivery Staff" || activeUserRole === "Delivery Admin";
  const tripStatusFilters = [
    { key: "Loading", label: "Loading" },
    { key: "Planned", label: "Planned" },
    { key: "Departed", label: "Departed" },
    { key: "Arrived", label: "Arrived" },
    { key: "Cancelled", label: "Cancelled" }
  ] as const;
  const tripMatchesStatusFilter = (trip: Trip, filter: typeof tripStatusFilter) => {
    if (filter === "Departed") return ["Departed", "In Transit"].includes(trip.status);
    return trip.status === filter;
  };
  const filteredTripList = [...trips]
    .filter((trip) => tripMatchesStatusFilter(trip, tripStatusFilter))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const displayedTripList = filteredTripList.slice(0, tripListLimit);
  const tripStatusCount = (filter: typeof tripStatusFilter) => trips.filter((trip) => tripMatchesStatusFilter(trip, filter)).length;
  const tripLoadedPackages = (trip: Trip) => trip.cargoPackageIds.map((id) => packageById.get(id)).filter(Boolean) as CargoPackage[];
  const tripCardAction = (trip: Trip) => {
    if (["Planned", "Loading"].includes(trip.status)) return "Open Loading";
    if (["Departed", "In Transit"].includes(trip.status)) return "Track Arrival";
    if (trip.status === "Arrived") return "View Trip";
    if (trip.status === "Cancelled") return "View Cancelled";
    return "View Trip";
  };
  const tripDestinationOptions = Array.from(new Set(["Daet", "Naga", ...packages.map((pkg) => pkg.handlingBranchName ?? pkg.destination).filter(Boolean)]));
  const selectedTruck = trucks?.find((truck) => truck.plateNumber.toLowerCase() === plateNumber.trim().toLowerCase());
  const truckSuggestions = (trucks ?? [])
    .filter((truck) => {
      const query = plateNumber.trim().toLowerCase();
      if (!query || selectedTruck) return false;
      return `${truck.plateNumber} ${truck.driverName ?? ""} ${truck.ownerName ?? ""}`.toLowerCase().includes(query);
    })
    .slice(0, 4);
  const truckDetailsVisible = Boolean(selectedTruck || (plateNumber.trim() && truckSuggestions.length === 0));
  const canAddTruck = Boolean(truckDetailsVisible && plateNumber.trim() && driverName.trim() && !selectedTruck);
  const canCreateTrip = Boolean(destination && plateNumber.trim());
  const tripLoadablePackages = loadablePackages
    .filter((pkg) => !["Delivered", "Cancelled"].includes(pkg.status))
    .filter((pkg) => !loadedPackageIds.has(pkg.id));
  const cargoMatches = tripLoadablePackages
    .filter((pkg) => {
      const query = cargoSearch.trim().toLowerCase();
      if (!query) return false;
      return [pkg.packageNumber, pkg.qrValue, pkg.description, pkg.customerName, pkg.handlingBranchName, pkg.destination, pkg.status]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(query);
    })
    .slice(0, 8);
  const selectedCargoMissingMeasurement = selectedCargo ? !hasLoadingMeasurements(selectedCargo) : false;
  const canEditTripLoading = activeTrip ? ["Planned", "Loading"].includes(activeTrip.status) : false;
  const canDepartTrip = activeTrip ? ["Planned", "Loading"].includes(activeTrip.status) && activeTrip.cargoPackageIds.length > 0 : false;
  const canMarkArrival = Boolean(activeTrip && activeUserRole !== "Receiving Staff" && ["Departed", "In Transit"].includes(activeTrip.status));
  const canCompleteTrip = Boolean(
    activeTrip &&
    activeTrip.status === "Arrived" &&
    activeTripLoadedPackages.length > 0 &&
    activeTripLoadedPackages.every((pkg) => ["Delivered", "Failed Delivery", "Exception", "Cancelled"].includes(pkg.status))
  );
  const tripLockedAfterArrival = Boolean(activeTrip && ["Arrived", "Completed", "Cancelled"].includes(activeTrip.status));

  useEffect(() => {
    if (!selectedTruck) return;
    setDriverName(selectedTruck.driverName ?? "");
    setDriverContactNumber(selectedTruck.contactNumber ?? "");
    setTruckOwnerName(selectedTruck.ownerName ?? "");
  }, [selectedTruck]);

  useEffect(() => {
    if (isDeliveryOnlyTripUser && (mode === "create" || mode === "trucks")) {
      setMode("home");
    }
  }, [isDeliveryOnlyTripUser, mode]);

  useEffect(() => {
    setTripListLimit(LIST_PAGE_SIZE);
  }, [tripStatusFilter, mode]);

  useEffect(() => {
    if (selectedPackage) return;
    const query = cargoSearch.trim().toLowerCase();
    if (!query) return;
    const exactCargo = tripLoadablePackages.find((pkg) =>
      [pkg.packageNumber, pkg.qrValue, pkg.receivingRecordNumber]
        .filter(Boolean)
        .some((value) => value.toLowerCase() === query)
    );
    if (!exactCargo) return;
    const timer = window.setTimeout(() => selectLoadableCargo(exactCargo), 160);
    return () => window.clearTimeout(timer);
  }, [cargoSearch, selectedPackage, tripLoadablePackages]);

  async function createTrip() {
    setTripStatus(`Saving ${destination} trip...`);
    let createdTrip: Trip | undefined;
    await onAction("Save trip", async () => {
      createdTrip = await apiPost<Trip>("/trips", {
        origin: "Origin Warehouse",
        destination,
        truckId: selectedTruck?.id,
        plateNumber,
        vehicleDescription: plateNumber || "Truck not set",
        driverName,
        driverContactNumber,
        truckOwnerName,
        saveTruckDetails: false
      });
    });
    if (!createdTrip) return;
    setSelectedTripId(createdTrip.id);
    setSelectedPackage("");
    setCargoSearch("");
    setTripStatusFilter("Planned");
    setMode("active");
    setTripStatus(`${createdTrip.tripNumber} saved. You can load cargo now or come back later from Active Trips.`);
  }

  async function addTruck() {
    setTripStatus(`Saving truck ${plateNumber.trim().toUpperCase()}...`);
    await onAction("Add truck", () => apiPost("/trucks", {
      plateNumber,
      driverName,
      contactNumber: driverContactNumber,
      ownerName: truckOwnerName
    }));
    setTripStatus(`Truck ${plateNumber.trim().toUpperCase()} saved. It will auto-fill next time.`);
  }

  function selectTruck(truck: NonNullable<BootstrapData["trucks"]>[number]) {
    setPlateNumber(truck.plateNumber);
    setDriverName(truck.driverName ?? "");
    setDriverContactNumber(truck.contactNumber ?? "");
    setTruckOwnerName(truck.ownerName ?? "");
    setTripStatus(`Truck ${truck.plateNumber} selected.`);
  }

  function changePlateNumber(value: string) {
    const nextPlate = value.toUpperCase();
    setPlateNumber(nextPlate);
    const matchedTruck = trucks?.find((truck) => truck.plateNumber.toLowerCase() === nextPlate.trim().toLowerCase());
    if (!matchedTruck) {
      setDriverName("");
      setDriverContactNumber("");
      setTruckOwnerName("");
    }
  }

  function selectLoadableCargo(pkg: CargoPackage) {
    const branchName = pkg.handlingBranchName ?? pkg.destination;
    const branchMismatch = activeTrip ? branchName !== activeTrip.destination : false;
    const noPrice = pkg.price == null;
    const missingMeasurement = !hasLoadingMeasurements(pkg);
    setSelectedPackage(pkg.id);
    setCargoSearch(`${pkg.packageNumber} - ${pkg.description}`);
    setTripStatus(noPrice ? `${pkg.packageNumber} has no price yet. Set price before loading.` : missingMeasurement ? `${pkg.packageNumber} is missing weight or dimensions. Complete it in Cargo before loading.` : branchMismatch ? "Branch mismatch detected. Owner review/approval may be required." : "Cargo selected. Confirm loading when ready.");
  }

  async function confirmAndLoadCargo() {
    if (!activeTrip || !selectedPackage) {
      setTripStatus("Create a trip and select cargo before loading.");
      return;
    }
    const cargo = selectedCargo;
    if (!cargo) {
      setTripStatus("Selected cargo was not found. Refresh and try again.");
      return;
    }
    if (cargo.price == null) {
      setTripStatus(`${cargo.packageNumber} has no price yet. Set price before loading.`);
      return;
    }
    if (!hasLoadingMeasurements(cargo)) {
      setTripStatus(`${cargo.packageNumber} is missing required weight or dimensions. Complete measurements in Cargo before loading.`);
      return;
    }
    const cargoBranch = cargo.handlingBranchName ?? cargo.destination;
    const isMismatch = cargoBranch !== activeTrip.destination;
    const confirmed = window.confirm(
      isMismatch
        ? `Wrong branch check:\n\nPackage: ${cargo.packageNumber}\nPackage Branch: ${cargoBranch}\nTruck Destination: ${activeTrip.destination}\n\nThis will become a mixed trip and owner approval/review is required. Continue loading?`
        : `Confirm loading:\n\nPackage: ${cargo.packageNumber}\nBranch: ${cargoBranch}\nTruck Destination: ${activeTrip.destination}\n\nLoad this package now?`
    );
    if (!confirmed) return;
    setTripStatus("Loading cargo...");
    await onAction("Load cargo", () =>
      apiPost(`/trips/${activeTrip.id}/load`, {
        cargoPackageId: selectedPackage,
        overrideReason: isMismatch ? `Confirmed mixed loading: ${cargoBranch} cargo on ${activeTrip.destination} trip` : undefined
      })
    );
    setTripStatus(`${cargo.packageNumber} loaded to ${activeTrip.tripNumber}.`);
    setSelectedPackage("");
    setCargoSearch("");
  }

  async function removeLoadedCargo(pkg: CargoPackage) {
    if (!activeTrip) return;
    if (!["Planned", "Loading"].includes(activeTrip.status)) {
      setTripStatus("Cargo can only be removed before the trip departs.");
      return;
    }
    const confirmed = window.confirm(`Remove ${pkg.packageNumber} from ${activeTrip.tripNumber}?`);
    if (!confirmed) return;
    setTripStatus(`Removing ${pkg.packageNumber} from ${activeTrip.tripNumber}...`);
    await onAction("Remove cargo from trip", () =>
      apiPost(`/trips/${activeTrip.id}/unload`, {
        cargoPackageId: pkg.id,
        reason: "Removed before departure by operator confirmation"
      })
    );
    setSelectedPackage("");
    setCargoSearch("");
    setTripStatus(`${pkg.packageNumber} removed from ${activeTrip.tripNumber}.`);
  }

  async function attachLoadingPhoto(file: File) {
    if (!activeTrip) return;
    setTripStatus("Uploading loading photo...");
    const uploaded = await uploadCompressedImage(file, "trip-loading-photo", activeTrip.id);
    await onAction("Attach loading photo", () =>
      queueablePost("photo", `/trips/${activeTrip.id}/loading-photo`, {
        photoUrl: uploaded.fileUrl
      })
    );
    setTripStatus(photoUploadStatus(uploaded, "Truck/cargo loading photo attached."));
  }

  async function reviewMixedTrip(approved: boolean) {
    if (!activeTrip) return;
    await onAction(approved ? "Approve mixed trip" : "Reject mixed trip", () =>
      apiPost(`/trips/${activeTrip.id}/mixed-approval`, {
        approved,
        notes: approved ? "Approved by branch owner/admin review" : "Rejected by branch owner/admin review"
      })
    );
    setTripStatus(approved ? "Mixed trip approved." : "Mixed trip rejected. Review loaded cargo before departure.");
  }

  return (
    <div className="stack">
      {mode === "home" && (
        <ModuleTileLauncher
          eyebrow="Trips"
          title="What do you want to do?"
          description={isDeliveryOnlyTripUser ? "Review arriving trips or manage return movements." : "Create a trip, open the trip list, or manage saved trucks."}
          actions={[
            ...(!isDeliveryOnlyTripUser
              ? [{ key: "create", label: "Create Trip", note: "Start truck movement", icon: Truck, tone: "dark" as TileTone, onClick: () => setMode("create") }]
              : []),
            { key: "list", label: "Trip List", note: `${activeTrips.length} active / ${trips.length} total`, icon: CheckCircle2, count: activeTrips.length, tone: activeTrips.length ? "dark" : "light", onClick: () => setMode("active") },
            ...(isDeliveryOnlyTripUser
              ? [{
                  key: "returns",
                  label: "Returns",
                  note: "Return trips only",
                  icon: X,
                  onClick: () => {
                    setTripStatusFilter("Cancelled");
                    setMode("active");
                  }
                }]
              : [{ key: "trucks", label: "Trucks", note: `${trucks?.length ?? 0} saved trucks`, icon: Truck, count: trucks?.length ?? 0, tone: "light" as TileTone, onClick: () => setMode("trucks") }])
          ]}
        />
      )}

      {mode === "create" && (
      <section className="panel workflow">
        <div className="sectionHeader">
          <div>
            <h3>Create Trip</h3>
            <p className="muted">Create the truck movement first. Cargo can be loaded now or later from Trip List.</p>
          </div>
          <button className="smallButton" onClick={() => setMode("home")}>Back</button>
        </div>
        <div className="formGrid">
          <label>Trip Destination<select value={destination} onChange={(event) => setDestination(event.target.value)}>{tripDestinationOptions.map((option) => <option key={option}>{option}</option>)}</select></label>
          <AutocompleteField<NonNullable<BootstrapData["trucks"]>[number]>
            value={plateNumber}
            placeholder="Type plate number"
            items={trucks ?? []}
            selectedLabel={selectedTruck?.plateNumber ?? ""}
            minChars={1}
            noResultsText="No saved truck found. Enter driver details below to add it."
            getLabel={(truck) => truck.plateNumber}
            getMeta={(truck) => `${truck.driverName ?? "No driver"} - ${truck.contactNumber ?? "No contact"} - ${truck.ownerName ?? "No owner"}`}
            getSearchValues={(truck) => [truck.plateNumber, truck.driverName, truck.contactNumber, truck.ownerName]}
            onChange={changePlateNumber}
            onSelect={selectTruck}
          />
          {truckDetailsVisible && (
            <>
              <label>Driver<input value={driverName} onChange={(event) => setDriverName(event.target.value)} placeholder="Driver name" /></label>
              <label>Contact Number<input value={driverContactNumber} onChange={(event) => setDriverContactNumber(event.target.value)} placeholder="Driver/contact number" /></label>
              <label>Owner / Provider<input value={truckOwnerName} onChange={(event) => setTruckOwnerName(event.target.value)} placeholder="Truck owner or provider" /></label>
            </>
          )}
        </div>
        {selectedTruck && <p className="muted">Saved truck selected. Driver, contact, and owner/provider can still be edited for this trip.</p>}
        {canAddTruck && (
          <button className="secondaryButton" onClick={() => void addTruck()}>
            <Plus /> Add Truck to Saved List
          </button>
        )}
        <section className="subPanel compactGuide">
          <h4>After creating the trip</h4>
          <div className="detailGrid compactDetailGrid">
            <div><span>1</span><strong>Open Trip List</strong></div>
            <div><span>2</span><strong>Scan cargo QR</strong></div>
            <div><span>3</span><strong>Print manifest</strong></div>
            <div><span>4</span><strong>Depart truck</strong></div>
          </div>
          <p className="muted">A trip can be saved with zero cargo. Load cargo now or return later from Trip List.</p>
        </section>
        <button className="primaryButton" disabled={!canCreateTrip} onClick={() => void createTrip()}><Truck /> Create {destination} Trip</button>
      </section>
      )}

      {mode === "active" && (
      <section className="panel workflow">
        <div className="sectionHeader">
          <div>
            <h3>{activeTrip ? "Trip Details" : "Trip List"}</h3>
            <p className="muted">{activeTrip ? "Load cargo, print manifest, depart, and mark arrival." : "Tap Open / Load to work on a trip."}</p>
          </div>
          <button className="smallButton" onClick={() => {
            if (activeTrip) {
              setSelectedTripId("");
              setSelectedPackage("");
              return;
            }
            setMode("home");
          }}>Back</button>
        </div>
        {!activeTrip && (
        <>
          <div className="statusFilterStrip">
            {tripStatusFilters.map((filter) => (
              <button
                className={tripStatusFilter === filter.key ? "statusFilterButton active" : "statusFilterButton"}
                key={filter.key}
                onClick={() => setTripStatusFilter(filter.key)}
                type="button"
              >
                <span>{filter.label}</span>
                <strong>{tripStatusCount(filter.key)}</strong>
              </button>
            ))}
          </div>
          <div className="list compactList">
            {displayedTripList.map((trip) => {
              const loaded = tripLoadedPackages(trip);
              const weight = loaded.reduce((total, pkg) => total + packageWeightKg(pkg), 0);
              const volume = loaded.reduce((total, pkg) => total + packageVolumeCbm(pkg), 0);
              return (
                <button className="row denseRow tappableRow tripListCard" key={trip.id} onClick={() => {
                  setSelectedTripId(trip.id);
                  setSelectedPackage("");
                }}>
                  <div>
                    <strong>{trip.tripNumber} - {trip.destination}</strong>
                    <p>{trip.plateNumber ?? trip.vehicleDescription ?? "Truck not set"} - {trip.driverName ?? "Driver not set"}</p>
                    <p className="muted">{trip.cargoPackageIds.length} cargo / {weight ? `${formatNumber(weight)} kg` : "0 kg"} / {volume ? `${formatNumber(volume, 4)} cbm` : "0 cbm"}</p>
                  </div>
                  <div className="rowActions">
                    <span className="badge">{trip.status}</span>
                    <span className="rowPseudoButton">{tripCardAction(trip)}</span>
                  </div>
                </button>
              );
            })}
            {!filteredTripList.length && <p className="notice">No {tripStatusFilter.toLowerCase()} trips found.</p>}
            {filteredTripList.length > displayedTripList.length && (
              <button className="loadMoreButton" type="button" onClick={() => setTripListLimit((limit) => limit + LIST_PAGE_SIZE)}>
                Show more trips ({filteredTripList.length - displayedTripList.length} left)
              </button>
            )}
          </div>
        </>
        )}
        {activeTrip && (
          <>
            <div className="sectionHeader">
              <div>
                <h3>Active Trip</h3>
                <p className="muted">{activeTrip.tripNumber} - {activeTrip.origin} to {activeTrip.destination}</p>
                <p className="muted">{activeTrip.plateNumber ?? activeTrip.vehicleDescription ?? "Truck not set"} - {activeTrip.driverName ?? "Driver not set"}{activeTrip.driverContactNumber ? ` - ${activeTrip.driverContactNumber}` : ""}</p>
              </div>
              <span className="badge">{activeTrip.status}</span>
            </div>
            {canMarkArrival && (
              <section className="subPanel arrivalCallout">
                <div>
                  <h4>Truck Arrived?</h4>
                  <p className="muted">Use this when the truck is physically at the destination branch and cargo is ready for unloading verification.</p>
                </div>
                <button className="primaryButton" onClick={() => onAction("Arrive trip", () => apiPost(`/trips/${activeTrip.id}/arrive`))}>
                  <CheckCircle2 /> Mark Arrived
                </button>
              </section>
            )}
            <div className="tripCompactSummary">
              <div>
                <span>Cargo</span>
                <strong>{activeTrip.cargoPackageIds.length}</strong>
              </div>
              <div>
                <span>Weight</span>
                <strong>{activeTripActualWeightKg ? `${formatNumber(activeTripActualWeightKg)} kg` : "0 kg"}</strong>
              </div>
              <div>
                <span>Volume</span>
                <strong>{activeTripVolumeCbm ? `${formatNumber(activeTripVolumeCbm, 4)} cbm` : "0 cbm"}</strong>
              </div>
              <div>
                <span>Vol. Wt.</span>
                <strong>{activeTripVolumetricWeightKg ? `${formatNumber(activeTripVolumetricWeightKg)} kg` : "0 kg"}</strong>
              </div>
              <div className="wide">
                <span>Type</span>
                <strong>{activeTrip.isMixedTrip ? "Mixed trip" : "Regular trip"}</strong>
              </div>
              <div className="wide">
                <span>Provider</span>
                <strong>{activeTrip.truckOwnerName ?? "Not set"}</strong>
              </div>
              {activeTrip.isMixedTrip && (
                <div className="wide">
                  <span>Mixed Approval</span>
                  <strong>{activeTrip.mixedTripApprovalStatus ?? "Notified"}</strong>
                </div>
              )}
            </div>
            {activeTrip.isMixedTrip && (
              <section className="subPanel compactGuide">
                <h4>Mixed Trip Review</h4>
                <p className="muted">{activeTrip.mixedTripApprovalNotes ?? "This trip contains cargo for another branch. Branch owners should review before departure."}</p>
                {isOwnerRole(activeUserRole) && activeTrip.mixedTripApprovalStatus === "Notified" && (
                  <div className="buttonGrid two">
                    <button className="primaryButton" onClick={() => void reviewMixedTrip(true)}>Approve Mixed Trip</button>
                    <button className="dangerButton" onClick={() => void reviewMixedTrip(false)}>Reject</button>
                  </div>
                )}
              </section>
            )}
            {canEditTripLoading ? (
              <section className="subPanel">
                <h4>Load Cargo</h4>
                <p className="muted">Type a package number, product, customer, or branch. The side scanner fills this field when focused.</p>
                <div className="scanEntryRow">
                  <AutocompleteField<CargoPackage>
                    label="Package / Cargo"
                    inputRef={cargoSearchInputRef}
                    value={cargoSearch}
                    placeholder="Package no., customer, or item"
                    items={tripLoadablePackages}
                    selectedLabel={selectedCargo ? `${selectedCargo.packageNumber} - ${selectedCargo.description}` : ""}
                    minChars={1}
                    noResultsText="No loadable cargo found."
                    getLabel={(pkg) => `${pkg.packageNumber} - ${pkg.description}`}
                    getMeta={(pkg) => `${pkg.customerName} / ${pkg.handlingBranchName ?? pkg.destination} / ${pkg.price == null ? "No price" : `PHP ${pkg.price}`}`}
                    getSearchValues={(pkg) => [pkg.packageNumber, pkg.qrValue, pkg.description, pkg.customerName, pkg.handlingBranchName, pkg.destination, pkg.status]}
                    getExactValues={(pkg) => [pkg.packageNumber, pkg.qrValue]}
                    onChange={(value) => {
                      setCargoSearch(value);
                      setSelectedPackage("");
                    }}
                    onInputEnter={(value, suggestions) => {
                      if (suggestions.length > 1) {
                        setTripStatus("Multiple cargo records found. Tap the correct cargo from the list.");
                        return;
                      }
                      setTripStatus(value ? "No exact cargo found. Type package, customer, or item." : "Type package/customer/item or use the side scanner.");
                    }}
                    onSelect={selectLoadableCargo}
                  />
                </div>
                <div className="list compactList">
                  {cargoMatches.map((pkg) => {
                    const branchName = pkg.handlingBranchName ?? pkg.destination;
                    const branchMismatch = branchName !== activeTrip.destination;
                    const noPrice = pkg.price == null;
                    const missingMeasurement = !hasLoadingMeasurements(pkg);
                    const selected = selectedPackage === pkg.id;
                    return (
                      <button className={selected ? "row denseRow tappableRow active" : "row denseRow tappableRow"} key={pkg.id} onClick={() => selectLoadableCargo(pkg)}>
                        <div>
                          <strong>{pkg.description}</strong>
                          <p>{pkg.packageNumber} - {branchName}</p>
                          <p className="muted">{pkg.customerName} / {pkg.status} / {pkg.price == null ? "No price" : `PHP ${pkg.price}`} / {packageWeightKg(pkg) ? `${formatNumber(packageWeightKg(pkg))} kg` : "No weight"}</p>
                        </div>
                        <div className="rowActions">
                          {noPrice && <span className="badge warning">No Price</span>}
                          {missingMeasurement && <span className="badge warning">Need Size</span>}
                          {branchMismatch && <span className="badge warning">Mixed</span>}
                          <span className="rowPseudoButton">{selected ? "Selected" : "Select"}</span>
                        </div>
                      </button>
                    );
                  })}
                  {!cargoMatches.length && <p className="muted">No loadable cargo found.</p>}
                </div>
                {selectedCargo && (
                  <div className="detailGrid compactDetailGrid">
                    <div><span>Selected</span><strong>{selectedCargo.description}</strong></div>
                    <div><span>Package</span><strong>{selectedCargo.packageNumber}</strong></div>
                    <div><span>Branch</span><strong>{selectedCargo.handlingBranchName ?? selectedCargo.destination}</strong></div>
                    <div><span>Price</span><strong>{selectedCargo.price == null ? "No price" : `PHP ${selectedCargo.price}`}</strong></div>
                    <div><span>Actual Weight</span><strong>{packageWeightKg(selectedCargo) ? `${formatNumber(packageWeightKg(selectedCargo))} kg` : "Missing"}</strong></div>
                    <div><span>Dimensions</span><strong>{packageVolumeCbm(selectedCargo) ? `${selectedCargo.length ?? "?"} x ${selectedCargo.width ?? "?"} x ${selectedCargo.height ?? "?"} ${selectedCargo.dimensionUnit ?? "cm"}` : "Missing"}</strong></div>
                    <div><span>Condition</span><strong>{selectedCargo.condition}</strong></div>
                    <div><span>Status</span><strong>{selectedCargo.status}</strong></div>
                  </div>
                )}
                <p className={selectedCargo?.price == null || selectedCargoMissingMeasurement ? "notice warningNotice" : "notice"}>{tripStatus}</p>
                <button className="primaryButton" disabled={!selectedPackage || selectedCargo?.price == null || selectedCargoMissingMeasurement} onClick={() => void confirmAndLoadCargo()}>Confirm and Load Cargo</button>
              </section>
            ) : (
              <p className="notice">{tripLockedAfterArrival ? "Trip loading is locked because this trip already arrived at the delivery branch." : "Trip loading is locked for the current trip status."}</p>
            )}
            <section className="subPanel">
              <h4>Loaded Cargo</h4>
              <div className="list compactList">
                {activeTripLoadedPackages.map((pkg) => (
                  <div className="row denseRow loadedCargoCard" key={pkg.id}>
                    {["Planned", "Loading"].includes(activeTrip.status) && (
                      <button
                        className="iconOnlyButton removeCornerButton"
                        aria-label={`Remove ${pkg.packageNumber}`}
                        onClick={() => void removeLoadedCargo(pkg)}
                      >
                        <X size={18} />
                      </button>
                    )}
                    <div>
                      <strong>{pkg.description}</strong>
                      <p>{pkg.packageNumber} - {pkg.handlingBranchName ?? pkg.destination}</p>
                      <p className="muted">{pkg.customerName} / {pkg.status} / {pkg.price == null ? "No price" : `PHP ${pkg.price}`} / {packageWeightKg(pkg) ? `${formatNumber(packageWeightKg(pkg))} kg` : "No weight"} / {packageVolumeCbm(pkg) ? `${formatNumber(packageVolumeCbm(pkg), 4)} cbm` : "No volume"}</p>
                    </div>
                  </div>
                ))}
                {!activeTripLoadedPackages.length && <p className="muted">No cargo loaded yet. This trip is saved and can be loaded later.</p>}
              </div>
            </section>
            <section className="subPanel">
              <div className="sectionHeader">
                <div>
                  <h4>Trip Actions</h4>
                  <p className="muted">Use after loading is complete or when printing documents.</p>
                </div>
              </div>
              <div className="loadingPhotoBox">
                <div>
                  <strong>Truck / Cargo Photo</strong>
                  <p className="muted">{activeTrip.loadingPhotoUrl ? "Attached as loading proof." : canEditTripLoading ? "Take a photo after cargo is loaded." : "Loading proof is locked for this trip status."}</p>
                </div>
                {activeTrip.loadingPhotoUrl && <img src={activeTrip.loadingPhotoUrl} alt="Truck loading proof" />}
                {canEditTripLoading && <button className="actionButton" onClick={() => void capturePhotoOrOpenPicker(loadingPhotoInputRef, `loading-photo-${Date.now()}.jpg`, attachLoadingPhoto)}><Camera /> Add Loading Image</button>}
                <input
                  ref={loadingPhotoInputRef}
                  className="hiddenInput"
                  type="file"
                  accept="image/*"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (file) void attachLoadingPhoto(file);
                  }}
                />
            </div>
            <div className="buttonGrid">
              {canEditTripLoading && <button className="actionButton" disabled={!canDepartTrip} onClick={() => onAction("Depart trip", () => apiPost(`/trips/${activeTrip.id}/depart`))}><Truck /> Mark Departed</button>}
              {canCompleteTrip && <button className="primaryButton" onClick={() => onAction("Complete trip", () => apiPost(`/trips/${activeTrip.id}/complete`))}><CheckCircle2 /> Complete Trip</button>}
              <button
                className="actionButton"
                onClick={() =>
                  onAction("Load manifest preview", async () => {
                    const result = await apiGet<{ text: string }>(`/trips/${activeTrip.id}/loading-manifest`);
                    setReceiptPreview(result.text);
                  })
                }
              >
                <Printer /> Preview / Print Manifest
              </button>
            </div>
            </section>
          </>
        )}
      </section>
      )}

      {mode === "records" && (
      <section className="panel">
        <div className="sectionHeader">
          <div>
            <h3>Trip Records</h3>
            <p className="muted">Review planned, departed, arrived, completed, and mixed-trip history.</p>
          </div>
          <button className="smallButton" onClick={() => setMode("home")}>Back</button>
        </div>
        <div className="list compactList">
          {tripRecords.map((trip) => (
            <div className="row denseRow" key={trip.id}>
              <div>
                <strong>{trip.tripNumber}</strong>
                <p>{trip.origin} to {trip.destination}</p>
                <p className="muted">{trip.plateNumber ?? trip.vehicleDescription ?? "Truck not set"} - {trip.driverName ?? "Driver not set"} - {trip.cargoPackageIds.length} cargo</p>
              </div>
              <div className="rowActions">
                <span className="badge">{trip.status}</span>
                {trip.isMixedTrip && <span className="badge warning">Mixed</span>}
              </div>
            </div>
          ))}
          {!trips.length && <p className="muted">No trip records found.</p>}
        </div>
      </section>
      )}

      {mode === "trucks" && (
      <section className="panel workflow">
        <div className="sectionHeader">
          <div>
            <h3>Trucks</h3>
            <p className="muted">Saved plates used for trip autocomplete. Driver details can still be edited per trip.</p>
          </div>
          <button className="smallButton" onClick={() => setMode("home")}>Back</button>
        </div>
        <div className="list compactList">
          {(trucks ?? []).map((truck) => (
            <div className="row compactDataRow" key={truck.id}>
              <div>
                <strong>{truck.plateNumber}</strong>
                <p>{truck.driverName ?? "No driver"}{truck.contactNumber ? ` - ${truck.contactNumber}` : ""}</p>
                <p className="muted">{truck.ownerName ?? "No owner/provider"} / {truck.status}</p>
              </div>
            </div>
          ))}
          {!(trucks ?? []).length && <p className="muted">No saved trucks yet. Add one while creating a trip.</p>}
        </div>
      </section>
      )}
    </div>
  );
}

function Delivery({
  packages,
  payments,
  methods,
  activeUser,
  setReceiptPreview,
  onAction,
  queueablePost
}: {
  packages: CargoPackage[];
  payments: PaymentRecord[];
  methods: string[];
  activeUser: OperatorUser;
  setReceiptPreview: (value: string) => void;
  onAction: <T>(label: string, action: () => Promise<T>) => Promise<void>;
  queueablePost: QueueablePost;
}) {
  const [mode, setMode] = useState<"home" | "arrived" | "ready" | "deliver" | "payments" | "failed">("home");
  const [selectedPackage, setSelectedPackage] = useState("");
  const [packageSearch, setPackageSearch] = useState("");
  const [deliveryListLimit, setDeliveryListLimit] = useState(LIST_PAGE_SIZE);
  const [recipient, setRecipient] = useState("Customer Receiver");
  const [deliveryPhoto, setDeliveryPhoto] = useState("");
  const [signature, setSignature] = useState("");
  const [amountCollected, setAmountCollected] = useState("");
  const [paymentMethod, setPaymentMethod] = useState(methods[0] ?? "Cash");
  const [paymentProofUrl, setPaymentProofUrl] = useState("");
  const [issuePhotoUrl, setIssuePhotoUrl] = useState("");
  const [returnReason, setReturnReason] = useState("Customer requested return");
  const [returnNextAction, setReturnNextAction] = useState<"Return to Sender" | "Return to Origin" | "Hold at Branch" | "Reschedule">("Return to Sender");
  const [deliveryStatus, setDeliveryStatus] = useState("Select a package, take delivery proof, then complete delivery.");
  const deliveryPhotoInputRef = useRef<HTMLInputElement | null>(null);
  const paymentProofInputRef = useRef<HTMLInputElement | null>(null);
  const issuePhotoInputRef = useRef<HTMLInputElement | null>(null);
  const deliveryPackageSearchInputRef = useRef<HTMLInputElement | null>(null);
  const selectedCargo = packages.find((pkg) => pkg.id === selectedPackage);
  const paymentTotalsByPackage = payments.reduce<Record<string, number>>((totals, payment) => {
    totals[payment.cargoPackageId] = (totals[payment.cargoPackageId] ?? 0) + payment.amountPaid;
    return totals;
  }, {});
  const packageBalance = (pkg: CargoPackage) => Math.max(Number(pkg.price ?? 0) - (paymentTotalsByPackage[pkg.id] ?? 0), 0);
  const paymentStatusForPackage = (pkg: CargoPackage) => {
    const due = Number(pkg.price ?? 0);
    const paid = paymentTotalsByPackage[pkg.id] ?? 0;
    if (!due) return "No Price";
    if (paid >= due) return "Paid";
    if (paid > 0) return "Partial";
    return "Unpaid";
  };
  const arrivedPackages = packages.filter((pkg) => pkg.status === "Arrived");
  const readyPackages = packages.filter((pkg) => pkg.status === "Ready for Delivery");
  const deliverPackages = packages.filter((pkg) => pkg.status === "Ready for Delivery");
  const failedPackages = packages.filter((pkg) => pkg.status === "Failed Delivery" || pkg.status === "Exception");
  const unpaidPackages = packages.filter((pkg) => packageBalance(pkg) > 0 && pkg.price != null);
  const deliveryNextAction = (pkg: CargoPackage) => {
    if (pkg.status === "Arrived") return "Verify at branch";
    if (pkg.status === "Ready for Delivery" && packageBalance(pkg) > 0) return "Deliver and collect";
    if (pkg.status === "Ready for Delivery") return "Deliver";
    if (pkg.status === "Failed Delivery") return "Return / reschedule";
    if (pkg.status === "Exception") return "Report issue";
    return "Review";
  };
  const visiblePackages =
    mode === "arrived" ? arrivedPackages :
    mode === "ready" ? readyPackages :
    mode === "deliver" ? deliverPackages :
    mode === "payments" ? unpaidPackages :
    mode === "failed" ? failedPackages :
    [];
  const searchedPackages = visiblePackages.filter((pkg) => {
    const query = packageSearch.trim().toLowerCase();
    if (!query) return true;
    return [
      pkg.packageNumber,
      pkg.qrValue,
      pkg.receivingRecordNumber,
      pkg.customerName,
      pkg.description,
      pkg.consigneeName,
      pkg.destination,
      pkg.city,
      pkg.deliveryPhone,
      pkg.status
    ].filter(Boolean).join(" ").toLowerCase().includes(query);
  });
  const displayedDeliveryPackages = searchedPackages.slice(0, deliveryListLimit);

  useEffect(() => {
    setDeliveryListLimit(LIST_PAGE_SIZE);
  }, [mode, packageSearch]);

  useEffect(() => {
    if (selectedPackage) return;
    const query = packageSearch.trim().toLowerCase();
    if (!query) return;
    const exactPackage = visiblePackages.find((pkg) =>
      [pkg.packageNumber, pkg.qrValue, pkg.receivingRecordNumber]
        .filter(Boolean)
        .some((value) => value.toLowerCase() === query)
    );
    if (!exactPackage) return;
    const timer = window.setTimeout(() => selectDeliveryPackage(exactPackage), 160);
    return () => window.clearTimeout(timer);
  }, [packageSearch, selectedPackage, visiblePackages]);

  function selectDeliveryPackage(pkg: CargoPackage) {
    setSelectedPackage(pkg.id);
    setPackageSearch(`${pkg.packageNumber} - ${pkg.description}`);
    setRecipient(pkg.consigneeName || "Customer Receiver");
    const balance = packageBalance(pkg);
    setAmountCollected(balance ? String(balance) : "");
    setDeliveryPhoto("");
    setPaymentProofUrl("");
    setIssuePhotoUrl("");
    setSignature("");
    setDeliveryStatus(`Selected ${pkg.packageNumber}. ${balance ? `Balance PHP ${balance.toLocaleString()}.` : "No balance to collect."}`);
  }

  async function verifyPackage(issueStatus: "Ready for Delivery" | "Damaged" | "Missing" | "For Checking" = "Ready for Delivery") {
    if (!selectedPackage) return;
    await apiPost(`/packages/${selectedPackage}/verify-arrival`, {
      issueStatus,
      condition: issueStatus === "Ready for Delivery" ? "Good" : issueStatus === "Missing" ? "Other" : issueStatus,
      notes: issueStatus === "Ready for Delivery" ? "Verified at branch" : `${issueStatus} reported during branch verification`,
      photoUrl: issuePhotoUrl || undefined
    });
    setDeliveryStatus(issueStatus === "Ready for Delivery" ? "Cargo verified and moved to Ready for Delivery." : `${issueStatus} reported and owner notified.`);
    setSelectedPackage("");
    setPackageSearch("");
    setIssuePhotoUrl("");
  }

  async function createReturn() {
    if (!selectedPackage) return;
    await queueablePost("delivery", "/returns", {
      cargoPackageId: selectedPackage,
      reason: returnReason,
      nextAction: returnNextAction,
      photoUrl: issuePhotoUrl || undefined,
      notes: "Created from delivery exceptions"
    });
    setDeliveryStatus("Return record saved and owner notified.");
    setSelectedPackage("");
    setPackageSearch("");
    setIssuePhotoUrl("");
  }

  async function recordDeliveryPaymentIfNeeded() {
    if (!selectedCargo || !amountCollected || Number(amountCollected) <= 0) return;
    await queueablePost("payment", "/payments", {
      cargoPackageId: selectedCargo.id,
      amountPaid: Number(amountCollected),
      method: paymentMethod,
      collectionPoint: paymentCollectionPointForRole(activeUser.role),
      collectedByUserId: activeUser.id,
      collectedByName: activeUser.name,
      collectedByRole: activeUser.role,
      proofUrl: paymentProofUrl || undefined,
      notes: "Collected during delivery/POD"
    });
  }

  return (
    <div className="stack">
      {mode === "home" && (
        <ModuleTileLauncher
          eyebrow="Delivery"
          title="What do you want to do?"
          description="Verify arrived cargo, deliver to receiver, collect payment, or handle failed delivery."
          actions={[
            { key: "arrived", label: "Verify Arrived", note: `${arrivedPackages.length} to verify`, icon: CheckCircle2, count: arrivedPackages.length, tone: arrivedPackages.length ? "dark" : "light", onClick: () => setMode("arrived") },
            { key: "deliver", label: "Deliver", note: `${readyPackages.length} ready`, icon: ClipboardList, count: readyPackages.length, tone: readyPackages.length ? "dark" : "light", onClick: () => setMode("deliver") },
            { key: "collect", label: "Collect", note: `${unpaidPackages.length} unpaid`, icon: CreditCard, count: unpaidPackages.length, tone: unpaidPackages.length ? "dark" : "light", onClick: () => setMode("payments") },
            { key: "failed", label: "Failed / Return", note: `${failedPackages.length} issue`, icon: X, count: failedPackages.length, tone: failedPackages.length ? "dark" : "light", onClick: () => setMode("failed") }
          ]}
        />
      )}
      {mode !== "home" && (
      <>
      <section className="panel workflow">
        <div className="sectionHeader">
          <div>
            <h3>{mode === "arrived" ? "Verify Arrived Cargo" : mode === "ready" ? "Ready for Delivery" : mode === "payments" ? "Collect Payment" : mode === "failed" ? "Failed / Return" : "Deliver Cargo"}</h3>
            <p className="muted">{mode === "arrived" ? "Confirm cargo is physically received at the delivery branch." : mode === "ready" ? "Cargo verified at branch and ready for delivery or pickup." : mode === "payments" ? "Find packages with balance and record collected money." : mode === "failed" ? "Review failed delivery, exception cargo, and create return records." : "Use this when cargo is handed to the receiver or pickup customer."}</p>
          </div>
          <button className="smallButton" onClick={() => {
            setMode("home");
            setSelectedPackage("");
            setPackageSearch("");
          }}>Back</button>
        </div>
        <div className="scanEntryRow">
          <AutocompleteField<CargoPackage>
            label="Package / Receiver"
            inputRef={deliveryPackageSearchInputRef}
            value={packageSearch}
            placeholder="Package no., customer, or receiver"
            items={visiblePackages}
            selectedLabel={selectedCargo ? `${selectedCargo.packageNumber} - ${selectedCargo.description}` : ""}
            minChars={1}
            noResultsText="No package found for this section."
            getLabel={(pkg) => `${pkg.packageNumber} - ${pkg.description}`}
            getMeta={(pkg) => `${pkg.customerName} / ${pkg.consigneeName ?? "No receiver"} / Balance PHP ${packageBalance(pkg).toLocaleString()}`}
            getSearchValues={(pkg) => [pkg.packageNumber, pkg.qrValue, pkg.receivingRecordNumber, pkg.customerName, pkg.description, pkg.consigneeName, pkg.destination, pkg.city, pkg.deliveryPhone, pkg.status]}
            getExactValues={(pkg) => [pkg.packageNumber, pkg.qrValue, pkg.receivingRecordNumber]}
            onChange={(value) => {
              setPackageSearch(value);
              setSelectedPackage("");
            }}
            onInputEnter={(value, suggestions) => {
              if (suggestions.length > 1) {
                setDeliveryStatus("Multiple packages found. Tap the correct package from the list.");
                return;
              }
              setDeliveryStatus(value ? "No exact package found. Type package/customer." : "Type package/customer or use the side scanner.");
            }}
            onSelect={selectDeliveryPackage}
          />
        </div>
        <div className="list compactList">
          {displayedDeliveryPackages.map((pkg) => (
            <button className={selectedPackage === pkg.id ? "row denseRow tappableRow active" : "row denseRow tappableRow"} key={pkg.id} onClick={() => selectDeliveryPackage(pkg)}>
              <div>
                <strong>{pkg.description}</strong>
                <p>{pkg.packageNumber} - {pkg.customerName}</p>
                <p className="muted">{pkg.destination} / {pkg.consigneeName ?? "No receiver"} / {paymentStatusForPackage(pkg)} / Balance PHP {packageBalance(pkg).toLocaleString()} / {deliveryNextAction(pkg)}</p>
              </div>
              <div className="rowActions">
                <span className="badge">{pkg.status}</span>
                <span className="rowPseudoButton">Select</span>
              </div>
            </button>
          ))}
          {!searchedPackages.length && <p className="muted">No packages found for this section.</p>}
          {searchedPackages.length > displayedDeliveryPackages.length && (
            <button className="loadMoreButton" type="button" onClick={() => setDeliveryListLimit((limit) => limit + LIST_PAGE_SIZE)}>
              Show more packages ({searchedPackages.length - displayedDeliveryPackages.length} left)
            </button>
          )}
        </div>
        {selectedCargo && (
          <div className="detailGrid compactDetailGrid paymentSummaryGrid">
            <div><span>Customer</span><strong>{selectedCargo.customerName}</strong></div>
            <div><span>Receiver</span><strong>{selectedCargo.consigneeName ?? recipient}</strong></div>
            <div><span>Address</span><strong>{[selectedCargo.addressLine, selectedCargo.barangay, selectedCargo.city, selectedCargo.province].filter(Boolean).join(", ") || selectedCargo.destination}</strong></div>
            <div><span>Balance</span><strong>PHP {packageBalance(selectedCargo).toLocaleString()}</strong></div>
            <div><span>Status</span><strong>{selectedCargo.status}</strong></div>
            <div><span>Next Action</span><strong>{deliveryNextAction(selectedCargo)}</strong></div>
          </div>
        )}
        <input ref={deliveryPhotoInputRef} className="hiddenInput" type="file" accept="image/*" onChange={(event) => {
          const file = event.target.files?.[0];
          if (!file) return;
          setDeliveryStatus("Saving delivery photo...");
          onAction("Upload delivery photo", async () => {
            const uploaded = await uploadCompressedImage(file, "delivery-photo", selectedPackage);
            setDeliveryPhoto(uploaded.fileUrl);
            setDeliveryStatus(photoUploadStatus(uploaded, "Delivery photo uploaded."));
          });
        }} />
        <input ref={paymentProofInputRef} className="hiddenInput" type="file" accept="image/*" onChange={(event) => {
          const file = event.target.files?.[0];
          if (!file) return;
          setDeliveryStatus("Saving payment proof...");
          onAction("Upload payment proof", async () => {
            const uploaded = await uploadCompressedImage(file, "delivery-payment-proof", selectedPackage);
            setPaymentProofUrl(uploaded.fileUrl);
            setDeliveryStatus(photoUploadStatus(uploaded, "Payment proof uploaded."));
          });
        }} />
        <input ref={issuePhotoInputRef} className="hiddenInput" type="file" accept="image/*" onChange={(event) => {
          const file = event.target.files?.[0];
          if (!file) return;
          setDeliveryStatus("Saving issue photo...");
          onAction("Upload delivery issue photo", async () => {
            const uploaded = await uploadCompressedImage(file, "delivery-issue-photo", selectedPackage);
            setIssuePhotoUrl(uploaded.fileUrl);
            setDeliveryStatus(photoUploadStatus(uploaded, "Issue photo uploaded."));
          });
        }} />
        {mode === "arrived" && (
          <div className="buttonGrid">
            <button className="primaryButton" disabled={!selectedPackage} onClick={() => onAction("Verify cargo at branch", () => verifyPackage("Ready for Delivery"))}>Confirm Received at Branch</button>
            <button className="actionButton" disabled={!selectedPackage} onClick={() => void capturePhotoOrOpenPicker(issuePhotoInputRef, `issue-photo-${Date.now()}.jpg`, async (file) => {
              setDeliveryStatus("Saving issue photo...");
              await onAction("Upload delivery issue photo", async () => {
                const uploaded = await uploadCompressedImage(file, "delivery-issue-photo", selectedPackage);
                setIssuePhotoUrl(uploaded.fileUrl);
                setDeliveryStatus(photoUploadStatus(uploaded, "Issue photo uploaded."));
              });
            })}><Camera /> Add Issue Image</button>
            <button className="dangerButton" disabled={!selectedPackage} onClick={() => onAction("Report damaged cargo", () => verifyPackage("Damaged"))}>Damaged</button>
            <button className="dangerButton" disabled={!selectedPackage} onClick={() => onAction("Report missing cargo", () => verifyPackage("Missing"))}>Missing</button>
            <button className="dangerButton" disabled={!selectedPackage} onClick={() => onAction("Report cargo for checking", () => verifyPackage("For Checking"))}>For Checking</button>
          </div>
        )}
        {mode === "failed" && selectedCargo && (
          <div className="formGrid">
            <LongTextField label="Return Reason" value={returnReason} onChange={setReturnReason} placeholder="Reason for return" threshold={36} />
            <label>Next Action<select value={returnNextAction} onChange={(event) => setReturnNextAction(event.target.value as typeof returnNextAction)}>
              <option>Return to Sender</option>
              <option>Return to Origin</option>
              <option>Hold at Branch</option>
              <option>Reschedule</option>
            </select></label>
            <div className="settingTile"><span>Issue Photo</span><strong>{issuePhotoUrl ? "Photo saved" : "No photo yet"}</strong></div>
            <button className="actionButton" onClick={() => void capturePhotoOrOpenPicker(issuePhotoInputRef, `issue-photo-${Date.now()}.jpg`, async (file) => {
              setDeliveryStatus("Saving issue photo...");
              await onAction("Upload delivery issue photo", async () => {
                const uploaded = await uploadCompressedImage(file, "delivery-issue-photo", selectedPackage);
                setIssuePhotoUrl(uploaded.fileUrl);
                setDeliveryStatus(photoUploadStatus(uploaded, "Issue photo uploaded."));
              });
            })}><Camera /> Add Issue Image</button>
            <button className="primaryButton" disabled={!selectedPackage || !returnReason.trim()} onClick={() => onAction("Create return record", createReturn)}>Create Return Record</button>
          </div>
        )}
        {(mode === "deliver" || mode === "payments") && (
        <>
        <div className="formGrid">
          <label>Receiver Name<input value={recipient} onChange={(event) => setRecipient(event.target.value)} /></label>
          <label>Signature<input value={signature} onChange={(event) => setSignature(event.target.value)} placeholder="Typed signature fallback" /></label>
          <label>Amount Collected<input inputMode="decimal" value={amountCollected} onChange={(event) => setAmountCollected(event.target.value.replace(/[^\d.]/g, ""))} /></label>
          <label>Payment Method<select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}>{methods.map((entry) => <option key={entry}>{entry}</option>)}</select></label>
          <div className="settingTile"><span>Delivery Photo</span><strong>{deliveryPhoto ? "Photo saved" : "No photo yet"}</strong></div>
          <div className="settingTile"><span>Payment Proof</span><strong>{paymentProofUrl ? "Proof saved" : "No proof attached"}</strong></div>
        </div>
        <p className="notice">{deliveryStatus}</p>
        <div className="buttonGrid">
          <button className="actionButton" onClick={() => void capturePhotoOrOpenPicker(deliveryPhotoInputRef, `delivery-photo-${Date.now()}.jpg`, async (file) => {
            setDeliveryStatus("Saving delivery photo...");
            await onAction("Upload delivery photo", async () => {
              const uploaded = await uploadCompressedImage(file, "delivery-photo", selectedPackage);
              setDeliveryPhoto(uploaded.fileUrl);
              setDeliveryStatus(photoUploadStatus(uploaded, "Delivery photo uploaded."));
            });
          })}><Camera /> Add Delivery Image</button>
          <button className="actionButton" onClick={() => void capturePhotoOrOpenPicker(paymentProofInputRef, `delivery-payment-proof-${Date.now()}.jpg`, async (file) => {
            setDeliveryStatus("Saving payment proof...");
            await onAction("Upload payment proof", async () => {
              const uploaded = await uploadCompressedImage(file, "delivery-payment-proof", selectedPackage);
              setPaymentProofUrl(uploaded.fileUrl);
              setDeliveryStatus(photoUploadStatus(uploaded, "Payment proof uploaded."));
            });
          })}><Camera /> Add Payment Proof</button>
          <button className="primaryButton" disabled={!selectedPackage} onClick={() => onAction("Complete delivery", async () => {
            await recordDeliveryPaymentIfNeeded();
            await queueablePost("delivery", "/deliveries/complete", { cargoPackageId: selectedPackage, deliveredTo: recipient, signatureUrl: signature || "signature-captured", deliveryPhotoUrl: deliveryPhoto || "photo-captured", customerAcceptedDamage: true });
          })}>Complete Delivery</button>
          <button className="dangerButton" disabled={!selectedPackage} onClick={() => onAction("Record failed delivery", () => queueablePost("delivery", "/deliveries/fail", { cargoPackageId: selectedPackage, failedReason: "Customer Not Available", nextAction: "Reschedule", notes: "Customer not available during delivery attempt" }))}>Failed Delivery</button>
          <button
            className="actionButton"
            disabled={!selectedPackage}
            onClick={() =>
              onAction("Load delivery receipt", async () => {
                const result = await apiGet<{ text: string }>(`/packages/${selectedPackage}/delivery-receipt`);
                setReceiptPreview(result.text);
              })
            }
          >
            <Printer /> Preview Receipt
          </button>
        </div>
        </>
        )}
      </section>
      </>
      )}
    </div>
  );
}

function Payments({
  packages,
  payments,
  unpaidPackages,
  methods,
  activeUser,
  onAction,
  queueablePost
}: {
  packages: CargoPackage[];
  payments: PaymentRecord[];
  unpaidPackages: CargoPackage[];
  methods: string[];
  activeUser: OperatorUser;
  onAction: <T>(label: string, action: () => Promise<T>) => Promise<void>;
  queueablePost: QueueablePost;
}) {
  const [mode, setMode] = useState<"home" | "record" | "unpaid" | "history" | "billing">("home");
  const [selectedPackage, setSelectedPackage] = useState("");
  const [packageSearch, setPackageSearch] = useState("");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState(methods[0] ?? "Cash");
  const [proofUrl, setProofUrl] = useState("");
  const [paymentStatus, setPaymentStatus] = useState("Select a package, enter amount collected, then record payment.");
  const [unpaidListLimit, setUnpaidListLimit] = useState(LIST_PAGE_SIZE);
  const [paymentHistoryLimit, setPaymentHistoryLimit] = useState(LIST_PAGE_SIZE);
  const isOwner = isOwnerRole(activeUser.role);
  const collectionPoint = paymentCollectionPointForRole(activeUser.role);
  const collectedTotal = payments.reduce((sum, payment) => sum + payment.amountPaid, 0);
  const selectedCargo = packages.find((pkg) => pkg.id === selectedPackage);
  const packagePaymentTotals = new Map<string, number>();
  for (const payment of payments) {
    packagePaymentTotals.set(payment.cargoPackageId, (packagePaymentTotals.get(payment.cargoPackageId) ?? 0) + payment.amountPaid);
  }
  const packageBalance = (pkg: CargoPackage) => Math.max(Number(pkg.price ?? 0) - (packagePaymentTotals.get(pkg.id) ?? 0), 0);
  const packagePaymentStatus = (pkg: CargoPackage) => {
    const due = Number(pkg.price ?? 0);
    const paid = packagePaymentTotals.get(pkg.id) ?? 0;
    if (!due) return "No Price";
    if (paid >= due) return "Paid";
    if (paid > 0) return "Partial";
    return "Unpaid";
  };
  const searchedPaymentPackages = packages
    .filter((pkg) => {
      const query = packageSearch.trim().toLowerCase();
      const status = packagePaymentStatus(pkg);
      if (query.length < 2) return false;
      return [pkg.customerName, pkg.packageNumber, pkg.receivingRecordNumber, pkg.description, pkg.status, pkg.price, status]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(query);
    })
    .sort((a, b) => {
      const statusOrder = { Partial: 0, Unpaid: 1, "No Price": 2, Paid: 3 } as Record<string, number>;
      return (statusOrder[packagePaymentStatus(a)] ?? 4) - (statusOrder[packagePaymentStatus(b)] ?? 4);
    })
    .slice(0, 8);
  function selectPaymentPackage(pkg: CargoPackage) {
    const balance = packageBalance(pkg);
    setSelectedPackage(pkg.id);
    setPackageSearch(`${pkg.customerName} - ${pkg.packageNumber}`);
    setAmount(balance ? String(balance) : "");
    setProofUrl("");
    setPaymentStatus(`Selected ${pkg.packageNumber}. Balance PHP ${balance.toLocaleString()}.`);
  }
  useEffect(() => {
    if (selectedPackage) return;
    const query = packageSearch.trim().toLowerCase();
    if (!query) return;
    const exactPackage = packages.find((pkg) =>
      [pkg.packageNumber, pkg.qrValue, pkg.receivingRecordNumber]
        .some((value) => String(value ?? "").trim().toLowerCase() === query)
    );
    if (!exactPackage) return;

    const timer = window.setTimeout(() => {
      selectPaymentPackage(exactPackage);
    }, 160);

    return () => window.clearTimeout(timer);
  }, [packageSearch, packages, selectedPackage]);
  const showPaymentSuggestions = packageSearch.trim().length >= 2 && !selectedPackage;
  const displayedUnpaidPackages = unpaidPackages.slice(0, unpaidListLimit);
  const displayedPayments = payments.slice(0, paymentHistoryLimit);
  const proofInputRef = useRef<HTMLInputElement | null>(null);
  return (
    <div className="stack">
      {mode === "home" && (
        <ModuleTileLauncher
          eyebrow="Payments"
          title="What do you want to do?"
          description="Record collections, check unpaid packages, review payment history, or prepare billing follow-up."
          actions={[
            { key: "record", label: "Record Payment", note: "Collect money", icon: CreditCard, tone: "dark", onClick: () => setMode("record") },
            { key: "unpaid", label: "Unpaid", note: `${unpaidPackages.length} packages`, icon: AlertTriangle, count: unpaidPackages.length, tone: unpaidPackages.length ? "dark" : "light", onClick: () => setMode("unpaid") },
            { key: "history", label: "History", note: `${payments.length} records`, icon: ClipboardList, count: payments.length, tone: "light", onClick: () => setMode("history") },
            { key: "billing", label: "Billing", note: "Invoices / reminders", icon: ReceiptText, tone: "light", onClick: () => setMode("billing") }
          ]}
        />
      )}
      {mode === "record" && (
      <section className="panel compact">
        <div className="sectionHeader">
          <div>
            <h3>{isOwner ? "Payment Recording" : "Collected Money"}</h3>
            <p className="muted">{isOwner ? "Operational payment status only. This is not a full accounting module." : "Record only the money collected under your responsibility."}</p>
          </div>
          <button className="smallButton" onClick={() => setMode("home")}>Back</button>
        </div>
        {!isOwner && <p className="muted">Record money collected at receiving or delivery. Profit and financial reports are owner-only.</p>}
        {!isOwner && (
          <div className="grid accountInfoGrid">
            <div className="settingTile">
              <span>Collected by You</span>
              <strong>PHP {collectedTotal.toLocaleString()}</strong>
            </div>
            <div className="settingTile">
              <span>Unpaid / Partial</span>
              <strong>{unpaidPackages.length} package(s)</strong>
            </div>
          </div>
        )}
        <div className="paymentPicker">
          <AutocompleteField<CargoPackage>
            label="Package / Customer / DR"
            value={packageSearch}
            placeholder="Scan package QR or type customer"
            items={packages}
            selectedLabel={selectedCargo ? `${selectedCargo.customerName} - ${selectedCargo.packageNumber}` : ""}
            minChars={1}
            noResultsText="No package found."
            getLabel={(pkg) => `${pkg.customerName} - ${pkg.packageNumber}`}
            getMeta={(pkg) => `${pkg.description} / ${packagePaymentStatus(pkg)} / Balance PHP ${packageBalance(pkg).toLocaleString()}`}
            getSearchValues={(pkg) => [pkg.customerName, pkg.packageNumber, pkg.qrValue, pkg.receivingRecordNumber, pkg.description, pkg.consigneeName, pkg.status, pkg.price, packagePaymentStatus(pkg)]}
            getExactValues={(pkg) => [pkg.packageNumber, pkg.qrValue, pkg.receivingRecordNumber]}
            onChange={(value) => {
              setPackageSearch(value);
              setSelectedPackage("");
            }}
            onSelect={selectPaymentPackage}
            onInputEnter={(value, suggestions) => {
              if (suggestions.length > 1) {
                setPaymentStatus("Multiple packages found. Tap the correct package from the list.");
                return;
              }
              setPaymentStatus(value ? "No exact package found. Type customer, package, or DR number." : "Scan package QR or type customer.");
            }}
          />
        </div>
        {selectedCargo && (
          <div className="detailGrid compactDetailGrid paymentSummaryGrid">
            <div><span>Customer</span><strong>{selectedCargo.customerName}</strong></div>
            <div><span>Item</span><strong>{selectedCargo.description}</strong></div>
            <div><span>Amount Due</span><strong>PHP {Number(selectedCargo.price ?? 0).toLocaleString()}</strong></div>
            <div><span>Balance</span><strong>PHP {packageBalance(selectedCargo).toLocaleString()}</strong></div>
          </div>
        )}
        <div className="paymentEntryGrid">
          <label>Amount Paid<input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value.replace(/[^\d.]/g, ""))} /></label>
          <label>Method<select value={method} onChange={(event) => setMethod(event.target.value)}>{methods.map((entry) => <option key={entry}>{entry}</option>)}</select></label>
          <div className="settingTile">
            <span>Proof</span>
            <strong>{proofUrl ? "Proof saved" : "No proof attached"}</strong>
          </div>
        </div>
        <input ref={proofInputRef} className="hiddenInput" type="file" accept="image/*" onChange={(event) => {
          const file = event.target.files?.[0];
          if (!file) return;
          setPaymentStatus("Saving proof of payment...");
          onAction("Upload payment proof", async () => {
            const uploaded = await uploadCompressedImage(file, "payment-proof", selectedPackage);
            setProofUrl(uploaded.fileUrl);
            setPaymentStatus(photoUploadStatus(uploaded, "Proof of payment uploaded."));
          });
        }} />
        <p className="notice">{paymentStatus}</p>
        <div className="buttonGrid two">
          <button className="actionButton" onClick={() => void capturePhotoOrOpenPicker(proofInputRef, `payment-proof-${Date.now()}.jpg`, async (file) => {
            setPaymentStatus("Saving proof of payment...");
            await onAction("Upload payment proof", async () => {
              const uploaded = await uploadCompressedImage(file, "payment-proof", selectedPackage);
              setProofUrl(uploaded.fileUrl);
              setPaymentStatus(photoUploadStatus(uploaded, "Proof of payment uploaded."));
            });
          })}><Camera /> Proof Image</button>
          <button
            className="primaryButton"
            disabled={!selectedPackage || !amount}
            onClick={() =>
              onAction("Record payment", () =>
                queueablePost("payment", "/payments", {
                  cargoPackageId: selectedPackage,
                  amountPaid: Number(amount),
                  method,
                  collectionPoint,
                  collectedByUserId: activeUser.id,
                  collectedByName: activeUser.name,
                  collectedByRole: activeUser.role,
                  proofUrl: proofUrl || "proof-uploaded",
                  notes: `${collectionPoint} operational payment record`
                })
              )
            }
          >
            Record Payment
          </button>
        </div>
      </section>
      )}
      {mode === "unpaid" && (
      <section className="panel">
        <div className="sectionHeader">
          <div>
            <h3>{isOwner ? "Need Payment Review" : "Who Has Not Paid"}</h3>
            <p className="muted">Tap a package to record a collection.</p>
          </div>
          <button className="smallButton" onClick={() => setMode("home")}>Back</button>
        </div>
        <div className="list compactList">
          {displayedUnpaidPackages.map((pkg) => (
            <button className="row tappableRow compactDataRow" key={pkg.id} onClick={() => selectPaymentPackage(pkg)}>
              <div>
                <strong>{pkg.customerName}</strong>
                <p>{pkg.packageNumber} - {pkg.description}</p>
                <p className="muted">{pkg.status} / {pkg.receivingRecordNumber}</p>
              </div>
              <div className="compactRowMeta">
                <span className="badge warning">Unpaid</span>
                <span className="badge">{pkg.price == null ? "No price" : `PHP ${pkg.price.toLocaleString()}`}</span>
              </div>
            </button>
          ))}
          {!unpaidPackages.length && <p className="muted">No unpaid packages in your responsibility list.</p>}
          {unpaidPackages.length > displayedUnpaidPackages.length && (
            <button className="loadMoreButton" type="button" onClick={() => setUnpaidListLimit((limit) => limit + LIST_PAGE_SIZE)}>
              Show more unpaid ({unpaidPackages.length - displayedUnpaidPackages.length} left)
            </button>
          )}
        </div>
      </section>
      )}
      {mode === "history" && (
      <section className="panel">
        <div className="sectionHeader">
          <div>
            <h3>{isOwner ? "Payment History" : "Collected Money Records"}</h3>
            <p className="muted">Review operational payment records.</p>
          </div>
          <button className="smallButton" onClick={() => setMode("home")}>Back</button>
        </div>
        <div className="list compactList">
          {displayedPayments.map((payment) => (
            <div className="row compactDataRow" key={payment.id}>
              <div>
                <strong>PHP {payment.amountPaid.toLocaleString()} - {payment.method}</strong>
                <p>{isOwner ? `Balance: PHP ${payment.balance.toLocaleString()}` : `${payment.collectionPoint ?? collectionPoint} - ${payment.collectedByName ?? activeUser.name}`}</p>
              </div>
              <div className="compactRowMeta">
                <span className="badge">{payment.status}</span>
              </div>
            </div>
          ))}
          {!payments.length && <p className="muted">No payment records found.</p>}
          {payments.length > displayedPayments.length && (
            <button className="loadMoreButton" type="button" onClick={() => setPaymentHistoryLimit((limit) => limit + LIST_PAGE_SIZE)}>
              Show more payments ({payments.length - displayedPayments.length} left)
            </button>
          )}
        </div>
      </section>
      )}
      {mode === "billing" && (
        <section className="panel">
          <div className="sectionHeader">
            <div>
              <h3>Billing</h3>
              <p className="muted">Billing statements and reminders are managed from the Customers module so balances stay tied to the customer account.</p>
            </div>
            <button className="smallButton" onClick={() => setMode("home")}>Back</button>
          </div>
          <p className="notice">Open Customers, select a customer, then use Billing Invoice or Notify Owner / SMS Soon.</p>
        </section>
      )}
    </div>
  );
}

function Expenses({
  categories,
  expenses,
  trips,
  activeUser,
  onAction,
  queueablePost
}: {
  categories: string[];
  expenses: ExpenseRecord[];
  trips: Trip[];
  activeUser: OperatorUser;
  onAction: <T>(label: string, action: () => Promise<T>) => Promise<void>;
  queueablePost: QueueablePost;
}) {
  const [mode, setMode] = useState<"home" | "record" | "history" | "categories" | "review">("home");
  const [category, setCategory] = useState(categories[0] ?? "Fuel");
  const [categorySearch, setCategorySearch] = useState("");
  const [showMoreCategories, setShowMoreCategories] = useState(false);
  const [amount, setAmount] = useState("1000");
  const [tripSearch, setTripSearch] = useState("");
  const [selectedTripId, setSelectedTripId] = useState("");
  const [receiptUrl, setReceiptUrl] = useState("");
  const [expenseStatus, setExpenseStatus] = useState("Add the expense amount and attach a receipt photo when available.");
  const [expenseHistoryLimit, setExpenseHistoryLimit] = useState(LIST_PAGE_SIZE);
  const isOwner = isOwnerRole(activeUser.role);
  const receiptInputRef = useRef<HTMLInputElement | null>(null);
  const selectedTrip = trips.find((trip) => trip.id === selectedTripId);
  const categoryDisplay = (entry: string) =>
    entry
      .replace(/^Driver Allowance$/i, "Driver")
      .replace(/^Helper Allowance$/i, "Helper")
      .replace(/^Miscellaneous$/i, "Misc.");
  const quickCategorySpecs = [
    { label: "Fuel", aliases: ["Fuel"] },
    { label: "Truck Rental", aliases: ["Truck Rental"] },
    { label: "Driver", aliases: ["Driver", "Driver Allowance"] },
    { label: "Helper", aliases: ["Helper", "Helper Allowance"] },
    { label: "Meals", aliases: ["Meals"] },
    { label: "Parking", aliases: ["Parking"] },
    { label: "Repairs", aliases: ["Repairs"] },
    { label: "Labor", aliases: ["Labor", "Loading Labor", "Unloading Labor"] },
    { label: "Misc.", aliases: ["Misc.", "Miscellaneous"] }
  ];
  const quickCategories = quickCategorySpecs.map((spec) => ({
    label: spec.label,
    value: categories.find((entry) => spec.aliases.some((alias) => alias.toLowerCase() === entry.toLowerCase())) ?? spec.label
  }));
  const primaryCategories = quickCategories.slice(0, 5);
  const moreCategories = quickCategories.slice(5);
  const searchedCategories = categories
    .filter((entry) => {
      const query = categorySearch.trim().toLowerCase();
      if (query.length < 2) return false;
      return `${entry} ${categoryDisplay(entry)}`.toLowerCase().includes(query);
    })
    .slice(0, 6);
  const searchedTrips = trips
    .filter((trip) => {
      const query = tripSearch.trim().toLowerCase();
      if (query.length < 2) return false;
      return [
        trip.tripNumber,
        trip.destination,
        trip.status,
        trip.plateNumber,
        trip.vehicleDescription,
        trip.driverName,
        trip.truckOwnerName
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(query);
    })
    .slice(0, 8);
  const expenseTripNumber = (expense: ExpenseRecord) => trips.find((trip) => trip.id === expense.tripId)?.tripNumber ?? "No linked trip";
  const displayedExpenses = expenses.slice(0, expenseHistoryLimit);
  function selectTrip(trip: Trip) {
    setSelectedTripId(trip.id);
    setTripSearch(`${trip.tripNumber} - ${trip.destination}`);
    setExpenseStatus(`Linked to ${trip.tripNumber}.`);
  }
  useEffect(() => {
    if (selectedTripId) return;
    const query = tripSearch.trim().toLowerCase();
    if (!query) return;
    const exactTrip = trips.find((trip) =>
      [trip.tripNumber, trip.plateNumber]
        .some((value) => String(value ?? "").trim().toLowerCase() === query)
    );
    if (!exactTrip) return;

    const timer = window.setTimeout(() => {
      selectTrip(exactTrip);
    }, 160);

    return () => window.clearTimeout(timer);
  }, [selectedTripId, tripSearch, trips]);
  return (
    <div className="stack">
      {mode === "home" && (
        <ModuleTileLauncher
          eyebrow="Expenses"
          title="What do you want to do?"
          description="Submit operating expenses, review submitted records, or check expense categories."
          actions={[
            { key: "record", label: "Add Expense", note: "Submit receipt", icon: WalletCards, tone: "dark", onClick: () => setMode("record") },
            { key: "submitted", label: "Submitted", note: `${expenses.length} records`, icon: ClipboardList, count: expenses.length, tone: "light", onClick: () => setMode("history") },
            { key: "review", label: "Needs Review", note: `${expenses.filter((expense) => expense.status === "Submitted").length} submitted`, icon: AlertTriangle, count: expenses.filter((expense) => expense.status === "Submitted").length, tone: expenses.some((expense) => expense.status === "Submitted") ? "dark" : "light", onClick: () => setMode("review") },
            { key: "categories", label: "Categories", note: `${categories.length} saved`, icon: Settings, count: categories.length, tone: "light", onClick: () => setMode("categories") }
          ]}
        />
      )}
      {mode === "record" && (
      <section className="panel compact">
        <div className="sectionHeader">
          <div>
            <h3>{isOwner ? "Expense Recording" : "Add Expense"}</h3>
            <p className="muted">{isOwner ? "Review operating expenses and receipts by trip." : "Submit operating expenses. Owner approval and profit impact are hidden."}</p>
          </div>
          <button className="smallButton" onClick={() => setMode("home")}>Back</button>
        </div>
        <div className="expenseTopGrid">
          <label>Amount<input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value.replace(/[^\d.]/g, ""))} /></label>
          <AutocompleteField<Trip>
            label="Trip / Plate / Driver"
            value={tripSearch}
            placeholder="Type trip, plate, or driver"
            items={trips}
            selectedLabel={selectedTrip ? `${selectedTrip.tripNumber} - ${selectedTrip.destination}` : ""}
            minChars={1}
            noResultsText="No trip found."
            getLabel={(trip) => `${trip.tripNumber} - ${trip.destination}`}
            getMeta={(trip) => `${trip.plateNumber ?? trip.vehicleDescription ?? "No plate"} / ${trip.driverName ?? "No driver"} / ${trip.status}`}
            getSearchValues={(trip) => [trip.tripNumber, trip.destination, trip.status, trip.plateNumber, trip.vehicleDescription, trip.driverName, trip.truckOwnerName]}
            getExactValues={(trip) => [trip.tripNumber, trip.plateNumber]}
            onChange={(value) => {
              setTripSearch(value);
              setSelectedTripId("");
            }}
            onSelect={selectTrip}
            onInputEnter={(value, suggestions) => {
              if (suggestions.length > 1) {
                setExpenseStatus("Multiple trips found. Tap the correct trip from the list.");
                return;
              }
              setExpenseStatus(value ? "No exact trip found. Try trip number, plate, or driver." : "Type trip, plate, or driver.");
            }}
          />
        </div>
        {selectedTrip && (
          <div className="compactSelectedBox expenseTripSelected">
            <div>
              <strong>{selectedTrip.tripNumber} - {selectedTrip.destination}</strong>
              <p className="muted">{selectedTrip.plateNumber ?? selectedTrip.vehicleDescription ?? "No plate"} / {selectedTrip.driverName ?? "No driver"}</p>
            </div>
            <button className="textButton" onClick={() => {
              setSelectedTripId("");
              setTripSearch("");
            }} type="button">Change</button>
          </div>
        )}
        <div className="expenseCategoryStrip">
          {primaryCategories.map((entry) => (
            <button
              className={category === entry.value ? "expenseCategoryButton active" : "expenseCategoryButton"}
              key={entry.label}
              onClick={() => {
                setCategory(entry.value);
                setCategorySearch("");
              }}
              type="button"
            >
              {entry.label}
            </button>
          ))}
          <button
            className={showMoreCategories ? "expenseCategoryButton active" : "expenseCategoryButton"}
            onClick={() => setShowMoreCategories((value) => !value)}
            type="button"
          >
            More
          </button>
        </div>
        {showMoreCategories && (
          <div className="expenseMorePanel">
            <div className="expenseCategoryStrip secondary">
              {moreCategories.map((entry) => (
                <button
                  className={category === entry.value ? "expenseCategoryButton active" : "expenseCategoryButton"}
                  key={entry.label}
                  onClick={() => {
                    setCategory(entry.value);
                    setCategorySearch("");
                  }}
                  type="button"
                >
                  {entry.label}
                </button>
              ))}
            </div>
            <AutocompleteField<string>
              value={categorySearch}
              placeholder="Type category"
              items={categories}
              selectedLabel=""
              minChars={1}
              noResultsText={categorySearch.trim() ? `No saved category. Press Use Typed Category below.` : "Type category"}
              getLabel={(entry) => categoryDisplay(entry)}
              getSearchValues={(entry) => [entry, categoryDisplay(entry)]}
              onChange={setCategorySearch}
              onSelect={(entry) => {
                setCategory(entry);
                setCategorySearch("");
                setShowMoreCategories(false);
              }}
            />
            {categorySearch.trim() && !searchedCategories.length && (
              <button
                className="smallButton"
                onClick={() => {
                  setCategory(categorySearch.trim());
                  setCategorySearch("");
                  setShowMoreCategories(false);
                }}
                type="button"
              >
                Use Typed Category
              </button>
            )}
          </div>
        )}
        <div className="expenseSelectedLine">
          <span>{categoryDisplay(category)}</span>
          <span>{receiptUrl ? "Receipt attached" : "No receipt"}</span>
        </div>
        <input ref={receiptInputRef} className="hiddenInput" type="file" accept="image/*" onChange={(event) => {
          const file = event.target.files?.[0];
          if (!file) return;
          setExpenseStatus("Saving receipt photo...");
          onAction("Upload expense receipt", async () => {
            const uploaded = await uploadCompressedImage(file, "expense-receipt", selectedTrip?.id);
            setReceiptUrl(uploaded.fileUrl);
            setExpenseStatus(photoUploadStatus(uploaded, "Receipt photo attached."));
          });
        }} />
        <p className="notice">{expenseStatus}</p>
        <div className="expenseSubmitRow">
          <button className="actionButton expensePhotoButton" onClick={() => void capturePhotoOrOpenPicker(receiptInputRef, `expense-receipt-${Date.now()}.jpg`, async (file) => {
            setExpenseStatus("Saving receipt photo...");
            await onAction("Upload expense receipt", async () => {
              const uploaded = await uploadCompressedImage(file, "expense-receipt", selectedTrip?.id);
              setReceiptUrl(uploaded.fileUrl);
              setExpenseStatus(photoUploadStatus(uploaded, "Receipt photo attached."));
            });
          })}><Camera /> Receipt Image</button>
          <button
            className="primaryButton"
            disabled={!amount}
            onClick={() =>
              onAction("Submit expense", async () => {
                const expense = await queueablePost("expense", "/expenses", {
                  tripId: selectedTrip?.id,
                  category,
                  amount: Number(amount),
                  description: "Operational expense",
                  receiptUrl: receiptUrl || undefined
                });
                setExpenseStatus("Submitted for owner review.");
                setReceiptUrl("");
                return expense;
              })
            }
          >
            Submit Expense
          </button>
        </div>
      </section>
      )}
      {mode === "history" && (
      <section className="panel">
        <div className="sectionHeader">
          <div>
            <h3>{isOwner ? "Expense History" : "Submitted Expenses"}</h3>
            <p className="muted">Review operating expense records.</p>
          </div>
          <button className="smallButton" onClick={() => setMode("home")}>Back</button>
        </div>
        <div className="list compactList">
          {displayedExpenses.map((expense) => (
            <div className="row compactDataRow" key={expense.id}>
              <div>
                <strong>{categoryDisplay(expense.category)} - PHP {expense.amount.toLocaleString()}</strong>
                <p className="muted">{expenseTripNumber(expense)} / {formatSearchDate(expense.createdAt)}{expense.receiptUrl ? " / Receipt attached" : ""}</p>
              </div>
              <div className="compactRowMeta">
                <span className="badge">{expense.status}</span>
              </div>
            </div>
          ))}
          {!expenses.length && <p className="muted">No expense records found.</p>}
          {expenses.length > displayedExpenses.length && (
            <button className="loadMoreButton" type="button" onClick={() => setExpenseHistoryLimit((limit) => limit + LIST_PAGE_SIZE)}>
              Show more expenses ({expenses.length - displayedExpenses.length} left)
            </button>
          )}
        </div>
      </section>
      )}
      {mode === "review" && (
        <section className="panel">
          <div className="sectionHeader">
            <div>
              <h3>Needs Review</h3>
              <p className="muted">Submitted expenses waiting for owner/admin review.</p>
            </div>
            <button className="smallButton" onClick={() => setMode("home")}>Back</button>
          </div>
          <div className="list compactList">
            {expenses.filter((expense) => expense.status === "Submitted").map((expense) => (
              <div className="row compactDataRow" key={expense.id}>
                <div>
                  <strong>{categoryDisplay(expense.category)} - PHP {expense.amount.toLocaleString()}</strong>
                  <p className="muted">{expenseTripNumber(expense)} / {formatSearchDate(expense.createdAt)}{expense.receiptUrl ? " / Receipt attached" : ""}</p>
                </div>
                <div className="compactRowMeta">
                  <span className="badge warning">{expense.status}</span>
                </div>
              </div>
            ))}
            {!expenses.some((expense) => expense.status === "Submitted") && <p className="muted">No expenses need review.</p>}
          </div>
        </section>
      )}
      {mode === "categories" && (
        <section className="panel">
          <div className="sectionHeader">
            <div>
              <h3>Categories</h3>
              <p className="muted">Saved expense categories. Edit the list from Settings.</p>
            </div>
            <button className="smallButton" onClick={() => setMode("home")}>Back</button>
          </div>
          <div className="list compactList">
            {categories.map((entry) => <div className="row denseRow" key={entry}><strong>{categoryDisplay(entry)}</strong></div>)}
            {!categories.length && <p className="muted">No categories configured.</p>}
          </div>
        </section>
      )}
    </div>
  );
}

function OperationsChat({
  activeUser,
  threads,
  packages,
  onAction
}: {
  activeUser: OperatorUser;
  threads: OperationChatThread[];
  packages: CargoPackage[];
  onAction: <T>(label: string, action: () => Promise<T>) => Promise<void>;
}) {
  const [mode, setMode] = useState<"home" | "global" | "approvals" | "request" | "threads">("home");
  const [selectedThreadId, setSelectedThreadId] = useState("");
  const [messageBody, setMessageBody] = useState("");
  const [packageQuery, setPackageQuery] = useState("");
  const [selectedPackageId, setSelectedPackageId] = useState("");
  const [proposedPrice, setProposedPrice] = useState("");
  const [requestNote, setRequestNote] = useState("");
  const [approvalPrices, setApprovalPrices] = useState<Record<string, string>>({});
  const [approvalNotes, setApprovalNotes] = useState<Record<string, string>>({});
  const globalThread = threads.find((thread) => thread.scope === "Global");
  const priceApprovalThreads = threads.filter((thread) => thread.actionType === "PriceApproval");
  const pendingPriceApprovals = priceApprovalThreads.filter((thread) => thread.status === "Needs Approval");
  const selectedThread = threads.find((thread) => thread.id === selectedThreadId) ?? (mode === "global" ? globalThread : undefined);
  const canApprovePrices = isOwnerRole(activeUser.role) || activeUser.role === "System Admin" || activeUser.role === "Administrator";
  const packagesNeedingPrice = packages.filter((pkg) => pkg.price == null || pkg.status === "Waiting for Price");
  const matchingPackages = packages
    .filter((pkg) => rankSearchResult([pkg.packageNumber, pkg.customerName, pkg.description, pkg.receivingRecordNumber, pkg.destination], packageQuery) > 0)
    .slice(0, 8);
  const selectedPackage = packages.find((pkg) => pkg.id === selectedPackageId);

  useEffect(() => {
    if (selectedThreadId && threads.some((thread) => thread.id === selectedThreadId)) return;
    if (mode === "global" && globalThread) setSelectedThreadId(globalThread.id);
  }, [globalThread, mode, selectedThreadId, threads]);

  async function sendMessage(threadId?: string) {
    const body = messageBody.trim();
    if (!body) return;
    await apiPost("/operation-chats/messages", { threadId, body });
    setMessageBody("");
  }

  async function sendPriceRequest() {
    if (!selectedPackage || !Number(proposedPrice)) return;
    await apiPost("/operation-chats/price-requests", {
      cargoPackageId: selectedPackage.id,
      proposedPrice: Number(proposedPrice),
      note: requestNote.trim()
    });
    setPackageQuery("");
    setSelectedPackageId("");
    setProposedPrice("");
    setRequestNote("");
    setMode("approvals");
  }

  async function decidePrice(thread: OperationChatThread, decision: "Approved" | "Rejected") {
    await apiPost(`/operation-chats/${thread.id}/price-decision`, {
      decision,
      approvedPrice: decision === "Approved" ? Number(approvalPrices[thread.id] || thread.proposedPrice || 0) : undefined,
      note: approvalNotes[thread.id]?.trim()
    });
  }

  function openThread(threadId: string) {
    setSelectedThreadId(threadId);
    setMode("threads");
  }

  return (
    <div className="stack">
      {mode === "home" && (
        <ModuleTileLauncher
          eyebrow="Operations Chat"
          title="What do you want to do?"
          description="Coordinate with staff, send prices for approval, and keep a short audit trail of decisions."
          actions={[
            { key: "global", label: "Global Chat", note: `${globalThread?.messages.length ?? 0} messages`, icon: MessageCircle, count: globalThread?.messages.length ? undefined : 0, tone: "light", onClick: () => setMode("global") },
            { key: "approvals", label: "Approvals", note: `${pendingPriceApprovals.length} price requests`, icon: CheckCircle2, count: pendingPriceApprovals.length, tone: pendingPriceApprovals.length ? "dark" : "light", onClick: () => setMode("approvals") },
            { key: "request", label: "Request Price", note: `${packagesNeedingPrice.length} without price`, icon: CreditCard, count: packagesNeedingPrice.length, tone: packagesNeedingPrice.length ? "medium" : "light", onClick: () => setMode("request") },
            { key: "threads", label: "All Threads", note: `${threads.length} conversations`, icon: ClipboardList, count: threads.length, tone: "light", onClick: () => setMode("threads") }
          ]}
        />
      )}

      {mode === "global" && (
        <section className="panel compact">
          <div className="sectionHeader">
            <div>
              <h3>Global Chat</h3>
              <p className="muted">Internal staff and owner coordination. Customers cannot see this chat.</p>
            </div>
            <button className="smallButton" onClick={() => setMode("home")}>Back</button>
          </div>
          <ChatMessages thread={globalThread} />
          <div className="chatComposer">
            <input value={messageBody} onChange={(event) => setMessageBody(event.target.value)} placeholder="Type a short update or question" />
            <button className="primaryButton" disabled={!messageBody.trim()} onClick={() => onAction("Send chat message", () => sendMessage(globalThread?.id))}>Send</button>
          </div>
        </section>
      )}

      {mode === "approvals" && (
        <section className="panel compact">
          <div className="sectionHeader">
            <div>
              <h3>Price Approvals</h3>
              <p className="muted">Staff can request a price. Branch owners approve or reject here.</p>
            </div>
            <button className="smallButton" onClick={() => setMode("home")}>Back</button>
          </div>
          <div className="list compactList">
            {priceApprovalThreads.map((thread) => (
              <div className="row denseRow chatApprovalCard" key={thread.id}>
                <div>
                  <strong>{thread.description ?? thread.packageNumber}</strong>
                  <p>{thread.packageNumber} - {thread.customerName}</p>
                  <p className="muted">{thread.branchName ?? "No branch"} / Requested by {thread.requestedByName ?? "staff"}</p>
                  <span className={thread.status === "Needs Approval" ? "badge warning" : "badge"}>{thread.status}</span>
                </div>
                <div className="chatApprovalActions">
                  <label>
                    Price
                    <input
                      value={approvalPrices[thread.id] ?? String(thread.proposedPrice ?? "")}
                      onChange={(event) => setApprovalPrices((values) => ({ ...values, [thread.id]: event.target.value.replace(/[^\d.]/g, "") }))}
                      inputMode="decimal"
                      disabled={!canApprovePrices || thread.status !== "Needs Approval"}
                    />
                  </label>
                  <LongTextField
                    label="Note"
                    value={approvalNotes[thread.id] ?? ""}
                    onChange={(value) => setApprovalNotes((values) => ({ ...values, [thread.id]: value }))}
                    placeholder="Reason or instruction"
                    threshold={36}
                    disabled={!canApprovePrices || thread.status !== "Needs Approval"}
                  />
                  <div className="buttonGrid two">
                    <button className="primaryButton" disabled={!canApprovePrices || thread.status !== "Needs Approval"} onClick={() => onAction("Approve price in chat", () => decidePrice(thread, "Approved"))}>Approve</button>
                    <button className="smallButton" disabled={!canApprovePrices || thread.status !== "Needs Approval"} onClick={() => onAction("Reject price in chat", () => decidePrice(thread, "Rejected"))}>Reject</button>
                  </div>
                  <button className="smallButton" onClick={() => openThread(thread.id)}>Open Chat</button>
                </div>
              </div>
            ))}
            {!priceApprovalThreads.length && <p className="muted">No price approval threads yet.</p>}
          </div>
        </section>
      )}

      {mode === "request" && (
        <section className="panel compact">
          <div className="sectionHeader">
            <div>
              <h3>Request Price Approval</h3>
              <p className="muted">Use this when receiving or delivery staff needs the owner to confirm a package price.</p>
            </div>
            <button className="smallButton" onClick={() => setMode("home")}>Back</button>
          </div>
          <label>Find Package<input value={packageQuery} onChange={(event) => setPackageQuery(event.target.value)} placeholder="Package, customer, item, DR" /></label>
          <div className="list compactList">
            {(packageQuery ? matchingPackages : packagesNeedingPrice.slice(0, 8)).map((pkg) => (
              <button className={`row denseRow tappableRow ${selectedPackageId === pkg.id ? "selectedRecord" : ""}`} key={pkg.id} onClick={() => {
                setSelectedPackageId(pkg.id);
                setPackageQuery(`${pkg.packageNumber} - ${pkg.description}`);
                setProposedPrice(pkg.price == null ? "" : String(pkg.price));
              }}>
                <div>
                  <strong>{pkg.description}</strong>
                  <p>{pkg.packageNumber} - {pkg.customerName}</p>
                  <p className="muted">{pkg.receivingRecordNumber} / {pkg.handlingBranchName ?? pkg.destination} / {pkg.price == null ? "No price" : `PHP ${pkg.price.toLocaleString()}`}</p>
                </div>
                <span className={pkg.price == null ? "badge warning" : "badge"}>{pkg.status}</span>
              </button>
            ))}
          </div>
          {selectedPackage && (
            <div className="subPanel">
              <strong>{selectedPackage.description}</strong>
              <p className="muted">{selectedPackage.packageNumber} - {selectedPackage.customerName}</p>
              <div className="formGrid">
                <label>Proposed Price<input value={proposedPrice} onChange={(event) => setProposedPrice(event.target.value.replace(/[^\d.]/g, ""))} inputMode="decimal" placeholder="Amount" /></label>
                <label>Note<input value={requestNote} onChange={(event) => setRequestNote(event.target.value)} placeholder="Why this price" /></label>
              </div>
              <button className="primaryButton" disabled={!Number(proposedPrice)} onClick={() => onAction("Send price request", sendPriceRequest)}>Send to Owner</button>
            </div>
          )}
        </section>
      )}

      {mode === "threads" && (
        <section className="panel compact">
          <div className="sectionHeader">
            <div>
              <h3>All Threads</h3>
              <p className="muted">Open a thread to read the decision trail and continue the conversation.</p>
            </div>
            <button className="smallButton" onClick={() => setMode("home")}>Back</button>
          </div>
          <div className="list compactList">
            {threads.map((thread) => (
              <button className="row denseRow tappableRow" key={thread.id} onClick={() => setSelectedThreadId(thread.id)}>
                <div>
                  <strong>{thread.title}</strong>
                  <p>{thread.packageNumber ?? thread.scope} {thread.customerName ? `- ${thread.customerName}` : ""}</p>
                  <p className="muted">{thread.messages.at(-1)?.body ?? "No messages yet"}</p>
                </div>
                <span className={thread.status === "Needs Approval" ? "badge warning" : "badge"}>{thread.status}</span>
              </button>
            ))}
            {!threads.length && <p className="muted">No chat threads found.</p>}
          </div>
          {selectedThread && (
            <div className="subPanel">
              <div className="sectionHeader">
                <div>
                  <h4>{selectedThread.title}</h4>
                  <p className="muted">{selectedThread.packageNumber ?? selectedThread.scope}</p>
                </div>
                <span className={selectedThread.status === "Needs Approval" ? "badge warning" : "badge"}>{selectedThread.status}</span>
              </div>
              <ChatMessages thread={selectedThread} />
              <div className="chatComposer">
                <input value={messageBody} onChange={(event) => setMessageBody(event.target.value)} placeholder="Reply to this thread" />
                <button className="primaryButton" disabled={!messageBody.trim()} onClick={() => onAction("Reply to chat thread", () => sendMessage(selectedThread.id))}>Send</button>
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function ChatMessages({ thread }: { thread?: OperationChatThread }) {
  if (!thread) return <p className="muted">Chat is loading.</p>;
  return (
    <div className="chatMessageList">
      {thread.messages.map((message) => (
        <div className={message.system ? "chatMessage system" : "chatMessage"} key={message.id}>
          <div className="chatMessageMeta">
            <strong>{message.senderName}</strong>
            <span>{message.senderRole} / {formatSearchDate(message.createdAt)}</span>
          </div>
          <p>{message.body}</p>
        </div>
      ))}
    </div>
  );
}

function CustomerPortal({
  customers,
  packages,
  payments,
  setReceiptPreview,
  onAction
}: {
  customers: BootstrapData["customers"];
  packages: CargoPackage[];
  payments: PaymentRecord[];
  setReceiptPreview: (value: string) => void;
  onAction: <T>(label: string, action: () => Promise<T>) => Promise<void>;
}) {
  const [mode, setMode] = useState<"home" | "list" | "messages">("home");
  const [customerSearch, setCustomerSearch] = useState("");
  const [customerListLimit, setCustomerListLimit] = useState(LIST_PAGE_SIZE);
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [customerEditOpen, setCustomerEditOpen] = useState(false);
  const [contactFormOpen, setContactFormOpen] = useState(false);
  const [editCompanyName, setEditCompanyName] = useState("");
  const [editTin, setEditTin] = useState("");
  const [editCompanyPhone, setEditCompanyPhone] = useState("");
  const [editCompanyAddress, setEditCompanyAddress] = useState("");
  const [editBillingAddress, setEditBillingAddress] = useState("");
  const [editShippingAddress, setEditShippingAddress] = useState("");
  const [editBillingSameAsCompany, setEditBillingSameAsCompany] = useState(false);
  const [editShippingSameAsCompany, setEditShippingSameAsCompany] = useState(false);
  const [newContactName, setNewContactName] = useState("");
  const [newContactRole, setNewContactRole] = useState("Operations");
  const [newContactCustomRole, setNewContactCustomRole] = useState("");
  const [newContactPhone, setNewContactPhone] = useState("");
  const [newContactEmail, setNewContactEmail] = useState("");
  const [newContactAddress, setNewContactAddress] = useState("");
  const [newContactSameAddress, setNewContactSameAddress] = useState(true);
  const [newContactBillingAddress, setNewContactBillingAddress] = useState("");
  const [newContactShippingAddress, setNewContactShippingAddress] = useState("");
  const [newContactNotes, setNewContactNotes] = useState("");
  const [newContactPrimary, setNewContactPrimary] = useState(false);
  const [messagePackage, setMessagePackage] = useState("");
  const [messageBody, setMessageBody] = useState("Please confirm delivery schedule.");
  const [status, setStatus] = useState("Select a shipment before sending a message.");
  const selectedCustomer = customers.find((customer) => customer.id === selectedCustomerId);
  const paymentTotalsByPackage = payments.reduce<Record<string, number>>((totals, payment) => {
    totals[payment.cargoPackageId] = (totals[payment.cargoPackageId] ?? 0) + payment.amountPaid;
    return totals;
  }, {});
  const selectedCustomerPackages = selectedCustomer
    ? packages.filter((pkg) => pkg.customerName === selectedCustomer.businessName)
    : [];
  const ongoingCustomerPackages = selectedCustomerPackages.filter((pkg) => !["Delivered", "Cancelled", "Failed Delivery"].includes(pkg.status));
  const recentCustomerPackages = [...selectedCustomerPackages]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 8);
  const customerAmountDue = selectedCustomerPackages.reduce((sum, pkg) => sum + Number(pkg.price ?? 0), 0);
  const customerAmountPaid = selectedCustomerPackages.reduce((sum, pkg) => sum + (paymentTotalsByPackage[pkg.id] ?? 0), 0);
  const customerBalance = Math.max(customerAmountDue - customerAmountPaid, 0);
  const customerDeliveredUnpaid = selectedCustomerPackages.filter((pkg) => pkg.status === "Delivered" && Math.max(Number(pkg.price ?? 0) - (paymentTotalsByPackage[pkg.id] ?? 0), 0) > 0).length;
  const customerDueDateLabel = selectedCustomer?.billingTerm?.toLowerCase().includes("30")
    ? "30 days after delivery"
    : selectedCustomer?.billingTerm?.toLowerCase().includes("upon")
      ? "Upon delivery"
      : selectedCustomer?.billingTerm ?? "Not set";
  const customerPaymentStatus = customerBalance <= 0 ? "Paid" : customerDeliveredUnpaid > 0 ? "Due / Follow up" : "Open";
  const customerBillingBranch = selectedCustomerPackages.find((pkg) => pkg.handlingBranchName)?.handlingBranchName ?? selectedCustomerPackages.find((pkg) => pkg.destination)?.destination ?? "Assigned branch";
  const visibleCustomers = customers
    .filter((customer) => !/(demo|test)/i.test(customer.businessName))
    .filter((customer) => {
      const query = customerSearch.trim();
      if (!query) return true;
      return rankSearchResult([
        customer.businessName,
        customer.tin,
        customer.companyPhone,
        customer.contactPerson,
        customer.phone,
        customer.address,
        customer.billingAddress,
        customer.shippingAddress,
        ...(customer.contacts ?? []).flatMap((contact) => [contact.name, contact.role, contact.phone, contact.email, contact.address])
      ], query) > 0;
    });
  const displayedCustomers = visibleCustomers.slice(0, customerListLimit);
  const packageCountByCustomer = packages.reduce<Record<string, number>>((counts, pkg) => {
    counts[pkg.customerName] = (counts[pkg.customerName] ?? 0) + 1;
    return counts;
  }, {});

  useEffect(() => {
    setCustomerListLimit(LIST_PAGE_SIZE);
  }, [customerSearch]);

  useEffect(() => {
    if (!selectedCustomer) return;
    setEditCompanyName(selectedCustomer.businessName ?? "");
    setEditTin(selectedCustomer.tin ?? "");
    setEditCompanyPhone(selectedCustomer.companyPhone ?? selectedCustomer.phone ?? "");
    setEditCompanyAddress(selectedCustomer.address ?? "");
    setEditBillingAddress(selectedCustomer.billingAddress ?? "");
    setEditShippingAddress(selectedCustomer.shippingAddress ?? "");
    setEditBillingSameAsCompany(Boolean(selectedCustomer.address && selectedCustomer.billingAddress === selectedCustomer.address));
    setEditShippingSameAsCompany(Boolean(selectedCustomer.address && selectedCustomer.shippingAddress === selectedCustomer.address));
  }, [selectedCustomer]);

  async function saveCustomerDetails() {
    if (!selectedCustomer) return;
    const companyAddress = editCompanyAddress.trim();
    await apiPatch(`/customers/${selectedCustomer.id}`, {
      businessName: editCompanyName.trim(),
      tin: editTin.trim(),
      companyPhone: editCompanyPhone.trim(),
      address: companyAddress,
      billingAddress: editBillingSameAsCompany ? companyAddress : editBillingAddress.trim(),
      shippingAddress: editShippingSameAsCompany ? companyAddress : editShippingAddress.trim()
    });
    setCustomerEditOpen(false);
  }

  async function addCustomerContact() {
    if (!selectedCustomer) return;
    const contactAddress = newContactAddress.trim();
    await apiPost(`/customers/${selectedCustomer.id}/contacts`, {
      name: newContactName.trim(),
      role: newContactRole === "Other" ? newContactCustomRole.trim() || "Other" : newContactRole,
      phone: newContactPhone.trim(),
      email: newContactEmail.trim(),
      address: contactAddress,
      billingAddress: newContactSameAddress ? contactAddress : newContactBillingAddress.trim(),
      shippingAddress: newContactSameAddress ? contactAddress : newContactShippingAddress.trim(),
      notes: newContactNotes.trim(),
      isPrimary: newContactPrimary
    });
    setNewContactName("");
    setNewContactRole("Operations");
    setNewContactCustomRole("");
    setNewContactPhone("");
    setNewContactEmail("");
    setNewContactAddress("");
    setNewContactBillingAddress("");
    setNewContactShippingAddress("");
    setNewContactNotes("");
    setNewContactPrimary(false);
    setNewContactSameAddress(true);
    setContactFormOpen(false);
  }

  async function generateBillingInvoice() {
    if (!selectedCustomer) return;
    const invoice = await apiPost<BillingInvoice>("/billing/invoices", {
      customerId: selectedCustomer.id,
      packageIds: selectedCustomerPackages.map((pkg) => pkg.id),
      dueRule: customerDueDateLabel
    });
    const lines = recentCustomerPackages.map((pkg, index) => {
      const due = Number(pkg.price ?? 0);
      const paid = paymentTotalsByPackage[pkg.id] ?? 0;
      const balance = Math.max(due - paid, 0);
      return `${index + 1}. ${pkg.packageNumber}
${pkg.description}
Due: PHP ${due.toLocaleString()} Paid: PHP ${paid.toLocaleString()}
Bal: PHP ${balance.toLocaleString()}`;
    }).join("\n");
    setReceiptPreview(`MANCENIDO TRUCKING SERVICES
BILLING STATEMENT
${invoice.invoiceNumber}
--------------------------------
Customer: ${selectedCustomer.businessName}
Terms: ${selectedCustomer.billingTerm ?? "Not set"}
Due Rule: ${invoice.dueRule}
Status: ${invoice.status}
--------------------------------
${lines || "No billable shipments."}
--------------------------------
TOTAL DUE: PHP ${invoice.amountDue.toLocaleString()}
PAID: PHP ${invoice.amountPaid.toLocaleString()}
BALANCE: PHP ${invoice.balance.toLocaleString()}
--------------------------------
Prepared By: LBMP
Signature: ________________`);
    setStatus(`Billing invoice ${invoice.invoiceNumber} saved for ${selectedCustomer.businessName}.`);
  }

  async function createBillingReminder() {
    if (!selectedCustomer) return;
    await apiPost(`/customers/${selectedCustomer.id}/billing-reminder`, {
      balance: customerBalance,
      dueRule: customerDueDateLabel,
      branchName: customerBillingBranch,
      smsReady: true
    });
    setStatus(`Branch owner notified. SMS reminder is ready for future SMS API integration.`);
  }

  async function sendMessage() {
    if (!messagePackage) {
      setStatus("Select a shipment first.");
      return;
    }
    setStatus("Sending message...");
    await apiPost(`/packages/${messagePackage}/messages`, {
      senderName: "Customer Portal",
      body: messageBody
    });
    setStatus("Message sent and tied to shipment.");
  }

  return (
    <div className="stack">
      {mode === "home" && (
        <ModuleTileLauncher
          eyebrow="Customers"
          title="What do you want to do?"
          description="Open customer accounts, check balances, prepare billing, or send shipment messages."
          actions={[
            { key: "list", label: "Customer List", note: `${visibleCustomers.length} customers`, icon: ReceiptText, count: visibleCustomers.length, tone: visibleCustomers.length ? "dark" : "light", onClick: () => setMode("list") },
            { key: "add", label: "Add Customer", note: "Use Receive / Companies", icon: UserCog, tone: "light", onClick: () => setMode("list") },
            { key: "billing", label: "Billing", note: `${visibleCustomers.filter((customer) => customer.status === "Pending").length} pending`, icon: CreditCard, count: visibleCustomers.filter((customer) => customer.status === "Pending").length, tone: visibleCustomers.some((customer) => customer.status === "Pending") ? "dark" : "light", onClick: () => setMode("list") },
            { key: "messages", label: "Messages", note: "Shipment message", icon: ClipboardList, tone: "light", onClick: () => setMode("messages") }
          ]}
        />
      )}
      {mode === "list" && (
      <section className="panel">
        <div className="sectionHeader">
          <div>
            <h3>Customers</h3>
            <p className="muted">Open a customer to view company details, addresses, contacts, and related shipments.</p>
          </div>
          <button className="smallButton" onClick={() => setMode("home")}>Back</button>
        </div>
        <label>Search Customer<input value={customerSearch} onChange={(event) => setCustomerSearch(event.target.value)} placeholder="Company, contact, phone, address" /></label>
        <div className="list compactList">
          {displayedCustomers.map((customer) => (
            (() => {
              const customerPackages = packages.filter((pkg) => pkg.customerName === customer.businessName);
              const customerPaid = customerPackages.reduce((sum, pkg) => sum + (paymentTotalsByPackage[pkg.id] ?? 0), 0);
              const customerDue = customerPackages.reduce((sum, pkg) => sum + Number(pkg.price ?? 0), 0);
              const customerBalanceList = Math.max(customerDue - customerPaid, 0);
              const customerOngoing = customerPackages.filter((pkg) => !["Delivered", "Cancelled", "Failed Delivery"].includes(pkg.status)).length;
              return (
                  <button className="row denseRow tappableRow compactDataRow customerListRow" key={customer.id} onClick={() => {
                  setSelectedCustomerId(customer.id);
                  setCustomerEditOpen(false);
                  setContactFormOpen(false);
                }}>
                  <div>
                    <strong>{customer.businessName}</strong>
                    <p>{customer.contactPerson ?? customer.contacts?.[0]?.name ?? "No contact"}{customer.phone || customer.companyPhone ? ` - ${customer.phone ?? customer.companyPhone}` : ""}</p>
                    <p className="muted">{customer.address ?? "Address missing"} - {customer.contacts?.length ?? 0} contact{(customer.contacts?.length ?? 0) === 1 ? "" : "s"} - {customerPackages.length} shipment{customerPackages.length === 1 ? "" : "s"}</p>
                  </div>
                  <div className="compactRowMeta">
                    <span className={customer.status === "Active" ? "badge" : "badge warning"}>{customer.status}</span>
                    {customerOngoing > 0 && <span className="badge">{customerOngoing} ongoing</span>}
                    {customerBalanceList > 0 && <span className="badge warning">PHP {customerBalanceList.toLocaleString()}</span>}
                  </div>
                </button>
              );
            })()
          ))}
          {!visibleCustomers.length && <p className="muted">No customer found.</p>}
          {visibleCustomers.length > displayedCustomers.length && (
            <button className="loadMoreButton" type="button" onClick={() => setCustomerListLimit((limit) => limit + LIST_PAGE_SIZE)}>
              Show more customers ({visibleCustomers.length - displayedCustomers.length} left)
            </button>
          )}
        </div>
      </section>
      )}
      {mode === "list" && selectedCustomer && (
        <div className="modalLayer" role="dialog" aria-label="Customer details">
          <div className="modalBackdrop" aria-hidden="true" />
          <section className="modalPanel">
            <div className="sectionHeader">
              <div>
                <h3>{selectedCustomer.businessName} Contacts</h3>
                <p className="muted">A company can have multiple contacts for accounting, warehouse, sales, delivery, or operations.</p>
              </div>
              <button className="smallButton" onClick={() => setSelectedCustomerId("")}>Close</button>
            </div>
            <section className="subPanel">
              <div className="sectionHeader">
                <div>
                  <h4>Company Details</h4>
                  <p className="muted">{[selectedCustomer.tin ? `TIN ${selectedCustomer.tin}` : "", selectedCustomer.companyPhone ? `Phone ${selectedCustomer.companyPhone}` : ""].filter(Boolean).join(" / ") || "TIN and company phone not completed."}</p>
                </div>
                <button className="smallButton" onClick={() => setCustomerEditOpen((current) => !current)}>{customerEditOpen ? "Cancel" : "Edit"}</button>
              </div>
              {!customerEditOpen ? (
                <div className="compactDetails">
                  <p><strong>Company:</strong> {selectedCustomer.address || "Address missing"}</p>
                  <p><strong>Billing:</strong> {selectedCustomer.billingAddress || "Not set"}</p>
                  <p><strong>Shipping:</strong> {selectedCustomer.shippingAddress || "Not set"}</p>
                </div>
              ) : (
                <div className="stack">
                  <div className="formGrid">
                    <label>Company Name<input value={editCompanyName} onChange={(event) => setEditCompanyName(event.target.value)} /></label>
                    <label>TIN<input value={editTin} onChange={(event) => setEditTin(event.target.value)} /></label>
                    <label>Company Phone<input value={editCompanyPhone} onChange={(event) => setEditCompanyPhone(event.target.value)} placeholder="Main company phone" /></label>
                    <LongTextField label="Company Address" value={editCompanyAddress} onChange={setEditCompanyAddress} placeholder="Company address" threshold={36} />
                    <label className="checkboxLabel"><input type="checkbox" checked={editBillingSameAsCompany} onChange={(event) => setEditBillingSameAsCompany(event.target.checked)} /> Billing same as company address</label>
                    {!editBillingSameAsCompany && <LongTextField label="Billing Address" value={editBillingAddress} onChange={setEditBillingAddress} placeholder="Billing address" threshold={36} />}
                    <label className="checkboxLabel"><input type="checkbox" checked={editShippingSameAsCompany} onChange={(event) => setEditShippingSameAsCompany(event.target.checked)} /> Shipping same as company address</label>
                    {!editShippingSameAsCompany && <LongTextField label="Shipping Address" value={editShippingAddress} onChange={setEditShippingAddress} placeholder="Shipping address" threshold={36} />}
                  </div>
                  <button className="primaryButton" disabled={!editCompanyName.trim()} onClick={() => onAction("Save customer details", saveCustomerDetails)}>Save Company Details</button>
                </div>
              )}
            </section>
            <section className="subPanel">
              <div className="sectionHeader">
                <div>
                  <h4>Billing Summary</h4>
                  <p className="muted">Operational payment view only. Full accounting stays outside this module.</p>
                </div>
              </div>
              <div className="detailGrid compactDetailGrid paymentSummaryGrid">
                <div><span>Terms</span><strong>{selectedCustomer.billingTerm ?? "Not set"}</strong></div>
                <div><span>Due Date Rule</span><strong>{customerDueDateLabel}</strong></div>
                <div><span>Open Balance</span><strong>PHP {customerBalance.toLocaleString()}</strong></div>
                <div><span>Status</span><strong>{customerPaymentStatus}</strong></div>
                <div><span>Amount Due</span><strong>PHP {customerAmountDue.toLocaleString()}</strong></div>
                <div><span>Amount Paid</span><strong>PHP {customerAmountPaid.toLocaleString()}</strong></div>
              </div>
              <div className="buttonGrid two">
                <button className="actionButton" onClick={() => onAction("Create billing invoice", generateBillingInvoice)}>Billing Invoice</button>
                <button className="primaryButton" disabled={customerBalance <= 0} onClick={() => onAction("Notify billing reminder", createBillingReminder)}>Notify Owner / SMS Soon</button>
              </div>
              <p className="muted">SMS is not sent yet. This prepares the reminder flow for future SMS API integration.</p>
            </section>
            <div className="list compactList">
              {(selectedCustomer.contacts ?? []).map((contact) => (
                <div className="row compactDataRow" key={contact.id}>
                  <div>
                    <strong>{contact.name}</strong>
                    <p>{contact.role ?? "Contact"} {contact.phone ? `- ${contact.phone}` : ""}</p>
                    <p className="muted">{[contact.email, contact.address, contact.billingAddress ? "Billing set" : "", contact.shippingAddress ? "Shipping set" : "", contact.notes].filter(Boolean).join(" - ") || "No details yet"}</p>
                  </div>
                  <span className={contact.isPrimary ? "badge" : "badge warning"}>{contact.isPrimary ? "Primary" : contact.status}</span>
                </div>
              ))}
              {!(selectedCustomer.contacts ?? []).length && <p className="muted">No contacts saved for this company yet.</p>}
            </div>
            <section className="subPanel">
              <div className="sectionHeader">
                <div>
                  <h4>Transactions</h4>
                  <p className="muted">{ongoingCustomerPackages.length} ongoing / {selectedCustomerPackages.length} total shipment{selectedCustomerPackages.length === 1 ? "" : "s"}</p>
                </div>
              </div>
              <div className="list compactList">
                {recentCustomerPackages.map((pkg) => (
                  <button className="row denseRow tappableRow compactDataRow" key={pkg.id} onClick={() => {
                    setMessagePackage(pkg.id);
                    setStatus(`Selected ${pkg.packageNumber}.`);
                  }}>
                    <div>
                      <strong>{pkg.description}</strong>
                      <p>{pkg.packageNumber} - {pkg.receivingRecordNumber}</p>
                      <p className="muted">
                        {pkg.destination} / {formatSearchDate(pkg.createdAt)}
                        {pkg.price == null
                          ? " / No price"
                          : ` / Due PHP ${Number(pkg.price ?? 0).toLocaleString()} / Paid PHP ${(paymentTotalsByPackage[pkg.id] ?? 0).toLocaleString()} / Balance PHP ${Math.max(Number(pkg.price ?? 0) - (paymentTotalsByPackage[pkg.id] ?? 0), 0).toLocaleString()}`}
                      </p>
                    </div>
                    <div className="compactRowMeta">
                      <span className="badge">{pkg.status}</span>
                    </div>
                  </button>
                ))}
                {!recentCustomerPackages.length && <p className="muted">No shipment history for this customer yet.</p>}
              </div>
            </section>
            {!contactFormOpen ? (
              <button className="primaryButton" onClick={() => setContactFormOpen(true)}><Plus size={18} /> Add Contact</button>
            ) : (
              <section className="subPanel">
                <div className="sectionHeader">
                  <div>
                    <h4>Add Contact</h4>
                    <p className="muted">Fill only what is available. Address fields can be completed later.</p>
                  </div>
                  <button className="smallButton" onClick={() => setContactFormOpen(false)}>Cancel</button>
                </div>
                <div className="formGrid">
                  <label>Contact Name<input value={newContactName} onChange={(event) => setNewContactName(event.target.value)} placeholder="Person name" /></label>
                  <label>Role / Type<select value={newContactRole} onChange={(event) => setNewContactRole(event.target.value)}><option>Owner</option><option>Accounting</option><option>Operations</option><option>Warehouse</option><option>Sales Agent</option><option>Driver</option><option>Receiver</option><option>Other</option></select></label>
                  {newContactRole === "Other" && <label>Custom Role<input value={newContactCustomRole} onChange={(event) => setNewContactCustomRole(event.target.value)} placeholder="Type custom role" /></label>}
                  <label>Phone<input value={newContactPhone} onChange={(event) => setNewContactPhone(event.target.value)} /></label>
                  <label>Email<input value={newContactEmail} onChange={(event) => setNewContactEmail(event.target.value)} /></label>
                  <LongTextField label="Contact Address" value={newContactAddress} onChange={setNewContactAddress} placeholder="Contact address" threshold={36} />
                  <label className="checkboxLabel"><input type="checkbox" checked={newContactSameAddress} onChange={(event) => setNewContactSameAddress(event.target.checked)} /> Billing and shipping same as contact address</label>
                  {!newContactSameAddress && (
                    <>
                      <LongTextField label="Billing Address" value={newContactBillingAddress} onChange={setNewContactBillingAddress} placeholder="Billing address" threshold={36} />
                      <LongTextField label="Shipping Address" value={newContactShippingAddress} onChange={setNewContactShippingAddress} placeholder="Shipping address" threshold={36} />
                    </>
                  )}
                    <LongTextField label="Notes" value={newContactNotes} onChange={setNewContactNotes} threshold={36} />
                  <label className="checkboxLabel"><input type="checkbox" checked={newContactPrimary} onChange={(event) => setNewContactPrimary(event.target.checked)} /> Set as primary contact</label>
                </div>
                <button className="primaryButton" disabled={!newContactName.trim()} onClick={() => onAction("Add customer contact", addCustomerContact)}>Add Contact</button>
              </section>
            )}
          </section>
        </div>
      )}
      {mode === "messages" && (
      <section className="panel compact">
        <div className="sectionHeader">
          <div>
            <h3>Shipment Message</h3>
            <p className="muted">Send a message tied to a shipment record.</p>
          </div>
          <button className="smallButton" onClick={() => setMode("home")}>Back</button>
        </div>
        <div className="formGrid">
          <label>Shipment<select value={messagePackage} onChange={(event) => setMessagePackage(event.target.value)}><option value="">Select shipment</option>{packages.map((pkg) => <option key={pkg.id} value={pkg.id}>{pkg.packageNumber} - {pkg.description}</option>)}</select></label>
          <label>Message<input value={messageBody} onChange={(event) => setMessageBody(event.target.value)} /></label>
        </div>
        <p className="notice">{status}</p>
        <button
          className="primaryButton"
          disabled={!messagePackage}
          onClick={() => void sendMessage()}
        >
          Send Shipment Message
        </button>
      </section>
      )}
    </div>
  );
}
