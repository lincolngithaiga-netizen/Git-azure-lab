require("dotenv").config();
const express = require("express");
const path = require("path");
const fs = require("fs");
const bcrypt = require("bcryptjs");
const Database = require("better-sqlite3");
const session = require("express-session");
const SqliteStore = require("better-sqlite3-session-store")(session);
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { body, query, param, validationResult } = require("express-validator");

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.OPENWEATHER_API_KEY;
const SESSION_SECRET = process.env.SESSION_SECRET;
// Set HTTPS_ENABLED=true in .env once Nginx serves the site over HTTPS.
// It turns on secure cookies and the upgrade-insecure-requests header.
const HTTPS_ENABLED = process.env.HTTPS_ENABLED === "true";
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "data", "app.db");

if (!API_KEY) {
  console.error("Missing OPENWEATHER_API_KEY in .env");
  process.exit(1);
}
if (!SESSION_SECRET || SESSION_SECRET.length < 32) {
  console.error("Missing SESSION_SECRET in .env (use at least 32 random characters)");
  process.exit(1);
}

// ---------- Database ----------
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS favourites (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    city TEXT NOT NULL COLLATE NOCASE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (user_id, city)
  );
`);

// ---------- App setup ----------
// Nginx sits in front, so trust one proxy hop (needed for secure cookies and rate limiting by real IP)
app.set("trust proxy", 1);

app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        // Weather icons come from OpenWeatherMap
        imgSrc: ["'self'", "data:", "https://openweathermap.org"],
        // On plain HTTP this directive would break the site, so only send it with HTTPS
        upgradeInsecureRequests: HTTPS_ENABLED ? [] : null,
      },
    },
    // HSTS is added in the Nginx config
    hsts: false,
  })
);

app.use(express.json({ limit: "10kb" }));

app.use(
  session({
    name: "sid",
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: new SqliteStore({
      client: db,
      expired: { clear: true, intervalMs: 15 * 60 * 1000 },
    }),
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: HTTPS_ENABLED,
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
  })
);

// Serve the front-end files
app.use(express.static(path.join(__dirname, "public")));

// ---------- Validation rules ----------
const CITY_PATTERN = /^[\p{L}\s.'-]+$/u;

const cityQuery = query("q")
  .trim()
  .isLength({ min: 1, max: 60 })
  .withMessage("City must be 1 to 60 characters")
  .matches(CITY_PATTERN)
  .withMessage("City contains characters that are not allowed");

const cityBody = body("city")
  .isString()
  .trim()
  .isLength({ min: 1, max: 60 })
  .withMessage("City must be 1 to 60 characters")
  .matches(CITY_PATTERN)
  .withMessage("City contains characters that are not allowed");

const emailRule = body("email")
  .isString()
  .trim()
  .isLength({ max: 254 })
  .isEmail()
  .withMessage("Enter a valid email address")
  .customSanitizer((v) => v.toLowerCase());

const newPasswordRule = body("password")
  .isString()
  .withMessage("Password is required")
  .isLength({ min: 10 })
  .withMessage("Password must be at least 10 characters")
  // bcrypt only uses the first 72 bytes, so reject anything longer
  .custom((v) => Buffer.byteLength(v, "utf8") <= 72)
  .withMessage("Password must be at most 72 bytes");

// Returns a 400 with the list of problems if validation failed
function checkValidation(req, res, next) {
  const result = validationResult(req);
  if (result.isEmpty()) return next();
  return res.status(400).json({
    message: "Invalid input",
    errors: result.array().map((e) => ({ field: e.path, message: e.msg })),
  });
}

function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ message: "Please log in" });
  }
  next();
}

// ---------- Rate limiting ----------
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many attempts. Try again in 15 minutes." },
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many requests. Slow down." },
});

// ---------- Health check ----------
app.get("/health", (req, res) => {
  try {
    db.prepare("SELECT 1").get();
    res.json({ status: "ok", uptimeSeconds: Math.round(process.uptime()) });
  } catch (err) {
    res.status(500).json({ status: "error" });
  }
});

// ---------- Accounts ----------
// A fixed hash to compare against when the email is unknown, so login takes
// about the same time whether or not the account exists
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", 12);

app.post(
  "/api/register",
  authLimiter,
  emailRule,
  newPasswordRule,
  checkValidation,
  async (req, res, next) => {
    try {
      const hash = await bcrypt.hash(req.body.password, 12);
      db.prepare("INSERT INTO users (email, password_hash) VALUES (?, ?)").run(
        req.body.email,
        hash
      );
      res.status(201).json({ ok: true });
    } catch (err) {
      if (err.code === "SQLITE_CONSTRAINT_UNIQUE") {
        return res.status(409).json({ message: "Could not register with those details" });
      }
      next(err);
    }
  }
);

app.post(
  "/api/login",
  authLimiter,
  emailRule,
  body("password").isString().isLength({ min: 1, max: 200 }),
  checkValidation,
  async (req, res, next) => {
    try {
      const user = db
        .prepare("SELECT id, email, password_hash FROM users WHERE email = ?")
        .get(req.body.email);
      const ok = await bcrypt.compare(
        req.body.password,
        user ? user.password_hash : DUMMY_HASH
      );
      if (!user || !ok) {
        return res.status(401).json({ message: "Email or password is incorrect" });
      }
      // New session ID on login prevents session fixation
      req.session.regenerate((err) => {
        if (err) return next(err);
        req.session.userId = user.id;
        req.session.email = user.email;
        res.json({ email: user.email });
      });
    } catch (err) {
      next(err);
    }
  }
);

app.post("/api/logout", (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie("sid");
    res.json({ ok: true });
  });
});

app.get("/api/me", requireAuth, (req, res) => {
  res.json({ email: req.session.email });
});

// ---------- Favourite cities ----------
const MAX_FAVOURITES = 20;

app.get("/api/favourites", requireAuth, (req, res) => {
  const rows = db
    .prepare("SELECT id, city FROM favourites WHERE user_id = ? ORDER BY city")
    .all(req.session.userId);
  res.json(rows);
});

app.post("/api/favourites", requireAuth, cityBody, checkValidation, (req, res) => {
  const { count } = db
    .prepare("SELECT COUNT(*) AS count FROM favourites WHERE user_id = ?")
    .get(req.session.userId);
  if (count >= MAX_FAVOURITES) {
    return res.status(400).json({ message: `You can save up to ${MAX_FAVOURITES} cities` });
  }
  db.prepare("INSERT OR IGNORE INTO favourites (user_id, city) VALUES (?, ?)").run(
    req.session.userId,
    req.body.city
  );
  res.status(201).json({ ok: true });
});

app.delete(
  "/api/favourites/:id",
  requireAuth,
  param("id").isInt({ min: 1 }),
  checkValidation,
  (req, res) => {
    db.prepare("DELETE FROM favourites WHERE id = ? AND user_id = ?").run(
      Number(req.params.id),
      req.session.userId
    );
    res.json({ ok: true });
  }
);

// ---------- Weather proxy ----------
// Forwards a request to OpenWeatherMap, adding the secret key server-side
async function proxy(endpoint, req, res) {
  const url = new URL(`https://api.openweathermap.org/data/2.5/${endpoint}`);
  url.searchParams.set("q", req.query.q);
  url.searchParams.set("units", "metric");
  url.searchParams.set("appid", API_KEY);

  try {
    const upstream = await fetch(url);
    if (upstream.status === 404) {
      return res.status(404).json({ message: "City not found" });
    }
    if (!upstream.ok) {
      console.error(`${endpoint} upstream status`, upstream.status);
      return res.status(502).json({ message: "Weather service unavailable" });
    }
    res.json(await upstream.json());
  } catch (err) {
    console.error(`Error calling ${endpoint}:`, err);
    res.status(502).json({ message: "Weather service unavailable" });
  }
}

app.get("/api/weather", apiLimiter, cityQuery, checkValidation, (req, res) =>
  proxy("weather", req, res)
);
app.get("/api/forecast", apiLimiter, cityQuery, checkValidation, (req, res) =>
  proxy("forecast", req, res)
);

// ---------- Error handling ----------
// Log details on the server, send only a generic message to the client
app.use((err, req, res, next) => {
  if (err.type === "entity.parse.failed") {
    return res.status(400).json({ message: "Invalid request body" });
  }
  console.error(err);
  res.status(500).json({ message: "Something went wrong" });
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
