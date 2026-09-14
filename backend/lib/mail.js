import fs from "fs";
import path from "path";
import nodemailer from "nodemailer";
import crypto from "crypto";
import { EmailTemplate } from "./models/emailTemplate";
import { Setting } from "./models/setting";
import {
  contrastText,
  DEFAULT_THEME_COLOR,
} from "@shared/constants";

export const EMAIL_TEMPLATES_DIR = path.join(
  process.cwd(),
  "lib",
  "email-templates"
);

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "smtp.ethereal.email",
  port: Number(process.env.SMTP_PORT) || 587,
  secure: process.env.SMTP_SECURE === "true",
  auth: process.env.SMTP_USER
    ? {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS || process.env.SMTP_PASSWORD,
      }
    : undefined,
});

// Replaces {{key}} placeholders in a template with matching values.
// Unknown placeholders are left untouched so you can spot typos.
export function renderTemplate(source, values = {}) {
  return source.replace(/\{\{\s*([\w]+)\s*\}\}/g, (match, key) =>
    Object.prototype.hasOwnProperty.call(values, key)
      ? String(values[key])
      : match
  );
}

// Reads a template file fresh on every call, so edits to the
// .html / .txt files apply without restarting the server.
export function loadEmailTemplate(file) {
  return fs.readFileSync(path.join(EMAIL_TEMPLATES_DIR, file), "utf8");
}

export function getAppName() {
  return process.env.APP_NAME || "Earth धान्य";
}

export function getSender() {
  return process.env.SMTP_FROM || `${getAppName()} <noreply@dpharma.my>`;
}

// Loads the global theme settings for emails. Falls back to defaults
// when the settings row/table is unavailable.
export async function getEmailTheme() {
  try {
    const settings = await Setting.get();

    return {
      themeColor:
        settings?.theme_color && /^#[0-9a-fA-F]{6}$/.test(settings.theme_color)
          ? settings.theme_color
          : DEFAULT_THEME_COLOR,
    };
  } catch (error) {
    console.warn("Could not load theme settings:", error.message);
    return { themeColor: DEFAULT_THEME_COLOR };
  }
}

export function generatePassword(length = 12) {
  const upper = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const lower = "abcdefghijklmnopqrstuvwxyz";
  const digits = "0123456789";
  const symbols = "!@#$%^&*";
  const all = upper + lower + digits + symbols;

  const bytes = crypto.randomBytes(length);
  let password = "";

  // Guarantee at least one of each required type
  password += upper[bytes[0] % upper.length];
  password += lower[bytes[1] % lower.length];
  password += digits[bytes[2] % digits.length];
  password += symbols[bytes[3] % symbols.length];

  for (let i = 4; i < length; i++) {
    password += all[bytes[i] % all.length];
  }

  // Shuffle the password using Fisher-Yates
  const arr = password.split("");
  for (let i = arr.length - 1; i > 0; i--) {
    const j = bytes[i] % (i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }

  return arr.join("");
}

// Looks up an active template from the email_templates table.
// Returns null when unavailable so mailers can fall back to files.
export async function fetchEmailTemplate(slug) {
  try {
    const template = await EmailTemplate.findActiveBySlug(slug);

    if (template && template.body_html && template.body_text) {
      return template;
    }
  } catch (error) {
    console.warn(
      `Could not load email template "${slug}" from database:`,
      error.message
    );
  }

  return null;
}

// Builds a mail object ({ subject, text, html }) for a template.
// Uses the DB template when present, otherwise the file fallback.
export async function buildEmailFromTemplate({
  slug,
  values = {},
  fallback,
}) {
  const dbTemplate = await fetchEmailTemplate(slug);
  const { themeColor } = await getEmailTheme();

  const mergedValues = {
    themePrimary: themeColor,
    themeOnPrimary: contrastText(themeColor),
    ...values,
  };

  if (dbTemplate) {
    return {
      subject: renderTemplate(dbTemplate.subject, mergedValues),
      text: renderTemplate(dbTemplate.body_text, mergedValues),
      html: renderTemplate(dbTemplate.body_html, mergedValues),
    };
  }

  return {
    subject: renderTemplate(fallback.subject, mergedValues),
    text: renderTemplate(loadEmailTemplate(fallback.textFile), mergedValues),
    html: renderTemplate(loadEmailTemplate(fallback.htmlFile), mergedValues),
  };
}

export async function buildCredentialsEmail({ name, email, password }) {
  const appName = getAppName();
  const loginUrl = process.env.LOGIN_URL || "/login";

  return buildEmailFromTemplate({
    slug: "credentials",
    values: {
      appName,
      userName: name,
      email,
      password,
      loginUrl,
    },
    fallback: {
      subject: `Your ${appName} Account Credentials`,
      htmlFile: "credentials.html",
      textFile: "credentials.txt",
    },
  });
}

// Generic sender for any template (DB row or file fallback).
export async function sendEmailFromTemplate({
  slug,
  to,
  values = {},
  fallback,
}) {
  const mail = await buildEmailFromTemplate({ slug, values, fallback });

  return transporter.sendMail({
    from: getSender(),
    to,
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
  });
}

export async function sendCredentialsEmail(to, name, email, password) {
  const mail = await buildCredentialsEmail({ name, email, password });

  try {
    const info = await transporter.sendMail({
      from: getSender(),
      to,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    });

    console.log("Email sent:", info.messageId);

    return { success: true };
  } catch (error) {
    console.error("Email send error:", error.message);
    // Log password to console when email fails (dev fallback)
    console.log(`\n--- CREDENTIALS (email failed) ---`);
    console.log(`Name:     ${name}`);
    console.log(`Email:    ${email}`);
    console.log(`Password: ${password}`);
    console.log(`----------------------------------\n`);

    return { success: false, message: error.message };
  }
}