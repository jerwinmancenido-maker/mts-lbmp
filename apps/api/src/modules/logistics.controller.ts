import { Body, Controller, Get, Headers, Inject, Param, Patch, Post, Query, Req } from "@nestjs/common";
import { PublicRoute, RequirePermissions } from "./auth.guard.js";
import { LogisticsService } from "./logistics.service.js";

@Controller()
export class LogisticsController {
  constructor(@Inject(LogisticsService) private readonly logistics: LogisticsService) {}

  @Get("health")
  @PublicRoute()
  health() {
    return { ok: true, service: "MTS LBMP API" };
  }

  @Get("bootstrap")
  @PublicRoute()
  bootstrap() {
    return this.logistics.getBootstrap();
  }

  @Post("auth/login")
  @PublicRoute()
  login(@Body() body: { email: string; password: string }) {
    return this.logistics.login(body);
  }

  @Post("auth/staff-code")
  @PublicRoute()
  staffCodeLogin(@Body() body: { staffCode: string }) {
    return this.logistics.loginWithStaffCode(body);
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

  @Patch("settings/users/:id/branch-access")
  @RequirePermissions("settings.manage")
  updateUserBranchAccess(@Param("id") id: string, @Body() body: Parameters<LogisticsService["updateUserBranchAccess"]>[1]) {
    return this.logistics.updateUserBranchAccess(id, body);
  }

  @Post("settings/users")
  @RequirePermissions("settings.manage")
  createStaffUser(@Body() body: Parameters<LogisticsService["createStaffUser"]>[0]) {
    return this.logistics.createStaffUser(body);
  }

  @Patch("settings/users/:id")
  @RequirePermissions("settings.manage")
  updateStaffUser(@Param("id") id: string, @Body() body: Parameters<LogisticsService["updateStaffUser"]>[1]) {
    return this.logistics.updateStaffUser(id, body);
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
  receivingRecords() {
    return this.logistics.listReceivingRecords();
  }

  @Get("receiving/drafts")
  @RequirePermissions("receiving.view")
  receivingDrafts() {
    return this.logistics.listReceivingDrafts();
  }

  @Get("receiving/intake")
  @RequirePermissions("receiving.view")
  receivingIntakeTasks(@Query() query: Parameters<LogisticsService["listReceivingIntakeTasks"]>[0]) {
    return this.logistics.listReceivingIntakeTasks(query);
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

  // Public like /uploads: the unauthenticated intake page and the staff shell
  // both call this when a queued device photo finishes uploading. It only
  // acts on an exact pending local-photo reference match (Phase 4 audit A6).
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
  finalizeCustomer(@Param("id") id: string, @Body() body: { businessName?: string; contactPerson?: string; phone?: string; billingTerm?: string }) {
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

  @Post("customers/:id/billing-reminder")
  @RequirePermissions("customers.manage")
  createCustomerBillingReminder(@Param("id") id: string, @Body() body: Parameters<LogisticsService["createCustomerBillingReminder"]>[1]) {
    return this.logistics.createCustomerBillingReminder(id, body);
  }

  @Post("receiving")
  @RequirePermissions("receiving.create")
  createReceiving(@Body() body: Parameters<LogisticsService["createReceiving"]>[0]) {
    return this.logistics.createReceiving(body);
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
  receivingRecordAudit(@Param("id") id: string) {
    return this.logistics.listReceivingRecordAudit(id);
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
  finalizeReceivingDraft(@Param("id") id: string, @Body() body: Parameters<LogisticsService["finalizeReceivingDraft"]>[1]) {
    return this.logistics.finalizeReceivingDraft(id, body);
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

  @Get("packages")
  packages(@Query() query: Parameters<LogisticsService["listPackages"]>[0]) {
    return this.logistics.listPackages(query);
  }

  @Post("uploads")
  @PublicRoute()
  uploadFile(@Body() body: { dataUrl: string; fileName: string; type: string; entityId?: string }) {
    return this.logistics.uploadFile(body);
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
  packageMessages(@Param("id") id: string) {
    return this.logistics.listMessages(id);
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
  receivingSlip(@Param("id") id: string) {
    return this.logistics.renderReceivingSlip(id);
  }

  @Get("receiving/:id/receiving-document")
  @RequirePermissions("documents.print")
  receivingDocument(@Param("id") id: string) {
    return this.logistics.renderReceivingDocument(id);
  }

  @Get("packages/:id/qr-label")
  @RequirePermissions("documents.print")
  qrLabel(@Param("id") id: string) {
    return this.logistics.renderQrLabel(id);
  }

  @Get("packages/:id/delivery-receipt")
  @RequirePermissions("documents.print")
  deliveryReceipt(@Param("id") id: string) {
    return this.logistics.renderDeliveryReceipt(id);
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
  trips(@Query() query: Parameters<LogisticsService["listTrips"]>[0]) {
    return this.logistics.listTrips(query);
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
  loadCargo(@Param("id") id: string, @Body() body: { cargoPackageId: string; overrideReason?: string }) {
    return this.logistics.loadCargo(id, body);
  }

  @Post("trips/:id/unload")
  @RequirePermissions("loading.scan")
  unloadCargo(@Param("id") id: string, @Body() body: { cargoPackageId: string; reason?: string }) {
    return this.logistics.unloadCargo(id, body);
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
  loadingManifest(@Param("id") id: string) {
    return this.logistics.renderTripManifest(id);
  }

  @Get("deliveries")
  @RequirePermissions("delivery.complete")
  deliveries() {
    return this.logistics.listDeliveries();
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
  returnRecords() {
    return this.logistics.listReturnRecords();
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
  payments(@Query() query: Parameters<LogisticsService["listPayments"]>[0]) {
    return this.logistics.listPayments(query);
  }

  @Post("payments")
  @RequirePermissions("payments.record")
  recordPayment(@Body() body: Parameters<LogisticsService["recordPayment"]>[0], @Headers("idempotency-key") idempotencyKey?: string) {
    return this.logistics.recordPayment({ ...body, idempotencyKey: body.idempotencyKey ?? idempotencyKey });
  }

  @Get("billing/invoices")
  @RequirePermissions("customers.manage")
  billingInvoices() {
    return this.logistics.listBillingInvoices();
  }

  @Post("billing/invoices")
  @RequirePermissions("customers.manage")
  createBillingInvoice(@Body() body: Parameters<LogisticsService["createBillingInvoice"]>[0]) {
    return this.logistics.createBillingInvoice(body);
  }

  @Get("expenses")
  @RequirePermissions("expenses.create")
  expenses(@Query() query: Parameters<LogisticsService["listExpenses"]>[0]) {
    return this.logistics.listExpenses(query);
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
