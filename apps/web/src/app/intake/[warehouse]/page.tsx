"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { Camera, CheckCircle2, FileText, PackagePlus, Send, ShieldCheck } from "lucide-react";
import { apiPost } from "../../ui/api";
import { readDeliveryReceiptPhoto, type DrOcrConfidence, type DrOcrProgress, type DrOcrResult } from "../../ui/dr-ocr";
import { syncQueuedPhotos, takeNativeCameraPhoto, uploadCompressedImage } from "../../ui/media";

type ValidationResult = {
  customer: { matched: boolean; label: string };
  receiver: { matched: boolean; label: string };
  product: { matched: boolean; label: string };
  address: { matched: boolean; label: string };
};

type CustomerSuggestion = {
  name: string;
  address?: string;
  email?: string;
};

const emptyValidation: ValidationResult = {
  customer: { matched: false, label: "Type company name" },
  receiver: { matched: false, label: "Type receiver name" },
  product: { matched: false, label: "Type item description" },
  address: { matched: false, label: "Type delivery area" }
};

function FieldCheck({ result }: { result: { matched: boolean; label: string } }) {
  return (
    <span className={result.matched ? "intakeCheck matched" : "intakeCheck"}>
      {result.matched && <CheckCircle2 size={16} />}
      {result.label}
    </span>
  );
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

export default function WarehouseIntakePage() {
  const params = useParams<{ warehouse: string }>();
  const warehouseCode = String(params.warehouse ?? "origin");
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const [customerName, setCustomerName] = useState("");
  const [customerDrNumber, setCustomerDrNumber] = useState("");
  const [dropOffPerson, setDropOffPerson] = useState("");
  const [dropOffPhone, setDropOffPhone] = useState("");
  const [consigneeName, setConsigneeName] = useState("");
  const [destinationBranch, setDestinationBranch] = useState("Daet");
  const [deliveryArea, setDeliveryArea] = useState("");
  const [itemDescription, setItemDescription] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [unit, setUnit] = useState("pcs");
  const [notes, setNotes] = useState("");
  const [drPhotoUrl, setDrPhotoUrl] = useState("");
  const [drPhotoLocalId, setDrPhotoLocalId] = useState("");
  const [drPhotoFile, setDrPhotoFile] = useState<File | null>(null);
  const [ocrResult, setOcrResult] = useState<DrOcrResult | null>(null);
  const [ocrBusy, setOcrBusy] = useState(false);
  const [ocrProgress, setOcrProgress] = useState<DrOcrProgress | null>(null);
  const [validation, setValidation] = useState<ValidationResult>(emptyValidation);
  const [customerSuggestions, setCustomerSuggestions] = useState<CustomerSuggestion[]>([]);
  const [customerSuggestionOpen, setCustomerSuggestionOpen] = useState(false);
  const [status, setStatus] = useState("Fill the details and submit. Receiving staff will review before saving.");
  const [submitting, setSubmitting] = useState(false);

  // This page queues DR photos (uploadCompressedImage) but has no staff
  // shell to drain the queue — drain it here whenever the page is open and
  // connectivity is available, so a queued photo actually reaches the server
  // and gets attached to its intake task (Phase 4 audit A6).
  useEffect(() => {
    const drain = () => {
      void syncQueuedPhotos();
    };
    drain();
    window.addEventListener("online", drain);
    return () => window.removeEventListener("online", drain);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      apiPost<ValidationResult>("/public/receiving-intake/validate", {
        customerName,
        receiverName: consigneeName,
        productDescription: itemDescription,
        deliveryArea
      })
        .then(setValidation)
        .catch(() => setStatus("Connection issue. You can still type details, but submit needs the LBMP server online."));
    }, 350);
    return () => window.clearTimeout(timer);
  }, [customerName, consigneeName, deliveryArea, itemDescription]);

  useEffect(() => {
    const query = customerName.trim();
    if (query.length < 2) {
      setCustomerSuggestions([]);
      setCustomerSuggestionOpen(false);
      return;
    }
    const timer = window.setTimeout(() => {
      apiPost<CustomerSuggestion[]>("/public/receiving-intake/customer-suggestions", { query })
        .then((suggestions) => {
          setCustomerSuggestions(suggestions);
          setCustomerSuggestionOpen(suggestions.length > 0);
        })
        .catch(() => {
          setCustomerSuggestions([]);
          setCustomerSuggestionOpen(false);
        });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [customerName]);

  async function submitIntake() {
    if (!customerName.trim()) {
      setStatus("Company/customer name is required.");
      return;
    }
    setSubmitting(true);
    setStatus("Submitting intake...");
    try {
      const result = await apiPost<{ duplicate: boolean; message: string }>("/public/receiving-intake", {
        warehouseCode,
        customerName,
        customerDrNumber,
        dropOffPerson,
        dropOffPhone,
        consigneeName,
        destinationBranch,
        deliveryArea,
        itemDescription,
        quantity: Number(quantity || 1),
        unit,
        // A still-queued photo is submitted as a pending local reference,
        // never as a local-photo:// URL — the server attaches the real URL
        // when the queued photo uploads (Phase 4 audit A6).
        drPhotoUrl: drPhotoUrl || undefined,
        drPhotoLocalId: drPhotoLocalId || undefined,
        notes: [notes, ocrResult?.rawText ? "DR text read by device OCR and reviewed before submit." : ""].filter(Boolean).join(" | ")
      });
      setStatus(result.message);
      if (drPhotoLocalId) {
        // The submit just proved connectivity — try to upload the queued
        // photo right away so it resolves onto the task immediately.
        void syncQueuedPhotos();
      }
      if (!result.duplicate) {
        setCustomerDrNumber("");
        setItemDescription("");
        setQuantity("1");
        setNotes("");
        setDrPhotoUrl("");
        setDrPhotoLocalId("");
        setDrPhotoFile(null);
        setOcrResult(null);
      }
    } catch (error) {
      setStatus(error instanceof Error ? `Unable to submit intake: ${error.message}` : "Unable to submit intake. Check connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function readDrPhoto() {
    if (!drPhotoFile) {
      setStatus("Take a DR photo first, then tap Read DR Photo.");
      return;
    }
    setOcrBusy(true);
    setOcrProgress({ stage: "Starting reader", percent: 0 });
    setStatus("Reading DR photo 0%...");
    try {
      const result = await readDeliveryReceiptPhoto(drPhotoFile, {
        onProgress: (progress) => {
          setOcrProgress(progress);
          setStatus(`${progress.stage} ${progress.percent}%...`);
        }
      });
      setOcrResult(result);
      if (result.fields.drNumber && !customerDrNumber.trim()) setCustomerDrNumber(result.fields.drNumber);
      if (result.fields.customerName && !customerName.trim()) setCustomerName(result.fields.customerName);
      if (result.fields.dropOffPerson && !dropOffPerson.trim()) setDropOffPerson(result.fields.dropOffPerson);
      if (result.fields.receiverName && !consigneeName.trim()) setConsigneeName(result.fields.receiverName);
      if (result.fields.phone && !dropOffPhone.trim()) setDropOffPhone(result.fields.phone);
      if (result.fields.deliveryArea && !deliveryArea.trim()) setDeliveryArea(result.fields.deliveryArea);
      if (result.fields.itemDescription && !itemDescription.trim()) setItemDescription(result.fields.itemDescription);
      if (result.fields.quantity && quantity === "1") setQuantity(result.fields.quantity);
      if (result.fields.unit && unit === "pcs") setUnit(result.fields.unit);
      setStatus(result.message);
    } finally {
      setOcrBusy(false);
      setOcrProgress(null);
    }
  }

  async function attachDrPhoto(file: File) {
    setDrPhotoFile(file);
    setOcrResult(null);
    setStatus("Processing DR photo...");
    try {
      const uploaded = await uploadCompressedImage(file, "wall-qr-dr-photo", customerDrNumber || warehouseCode);
      if ("queued" in uploaded && uploaded.queued) {
        // Keep only the pending reference — the local-photo:// URL in
        // uploaded.fileUrl is a device-local placeholder, not a server URL.
        setDrPhotoLocalId(uploaded.localPhotoId);
        setDrPhotoUrl("");
        setStatus("DR photo saved on this device - it will attach when the connection uploads it.");
      } else {
        setDrPhotoUrl(uploaded.fileUrl);
        setDrPhotoLocalId("");
        setStatus("DR photo attached. Tap Read DR Photo if you want the app to suggest details.");
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "DR photo failed.");
    }
  }

  async function takeDrPhoto() {
    setStatus("Opening camera...");
    let file: File | null = null;
    try {
      file = await takeNativeCameraPhoto(`dr-photo-${Date.now()}.jpg`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      const cameraUnavailable = message.includes("Unable to resolve camera activity") || message.includes("Native camera failed");
      if (cameraUnavailable) {
        setStatus("Camera is not available on this tablet. Choose an existing DR image to attach.");
        photoInputRef.current?.click();
        return;
      }
      setStatus("Camera is not available. Choose an existing image to attach.");
      photoInputRef.current?.click();
      return;
    }
    if (file) {
      await attachDrPhoto(file);
      return;
    }
    photoInputRef.current?.click();
  }

  return (
    <main className="publicIntakePage">
      <header className="publicIntakeTopbar">
        <div>
          <strong>LBMP</strong>
          <span>Receiving warehouse intake</span>
        </div>
        <span>{warehouseCode.toUpperCase()}</span>
      </header>
      <section className="publicIntakeCard">
        <div className="publicIntakeHero">
          <div>
            <p className="eyebrow">Warehouse Intake</p>
            <h1>Drop-off details</h1>
            <p>Fill this once. Receiving staff will review, correct, and save it as an official receiving record.</p>
          </div>
          <ShieldCheck size={36} />
        </div>
        <div className="publicIntakeSteps">
          <span>1. Details</span>
          <span>2. DR Photo</span>
          <span>3. Submit</span>
        </div>
        <p className="notice">Company use only. Company name and address may appear for confirmation. Person names, phone numbers, and private transaction details stay hidden.</p>

        <section className="publicIntakeSection">
          <div className="publicIntakeSectionTitle">
            <PackagePlus />
            <div>
              <h2>Company and DR</h2>
              <p>Use the company name and DR number shown on the customer document.</p>
            </div>
          </div>
          <div className="publicIntakeGrid two">
            <label className="publicAutocompleteField">Company / Customer
              <input
                value={customerName}
                onBlur={() => window.setTimeout(() => setCustomerSuggestionOpen(false), 120)}
                onChange={(event) => {
                  setCustomerName(event.target.value);
                  setCustomerSuggestionOpen(true);
                }}
                onFocus={() => setCustomerSuggestionOpen(customerSuggestions.length > 0)}
                placeholder="Type company name"
              />
              {customerSuggestionOpen && customerSuggestions.length > 0 && (
                <div className="publicSuggestionList" role="listbox" aria-label="Customer name suggestions">
                  {customerSuggestions.map((suggestion) => (
                    <button
                      key={suggestion.name}
                      type="button"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => {
                        setCustomerName(suggestion.name);
                        setCustomerSuggestionOpen(false);
                      }}
                    >
                      <strong>{suggestion.name}</strong>
                      <span>{suggestion.address || suggestion.email ? [suggestion.address, suggestion.email].filter(Boolean).join(" • ") : "Company record found"}</span>
                    </button>
                  ))}
                </div>
              )}
              <FieldCheck result={validation.customer} />
            </label>
            <label>Customer DR Number
              <input value={customerDrNumber} onChange={(event) => setCustomerDrNumber(event.target.value)} placeholder="DR number" />
            </label>
          </div>
        </section>

        <section className="publicIntakeSection">
          <div className="publicIntakeSectionTitle">
            <ShieldCheck />
            <div>
              <h2>People and delivery</h2>
              <p>Type what you know. The receiving staff can complete missing details.</p>
            </div>
          </div>
          <div className="publicIntakeGrid two">
          <label>Drop-off Person
            <input value={dropOffPerson} onChange={(event) => setDropOffPerson(event.target.value)} placeholder="Your name" />
          </label>
          <label>Phone
            <input value={dropOffPhone} onChange={(event) => setDropOffPhone(event.target.value)} inputMode="tel" placeholder="Your phone number" />
          </label>
          <label>Receiver / Consignee
            <input value={consigneeName} onChange={(event) => setConsigneeName(event.target.value)} placeholder="Receiver name" />
            <FieldCheck result={validation.receiver} />
          </label>
          <label>Branch
            <select value={destinationBranch} onChange={(event) => setDestinationBranch(event.target.value)}>
              <option>Daet</option>
              <option>Naga</option>
            </select>
          </label>
          <label>Delivery Area / Address
            <input value={deliveryArea} onChange={(event) => setDeliveryArea(event.target.value)} placeholder="Street, barangay, city" />
            <FieldCheck result={validation.address} />
          </label>
          </div>
        </section>

        <section className="publicIntakeSection">
          <div className="publicIntakeSectionTitle">
            <PackagePlus />
            <div>
              <h2>Item</h2>
              <p>One item line is enough. Receiving staff can split or add items later.</p>
            </div>
          </div>
          <div className="publicIntakeGrid item">
          <label>Item Description
            <input value={itemDescription} onChange={(event) => setItemDescription(event.target.value)} placeholder="Example: 1 box assorted goods" />
            <FieldCheck result={validation.product} />
          </label>
          <label>Quantity
            <input value={quantity} onChange={(event) => setQuantity(event.target.value.replace(/[^\d.]/g, ""))} inputMode="decimal" />
          </label>
          <label>Unit
            <input value={unit} onChange={(event) => setUnit(event.target.value)} placeholder="pcs, box, sack" />
          </label>
          <label className="fullSpan">Notes
            <input value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Note for receiving staff" />
          </label>
          </div>
        </section>

        <input
          ref={photoInputRef}
          className="hiddenInput"
          type="file"
          accept="image/*"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.currentTarget.value = "";
            if (!file) return;
            void attachDrPhoto(file);
          }}
        />
        <section className="publicIntakeSection">
          <div className="publicIntakeSectionTitle">
            <Camera />
            <div>
              <h2>Photo and submit</h2>
              <p>{drPhotoUrl ? "DR photo attached." : drPhotoLocalId ? "DR photo saved on this device — it uploads when connected." : "Take a clear photo of the delivery receipt."}</p>
            </div>
          </div>
        <div className="buttonGrid intakeActions">
          <button className="actionButton" type="button" onClick={() => void takeDrPhoto()}><Camera /> {drPhotoUrl || drPhotoLocalId ? "Replace DR Image" : "Add DR Image"}</button>
          <button className="actionButton" type="button" disabled={!drPhotoFile || ocrBusy} onClick={() => void readDrPhoto()}><FileText /> {ocrBusy ? `Reading ${ocrProgress?.percent ?? 0}%` : "Read DR Photo"}</button>
          <button className="primaryButton" type="button" disabled={submitting} onClick={() => void submitIntake()}><Send /> Submit</button>
        </div>
        </section>
        {ocrResult && (
          <div className="publicIntakeSection">
            <h3>DR Reader Result</h3>
            <p className="muted">{ocrResult.message}</p>
            <OcrConfidenceGrid result={ocrResult} />
            {ocrResult.addresses.length > 1 && (
              <>
                <p className="muted">Multiple addresses found. Choose the correct delivery address.</p>
                <div className="compactActionGrid">
                  {ocrResult.addresses.map((address) => (
                    <button key={address} className="smallButton" type="button" onClick={() => setDeliveryArea(address)}>
                      {address}
                    </button>
                  ))}
                </div>
              </>
            )}
            {ocrResult.items.length > 1 && (
              <>
                <p className="muted">Multiple item lines found. Choose the item being submitted.</p>
                <div className="compactActionGrid">
                  {ocrResult.items.map((item) => (
                    <button key={`${item.description}-${item.quantity}-${item.unit}`} className="smallButton" type="button" onClick={() => {
                      setItemDescription(item.description);
                      if (item.quantity) setQuantity(item.quantity);
                      if (item.unit) setUnit(item.unit);
                    }}>
                      {[item.quantity, item.unit, item.description].filter(Boolean).join(" ")}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
        <p className="notice">{status}</p>
      </section>
    </main>
  );
}
