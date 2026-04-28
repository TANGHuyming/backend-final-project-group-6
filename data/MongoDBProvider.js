const mongoose = require("mongoose");
const crypto = require("crypto");
const { GridFSBucket } = require("mongodb");
const bcryptjs = require("bcryptjs");
const DatabaseProvider = require("./databaseProvider");
const config = require("../config/app.config");

const User = require("./models/mongoUserModel");
const Item = require("./models/mongoItemsModel");
const ItemHistory = require("./models/mongoItemHistoriesModel");
const ApiKey = require("./models/mongoAPIkeysModel");
// const Category = require("./models/mongoCategoryModel");

class MongoProvider extends DatabaseProvider {
  constructor() {
    super();
    this.providerKey = "mongodb";
    this.providerLabel = "MongoDB";
    this.bucket = null;
  }

  async connect() {
    const uri = config.MONGO_URI;

    if (!uri) {
      throw new Error("Missing MONGO_URI");
    }

    try {
      await mongoose.connect(uri, {
        dbName: "inventory_db",
      });

      // GridFS bucket
      this.itemsBucket = new GridFSBucket(mongoose.connection.db, {
        bucketName: "items",
      });

      this.docsBucket = new GridFSBucket(mongoose.connection.db, {
        bucketName: "docs",
      });

      await this.initializeDatabase();
      console.log("Connected to MongoDB:", mongoose.connection.name);
    } catch (error) {
      console.error("MongoDB connection error:", error);
      throw error;
    }
  }

  async initializeDatabase() {
    await Promise.all([
      User.init(),
      Item.init(),
      ItemHistory.init(),
      ApiKey.init(),
      // Category.init()
    ]);

    console.log("MongoDB initialized");
  }

  normalizeEmail(email) {
    return String(email).trim().toLowerCase();
  }

  mapUser(user) {
    if (!user) return null;

    return {
      id: user._id.toString(),
      email: user.email,
      name: user.name,
      role: user.role,
      status: user.status,
      createdAt: user.createdAt,
      passwordHash: user.passwordHash,
      disabledAt: user.disabledAt,
    };
  }

  mapItem(item) {
    if (!item) return null;

    return {
      id: item._id.toString(),
      name: item.name,
      serial: item.serial,
      model: item.model,
      brand: item.brand,
      category: item.category,
      subCategory: item.subCategory,
      status: item.status,
      description: item.description,
      dateAcquired: item.dateAcquired,
      currentOwner: item.currentOwner,
      imageName: item.imageName,
      imageAlt: item.imageAlt,
    };
  }

  // Helper to keep the data format consistent (id vs _id)
  mapApiKey(key) {
    return {
      id: key._id.toString(),
      hashedKey: key.hashedKey,
      name: key.name,
      userId: key.userId.toString(),
      createdAt: key.createdAt,
      revoked: key.revoked,
    };
  }

  mapItemHistory(history) {
    if (!history) return null;

    return {
      id: String(history._id),
      itemId: String(history.itemId),
      userId: String(history.userId),
      action: history.action, // checkout / checkin
      duration: history.duration || null,
      referenceLink: history.referenceLink || null,
      createdAt: history.createdAt,
      returnedAt: history.returnedAt,
    };
  }

  mapCategory(category) {
    if (!category) return null;

    return {
      id: String(category._id),
      name: category.name,
      parentId: String(category.parentId) || null,
    };
  }

  getImageStream(imageName) {
    return this.itemsBucket.openDownloadStream(
      new mongoose.Types.ObjectId(imageName),
    );
  }

  getDocumentStream(imageName) {
    return this.docsBucket.openDownloadStream(
      new mongoose.Types.ObjectId(imageName),
    );
  }

  getImageUrl(imageName) {
    if (!imageName) return null;

    return `${config.BASE_URL}/api/files/items/${imageName}`;
  }

  getDocumentUrl(imageName) {
    if (!imageName) return null;

    return `${config.BASE_URL}/api/files/docs/${imageName}`;
  }

  async getFile(bucket, id) {
    const valid = mongoose.Types.ObjectId.isValid(id);
    if (!valid) return null;

    let gridBucket;

    if (bucket === "items") {
      gridBucket = this.itemsBucket;
    } else if (bucket === "docs") {
      gridBucket = this.docsBucket;
    } else {
      return null;
    }

    const file = await mongoose.connection.db
      .collection(`${bucket}.files`)
      .findOne({ _id: new mongoose.Types.ObjectId(id) });

    if (!file) return null;

    const stream = gridBucket.openDownloadStream(
      new mongoose.Types.ObjectId(id),
    );

    return {
      type: "stream",
      data: stream,
      contentType:
        file.contentType ||
        file.metadata?.contentType ||
        "application/octet-stream",
      filename: file.filename,
    };
  }

  // ===== USER =====
  async registerUser(email, password, name, role) {
    const existingAdmin = await User.findOne({
      role: "Admin",
      status: "Active",
    });
    let roleToAssign = existingAdmin ? "Technician" : "Admin";
    const normalizedEmail = this.normalizeEmail(email);

    const existing = await User.findOne({ email: normalizedEmail });
    if (existing) throw new Error("Email already exists");

    const salt = await bcryptjs.genSalt(10);
    const passwordHash = await bcryptjs.hash(password, salt);

    const user = await User.create({
      email: normalizedEmail,
      passwordHash: passwordHash,
      name: name,
      role: roleToAssign,
      status: "Active",
      disabledAt: null,
    });

    return this.mapUser(user.toObject());
  }

  async findUserByEmail(email) {
    const user = await User.findOne({
      email: this.normalizeEmail(email),
    }).lean();

    return this.mapUser(user);
  }

  async verifyPassword(password, hash) {
    return bcryptjs.compare(password, hash);
  }

  async getUserById(id) {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return null; // or throw new Error("Invalid user id");
    }

    const user = await User.findById(id).lean();
    return this.mapUser(user);
  }

  async updateUser(userId, updates) {
    const user = await User.findByIdAndUpdate(userId, updates, { returnDocument: "after" });

    // business rule: revoke API keys
    if (user.status === "Disabled") {
      await ApiKey.updateMany({ adminId: userId }, { revoked: true });
    }

    return this.mapUser(user.toObject());
  }

  async revokeOwnedApiKeys(userId) {
    // for business rule to remove all owned by a disabled acc
    // await ApiKey.updateMany({ userId: userId }, { revoked: true });
    await ApiKey.deleteMany({ userId: userId }); // hard-delete
  }

  async getAllUsers() {
    const users = await User.find().lean();
    return users.map((u) => this.mapUser(u));
  }

  async hasActiveAdmin() {
    const admin = await User.findOne({
      role: "Admin",
      status: "Active",
    }).lean();

    return !!admin;
  }

  async findActiveAction(itemId, action) {
    const latest = await ItemHistory.findOne({ itemId })
      .sort({ createdAt: -1 })
      .lean();

    return latest?.action === action && latest?.returnedAt === null;
  }

  // ===== ITEMS =====
  async getItems() {
    const items = await Item.find().lean();
    return items.map((i) => ({
      ...this.mapItem(i),
      imageUrl: this.getImageUrl(i.imageName),
    }));
  }

  async getItemById(id) {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return null;
    }

    const item = await Item.findById(id).lean();
    if (!item) return null;

    return {
      ...this.mapItem(item),
      imageUrl: this.getImageUrl(item.imageName),
    };
  }

  async getItemsBySerial(serial) {
    const items = await Item.find({ serial }).lean();

    if (!items) return null;

    return items.map((i) => ({
      ...this.mapItem(i),
      imageUrl: this.getImageUrl(i.imageName),
    }));
  }

  async createItem(data) {
    const item = await Item.create(data);
    return this.mapItem(item.toObject());
  }

  async updateItem(id, data) {
    const item = await Item.findByIdAndUpdate(id, data, { returnDocument: "after" }).lean();
    return this.mapItem(item);
  }

  // ===== HISTORY =====
  async getItemHistories() {
    const histories = await ItemHistory.find().sort({ createdAt: -1 }).lean();

    return histories.map((h) => this.mapItemHistory(h));
  }

  async getItemHistoryByItemId(itemId) {
    const histories = await ItemHistory.find({ itemId: itemId })
      .sort({ createdAt: -1 })
      .lean();

    return histories.map((h) => this.mapItemHistory(h));
  }

  async addItemHistory(itemId, data) {
    const history = await ItemHistory.create({
      itemId: itemId,
      userId: data.userId,
      action: data.action,
      duration: data.duration ?? null,
      referenceLink: data.referenceLink ?? null,
      createdAt: new Date(),
      returnedAt: data.returnedAt ?? null,
    });

    return this.mapItemHistory(history.toObject());
  }

  async getUserHistory(userId) {
    const histories = await ItemHistory.find({ userId })
      .populate("itemId")
      .sort({ createdAt: -1 })
      .lean();

    return histories.map((r) => ({
      id: r._id.toString(),
      userId: r.userId.toString(),
      itemId: r.itemId._id.toString(),
      action: r.action,
      duration: r.duration,
      createdAt: r.createdAt,
      referenceLink: r.referenceLink ?? null,

      item: r.itemId
        ? {
            id: r.itemId._id.toString(),
            name: r.itemId.name,
            serial: r.itemId.serial,
            model: r.itemId.model,
            brand: r.itemId.brand,
            category: r.itemId.category,
            subCategory: r.itemId.subCategory,
            status: r.itemId.status,
            description: r.itemId.description,
            dateAcquired: r.itemId.dateAcquired,
            imageAlt: r.itemId.imageAlt,
            imageUrl: this.getImageUrl(r.itemId.imageName),
          }
        : null,
    }));
  }

  // break apart later
  async updateUserItem(itemId, targetUserId, adminId, action, options = {}) {
    const item = await Item.findById(itemId);
    if (!item) throw new Error("Item not found");

    const admin = await User.findById(adminId);
    if (!admin || admin.role !== "Admin") {
      throw new Error("Unauthorized");
    }

    if (!["checkout", "checkin"].includes(action)) {
      throw new Error("Invalid action");
    }

    if (action === "checkout") {
      const existing = await ItemHistory.findOne({
        itemId,
        returnedAt: null,
      });

      if (existing) {
        if (existing.userId.toString() === targetUserId.toString()) {
          throw new Error("User already owns this item");
        }
        throw new Error("Item is already checked out");
      }
    }

    const history = await ItemHistory.create({
      itemId,
      userId: targetUserId,
      action,
      duration: options.duration ?? null,
      referenceLink: options.referenceLink ?? null,
      returnedAt: action === "checkin" ? new Date() : null,
    });

    await this.setItemStatus(
      itemId,
      action === "checkout" ? "In-Use" : "Available",
    );

    return history.toObject();
  }

  // =========================
  // API KEYS
  // =========================

  async createApiKey(userId, data) {
    // generate the raw random key
    const rawKey = crypto.randomBytes(32).toString("hex");

    // hash the key for secure storage (Requirement 4.3)
    const salt = await bcryptjs.genSalt(10);
    const hashedKey = await bcryptjs.hash(rawKey, salt);

    const apiKey = await ApiKey.create({
      hashedKey: hashedKey,
      name: data?.name || "Unnamed Key",
      userId: userId,
      revoked: false,
      createdAt: new Date(),
    });

    // return the rawKey so the service/controller can show it once
    const mappedKey = this.mapApiKey(apiKey.toObject());
    return { ...mappedKey, rawKey };
  }

  async getApiKeys() {
    const keys = await ApiKey.find().sort({ createdAt: -1 }).lean();
    return keys.map((key) => this.mapApiKey(key));
  }

  async verifyApiKey(key) {
    const apiKeys = await ApiKey.find({ revoked: false }).lean();

    for (const apiKey of apiKeys) {
        const match = await bcryptjs.compare(key, apiKey.hashedKey)
        if (match) {
            return this.mapApiKey(apiKey)
        }
    }

    return null;
  }

  // change this to find by the hashed version or just fetch all for service-side comparison
  async getApiKeyByHash(hashedKey) {
    const keyRecord = await ApiKey.findOne({
      hashedKey,
      revoked: false,
    }).lean();
    return keyRecord ? this.mapApiKey(keyRecord) : null;
  }

  async updateApiKey(id, updateData) {
    const updated = await ApiKey.findByIdAndUpdate(
      id,
      { $set: updateData },
      { returnDocument: "after" },
    ).lean();
    return updated ? this.mapApiKey(updated) : null;
  }

  // GRIDFS FILE UPLOAD
  async uploadItem(filename, buffer, mimeType) {
    return new Promise((resolve, reject) => {
      const uploadStream = this.itemsBucket.openUploadStream(filename, {
        metadata: {
          contentType: mimeType,
          originalName: filename,
        },
      });

      uploadStream.end(buffer);

      uploadStream.on("finish", () => {
        resolve(uploadStream.id.toString()); // store this in DB
      });

      uploadStream.on("error", reject);
    });
  }

  async uploadFile(filename, buffer, mimeType) {
    return new Promise((resolve, reject) => {
      const uploadStream = this.docsBucket.openUploadStream(filename, {
        metadata: {
          contentType: mimeType,
          originalName: filename,
        },
      });

      uploadStream.end(buffer);

      uploadStream.on("finish", () => {
        resolve(uploadStream.id.toString());
      });

      uploadStream.on("error", reject);
    });
  }

  async getAllCategories() {
    const categories = await Category.find().lean();

    return categories.map((c) => this.mapCategory(c));
  }

  async addCategory(name) {
    return await Category.create({
      name,
      parentId: null
    });
  }

  async addSubCategory(categoryId, name) {
    const parent = await Category.findById(categoryId);
    if (!parent) {
      throw new Error("Parent category not found");
    }

    return await Category.create({
      name,
      parentId: categoryId
    });
  }

  async deleteCategory(categoryId) {
    const category = await Category.findById(categoryId);

    if (!category) {
      throw new Error("Category not found");
    }

    const itemCount = await Item.countDocuments({
      category: category.name
    });

    if (itemCount > 0) {
      throw new Error("Cannot delete category with items");
    }

    await Category.deleteMany({ parentId: categoryId });

    return await Category.findByIdAndDelete(categoryId);
  }

  async updateSubCategory(subCategoryId, data) {
    const subCategory = await Category.findById(subCategoryId);
    if (!subCategory) {
      throw new Error("Subcategory not found");
    }

    const update = {};

    if (data.name) {
      update.name = data.name;
    }

    if (data.parentId) {
      const parent = await Category.findById(data.parentId);
      if (!parent) {
        throw new Error("New parent category not found");
      }

      update.parentId = data.parentId;
    }

    const updated = await Category.findByIdAndUpdate(
      subCategoryId,
      update,
      { new: true }
    ).lean();

    return this.mapCategory(updated);
  }
}

module.exports = MongoProvider;
