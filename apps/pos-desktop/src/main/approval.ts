import bcrypt from "bcryptjs";
import { canApprove, canRequestApproval, type ApprovalAction } from "@pos/business-logic";
import { auditLogRepo, usersRepo, type Db } from "@pos/database";
import type { ApproverCredentials } from "@pos/types";

import { credentialThrottle, throttleKey, TOO_MANY_ATTEMPTS_MESSAGE } from "./attemptThrottle.js";
import { DUMMY_PASSWORD_HASH } from "./auth.js";

/**
 * Manager approval at the counter. A cashier's request that needs sign-off is sent again
 * with a manager's username and password typed into the approval dialog; this checks them
 * here, in the main process, for that one request. Nothing is cached: there are no approval
 * tokens, and the password is never stored, logged, audited or put in a message.
 */

export type ApprovalOutcome =
  | { ok: true; approvedByUserId: string; selfApproved: boolean }
  | { ok: false; error: string; approvalRequired: boolean };

export const APPROVAL_REQUIRED_MESSAGE = "A manager or owner must approve this.";
export const APPROVAL_REFUSED_MESSAGE = "Those manager details were not accepted.";

const ROLE_REFUSED_MESSAGE: Record<ApprovalAction, string> = {
  sale_return: "Your role can't process returns.",
  below_cost_discount: "Your role can't give discounts below cost.",
  stock_adjustment: "Your role can't adjust stock.",
};

export async function resolveApproval(
  db: Db,
  args: {
    storeId: string;
    actingUserId: string;
    action: ApprovalAction;
    approver?: ApproverCredentials | null;
    /** Recorded on the `approval_refused` audit row. Optional. */
    deviceId?: string | null;
  },
): Promise<ApprovalOutcome> {
  // 1. The actor comes from the database, never from what the screen claims.
  const actor = await usersRepo.getById(db, args.actingUserId);
  if (!actor || !actor.isActive || actor.storeId !== args.storeId) {
    return { ok: false, approvalRequired: false, error: "You are not signed in to this store." };
  }

  // 2. Some roles can't start the action at all, approval or not.
  if (!canRequestApproval(actor.role, args.action)) {
    return { ok: false, approvalRequired: false, error: ROLE_REFUSED_MESSAGE[args.action] };
  }

  // 3. A manager or owner approves their own action without a prompt.
  if (canApprove(actor.role, args.action)) {
    return { ok: true, approvedByUserId: actor.id, selfApproved: true };
  }

  // 4. First attempt: ask the counter for a manager. Not audited — nothing was tried yet.
  if (!args.approver) {
    return { ok: false, approvalRequired: true, error: APPROVAL_REQUIRED_MESSAGE };
  }

  const approverUsername = args.approver.username;
  const key = throttleKey(args.storeId, approverUsername);

  // 6 (checked first). During a lockout even the right password is refused.
  if (!credentialThrottle.check(key).allowed) {
    await auditRefusal(db, args, actor.id, approverUsername, true);
    return { ok: false, approvalRequired: true, error: TOO_MANY_ATTEMPTS_MESSAGE };
  }

  // 5. Check the approver. An unknown username is still compared (against a dummy hash) so
  // the timing doesn't reveal which usernames exist, and every failure gets the same message,
  // so the dialog can't be used to learn whether a username exists, has the right role, or
  // is simply mistyped.
  const row = await usersRepo.findUserByUsername(db, args.storeId, approverUsername);
  const passwordMatches = await bcrypt.compare(args.approver.password, row?.passwordHash ?? DUMMY_PASSWORD_HASH);
  const accepted =
    row !== undefined && passwordMatches && row.id !== actor.id && canApprove(row.role, args.action);

  if (!row || !accepted) {
    credentialThrottle.recordFailure(key);
    await auditRefusal(db, args, actor.id, approverUsername, false);
    return { ok: false, approvalRequired: true, error: APPROVAL_REFUSED_MESSAGE };
  }

  credentialThrottle.recordSuccess(key);
  return { ok: true, approvedByUserId: row.id, selfApproved: false };
}

/**
 * A refused approval is worth a trail — repeated refusals at one counter are exactly what an
 * owner wants to see. Written in its own small transaction because the request it belonged
 * to writes nothing. The password is never part of it.
 */
async function auditRefusal(
  db: Db,
  args: { storeId: string; action: ApprovalAction; deviceId?: string | null },
  actorId: string,
  approverUsername: string,
  lockedOut: boolean,
): Promise<void> {
  await db.transaction().execute(async (trx) => {
    await auditLogRepo.appendAuditLog(trx, {
      storeId: args.storeId,
      userId: actorId,
      deviceId: args.deviceId ?? null,
      action: "approval_refused",
      tableName: "users",
      recordId: actorId,
      oldValue: null,
      newValue: { action: args.action, approverUsername, lockedOut },
      reason: null,
    });
  });
}
