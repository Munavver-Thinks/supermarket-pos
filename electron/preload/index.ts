import { contextBridge, ipcRenderer } from "electron";

import { IPC_CHANNELS, type PosApi } from "../shared/ipc.js";

const api: PosApi = {
  auth: {
    login: (username, password) => ipcRenderer.invoke(IPC_CHANNELS.authLogin, username, password),
  },
  session: {
    getContext: () => ipcRenderer.invoke(IPC_CHANNELS.sessionGetContext),
  },
  products: {
    search: (storeId, query) => ipcRenderer.invoke(IPC_CHANNELS.productsSearch, storeId, query),
    listAll: (storeId, limit) => ipcRenderer.invoke(IPC_CHANNELS.productsListAll, storeId, limit),
    create: (input) => ipcRenderer.invoke(IPC_CHANNELS.productsCreate, input),
    listAdmin: (req) => ipcRenderer.invoke(IPC_CHANNELS.productsListAdmin, req),
    get: (productId, actingUserId) => ipcRenderer.invoke(IPC_CHANNELS.productsGet, productId, actingUserId),
    update: (req) => ipcRenderer.invoke(IPC_CHANNELS.productsUpdate, req),
    changePrices: (req) => ipcRenderer.invoke(IPC_CHANNELS.productsChangePrices, req),
    setActive: (req) => ipcRenderer.invoke(IPC_CHANNELS.productsSetActive, req),
    createChild: (storeId, actingUserId, input) =>
      ipcRenderer.invoke(IPC_CHANNELS.productsCreateChild, storeId, actingUserId, input),
    listChildren: (storeId, actingUserId, parentProductId) =>
      ipcRenderer.invoke(IPC_CHANNELS.productsListChildren, storeId, actingUserId, parentProductId),
    relinkChildPrice: (productId, actingUserId) =>
      ipcRenderer.invoke(IPC_CHANNELS.productsRelinkChildPrice, productId, actingUserId),
  },
  catalog: {
    seedDemo: (storeId, userId) => ipcRenderer.invoke(IPC_CHANNELS.catalogSeedDemo, storeId, userId),
  },
  suppliers: {
    list: (storeId, includeInactive) => ipcRenderer.invoke(IPC_CHANNELS.suppliersList, storeId, includeInactive),
    create: (storeId, supplier, actingUserId) =>
      ipcRenderer.invoke(IPC_CHANNELS.suppliersCreate, storeId, supplier, actingUserId),
    update: (supplierId, supplier, actingUserId) =>
      ipcRenderer.invoke(IPC_CHANNELS.suppliersUpdate, supplierId, supplier, actingUserId),
    setActive: (supplierId, isActive, actingUserId) =>
      ipcRenderer.invoke(IPC_CHANNELS.suppliersSetActive, supplierId, isActive, actingUserId),
    listProducts: (supplierId) => ipcRenderer.invoke(IPC_CHANNELS.suppliersListProducts, supplierId),
  },
  purchases: {
    create: (input) => ipcRenderer.invoke(IPC_CHANNELS.purchasesCreate, input),
    listRecent: (storeId, limit) => ipcRenderer.invoke(IPC_CHANNELS.purchasesListRecent, storeId, limit),
    get: (purchaseId) => ipcRenderer.invoke(IPC_CHANNELS.purchasesGet, purchaseId),
    getPriceSnapshots: (storeId, productIds, actingUserId) =>
      ipcRenderer.invoke(IPC_CHANNELS.purchasesGetPriceSnapshots, storeId, productIds, actingUserId),
  },
  billing: {
    createSale: (cart, payments, approver, exchange) =>
      ipcRenderer.invoke(IPC_CHANNELS.billingCreateSale, cart, payments, approver ?? null, exchange ?? null),
    saveDraft: (input) => ipcRenderer.invoke(IPC_CHANNELS.billingSaveDraft, input),
    deleteDraft: (clientTxnId) => ipcRenderer.invoke(IPC_CHANNELS.billingDeleteDraft, clientTxnId),
    listDrafts: (deviceId) => ipcRenderer.invoke(IPC_CHANNELS.billingListDrafts, deviceId),
    getCustomer: (customerId) => ipcRenderer.invoke(IPC_CHANNELS.billingGetCustomer, customerId),
    getMrpCaps: (storeId, lines) => ipcRenderer.invoke(IPC_CHANNELS.billingGetMrpCaps, storeId, lines),
  },
  inventory: {
    adjustStock: (input) => ipcRenderer.invoke(IPC_CHANNELS.inventoryAdjustStock, input),
    getLowStock: (storeId) => ipcRenderer.invoke(IPC_CHANNELS.inventoryGetLowStock, storeId),
    getStockLevels: (storeId, productIds) =>
      ipcRenderer.invoke(IPC_CHANNELS.inventoryGetStockLevels, storeId, productIds),
    repack: (req, actingUserId) => ipcRenderer.invoke(IPC_CHANNELS.inventoryRepack, req, actingUserId),
    repackHistory: (storeId, actingUserId, productId) =>
      ipcRenderer.invoke(IPC_CHANNELS.inventoryRepackHistory, storeId, actingUserId, productId),
  },
  labels: {
    getDefaults: (storeId, actingUserId, productId, repackId) =>
      ipcRenderer.invoke(IPC_CHANNELS.labelsGetDefaults, storeId, actingUserId, productId, repackId),
    print: (req, actingUserId) => ipcRenderer.invoke(IPC_CHANNELS.labelsPrint, req, actingUserId),
    getSettings: () => ipcRenderer.invoke(IPC_CHANNELS.labelsGetSettings),
    setSettings: (settings, actingUserId) => ipcRenderer.invoke(IPC_CHANNELS.labelsSetSettings, settings, actingUserId),
  },
  storeSettings: {
    getNegativeStockPolicy: () => ipcRenderer.invoke(IPC_CHANNELS.storeSettingsGetNegativeStockPolicy),
    setNegativeStockPolicy: (policy, actingUserId) =>
      ipcRenderer.invoke(IPC_CHANNELS.storeSettingsSetNegativeStockPolicy, policy, actingUserId),
    getReceiptLanguage: () => ipcRenderer.invoke(IPC_CHANNELS.storeSettingsGetReceiptLanguage),
    setReceiptLanguage: (language, actingUserId) =>
      ipcRenderer.invoke(IPC_CHANNELS.storeSettingsSetReceiptLanguage, language, actingUserId),
    getBlockExpiredSale: () => ipcRenderer.invoke(IPC_CHANNELS.storeSettingsGetBlockExpiredSale),
    setBlockExpiredSale: (enabled, actingUserId) =>
      ipcRenderer.invoke(IPC_CHANNELS.storeSettingsSetBlockExpiredSale, enabled, actingUserId),
  },
  customers: {
    search: (storeId, query) => ipcRenderer.invoke(IPC_CHANNELS.customersSearch, storeId, query),
    create: (storeId, customer, actingUserId) =>
      ipcRenderer.invoke(IPC_CHANNELS.customersCreate, storeId, customer, actingUserId),
    update: (customerId, customer, actingUserId) =>
      ipcRenderer.invoke(IPC_CHANNELS.customersUpdate, customerId, customer, actingUserId),
    listRecent: (storeId, limit) => ipcRenderer.invoke(IPC_CHANNELS.customersListRecent, storeId, limit),
  },
  credit: {
    getBalance: (customerId) => ipcRenderer.invoke(IPC_CHANNELS.creditGetBalance, customerId),
    listEntries: (customerId, limit) => ipcRenderer.invoke(IPC_CHANNELS.creditListEntries, customerId, limit),
    listOutstanding: (storeId) => ipcRenderer.invoke(IPC_CHANNELS.creditListOutstanding, storeId),
    recordRepayment: (input) => ipcRenderer.invoke(IPC_CHANNELS.creditRecordRepayment, input),
    setLimit: (customerId, creditLimitPaise, actingUserId) =>
      ipcRenderer.invoke(IPC_CHANNELS.creditSetLimit, customerId, creditLimitPaise, actingUserId),
  },
  dashboard: {
    getSummary: (storeId, actingUserId) => ipcRenderer.invoke(IPC_CHANNELS.dashboardGetSummary, storeId, actingUserId),
  },
  sales: {
    listRecent: (storeId, limit) => ipcRenderer.invoke(IPC_CHANNELS.salesListRecent, storeId, limit),
  },
  returns: {
    lookup: (storeId, billNo) => ipcRenderer.invoke(IPC_CHANNELS.returnsLookup, storeId, billNo),
    create: (input) => ipcRenderer.invoke(IPC_CHANNELS.returnsCreate, input),
    listRecent: (storeId, limit) => ipcRenderer.invoke(IPC_CHANNELS.returnsListRecent, storeId, limit),
  },
  reports: {
    sales: (req) => ipcRenderer.invoke(IPC_CHANNELS.reportsSales, req),
    gst: (req) => ipcRenderer.invoke(IPC_CHANNELS.reportsGst, req),
    hsn: (req) => ipcRenderer.invoke(IPC_CHANNELS.reportsHsn, req),
    topProducts: (req, limit) => ipcRenderer.invoke(IPC_CHANNELS.reportsTopProducts, req, limit),
    stockValuation: (storeId, actingUserId) =>
      ipcRenderer.invoke(IPC_CHANNELS.reportsStockValuation, storeId, actingUserId),
    exportCsv: (suggestedName, content) =>
      ipcRenderer.invoke(IPC_CHANNELS.reportsExportCsv, suggestedName, content),
    profit: (req) => ipcRenderer.invoke(IPC_CHANNELS.reportsProfit, req),
    slowMoving: (req, opts) => ipcRenderer.invoke(IPC_CHANNELS.reportsSlowMoving, req, opts),
    deadStock: (req, opts) => ipcRenderer.invoke(IPC_CHANNELS.reportsDeadStock, req, opts),
    margins: (storeId, actingUserId) => ipcRenderer.invoke(IPC_CHANNELS.reportsMargins, storeId, actingUserId),
    expiry: (storeId, actingUserId, withinDays) =>
      ipcRenderer.invoke(IPC_CHANNELS.reportsExpiry, storeId, actingUserId, withinDays),
  },
  users: {
    listByStore: (storeId) => ipcRenderer.invoke(IPC_CHANNELS.usersListByStore, storeId),
    create: (input) => ipcRenderer.invoke(IPC_CHANNELS.usersCreate, input),
    update: (input) => ipcRenderer.invoke(IPC_CHANNELS.usersUpdate, input),
    setActive: (input) => ipcRenderer.invoke(IPC_CHANNELS.usersSetActive, input),
    resetPassword: (input) => ipcRenderer.invoke(IPC_CHANNELS.usersResetPassword, input),
    changeOwnPassword: (input) => ipcRenderer.invoke(IPC_CHANNELS.usersChangeOwnPassword, input),
  },
  cashSession: {
    open: (input) => ipcRenderer.invoke(IPC_CHANNELS.cashSessionOpen, input),
    getOpen: (counterId) => ipcRenderer.invoke(IPC_CHANNELS.cashSessionGetOpen, counterId),
    summary: (counterId) => ipcRenderer.invoke(IPC_CHANNELS.cashSessionSummary, counterId),
    close: (input) => ipcRenderer.invoke(IPC_CHANNELS.cashSessionClose, input),
  },
  printer: {
    printReceipt: (saleId, actingUserId) => ipcRenderer.invoke(IPC_CHANNELS.printerPrintReceipt, saleId, actingUserId),
    listPrinters: () => ipcRenderer.invoke(IPC_CHANNELS.printerListPrinters),
    printInvoiceA4: (saleId, actingUserId) =>
      ipcRenderer.invoke(IPC_CHANNELS.printerPrintInvoiceA4, saleId, actingUserId),
    saveInvoicePdf: (saleId, actingUserId) =>
      ipcRenderer.invoke(IPC_CHANNELS.printerSaveInvoicePdf, saleId, actingUserId),
  },
  audit: {
    list: (actingUserId, options) => ipcRenderer.invoke(IPC_CHANNELS.auditList, actingUserId, options),
  },
  backup: {
    run: () => ipcRenderer.invoke(IPC_CHANNELS.backupRun),
    list: () => ipcRenderer.invoke(IPC_CHANNELS.backupList),
    restore: (name, actingUserId) => ipcRenderer.invoke(IPC_CHANNELS.backupRestore, name, actingUserId),
  },
  batches: {
    listExpiring: (storeId, withinDays) => ipcRenderer.invoke(IPC_CHANNELS.batchesListExpiring, storeId, withinDays),
    listForProduct: (productId) => ipcRenderer.invoke(IPC_CHANNELS.batchesListForProduct, productId),
    writeOff: (req) => ipcRenderer.invoke(IPC_CHANNELS.batchesWriteOff, req),
  },
  purchaseOrders: {
    list: (req) => ipcRenderer.invoke(IPC_CHANNELS.purchaseOrdersList, req),
    get: (poId, actingUserId) => ipcRenderer.invoke(IPC_CHANNELS.purchaseOrdersGet, poId, actingUserId),
    create: (input) => ipcRenderer.invoke(IPC_CHANNELS.purchaseOrdersCreate, input),
    update: (input) => ipcRenderer.invoke(IPC_CHANNELS.purchaseOrdersUpdate, input),
    place: (poId, actingUserId) => ipcRenderer.invoke(IPC_CHANNELS.purchaseOrdersPlace, poId, actingUserId),
    cancel: (poId, actingUserId, reason) =>
      ipcRenderer.invoke(IPC_CHANNELS.purchaseOrdersCancel, poId, actingUserId, reason),
    receive: (input) => ipcRenderer.invoke(IPC_CHANNELS.purchaseOrdersReceive, input),
  },
  alerts: {
    list: (storeId) => ipcRenderer.invoke(IPC_CHANNELS.alertsList, storeId),
  },
  activation: {
    getStatus: () => ipcRenderer.invoke(IPC_CHANNELS.activationGetStatus),
    activate: (key) => ipcRenderer.invoke(IPC_CHANNELS.activationActivate, key),
  },
  ui: {
    getLanguage: () => ipcRenderer.invoke(IPC_CHANNELS.uiGetLanguage),
    setLanguage: (language, actingUserId) => ipcRenderer.invoke(IPC_CHANNELS.uiSetLanguage, language, actingUserId),
    getTheme: (userId) => ipcRenderer.invoke(IPC_CHANNELS.uiGetTheme, userId),
    setTheme: (theme, actingUserId) => ipcRenderer.invoke(IPC_CHANNELS.uiSetTheme, theme, actingUserId),
  },
  errors: {
    report: (report) => ipcRenderer.invoke(IPC_CHANNELS.errorsReportRenderer, report),
    takeLastCrash: () => ipcRenderer.invoke(IPC_CHANNELS.errorsTakeLastCrash),
    onMainError: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, errorId: unknown) => {
        if (typeof errorId === "string") callback(errorId);
      };
      ipcRenderer.on(IPC_CHANNELS.appErrorReported, listener);
      return () => {
        ipcRenderer.removeListener(IPC_CHANNELS.appErrorReported, listener);
      };
    },
  },
  // The main process passes this flag only to development windows, and registers the
  // handler only there too.
  ...(process.argv.includes("--pos-dev-tools")
    ? { debug: { crashRenderer: () => ipcRenderer.invoke(IPC_CHANNELS.debugCrashRenderer) } }
    : {}),
};

contextBridge.exposeInMainWorld("api", api);
