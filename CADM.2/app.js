"use strict";

const login = document.getElementById("login");
const news = document.getElementById("news");
const adminPanel = document.getElementById("adminPanel");
const readerLoginForm = document.getElementById("readerLoginForm");
const adminLoginForm = document.getElementById("adminLoginForm");
const passwordInput = document.getElementById("password");
const articlesElement = document.getElementById("articles");
const newsForm = document.getElementById("newsForm");
const publishMessage = document.getElementById("publishMessage");
const dateFormatter = new Intl.DateTimeFormat("es-MX", {
    day: "numeric",
    month: "long",
    year: "numeric"
});
const likeState = new Map();

const api = async (url, options = {}) => {
    const headers = new Headers(options.headers);
    if (options.body !== undefined) headers.set("Content-Type", "application/json");
    const response = await fetch(url, {
        ...options,
        headers,
        credentials: "same-origin"
    });
    const responseText = await response.text();
    let result = {};
    if (responseText) {
        try {
            result = JSON.parse(responseText);
        } catch {
            throw new Error("El servidor devolvió una respuesta no válida. Intenta de nuevo.");
        }
    }
    if (!response.ok) throw new Error(result.error || "Ocurrió un error en la solicitud.");
    return result;
};

function showError(element, error) {
    element.textContent = error instanceof Error ? error.message : "Ocurrió un error inesperado.";
}

function setFormBusy(form, busy) {
    form.querySelectorAll("button[type='submit']").forEach((button) => {
        button.disabled = busy;
    });
}

function setSession(status) {
    const isAdmin = status.admin === true;
    const isAuthenticated = isAdmin || status.reader === true;
    login.hidden = isAuthenticated;
    news.hidden = !isAuthenticated;
    adminPanel.hidden = !isAdmin;
    document.getElementById("sessionMessage").textContent = isAuthenticated
        ? isAdmin ? "Sesión de administrador iniciada." : "Sesión de lector iniciada."
        : "";
    document.querySelectorAll(".currentDate").forEach((dateElement) => {
        dateElement.textContent = dateFormatter.format(new Date());
    });
}

async function loadArticles() {
    const result = await api("/api/news");
    if (!Array.isArray(result.articles)) throw new Error("El servidor devolvió una lista de noticias no válida.");
    renderArticles(result.articles);
}

async function importLegacyArticles() {
    if (localStorage.getItem("cdam-news-migrated") === "true") return;

    const stored = localStorage.getItem("cdam-news-articles");
    const oldComments = JSON.parse(localStorage.getItem("cdam-news-comments") || "[]");
    if (!Array.isArray(oldComments) || !oldComments.every((comment) => typeof comment === "string")) {
        throw new Error("Los comentarios antiguos tienen un formato no válido.");
    }

    const legacyArticles = stored === null ? [] : JSON.parse(stored);
    if (!Array.isArray(legacyArticles)) throw new Error("Las noticias antiguas tienen un formato no válido.");

    if (oldComments.length) {
        const squishy = legacyArticles.find((article) => article && article.id === "squishy");
        if (squishy) {
            squishy.comments = [...new Set([
                ...(Array.isArray(squishy.comments) ? squishy.comments : []),
                ...oldComments
            ])];
        } else {
            legacyArticles.push({
                id: "squishy",
                title: "Explocion de squishy",
                body: "Ocurrió una explosión de un squishy en la escuela. La causó un estudiante que estaba jugando con su squishy y lo explotó.",
                date: new Date().toISOString(),
                comments: oldComments
            });
        }
    }

    if (legacyArticles.length) {
        await api("/api/admin/import-legacy", {
            method: "POST",
            body: JSON.stringify({ articles: legacyArticles })
        });
    }
    localStorage.setItem("cdam-news-migrated", "true");
}

function createCommentForm(article) {
    const section = document.createElement("section");
    const heading = document.createElement("h3");
    const message = document.createElement("p");
    const form = document.createElement("form");
    const label = document.createElement("label");
    const input = document.createElement("textarea");
    const submit = document.createElement("button");
    const list = document.createElement("ul");

    heading.textContent = "Comentarios";
    message.setAttribute("role", "alert");
    message.setAttribute("aria-live", "polite");
    label.textContent = "Escribe un comentario";
    label.appendChild(input);
    input.rows = 3;
    input.maxLength = 500;
    input.required = true;
    submit.type = "submit";
    submit.textContent = "Agregar comentario";
    list.className = "commentsList";
    list.setAttribute("aria-live", "polite");
    article.comments.forEach((comment) => {
        const item = document.createElement("li");
        item.textContent = comment;
        list.appendChild(item);
    });

    form.append(label, submit);
    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const comment = input.value.trim();
        if (!comment) {
            input.focus();
            return;
        }

        setFormBusy(form, true);
        try {
            await api(`/api/news/${encodeURIComponent(article.id)}/comments`, {
                method: "POST",
                body: JSON.stringify({ comment })
            });
            message.textContent = "";
            const item = document.createElement("li");
            item.textContent = comment;
            list.appendChild(item);
            input.value = "";
            input.focus();
        } catch (error) {
            showError(message, error);
        } finally {
            setFormBusy(form, false);
        }
    });

    section.append(heading, message, form, list);
    return section;
}

function createLikeButton(article) {
    const button = document.createElement("button");
    const render = () => {
        const liked = likeState.get(article.id) === true;
        button.setAttribute("aria-pressed", String(liked));
        button.textContent = liked ? "Te gusta (1)" : "Me gusta (0)";
    };

    button.type = "button";
    button.addEventListener("click", () => {
        likeState.set(article.id, likeState.get(article.id) !== true);
        render();
    });
    render();
    return button;
}

function renderArticles(articles) {
    const fragment = document.createDocumentFragment();
    articles.forEach((article) => {
        const card = document.createElement("article");
        const heading = document.createElement("h2");
        const date = document.createElement("time");
        const paragraph = document.createElement("p");

        heading.textContent = article.title;
        date.dateTime = article.date;
        date.textContent = dateFormatter.format(new Date(article.date));
        paragraph.textContent = article.body;
        card.append(heading, date, paragraph);
        if (article.id === "squishy") card.appendChild(createLikeButton(article));
        card.appendChild(createCommentForm(article));
        fragment.appendChild(card);
    });
    articlesElement.replaceChildren(fragment);
}

readerLoginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const message = document.getElementById("readerMessage");
    setFormBusy(readerLoginForm, true);
    message.textContent = "";
    try {
        await api("/api/auth/reader", {
            method: "POST",
            body: JSON.stringify({ password: passwordInput.value })
        });
        passwordInput.value = "";
        await loadArticles();
        setSession({ reader: true, admin: false });
    } catch (error) {
        showError(message, error);
    } finally {
        setFormBusy(readerLoginForm, false);
    }
});

adminLoginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const message = document.getElementById("adminLoginMessage");
    setFormBusy(adminLoginForm, true);
    message.textContent = "";
    try {
        await api("/api/auth/admin", {
            method: "POST",
            body: JSON.stringify({
                username: document.getElementById("adminUsername").value,
                password: document.getElementById("adminPassword").value
            })
        });
        document.getElementById("adminPassword").value = "";
        await importLegacyArticles();
        await loadArticles();
        setSession({ reader: true, admin: true });
    } catch (error) {
        showError(message, error);
    } finally {
        setFormBusy(adminLoginForm, false);
    }
});

newsForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const title = document.getElementById("newsTitle").value.trim();
    const body = document.getElementById("newsBody").value.trim();
    if (!title || !body) return;

    setFormBusy(newsForm, true);
    publishMessage.textContent = "";
    try {
        await api("/api/news", {
            method: "POST",
            body: JSON.stringify({ title, body })
        });
        newsForm.reset();
        publishMessage.textContent = "Noticia publicada.";
        await loadArticles();
    } catch (error) {
        showError(publishMessage, error);
    } finally {
        setFormBusy(newsForm, false);
    }
});

document.getElementById("logoutButton").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    const message = document.getElementById("sessionMessage");
    button.disabled = true;
    try {
        await api("/api/auth/logout", { method: "POST", body: "{}" });
        setSession({ reader: false, admin: false });
        articlesElement.replaceChildren();
    } catch (error) {
        showError(message, error);
    } finally {
        button.disabled = false;
    }
});

api("/api/auth/status")
    .then(async (status) => {
        if (status.reader || status.admin) await loadArticles();
        setSession(status);
    })
    .catch((error) => {
        showError(document.getElementById("readerMessage"), error);
    });
