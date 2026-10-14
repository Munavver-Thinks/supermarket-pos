import { randomUUID } from "node:crypto";

import bcrypt from "bcryptjs";
import { canAssignRole, canManageStaff, canManageStaffMember } from "@pos/business-logic";
import { auditLogRepo, usersRepo, type Db } from "@pos/database";
import type { User, UserRole } from "@pos/types";

import { credentialThrottle, throttleKey, TOO_MANY_ATTEMPTS_MESSAGE } from "./attemptThrottle.js";

/** The login a fresh install is seeded with. The app nags until it is changed. */
export const DEFAULT_OWNER_USERNAME = "admin";
export const DEFAULT_OWNER_PASSWORD = "admin123";

/**
 * Compared against when a username doesn't exist, so an unknown name takes as long to refuse
 * as a wrong password. The hash of a random string nobody knows.
 */
export const DUMMY_PASSWORD_HASH = "$2a$10$/MAModVeObFBv0dAqp6vy.exumTrqPzvJRSjolOJlx.bl39JXLJJy";

const BCRYPT_COST = 10;

export interface LoginResult {
  ok: boolean;
  user?: User;
  error?: string;
  /** Signed in with the seeded admin / admin123 — the app shows a warning until it's changed. */
  usingDefaultPassword?: boolean;
}

export interface CreateEmployeeResult {
  ok: boolean;
  user?: User;
  error?: string;
}

export interface StaffChangeResult {
  ok: boolean;
  user?: User;
  error?: string;
}

/** The second half of the password rule (the first — at least 6 characters — is in validation). */
export function passwordProblem(password: string, username: string): string | null {
  if (password.length < 6) return "Password must be at least 6 characters.";
  if (password.trim().toLowerCase() === username.trim().toLowerCase()) {
    return "The password can't be the same as the username.";
  }
  return null;
}

/**
 * Creates a staff login. The acting user's role is read back from the database rather than
 * trusted from the caller: hiding the form in the renderer is presentation, not access
 * control, and this channel can be invoked directly.
 */
export async function createEmployee(
  db: Db,
  input: {
    storeId: string;
    actingUserId: string;
    username: string;
    password: string;
    displayName: string;
    role: UserRole;
    deviceId?: string | null | undefined;
  },
): Promise<CreateEmployeeResult> {
  const actor = await usersRepo.getById(db, input.actingUserId);

  if (!actor || !actor.isActive || actor.storeId !== input.storeId) {
    return { ok: false, error: "Your session is no longer valid — sign in again." };
  }
  if (!canManageStaff(actor.role)) {
    return { ok: false, error: "Only an owner or manager can add employees." };
  }
  if (!canAssignRole(actor.role, input.role)) {
    return { ok: false, error: "Only an owner can create owner or manager accounts." };
  }
  const problem = passwordProblem(input.password, input.username);
  if (problem) return { ok: false, error: problem };
  if (await usersRepo.usernameTaken(db, input.storeId, input.username)) {
    return { ok: false, error: `The username "${input.username}" is already taken.` };
  }

  const id = randomUUID();
  // Hashed before the transaction opens, so the write lock isn't held while bcrypt works.
  const passwordHash = await bcrypt.hash(input.password, BCRYPT_COST);

  // A new login is a grant of access, so it and its audit entry commit together. The
  // password — hashed or not — is never written to the log.
  await db.transaction().execute(async (trx) => {
    await usersRepo.createUser(trx, {
      id,
      storeId: input.storeId,
      username: input.username,
      passwordHash,
      displayName: input.displayName,
      role: input.role,
    });
    await auditLogRepo.appendAuditLog(trx, {
      storeId: input.storeId,
      userId: actor.id,
      deviceId: input.deviceId ?? null,
      action: "employee_created",
      tableName: "users",
      recordId: id,
      oldValue: null,
      newValue: { username: input.username, displayName: input.displayName, role: input.role },
      reason: null,
    });
  });

  const created = await usersRepo.getById(db, id);
  return created ? { ok: true, user: created } : { ok: false, error: "The employee could not be created." };
}

/**
 * Loads the actor and the employee they want to change, and checks the actor may manage
 * that employee at all. Returns both, or the message to show.
 */
async function staffPair(
  db: Db,
  storeId: string,
  actingUserId: string,
  targetUserId: string,
): Promise<{ actor: User; target: User } | { error: string }> {
  const actor = await usersRepo.getById(db, actingUserId);
  if (!actor || !actor.isActive || actor.storeId !== storeId) {
    return { error: "Your session is no longer valid — sign in again." };
  }
  if (!canManageStaff(actor.role)) {
    return { error: "Only an owner or manager can change employees." };
  }
  const target = await usersRepo.getById(db, targetUserId);
  if (!target || target.storeId !== storeId) {
    return { error: "That employee could not be found." };
  }
  if (actor.id === target.id) {
    return { error: "You can't change your own account here. Use Settings to change your password." };
  }
  if (!canManageStaffMember(actor, target)) {
    return { error: "A manager can only change cashier and inventory staff accounts." };
  }
  return { actor, target };
}

/** Renames an employee or changes their role. */
export async function updateEmployee(
  db: Db,
  input: {
    storeId: string;
    actingUserId: string;
    userId: string;
    displayName: string;
    role: UserRole;
    deviceId?: string | null | undefined;
  },
): Promise<StaffChangeResult> {
  const pair = await staffPair(db, input.storeId, input.actingUserId, input.userId);
  if ("error" in pair) return { ok: false, error: pair.error };
  const { actor, target } = pair;

  const roleChanged = input.role !== target.role;
  const nameChanged = input.displayName !== target.displayName;
  if (!roleChanged && !nameChanged) return { ok: true, user: target };

  if (roleChanged && !canAssignRole(actor.role, input.role)) {
    return { ok: false, error: "Only an owner can give someone the owner or manager role." };
  }

  const result = await db.transaction().execute(async (trx) => {
    // Counted inside the transaction, so two owners demoting each other can't both succeed.
    if (roleChanged && target.role === "owner" && target.isActive) {
      if ((await usersRepo.countActiveOwners(trx, input.storeId)) <= 1) {
        return "The shop's last owner can't be given another role. Make someone else an owner first.";
      }
    }
    await usersRepo.updateUser(trx, target.id, { displayName: input.displayName, role: input.role });
    await auditLogRepo.appendAuditLog(trx, {
      storeId: input.storeId,
      userId: actor.id,
      deviceId: input.deviceId ?? null,
      action: "employee_updated",
      tableName: "users",
      recordId: target.id,
      oldValue: { displayName: target.displayName, role: target.role },
      newValue: { displayName: input.displayName, role: input.role },
      reason: null,
    });
    return null;
  });
  if (result) return { ok: false, error: result };

  const updated = await usersRepo.getById(db, target.id);
  return updated ? { ok: true, user: updated } : { ok: false, error: "That employee could not be found." };
}

/**
 * Deactivates or reactivates a login. The row stays — bills and log entries point at it —
 * but a deactivated user can't sign in or approve anything.
 */
export async function setEmployeeActive(
  db: Db,
  input: {
    storeId: string;
    actingUserId: string;
    userId: string;
    isActive: boolean;
    deviceId?: string | null | undefined;
  },
): Promise<StaffChangeResult> {
  const pair = await staffPair(db, input.storeId, input.actingUserId, input.userId);
  if ("error" in pair) return { ok: false, error: pair.error };
  const { actor, target } = pair;
  if (target.isActive === input.isActive) return { ok: true, user: target };

  const result = await db.transaction().execute(async (trx) => {
    if (!input.isActive && target.role === "owner") {
      if ((await usersRepo.countActiveOwners(trx, input.storeId)) <= 1) {
        return "The shop's last owner can't be deactivated.";
      }
    }
    await usersRepo.setUserActive(trx, target.id, input.isActive);
    await auditLogRepo.appendAuditLog(trx, {
      storeId: input.storeId,
      userId: actor.id,
      deviceId: input.deviceId ?? null,
      action: input.isActive ? "employee_reactivated" : "employee_deactivated",
      tableName: "users",
      recordId: target.id,
      oldValue: { displayName: target.displayName, isActive: target.isActive },
      newValue: { displayName: target.displayName, isActive: input.isActive },
      reason: null,
    });
    return null;
  });
  if (result) return { ok: false, error: result };

  const updated = await usersRepo.getById(db, target.id);
  return updated ? { ok: true, user: updated } : { ok: false, error: "That employee could not be found." };
}

/** Sets a new password for someone who forgot theirs. The actor tells them the new one. */
export async function resetEmployeePassword(
  db: Db,
  input: {
    storeId: string;
    actingUserId: string;
    userId: string;
    newPassword: string;
    deviceId?: string | null | undefined;
  },
): Promise<StaffChangeResult> {
  const pair = await staffPair(db, input.storeId, input.actingUserId, input.userId);
  if ("error" in pair) return { ok: false, error: pair.error };
  const { actor, target } = pair;

  const problem = passwordProblem(input.newPassword, target.username);
  if (problem) return { ok: false, error: problem };

  const passwordHash = await bcrypt.hash(input.newPassword, BCRYPT_COST);
  await db.transaction().execute(async (trx) => {
    await usersRepo.setPasswordHash(trx, target.id, passwordHash);
    // Who reset whose password — never the password or its hash.
    await auditLogRepo.appendAuditLog(trx, {
      storeId: input.storeId,
      userId: actor.id,
      deviceId: input.deviceId ?? null,
      action: "password_reset",
      tableName: "users",
      recordId: target.id,
      oldValue: null,
      newValue: { displayName: target.displayName },
      reason: null,
    });
  });
  // A fresh password gets a fresh set of attempts.
  credentialThrottle.recordSuccess(throttleKey(input.storeId, target.username));
  return { ok: true, user: target };
}

/** Changes the signed-in user's own password. The current one must be given. */
export async function changeOwnPassword(
  db: Db,
  input: {
    storeId: string;
    actingUserId: string;
    currentPassword: string;
    newPassword: string;
    deviceId?: string | null | undefined;
  },
): Promise<{ ok: boolean; error?: string }> {
  const row = await usersRepo.getRowById(db, input.actingUserId);
  if (!row || row.isActive !== 1 || row.storeId !== input.storeId) {
    return { ok: false, error: "Your session is no longer valid — sign in again." };
  }

  // Same throttle as sign-in: this box checks the same password.
  const key = throttleKey(input.storeId, row.username);
  if (!credentialThrottle.check(key).allowed) return { ok: false, error: TOO_MANY_ATTEMPTS_MESSAGE };
  if (!(await bcrypt.compare(input.currentPassword, row.passwordHash))) {
    credentialThrottle.recordFailure(key);
    return { ok: false, error: "The current password is not correct." };
  }
  credentialThrottle.recordSuccess(key);

  const problem = passwordProblem(input.newPassword, row.username);
  if (problem) return { ok: false, error: problem };
  if (input.newPassword === input.currentPassword) {
    return { ok: false, error: "The new password must be different from the current one." };
  }

  const passwordHash = await bcrypt.hash(input.newPassword, BCRYPT_COST);
  await db.transaction().execute(async (trx) => {
    await usersRepo.setPasswordHash(trx, row.id, passwordHash);
    await auditLogRepo.appendAuditLog(trx, {
      storeId: input.storeId,
      userId: row.id,
      deviceId: input.deviceId ?? null,
      action: "password_changed",
      tableName: "users",
      recordId: row.id,
      oldValue: null,
      newValue: null,
      reason: null,
    });
  });
  return { ok: true };
}

export async function login(db: Db, storeId: string, username: string, password: string): Promise<LoginResult> {
  // Checked before the password: during a lockout even the right one is refused.
  const key = throttleKey(storeId, username);
  if (!credentialThrottle.check(key).allowed) {
    return { ok: false, error: TOO_MANY_ATTEMPTS_MESSAGE };
  }

  const row = await usersRepo.findUserByUsername(db, storeId, username);
  // Compared even for an unknown username, so the refusal takes the same time either way.
  const passwordMatches = await bcrypt.compare(password, row?.passwordHash ?? DUMMY_PASSWORD_HASH);
  if (!row || !passwordMatches) {
    credentialThrottle.recordFailure(key);
    return { ok: false, error: "Invalid username or password" };
  }
  credentialThrottle.recordSuccess(key);

  return {
    ok: true,
    user: {
      id: row.id,
      storeId: row.storeId,
      username: row.username,
      displayName: row.displayName,
      role: row.role,
      isActive: row.isActive === 1,
      createdAt: row.createdAt,
    },
    usingDefaultPassword: row.username === DEFAULT_OWNER_USERNAME && password === DEFAULT_OWNER_PASSWORD,
  };
}
