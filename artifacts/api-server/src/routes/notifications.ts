import { Router } from "express";
import { db } from "../lib/db";
import { notificationLogsTable, notificationTemplatesTable, notificationPreferencesTable, systemSettingsTable } from "@workspace/db/schema";
import { eq, and, desc, count, ilike, or, gte, isNotNull } from "drizzle-orm";
import { requireHrmsUser, requireRole } from "../lib/auth";
import {
  NOTIFICATION_EVENT_TYPES,
  NOTIFICATION_EVENT_TYPE_SET,
  NOTIFICATION_DEFAULTS_CATEGORY,
  NOTIFICATION_DEFAULTS_KEY,
  getNotificationDefaults,
} from "../lib/notification-service";
import nodemailer from "nodemailer";

const router = Router();

const HR_ROLES = ["super_admin", "hr_manager"] as const;
const SUPER_ADMIN = ["super_admin"] as const;
const ALL_ROLES = ["super_admin", "hr_manager", "hr_executive", "hod", "payroll_admin", "employee"] as const;

// ─── Notification Templates ───────────────────────────────────────────────────

router.get("/notification-templates", requireHrmsUser, requireRole(...HR_ROLES), async (_req, res) => {
  try {
    const templates = await db.select().from(notificationTemplatesTable).orderBy(notificationTemplatesTable.eventType);
    res.json(templates);
  } catch {
    res.status(500).json({ error: "Failed to list templates" });
  }
});

router.post("/notification-templates", requireHrmsUser, requireRole(...SUPER_ADMIN), async (req, res) => {
  try {
    const { eventType, channel, emailSubject, emailBody, whatsappTemplate, isActive } = req.body;
    const [created] = await db.insert(notificationTemplatesTable).values({
      eventType, channel: channel ?? "email", emailSubject, emailBody, whatsappTemplate,
      isActive: isActive ?? true,
    }).returning();
    res.status(201).json(created);
  } catch {
    res.status(500).json({ error: "Failed to create template" });
  }
});

router.put("/notification-templates/:id", requireHrmsUser, requireRole(...SUPER_ADMIN), async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id as string);
    const { channel, emailSubject, emailBody, whatsappTemplate, isActive } = req.body;
    const [updated] = await db.update(notificationTemplatesTable)
      .set({ channel, emailSubject, emailBody, whatsappTemplate, isActive, updatedAt: new Date() })
      .where(eq(notificationTemplatesTable.id, id))
      .returning();
    if (!updated) { res.status(404).json({ error: "Template not found" }); return; }
    res.json(updated);
  } catch {
    res.status(500).json({ error: "Failed to update template" });
  }
});

router.delete("/notification-templates/:id", requireHrmsUser, requireRole(...SUPER_ADMIN), async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id as string);
    await db.delete(notificationTemplatesTable).where(eq(notificationTemplatesTable.id, id));
    res.status(204).end();
  } catch {
    res.status(500).json({ error: "Failed to delete template" });
  }
});

// ─── Notification Logs ────────────────────────────────────────────────────────

router.get("/notification-logs", requireHrmsUser, requireRole(...HR_ROLES), async (req, res) => {
  try {
    const { channel, module: mod, status, search, limit = "50", offset = "0" } = req.query as Record<string, string>;

    const conditions = [];
    if (channel) conditions.push(eq(notificationLogsTable.channel, channel));
    if (mod) conditions.push(eq(notificationLogsTable.module, mod));
    if (status) conditions.push(eq(notificationLogsTable.status, status));
    if (search) {
      conditions.push(or(
        ilike(notificationLogsTable.recipientEmail, `%${search}%`),
        ilike(notificationLogsTable.recipientName, `%${search}%`),
        ilike(notificationLogsTable.eventType, `%${search}%`),
      ));
    }

    const query = conditions.length ? and(...conditions) : undefined;

    const [logs, [countRow]] = await Promise.all([
      db.select().from(notificationLogsTable)
        .where(query)
        .orderBy(desc(notificationLogsTable.sentAt))
        .limit(parseInt(limit))
        .offset(parseInt(offset)),
      db.select({ total: count() }).from(notificationLogsTable).where(query),
    ]);

    res.json({ logs, total: countRow?.total ?? 0 });
  } catch {
    res.status(500).json({ error: "Failed to list notification logs" });
  }
});

// ─── SMTP Test ────────────────────────────────────────────────────────────────

router.post("/notifications/test-smtp", requireHrmsUser, requireRole(...SUPER_ADMIN), async (req, res) => {
  try {
    const { host, port, secure, username, password, from, testTo } = req.body;
    const transporter = nodemailer.createTransport({
      host, port: parseInt(port ?? "587"), secure: secure === true,
      auth: username ? { user: username, pass: password } : undefined,
    });
    await transporter.verify();
    if (testTo) {
      await transporter.sendMail({
        from, to: testTo,
        subject: "MysticsHR SMTP Test",
        html: "<p>SMTP configuration is working correctly. This is a test email from MysticsHR.</p>",
      });
    }
    res.json({ success: true, message: "SMTP configuration is valid" });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(400).json({ success: false, error: msg });
  }
});

// ─── WhatsApp Test ────────────────────────────────────────────────────────────

router.post("/notifications/test-whatsapp", requireHrmsUser, requireRole(...SUPER_ADMIN), async (req, res): Promise<void> => {
  try {
    const { phone_number_id, access_token, testTo } = req.body;
    if (!phone_number_id || !access_token || !testTo) {
      res.status(400).json({ error: "phone_number_id, access_token and testTo are required" }); return;
    }
    const response = await fetch(`https://graph.facebook.com/v18.0/${phone_number_id}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp", to: testTo, type: "text",
        text: { body: "MysticsHR: WhatsApp configuration test message." },
      }),
    });
    if (!response.ok) {
      const err = await response.text();
      res.status(400).json({ success: false, error: err }); return;
    }
    res.json({ success: true, message: "WhatsApp test message sent" });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).json({ success: false, error: msg });
  }
});

// ─── My Notification Preferences (ESS) ────────────────────────────────────────

/** GET /my-preferences/notifications
 * Returns the master event-type registry overlaid with the caller's stored
 * preferences. Missing entries default to { emailEnabled: true, whatsappEnabled: true }
 * so the UI can render every event consistently. */
router.get("/my-preferences/notifications", requireHrmsUser, requireRole(...ALL_ROLES), async (req, res) => {
  try {
    const u = req.hrmsUser!;
    const employeeId = u.employeeId;
    const stored = employeeId
      ? await db.select().from(notificationPreferencesTable).where(eq(notificationPreferencesTable.employeeId, employeeId))
      : [];
    const byEvent = new Map(stored.map((s) => [s.eventType, s]));
    const items = NOTIFICATION_EVENT_TYPES.map((meta) => {
      const row = byEvent.get(meta.eventType);
      return {
        eventType: meta.eventType,
        label: meta.label,
        description: meta.description,
        module: meta.module,
        emailEnabled: row?.emailEnabled ?? true,
        whatsappEnabled: row?.whatsappEnabled ?? true,
      };
    });
    res.json({ employeeId: employeeId ?? null, items });
  } catch (e) {
    console.error("[my-preferences/notifications GET]", e);
    res.status(500).json({ error: "Failed to load notification preferences" });
  }
});

/** PUT /my-preferences/notifications
 * Body: { items: [{ eventType, emailEnabled, whatsappEnabled }, ...] }
 * Upserts each row for the caller's employee. Unknown event types are rejected. */
router.put("/my-preferences/notifications", requireHrmsUser, requireRole(...ALL_ROLES), async (req, res): Promise<void> => {
  try {
    const u = req.hrmsUser!;
    const employeeId = u.employeeId;
    if (!employeeId) {
      res.status(400).json({ error: "Your account is not linked to an employee record. Contact HR." });
      return;
    }
    const body = req.body as { items?: Array<{ eventType?: string; emailEnabled?: boolean; whatsappEnabled?: boolean }> };
    const rawItems = Array.isArray(body?.items) ? body.items : [];
    if (rawItems.length === 0) { res.status(400).json({ error: "items[] is required" }); return; }

    // Pre-validate every item before any DB write so a bad row late in the
    // payload doesn't leave earlier rows partially applied. Also de-dupes
    // by eventType (last write wins) so callers can be lenient.
    const normalized = new Map<string, { eventType: string; emailEnabled: boolean; whatsappEnabled: boolean }>();
    for (const it of rawItems) {
      const eventType = String(it.eventType ?? "").trim();
      if (!eventType || !NOTIFICATION_EVENT_TYPE_SET.has(eventType)) {
        res.status(400).json({ error: `Unknown eventType: ${eventType || "(empty)"}` });
        return;
      }
      normalized.set(eventType, {
        eventType,
        emailEnabled: it.emailEnabled !== false,
        whatsappEnabled: it.whatsappEnabled !== false,
      });
    }

    // Apply all upserts in a single transaction so the write is all-or-nothing.
    // Track silencedAt: an event is "silenced" when at least one channel is off.
    // Stamp silencedAt when transitioning into the silenced state; clear it
    // when both channels are re-enabled. Existing silencedAt is preserved
    // while the event remains silenced.
    const items = Array.from(normalized.values());
    const now = new Date();
    await db.transaction(async (tx) => {
      for (const it of items) {
        const isSilenced = !it.emailEnabled || !it.whatsappEnabled;
        const [existing] = await tx.select({
          id: notificationPreferencesTable.id,
          emailEnabled: notificationPreferencesTable.emailEnabled,
          whatsappEnabled: notificationPreferencesTable.whatsappEnabled,
          silencedAt: notificationPreferencesTable.silencedAt,
        })
          .from(notificationPreferencesTable)
          .where(and(eq(notificationPreferencesTable.employeeId, employeeId), eq(notificationPreferencesTable.eventType, it.eventType)))
          .limit(1);
        if (existing) {
          const wasSilenced = !existing.emailEnabled || !existing.whatsappEnabled;
          let silencedAt: Date | null;
          if (!isSilenced) silencedAt = null;
          else if (!wasSilenced) silencedAt = now;
          else silencedAt = existing.silencedAt ?? now;
          await tx.update(notificationPreferencesTable)
            .set({ emailEnabled: it.emailEnabled, whatsappEnabled: it.whatsappEnabled, silencedAt, updatedAt: now })
            .where(eq(notificationPreferencesTable.id, existing.id));
        } else {
          await tx.insert(notificationPreferencesTable).values({
            employeeId, eventType: it.eventType,
            emailEnabled: it.emailEnabled, whatsappEnabled: it.whatsappEnabled,
            silencedAt: isSilenced ? now : null,
          });
        }
      }
    });
    res.json({ success: true, count: items.length });
  } catch (e) {
    console.error("[my-preferences/notifications PUT]", e);
    res.status(500).json({ error: "Failed to update notification preferences" });
  }
});

// ─── Recently Silenced Notifications (ESS digest) ─────────────────────────────

const SILENCED_DIGEST_DAYS = 30;
const NOTIFICATION_EVENT_META = new Map(NOTIFICATION_EVENT_TYPES.map((m) => [m.eventType, m]));

/** GET /my-preferences/notifications/silenced
 * Returns events the caller silenced (i.e. turned off at least one channel)
 * within the last 30 days. Each item carries the timestamp the silence
 * happened plus the same registry metadata the master prefs page uses, so
 * the UI can render a friendly "Recently silenced" digest. */
router.get("/my-preferences/notifications/silenced", requireHrmsUser, requireRole(...ALL_ROLES), async (req, res) => {
  try {
    const u = req.hrmsUser!;
    const employeeId = u.employeeId;
    if (!employeeId) { res.json({ items: [], windowDays: SILENCED_DIGEST_DAYS }); return; }
    const cutoff = new Date(Date.now() - SILENCED_DIGEST_DAYS * 24 * 60 * 60 * 1000);
    const rows = await db.select().from(notificationPreferencesTable)
      .where(and(
        eq(notificationPreferencesTable.employeeId, employeeId),
        isNotNull(notificationPreferencesTable.silencedAt),
        gte(notificationPreferencesTable.silencedAt, cutoff),
      ))
      .orderBy(desc(notificationPreferencesTable.silencedAt));
    const items = rows
      .map((r) => {
        const meta = NOTIFICATION_EVENT_META.get(r.eventType);
        if (!meta) return null;
        return {
          eventType: r.eventType,
          label: meta.label,
          description: meta.description,
          module: meta.module,
          emailEnabled: r.emailEnabled,
          whatsappEnabled: r.whatsappEnabled,
          silencedAt: r.silencedAt!.toISOString(),
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
    res.json({ items, windowDays: SILENCED_DIGEST_DAYS });
  } catch (e) {
    console.error("[my-preferences/notifications/silenced GET]", e);
    res.status(500).json({ error: "Failed to load silenced notifications digest" });
  }
});

/** POST /my-preferences/notifications/:eventType/unsilence
 * One-click re-enable for a single event from the digest. Sets both channels
 * back on and clears silencedAt so the entry drops out of the digest. */
router.post("/my-preferences/notifications/:eventType/unsilence", requireHrmsUser, requireRole(...ALL_ROLES), async (req, res): Promise<void> => {
  try {
    const u = req.hrmsUser!;
    const employeeId = u.employeeId;
    if (!employeeId) {
      res.status(400).json({ error: "Your account is not linked to an employee record. Contact HR." });
      return;
    }
    const eventType = String(req.params.eventType ?? "").trim();
    if (!eventType || !NOTIFICATION_EVENT_TYPE_SET.has(eventType)) {
      res.status(400).json({ error: `Unknown eventType: ${eventType || "(empty)"}` });
      return;
    }
    const now = new Date();
    const [existing] = await db.select({ id: notificationPreferencesTable.id })
      .from(notificationPreferencesTable)
      .where(and(eq(notificationPreferencesTable.employeeId, employeeId), eq(notificationPreferencesTable.eventType, eventType)))
      .limit(1);
    if (existing) {
      await db.update(notificationPreferencesTable)
        .set({ emailEnabled: true, whatsappEnabled: true, silencedAt: null, updatedAt: now })
        .where(eq(notificationPreferencesTable.id, existing.id));
    } else {
      await db.insert(notificationPreferencesTable).values({
        employeeId, eventType, emailEnabled: true, whatsappEnabled: true, silencedAt: null,
      });
    }
    res.json({ success: true });
  } catch (e) {
    console.error("[my-preferences/notifications/:eventType/unsilence POST]", e);
    res.status(500).json({ error: "Failed to re-enable notification" });
  }
});

// ─── Company-wide Default Notification Preferences (HR/Admin) ─────────────────

/** GET /notification-defaults
 * Returns the company-wide default toggles for new joiners, overlaid on the
 * master event-type registry. Same item shape as `/my-preferences/notifications`
 * so the admin UI can reuse the ESS list rendering. Missing entries default
 * to "everything on" — matching the seeding fallback. */
router.get("/notification-defaults", requireHrmsUser, requireRole(...HR_ROLES), async (_req, res) => {
  try {
    const defaults = await getNotificationDefaults();
    const items = NOTIFICATION_EVENT_TYPES.map((meta) => {
      const d = defaults[meta.eventType];
      return {
        eventType: meta.eventType,
        label: meta.label,
        description: meta.description,
        module: meta.module,
        emailEnabled: d ? d.emailEnabled : true,
        whatsappEnabled: d ? d.whatsappEnabled : true,
      };
    });
    res.json({ items });
  } catch (e) {
    console.error("[notification-defaults GET]", e);
    res.status(500).json({ error: "Failed to load notification defaults" });
  }
});

/** PUT /notification-defaults
 * Body: { items: [{ eventType, emailEnabled, whatsappEnabled }, ...] }
 * Replaces the entire defaults map. Only event types in the master registry
 * are accepted. Existing employees are NOT affected — these defaults only
 * seed future joiners. */
router.put("/notification-defaults", requireHrmsUser, requireRole(...HR_ROLES), async (req, res): Promise<void> => {
  try {
    const body = req.body as { items?: Array<{ eventType?: string; emailEnabled?: boolean; whatsappEnabled?: boolean }> };
    const rawItems = Array.isArray(body?.items) ? body.items : [];
    if (rawItems.length === 0) { res.status(400).json({ error: "items[] is required" }); return; }

    const map: Record<string, { emailEnabled: boolean; whatsappEnabled: boolean }> = {};
    for (const it of rawItems) {
      const eventType = String(it.eventType ?? "").trim();
      if (!eventType || !NOTIFICATION_EVENT_TYPE_SET.has(eventType)) {
        res.status(400).json({ error: `Unknown eventType: ${eventType || "(empty)"}` });
        return;
      }
      map[eventType] = {
        emailEnabled: it.emailEnabled !== false,
        whatsappEnabled: it.whatsappEnabled !== false,
      };
    }

    const [existing] = await db.select({ id: systemSettingsTable.id }).from(systemSettingsTable)
      .where(and(
        eq(systemSettingsTable.category, NOTIFICATION_DEFAULTS_CATEGORY),
        eq(systemSettingsTable.key, NOTIFICATION_DEFAULTS_KEY),
      ))
      .limit(1);
    if (existing) {
      await db.update(systemSettingsTable)
        .set({ value: map, updatedAt: new Date() })
        .where(eq(systemSettingsTable.id, existing.id));
    } else {
      await db.insert(systemSettingsTable).values({
        category: NOTIFICATION_DEFAULTS_CATEGORY,
        key: NOTIFICATION_DEFAULTS_KEY,
        value: map,
      });
    }
    res.json({ success: true, count: Object.keys(map).length });
  } catch (e) {
    console.error("[notification-defaults PUT]", e);
    res.status(500).json({ error: "Failed to update notification defaults" });
  }
});

export default router;
