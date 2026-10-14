import { describe, expect, it } from "vitest";

import {
  assignableRoles,
  canAssignRole,
  canChangeStoreSettings,
  canManageStaff,
  canManageSuppliers,
  canViewAuditLog,
  canViewReports,
} from "@/core/business-logic/permissions.js";
import { canApprove, canManageStaffMember, canRequestApproval } from "@/core/business-logic/permissions.js";
import { canChangePrices, canManageProducts, canManagePurchaseOrders, canPlacePurchaseOrder } from "@/core/business-logic/permissions.js";

describe("canManageSuppliers", () => {
  it("lets the roles that receive stock keep supplier details", () => {
    expect(canManageSuppliers("owner")).toBe(true);
    expect(canManageSuppliers("manager")).toBe(true);
    expect(canManageSuppliers("inventory_staff")).toBe(true);
  });

  it("keeps cashiers from changing who the shop buys from", () => {
    expect(canManageSuppliers("cashier")).toBe(false);
  });
});

describe("canViewAuditLog", () => {
  it("lets owners and managers read the activity log", () => {
    expect(canViewAuditLog("owner")).toBe(true);
    expect(canViewAuditLog("manager")).toBe(true);
  });

  it("keeps the staff it records from reading it", () => {
    expect(canViewAuditLog("cashier")).toBe(false);
    expect(canViewAuditLog("inventory_staff")).toBe(false);
  });
});

describe("canChangeStoreSettings", () => {
  it("lets owners and managers change store-wide rules", () => {
    expect(canChangeStoreSettings("owner")).toBe(true);
    expect(canChangeStoreSettings("manager")).toBe(true);
  });

  it("keeps counter staff from switching off the checks that apply to them", () => {
    expect(canChangeStoreSettings("cashier")).toBe(false);
    expect(canChangeStoreSettings("inventory_staff")).toBe(false);
  });
});

describe("canViewReports", () => {
  it("lets owners and managers read the shop's figures", () => {
    expect(canViewReports("owner")).toBe(true);
    expect(canViewReports("manager")).toBe(true);
  });

  it("keeps cost prices and margins away from counter staff", () => {
    expect(canViewReports("cashier")).toBe(false);
    expect(canViewReports("inventory_staff")).toBe(false);
  });
});

describe("canManageStaff", () => {
  it("lets owners and managers add staff", () => {
    expect(canManageStaff("owner")).toBe(true);
    expect(canManageStaff("manager")).toBe(true);
  });

  it("keeps cashiers and inventory staff out", () => {
    expect(canManageStaff("cashier")).toBe(false);
    expect(canManageStaff("inventory_staff")).toBe(false);
  });
});

describe("canAssignRole", () => {
  it("lets an owner hand out any role", () => {
    expect(canAssignRole("owner", "owner")).toBe(true);
    expect(canAssignRole("owner", "manager")).toBe(true);
    expect(canAssignRole("owner", "cashier")).toBe(true);
    expect(canAssignRole("owner", "inventory_staff")).toBe(true);
  });

  it("stops a manager escalating — no owner or manager accounts", () => {
    expect(canAssignRole("manager", "owner")).toBe(false);
    expect(canAssignRole("manager", "manager")).toBe(false);
  });

  it("lets a manager add junior staff", () => {
    expect(canAssignRole("manager", "cashier")).toBe(true);
    expect(canAssignRole("manager", "inventory_staff")).toBe(true);
  });

  it("gives junior staff no one to create, including their own role", () => {
    expect(canAssignRole("cashier", "cashier")).toBe(false);
    expect(canAssignRole("inventory_staff", "inventory_staff")).toBe(false);
    expect(assignableRoles("cashier")).toEqual([]);
    expect(assignableRoles("inventory_staff")).toEqual([]);
  });
});

describe("assignableRoles", () => {
  it("only ever offers roles the same actor is allowed to assign", () => {
    for (const actor of ["owner", "manager", "cashier", "inventory_staff"] as const) {
      for (const target of assignableRoles(actor)) {
        expect(canAssignRole(actor, target)).toBe(true);
      }
    }
  });

  it("never offers a role to someone who cannot manage staff at all", () => {
    for (const actor of ["cashier", "inventory_staff"] as const) {
      expect(canManageStaff(actor)).toBe(false);
      expect(assignableRoles(actor)).toHaveLength(0);
    }
  });
});

// ---- DEV1: manager approval and staff management ----

describe("canApprove", () => {
  it("lets owners and managers approve every action", () => {
    for (const action of ["sale_return", "below_cost_discount", "stock_adjustment"] as const) {
      expect(canApprove("owner", action)).toBe(true);
      expect(canApprove("manager", action)).toBe(true);
      expect(canApprove("cashier", action)).toBe(false);
      expect(canApprove("inventory_staff", action)).toBe(false);
    }
  });
});

describe("canRequestApproval", () => {
  it("lets every role start a return or a below-cost discount", () => {
    for (const role of ["owner", "manager", "cashier", "inventory_staff"] as const) {
      expect(canRequestApproval(role, "sale_return")).toBe(true);
      expect(canRequestApproval(role, "below_cost_discount")).toBe(true);
    }
  });

  it("keeps cashiers away from stock adjustments entirely", () => {
    expect(canRequestApproval("inventory_staff", "stock_adjustment")).toBe(true);
    expect(canRequestApproval("manager", "stock_adjustment")).toBe(true);
    expect(canRequestApproval("cashier", "stock_adjustment")).toBe(false);
  });
});

describe("canManageStaffMember", () => {
  const owner = { id: "o", role: "owner" as const };
  const manager = { id: "m", role: "manager" as const };

  it("lets an owner manage anyone but themselves", () => {
    expect(canManageStaffMember(owner, { id: "o2", role: "owner" })).toBe(true);
    expect(canManageStaffMember(owner, { id: "m", role: "manager" })).toBe(true);
    expect(canManageStaffMember(owner, { id: "c", role: "cashier" })).toBe(true);
    expect(canManageStaffMember(owner, owner)).toBe(false);
  });

  it("lets a manager manage only junior staff", () => {
    expect(canManageStaffMember(manager, { id: "c", role: "cashier" })).toBe(true);
    expect(canManageStaffMember(manager, { id: "i", role: "inventory_staff" })).toBe(true);
    expect(canManageStaffMember(manager, { id: "m2", role: "manager" })).toBe(false);
    expect(canManageStaffMember(manager, { id: "o", role: "owner" })).toBe(false);
    expect(canManageStaffMember(manager, manager)).toBe(false);
  });

  it("gives junior staff no one to manage", () => {
    expect(canManageStaffMember({ id: "c", role: "cashier" }, { id: "c2", role: "cashier" })).toBe(false);
    expect(canManageStaffMember({ id: "i", role: "inventory_staff" }, { id: "c", role: "cashier" })).toBe(false);
  });
});

// ---- DEV2: products and purchase orders ----

describe("product and purchase-order permissions", () => {
  it("lets stock roles manage products and orders but not cashiers", () => {
    for (const role of ["owner", "manager", "inventory_staff"] as const) {
      expect(canManageProducts(role)).toBe(true);
      expect(canManagePurchaseOrders(role)).toBe(true);
    }
    expect(canManageProducts("cashier")).toBe(false);
    expect(canManagePurchaseOrders("cashier")).toBe(false);
  });

  it("keeps price changes and placing or cancelling orders with owners and managers", () => {
    for (const role of ["owner", "manager"] as const) {
      expect(canChangePrices(role)).toBe(true);
      expect(canPlacePurchaseOrder(role)).toBe(true);
    }
    for (const role of ["cashier", "inventory_staff"] as const) {
      expect(canChangePrices(role)).toBe(false);
      expect(canPlacePurchaseOrder(role)).toBe(false);
    }
  });
});
