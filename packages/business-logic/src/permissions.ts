import type { UserRole } from "@pos/types";

/**
 * Who may create staff logins, and which roles they may hand out.
 *
 * Kept here so the main process (which enforces it) and the renderer (which hides what
 * you can't do) read from the same rule — a UI that offers an option the server rejects
 * is a bug waiting to happen, and a server that trusts the UI isn't access control.
 */

const STAFF_MANAGER_ROLES: UserRole[] = ["owner", "manager"];

/** An owner can hand out any role; a manager only junior ones, so they can't mint themselves a peer or a boss. */
const ASSIGNABLE_BY_ROLE: Record<UserRole, UserRole[]> = {
  owner: ["owner", "manager", "cashier", "inventory_staff"],
  manager: ["cashier", "inventory_staff"],
  cashier: [],
  inventory_staff: [],
};

export function canManageStaff(role: UserRole): boolean {
  return STAFF_MANAGER_ROLES.includes(role);
}

export function assignableRoles(actorRole: UserRole): UserRole[] {
  return ASSIGNABLE_BY_ROLE[actorRole];
}

export function canAssignRole(actorRole: UserRole, targetRole: UserRole): boolean {
  return assignableRoles(actorRole).includes(targetRole);
}

/**
 * Who may read the shop's reports. These carry cost prices, margins and the full day's
 * takings — figures a cashier has no reason to see, so this is enforced in the main process
 * rather than left to the nav bar hiding the screen.
 */
const REPORT_VIEWER_ROLES: UserRole[] = ["owner", "manager"];

export function canViewReports(role: UserRole): boolean {
  return REPORT_VIEWER_ROLES.includes(role);
}

/**
 * Who may change store-wide behaviour, such as whether a sale may take stock below zero.
 * A cashier who could switch blocking off would be setting the rule meant to check them.
 */
const STORE_SETTINGS_ROLES: UserRole[] = ["owner", "manager"];

export function canChangeStoreSettings(role: UserRole): boolean {
  return STORE_SETTINGS_ROLES.includes(role);
}

/**
 * Who may read the activity log. It records every discount, refund, drawer count and stock
 * correction by name — the log exists to check counter staff, so they don't get to read it.
 */
const AUDIT_VIEWER_ROLES: UserRole[] = ["owner", "manager"];

export function canViewAuditLog(role: UserRole): boolean {
  return AUDIT_VIEWER_ROLES.includes(role);
}

/**
 * Who may add, edit, deactivate or reactivate suppliers. Matches the roles the Suppliers
 * screen is offered to: inventory staff receive stock from these suppliers and keep their
 * details current. Cashiers have no reason to change who the shop buys from.
 */
const SUPPLIER_MANAGER_ROLES: UserRole[] = ["owner", "manager", "inventory_staff"];

export function canManageSuppliers(role: UserRole): boolean {
  return SUPPLIER_MANAGER_ROLES.includes(role);
}

// ---- DEV1: manager approval and staff management ----

/** Actions a counter user may start but that a manager or owner must sign off. */
export type ApprovalAction = "sale_return" | "below_cost_discount" | "stock_adjustment";

const APPROVER_ROLES: UserRole[] = ["owner", "manager"];

const REQUESTER_ROLES: Record<ApprovalAction, UserRole[]> = {
  sale_return: ["owner", "manager", "cashier", "inventory_staff"],
  below_cost_discount: ["owner", "manager", "cashier", "inventory_staff"],
  // Stock counts are inventory work; a cashier has no reason to correct them at all.
  stock_adjustment: ["owner", "manager", "inventory_staff"],
};

/** Owner and manager approve; they also approve their own actions without a prompt. */
export function canApprove(role: UserRole, _action: ApprovalAction): boolean {
  return APPROVER_ROLES.includes(role);
}

/**
 * Who may start the action at all (and then be asked for approval):
 * sale_return, below_cost_discount: every role; stock_adjustment: owner, manager, inventory_staff.
 */
export function canRequestApproval(role: UserRole, action: ApprovalAction): boolean {
  return REQUESTER_ROLES[action].includes(role);
}

/**
 * Whether `actor` may edit, deactivate or reset the password of `target`. An owner manages
 * anyone else; a manager only counter and inventory staff, so a manager can't lock out an
 * owner or a peer. Nobody manages their own account through these channels — changing your
 * own password has its own path that asks for the current one.
 */
export function canManageStaffMember(
  actor: { id: string; role: UserRole },
  target: { id: string; role: UserRole },
): boolean {
  if (actor.id === target.id) return false;
  if (actor.role === "owner") return true;
  if (actor.role === "manager") return target.role === "cashier" || target.role === "inventory_staff";
  return false;
}

// ---- DEV2: products and purchase orders ----

/**
 * Who may add products, edit their details, deactivate them and draft or receive purchase
 * orders — the day-to-day stock work inventory staff are there for.
 */
const STOCK_WORK_ROLES: UserRole[] = ["owner", "manager", "inventory_staff"];

export function canManageProducts(role: UserRole): boolean {
  return STOCK_WORK_ROLES.includes(role);
}

/**
 * Who may change sale price, MRP or cost. A price change moves every bill from then on and
 * the below-cost discount guard with it, so it stays with owners and managers.
 */
const PRICE_CHANGER_ROLES: UserRole[] = ["owner", "manager"];

export function canChangePrices(role: UserRole): boolean {
  return PRICE_CHANGER_ROLES.includes(role);
}

/** Create, edit and receive purchase orders; also record a direct goods receipt. */
export function canManagePurchaseOrders(role: UserRole): boolean {
  return STOCK_WORK_ROLES.includes(role);
}

/** Placing an order commits the shop's money, and cancelling one tells a supplier no — owners and managers. */
const ORDER_PLACER_ROLES: UserRole[] = ["owner", "manager"];

export function canPlacePurchaseOrder(role: UserRole): boolean {
  return ORDER_PLACER_ROLES.includes(role);
}
