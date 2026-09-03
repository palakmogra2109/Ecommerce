import nodemailer from "nodemailer";
import crypto from "crypto";

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "smtp.ethereal.email",
  port: Number(process.env.SMTP_PORT) || 587,
  secure: process.env.SMTP_SECURE === "true",
  auth: process.env.SMTP_USER
    ? {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      }
    : undefined,
});

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

export async function sendCredentialsEmail(
  to,
  name,
  email,
  password
) {
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
      <h2 style="color:#1e293b;">Welcome to D Pharma Admin</h2>
      <p>Your account has been created. Here are your login credentials:</p>
      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px;margin:16px 0;">
        <p><strong>Email:</strong> ${email}</p>
        <p><strong>Password:</strong> <code style="background:#e2e8f0;padding:2px 6px;border-radius:4px;">${password}</code></p>
      </div>
      <p style="color:#64748b;font-size:13px;">Please log in and change your password immediately. Do not share these credentials.</p>
      <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;" />
      <p style="color:#94a3b8;font-size:12px;">This is an automated message from D Pharma Admin Panel.</p>
    </div>
  `;

  try {
    const info = await transporter.sendMail({
      from:
        process.env.SMTP_FROM || "D Pharma Admin <noreply@dpharma.my>",
      to,
      subject: "Your D Pharma Admin Account Credentials",
      text: `Welcome ${name || ""}\n\nYour login credentials:\nEmail: ${email}\nPassword: ${password}\n\nPlease log in and change your password immediately.`,
      html,
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
