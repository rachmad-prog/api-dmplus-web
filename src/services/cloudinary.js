const cloudinary = require("cloudinary").v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Upload buffer file (dari multer memoryStorage) ke Cloudinary.
// Dipakai untuk bukti transfer manual — bukan disimpan ke disk lokal karena
// di Vercel serverless tidak ada disk yang persisten antar-request.
//
// Catatan keamanan: file di-upload dengan public_id acak & sulit ditebak
// (bukan berdasarkan invoice/nama), jadi URL-nya tidak publik ter-index di
// mana pun tapi tetap bisa diakses siapa saja yang tahu link-nya. Untuk data
// yang lebih sensitif dari ini, pertimbangkan upgrade ke Cloudinary signed
// URL (type: "authenticated" + signed delivery) di iterasi berikutnya.
function uploadBuffer(buffer, { folder, publicIdPrefix }) {
  const crypto = require("crypto");
  const randomSuffix = crypto.randomBytes(8).toString("hex");
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder,
        public_id: `${publicIdPrefix}-${Date.now()}-${randomSuffix}`,
        resource_type: "image",
      },
      (err, result) => {
        if (err) return reject(err);
        resolve(result);
      }
    );
    stream.end(buffer);
  });
}

function isConfigured() {
  return Boolean(
    process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET
  );
}

module.exports = { cloudinary, uploadBuffer, isConfigured };
