import { auth, db, rtdb } from "./firebase-config.js";
import {
    collection,
    doc,
    onSnapshot,
    orderBy,
    query
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";
import {
    onAuthStateChanged,
    signOut
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-auth.js";
import { onValue, ref } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-database.js";

function toBase64UrlUtf8(value) {
    const bytes = new TextEncoder().encode(value);
    let binary = "";
    bytes.forEach((b) => {
        binary += String.fromCharCode(b);
    });
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function normalizeGoogleDriveImageUrl(rawUrl) {
    try {
        const url = new URL(rawUrl);
        if (!url.hostname.includes("drive.google.com")) return rawUrl;

        const fileMatch = url.pathname.match(/\/file\/d\/([^/]+)/);
        if (fileMatch?.[1]) return `https://drive.google.com/uc?export=view&id=${fileMatch[1]}`;

        const id = url.searchParams.get("id");
        if (id) return `https://drive.google.com/uc?export=view&id=${id}`;

        return rawUrl;
    } catch (_) {
        return rawUrl;
    }
}

function normalizeOneDriveImageUrl(rawUrl) {
    try {
        const url = new URL(rawUrl);
        const host = url.hostname.toLowerCase();
        if (!host.includes("onedrive.live.com") && !host.includes("1drv.ms")) return rawUrl;

        if (host.includes("1drv.ms")) {
            const encoded = toBase64UrlUtf8(rawUrl);
            return `https://api.onedrive.com/v1.0/shares/u!${encoded}/root/content`;
        }

        const cid = url.searchParams.get("cid");
        const resid = url.searchParams.get("resid");
        if (cid && resid) {
            return `https://onedrive.live.com/download?cid=${encodeURIComponent(cid)}&resid=${encodeURIComponent(resid)}&authkey=${encodeURIComponent(url.searchParams.get("authkey") || "")}`;
        }

        return rawUrl;
    } catch (_) {
        return rawUrl;
    }
}

function normalizeCloudImageUrl(rawUrl) {
    const trimmed = String(rawUrl || "").trim();
    if (!trimmed) return "";
    if (trimmed.includes("drive.google.com")) return normalizeGoogleDriveImageUrl(trimmed);
    if (trimmed.includes("1drv.ms") || trimmed.includes("onedrive.live.com")) return normalizeOneDriveImageUrl(trimmed);
    return trimmed;
}

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

function renderSiteConfig(cfg = {}) {
    const verseTextEl = document.querySelector("[data-site='verse-text']");
    const verseRefEl = document.querySelector("[data-site='verse-ref']");
    const yearThemeEl = document.querySelector("[data-site='theme-year']");
    const semThemeEl = document.querySelector("[data-site='theme-semester']");
    const contactEmailEl = document.querySelector("[data-site='contact-email']");
    const fellowshipDayEl = document.querySelector("[data-site='fellowship-day']");
    const fellowshipTimeEl = document.querySelector("[data-site='fellowship-time']");
    const fellowshipVenueEl = document.querySelector("[data-site='fellowship-venue']");

    if (verseTextEl) verseTextEl.textContent = cfg.verseText || "Verse will be published by the ministry office.";
    if (verseRefEl) verseRefEl.textContent = cfg.verseReference || "-";
    if (yearThemeEl) yearThemeEl.textContent = cfg.themeYear || "Not set yet.";
    if (semThemeEl) semThemeEl.textContent = cfg.themeDay || cfg.themeSemester || "Not set yet.";
    if (contactEmailEl) contactEmailEl.textContent = cfg.contactEmail || "Not set yet.";
    if (fellowshipDayEl) fellowshipDayEl.textContent = cfg.fellowshipDay || "Not set yet.";
    if (fellowshipTimeEl) fellowshipTimeEl.textContent = cfg.fellowshipTime || "Not set yet.";
    if (fellowshipVenueEl) fellowshipVenueEl.textContent = cfg.fellowshipVenue || "Not set yet.";
}

function watchSiteConfig() {
    onSnapshot(doc(db, "site_config", "current"), (snap) => {
        renderSiteConfig(snap.exists() ? snap.data() : {});
    });
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
                (photo) => {
                    const imageSrc = photo.image ? `data:image/jpeg;base64,${photo.image}` : normalizeCloudImageUrl(photo.url || "");
                    const title = photo.title || "Untitled";
                    const link = (photo.link || "").trim();
                    const body = `
                        <div style="width:100%;min-height:220px;display:grid;place-items:center;background:#f5f8fd;border:1px solid #dde6f2;border-radius:10px;padding:8px;">
                            <img src="${imageSrc}" alt="${title || "Gallery photo"}" style="width:100%;height:auto;max-height:420px;object-fit:contain;border-radius:8px;display:block;">
                        </div>
                        <h3 style="margin-top:10px;">${title}</h3>
                    `;

                    if (link) {
                        return `
                            <article class="card">
                                <a href="${link}" target="_blank" rel="noopener noreferrer" style="text-decoration:none;color:inherit;display:block;">
                                    ${body}
                                </a>
                            </article>`;
                    }

                    return `
                        <article class="card">
                            ${body}
                        </article>`;
                }
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
    watchSiteConfig();
    watchPrograms();
    watchEvents();
    watchGallery();
});
