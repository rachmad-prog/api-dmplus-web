const prisma = require("../prisma");

// Satu-satunya tempat untuk membaca info rekening bank.
// SELALU baca dari database (BankSetting) — env hanya dipakai SEKALI sebagai nilai
// awal saat baris di database belum pernah dibuat sama sekali.
async function getBankInfo() {
  let row = await prisma.bankSetting.findFirst();
  if (!row) {
    row = await prisma.bankSetting.create({
      data: {
        bankName: process.env.BANK_NAME || null,
        accountNumber: process.env.BANK_ACCOUNT_NUMBER || null,
        accountHolder: process.env.BANK_ACCOUNT_HOLDER || null,
      },
    });
  }
  return {
    bankName: row.bankName,
    accountNumber: row.accountNumber,
    accountHolder: row.accountHolder,
  };
}

module.exports = { getBankInfo };
