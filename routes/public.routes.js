const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/authMiddleware");

const publicController = require("../controllers/public.controller");
const adminController = require("../controllers/admin.controller"); // it's weird ik... but its the easiest way around it
const keyController = require("../controllers/key.controller");
const { requireRole } = require("../middleware/roleCheck");


// Home (need design with frontend)
router.get("/", protect, publicController.home);
router.get("/home", protect, publicController.home);

// CRUD (missing integration)
router.get("/items", protect, publicController.showItems);
router.get("/items/:id", protect, publicController.showItemDetail);
router.get("/items/:id/history", protect, publicController.showItemHistory);

// router.post("/items", protect, publicController.addItem); // comment out to use api post
// router.put("/items/:id", protect, publicController.editItem); // comment out to use api put
// router.delete("/items/:id", protect,requireRole("Admin"), publicController.deleteItem); // comment out to use api delete

// Owned (should done but a little empty)
router.get("/owned", protect, publicController.showOwned);

// Report (missing implementation with frontend)    ------------------------- finish later
router.get("/report", protect, publicController.report);

// Check in/out (shoud be working)
router.post("/transactions/checkin", protect, publicController.checkIn);
router.post("/transactions/checkout", protect, publicController.checkOut);

router.post("/transactions/adminCheckout", protect,requireRole("Admin"), publicController.adminCheckout);
// router.post("/transactions/adminCheckin", protect,requireRole("Admin"), publicController.adminCheckin);

router.get('/logs', protect, publicController.logs);

// ===== Admin-only Routes =====
// == user-management ==
router.get("/users", protect, requireRole("Admin"), adminController.listUsers); // <------------ kinda weird... i think it's easier to just require "Admin role" instead of moving to Admin
router.post(
  "/users/:id/role",
  protect,
  requireRole("Admin"),
  adminController.changeRole,
); // <-- or post here if want since it don't matter
router.post(
  "/users/:id/status",
  protect,
  requireRole("Admin"),
  adminController.toggleStatus,
); // disable/enable user

// == keys-management ==
router.get(
  "/keys",
  protect,
  requireRole("Admin"),
  keyController.renderKeyManagement,
);

// Actions
router.post(
  "/keys/generate",
  protect,
  requireRole("Admin"),
  keyController.handleGenerateKey,
);
router.post(
  "/keys/revoke/:id",
  protect,
  requireRole("Admin"),
  keyController.handleRevokeKey,
);

// autorender can go down here if want to add later

// error 404
router.use(publicController.notFound);

module.exports = router;
