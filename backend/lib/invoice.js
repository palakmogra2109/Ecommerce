import PDFDocument from "pdfkit";

const STORE_NAME = "Earth धान्य";

const money = (v) =>
  `Rs. ${Number(v || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

function fmtDate(value) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

function safe(text) {
  // PDFKit's built-in Helvetica font is Latin-only, so transliterate the
  // common Devanagari characters and strip anything it cannot render.
  return String(text ?? "")
    .replace(/[\u0900-\u097F]+/g, (m) => (m.includes("धान्य") ? "Dhanya" : "Dhanya"))
    // Strip non-latin chars that Helvetica cannot render.
    .replace(/[^\x00-\x7F]/g, "");
}

// Builds the order invoice as a PDF buffer. `order` is the order row with
// items attached (see Order.getDetailByUuid).
export async function buildInvoicePdf(order) {
  const doc = new PDFDocument({ size: "A4", margin: 50 });
  const chunks = [];

  doc.on("data", (c) => chunks.push(c));
  const done = new Promise((resolve) => doc.on("end", resolve));

  // ----- Header -----
  doc
    .fontSize(22)
    .fillColor("#111827")
    .text(safe(STORE_NAME), 50, 50);
  doc
    .fontSize(9)
    .fillColor("#6b7280")
    .text(safe("Order Invoice / Bill"), 50, 76);

  doc.moveTo(50, 96).lineTo(545, 96).lineWidth(1).strokeColor("#e5e7eb").stroke();

  // Invoice meta (right column)
  doc.fontSize(10).fillColor("#111827");
  doc.text(`Invoice: ${safe(order.order_number)}`, 330, 50, { width: 215, align: "right" });
  doc
    .fontSize(9)
    .fillColor("#6b7280")
    .text(`Date: ${fmtDate(order.created_at)}`, 330, 68, { width: 215, align: "right" });
  if (order.branch_name) {
    doc.text(`Store: ${safe(order.branch_name)}`, 330, 82, { width: 215, align: "right" });
  }

  // ----- Bill to -----
  const addr = order.shipping_address || {};
  const addrLines = [
    addr.line1,
    addr.line2,
    [addr.city, addr.state, addr.pincode].filter(Boolean).join(", "),
    addr.country,
  ].filter(Boolean);

  doc.fontSize(11).fillColor("#111827").text("Billed To", 50, 120);
  doc.fontSize(10).fillColor("#374151");
  doc.text(safe(order.customer_name || "-"), 50, 138);
  if (order.customer_mobile) doc.text(safe(order.customer_mobile), 50, 154);
  doc.text(safe(order.customer_email || ""), 50, order.customer_mobile ? 168 : 154);
  let y = order.customer_mobile ? 184 : 170;
  addrLines.forEach((line) => {
    doc.text(safe(line), 50, y, { width: 250 });
    y += 14;
  });

  // Payment info
  doc.fontSize(10).fillColor("#374151");
  doc.text(`Payment: ${(order.payment_method || "cod").toUpperCase()}`, 330, 120, {
    width: 215,
    align: "right",
  });
  doc.text(`Status: ${order.payment_status || "PENDING"}`, 330, 136, {
    width: 215,
    align: "right",
  });
  doc.text(`Order status: ${order.status || "-"}`, 330, 152, {
    width: 215,
    align: "right",
  });
  if (order.estimated_delivery_at) {
    doc.text(`Est. delivery: ${fmtDate(order.estimated_delivery_at)}`, 330, 168, {
      width: 215,
      align: "right",
    });
  }

  // ----- Items table -----
  const tableTop = Math.max(y + 20, 230);
  doc.rect(50, tableTop, 495, 24).fill("#f3f4f6");
  doc.fillColor("#111827").fontSize(9.5);
  doc.text("#", 58, tableTop + 8);
  doc.text("Item", 80, tableTop + 8, { width: 200 });
  doc.text("SKU", 290, tableTop + 8, { width: 80 });
  doc.text("Qty", 375, tableTop + 8, { width: 30, align: "right" });
  doc.text("Price", 420, tableTop + 8, { width: 55, align: "right" });
  doc.text("Amount", 490, tableTop + 8, { width: 50, align: "right" });

  let ty = tableTop + 32;
  const items = order.items || [];
  items.forEach((it, idx) => {
    if (ty > 720) {
      doc.addPage();
      ty = 60;
    }
    doc.fillColor("#111827").fontSize(9.5);
    doc.text(String(idx + 1), 58, ty);
    doc.text(safe(it.product_name), 80, ty, { width: 200, ellipsis: true });
    doc.text(safe(it.sku || "-"), 290, ty, { width: 80, ellipsis: true });
    doc.text(String(it.quantity), 375, ty, { width: 30, align: "right" });
    doc.text(money(it.price), 420, ty, { width: 55, align: "right" });
    doc.text(money(it.subtotal), 490, ty, { width: 50, align: "right" });
    ty += 22;
    doc
      .moveTo(50, ty - 6)
      .lineTo(545, ty - 6)
      .lineWidth(0.5)
      .strokeColor("#f3f4f6")
      .stroke();
  });

  // ----- Totals -----
  if (ty > 680) {
    doc.addPage();
    ty = 60;
  }
  ty += 10;
  const totalsX = 360;
  const row = (label, value, bold = false) => {
    doc.fontSize(bold ? 11 : 10).fillColor(bold ? "#111827" : "#374151");
    doc.text(label, totalsX, ty, { width: 100, align: "right" });
    doc.text(money(value), 470, ty, { width: 75, align: "right" });
    ty += bold ? 22 : 18;
  };

  row("Subtotal", order.subtotal);
  if (Number(order.discount) > 0) row("Discount", `-${order.discount}`.replace("-", "-"));
  row("Grand Total", order.total, true);

  // ----- Footer -----
  doc
    .fontSize(8.5)
    .fillColor("#9ca3af")
    .text(
      safe("This is a computer-generated invoice. Thank you for shopping with us!"),
      50,
      780,
      { width: 495, align: "center" }
    );

  doc.end();
  await done;

  return Buffer.concat(chunks);
}
