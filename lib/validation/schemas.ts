import { z } from "zod";

export const NAME_MAX = 60;
export const EMAIL_MAX = 254;
/** Hard ceiling; the effective limit comes from app_config (default 2,000). */
export const MESSAGE_HARD_MAX = 10_000;
export const DEFAULT_MESSAGE_MAX = 2_000;

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

export function normalizeName(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export const nameSchema = z
  .string()
  .transform(normalizeName)
  .pipe(
    z
      .string()
      .min(1, "Name is required.")
      .max(NAME_MAX, `Name must be at most ${NAME_MAX} characters.`)
      .refine((v) => !CONTROL_CHARS.test(v), "Name contains invalid characters."),
  );

export const emailSchema = z
  .string()
  .transform(normalizeEmail)
  .pipe(
    z
      .string()
      .min(1, "Email is required.")
      .max(EMAIL_MAX, "Email is too long.")
      .regex(/^[a-z0-9._%+'-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/, "Enter a valid email address."),
  );

export const PRIVATE_KEY_LENGTH = 64;

export const privateKeySchema = z
  .string()
  .transform((v) => v.trim().toLowerCase())
  .pipe(
    z
      .string()
      .regex(
        new RegExp(`^[0-9a-f]{${PRIVATE_KEY_LENGTH}}$`),
        `Key must be exactly ${PRIVATE_KEY_LENGTH} characters (0-9, a-f).`,
      ),
  );

export const loginSchema = z.object({
  key: privateKeySchema,
});

export const createUserSchema = z.object({
  name: nameSchema,
});

export const messageContentSchema = z
  .string()
  .transform((v) => v.replace(/\r\n?/g, "\n").trim())
  .pipe(z.string().min(1, "Cannot transmit an empty message.").max(MESSAGE_HARD_MAX));

export const sendMessageSchema = z.object({
  sessionId: z.uuid(),
  content: messageContentSchema,
  clientMsgId: z.uuid(),
});

export const adminReplySchema = z.object({
  content: messageContentSchema,
  clientMsgId: z.uuid(),
});

export const sessionStatusSchema = z.object({
  status: z.enum(["active", "closed"]),
});

export const userStatusSchema = z.object({
  status: z.enum(["active", "blocked"]),
});

export const deleteUserSchema = z.object({
  confirmName: nameSchema,
});

export const settingsSchema = z.object({
  message_max_length: z.number().int().min(100).max(MESSAGE_HARD_MAX),
  rate_limit_per_minute: z.number().int().min(1).max(120),
  sessions_per_hour: z.number().int().min(1).max(500),
});

export const profileSchema = z.object({
  display_name: nameSchema,
});

export const uuidSchema = z.uuid();
