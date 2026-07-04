import Link from "next/link";
import "../../styles.css";

interface TrackingData {
  packageNumber: string;
  receivingRecordNumber: string;
  description: string;
  destination: string;
  condition: string;
  status: string;
  price: number | null;
  customerName: string;
  qrValue: string;
  messages: Array<{ id: string; senderName: string; body: string; createdAt: string }>;
}

async function getTracking(reference: string) {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4100";
  const response = await fetch(`${apiUrl}/tracking/${encodeURIComponent(reference)}`, { cache: "no-store" });
  if (!response.ok) return null;
  return response.json() as Promise<TrackingData>;
}

export default async function TrackingPage({ params }: { params: Promise<{ reference: string }> }) {
  const { reference } = await params;
  const tracking = await getTracking(reference);

  return (
    <main className="publicPage">
      <section className="trackingHero">
        <p className="eyebrow">Mancenido Trucking Services</p>
        <h1>Shipment Tracking</h1>
        <p>Friendly shipment status for customers. Internal staff notes, audit logs, and expenses are hidden.</p>
        <Link className="publicLink" href="/app">Open MTS LBMP App</Link>
      </section>

      {tracking ? (
        <section className="panel trackingCard">
          <div>
            <p className="eyebrow">Package</p>
            <h2>{tracking.packageNumber}</h2>
          </div>
          <div className="grid trackingGrid">
            <div>
              <span>Description</span>
              <strong>{tracking.description}</strong>
            </div>
            <div>
              <span>Destination</span>
              <strong>{tracking.destination}</strong>
            </div>
            <div>
              <span>Status</span>
              <strong>{tracking.status}</strong>
            </div>
            <div>
              <span>Receiving Record</span>
              <strong>{tracking.receivingRecordNumber}</strong>
            </div>
            <div>
              <span>Condition</span>
              <strong>{tracking.condition}</strong>
            </div>
            <div>
              <span>Price</span>
              <strong>{tracking.price == null ? "For confirmation" : `PHP ${tracking.price.toLocaleString()}`}</strong>
            </div>
          </div>
          <div className="trackingQr">{tracking.qrValue}</div>
        </section>
      ) : (
        <section className="panel trackingCard">
          <h2>Shipment not found</h2>
          <p className="muted">Please check the package number or QR reference.</p>
        </section>
      )}
    </main>
  );
}
