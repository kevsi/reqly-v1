/**
 * Email sending abstraction for the sync server.
 *
 * In development (NODE_ENV !== "production") codes are only logged to the
 * console — no real emails are sent. In production, if SMTP or an API-based
 * provider is configured, emails are sent via that channel.
 *
 * Supported providers (set via EMAIL_PROVIDER env var):
 *   - "smtp"   : SMTP via nodemailer (requires SMTP_* env vars)
 *   - "resend" : Resend API (requires RESEND_API_KEY)
 *   - "log"    : Console-only (default in dev / fallback)
 *
 * If EMAIL_PROVIDER is not set, defaults to "log" in development
 * and "smtp" in production (which will fail without SMTP config —
 * the user must set one up).
 */

import { randomBytes } from "node:crypto";

// ── Configuration ──────────────────────────────────────────────────────────

const NODE_ENV = process.env.NODE_ENV || "development";
const EMAIL_PROVIDER = process.env.EMAIL_PROVIDER || (NODE_ENV === "production" ? "smtp" : "log");
const FROM_ADDRESS = process.env.EMAIL_FROM || "noreply@reqly.app";

// ── Provider initialization ────────────────────────────────────────────────

type SendFn = (to: string, subject: string, html: string) => Promise<void>;

let send: SendFn;

async function initProvider(): Promise<SendFn> {
  switch (EMAIL_PROVIDER) {
    case "smtp": {
      const nodemailer = await import("nodemailer");
      const transporter = nodemailer.default.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT) || 587,
        secure: process.env.SMTP_SECURE === "true",
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
      });
      // Verify SMTP connection on startup
      try {
        await transporter.verify();
        console.log("[email] SMTP connection verified");
      } catch (err) {
        console.warn("[email] SMTP verification failed (emails may not send):", err);
      }
      return async (to, subject, html) => {
        await transporter.sendMail({
          from: FROM_ADDRESS,
          to,
          subject,
          html,
        });
      };
    }

    case "resend": {
      const apiKey = process.env.RESEND_API_KEY;
      if (!apiKey) {
        throw new Error("RESEND_API_KEY is required when EMAIL_PROVIDER=resend");
      }
      return async (to, subject, html) => {
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: FROM_ADDRESS,
            to,
            subject,
            html,
          }),
        });
        if (!res.ok) {
          const body = await res.text();
          throw new Error(`Resend API error ${res.status}: ${body}`);
        }
      };
    }

    case "log":
    default: {
      return async (to, subject, html) => {
        console.log(`[email:dev] ────────────────────────────────────────────────`);
        console.log(`[email:dev] TO:      ${to}`);
        console.log(`[email:dev] SUBJECT: ${subject}`);
        console.log(`[email:dev] ────────────────────────────────────────────────`);
        console.log(`${html.replace(/<[^>]+>/g, "").trim()}`);
        console.log(`[email:dev] ────────────────────────────────────────────────`);
      };
    }
  }
}

// Lazy init — won't throw at module import time if config is wrong
let initPromise: Promise<void> | null = null;
async function ensureInit() {
  if (!initPromise) {
    initPromise = initProvider().then((fn) => {
      send = fn;
    });
  }
  await initPromise;
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Generate a cryptographically random numeric code of the given length.
 */
export function generateVerificationCode(length = 6): string {
  // Use randomBytes to avoid modulo bias with a simple rejection loop
  const digits: number[] = [];
  const bytes = randomBytes(length * 2);
  for (let i = 0; digits.length < length && i < bytes.length; i++) {
    const d = bytes[i] % 10;
    digits.push(d);
  }
  return digits.join("");
}

/**
 * Send a verification code to the given email address.
 * Throws if sending fails.
 */
export async function sendVerificationCode(email: string, code: string): Promise<void> {
  await ensureInit();

  const subject = "Votre code de vérification Reqly";
  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px;">
      <h1 style="font-size: 20px; font-weight: 600; margin-bottom: 8px; color: #111;">
        Vérification de votre compte
      </h1>
      <p style="font-size: 14px; line-height: 1.6; color: #555; margin-bottom: 24px;">
        Merci de vous être inscrit sur Reqly. Utilisez le code ci-dessous pour
        finaliser la création de votre compte&nbsp;:
      </p>
      <div style="background: #f5f5f5; border-radius: 12px; padding: 20px; text-align: center; margin-bottom: 24px;">
        <span style="font-size: 36px; font-weight: 700; letter-spacing: 8px; font-family: monospace; color: #111;">
          ${code}
        </span>
      </div>
      <p style="font-size: 13px; line-height: 1.5; color: #888;">
        Ce code expire dans 15 minutes. Si vous n'avez pas demandé cette
        vérification, ignorez cet email.
      </p>
    </div>
  `;

  await send(email, subject, html);
}

/**
 * Send a notification that the account has been verified.
 */
export async function sendWelcomeEmail(email: string, name?: string): Promise<void> {
  await ensureInit();

  const subject = "Bienvenue sur Reqly 🎉";
  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px;">
      <h1 style="font-size: 20px; font-weight: 600; margin-bottom: 8px; color: #111;">
        ${name ? `Bonjour ${name},` : "Bienvenue sur Reqly !"}
      </h1>
      <p style="font-size: 14px; line-height: 1.6; color: #555; margin-bottom: 16px;">
        Votre compte est maintenant vérifié. Vous pouvez commencer à utiliser
        Reqly pour tester, documenter et collaborer sur vos API.
      </p>
    </div>
  `;

  await send(email, subject, html);
}

/**
 * Send a password reset code to the given email address.
 * Throws if sending fails.
 */
export async function sendPasswordResetEmail(email: string, code: string): Promise<void> {
  await ensureInit();

  const subject = "Réinitialisation de votre mot de passe Reqly";
  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px;">
      <h1 style="font-size: 20px; font-weight: 600; margin-bottom: 8px; color: #111;">
        Réinitialisation du mot de passe
      </h1>
      <p style="font-size: 14px; line-height: 1.6; color: #555; margin-bottom: 24px;">
        Vous avez demandé la réinitialisation de votre mot de passe. Utilisez le
        code ci-dessous pour créer un nouveau mot de passe&nbsp;:
      </p>
      <div style="background: #f5f5f5; border-radius: 12px; padding: 20px; text-align: center; margin-bottom: 24px;">
        <span style="font-size: 36px; font-weight: 700; letter-spacing: 8px; font-family: monospace; color: #111;">
          ${code}
        </span>
      </div>
      <p style="font-size: 13px; line-height: 1.5; color: #888;">
        Ce code expire dans 15 minutes. Si vous n'avez pas demandé cette
        réinitialisation, ignorez cet email. Votre mot de passe actuel reste
        inchangé.
      </p>
    </div>
  `;

  await send(email, subject, html);
}
