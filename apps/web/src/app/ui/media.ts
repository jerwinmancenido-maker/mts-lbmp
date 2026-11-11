import { apiPost } from "./api";
import { deleteQueuedPhoto, enqueueQueuedPhoto, listQueuedPhotos, replaceQueuedPhotoReferences, updateQueuedPhoto, type QueuedPhotoRecord } from "./cache";

interface PhotoAuditUser {
  id: string;
  name: string;
  role: string;
}

let photoAuditUser: PhotoAuditUser = {
  id: "unknown",
  name: "Unknown User",
  role: "Unknown Role"
};

let photoUploadContext: { userId?: string; branch?: string } = {};

export function setPhotoAuditUser(user: PhotoAuditUser) {
  photoAuditUser = user;
}

export function setPhotoUploadContext(context: { userId?: string; branch?: string }) {
  photoUploadContext = context;
}

export async function takeNativeCameraPhoto(fileName = "photo.jpg") {
  if (typeof window === "undefined") return null;
  try {
    const { Capacitor } = await import("@capacitor/core");
    if (!Capacitor.isNativePlatform()) return null;

    const { Camera, CameraResultType, CameraSource } = await import("@capacitor/camera");
    const photo = await Camera.getPhoto({
      quality: 82,
      allowEditing: false,
      correctOrientation: true,
      resultType: CameraResultType.DataUrl,
      source: CameraSource.Camera,
      saveToGallery: false
    });

    if (!photo.dataUrl) return null;
    const { blob, mimeType } = dataUrlToBlob(photo.dataUrl);
    const extension = mimeType.includes("png") ? "png" : "jpg";
    const normalizedName = /\.[a-z0-9]+$/i.test(fileName) ? fileName : `${fileName}.${extension}`;
    return new File([blob], normalizedName, { type: mimeType, lastModified: Date.now() });
  } catch (error) {
    try {
      const { Capacitor } = await import("@capacitor/core");
      if (Capacitor.isNativePlatform()) {
        throw new Error(`Native camera failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    } catch (capacitorError) {
      if (capacitorError instanceof Error && capacitorError.message.startsWith("Native camera failed")) throw capacitorError;
    }
    console.warn("Native camera unavailable, falling back to file picker.", error);
    return null;
  }
}

export async function scanBarcodeWithCamera() {
  if (typeof window === "undefined") return null;
  if (!window.navigator.mediaDevices?.getUserMedia) {
    throw new Error("Camera scanner is not available on this browser. Use the built-in hardware scanner or install the APK.");
  }

  const overlay = document.createElement("div");
  overlay.className = "cameraScanOverlay";
  overlay.innerHTML = `
    <div class="cameraScanPanel">
      <div class="cameraScanHeader">
        <strong>Scan QR / Barcode</strong>
        <button type="button" aria-label="Close scanner">Close</button>
      </div>
      <video autoplay playsinline muted></video>
      <p>Point the camera at the QR or barcode.</p>
    </div>
  `;
  document.body.appendChild(overlay);

  const video = overlay.querySelector("video");
  const closeButton = overlay.querySelector("button");
  if (!video) {
    overlay.remove();
    throw new Error("Unable to start scanner view");
  }

  let stream: MediaStream | undefined;
  let stopped = false;
  const stop = () => {
    stopped = true;
    stream?.getTracks().forEach((track) => track.stop());
    overlay.remove();
  };

  return new Promise<string | null>(async (resolve, reject) => {
    closeButton?.addEventListener("click", () => {
      stop();
      resolve(null);
    });

    try {
      stream = await window.navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false
      });
      video.srcObject = stream;
      await video.play();

      const BarcodeDetectorCtor = (window as unknown as {
        BarcodeDetector?: new (options?: { formats?: string[] }) => {
          detect(source: HTMLVideoElement): Promise<Array<{ rawValue?: string }>>;
        };
      }).BarcodeDetector;

      if (BarcodeDetectorCtor) {
        const detector = new BarcodeDetectorCtor({
          formats: ["qr_code", "code_128", "code_39", "ean_13", "ean_8", "upc_a", "upc_e"]
        });
        const tick = async () => {
          if (stopped) return;
          try {
            const matches = await detector.detect(video);
            const value = matches.find((match) => match.rawValue)?.rawValue;
            if (value) {
              stop();
              resolve(value);
              return;
            }
          } catch {
            // Keep scanning. Some WebViews throw while the video is warming up.
          }
          window.setTimeout(tick, 220);
        };
        tick();
        return;
      }

      const { BrowserMultiFormatReader } = await import("@zxing/browser");
      const reader = new BrowserMultiFormatReader();
      const controls = await reader.decodeFromVideoElement(video, (result) => {
        const text = result?.getText();
        if (!text) return;
        controls.stop();
        stop();
        resolve(text);
      });
    } catch (error) {
      stop();
      reject(error);
    }
  });
}

async function getGpsStamp() {
  if (typeof window === "undefined" || !window.navigator.geolocation) return "GPS: unavailable";
  return new Promise<string>((resolve) => {
    const timeout = window.setTimeout(() => resolve("GPS: unavailable"), 4500);
    window.navigator.geolocation.getCurrentPosition(
      (position) => {
        window.clearTimeout(timeout);
        const latitude = position.coords.latitude.toFixed(6);
        const longitude = position.coords.longitude.toFixed(6);
        const accuracy = Math.round(position.coords.accuracy);
        resolve(`GPS: ${latitude}, ${longitude} +/-${accuracy}m`);
      },
      () => {
        window.clearTimeout(timeout);
        resolve("GPS: denied/unavailable");
      },
      { enableHighAccuracy: true, timeout: 4000, maximumAge: 30000 }
    );
  });
}

function drawAuditStamp(context: CanvasRenderingContext2D, width: number, height: number, lines: string[]) {
  const ratio = Math.max(1, Math.min(width, height) / 900);
  const fontSize = Math.max(18, Math.round(22 * ratio));
  const padding = Math.max(12, Math.round(14 * ratio));
  const lineHeight = Math.round(fontSize * 1.35);
  const boxHeight = padding * 2 + lineHeight * lines.length;
  const y = Math.max(0, height - boxHeight);

  context.save();
  context.fillStyle = "rgba(0, 0, 0, 0.68)";
  context.fillRect(0, y, width, boxHeight);
  context.font = `700 ${fontSize}px Arial, sans-serif`;
  context.fillStyle = "#ffffff";
  context.textBaseline = "top";

  lines.forEach((line, index) => {
    context.fillText(line, padding, y + padding + index * lineHeight, width - padding * 2);
  });
  context.restore();
}

export async function compressImage(file: File, maxSide = 1600, quality = 0.78, stampType = "photo") {
  let source: CanvasImageSource & { width: number; height: number };
  try {
    source = await createImageBitmap(file);
  } catch {
    source = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      const url = URL.createObjectURL(file);
      image.onload = () => {
        URL.revokeObjectURL(url);
        resolve(image);
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("Unable to read selected image"));
      };
      image.src = url;
    });
  }
  const scale = Math.min(1, maxSide / Math.max(source.width, source.height));
  const width = Math.max(1, Math.round(source.width * scale));
  const height = Math.max(1, Math.round(source.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Unable to prepare image compression");
  context.drawImage(source, 0, 0, width, height);
  const timestamp = new Date().toLocaleString(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
  const gpsStamp = await getGpsStamp();
  drawAuditStamp(context, width, height, [
    `LBMP ${stampType}`,
    `Time: ${timestamp}`,
    gpsStamp,
    `User: ${photoAuditUser.name} (${photoAuditUser.role})`,
    `User ID: ${photoAuditUser.id}`
  ]);
  return canvas.toDataURL("image/jpeg", quality);
}

function dataUrlToBlob(dataUrl: string) {
  const [header, base64] = dataUrl.split(",");
  const mimeType = header?.match(/^data:(.*?);base64$/)?.[1] ?? "image/jpeg";
  const binary = atob(base64 ?? "");
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return { blob: new Blob([bytes], { type: mimeType }), mimeType };
}

function isNetworkError(error: unknown) {
  if (typeof navigator !== "undefined" && !navigator.onLine) return true;
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return message.includes("failed to fetch") || message.includes("network") || message.includes("offline");
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Unable to read queued photo"));
    reader.readAsDataURL(blob);
  });
}

/**
 * Phase 5 P5-3: staff uploads go to POST /uploads, which now requires a
 * staff token. Wall-QR intake DR photos are uploaded from the
 * unauthenticated intake page, so they use the API's scoped public
 * intake-upload variant instead (it accepts only this photo type).
 */
export function uploadPathForPhotoType(photoType: string) {
  return photoType === "wall-qr-dr-photo" ? "/public/receiving-intake/upload-photo" : "/uploads";
}

/**
 * Uploads photos still sitting in the device queue and, for each one, lets
 * the server attach the real URL wherever the photo's local id was submitted
 * as a pending reference (wall-QR intake DR photos — Phase 4 audit A6). The
 * staff shell runs its own richer drain with sync UI; this shared helper
 * covers pages that queue photos but have no shell, like the public intake
 * page. Returns how many queued photos were uploaded.
 */
export async function syncQueuedPhotos(): Promise<number> {
  if (typeof window === "undefined" || (typeof navigator !== "undefined" && !navigator.onLine)) return 0;
  const photos = (await listQueuedPhotos()).filter((record) => record.status === "Pending" || record.status === "Failed");
  let uploadedCount = 0;
  for (const record of photos) {
    const syncingRecord: QueuedPhotoRecord = { ...record, status: "Syncing", attempts: record.attempts + 1, lastError: undefined };
    await updateQueuedPhoto(syncingRecord);
    try {
      const dataUrl = await blobToDataUrl(record.compressedBlob);
      const uploaded = await apiPost<{ fileUrl: string }>(uploadPathForPhotoType(record.photoType), {
        dataUrl,
        fileName: record.fileName,
        type: record.photoType,
        entityId: record.entityId
      });
      await replaceQueuedPhotoReferences(record.localPhotoId, uploaded.fileUrl);
      // Best effort: a no-match just means no server record referenced this
      // photo (it may only exist inside a still-pending queue body, which
      // replaceQueuedPhotoReferences already rewrote).
      await apiPost("/public/receiving-intake/resolve-photo", {
        localPhotoId: record.localPhotoId,
        fileUrl: uploaded.fileUrl
      }).catch(() => undefined);
      await updateQueuedPhoto({ ...syncingRecord, status: "Synced", serverUrl: uploaded.fileUrl });
      await deleteQueuedPhoto(record.localPhotoId);
      uploadedCount += 1;
      notifyPhotoQueued();
    } catch (error) {
      await updateQueuedPhoto({
        ...syncingRecord,
        status: "Failed",
        lastError: error instanceof Error ? error.message : "Photo sync failed"
      });
    }
  }
  return uploadedCount;
}

function notifyPhotoQueued() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("mts-photo-queued"));
  }
}

export async function uploadCompressedImage(file: File, type: string, entityId?: string) {
  const dataUrl = await compressImage(file, 1280, 0.72, type);
  const payload = {
    dataUrl,
    fileName: file.name,
    type,
    entityId
  };
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    const { blob, mimeType } = dataUrlToBlob(dataUrl);
    const queued = await enqueueQueuedPhoto({
      entityType: entityId ? "record" : "unassigned",
      entityId,
      photoType: type,
      compressedBlob: blob,
      fileName: file.name,
      mimeType,
      byteSize: blob.size,
      capturedByUserId: photoUploadContext.userId,
      branch: photoUploadContext.branch
    });
    notifyPhotoQueued();
    return {
      fileUrl: `local-photo://${queued.localPhotoId}`,
      fileName: file.name,
      mimeType,
      size: blob.size,
      type,
      queued: true,
      localPhotoId: queued.localPhotoId
    };
  }
  try {
    return await apiPost<{ fileUrl: string; size: number; mimeType: string; type: string }>(uploadPathForPhotoType(type), payload);
  } catch (error) {
    if (!isNetworkError(error)) throw error;
    const { blob, mimeType } = dataUrlToBlob(dataUrl);
    const queued = await enqueueQueuedPhoto({
      entityType: entityId ? "record" : "unassigned",
      entityId,
      photoType: type,
      compressedBlob: blob,
      fileName: file.name,
      mimeType,
      byteSize: blob.size,
      capturedByUserId: photoUploadContext.userId,
      branch: photoUploadContext.branch,
      lastError: error instanceof Error ? error.message : "Upload failed"
    });
    notifyPhotoQueued();
    return {
      fileUrl: `local-photo://${queued.localPhotoId}`,
      fileName: file.name,
      mimeType,
      size: blob.size,
      type,
      queued: true,
      localPhotoId: queued.localPhotoId
    };
  }
}
