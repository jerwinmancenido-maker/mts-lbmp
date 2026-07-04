import Link from "next/link";

export default function Page() {
  return (
    <main className="website">
      <section className="websiteHero">
        <div>
          <p className="eyebrow">Mancenido Trucking Services</p>
          <h1>Logistics made traceable from receiving to delivery.</h1>
          <p>
            A modern cargo operations platform for package receiving, QR labels, trips, loading,
            delivery proof, payments, expenses, customer tracking, and business visibility.
          </p>
          <div className="websiteActions">
            <Link className="publicLink" href="/app">Open Operations App</Link>
            <Link className="secondaryLink" href="/tracking/PKG-2026-07-000001">Try Shipment Tracking</Link>
          </div>
        </div>
      </section>

      <section className="websiteBand">
        <h2>Services</h2>
        <div className="websiteGrid">
          <article>
            <strong>Cargo Receiving</strong>
            <p>Fast package intake with photos, condition records, manual pricing, and QR labels.</p>
          </article>
          <article>
            <strong>Trip-Based Transport</strong>
            <p>Company, rental, and partner trucks managed around trips, not fixed branches.</p>
          </article>
          <article>
            <strong>Delivery Proof</strong>
            <p>Recipient name, signature, photos, failed delivery handling, and customer visibility.</p>
          </article>
        </div>
      </section>

      <section className="websiteBand alt">
        <h2>Coverage</h2>
        <p>Designed for Origin, Daet, Naga, return cargo, direct delivery, and future routes.</p>
      </section>

      <section className="websiteBand">
        <h2>Customer Portal</h2>
        <p>Customers can view shipment status, prices, documents, proof of delivery, and shipment-specific messages.</p>
        <Link className="publicLink darkLink" href="/app">Customer Login</Link>
      </section>

      <section className="websiteBand contact">
        <h2>Contact</h2>
        <p>Company details, branch names, contact numbers, and logo are owner-configurable inside the portal.</p>
      </section>
    </main>
  );
}
