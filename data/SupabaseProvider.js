const bcryptjs = require("bcryptjs");
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");
const DatabaseProvider = require("./databaseProvider");
const {
  SUPABASE_TABLES,
  mapUserRowToModel,
  mapItemRowToModel,
  mapItemHistoryRowToModel,
  mapApiKeyRowToModel,
} = require("./models/supabaseModels");

class SupabaseProvider extends DatabaseProvider {
  constructor() {
    super();
    this.providerKey = "supabase";
    this.providerLabel = "Supabase";
    this.supabase = null;
  }

  async connect() {
    const url = process.env.SUPABASE_URL;
    const key =
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_KEY ||
      process.env.SUPABASE_ANON_KEY;

    if (!url || !key) {
      throw new Error(
        "Missing required environment variables: SUPABASE_URL and one of SUPABASE_SERVICE_ROLE_KEY, SUPABASE_KEY, SUPABASE_ANON_KEY"
      );
    }

    try {
      this.supabase = createClient(url, key);

      // Test connection and initialize database
      await this.initializeDatabase();
      console.log("Connected to Supabase");
    } catch (error) {
      console.error("Supabase connection error:", error);
      throw error;
    }
  }

  normalizeEmail(email) {
    return String(email).trim().toLowerCase();
  }

  toSupabaseId(value) {
    if (typeof value === "number") {
      return value;
    }

    const asString = String(value).trim();
    if (/^\d+$/.test(asString)) {
      return Number(asString);
    }

    return asString;
  }

  getImageUrl(filePath) {
    if (!filePath) return null;

    const { data } = this.supabase.storage
      .from("items-bucket")
      .getPublicUrl(filePath);

    return data.publicUrl;
  }

  getReferenceUrl(filePath) {
    if (!filePath) return null;

    const { data } = this.supabase.storage
      .from("docs-bucket")
      .getPublicUrl(filePath);

    return data.publicUrl;
  }

  getLatestHistoryMap(histories) {
    const map = new Map();

    for (const h of histories) {
      const key = h.itemId.toString();

      if (!map.has(key)) {
        map.set(key, h); 
      }
    }

    return map;
  }

  async initializeDatabase() {
    // USERS
    const { error: userError } = await this.supabase
      .from(SUPABASE_TABLES.USERS)
      .select("id")
      .limit(1);

    if (userError) throw new Error("Users table missing or not accessible");

    // ITEMS
    const { error: itemError } = await this.supabase
      .from(SUPABASE_TABLES.ITEMS)
      .select("id")
      .limit(1);

    if (itemError) throw new Error("Items table missing or not accessible");

    // ITEM HISTORY
    const { error: historyError } = await this.supabase
      .from(SUPABASE_TABLES.ITEM_HISTORIES)
      .select("id")
      .limit(1);

    if (historyError) throw new Error("Item histories table missing");

    // API KEYS
    const { error: apiError } = await this.supabase
      .from(SUPABASE_TABLES.API_KEYS)
      .select("id")
      .limit(1);
  }
  
	async getFile(bucket, id) {
		if (!id) return null;

		let targetBucket;

		if (bucket === "items") {
			targetBucket = "items-bucket";
		} else if (bucket === "docs") {
			targetBucket = "docs-bucket";
		} else {
			return null;
		}

		const { data } = this.supabase.storage
			.from(targetBucket)
			.getPublicUrl(id);

		if (!data?.publicUrl) return null;

		return {
			type: "url",
			data: data.publicUrl
		};
	}

  // ===== USER =====
  async registerUser(email, password, name, role) {
    const normalizedEmail = this.normalizeEmail(email);

    const { data: existingUser } = await this.supabase
      .from(SUPABASE_TABLES.USERS)
      .select("id")
      .eq("email", normalizedEmail)
      .maybeSingle();

    if (existingUser) {
      throw new Error("Email already exists");
    }

    const salt = await bcryptjs.genSalt(10);
    const passwordHash = await bcryptjs.hash(password, salt);

    const { data, error } = await this.supabase
      .from(SUPABASE_TABLES.USERS)
      .insert([{
        email: normalizedEmail,
        passwordHash: passwordHash,
        name: name,
        role: role,
        status: "Active",
        disabledAt: null,
      }])
      .select("id, email, name, role, status, createdAt, disabledAt")
      .single();

    if (error) throw error;

    return mapUserRowToModel(data);
  }

  async findUserByEmail(email) {
    const normalizedEmail = this.normalizeEmail(email);

    const { data, error } = await this.supabase
      .from(SUPABASE_TABLES.USERS)
      .select("*")
      .eq("email", normalizedEmail)
      .maybeSingle();

    if (error) throw error;
    if (!data) return null;

    return mapUserRowToModel(data);
  }

  async verifyPassword(password, hash) {
    return await bcryptjs.compare(password, hash);
  }

  async getUserById(userId) {
    const normalizedUserId = this.toSupabaseId(userId);

    const { data, error } = await this.supabase
      .from(SUPABASE_TABLES.USERS)
      .select("id, email")
      .eq("id", normalizedUserId)
      .single();

    if (error && error.code === "PGRST116") {
      return null;
    }

    if (error) {
      throw error;
    }

    return mapUserRowToModel(data);
  }

  async updateUser(userId, updates) {
    const normalizedUserId = this.toSupabaseId(userId);

    const { data, error } = await this.supabase
      .from(SUPABASE_TABLES.USERS)
      .update(updates)
      .eq("id", normalizedUserId)
      .select("*")
      .single();

    if (error) throw error;

    return mapUserRowToModel(data);
  }

  async revokeOwnedApiKeys(userId) {
    const normalizedUserId = this.toSupabaseId(userId);

    const { error } = await this.supabase
      .from(SUPABASE_TABLES.API_KEYS)
      .update({ revoked: true })
      .eq("adminId", normalizedUserId);

    if (error) throw error;
  }

  async getAllUsers() {
    const { data, error } = await this.supabase
      .from(SUPABASE_TABLES.USERS)
      .select("*");

    if (error) throw error;

    return data.map(mapUserRowToModel);
  }

  async hasActiveAdmin() {
    const { data, error } = await this.supabase
      .from("users")
      .select("id")
      .eq("role", "Admin")
      .eq("status", "Active")
      .limit(1)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return !!data;
  }

  async findActiveAction(itemId, action) {
    const normalizedId = this.toSupabaseId(itemId);

    const { data, error } = await this.supabase
      .from(SUPABASE_TABLES.ITEM_HISTORIES)
      .select("*")
      .eq("itemId", normalizedId)
      .eq("action", action)
      .order("createdAt", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;

    return data ? mapItemHistoryRowToModel(data) : null;
  }


  // ===== ITEMS =====
  async getItems() {
    const { data, error } = await this.supabase
      .from(SUPABASE_TABLES.ITEMS)
      .select("*");

    if (error) {
      throw error;
    }

    return data.map((item) => {
      const mapped = mapItemRowToModel(item);

      return {
        ...mapped,
        imageUrl: this.getImageUrl(item.imageName),
      };
    });
  }

  async getItemById(id) {
    const normalizedId = this.toSupabaseId(id);

    const { data, error } = await this.supabase
      .from(SUPABASE_TABLES.ITEMS)
      .select("*")
      .eq("id", normalizedId)
      .single();

    if (error && error.code === "PGRST116") {
      return null;
    }

    if (error) {
      throw error;
    }

    const mapped = mapItemRowToModel(data);

    return {
      ...mapped,
      imageUrl: this.getImageUrl(data.imageName),
    };
  }

  async getItemsBySerial(serial) {
    const { data, error } = await this.supabase
      .from(SUPABASE_TABLES.ITEMS)
      .select("*")
      .eq("serial", serial)
      .maybeSingle();

    if (error) throw error;

    if (!data) return null;

    const mapped = mapItemRowToModel(data);

    return {
      ...mapped,
      imageUrl: this.getImageUrl(data.imageName),
    };
  }

  async createItem(data) {
    const { data: inserted, error } = await this.supabase
      .from(SUPABASE_TABLES.ITEMS)
      .insert([data])
      .select()
      .single();

    if (error) {
      throw error;
    }

    return {
      ...mapItemRowToModel(inserted),
      imageUrl: this.getImageUrl(inserted.imageName),
    };
  }

  async updateItem(id, updates) {
    const normalizedId = this.toSupabaseId(id);

    const { data, error } = await this.supabase
      .from(SUPABASE_TABLES.ITEMS)
      .update(updates)
      .eq("id", normalizedId)
      .select()
      .single();

    if (error) throw error;

    return mapItemRowToModel(data);
  }

  // ===== HISTORY =====
  async getItemHistories() {
    const { data, error } = await this.supabase
      .from(SUPABASE_TABLES.ITEM_HISTORIES)
      .select("*")
      .order("createdAt", { ascending: false });

    if (error) throw error;

    return data.map(row => ({
      ...mapItemHistoryRowToModel(row),
      referenceUrl: this.getReferenceUrl(row.referenceLink)
    }));
  }
  async getItemHistoryByItemId(itemId) {
    const normalizedId = this.toSupabaseId(itemId);

    const { data, error } = await this.supabase
      .from(SUPABASE_TABLES.ITEM_HISTORIES)
      .select("*")
      .eq("itemId", normalizedId)
      .order("createdAt", { ascending: false });

    if (error) throw error;

    return data.map(row => ({
      ...mapItemHistoryRowToModel(row),
      referenceUrl: this.getReferenceUrl(row.referenceLink)
    }));
  }

  async addItemHistory(itemId, data) {
    const payload = {
      itemId: this.toSupabaseId(itemId),
      userId: this.toSupabaseId(data.userId),
      action: data.action,
      duration: data.duration,
      referenceLink: data.referenceLink ?? null,
      createdAt: new Date()
    };

    const { data: inserted, error } = await this.supabase
      .from(SUPABASE_TABLES.ITEM_HISTORIES)
      .insert([payload])
      .select()
      .single();

    if (error) throw error;

    return mapItemHistoryRowToModel(inserted);
  }

  // async getUserHistory(userId) {
  //   const normalizedUserId = this.toSupabaseId(userId);

  //   const { data, error } = await this.supabase
  //     .from(SUPABASE_TABLES.ITEMS)
  //     .select(`
	// 		id,
	// 		name,
	// 		serial,
	// 		model,
	// 		brand,
	// 		category,
	// 		subCategory,
	// 		status,
	// 		description,
	// 		dateAcquired,
	// 		imageAlt,
	// 		imageName,
	// 		item_histories (
	// 			id,
	// 			userId,
	// 			itemId,
	// 			action,
	// 			duration,
	// 			createdAt,
	// 			referenceLink
	// 		)
	// 		`)
  //     .eq("currentOwner", normalizedUserId)
  //     .order("createdAt", {
  //       foreignTable: "item_histories",
  //       ascending: false,
  //     });

  //   if (error) throw error;

  //   return data.map(item => {
  //     // item_histories is already sorted desc (latest first)
  //     const latestHistory = item.item_histories?.[0] || null;

  //     return {
  //       id: item.id,

  //       item: {
  //         ...mapItemRowToModel(item),
  //         imageUrl: this.getImageUrl(item.imageName),
  //       },

  //       lastHistory: latestHistory
  //         ? mapItemHistoryRowToModel(latestHistory)
  //         : null,
  //     };
  //   });
  // }

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
      referenceUrl: r.referenceLink ?? null,

      item: r.itemId
        ? {
            id: r.itemId._id.toString(),
            name: r.itemId.name,
            serial: r.itemId.serial,
            model: r.itemId.model,
            brand: r.itemId.brand,
            category: r.itemId.category,
            sub_category: r.itemId.subCategory,
            status: r.itemId.status,
            description: r.itemId.description,
            dateAcquired: r.itemId.dateAcquired,
            imageAlt: r.itemId.imageAlt,
            imageUrl: this.getImageUrl(r.itemId.imageName),
          }
        : null,
    }));
  }


  async updateUserItem(itemId, newUserId, adminId, options = {}) {
    const normalizedItemId = this.toSupabaseId(itemId);
    const normalizedNewUserId = this.toSupabaseId(newUserId);
    const normalizedAdminId = this.toSupabaseId(adminId);

    // 1. check admin
    const admin = await this.getUserById(normalizedAdminId);
    if (!admin || admin.role !== "Admin") {
      throw new Error("Unauthorized");
    }

    // 2. check item exists
    const item = await this.getItemById(normalizedItemId);
    if (!item) {
      throw new Error("Item not found");
    }

    // 3. get active checkout (SOURCE OF TRUTH)
    const { data: existing, error: fetchError } = await this.supabase
      .from(SUPABASE_TABLES.ITEM_HISTORIES)
      .select("*")
      .eq("itemId", normalizedItemId)
      .is("returned_at", null)
      .maybeSingle();

    if (fetchError) throw fetchError;

    // 4. already owned by same user
    if (existing && existing.userId === normalizedNewUserId) {
      throw new Error("User already owns this item");
    }

    // 5. owned by someone else
    if (existing && existing.userId !== normalizedNewUserId) {
      throw new Error("Item is already owned by another user");
    }

    // 6. close previous ownership (safe transfer)
    if (existing) {
      await this.supabase
        .from(SUPABASE_TABLES.ITEM_HISTORIES)
        .update({
          returned_at: new Date(),
        })
        .eq("id", existing.id);
    }

    // 7. create new checkout record
    const { data, error } = await this.supabase
      .from(SUPABASE_TABLES.ITEM_HISTORIES)
      .insert([
        {
          itemId: normalizedItemId,
          userId: normalizedNewUserId,
          action: "checkout",
          reference_link: options.referenceLink ?? null,
          createdAt: new Date(),
          returned_at: null,
        },
      ])
      .select()
      .single();

    if (error) throw error;

    return this.mapItemHistoryRowToModel(data);
  }

  // ===== APIKEYS =====
  async createApiKey(adminId, data) {
    const keyValue = crypto.randomBytes(32).toString("hex");

    // hash the key for secure storage (Requirement 4.3)
    const salt = await bcryptjs.genSalt(10);
    const hashedKey = await bcryptjs.hash(keyValue, salt);

    const { data: inserted, error } = await this.supabase
      .from("api_keys")
      .insert([
        {
          hashedKey: hashedKey,
          name: data?.name ?? null,
          userId: adminId,
          revoked: false,
          createdAt: new Date(),
        },
      ])
      .select()
      .single();

    if (error) throw error;

    return mapApiKeyRowToModel(inserted);
  }

  async getApiKeys() {
    const { data, error } = await this.supabase
      .from("api_keys")
      .select("*")
      .order("createdAt", { ascending: false });

    if (error) throw error;

    return data.map(mapApiKeyRowToModel);
  }

  async getApiKeyByKey(hashedKey) {
    const { data, error } = await this.supabase
      .from(SUPABASE_TABLES.API_KEYS)
      .select("*")
      .eq("hashedKey", hashedKey)
      .eq("revoked", false)
      .maybeSingle();

    if (error) throw error;

    return data ? mapApiKeyRowToModel(data) : null;
  }

  async revokeApiKey(adminId, id) {
    const admin = await this.getUserById(adminId);

    if (!admin || admin.role !== "Admin") {
      throw new Error("Only admins can revoke keys");
    }

    const { data, error } = await this.supabase
      .from("api_keys")
      .update({ revoked: true })
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;

    return mapApiKeyRowToModel(data);
  }

  async uploadFile(filename, buffer, mimeType) {
    const { error } = await this.supabase.storage
      .from("docs-bucket")
      .upload(filename, buffer);

    if (error) {
      throw new Error(`Upload failed: ${error.message}`);
    }

    return path;
  }

  async uploadItem(filename, buffer, mimeType) {
    const { error } = await this.supabase.storage
      .from("items-bucket")
      .upload(filename, buffer);

    if (error) {
      throw new Error(`Image upload failed: ${error.message}`);
    }

    return path;
  }
}

module.exports = SupabaseProvider;
