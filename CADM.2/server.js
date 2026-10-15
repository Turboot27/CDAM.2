"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const readline = require("node:readline");

const ROOT = __dirname;
const CONFIG_PATH = path.join(ROOT, "config.json");
const DATA_DIRECTORY = process.env.DATA_DIR || path.join(ROOT, "data");
const DATA_PATH = path.join(DATA_DIRECTORY, "news.json");
const PAGE_PATH = path.join(ROOT, "miprimerproyecto.html");
const STATIC_ASSETS = new Map([
    ["/app.js", { path: path.join(ROOT, "app.js"), contentType: "text/javascript; charset=utf-8" }],
    ["/styles.css", { path: path.join(ROOT, "styles.css"), contentType: "text/css; charset=utf-8" }]
]);
const SESSION_LIFETIME_MS = 8 * 60 * 60 * 1000;
const MAX_REQUEST_BYTES = 1024 * 1024;
const loginAttempts = new Map();
const sessions = new Map();
const seedArticle = {
    id: "squishy",
    title: "Explocion de squishy",
    body: "Ocurrió una explosión de un squishy en la escuela. La causó un estudiante que estaba jugando con su squishy y lo explotó.",
    date: "2026-10-14T12:00:00.000Z",
    comments: []
};

function hashPassword(password, salt) {
    return crypto.scryptSync(password, salt, 64).toString("hex");
}

function promptHidden(rl, label) {
    return new Promise((resolve) => {
        rl.question(label, { hideEchoBack: true }, (answer) => {
            process.stdout.write("\n");
            resolve(answer);
        });
    });
}

async function setup() {
    if (fs.existsSync(CONFIG_PATH)) {
        throw new Error("Ya existe config.json. No lo sobrescribí para conservar tus claves.");
    }
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
        throw new Error("Ejecuta npm run setup en una terminal interactiva para ingresar las claves de forma segura.");
    }

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    try {
        process.stdout.write("Configura las claves iniciales. Puedes conservar tu contraseña de lectura actual,\n");
        process.stdout.write("pero elige una contraseña nueva y fuerte para la cuenta administradora.\n\n");
        const readerPassword = await promptHidden(rl, "Contraseña para leer noticias: ");
        if (!readerPassword) throw new Error("La contraseña de lectura no puede estar vacía.");

        const username = (await new Promise((resolve) => {
            rl.question("Nombre de usuario administrador: ", resolve);
        })).trim();
        if (!/^[a-zA-Z0-9._-]{3,40}$/.test(username)) {
            throw new Error("El usuario debe tener de 3 a 40 caracteres: letras, números, punto, guion o guion bajo.");
        }

        const adminPassword = await promptHidden(rl, "Contraseña administradora nueva (mínimo 12 caracteres): ");
        if (adminPassword.length < 12) {
            throw new Error("La contraseña administradora debe tener al menos 12 caracteres.");
        }

        const config = {
            reader: {
                salt: crypto.randomBytes(16).toString("hex"),
                passwordHash: ""
            },
            admin: {
                username,
                salt: crypto.randomBytes(16).toString("hex"),
                passwordHash: ""
            }
        };
        config.reader.passwordHash = hashPassword(readerPassword, config.reader.salt);
        config.admin.passwordHash = hashPassword(adminPassword, config.admin.salt);
        fs.writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, { flag: "wx", mode: 0o600 });
        process.stdout.write("Configuración guardada en config.json (excluido del control de versiones).\n");
        process.stdout.write("Inicia el servidor con: npm start\n");
    } finally {
        rl.close();
    }
}

function loadConfig() {
    if (!fs.existsSync(CONFIG_PATH)) {
        const readerPassword = process.env.READER_PASSWORD;
        const username = process.env.ADMIN_USERNAME;
        const adminPassword = process.env.ADMIN_PASSWORD;
        if (!readerPassword || !username || !adminPassword) {
            throw new Error(
                "Falta config.json. Ejecuta npm run setup o configura READER_PASSWORD, ADMIN_USERNAME y ADMIN_PASSWORD."
            );
        }
        if (!/^[a-zA-Z0-9._-]{3,40}$/.test(username)) {
            throw new Error("ADMIN_USERNAME debe tener de 3 a 40 caracteres: letras, números, punto, guion o guion bajo.");
        }
        if (adminPassword.length < 12) {
            throw new Error("ADMIN_PASSWORD debe tener al menos 12 caracteres.");
        }

        const config = {
            reader: {
                salt: crypto.randomBytes(16).toString("hex"),
                passwordHash: ""
            },
            admin: {
                username,
                salt: crypto.randomBytes(16).toString("hex"),
                passwordHash: ""
            }
        };
        config.reader.passwordHash = hashPassword(readerPassword, config.reader.salt);
        config.admin.passwordHash = hashPassword(adminPassword, config.admin.salt);
        return config;
    }
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
    if (!config.reader?.salt || !config.reader?.passwordHash ||
        !config.admin?.username || !config.admin?.salt || !config.admin?.passwordHash) {
        throw new Error("config.json no contiene la configuración esperada. Ejecuta npm run setup.");
    }
    return config;
}

function loadArticles() {
    fs.mkdirSync(DATA_DIRECTORY, { recursive: true });
    if (!fs.existsSync(DATA_PATH)) {
        const articles = [seedArticle];
        fs.writeFileSync(DATA_PATH, `${JSON.stringify(articles, null, 2)}\n`, { flag: "wx" });
        return articles;
    }

    const articles = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
    if (!Array.isArray(articles) || !articles.every((article) =>
        article && typeof article.id === "string" && typeof article.title === "string" &&
        typeof article.body === "string" && typeof article.date === "string" &&
        Array.isArray(article.comments) && article.comments.every((comment) => typeof comment === "string")
    )) {
        throw new Error("data/news.json está dañado o tiene un formato no válido.");
    }
    if (!articles.some((article) => article.id === seedArticle.id)) articles.unshift(seedArticle);
    return articles;
}

function saveArticles(articles) {
    const temporaryPath = `${DATA_PATH}.${crypto.randomUUID()}.tmp`;
    try {
        fs.writeFileSync(temporaryPath, `${JSON.stringify(articles, null, 2)}\n`, { flag: "wx" });
        fs.renameSync(temporaryPath, DATA_PATH);
    } finally {
        if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
    }
}

function sendJson(response, status, data, extraHeaders = {}) {
    const body = JSON.stringify(data);
    response.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        ...extraHeaders
    });
    response.end(body);
}

function readJson(request) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let bytes = 0;
        let tooLarge = false;
        request.on("data", (chunk) => {
            if (tooLarge) return;
            bytes += chunk.length;
            if (bytes > MAX_REQUEST_BYTES) {
                tooLarge = true;
                reject(Object.assign(new Error("La solicitud es demasiado grande."), { status: 413 }));
                request.resume();
                return;
            }
            chunks.push(chunk);
        });
        request.on("end", () => {
            if (tooLarge) return;
            try {
                const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
                if (!body || typeof body !== "object" || Array.isArray(body)) {
                    throw new Error("El contenido debe ser un objeto JSON.");
                }
                resolve(body);
            } catch {
                reject(Object.assign(new Error("El contenido enviado no es JSON válido."), { status: 400 }));
            }
        });
        request.on("error", reject);
    });
}

function requestCookies(request) {
    return Object.fromEntries((request.headers.cookie || "").split(";").map((part) => {
        const separator = part.indexOf("=");
        return separator < 0 ? ["", ""] : [part.slice(0, separator).trim(), part.slice(separator + 1).trim()];
    }));
}

function sessionFor(request, role) {
    const cookies = requestCookies(request);
    const token = cookies[`${role}_session`];
    if (!token) return null;
    const session = sessions.get(token);
    if (!session || session.role !== role || session.expiresAt <= Date.now()) {
        sessions.delete(token);
        return null;
    }
    return session;
}

function hasReaderAccess(request) {
    return Boolean(sessionFor(request, "reader") || sessionFor(request, "admin"));
}

function sessionCookie(role, token, maxAge) {
    const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
    return `${role}_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure}`;
}

function createSession(role, username = "") {
    for (const [token, session] of sessions) {
        if (session.expiresAt <= Date.now()) sessions.delete(token);
    }
    const token = crypto.randomBytes(32).toString("hex");
    sessions.set(token, { role, username, expiresAt: Date.now() + SESSION_LIFETIME_MS });
    return token;
}

function checkOrigin(request) {
    const origin = request.headers.origin;
    if (!origin) return true;
    try {
        return new URL(origin).host === request.headers.host;
    } catch {
        return false;
    }
}

function allowedLogin(ip, role) {
    const key = `${ip}:${role}`;
    const now = Date.now();
    const attempts = loginAttempts.get(key);
    if (!attempts || attempts.resetAt <= now) {
        loginAttempts.set(key, { count: 0, resetAt: now + 15 * 60 * 1000 });
        return true;
    }
    return attempts.count < 10;
}

function recordFailedLogin(ip, role) {
    const key = `${ip}:${role}`;
    const attempts = loginAttempts.get(key) || { count: 0, resetAt: Date.now() + 15 * 60 * 1000 };
    attempts.count += 1;
    loginAttempts.set(key, attempts);
}

function clearFailedLogins(ip, role) {
    loginAttempts.delete(`${ip}:${role}`);
}

function passwordMatches(password, stored) {
    if (typeof password !== "string" || password.length > 256) return false;
    const actual = Buffer.from(hashPassword(password, stored.salt), "hex");
    const expected = Buffer.from(stored.passwordHash, "hex");
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function requireAdmin(request, response) {
    if (sessionFor(request, "admin")) return true;
    sendJson(response, 401, { error: "Inicia sesión con la cuenta administradora para realizar esta acción." });
    return false;
}

function validateImportedArticle(article) {
    return article && typeof article.id === "string" && article.id.length > 0 && article.id.length <= 200 &&
        typeof article.title === "string" && article.title.trim().length > 0 && article.title.length <= 120 &&
        typeof article.body === "string" && article.body.trim().length > 0 && article.body.length <= 3000 &&
        typeof article.date === "string" && Number.isFinite(Date.parse(article.date)) &&
        Array.isArray(article.comments) && article.comments.length <= 1000 &&
        article.comments.every((comment) => typeof comment === "string" && comment.length <= 500);
}

function servePage(response) {
    const html = fs.readFileSync(PAGE_PATH);
    response.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store"
    });
    response.end(html);
}

function serveStaticAsset(response, asset) {
    const content = fs.readFileSync(asset.path);
    response.writeHead(200, {
        "Content-Type": asset.contentType,
        "Cache-Control": "no-cache",
        "Content-Length": content.length
    });
    response.end(content);
}

function createServer(config, articleStore) {
    let articleMutationQueue = Promise.resolve();
    const updateArticles = (update) => {
        const mutation = articleMutationQueue.then(() => {
            const change = update(articleStore);
            if (change) {
                saveArticles(change.articles);
                articleStore.splice(0, articleStore.length, ...change.articles);
            }
            return change ? change.result : null;
        });
        articleMutationQueue = mutation.catch(() => {});
        return mutation;
    };

    return http.createServer(async (request, response) => {
        response.setHeader("X-Content-Type-Options", "nosniff");
        response.setHeader("X-Frame-Options", "DENY");
        response.setHeader("Referrer-Policy", "no-referrer");
        response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
        response.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'");

        try {
            const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
            const method = request.method;
            const ip = request.socket.remoteAddress || "unknown";

            if (method === "GET" && (url.pathname === "/" || url.pathname === "/miprimerproyecto.html")) {
                servePage(response);
                return;
            }

            if (method === "GET" && STATIC_ASSETS.has(url.pathname)) {
                serveStaticAsset(response, STATIC_ASSETS.get(url.pathname));
                return;
            }

            if (method === "GET" && url.pathname === "/api/auth/status") {
                sendJson(response, 200, {
                    reader: hasReaderAccess(request),
                    admin: Boolean(sessionFor(request, "admin"))
                });
                return;
            }

            if (method === "POST" && url.pathname.startsWith("/api/")) {
                if (!checkOrigin(request)) {
                    sendJson(response, 403, { error: "Solicitud rechazada por su origen." });
                    return;
                }
                if (!request.headers["content-type"]?.includes("application/json")) {
                    sendJson(response, 415, { error: "Se esperaba contenido JSON." });
                    return;
                }

                if (url.pathname === "/api/auth/reader") {
                    if (!allowedLogin(ip, "reader")) {
                        sendJson(response, 429, { error: "Demasiados intentos. Espera 15 minutos." });
                        return;
                    }
                    const body = await readJson(request);
                    if (!passwordMatches(body.password, config.reader)) {
                        recordFailedLogin(ip, "reader");
                        sendJson(response, 401, { error: "Contraseña incorrecta." });
                        return;
                    }
                    clearFailedLogins(ip, "reader");
                    const token = createSession("reader");
                    sendJson(response, 200, { ok: true }, {
                        "Set-Cookie": sessionCookie("reader", token, SESSION_LIFETIME_MS / 1000)
                    });
                    return;
                }

                if (url.pathname === "/api/auth/admin") {
                    if (!allowedLogin(ip, "admin")) {
                        sendJson(response, 429, { error: "Demasiados intentos. Espera 15 minutos." });
                        return;
                    }
                    const body = await readJson(request);
                    if (body.username !== config.admin.username || !passwordMatches(body.password, config.admin)) {
                        recordFailedLogin(ip, "admin");
                        sendJson(response, 401, { error: "Usuario o contraseña incorrectos." });
                        return;
                    }
                    clearFailedLogins(ip, "admin");
                    const token = createSession("admin", config.admin.username);
                    sendJson(response, 200, { ok: true }, {
                        "Set-Cookie": sessionCookie("admin", token, SESSION_LIFETIME_MS / 1000)
                    });
                    return;
                }

                if (url.pathname === "/api/auth/logout") {
                    const cookies = requestCookies(request);
                    sessions.delete(cookies.reader_session);
                    sessions.delete(cookies.admin_session);
                    sendJson(response, 200, { ok: true }, {
                        "Set-Cookie": [
                            sessionCookie("reader", "", 0),
                            sessionCookie("admin", "", 0)
                        ]
                    });
                    return;
                }

                if (url.pathname === "/api/news") {
                    if (!requireAdmin(request, response)) return;
                    const body = await readJson(request);
                    if (typeof body.title !== "string" || !body.title.trim() || body.title.length > 120 ||
                        typeof body.body !== "string" || !body.body.trim() || body.body.length > 3000) {
                        sendJson(response, 400, { error: "Escribe un título (máximo 120 caracteres) y contenido (máximo 3000)." });
                        return;
                    }
                    const article = {
                        id: crypto.randomUUID(),
                        title: body.title.trim(),
                        body: body.body.trim(),
                        date: new Date().toISOString(),
                        comments: []
                    };
                    await updateArticles((currentArticles) => ({
                        articles: [article, ...currentArticles],
                        result: article
                    }));
                    sendJson(response, 201, { article });
                    return;
                }

                if (url.pathname === "/api/admin/import-legacy") {
                    if (!requireAdmin(request, response)) return;
                    const body = await readJson(request);
                    if (!Array.isArray(body.articles) || body.articles.length > 500 ||
                        !body.articles.every(validateImportedArticle)) {
                        sendJson(response, 400, { error: "Las noticias antiguas tienen un formato no válido." });
                        return;
                    }
                    const result = await updateArticles((currentArticles) => {
                        const existingArticles = new Map(currentArticles.map((article) => [article.id, article]));
                        const imports = [];
                        const updates = new Map();
                        body.articles.forEach((article) => {
                            const existing = existingArticles.get(article.id);
                            if (!existing) {
                                imports.push(article);
                                existingArticles.set(article.id, article);
                                return;
                            }
                            const comments = [...new Set([...existing.comments, ...article.comments])];
                            if (comments.length !== existing.comments.length) {
                                updates.set(article.id, { ...existing, comments });
                                existingArticles.set(article.id, updates.get(article.id));
                            }
                        });
                        if (!imports.length && !updates.size) return null;
                        return {
                            articles: [
                                ...imports,
                                ...currentArticles.map((article) => updates.get(article.id) || article)
                            ],
                            result: { imported: imports.length, merged: updates.size }
                        };
                    });
                    sendJson(response, 200, result || { imported: 0, merged: 0 });
                    return;
                }

                const commentRoute = url.pathname.match(/^\/api\/news\/([^/]+)\/comments$/);
                if (commentRoute) {
                    if (!hasReaderAccess(request)) {
                        sendJson(response, 401, { error: "Inicia sesión para comentar." });
                        return;
                    }
                    const body = await readJson(request);
                    if (typeof body.comment !== "string" || !body.comment.trim() || body.comment.length > 500) {
                        sendJson(response, 400, { error: "El comentario debe tener entre 1 y 500 caracteres." });
                        return;
                    }
                    let articleId;
                    try {
                        articleId = decodeURIComponent(commentRoute[1]);
                    } catch {
                        sendJson(response, 400, { error: "El identificador de la noticia no es válido." });
                        return;
                    }
                    const articleFound = await updateArticles((currentArticles) => {
                        const found = currentArticles.some((item) => item.id === articleId);
                        if (!found) return null;
                        return {
                            articles: currentArticles.map((item) => item.id === articleId
                                ? { ...item, comments: [...item.comments, body.comment.trim()] }
                                : item
                            ),
                            result: true
                        };
                    });
                    if (!articleFound) {
                        sendJson(response, 404, { error: "No se encontró esa noticia." });
                        return;
                    }
                    sendJson(response, 201, { ok: true });
                    return;
                }
            }

            if (method === "GET" && url.pathname === "/api/news") {
                if (!hasReaderAccess(request)) {
                    sendJson(response, 401, { error: "Ingresa la contraseña para leer las noticias." });
                    return;
                }
                sendJson(response, 200, { articles: articleStore });
                return;
            }

            sendJson(response, 404, { error: "No se encontró esa página." });
        } catch (error) {
            if (response.headersSent) {
                response.destroy(error);
                return;
            }
            if (error.status) {
                sendJson(response, error.status, { error: error.message });
                return;
            }
            console.error("Error al procesar la solicitud:", error);
            sendJson(response, 500, { error: "Ocurrió un error interno. Revisa la consola del servidor." });
        }
    });
}

async function main() {
    if (process.argv.includes("--setup")) {
        await setup();
        return;
    }

    const config = loadConfig();
    const articles = loadArticles();
    const host = process.env.HOST || "127.0.0.1";
    const PORT = process.env.PORT || 8765;
    const port = Number(PORT);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT debe ser un puerto válido.");

    const server = createServer(config, articles);
    server.requestTimeout = 30_000;
    server.headersTimeout = 10_000;
    server.keepAliveTimeout = 5_000;
    server.maxRequestsPerSocket = 1_000;
    server.on("error", (error) => {
        console.error("Error del servidor HTTP:", error);
        process.exitCode = 1;
    });
    server.listen(port, host, () => {
        process.stdout.write(`CDAM Noticias está disponible en http://${host}:${port}\n`);
        process.stdout.write("Para detener el servidor, presiona Ctrl+C.\n");
    });
}

main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
});
