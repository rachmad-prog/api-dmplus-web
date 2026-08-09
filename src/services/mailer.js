const nodemailer = require("nodemailer");

// Transport pakai Gmail SMTP + App Password.
// Butuh: GMAIL_USER, GMAIL_APP_PASSWORD di .env
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
});

function formatRupiah(n) {
  return "Rp " + Number(n).toLocaleString("id-ID");
}

function waConfirmUrl(order) {
  const waNumber = process.env.WHATSAPP_NUMBER || "628111848185";
  const text = `Halo, saya sudah transfer pembayaran sebesar ${formatRupiah(order.totalAmount)} untuk invoice ${order.invoiceNumber} atas nama ${order.customerName}. Mohon dikonfirmasi. Terima kasih!`;
  return `https://wa.me/${waNumber}?text=${encodeURIComponent(text)}`;
}

function statusUrl(invoiceNumber) {
  return `${process.env.CLIENT_URL}/status/${invoiceNumber}`;
}

async function sendMail({ to, subject, html }) {
  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
    console.warn("[mailer] GMAIL_USER/GMAIL_APP_PASSWORD belum di-set, email tidak dikirim:", subject);
    return;
  }
  try {
    await transporter.sendMail({
      from: `"DM Plus" <${process.env.GMAIL_USER}>`,
      to,
      subject,
      html,
    });
  } catch (err) {
    console.error("[mailer] gagal kirim email:", err.message);
  }
}

// Dikirim ke admin saat ada order + pembayaran baru masuk
async function notifyAdminNewOrder(order, service) {
  const adminEmail = process.env.NOTIFY_ADMIN_EMAIL;
  if (!adminEmail) return;
  await sendMail({
    to: adminEmail,
    subject: `Order Baru: ${order.invoiceNumber} — ${service.name}`,
    html: `
      <h2>Order baru masuk</h2>
      <p><b>Invoice:</b> ${order.invoiceNumber}</p>
      <p><b>Paket:</b> ${service.name} (${service.domainType})</p>
      <p><b>Nama:</b> ${order.customerName}</p>
      <p><b>Email:</b> ${order.customerEmail}</p>
      <p><b>WhatsApp:</b> ${order.customerPhone}</p>
      <p><b>Bisnis:</b> ${order.businessName || "-"}</p>
      <p><b>Catatan:</b> ${order.notes || "-"}</p>
      <p><b>Total Pembayaran:</b> ${formatRupiah(order.totalAmount)}</p>
    `,
  });
}

// Dikirim ke customer saat order + metode pembayaran dipilih
async function notifyCustomerOrderCreated(order, service, payment, bankInfo) {
  bankInfo = bankInfo || { bankName: "-", accountNumber: "-", accountHolder: "-" };

  const isMidtrans = payment?.method === "MIDTRANS";
  const isDoku = payment?.method === "DOKU";

  const paymentSection = isMidtrans
    ? `
      <p><b>Cara bayar ${formatRupiah(order.totalAmount)}:</b></p>
      <p>
        <a href="${payment.snapRedirectUrl}"
           style="display:inline-block;background:#1a3c34;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;">
          💳 Bayar Sekarang via Midtrans (VA / E-wallet / Kartu)
        </a>
      </p>
      <p style="font-size:13px;color:#888;margin-top:8px;">
        Link di atas berlaku untuk pembayaran melalui Virtual Account, E-wallet (GoPay/OVO/ShopeePay/DANA),
        atau Kartu Kredit/Debit sesuai pilihanmu di halaman Midtrans.
      </p>
    `
    : isDoku
    ? `
      <p><b>Cara bayar ${formatRupiah(order.totalAmount)}:</b></p>
      <p>
        <a href="${payment.dokuPaymentUrl}"
           style="display:inline-block;background:#1a3c34;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;">
          💳 Bayar Sekarang via Doku (VA / E-wallet / Kartu)
        </a>
      </p>
      <p style="font-size:13px;color:#888;margin-top:8px;">
        Link di atas berlaku untuk pembayaran melalui Virtual Account, E-wallet, atau Kartu Kredit/Debit
        sesuai pilihanmu di halaman Doku.
      </p>
    `
    : `
      <p><b>Cara bayar ${formatRupiah(order.totalAmount)}:</b></p>
      <p style="font-size:14px;">
        Transfer manual ke:<br/>
        Bank <b>${bankInfo.bankName}</b> a.n. <b>${bankInfo.accountHolder}</b><br/>
        No. Rekening: <b>${bankInfo.accountNumber}</b><br/>
        Nominal: <b>${formatRupiah(order.totalAmount)}</b><br/><br/>
        Setelah transfer, konfirmasi ke admin via WhatsApp:<br/>
        <a href="${waConfirmUrl(order)}"
           style="display:inline-block;background:#25d366;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:bold;margin-top:6px;">
          💬 Konfirmasi via WhatsApp
        </a>
      </p>
    `;

  await sendMail({
    to: order.customerEmail,
    subject: `Konfirmasi Order ${order.invoiceNumber} — DM Plus`,
    html: `
      <h2>Terima kasih, order kamu sudah kami terima!</h2>
      <p>Invoice <b>${order.invoiceNumber}</b> untuk paket <b>${service.name}</b>.</p>

      <table style="border-collapse:collapse;width:100%;margin:16px 0;">
        <tr style="background:#f6f3ea;">
          <td style="padding:10px 14px;font-weight:bold;">Total Pembayaran</td>
          <td style="padding:10px 14px;text-align:right;color:#2d6a4f;font-weight:bold;">${formatRupiah(order.totalAmount)}</td>
        </tr>
        <tr>
          <td style="padding:10px 14px;color:#555;" colspan="2">
            Pembayaran penuh (100%) — pengerjaan dimulai setelah pembayaran dikonfirmasi.
          </td>
        </tr>
      </table>

      ${paymentSection}

      <p style="font-size:13px;color:#888;margin-top:16px;">Simpan email ini sebagai referensi pembayaran kamu.</p>
    `,
  });
}

// Dikirim saat pembayaran berhasil dikonfirmasi
async function notifyPaymentConfirmed(order, payment, service) {
  await sendMail({
    to: order.customerEmail,
    subject: `Pembayaran Dikonfirmasi — ${order.invoiceNumber}`,
    html: `
      <h2>✅ Pembayaran berhasil dikonfirmasi!</h2>
      <p>Invoice <b>${order.invoiceNumber}</b> · Paket <b>${service.name}</b></p>

      <table style="border-collapse:collapse;width:100%;margin:16px 0;">
        <tr style="background:#f6f3ea;">
          <td style="padding:10px 14px;font-weight:bold;">Total Pembayaran</td>
          <td style="padding:10px 14px;text-align:right;color:#2d6a4f;font-weight:bold;">${formatRupiah(payment.amount)}</td>
        </tr>
        <tr>
          <td style="padding:10px 14px;" colspan="2">Status: <b style="color:#2d6a4f;">✅ Lunas</b></td>
        </tr>
      </table>

      <p>🎉 Pembayaran kamu sudah kami terima. Tim kami akan segera memulai pengerjaan website kamu!</p>

      <p>
        <a href="${statusUrl(order.invoiceNumber)}"
           style="display:inline-block;background:#1a3c34;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;">
          📋 Lihat Status Order
        </a>
      </p>

      <p style="font-size:13px;color:#888;margin-top:16px;">Simpan email ini sebagai bukti pembayaran kamu.</p>
    `,
  });

  const adminEmail = process.env.NOTIFY_ADMIN_EMAIL;
  if (adminEmail) {
    await sendMail({
      to: adminEmail,
      subject: `[Admin] Pembayaran dikonfirmasi — ${order.invoiceNumber}`,
      html: `<p>Pembayaran untuk order ${order.invoiceNumber} (${service.name}) sebesar ${formatRupiah(payment.amount)} sudah dikonfirmasi.</p>`,
    });
  }
}

// Dikirim ke customer saat order dibatalkan admin
async function notifyOrderCancelled(order, service, reason) {
  await sendMail({
    to: order.customerEmail,
    subject: `Order Dibatalkan — ${order.invoiceNumber}`,
    html: `
      <h2>Order kamu telah dibatalkan</h2>
      <p>Invoice <b>${order.invoiceNumber}</b> · Paket <b>${service.name}</b></p>
      <p>Status order ini sekarang <b style="color:#b3261e;">CANCELLED</b>.</p>
      ${reason ? `<p><b>Keterangan:</b> ${reason}</p>` : ""}
      <p>Kalau order ini sudah dibayar, tim kami akan menghubungi kamu terkait proses refund.</p>
      <p style="font-size:13px;color:#888;margin-top:16px;">Ada pertanyaan? Balas email ini atau hubungi kami via WhatsApp.</p>
    `,
  });

  const adminEmail = process.env.NOTIFY_ADMIN_EMAIL;
  if (adminEmail) {
    await sendMail({
      to: adminEmail,
      subject: `[Admin] Order dibatalkan — ${order.invoiceNumber}`,
      html: `<p>Order ${order.invoiceNumber} (${service.name}) telah dibatalkan.${reason ? ` Alasan: ${reason}` : ""}</p>`,
    });
  }
}

module.exports = {
  sendMail,
  notifyAdminNewOrder,
  notifyCustomerOrderCreated,
  notifyPaymentConfirmed,
  notifyOrderCancelled,
};
