const jwt = require("jsonwebtoken");
const secret = process.env.JWT_SECRET || "your-super-secret-key";
const { getDbProvider } = require("../utils/dbProviderShared");
const { verifyToken } = require("./authMiddleware")


// APIPROTECT (API version of protect using JWT TOKEN)
async function apiProtect(req, res, next) {
  try {
    let token = req.cookies?.accessToken;

    // 2. Bearer token (Postman / API standard)
    const authHeader = req.get("Authorization");
    if (!token && authHeader?.startsWith("Bearer ")) {
        token = authHeader.split(" ")[1];
    }

    // No token → API response
    if (!token) {
        return res.status(401).json({
            message: "Authentication required"
      });
    }

    const decoded = verifyToken(token);

    if (!decoded) {
        return res.status(401).json({
            message: "Invalid or expired token"
        });
    }

    const dbProvider = getDbProvider();
    const user = await dbProvider.getUserById(decoded.id);

    if (!user) {
        return res.status(401).json({
            message: "User not found"
        });
    }

    if (user.status === "Disabled") {
        return res.status(403).json({
            message: "Account disabled"
        });
    }

    if (user.disabledAt && decoded.iat * 1000 < new Date(user.disabledAt).getTime()) {
      return res.status(403).json({
        message: "Session expired"
      });
    }

    req.user = user;
    req.authType = "jwt";

    next();
  } catch (err) {
    next(err);
  }
}


// authOrApiKey 
async function authOrApiKey(req, res, next) {
  try {
    const dbProvider = getDbProvider();

    let authType = null;

    // 1. TRY JWT FIRST
    let token;

    const authHeader = req.get("Authorization");
    if (req.cookies?.accessToken) {
      token = req.cookies.accessToken;
    } else if (authHeader?.startsWith("Bearer ")) {
      token = authHeader.split(" ")[1];
    }

    if (token) {
      const decoded = verifyToken(token);

      if (decoded) {
        const user = await dbProvider.getUserById(decoded.id);

        if (!user) {
          return res.status(403).json({
            message: "Account disabled or invalid user"
          });
        }

        if (user.status === "Disabled") {
          return res.status(403).json({
            message: "Account disabled"
          });
        }

        if (
          user.disabledAt &&
          decoded.iat * 1000 < new Date(user.disabledAt).getTime()
        ) {
          return res.status(403).json({
            message: "Session expired"
          });
        }

        req.user = user;
        req.authType = "jwt";
        return next();
      }
    }

    // 2. FALLBACK TO API KEY
    const apiKey = req.get("x-api-key");

    if (apiKey) {
      const keyRecord = await dbProvider.verifyApiKey(apiKey);

      if (keyRecord && !keyRecord.revoked) {
        req.apiKey = keyRecord;
        req.authType = "apiKey";
        return next();
      }
    }

    // 3. FAIL
    return res.status(401).json({
      message: "Authentication required (JWT or API key)"
    });

  } catch (err) {
    next(err);
  }
}

module.exports = { apiProtect, authOrApiKey }