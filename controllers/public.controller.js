"use strict"; // for debugging

const multiparty = require("multiparty");
const fs = require("fs");
const path = require("path");
const { verifyToken } = require("../middleware/authMiddleware");
const { items, itemHistories, users, dashboardData } = require("../data/data");
const { getDbProvider } = require("../utils/dbProviderShared");
const itemService = require("../services/itemService"); 
const userService = require("../services/userService");
const adminService = require("../services/adminService");  
const { db } = require("../data/models/mongoUserModel");
const config = require("../config/app.config");

// GET: /HOME ---------------------------------------------- need to fix later
exports.home = async (req, res, next) => {
  try {
    const currentUserId = req.user.id;
    const db = getDbProvider();

    const [users, items, histories] = await Promise.all([
      userService.getAllUsers(),
      itemService.getDBItems(),
      itemService.getDBItemsHistory(),
    ]);

    // lookup maps
    const userMap = new Map(users.map((u) => [u.id, u]));
    const itemMap = new Map(items.map((i) => [i.id, i]));

    const sortedHistories = [...histories].sort(
      (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
    );

    const userHistories = sortedHistories.filter(
      (h) => h.userId?.toString() === currentUserId.toString()
    );

    const ownedItems = await itemService.getUserOwnedItems(currentUserId);

    // counts
    let overdueCount = 0;
    let activeCount = 0;

    for (const row of ownedItems) {
      const created = row.createdAt ? new Date(row.createdAt) : null;
      if (!created) continue;

      if (row.duration) {
        const due = new Date(created);
        due.setHours(due.getHours() + row.duration);

        if (new Date() > due) overdueCount++;
        else activeCount++;
      } else {
        activeCount++;
      }
    }

    const totalOwned = ownedItems.length;

    // recent transactions
    const recentTransactions = userHistories.map((h) => {
      const created = h.createdAt ? new Date(h.createdAt) : null;

      let status = "unknown";

      if (h.action === "checkin" || h.returnedAt) {
        status = "returned";
      } else if (h.duration && h.createdAt) {
        const due = new Date(h.createdAt);
        due.setHours(due.getHours() + h.duration);
        status = new Date() > due ? "overdue" : "active";
      } else {
        status = "active";
      }

      return {
        id: h.id,
        user: req.user.name,
        item: itemMap.get(h.itemId?.toString())?.name || "Unknown",

        date: created
          ? created.toISOString().split("T")[0]
          : null,

        type: h.action === "checkout" ? "Checkout" : "Checkin",
        status,
      };
    });

    // RENDER
    res.render("home", {
      dashboardData: {
        totalOwned,
        activeCount,
        overdueCount,
        recentTransactions,
      },
      pageTitle: "Home",
    });

  } catch (err) {
    next(err);
  }
};

// DONT DELETE THIS
// GET: /items ----------------
// exports.showItems = async (req, res, next) => {
//   const { cat, q, subcat, isRetired, error, success } = req.query;
//   let page = req.query.page;
//   const pageSize = 12; // items to show per page

//   try {
//     let { items, categories } = await itemService.getDBFilteredItems({
//       cat, 
//       subcat, 
//       q, 
//       isRetired
//     });

//     // append query parameters to URL
//     let url = "/items?";

//     if (subcat) url += `subcat=${subcat}&`;
//     if (cat) url += `cat=${cat}&`;
//     if (q) url += `q=${q}&`;
//     if (isRetired) url += `isRetired=${isRetired}&`;
//     if (error) url += `error=${error}&`;
//     if (success) url += `success=${success}&`;

//     // append page number to URL
//     if (!page) {
//       url += `page=1`;
//       return res.redirect(url);
//     }

//     page = parseInt(page);

//     // calculate total pages
//     const total = items.length;
//     const totalPages = Math.ceil(total / pageSize);
//     const totalPagesArray = Array.from({ length: totalPages }, (_, i) => i + 1);

//     // set page range
//     const start = (page - 1) * pageSize;
//     const end = start + pageSize;
//     items = items.slice(start, end);

//     // pagination
//     const prevPage = page > 1 ? page - 1 : null;
//     const nextPage = page < totalPages ? page + 1 : null;

//     const pagesToRender = totalPagesArray.slice(
//       Math.max(0, page - 2),
//       Math.min(totalPages, page + 1)
//     );

//     const statuses = [
//       { name: "Available" },
//       { name: "Maintenance" },
//     ];

//     // for security's sake, please don't return the entire user object. The password hash is there
//     const exclude = ['email', 'passwordHash'];
//     const keyFilteredUser = Object.fromEntries(
//       Object.entries(req.user).filter(([key]) => !exclude.includes(key))
//     );

//     res.render("items/items", {
//       categories,
//       items,
//       statuses,
//       prevPage,
//       nextPage,
//       totalPages: pagesToRender,
//       currentPage: page,
//       user: keyFilteredUser || null,
//       error: error || null,
//       success: success || null,
//       pageTitle: "Items",
//     });
//   }
//   catch(err) {
//     next(err);
//   }
// };

// for if we have to use the API
exports.showItems = async (req, res, next) => {
  const { cat, q, subcat, isRetired, error, success } = req.query;
  let page = req.query.page;
  const pageSize = 12;

  try {
    // Call the API endpoint
    const apiBaseUrl = config.BASE_URL ? config.BASE_URL : `http://localhost:${process.env.PORT || 3000}`;
    const apiUrl = new URL('/api/items', apiBaseUrl);
    
    // Pass query parameters to API (only if they're defined)
    if (cat && cat !== 'undefined') apiUrl.searchParams.append('cat', cat);
    if (q && q !== 'undefined') apiUrl.searchParams.append('q', q);
    if (subcat && subcat !== 'undefined') apiUrl.searchParams.append('subcat', subcat);
    if (isRetired && isRetired !== 'undefined') apiUrl.searchParams.append('isRetired', isRetired);
    if (error && error !== 'undefined') apiUrl.searchParams.append('error', error);
    if (success && success !== 'undefined') apiUrl.searchParams.append('success', success);

    const apiResponse = await fetch(apiUrl.toString(), {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${req.cookies.accessToken}`
      }
    });

    if (!apiResponse.ok) {
      const errorData = await apiResponse.text();
      throw new Error(`API request failed (${apiResponse.status}): ${errorData}`);
    }
    
    const { categories, items: allItems } = await apiResponse.json();

    // Handle pagination (same as before)
    let url = "/items?";
    if (subcat && subcat !== 'undefined') url += `subcat=${subcat}&`;
    if (cat && cat !== 'undefined') url += `cat=${cat}&`;
    if (q && q !== 'undefined') url += `q=${q}&`;
    if (isRetired && isRetired !== 'undefined') url += `isRetired=${isRetired}&`;
    if (error && error !== 'undefined') url += `error=${error}&`;
    if (success && success !== 'undefined') url += `success=${success}&`;
    
    if (!page) {
      url += `page=1`;
      return res.redirect(url);
    }

    page = parseInt(page);
    const total = allItems.length;
    const totalPages = Math.ceil(total / pageSize);
    const start = (page - 1) * pageSize;
    const end = start + pageSize;
    const items = allItems.slice(start, end);

    // pagination
    const prevPage = page > 1 ? page - 1 : null;
    const nextPage = page < totalPages ? page + 1 : null;

    const pagesToRender = Array.from({ length: totalPages }, (_, i) => i + 1).slice(
      Math.max(0, page - 2),
      Math.min(totalPages, page + 1)
    );

    const statuses = [
      { name: "Available" },
      { name: "Maintenance" },
    ];

    // for security's sake, filter out sensitive user data
    const exclude = ['email', 'passwordHash'];
    const keyFilteredUser = req.user ? Object.fromEntries(
      Object.entries(req.user).filter(([key]) => !exclude.includes(key))
    ) : null;

    res.render("items/items", {
      categories,
      items,
      statuses,
      prevPage,
      nextPage,
      totalPages: pagesToRender,
      currentPage: page,
      user: keyFilteredUser,
      error: error && error !== 'undefined' ? error : null,
      success: success && success !== 'undefined' ? success : null,
      pageTitle: "Items",
    });
  } catch(err) {
    next(err);
  }
};

// DONT DELETE THIS
// exports.addItem = async (req, res, next) => {
//   try {
//     const {
//       filePath,
//       fileBuffer, 
//       fileName, 
//       mimeType,
//       name, 
//       description, 
//       brand, 
//       model, 
//       category, 
//       subCategory, 
//       serial, 
//       status, 
//       dateAcquired,
//       type,
//       redirect,
//     } = await itemService.processItemForm(req);

//     const statuses = [
//       { name: "Available" },
//       { name: "Maintenance" },
//     ];

//     // an error in form processing must've occured
//     if (type?.toLowerCase() === "error") {
//       return res.redirect(redirect);
//     }

//     const existing = await itemService.getDBItemBySerial(serial);

//     if (existing) {
//       return res.redirect("/items?error=Serial+already+exists");
//     }

//     if (
//       !name ||
//       !description ||
//       !brand ||
//       !model ||
//       !category ||
//       !serial ||
//       !status
//     ) {
//       return res.redirect("/items?error=Missing+required+fields");
//     }

//     if(!statuses.map(s => s.name).includes(status)) {
//       return res.redirect(`/api/items?error=Status+must+be+available+or+maintenance`);
//     }

//     const newItem = {
//       name,
//       description,
//       brand,
//       model,
//       category,
//       subCategory,
//       serial,
//       status,
//       dateAcquired,
//       imageName: filePath,
//       imageAlt: `Image of ${name}`,       // add 'imageAlt ||' later if img alt given 
//     };

//     await itemService.createDBItem(newItem);

//     return res.redirect("/items?success=Item+added+successfully");
//   }
//   catch (err) {
//     next(err);
//   }
// }

// DONT DELETE THIS
// exports.showItemDetail = async (req, res, next) => {
//   const { id } = req.params;
//   const { error, success } = req.query;

//   try {
//     let item = await itemService.getDBItemById(id);
//     const categories = await itemService.getCategoryFromDB();

//     if (!item) {
//       res.status(404);
//       return res.render("extra_pages/404");
//     }

//     const statuses = [
//       { name: "Available" },
//       { name: "Maintenance" },
//     ];

//     let context = {
//       ...item,
//       categories,
//       statuses,
//       isEdit: true,
//       isDelete: true,
//       isRetired: item.status === "Retired",
//       pageTitle: "ItemDetail",
//     };

//     if (error) {
//       context = {
//         ...context,
//         error,
//       };
//     }
//     if (error) {
//       context = {
//         ...context,
//         error,
//       };
//     }

//     if (success) {
//       context = {
//         ...context,
//         success,
//       };
//     }
//     if (success) {
//       context = {
//         ...context,
//         success,
//       };
//     }

//     res.render("items/itemDetail", context);
//   }
//   catch(err) {
//     next(err);
//   }
// };

// for if we have to use the API
exports.showItemDetail = async (req, res, next) => {
  const { id } = req.params;
  const { error, success } = req.query;

  try {
    // Call the API endpoint
    const apiBaseUrl = config.BASE_URL ? config.BASE_URL : `http://localhost:${process.env.PORT || 3000}`;
    const apiUrl = new URL(`/api/items/${id}`, apiBaseUrl);
    
    // Pass query parameters to API
    if (error && error !== 'undefined') apiUrl.searchParams.append('error', error);
    if (success && success !== 'undefined') apiUrl.searchParams.append('success', success);

    const apiResponse = await fetch(apiUrl.toString(), {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${req.cookies.accessToken}`
      }
    });

    if (!apiResponse.ok) {
      if (apiResponse.status === 404) {
        res.status(404);
        return res.render("extra_pages/404");
      }
      throw new Error('API request failed');
    }
    
    const item = await apiResponse.json();
    const categories = await itemService.getCategoryFromDB();

    const statuses = [
      { name: "Available" },
      { name: "Maintenance" },
    ];

    let context = {
      ...item,
      categories,
      statuses,
      isEdit: true,
      isDelete: true,
      isRetired: item.status === "Retired",
      error: error && error !== 'undefined' ? error : null,
      success: success && success !== 'undefined' ? success : null,
      pageTitle: "ItemDetail",
    };

    res.render("items/itemDetail", context);
  } catch (err) {
    next(err);
  }
};

// DONT DELETE THIS
// exports.editItem = async (req, res, next) => {
//   const { id } = req.params;

//   try {
//     const item = await itemService.getDBItemById(id);
//     const {
//       filePath,
//       fileBuffer, 
//       fileName, 
//       mimeType,
//       name, 
//       description, 
//       brand, 
//       model, 
//       category, 
//       subCategory, 
//       serial, 
//       status, 
//       dateAcquired,
//       type,
//       redirect,
//     } = await itemService.processItemForm(req);

//     const statuses = [{ name: "Available" }, { name: "Maintenance" }];

//     const existing = await itemService.getDBItemBySerial(serial);

//     if (existing) {
//       return res.redirect("/items?error=Serial+already+exists");
//     }

//     if (type?.toLowerCase() === "error") {
//       return res.json({
//         type,
//         redirect,
//       });
//     }

//     if (item.status === "In-Use") {
//       return res.json({
//         type: "error",
//         redirect: `/items/${id}?error=Item+in-use+cannot+be+edited`,
//       });
//     }

//     if (
//       !name ||
//       !description ||
//       !brand ||
//       !model ||
//       !serial
//     ) {
//       return res.json({
//         type: "error",
//         redirect: `/items/${id}?error=Missing+required+fields`,
//       })
//     }

//     if(!statuses.map(s => s.name).includes(status)) {
//       return res.json({
//         type: "error",
//         redirect: `/items/${id}?error=Status+must+be+available+or+maintenance`,
//       });
//     }

//     const newItem = {
//       name: name || item.name,
//       description: description || item.description,
//       brand: brand || item.brand,
//       model: model || item.model,
//       category: category || item.category,
//       subCategory: subCategory || item.subCategory,
//       serial: serial || item.serial,
//       status: status || item.status,
//       dateAcquired: dateAcquired || item.dateAcquired,
//       imageName: filePath || item.image_name,
//       imageAlt: `Image of ${name || item.name}`,
//       imageUrl: filePath || item.imageUrl,
//     };

//     await itemService.updateDBItem(id, newItem);

//     return res.json({
//       type: "success",
//       redirect: `/items/${id}?success=Item+updated+successfully`,
//     });
//   } catch (err) {
//     next(err);
//   }
// };

// soft deletes only 
// exports.deleteItem = async (req, res, next) => {
//   const { id } = req.params;

//   try {
//     const response = await itemService.deleteDBItem(id);
//     return res.json(response);
//   } catch (err) {
//     next(err);
//   }
// };

// exports.showItemHistory = async (req, res, next) => {
//   const { id } = req.params;
//   const pageSize = 10;
//   let page = req.query.page;

//   try {
//     const itemHistories = await itemService.getDBItemHistoriesById(id);

//     if (!page) {
//       return res.redirect(`/items/${id}/history?page=1`);
//     }

//     page = parseInt(page);

//     const histories = itemHistories.itemHistories || [];
//     const total = histories.length;
//     const totalPages = Math.ceil(total / pageSize);
//     const totalPagesArray = Array.from({ length: totalPages }, (_, i) => i + 1);

//     const start = (page - 1) * pageSize;
//     const end = start + pageSize;
//     const paginatedHistories = histories.slice(start, end);

//     const prevPage = page > 1 ? page - 1 : null;
//     const nextPage = page < totalPages ? page + 1 : null;

//     const pagesToRender = totalPagesArray.slice(
//       Math.max(0, page - 2),
//       Math.min(totalPages, page + 1)
//     );

//     let context = {
//       ...itemHistories,
//       itemHistories: paginatedHistories,
//       isEmpty: paginatedHistories.length === 0 && total === 0,
//       prevPage,
//       nextPage,
//       currentPage: page,
//       totalPages: pagesToRender,
//       pageLink: `items/${id}/history`,
//       pageTitle: "Item History",
//     };

//     res.render("items/itemHistory", context);
//   }
//   catch(err) {
//     next(err)
//   }
// };

// for if we have to use the API
exports.showItemHistory = async (req, res, next) => {
  const { id } = req.params;

  try {
    const itemHistories = await itemService.getDBItemHistoriesById(id);

    let context = {
      ...itemHistories,
      isEmpty: false,
      pageTitle: "Item History",
    };

    if(itemHistories.itemHistories.length === 0) {
      context = {
        ...context,
        isEmpty: true
      }
    }

    res.render("items/itemHistory", context);
  }
  catch(err) {
    next(err)
  }
};

// POST CHECKIN
exports.checkIn = async (req, res, next) => {
  try {
    // get form data 
    const { fields, files } = await new Promise((resolve, reject) => {
      const form = new multiparty.Form();

      form.parse(req, (error, fields, files) => {
        if (error) return reject(error);
        resolve({ fields, files });
      });
    });

    const itemId = fields.itemId?.[0];
    const duration = fields.duration?.[0];
    const userId = req.user.id;

    // validate checkout 
    await itemService.validateCheckin(itemId);

    // upload file
    let filePath = null;
    let fileName = null;

    const file = files?.document?.[0];

    if (!file || file.size === 0 || !file.originalFilename) {
      return res.redirect("/items?error=File+is+required");
    }

    if (files?.document?.length > 0) {
      
      const DBlabel = itemService.getDBlabel(); 

      if (DBlabel === "Supabase") {
        const MAX_SIZE = 50 * 1024 * 1024;
        if (file.size > MAX_SIZE) {
          return res.redirect("/owned?error=File+too+large+(max+50MB)");
        }
      }

      const fileBuffer = fs.readFileSync(file.path);
      fileName = `${Date.now()}_${file.originalFilename}`;

      const mimeType =file.headers?.["content-type"] || "application/octet-stream";

      filePath = await itemService.uploadDBFile(fileName, fileBuffer, mimeType);
    }

    await itemService.checkinItem({
      itemId,
      userId,
      duration,
      referenceLink: filePath || fileName
    });

    return res.redirect("/owned?success=item+checked+in+sucessfully");
  } catch (err) {
    return res.redirect(
      `/owned?error=${encodeURIComponent(err.message)}`
    );
  }
};


// POST CHECKOUT
exports.checkOut = async (req, res, next) => {
  try {
    const { fields, files } = await new Promise((resolve, reject) => {
      const form = new multiparty.Form();

      form.parse(req, (error, fields, files) => {
        if (error) return reject(error);
        resolve({ fields, files });
      });
    });

    const itemId = fields.itemId?.[0];
    const duration = fields.duration?.[0];
    const userId = req.user.id;

    // validate checkout 
    await itemService.validateCheckout(itemId);

    let filePath = null;
    let fileName = null;

    const file = files?.document?.[0];

    if (!file || file.size === 0 || !file.originalFilename) {
      return res.redirect("/items?error=File+is+required");
    }

    if (files?.document?.length > 0) {
      const DBlabel = itemService.getDBlabel(); 

      if (DBlabel === "Supabase") {
        const MAX_SIZE = 50 * 1024 * 1024;
        if (file.size > MAX_SIZE) {
          return res.redirect("/items?error=File+too+large+(max+50MB)");
        }
      }

      const fileBuffer = fs.readFileSync(file.path);
      fileName = `${Date.now()}_${file.originalFilename}`;

      const mimeType =file.headers?.["content-type"] || "application/octet-stream";

      filePath = await itemService.uploadDBFile(fileName, fileBuffer, mimeType);
    }

    await itemService.checkoutItem({
      itemId,
      userId,
      duration,
      referenceLink: filePath || fileName
    });

    return res.redirect("/items?success=item+checked+out+sucessfully");
  } catch (err) {
    return res.redirect(
      `/items?error=${encodeURIComponent(err.message)}`
    );
  }
};


// POST CHECKOUT
exports.adminCheckout = async (req, res, next) => {
  try {
    const { fields, files } = await new Promise((resolve, reject) => {
      const form = new multiparty.Form();

      form.parse(req, (error, fields, files) => {
        if (error) return reject(error);
        resolve({ fields, files });
      });
    });

    const itemId = fields.itemId?.[0];
    const duration = fields.duration?.[0];
    const userEmail = fields.userEmail?.[0];
    const adminId = req.user.id;

    // validate checkout 
    await itemService.validateCheckout(itemId);
    const userId = await adminService.adminValidateForCheckout(userEmail, adminId);

    let filePath = null;
    let fileName = null;

    const file = files?.document?.[0];

    if (!file || file.size === 0 || !file.originalFilename) {
      return res.redirect("/items?error=File+is+required");
    }

    if (files?.document?.length > 0) {
      
      const DBlabel = itemService.getDBlabel(); 

      if (DBlabel === "Supabase") {
        const MAX_SIZE = 50 * 1024 * 1024;
        if (file.size > MAX_SIZE) {
          return res.redirect("/items?error=File+too+large+(max+50MB)");
        }
      }

      const fileBuffer = fs.readFileSync(file.path);
      fileName = `${Date.now()}_${file.originalFilename}`;

      const mimeType =file.headers?.["content-type"] || "application/octet-stream";

      filePath = await itemService.uploadDBFile(fileName, fileBuffer, mimeType);
    }

    await itemService.checkoutItem({
      itemId,
      userId,
      duration,
      referenceLink: filePath || fileName
    });

    return res.redirect("/items?success=item+checked+out+sucessfully");
  } catch (err) {
    return res.redirect(
      `/items?error=${encodeURIComponent(err.message)}`
    );
  }
};


exports.showOwned = async (req, res, next) => {
  try {
    const currentUserId = req.user.id;

    const items = await itemService.getUserOwnedItems(currentUserId);

    const allOwned = items.map((row) => {
      const created = row.createdAt ? new Date(row.createdAt) : null;

      let status = "unknown";
      let dueDate = null;
      let hoursSince = null;

      if (created && row.duration) {
        dueDate = new Date(created);
        dueDate.setHours(dueDate.getHours() + row.duration);

        const now = new Date();
        status = now > dueDate ? "overdue" : "active";
      } 
      else if (created) {
        const now = new Date();
        hoursSince = Math.floor((now - created) / (1000 * 60 * 60));

        status = "active";
      }

      
      return {
        id: row.itemId || row.item?.id,
        referenceUrl: row.referenceLink,
        name: row.item?.name,

        createdAt: created
          ? created.toISOString().split("T")[0]
          : null,

        duration: row.duration 
          ? `${itemService.formatDuration(row.duration)}`
          : `${itemService.formatDuration(hoursSince)} (ongoing)`,

        dueDate: dueDate
          ? dueDate.toISOString().split("T")[0]
          : "Until returned",

        status,
      };
    });

    res.render("owned", {
      items: allOwned,
      pageTitle: "Owned"
    });
  } catch (err) {
    next(err);
  }
};

exports.report = async (req, res, next) => {
  try {
    // get history for the last 7 days 
    const AllHistories = await itemService.getDBItemsHistory();
    const AllItems = await itemService.getDBItems();
    const users = await userService.getAllUsers();

    const totalUsers = users.length;
    const totalItems = AllItems.length;

    const deployedItems = AllItems.filter(item =>
      item.currentOwner &&
      item.status === "In-Use"
    ).length;


    // 3. OLD ASSETS (3+ years)
    const threeYearsAgo = new Date();
    threeYearsAgo.setFullYear(threeYearsAgo.getFullYear() - 3);

    const oldAssets = AllItems
      .filter(i =>
        i.dateAcquired &&
        new Date(i.dateAcquired) <= threeYearsAgo
      )
      .map(i => ({
        ...i,
        formatted: new Date(i.dateAcquired).toLocaleDateString("en-GB", {
          day: "2-digit",
          month: "short",
          year: "numeric"
        })
      }));


    // 4. USER AUDIT 
    const selectedUserId = req.query.userId || null;

    let selectedUserName = "";

    if (selectedUserId) {
      const user = await itemService.getUserById(selectedUserId);
      selectedUserName = `${user.name} (${user.email})`;
    }

    const items = await itemService.getUserOwnedItems(selectedUserId);

    const userAudit = items.map((row) => {
      const created = row.createdAt ? new Date(row.createdAt) : null;

      let status = "unknown";
      let dueDate = null;
      let hoursSince = null;

      if (created && row.duration) {
        dueDate = new Date(created);
        dueDate.setHours(dueDate.getHours() + row.duration);

        const now = new Date();
        status = now > dueDate ? "overdue" : "active";
      } else if (created) {
        const now = new Date();
        hoursSince = Math.floor((now - created) / (1000 * 60 * 60));
        status = "active";
      }

      return {
        id: row.itemId || row.item?.id,
        referenceUrl: row.referenceLink,

        name: row.item?.name,

        createdAt: created
          ? created.toISOString().split("T")[0]
          : null,

        duration: row.duration
          ? itemService.formatDuration(row.duration)
          : itemService.formatDuration(hoursSince) + " (ongoing)",

        dueDate: dueDate
          ? dueDate.toISOString().split("T")[0]
          : "Until returned",

        status
      };
    });
    
    res.render("report", {
        totalUsers,
        totalItems,
        deployedItems,
        userAudit,
        users,
        selectedUserName,
        selectedUserId,
        oldAssets,
        pageTitle: "Report"
    });
  } catch (err) {
    next(err);
  }
};

exports.logs = async (req, res, next) => {
  try {
    const selectedUserId = req.query.userId || null;
    const userId = req.user?.id;

    const pageSize = 8;
    const page = parseInt(req.query.page) || 1;

    // DATA FETCH FIRST
    const [allHistories, items, users] = await Promise.all([
      itemService.getDBItemsHistory(),
      itemService.getDBItems(),
      userService.getAllUsers(),
    ]);
    
    // SORT FIRST
    const sorted = [...allHistories].sort(
      (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
    );

    // Build latest record per itemId
    const latestByItem = new Map();

    for (const h of sorted) {
      const key = h.itemId?.toString();
      if (!latestByItem.has(key)) {
        latestByItem.set(key, h); // first seen = latest because sorted DESC
      }
    }

    // FILTER
    let logs = sorted;

    let selectedUserName = "";

    if (selectedUserId) { 
      logs = logs.filter(h => h.userId?.toString() === selectedUserId.toString() ); 
    } 
    
    if (selectedUserId) { 
      const user = await itemService.getUserById(selectedUserId); 
      
      if (user) { 
        selectedUserName = `${user.name} (${user.email})`; 
      } 
    }

    // MAPS
    const itemMap = new Map(items.map(i => [i.id?.toString(), i]));
    const userMap = new Map(users.map(u => [u.id?.toString(), u]));

    // TRANSFORM
    const newLogs = logs.map((h) => {
      const itemId = h.itemId?.toString();
      const latest = latestByItem.get(itemId);

      const created = h.createdAt ? new Date(h.createdAt) : null;

      let status = "unknown";

      if (latest?.id?.toString() !== h.id?.toString()) {
        // older history rows should NOT be "active/returned logic"
        status = "old";
      } else {
        // ONLY latest record determines real status
        if (latest.action === "checkin") {
          status = "returned";
        } else if (latest.action === "checkout") {
          if (created && h.duration) {
            const dueDate = new Date(created);
            dueDate.setHours(dueDate.getHours() + h.duration);

            status = new Date() > dueDate ? "overdue" : "active";
          } else {
            status = "active";
          }
        }
      }

      return {
        ...h,
        item: itemMap.get(h.itemId?.toString())?.name || "Unknown",
        user: userMap.get(h.userId?.toString())?.name || "Unknown",
        date: created ? created.toISOString().split("T")[0] : "No date",
        status,
      };
    });

    // PAGINATION
    const total = newLogs.length;
    const totalPages = Math.ceil(total / pageSize);

    const start = (page - 1) * pageSize;
    const end = start + pageSize;

    const paginatedHistories = newLogs.slice(start, end);

    const prevPage = page > 1 ? page - 1 : null;
    const nextPage = page < totalPages ? page + 1 : null;

    const totalPagesArray = Array.from({ length: totalPages }, (_, i) => i + 1);

    const pagesToRender = totalPagesArray.slice(
      Math.max(0, page - 2),
      Math.min(totalPages, page + 1)
    );

    console.log(paginatedHistories)
    res.render("logs", {
      allHistories: paginatedHistories,
      users,
      selectedUserName,
      prevPage,
      nextPage,
      currentPage: page,
      totalPages: pagesToRender,
      pageLink: "logs",
      query: selectedUserId ? `&userId=${selectedUserId}` : "",
      pageTitle: "Logs",
    });

  } catch (err) {
    next(err);
  }
};

// 404 handler
exports.notFound = (req, res) => {
  const isAuthRoute =
    req.path.startsWith("/login") ||
    req.path.startsWith("/register");

  res.status(404).render("extra_pages/404", {
    layout: isAuthRoute ? "no_nav_bar" : "main",
    message: "The page you are looking for does not exist.",
    pageTitle: "404",
  });
};