// Membungkus route handler async agar error/reject di dalamnya otomatis
// diteruskan ke error-handling middleware Express (app.use((err, req, res, next) => ...)),
// bukan jadi "unhandled promise rejection" yang bisa mematikan seluruh proses Node.js.
//
// Pemakaian:
//   router.get("/", asyncHandler(async (req, res) => { ... }));
function asyncHandler(fn) {
  return function (req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = asyncHandler;
