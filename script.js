import { auth, db, rtdb } from "./firebase-config.js";
import {
    collection,
    doc,
    getDoc,
    onSnapshot,
    orderBy,
    query
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";
import {
    onAuthStateChanged,
    signOut
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-auth.js";
import { onValue, ref } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-database.js";

function initSidebar() {
    const sidebar = document.getElementById("sidebar");
    const hamburger = document.getElementById("hamburger");
    const overlay = document.getElementById("overlay");
    const main = document.querySelector(".main");
    if (!sidebar || !hamburger || !overlay) return;

    const isMobile = () => window.innerWidth <= 860;

    const closeMenu = () => {
        if (isMobile()) {
            sidebar.classList.remove("active");
            overlay.classList.remove("active");
        } else {
            sidebar.classList.add("closed");
            if (main) main.classList.add("expanded");
            overlay.classList.remove("active");
        }
    };

    const openMenu = () => {
        if (isMobile()) {
            sidebar.classList.add("active");
            overlay.classList.add("active");
        } else {
            sidebar.classList.remove("closed");
            if (main) main.classList.remove("expanded");
            overlay.classList.remove("active");
        }
    };

    hamburger.addEventListener("click", () => {
        if (isMobile()) {
            if (sidebar.classList.contains("active")) closeMenu();
            else openMenu();
            return;
        }
        if (sidebar.classList.contains("closed")) openMenu();
        else closeMenu();
    });

    overlay.addEventListener("click", () => {
        if (isMobile()) closeMenu();
    });

    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") closeMenu();
    });
}

function highlightCurrentNav() {
    const path = (window.location.pathname.split("/").pop() || "index.html").toLowerCase();
    document.querySelectorAll(".nav-links a").forEach((link) => {
        const href = (link.getAttribute("href") || "").toLowerCase();
        if (href === path) link.classList.add("active");
    });
}

function formatHumanDate(dateString) {
    const date = new Date(dateString);
    if (Number.isNaN(date.getTime())) return dateString;
    return date.toLocaleDateString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
        year: "numeric"
    });
}

async function loadSiteConfig() {
    const cfgSnap = await getDoc(doc(db, "site_config", "current"));
    const cfg = cfgSnap.exists() ? cfgSnap.data() : {};

    const verseTextEl = document.querySelector("[data-site='verse-text']");
    const verseRefEl = document.querySelector("[data-site='verse-ref']");
    const yearThemeEl = document.querySelector("[data-site='theme-year']");
    const semThemeEl = document.querySelector("[data-site='theme-semester']");

    if (verseTextEl) verseTextEl.textContent = cfg.verseText || "Verse will be published by the ministry office.";
    if (verseRefEl) verseRefEl.textContent = cfg.verseReference || "-";
    if (yearThemeEl) yearThemeEl.textContent = cfg.themeYear || "Not set yet.";
    if (semThemeEl) semThemeEl.textContent = cfg.themeDay || cfg.themeSemester || "Not set yet.";
}

function watchPrograms() {
    const container = document.getElementById("programsList");
    if (!container) return;
    const q = query(collection(db, "programs"), orderBy("createdAt", "desc"));
    onSnapshot(q, (snap) => {
        if (snap.empty) {
            container.innerHTML = "<li>Programs will be published by the ministry office.</li>";
            return;
        }
        container.innerHTML = snap.docs
            .map((d) => {
                const p = d.data();
                return `<li><strong>${p.day || "Day"}:</strong> ${p.title || ""} (${p.time || ""}, ${p.venue || ""})</li>`;
            })
            .join("");
    });
}

function watchEvents() {
    const container = document.getElementById("eventsList");
    if (!container) return;
    const q = query(collection(db, "events"), orderBy("date", "asc"));
    onSnapshot(q, (snap) => {
        if (snap.empty) {
            container.innerHTML = "<li>No events published yet.</li>";
            return;
        }
        container.innerHTML = snap.docs
            .map((d) => {
                const e = d.data();
                return `
                <li class="event-item">
                    <strong>${e.title || "Untitled Event"}</strong>
                    <div class="event-meta">
                        <span>${formatHumanDate(e.date || "")}</span>
                        <span>${e.time || ""}</span>
                        <span>${e.location || ""}</span>
                        <span class="chip">${e.category || "General"}</span>
                    </div>
                    <p>${e.description || ""}</p>
                </li>`;
            })
            .join("");
    });
}

function watchGallery() {
    const container = document.getElementById("galleryGrid");
    if (!container) return;
    onValue(ref(rtdb, "gallery"), (snap) => {
        const value = snap.val();
        if (!value) {
            container.innerHTML = "<p>No photos published yet.</p>";
            return;
        }
        const items = Object.entries(value)
            .map(([key, item]) => ({ key, ...item }))
            .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

        container.innerHTML = items
            .map(
                (photo) => `
                <article class="card">
                    <img src="${photo.url || ""}" alt="${photo.title || "Gallery photo"}" style="width:100%;height:220px;object-fit:cover;border-radius:10px;">
                    <h3 style="margin-top:10px;">${photo.title || "Untitled"}</h3>
                </article>`
            )
            .join("");
    });
}

function initOfficeBridge() {
    const actions = document.querySelector(".topbar-actions");
    if (!actions) return;

    onAuthStateChanged(auth, (user) => {
        const existingLogin = document.getElementById("officeLoginLink");
        const existingLink = document.getElementById("officeDashLink");
        const existingSignout = document.getElementById("officeSignoutBtn");
        const existingChip = document.getElementById("officeModeChip");

        if (existingLogin) existingLogin.remove();
        if (existingLink) existingLink.remove();
        if (existingSignout) existingSignout.remove();
        if (existingChip) existingChip.remove();

        if (!user) {
            const loginLink = document.createElement("a");
            loginLink.id = "officeLoginLink";
            loginLink.className = "btn btn-outline";
            loginLink.href = "admin-login.html";
            loginLink.textContent = "Office Login";
            actions.appendChild(loginLink);
            return;
        }

        const chip = document.createElement("span");
        chip.className = "chip";
        chip.id = "officeModeChip";
        chip.textContent = "Office Mode";

        const dashLink = document.createElement("a");
        dashLink.id = "officeDashLink";
        dashLink.className = "btn btn-outline";
        dashLink.href = "admin.html";
        dashLink.textContent = "Office Dashboard";

        const signoutBtn = document.createElement("button");
        signoutBtn.id = "officeSignoutBtn";
        signoutBtn.className = "btn btn-danger";
        signoutBtn.type = "button";
        signoutBtn.textContent = "Sign Out";
        signoutBtn.addEventListener("click", async () => {
            await signOut(auth);
            window.location.reload();
        });

        actions.appendChild(chip);
        actions.appendChild(dashLink);
        actions.appendChild(signoutBtn);
    });
}

document.addEventListener("DOMContentLoaded", async () => {
    initSidebar();
    highlightCurrentNav();
    initOfficeBridge();
    await loadSiteConfig();
    watchPrograms();
    watchEvents();
    watchGallery();
});
