import { Body, Controller, Get, Headers, Inject, Param, Patch, Post, Query, Req, StreamableFile } from "@nestjs/common";
import { PublicRoute, RequireAnyPermissions, RequirePermissions } from "./auth.guard.js";
import { LogisticsService } from "./logistics.service.js";

@Controller()
export class LogisticsController {
  constructor(@Inject(LogisticsService) private readonly logistics: LogisticsService) {}

  @Get("health")
  @PublicRoute()
  health() {
    return { ok: true, service: "MTS LBMP API" };
  }

  /**
   * Phase 5 P5-3: the FULL bootstrap now requires a valid token (the
   * staff shell fetches it after sign-in). It carries the customer list
   * and the staff directory, which the Phase 5 audit flagged as a public
   * leak when this route was unauthenticated.
   */
  @Get("bootstrap")
  bootstrap() {
    return this.logistics.getBootstrap();
  }

  /**
   * Phase 5 P5-3: the reduced public projection for unauthenticated
   * callers (the wall-QR intake page): company branding, branch names,
   * payment/expense defaults — no users, customers, trucks, or staff
   * data. The permission smoke asserts this shape by key scan.
   */
  @Get("bootstrap/public")
  @PublicRoute()
  publicBootstrap() {
    return this.logistics.getPublicBootstrap();
  }

  @Post("auth/login")
  @PublicRoute()
  login(@Body() body: { email: string; password: string }, @Headers("user-agent") userAgent?: string) {
    // Phase 5 P5-5: the user-agent rides along so the login audit entry
    // can carry its coarse device label (device-label.ts).
    return this.logistics.login({ ...body, userAgent });
  }

  @Post("auth/staff-code")
  @PublicRoute()
  staffCodeLogin(@Body() body: { staffCode: string }, @Headers("user-agent") userAgent?: string) {
    return this.logistics.loginWithStaffCode({ ...body, userAgent });
  }

  /**
   * Phase 5 P5-2: self-service password change. Authenticated (no extra
   * permission — it is the signed-in user's own credential) and, per the
   * auth guard's forced-change gate, the ONLY authenticated endpoint a
   * mustChangePassword-flagged account can reach.
   */
  @Post("auth/change-password")
  changePassword(
    @Req() request: { user?: { id?: string } },
    @Body() body: Parameters<LogisticsService["changeOwnPassword"]>[1]
  ) {
    return this.logistics.changeOwnPassword(request.user?.id ?? "", body);
  }

  @Get("dashboard")
  dashboard(@Req() request: { user?: { role?: string; branchAccess?: string } }) {
    return this.logistics.getDashboard(request.user);
  }

  @Get("audit")
  @RequirePermissions("audit.view")
  auditLogs(@Query() query: Parameters<LogisticsService["listAuditLogs"]>[0]) {
    return this.logistics.listAuditLogs(query);
  }

  @Get("hardware/tests")
  @RequirePermissions("settings.manage")
  hardwareTests() {
    return this.logistics.listHardwareTests();
  }

  @Post("hardware/tests")
  @RequirePermissions("settings.manage")
  createHardwareTest(@Body() body: Parameters<LogisticsService["createHardwareTest"]>[0]) {
    return this.logistics.createHardwareTest(body);
  }

  @Post("hardware/printer-diagnostic")
  @RequirePermissions("settings.manage")
  recordPrinterDiagnostic(@Body() body: Parameters<LogisticsService["recordPrinterDiagnostic"]>[0]) {
    return this.logistics.recordPrinterDiagnostic(body);
  }

  @Get("settings")
  @RequirePermissions("settings.manage")
  settings() {
    return this.logistics.getSettings();
  }

  @Patch("settings/company")
  @RequirePermissions("settings.manage")
  updateCompanyProfile(@Body() body: Parameters<LogisticsService["updateCompanyProfile"]>[0]) {
    return this.logistics.updateCompanyProfile(body);
  }

  @Post("settings/branches")
  @RequirePermissions("settings.manage")
  createBranch(@Body() body: Parameters<LogisticsService["createBranch"]>[0]) {
    return this.logistics.createBranch(body);
  }

  @Patch("settings/branches/:id")
  @RequirePermissions("settings.manage")
  updateBranch(@Param("id") id: string, @Body() body: Parameters<LogisticsService["updateBranch"]>[1]) {
    return this.logistics.updateBranch(id, body);
  }

  // Phase 5 P5-2: user management moves from settings.manage to the
  // purpose-built users.manage permission, which was defined in
  // @mts-lbmp/permissions but required by no endpoint until now. The
  // Daet/Naga Owner presets gain users.manage in the same change (they
  // already managed their branch staff through these endpoints under
  // settings.manage), so no existing workflow loses access; every other
  // settings endpoint stays on settings.manage. (The audit's P5-3 note
  // listed this swap as optional-if-small — it was small, so it lands
  // here instead of being deferred.)
  @Patch("settings/users/:id/branch-access")
  @RequirePermissions("users.manage")
  updateUserBranchAccess(@Param("id") id: string, @Body() body: Parameters<LogisticsService["updateUserBranchAccess"]>[1]) {
    return this.logistics.updateUserBranchAccess(id, body);
  }

  @Post("settings/users")
  @RequirePermissions("users.manage")
  createStaffUser(@Body() body: Parameters<LogisticsService["createStaffUser"]>[0]) {
    return this.logistics.createStaffUser(body);
  }

  @Patch("settings/users/:id")
  @RequirePermissions("users.manage")
  updateStaffUser(@Param("id") id: string, @Body() body: Parameters<LogisticsService["updateStaffUser"]>[1]) {
    return this.logistics.updateStaffUser(id, body);
  }

  /** Phase 5 P5-2: admin password reset (temporary password + forced change + session revocation). */
  @Post("settings/users/:id/reset-password")
  @RequirePermissions("users.manage")
  resetUserPassword(
    @Req() request: { user?: { id?: string } },
    @Param("id") id: string,
    @Body() body: Parameters<LogisticsService["resetUserPassword"]>[2]
  ) {
    return this.logistics.resetUserPassword(request.user?.id, id, body);
  }

  @Patch("settings/payment-methods")
  @RequirePermissions("settings.manage")
  updatePaymentMethods(@Body() body: { methods: string[] }) {
    return this.logistics.updatePaymentMethods(body);
  }

  @Patch("settings/expense-categories")
  @RequirePermissions("settings.manage")
  updateExpenseCategories(@Body() body: { categories: string[] }) {
    return this.logistics.updateExpenseCategories(body);
  }

  @Get("receiving")
  @RequirePermissions("receiving.view")
  receivingRecords(@Req() request: { user?: { branchAccess?: string } }) {
    return this.logistics.listReceivingRecords(request.user);
  }

  @Get("receiving/drafts")
  @RequirePermissions("receiving.view")
  receivingDrafts(@Req() request: { user?: { branchAccess?: string } }) {
    return this.logistics.listReceivingDrafts(request.user);
  }

  @Get("receiving/intake")
  @RequirePermissions("receiving.view")
  receivingIntakeTasks(
    @Req() request: { user?: { branchAccess?: string } },
    @Query() query: Parameters<LogisticsService["listReceivingIntakeTasks"]>[0]
  ) {
    return this.logistics.listReceivingIntakeTasks(query, request.user);
  }

  @Post("public/receiving-intake/validate")
  @PublicRoute()
  validateReceivingIntake(@Body() body: Parameters<LogisticsService["validateReceivingIntake"]>[0]) {
    return this.logistics.validateReceivingIntake(body);
  }

  @Post("public/receiving-intake/customer-suggestions")
  @PublicRoute()
  receivingIntakeCustomerSuggestions(@Body() body: { query?: string }) {
    return this.logistics.findPublicCustomerNameSuggestions(body.query);
  }

  @Post("public/receiving-intake")
  @PublicRoute()
  createReceivingIntake(@Body() body: Parameters<LogisticsService["createReceivingIntakeTask"]>[0]) {
    return this.logistics.createReceivingIntakeTask(body);
  }

  // Public: the unauthenticated intake page and the staff shell both call
  // this when a queued device photo finishes uploading. It only acts on
  // an exact pending local-photo reference match (Phase 4 audit A6).
  @Post("public/receiving-intake/resolve-photo")
  @PublicRoute()
  resolveReceivingIntakeQueuedPhoto(@Body() body: Parameters<LogisticsService["resolveReceivingIntakeQueuedPhoto"]>[0]) {
    return this.logistics.resolveReceivingIntakeQueuedPhoto(body);
  }

  @Post("customers")
  @RequirePermissions("customers.manage")
  createCustomer(@Body() body: Parameters<LogisticsService["createCustomer"]>[0]) {
    return this.logistics.createCustomer(body);
  }

  @Post("customers/pending")
  @RequirePermissions("receiving.create")
  createPendingCustomer(@Body() body: Parameters<LogisticsService["createPendingCustomer"]>[0]) {
    return this.logistics.createPendingCustomer(body);
  }

  @Patch("customers/:id/finalize")
  @RequirePermissions("customers.manage")
  finalizeCustomer(@Param("id") id: string, @Body() body: { businessName?: string; contactPerson?: string; phone?: string; billingTerm?: string; billingTermDays?: number | null }) {
    return this.logistics.finalizeCustomer(id, body);
  }

  @Patch("customers/:id")
  @RequirePermissions("customers.manage")
  updateCustomer(@Param("id") id: string, @Body() body: Parameters<LogisticsService["updateCustomer"]>[1]) {
    return this.logistics.updateCustomer(id, body);
  }

  @Post("customers/:id/contacts")
  @RequirePermissions("receiving.create")
  addCustomerContact(@Param("id") id: string, @Body() body: Parameters<LogisticsService["addCustomerContact"]>[1]) {
    return this.logistics.addCustomerContact(id, body);
  }

  // Phase 6 P6-4: the reminder's amount is computed server-side from
  // the caller's branch scope — the body now carries only the branch
  // label, never a balance, and the response names the real channel
  // (in-app; no SMS/email integration exists).
  @Post("customers/:id/billing-reminder")
  @RequirePermissions("customers.manage")
  createCustomerBillingReminder(
    @Req() request: { user?: { branchAccess?: string } },
    @Param("id") id: string,
    @Body() body: Parameters<LogisticsService["createCustomerBillingReminder"]>[1]
  ) {
    return this.logistics.createCustomerBillingReminder(id, body ?? {}, request.user);
  }

  // Phase 6 P6-4: the customer's reminder history from the audit
  // trail (manual reminders + the due scan's automatic notices). It
  // rides the balance endpoints' any-of gate and their
  // existence-hiding visibility rule — the service gates on the
  // balance read itself.
  @Get("customers/:id/reminder-history")
  @RequireAnyPermissions("reports.view", "customers.manage")
  customerReminderHistory(@Req() request: { user?: { branchAccess?: string } }, @Param("id") id: string) {
    return this.logistics.getCustomerReminderHistory(id, request.user);
  }

  @Post("receiving")
  @RequirePermissions("receiving.create")
  createReceiving(
    @Body() body: Parameters<LogisticsService["createReceiving"]>[0],
    @Headers("idempotency-key") idempotencyKey?: string
  ) {
    return this.logistics.createReceiving({ ...body, idempotencyKey: body.idempotencyKey ?? idempotencyKey });
  }

  @Post("receiving/:id/dr-photo")
  @RequirePermissions("receiving.create")
  attachReceivingDrPhoto(
    @Param("id") id: string,
    @Body() body: Parameters<LogisticsService["attachReceivingDrPhoto"]>[1],
    @Headers("idempotency-key") idempotencyKey?: string
  ) {
    return this.logistics.attachReceivingDrPhoto(id, { ...body, idempotencyKey: body.idempotencyKey ?? idempotencyKey });
  }

  @Patch("receiving/:id")
  @RequirePermissions("receiving.create")
  updateReceivingRecord(@Param("id") id: string, @Body() body: Parameters<LogisticsService["updateReceivingRecord"]>[1]) {
    return this.logistics.updateReceivingRecord(id, body);
  }

  @Get("receiving/:id/audit")
  @RequirePermissions("receiving.view")
  receivingRecordAudit(@Req() request: { user?: { branchAccess?: string } }, @Param("id") id: string) {
    return this.logistics.listReceivingRecordAudit(id, request.user);
  }

  @Post("receiving/drafts")
  @RequirePermissions("receiving.create")
  createReceivingDraft(
    @Body() body: Parameters<LogisticsService["createReceivingDraft"]>[0],
    @Headers("idempotency-key") idempotencyKey?: string
  ) {
    return this.logistics.createReceivingDraft({ ...body, idempotencyKey: body.idempotencyKey ?? idempotencyKey });
  }

  @Patch("receiving/drafts/:id")
  @RequirePermissions("receiving.create")
  updateReceivingDraft(
    @Param("id") id: string,
    @Body() body: Parameters<LogisticsService["updateReceivingDraft"]>[1],
    @Headers("idempotency-key") idempotencyKey?: string
  ) {
    return this.logistics.updateReceivingDraft(id, { ...body, idempotencyKey: body.idempotencyKey ?? idempotencyKey });
  }

  @Post("receiving/drafts/:id/finalize")
  @RequirePermissions("receiving.create")
  finalizeReceivingDraft(
    @Param("id") id: string,
    @Body() body: Parameters<LogisticsService["finalizeReceivingDraft"]>[1],
    @Headers("idempotency-key") idempotencyKey?: string
  ) {
    return this.logistics.finalizeReceivingDraft(id, { ...body, idempotencyKey: body.idempotencyKey ?? idempotencyKey });
  }

  @Post("receiving/drafts/:id/cancel")
  @RequirePermissions("receiving.create")
  cancelReceivingDraft(@Param("id") id: string) {
    return this.logistics.cancelReceivingDraft(id);
  }

  @Post("receiving/intake/:id/convert")
  @RequirePermissions("receiving.create")
  convertReceivingIntake(@Param("id") id: string, @Body() body: Parameters<LogisticsService["markReceivingIntakeConverted"]>[1]) {
    return this.logistics.markReceivingIntakeConverted(id, body);
  }

  @Post("receiving/intake/:id/cancel")
  @RequirePermissions("receiving.create")
  cancelReceivingIntake(@Param("id") id: string, @Body() body: Parameters<LogisticsService["cancelReceivingIntake"]>[1]) {
    return this.logistics.cancelReceivingIntake(id, body);
  }

  /**
   * Phase 5 P5-3: GET /packages gains a real permission and server-side
   * branch scoping. The permission is the new `packages.view` (not
   * `receiving.view`): the shell's delivery tab loads this list and
   * Delivery Staff/Delivery Admin do not hold receiving.view, while
   * every customer preset is empty — so packages.view goes to all staff
   * presets and customer tokens get no package list at all (their
   * tracking stays on the public GET /tracking/:reference below).
   */
  @Get("packages")
  @RequirePermissions("packages.view")
  packages(
    @Req() request: { user?: { branchAccess?: string } },
    @Query() query: Parameters<LogisticsService["listPackages"]>[0]
  ) {
    return this.logistics.listPackages(query, request.user);
  }

  /**
   * Phase 5 P5-3: staff uploads require a valid token (any staff role —
   * the guard authenticates; no narrower permission is imposed). The
   * public intake page's DR photos use the scoped variant below.
   */
  @Post("uploads")
  uploadFile(@Body() body: { dataUrl: string; fileName: string; type: string; entityId?: string }) {
    return this.logistics.uploadFile(body);
  }

  /**
   * Phase 5 P5-3: scoped public upload variant for the wall-QR intake
   * flow. Accepts only the intake DR photo type, with the shared
   * type/size enforcement in the service; the uploaded URL binds to an
   * intake task only through the resolve-photo step.
   */
  @Post("public/receiving-intake/upload-photo")
  @PublicRoute()
  uploadIntakePhoto(@Body() body: { dataUrl: string; fileName: string; type: string; entityId?: string }) {
    return this.logistics.uploadIntakePhoto(body);
  }

  @Get("tracking/:reference")
  @PublicRoute()
  trackShipment(@Param("reference") reference: string) {
    return this.logistics.trackShipment(reference);
  }

  @Post("barcodes/scan")
  @RequirePermissions("receiving.create")
  scanDescription(@Body() body: { customerId: string; barcode: string }) {
    return this.logistics.scanDescription(body);
  }

  @Post("barcodes/link")
  @RequirePermissions("receiving.create")
  linkDescriptionBarcode(@Body() body: { customerId: string; barcode: string; description: string }) {
    return this.logistics.linkDescriptionBarcode(body);
  }

  @Get("products")
  @RequirePermissions("receiving.view")
  productMasters(@Query() query: Parameters<LogisticsService["listProductMasters"]>[0]) {
    return this.logistics.listProductMasters(query);
  }

  @Post("products/scan")
  @RequirePermissions("receiving.create")
  scanProductMaster(@Body() body: { barcode: string }) {
    return this.logistics.scanProductMaster(body);
  }

  @Post("products")
  @RequirePermissions("receiving.create")
  createProductMaster(@Body() body: Parameters<LogisticsService["createProductMaster"]>[0]) {
    return this.logistics.createProductMaster(body);
  }

  @Post("pricing/suggest")
  @RequirePermissions("receiving.create")
  suggestPrice(@Body() body: Parameters<LogisticsService["suggestPrice"]>[0]) {
    return this.logistics.suggestPrice(body);
  }

  @Get("packages/:id/messages")
  @RequirePermissions("messages.reply")
  packageMessages(@Req() request: { user?: { branchAccess?: string } }, @Param("id") id: string) {
    return this.logistics.listMessages(id, request.user);
  }

  @Post("packages/:id/messages")
  @RequirePermissions("messages.reply")
  createPackageMessage(@Param("id") id: string, @Body() body: { senderName: string; body: string }) {
    return this.logistics.createMessage({ cargoPackageId: id, senderName: body.senderName, body: body.body });
  }

  @Get("operation-chats")
  @RequirePermissions("messages.reply")
  operationChats(@Req() request: { user?: { id?: string; role?: string; branchAccess?: string } }) {
    return this.logistics.listOperationChats(request.user);
  }

  @Post("operation-chats/messages")
  @RequirePermissions("messages.reply")
  createOperationChatMessage(
    @Req() request: { user?: { id?: string; role?: string; branchAccess?: string } },
    @Body() body: { threadId?: string; body: string }
  ) {
    return this.logistics.createOperationChatMessage(body, request.user);
  }

  @Post("operation-chats/price-requests")
  @RequirePermissions("messages.reply")
  createOperationPriceRequest(
    @Req() request: { user?: { id?: string; role?: string; branchAccess?: string } },
    @Body() body: { cargoPackageId: string; proposedPrice: number; note?: string }
  ) {
    return this.logistics.createPriceApprovalRequest(body, request.user);
  }

  @Post("operation-chats/:id/price-decision")
  @RequirePermissions("pricing.edit")
  decideOperationPrice(
    @Param("id") id: string,
    @Req() request: { user?: { id?: string; role?: string; branchAccess?: string } },
    @Body() body: { decision: "Approved" | "Rejected"; approvedPrice?: number; note?: string }
  ) {
    return this.logistics.decidePriceApproval(id, body, request.user);
  }

  @Patch("packages/:id/price")
  @RequirePermissions("pricing.edit")
  updatePackagePrice(@Param("id") id: string, @Body() body: { price: number; reason?: string }) {
    return this.logistics.updatePackagePrice(id, body);
  }

  @Patch("packages/:id/measurements")
  @RequirePermissions("loading.scan")
  updatePackageMeasurements(@Param("id") id: string, @Body() body: Parameters<LogisticsService["updatePackageMeasurements"]>[1]) {
    return this.logistics.updatePackageMeasurements(id, body);
  }

  @Post("packages/:id/verify-arrival")
  @RequirePermissions("delivery.complete")
  verifyArrivedCargo(@Param("id") id: string, @Body() body: Parameters<LogisticsService["verifyArrivedCargo"]>[1]) {
    return this.logistics.verifyArrivedCargo(id, body);
  }

  @Post("packages/:id/soft-delete")
  @RequirePermissions("records.softDelete")
  softDeletePackage(@Param("id") id: string, @Body() body: { reason: string }) {
    return this.logistics.softDeletePackage(id, body);
  }

  @Post("packages/:id/restore")
  @RequirePermissions("records.restore")
  restorePackage(@Param("id") id: string, @Body() body: { reason: string }) {
    return this.logistics.restorePackage(id, body);
  }

  @Get("packages/:id/receiving-slip")
  @RequirePermissions("documents.print")
  receivingSlip(@Req() request: { user?: { branchAccess?: string } }, @Param("id") id: string) {
    return this.logistics.renderReceivingSlip(id, request.user);
  }

  @Get("receiving/:id/receiving-document")
  @RequirePermissions("documents.print")
  receivingDocument(@Req() request: { user?: { branchAccess?: string } }, @Param("id") id: string) {
    return this.logistics.renderReceivingDocument(id, request.user);
  }

  @Get("packages/:id/qr-label")
  @RequirePermissions("documents.print")
  qrLabel(@Req() request: { user?: { branchAccess?: string } }, @Param("id") id: string) {
    return this.logistics.renderQrLabel(id, request.user);
  }

  @Get("packages/:id/delivery-receipt")
  @RequirePermissions("documents.print")
  deliveryReceipt(@Req() request: { user?: { branchAccess?: string } }, @Param("id") id: string) {
    return this.logistics.renderDeliveryReceipt(id, request.user);
  }

  @Post("printing/handoffs")
  @RequirePermissions("documents.print")
  recordPrintHandoff(
    @Req() request: { user?: { id?: string; role?: string; branchAccess?: string } },
    @Body() body: Parameters<LogisticsService["recordPrintHandoff"]>[0]
  ) {
    return this.logistics.recordPrintHandoff(body, request.user);
  }

  @Post("printing/escpos-preview")
  @RequirePermissions("documents.print")
  escposPreview(@Body() body: { text: string }) {
    return this.logistics.renderEscPosPreview(body.text);
  }

  @Get("trips")
  @RequirePermissions("trips.view")
  trips(
    @Req() request: { user?: { branchAccess?: string } },
    @Query() query: Parameters<LogisticsService["listTrips"]>[0]
  ) {
    return this.logistics.listTrips(query, request.user);
  }

  @Get("trucks")
  @RequirePermissions("trips.view")
  trucks() {
    return this.logistics.listTrucks();
  }

  @Post("trucks")
  @RequirePermissions("trips.create")
  saveTruck(@Body() body: Parameters<LogisticsService["saveTruck"]>[0]) {
    return this.logistics.saveTruck(body);
  }

  @Post("trips")
  @RequirePermissions("trips.create")
  createTrip(@Body() body: Parameters<LogisticsService["createTrip"]>[0]) {
    return this.logistics.createTrip(body);
  }

  @Post("trips/:id/load")
  @RequirePermissions("loading.scan")
  loadCargo(
    @Req() request: { user?: { branchAccess?: string } },
    @Param("id") id: string,
    @Body() body: { cargoPackageId: string; overrideReason?: string; idempotencyKey?: string },
    @Headers("idempotency-key") idempotencyKey?: string
  ) {
    return this.logistics.loadCargo(id, { ...body, idempotencyKey: body.idempotencyKey ?? idempotencyKey }, request.user);
  }

  @Post("trips/:id/unload")
  @RequirePermissions("loading.scan")
  unloadCargo(
    @Param("id") id: string,
    @Body() body: { cargoPackageId: string; reason?: string; idempotencyKey?: string },
    @Headers("idempotency-key") idempotencyKey?: string
  ) {
    return this.logistics.unloadCargo(id, { ...body, idempotencyKey: body.idempotencyKey ?? idempotencyKey });
  }

  @Post("trips/:id/loading-photo")
  @RequirePermissions("loading.scan")
  attachTripLoadingPhoto(
    @Param("id") id: string,
    @Body() body: { photoUrl: string; idempotencyKey?: string },
    @Headers("idempotency-key") idempotencyKey?: string
  ) {
    return this.logistics.attachTripLoadingPhoto(id, { ...body, idempotencyKey: body.idempotencyKey ?? idempotencyKey });
  }

  @Post("trips/:id/mixed-approval")
  @RequirePermissions("trips.create")
  reviewMixedTrip(@Param("id") id: string, @Body() body: Parameters<LogisticsService["reviewMixedTrip"]>[1]) {
    return this.logistics.reviewMixedTrip(id, body);
  }

  @Post("trips/:id/depart")
  @RequirePermissions("trips.edit")
  departTrip(@Param("id") id: string) {
    return this.logistics.departTrip(id);
  }

  @Post("trips/:id/arrive")
  @RequirePermissions("arrival.scan")
  arriveTrip(@Param("id") id: string) {
    return this.logistics.arriveTrip(id);
  }

  @Post("trips/:id/complete")
  @RequirePermissions("trips.edit")
  completeTrip(@Param("id") id: string) {
    return this.logistics.completeTrip(id);
  }

  @Get("trips/:id/loading-manifest")
  @RequirePermissions("documents.print")
  loadingManifest(@Req() request: { user?: { branchAccess?: string } }, @Param("id") id: string) {
    return this.logistics.renderTripManifest(id, request.user);
  }

  @Get("deliveries")
  @RequirePermissions("delivery.complete")
  deliveries(@Req() request: { user?: { branchAccess?: string } }) {
    return this.logistics.listDeliveries(request.user);
  }

  @Post("deliveries/complete")
  @RequirePermissions("delivery.complete")
  completeDelivery(@Body() body: Parameters<LogisticsService["completeDelivery"]>[0], @Headers("idempotency-key") idempotencyKey?: string) {
    return this.logistics.completeDelivery({ ...body, idempotencyKey: body.idempotencyKey ?? idempotencyKey });
  }

  @Post("deliveries/fail")
  @RequirePermissions("delivery.fail")
  failDelivery(@Body() body: Parameters<LogisticsService["failDelivery"]>[0], @Headers("idempotency-key") idempotencyKey?: string) {
    return this.logistics.failDelivery({ ...body, idempotencyKey: body.idempotencyKey ?? idempotencyKey });
  }

  @Get("returns")
  @RequirePermissions("delivery.complete")
  returnRecords(@Req() request: { user?: { branchAccess?: string } }) {
    return this.logistics.listReturnRecords(request.user);
  }

  @Post("returns")
  @RequirePermissions("delivery.complete")
  createReturnRecord(
    @Body() body: Parameters<LogisticsService["createReturnRecord"]>[0],
    @Headers("idempotency-key") idempotencyKey?: string
  ) {
    return this.logistics.createReturnRecord({ ...body, idempotencyKey: body.idempotencyKey ?? idempotencyKey });
  }

  @Get("payments")
  @RequirePermissions("payments.record")
  payments(
    @Req() request: { user?: { branchAccess?: string } },
    @Query() query: Parameters<LogisticsService["listPayments"]>[0]
  ) {
    return this.logistics.listPayments(query, request.user);
  }

  @Post("payments")
  @RequirePermissions("payments.record")
  recordPayment(@Body() body: Parameters<LogisticsService["recordPayment"]>[0], @Headers("idempotency-key") idempotencyKey?: string) {
    return this.logistics.recordPayment({ ...body, idempotencyKey: body.idempotencyKey ?? idempotencyKey });
  }

  @Get("billing/invoices")
  @RequirePermissions("customers.manage")
  billingInvoices(@Req() request: { user?: { branchAccess?: string } }) {
    return this.logistics.listBillingInvoices(request.user);
  }

  @Post("billing/invoices")
  @RequirePermissions("customers.manage")
  createBillingInvoice(@Body() body: Parameters<LogisticsService["createBillingInvoice"]>[0]) {
    return this.logistics.createBillingInvoice(body);
  }

  // Phase 6 P6-1: invoice detail read (branch-scoped, existence-hiding —
  // the P5-3 detail pattern), void, and the server-rendered statement.
  // Billing reads/writes stay behind customers.manage, the permission the
  // existing list/create endpoints already use; documents.print gates the
  // statement render like every other printed document. (reports.view
  // enforcement is P6-2's job and is deliberately not half-wired here.)
  // Phase 6 P6-3: the statement's CSV sibling shares the documents.print
  // gate — the CSV is the same statement in file form, generated and
  // streamed (nothing persisted, Phase 6 audit §5.2a).
  @Get("billing/invoices/:id")
  @RequirePermissions("customers.manage")
  billingInvoice(@Req() request: { user?: { branchAccess?: string } }, @Param("id") id: string) {
    return this.logistics.getBillingInvoice(id, request.user);
  }

  @Post("billing/invoices/:id/void")
  @RequirePermissions("customers.manage")
  voidBillingInvoice(
    @Req() request: { user?: { branchAccess?: string } },
    @Param("id") id: string,
    @Body() body: { reason?: string }
  ) {
    return this.logistics.voidBillingInvoice(id, request.user, body ?? {});
  }

  @Get("billing/invoices/:id/statement")
  @RequirePermissions("documents.print")
  billingStatement(@Req() request: { user?: { branchAccess?: string } }, @Param("id") id: string) {
    return this.logistics.renderBillingStatement(id, request.user);
  }

  @Get("billing/invoices/:id/statement.csv")
  @RequirePermissions("documents.print")
  billingStatementCsv(@Req() request: { user?: { branchAccess?: string } }, @Param("id") id: string) {
    const { filename, csv } = this.logistics.getBillingInvoiceStatementCsv(id, request.user);
    return new StreamableFile(Buffer.from(csv, "utf8"), {
      type: "text/csv; charset=utf-8",
      disposition: `attachment; filename="${filename}"`
    });
  }

  // Phase 6 P6-4: the Due/Overdue worklist (Payments → Billing) and the
  // manual due-scan trigger. Both sit with the billing family behind
  // customers.manage; the scan also runs at boot, on a timer, and
  // lazily inside the worklist read itself.
  @Get("billing/due-worklist")
  @RequirePermissions("customers.manage")
  dueWorklist(@Req() request: { user?: { branchAccess?: string } }) {
    return this.logistics.listDueWorklist(request.user);
  }

  @Post("billing/due-reminders/scan")
  @RequirePermissions("customers.manage")
  runDueReminderScan() {
    return this.logistics.runDueReminderScan();
  }

  // Phase 6 P6-2: server-side customer balances + aging. This is the
  // FIRST real enforcement of reports.view (owners and Delivery Admin
  // reach balances through it alone); customers.manage also passes via
  // the any-of gate because the customer-desk roles (Receiving Staff)
  // work balances from the Customers module, and every other
  // customer-money endpoint is already gated on customers.manage.
  // Figures are branch-scoped in the service (P5-3 patterns).
  @Get("balances")
  @RequireAnyPermissions("reports.view", "customers.manage")
  balances(@Req() request: { user?: { branchAccess?: string } }) {
    return this.logistics.listCustomerBalances(request.user);
  }

  @Get("customers/:id/balance")
  @RequireAnyPermissions("reports.view", "customers.manage")
  customerBalance(@Req() request: { user?: { branchAccess?: string } }, @Param("id") id: string) {
    return this.logistics.getCustomerBalance(id, request.user);
  }

  // Phase 6 P6-3: the customer's outstanding statement as a CSV file —
  // the balance payload's rows in file form, so it carries the balance
  // endpoints' any-of gate (reports.view OR customers.manage) and the
  // service's branch-scoped, existence-hiding derivation unchanged.
  // Generated and streamed; nothing is persisted.
  @Get("customers/:id/statement.csv")
  @RequireAnyPermissions("reports.view", "customers.manage")
  customerStatementCsv(@Req() request: { user?: { branchAccess?: string } }, @Param("id") id: string) {
    const { filename, csv } = this.logistics.getCustomerStatementCsv(id, request.user);
    return new StreamableFile(Buffer.from(csv, "utf8"), {
      type: "text/csv; charset=utf-8",
      disposition: `attachment; filename="${filename}"`
    });
  }

  // Phase 6 P6-5: profitability report — the system's first
  // date-ranged query (period anchoring and definitions live in
  // LogisticsService.getProfitabilityReport; the payload carries a
  // `definition` string the web prints verbatim). Gated on
  // reports.view ALONE, deliberately not the balances endpoints'
  // any-of gate: balances are a customer-desk working view (collections
  // staff need them), while profitability exposes company margin —
  // reports.view is the permission that exists for exactly this, and
  // its holders (owners + Delivery Admin) are the report's audience.
  // Figures are branch-scoped in the service (P5-3 patterns).
  @Get("reports/profitability")
  @RequirePermissions("reports.view")
  profitability(
    @Req() request: { user?: { branchAccess?: string } },
    @Query() query: { from?: string; to?: string; groupBy?: string }
  ) {
    return this.logistics.getProfitabilityReport(query, request.user);
  }

  @Get("expenses")
  @RequirePermissions("expenses.create")
  expenses(
    @Req() request: { user?: { branchAccess?: string } },
    @Query() query: Parameters<LogisticsService["listExpenses"]>[0]
  ) {
    return this.logistics.listExpenses(query, request.user);
  }

  @Post("expenses")
  @RequirePermissions("expenses.create")
  createExpense(@Body() body: Parameters<LogisticsService["createExpense"]>[0], @Headers("idempotency-key") idempotencyKey?: string) {
    return this.logistics.createExpense({ ...body, idempotencyKey: body.idempotencyKey ?? idempotencyKey });
  }

  @Post("expenses/:id/approve")
  @RequirePermissions("expenses.approve")
  approveExpense(@Param("id") id: string) {
    return this.logistics.approveExpense(id);
  }
}
