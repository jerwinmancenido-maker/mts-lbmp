# MTS LBMP Full Sprint Roadmap v1

## Scope

This roadmap covers Sprints 1-15 for the Mancenido Trucking Services Logistics Business Management Platform.

Baseline:

```text
Blueprint v2.0 = official baseline
Blueprint v2.1 = accepted refinement layer
```

The roadmap is app-first and optimized for fast logistics transactions on NB80 Android POS tablets.

## Development Philosophy

The system should feel like a premium logistics app with simple POS-style operations.

Core UX rules:

- Large buttons
- Minimal typing
- Scan-first workflow
- Friendly messages
- Clear next action
- English/Tagalog switchable
- Dark mode configurable
- Product/package description only during receiving
- Barcode may auto-fill description
- Customer DR OCR is assistive only and must be reviewed
- One MTS QR generated per package

## Technical Baseline

```text
Frontend: Next.js / PWA
Backend: NestJS
Database: MySQL
ORM: Prisma
Auth: JWT
Mobile wrapper: Capacitor if NB80 hardware requires it
Printer: 80mm ESC/POS
Storage: Cloud object storage
Repo: Monorepo
```

## Error-Handling Policy

Default rule:

```text
If an error occurs, apply the best technical or UX recommendation, document the decision, and keep moving.
```

Do not stop the sprint unless the issue affects:

- Customer data security
- Payment data integrity
- Document number duplication
- Audit trail loss
- Irrecoverable database issue
- Approved business rules
- Legal/business proof of delivery
- Owner-controlled approvals

Business-rule uncertainty should use the safest conservative default, be logged as an assumption/change request, and continue where possible.

## Validation Gates

### Gate A - After Sprint 2

- Login works
- Roles work
- Permissions work
- Audit base works

### Gate B - After Sprint 6

- Receiving works
- Package QR works
- 80mm receipt prints or has tested fallback
- Photos upload
- Price can be blank at receiving
- Price is required before loading

### Gate C - After Sprint 8

- Trip assignment works
- Loading QR scan works
- Wrong destination warnings work
- Mixed trip notification works

### Gate D - After Sprint 10

- Arrival works
- Delivery works
- POD works
- Failed delivery works
- Damage workflow works

### Gate E - After Sprint 12

- Payments work
- Expenses work
- Basic profitability works

### Gate F - After Sprint 15

- Owner dashboard works
- Customer portal tracking works
- Reports use real workflow data
- App is ready for hardware hardening and deployment prep

## Sprint 1 - Project Setup and App Foundation

Goal: create the project foundation and app structure.

Deliverables:

- Monorepo initialized
- `apps/web`
- `apps/api`
- `apps/mobile` placeholder
- Shared packages
- Environment structure
- Base README
- Documentation folders
- Basic app shell
- Design system foundation

Acceptance criteria:

- Web app can run
- API app can run
- Database connection path is documented
- Shared package import strategy is clear
- Folder structure matches roadmap

Error plan:

- If monorepo tooling creates friction, use the simplest stable setup and preserve clear boundaries.

## Sprint 2 - Auth, Users, Roles, Permissions

Goal: build the security and access foundation.

Deliverables:

- Login
- JWT auth
- Users
- Roles
- Permissions
- Role presets
- User overrides
- Branch access base
- Audit log base
- Protected routes

Acceptance criteria:

- User can log in
- Role controls navigation
- Unauthorized actions are blocked
- Admin can manage users
- Audit logs record security actions

Error plan:

- Permission uncertainty defaults to deny access.

## Sprint 3 - Company Settings, Branches, Customers

Goal: build administrative business setup.

Deliverables:

- Company profile settings
- Logo upload placeholder
- Branch management
- Branch capabilities
- Customer management
- Customer users
- Sender management
- Consignee management

Acceptance criteria:

- Owner can create branches
- Owner can configure branch capabilities
- Staff can create customers if permitted
- Customers can have multiple users
- Sender and consignee records are linked properly

Error plan:

- If customer relationships become complex, keep customer, sender, and consignee separate but linked.

## Sprint 4 - Item Description, Barcode, Pricing History

Goal: make receiving product entry fast.

Deliverables:

- Product/package description master
- Barcode/QR lookup for descriptions
- Quick add description
- Last price memory
- Pricing history
- Price difference reason
- Optional weight/dimensions fields

Important rule:

```text
Use one simple Product / Package Description field during receiving.
```

Acceptance criteria:

- Staff can scan barcode and auto-fill description
- Staff can quick-add a new description
- Last price appears when available
- Price change requires reason
- Weight/dimensions are optional

Error plan:

- If barcode data is inconsistent, save it as an external code linked to description, not as the only product identifier.

## Sprint 5 - Receiving Workflow

Goal: build the fast receiving tablet workflow.

Deliverables:

- Receiving record creation
- Customer DR number
- DR photo upload
- Optional DR OCR assist placeholder
- Sender/consignee selection
- Destination selection
- Package-level cargo creation
- Package condition
- Photo upload
- Manual price
- Price blank allowed
- Receiving timeline

Package condition values:

```text
Good
Damaged
Wet
Incomplete
For Checking
Other
```

Acceptance criteria:

- Staff can receive individual packages
- Staff can use a large-button workflow
- Price can be blank
- Condition is captured
- Non-good condition requires photo/notes
- Receiving record gets sequential number

Error plan:

- OCR remains assistive. Manual review is the official source.

## Sprint 6 - QR Labels and Print Engine MVP

Goal: create package QR tracking and 80mm printing.

Deliverables:

- MTS QR per package
- QR label layout
- Receiving slip layout
- 80mm ESC/POS print profile
- Print preview
- Reprint tracking
- Reprint reason
- Price visibility setting

Acceptance criteria:

- Package QR prints
- QR scans back into system
- Receiving slip fits 80mm layout
- Reprints require reason
- Print action is audited

Error plan:

- If direct NB80 printing is not available from PWA, use print preview/browser fallback and log APK integration for hardware hardening.

## Sprint 7 - Trips, Vehicles, Drivers, Providers

Goal: build trip management around cargo movement.

Deliverables:

- Trip creation
- Origin/destination
- Company/rental/partner truck support
- Vehicle providers
- Drivers
- Trip statuses
- Trip timeline
- Trip documents base

Acceptance criteria:

- Staff can create trip
- Vehicle/driver/provider can be assigned
- Trip has continuous document number
- Trip timeline records changes

Error plan:

- If vehicle data is incomplete, allow temporary/manual vehicle description with owner cleanup later.

## Sprint 8 - Loading Workflow

Goal: ensure only eligible cargo can be loaded.

Deliverables:

- Loading screen
- Scan MTS QR
- Validate price exists
- Validate destination
- Validate status
- Mixed trip detection
- Mixed trip notification
- Wrong-destination warning
- Left-behind cargo
- Loading manifest
- Waybill/trip sheet base

Cargo cannot load if:

```text
No price
Missing destination
Already loaded on active trip
Already delivered
Soft deleted
Unresolved damage exception
```

Acceptance criteria:

- Staff can scan packages into trip
- No-price cargo is blocked
- Destination mismatch warns staff
- Mixed trip is flagged and notifications are sent
- Left-behind cargo remains waiting

Error plan:

- Block risky loading and log the exception. Do not silently allow wrong-destination loading.

## Sprint 9 - Arrival and Unloading

Goal: verify cargo at destination or direct-delivery point.

Deliverables:

- Mark trip arrived
- Unloading screen
- Scan unloaded cargo
- Compare against manifest
- Missing cargo report
- Damage report
- Branch staging
- Direct delivery route
- Arrival report

Acceptance criteria:

- Arrival timestamp is recorded
- Staff can scan cargo during unloading
- Missing cargo is detected
- Damage requires photo/notes
- Cargo can be staged or sent to direct delivery

Error plan:

- If scan fails, allow manual package lookup with reason and audit.

## Sprint 10 - Delivery, POD, Failed Delivery

Goal: complete delivery with proof or record failed delivery properly.

Deliverables:

- Delivery screen
- Scan/open cargo
- Recipient name
- Signature capture
- Delivery photo
- Proof of delivery
- Delivery receipt
- Damaged cargo acceptance
- Failed delivery workflow

Failed delivery statuses:

```text
Failed Delivery
Customer Not Available
Wrong Address
Refused by Receiver
Reschedule Required
Returned to Branch
Returned to Sender
```

Acceptance criteria:

- Delivered cargo has recipient name, signature, and photo
- Delivery receipt can print
- Failed delivery cannot save without reason
- Damaged cargo requires customer acceptance before completion

Error plan:

- If signature capture has device issues, allow typed name plus photo temporarily and log signature issue as hardware/UX risk.

## Sprint 11 - Payments

Goal: track operational payment status without becoming full accounting.

Deliverables:

- Payment recording
- Partial payment
- Upfront payment
- Proof upload
- Payment status
- Balance calculation
- Payment history
- Payment verification
- Void/edit with reason

Payment fields:

```text
Amount due
Amount paid
Balance
Payment method
Proof of payment
Recorded by
Verified by
Status
Notes
```

Out of scope:

```text
General ledger
Trial balance
Tax filing
Journal entries
Full accounting module
```

Acceptance criteria:

- Delivery staff can record payment
- Partial payment calculates balance
- Proof can be uploaded
- Owner/admin can verify
- Edit/void requires reason and audit

Error plan:

- Payment corruption is blocking. Preserve original payment records and use append-only correction history.

## Sprint 12 - Expenses and Basic Profitability

Goal: track operational expenses and basic profit.

Deliverables:

- Expense categories
- Custom categories
- Expense entry
- Receipt photo
- Owner notification for all expenses
- Expense approval
- Trip expense association
- Basic profitability

Default expense categories:

```text
Fuel
Truck Rental
Driver Allowance
Helper Allowance
Meals
Parking
Repairs
Toll
Labor
Loading / Unloading
Branch Expense
Communication
Miscellaneous
Custom
```

Profit formula:

```text
Delivered cargo revenue - approved operational expenses
```

Acceptance criteria:

- Staff can submit expense
- Owner is notified
- Owner can approve/reject
- Trip profitability calculates
- Expenses are audited

Error plan:

- If profitability edge cases appear, label values as estimated and keep formula simple.

## Sprint 13 - Customer Portal and Shipment Messages

Goal: give customers self-service visibility.

Deliverables:

- Customer login
- Customer dashboard
- Shipment list
- Shipment detail
- Photos
- Documents
- POD view
- Payment status view
- Shipment-specific messages

Acceptance criteria:

- Customer sees only own shipments
- Customer can open shipment detail
- Customer can view POD/documents
- Customer can send shipment-specific message
- Internal expenses/audit data are hidden

Error plan:

- Any customer data leakage blocks release. Customer isolation must be tested before continuing.

## Sprint 14 - Public Website and Public Tracking

Goal: build the corporate website and limited public tracking.

Deliverables:

- Home
- About
- Services
- Coverage
- Contact
- Customer Login
- Public Tracking
- Owner/customer sign-in entry

Public tracking must hide:

- Prices unless explicitly allowed
- Internal notes
- Expenses
- Full customer account data
- Staff audit data

Acceptance criteria:

- Website is responsive
- Public tracking works with safe data
- Customer login is accessible
- Website feels professional and logistics-focused

Error plan:

- If privacy is uncertain, show less data.

## Sprint 15 - Dashboards and Basic Reports

Goal: provide operational visibility using real workflow data.

Deliverables:

- Owner dashboard
- Receiving dashboard
- Delivery dashboard
- Customer dashboard improvements
- Basic reports
- Notification center
- Exception summary

Owner dashboard priority:

- Cargo waiting
- Cargo without price
- Active trips
- Failed deliveries
- Damaged cargo
- Missing cargo
- Payments collected
- Unpaid balances
- Expenses awaiting approval
- Estimated profit

Acceptance criteria:

- Dashboard data matches actual records
- Notifications open related records
- Reports export or print where needed
- Owner can see operational health quickly

Error plan:

- Defer advanced analytics if they slow core workflow. Keep operational reports accurate.

## Definition of Done For Sprints 1-15

Sprints 1-15 are complete when:

```text
A package can be received.
A QR label can be printed.
The package can be assigned to a trip.
The package can be loaded.
The trip can arrive.
The package can be delivered or failed delivery recorded.
POD can be captured.
Payment status can be recorded.
Expenses can be recorded.
Customer can view shipment status.
Owner can see operational dashboard.
All important actions are audited.
```

