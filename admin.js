import { auth, db, rtdb } from "./firebase-config.js";
import {
    addDoc,
    collection,
    deleteDoc,
    doc,
    limit,
    onSnapshot,
    orderBy,
    query,
    setDoc,
    updateDoc
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";
import {
    browserLocalPersistence,
    createUserWithEmailAndPassword,
    onAuthStateChanged,
    sendPasswordResetEmail,
    setPersistence,
    signInWithEmailAndPassword,
    signOut
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-auth.js";
import {
    onValue,
    push,
    get,
    ref as dbRef,
    remove,
    set,
    update as updateRtdb
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-database.js";

const MAX_IMAGE_BYTES = 1024 * 1024;

function escAttr(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

function initOfficeSidebar() {
    const sidebar = document.getElementById("officeSidebar");
    const main = document.querySelector(".office-main");
    const burger = document.getElementById("officeHamburger");
    const overlay = document.getElementById("officeOverlay");
    if (!sidebar || !main || !burger || !overlay) return;

    const isMobile = () => window.innerWidth <= 900;

    const closeSidebar = () => {
        if (isMobile()) {
            sidebar.classList.remove("active");
            overlay.classList.remove("active");
            burger.setAttribute("aria-expanded", "false");
        } else {
            sidebar.classList.add("closed");
            main.classList.add("expanded");
            burger.setAttribute("aria-expanded", "false");
        }
    };

    const openSidebar = () => {
        if (isMobile()) {
            sidebar.classList.add("active");
            overlay.classList.add("active");
            burger.setAttribute("aria-expanded", "true");
        } else {
            sidebar.classList.remove("closed");
            main.classList.remove("expanded");
            burger.setAttribute("aria-expanded", "true");
        }
    };

    burger.addEventListener("click", () => {
        if (isMobile()) {
            if (sidebar.classList.contains("active")) closeSidebar();
            else openSidebar();
            return;
        }
        if (sidebar.classList.contains("closed")) openSidebar();
        else closeSidebar();
    });

    overlay.addEventListener("click", closeSidebar);

    document.addEventListener("click", (event) => {
        if (!isMobile()) return;
        const clickedOutsideSidebar = !sidebar.contains(event.target) && !burger.contains(event.target);
        if (clickedOutsideSidebar) closeSidebar();
    });

    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") closeSidebar();
    });

    window.addEventListener("resize", () => {
        if (isMobile()) {
            sidebar.classList.remove("closed");
            main.classList.remove("expanded");
            burger.setAttribute("aria-expanded", sidebar.classList.contains("active") ? "true" : "false");
        } else {
            sidebar.classList.remove("active");
            overlay.classList.remove("active");
            burger.setAttribute("aria-expanded", sidebar.classList.contains("closed") ? "false" : "true");
        }
    });

    burger.setAttribute("aria-expanded", "true");
}

function initOfficeSections() {
    const links = Array.from(document.querySelectorAll(".office-links a[data-section]"));
    const sections = Array.from(document.querySelectorAll(".office-section"));
    if (!links.length || !sections.length) return;

    const activate = (sectionId) => {
        sections.forEach((section) => {
            if (section.id === sectionId) section.classList.add("active");
            else section.classList.remove("active");
        });

        links.forEach((link) => {
            if (link.getAttribute("data-section") === sectionId) link.classList.add("active");
            else link.classList.remove("active");
        });
    };

    links.forEach((link) => {
        link.addEventListener("click", (e) => {
            e.preventDefault();
            const target = link.getAttribute("data-section");
            activate(target);

            // Match user-side behavior: close sidebar after selecting on mobile.
            const sidebar = document.getElementById("officeSidebar");
            const overlay = document.getElementById("officeOverlay");
            const burger = document.getElementById("officeHamburger");
            if (window.innerWidth <= 900 && sidebar && overlay && burger) {
                sidebar.classList.remove("active");
                overlay.classList.remove("active");
                burger.setAttribute("aria-expanded", "false");
            }
        });
    });

    activate(links[0].getAttribute("data-section"));
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

function toMillis(value) {
    if (typeof value === "number") return value;
    if (value instanceof Date) return value.getTime();
    if (typeof value === "string") {
        const parsed = Date.parse(value);
        return Number.isNaN(parsed) ? Date.now() : parsed;
    }
    // Firestore Timestamp-like object
    if (value && typeof value === "object" && typeof value.seconds === "number") {
        return (value.seconds * 1000) + Math.floor((value.nanoseconds || 0) / 1e6);
    }
    return Date.now();
}

function loadImageFromFile(file) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
            URL.revokeObjectURL(url);
            resolve(img);
        };
        img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error("Failed to load image."));
        };
        img.src = url;
    });
}

function canvasToBlob(canvas, quality) {
    return new Promise((resolve) => {
        canvas.toBlob(
            (blob) => resolve(blob),
            "image/jpeg",
            quality
        );
    });
}

function fileToBase64NoPrefix(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const result = String(reader.result || "");
            const base64 = result.includes(",") ? result.split(",")[1] : result;
            resolve(base64);
        };
        reader.onerror = () => reject(new Error("Failed to read file as base64."));
        reader.readAsDataURL(file);
    });
}

async function compressImageTo1MB(file) {
    if (file.size <= MAX_IMAGE_BYTES) return file;

    const img = await loadImageFromFile(file);
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");

    let width = img.width;
    let height = img.height;
    let quality = 0.9;
    let outputBlob = null;

    for (let pass = 0; pass < 8; pass += 1) {
        canvas.width = Math.max(1, Math.floor(width));
        canvas.height = Math.max(1, Math.floor(height));
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        outputBlob = await canvasToBlob(canvas, quality);
        if (outputBlob && outputBlob.size <= MAX_IMAGE_BYTES) break;

        if (quality > 0.45) {
            quality -= 0.1;
        } else {
            width *= 0.85;
            height *= 0.85;
        }
    }

    if (!outputBlob) throw new Error("Failed to compress image.");

    const extension = (file.name.split(".").pop() || "jpg").toLowerCase();
    const baseName = file.name.replace(/\.[^.]+$/, "") || "photo";
    return new File([outputBlob], `${baseName}-compressed.${extension === "png" ? "jpg" : extension}`, {
        type: "image/jpeg"
    });
}

function initOfficeLogin() {
    const loginForm = document.getElementById("adminLoginForm");
    if (!loginForm) return;

    const status = document.getElementById("loginStatus");
    const createBtn = document.getElementById("createAccountBtn");
    const resetBtn = document.getElementById("resetPasswordBtn");

    const showStatus = (message, isError = false) => {
        if (!status) return;
        status.textContent = message;
        status.style.color = isError ? "#b3261e" : "#0f4c81";
    };

    const mapAuthError = (code) => {
        const known = {
            "auth/invalid-email": "Invalid email format.",
            "auth/user-not-found": "No account found for this email.",
            "auth/wrong-password": "Wrong password.",
            "auth/invalid-credential": "Invalid email or password.",
            "auth/too-many-requests": "Too many attempts. Try again later.",
            "auth/network-request-failed": "Network error. Check internet connection.",
            "auth/email-already-in-use": "This email is already in use.",
            "auth/weak-password": "Password is too weak (minimum 6 characters).",
            "auth/operation-not-allowed": "Email/password sign-in is not enabled in Firebase Auth."
        };
        return known[code] || "Authentication failed. Check Firebase setup and try again.";
    };

    onAuthStateChanged(auth, (user) => {
        if (user) window.location.href = "admin.html";
    });

    loginForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const email = document.getElementById("adminEmail").value.trim();
        const password = document.getElementById("adminPassword").value;
        const loginBtn = loginForm.querySelector("button[type='submit']");
        try {
            if (loginBtn) loginBtn.disabled = true;
            showStatus("Signing in...");
            await setPersistence(auth, browserLocalPersistence);
            await signInWithEmailAndPassword(auth, email, password);
            window.location.href = "admin.html";
        } catch (error) {
            showStatus(mapAuthError(error.code), true);
        } finally {
            if (loginBtn) loginBtn.disabled = false;
        }
    });

    if (createBtn) {
        createBtn.addEventListener("click", async () => {
            const email = document.getElementById("adminEmail").value.trim();
            const password = document.getElementById("adminPassword").value;
            if (!email || !password) {
                showStatus("Enter email and password first.", true);
                return;
            }
            try {
                await setPersistence(auth, browserLocalPersistence);
                await createUserWithEmailAndPassword(auth, email, password);
                showStatus("Office account created and signed in.");
                window.location.href = "admin.html";
            } catch (error) {
                showStatus(mapAuthError(error.code), true);
            }
        });
    }

    if (resetBtn) {
        resetBtn.addEventListener("click", async () => {
            const email = document.getElementById("adminEmail").value.trim();
            if (!email) {
                showStatus("Enter your office email first to reset password.", true);
                return;
            }
            try {
                await sendPasswordResetEmail(auth, email);
                showStatus("Password reset email sent.");
            } catch (error) {
                showStatus(mapAuthError(error.code), true);
            }
        });
    }
}

function initOfficeDashboard() {
    const dashboard = document.getElementById("adminDashboard");
    if (!dashboard) return;

    const status = document.getElementById("adminStatus");
    const setStatus = (message, isError = false) => {
        if (!status) return;
        status.textContent = message;
        status.style.color = isError ? "#b3261e" : "#0f4c81";
    };

    initOfficeSidebar();
    initOfficeSections();

    onAuthStateChanged(auth, (user) => {
        if (!user) {
            window.location.href = "admin-login.html";
            return;
        }
        const emailTag = document.getElementById("officeUserEmail");
        if (emailTag) emailTag.textContent = user.email || "Signed in";
    });

    const logoutBtn = document.getElementById("logoutBtn");
    if (logoutBtn) {
        logoutBtn.addEventListener("click", async () => {
            await signOut(auth);
            window.location.href = "admin-login.html";
        });
    }

    const programsList = document.getElementById("adminProgramsList");
    const eventsList = document.getElementById("eventsList");
    const photosList = document.getElementById("adminPhotosList");
    const activityFeed = document.getElementById("activityFeed");
    let localActivityItems = [];

    const renderActivityItems = (items) => {
        if (!activityFeed) return;
        if (!items.length) {
            activityFeed.innerHTML = "<li>No activity yet.</li>";
            return;
        }
        activityFeed.innerHTML = items
            .map((a) => {
                const time = formatHumanDate(new Date(toMillis(a.createdAt)).toISOString());
                const deleteBtn = a.id
                    ? ` <button class="btn btn-danger" data-delete-activity="${a.id}" type="button">Delete</button>`
                    : "";
                return `<li><strong>${a.message || "Update"}</strong><div class="event-meta"><span>${time}</span><span class="chip">${a.type || "info"}</span>${deleteBtn}</div></li>`;
            })
            .join("");
    };

    const logActivity = async (message, type = "info") => {
        const localItem = { message, type, createdAt: Date.now() };
        localActivityItems = [localItem, ...localActivityItems].slice(0, 40);
        renderActivityItems(localActivityItems);

        try {
            await addDoc(collection(db, "activity_logs"), {
                message,
                type,
                createdAt: Date.now()
            });
        } catch (error) {
            const denied =
                error?.code === "permission-denied" ||
                error?.code === "auth/insufficient-permission";
            if (denied) {
                setStatus("Activity log is blocked by Firestore rules. Update rules for activity_logs.", true);
            }
        }
    };

    onSnapshot(query(collection(db, "programs"), orderBy("createdAt", "desc")), (snap) => {
        if (!programsList) return;
        if (snap.empty) {
            programsList.innerHTML = "<li>No weekly programs yet.</li>";
            return;
        }
        programsList.innerHTML = snap.docs
            .map((d) => {
                const p = d.data();
                return `<li><strong>${p.day || ""}</strong> - ${p.title || ""} (${p.time || ""}, ${p.venue || ""}) <button class="btn btn-outline" data-edit-program="${d.id}" data-day="${escAttr(p.day)}" data-title="${escAttr(p.title)}" data-time="${escAttr(p.time)}" data-venue="${escAttr(p.venue)}" type="button">Edit</button> <button class="btn btn-danger" data-delete-program="${d.id}" type="button">Delete Program</button></li>`;
            })
            .join("");
    });

    onSnapshot(query(collection(db, "events"), orderBy("date", "asc")), (snap) => {
        if (!eventsList) return;
        if (snap.empty) {
            eventsList.innerHTML = "<li>No events yet.</li>";
            return;
        }
        eventsList.innerHTML = snap.docs
            .map((d) => {
                const e = d.data();
                return `<li><strong>${e.title || ""}</strong><div class="event-meta"><span>${formatHumanDate(e.date || "")}</span><span>${e.time || ""}</span><span>${e.location || ""}</span><span class="chip">${e.category || "General"}</span></div><p>${e.description || ""}</p><button class="btn btn-outline" data-edit-event="${d.id}" data-title="${escAttr(e.title)}" data-date="${escAttr(e.date)}" data-time="${escAttr(e.time)}" data-location="${escAttr(e.location)}" data-category="${escAttr(e.category)}" data-description="${escAttr(e.description)}" type="button">Edit</button> <button class="btn btn-danger" data-delete-event="${d.id}" type="button">Delete Event</button></li>`;
            })
            .join("");
    });

    onValue(dbRef(rtdb, "gallery"), (snap) => {
        if (!photosList) return;
        const value = snap.val();
        if (!value) {
            photosList.innerHTML = "<li>No gallery photos yet.</li>";
            return;
        }
        const items = Object.entries(value)
            .map(([key, item]) => ({ key, ...item }))
            .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        photosList.innerHTML = items
            .map(
                (p) => {
                    const imageSrc = p.image ? `data:image/jpeg;base64,${p.image}` : (p.url || "");
                    return `<li><strong>${p.title || ""}</strong><p><img src="${imageSrc}" alt="${escAttr(p.title)}" style="width:100%;max-width:220px;border-radius:8px;border:1px solid #dde6f2;"></p><p>${p.link ? `Opens: ${escAttr(p.link)}` : "No external link set."}</p><button class="btn btn-outline" data-edit-photo="${p.key}" data-title="${escAttr(p.title)}" data-link="${escAttr(p.link || "")}" type="button">Edit</button> <button class="btn btn-danger" data-delete-photo="${p.key}" type="button">Delete Photo</button></li>`;
                }
            )
            .join("");
    });

    if (activityFeed) {
        const activityQuery = query(collection(db, "activity_logs"), orderBy("createdAt", "desc"), limit(40));
        onSnapshot(
            activityQuery,
            (snap) => {
                if (snap.empty) {
                    renderActivityItems(localActivityItems);
                    return;
                }
                localActivityItems = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
                renderActivityItems(localActivityItems);
            },
            () => {
                renderActivityItems(localActivityItems);
                setStatus("Realtime activity feed is blocked by Firestore rules.", true);
            }
        );
    }

    const addProgramForm = document.getElementById("addProgramForm");
    if (addProgramForm) {
        addProgramForm.addEventListener("submit", async (e) => {
            e.preventDefault();
            const payload = {
                day: document.getElementById("programDay").value.trim(),
                title: document.getElementById("programTitle").value.trim(),
                time: document.getElementById("programTime").value.trim(),
                venue: document.getElementById("programVenue").value.trim(),
                createdAt: Date.now()
            };
            await addDoc(collection(db, "programs"), payload);
            addProgramForm.reset();
            setStatus("Weekly program added.");
            await logActivity(`Added weekly program: ${payload.day} - ${payload.title}`, "program");
        });
    }

    const addEventForm = document.getElementById("addEventForm");
    if (addEventForm) {
        addEventForm.addEventListener("submit", async (e) => {
            e.preventDefault();
            const payload = {
                title: document.getElementById("eventTitle").value.trim(),
                date: document.getElementById("eventDate").value,
                time: document.getElementById("eventTime").value.trim(),
                location: document.getElementById("eventLocation").value.trim(),
                category: document.getElementById("eventCategory").value.trim() || "General",
                description: document.getElementById("eventDescription").value.trim(),
                createdAt: Date.now()
            };
            await addDoc(collection(db, "events"), payload);
            addEventForm.reset();
            setStatus("Event added.");
            await logActivity(`Added event: ${payload.title}`, "event");
        });
    }

    const cfgForm = document.getElementById("siteConfigForm");
    if (cfgForm) {
        onSnapshot(doc(db, "site_config", "current"), (snap) => {
            const cfg = snap.exists() ? snap.data() : {};
            document.getElementById("cfgVerseRef").value = cfg.verseReference || "";
            document.getElementById("cfgVerseText").value = cfg.verseText || "";
            document.getElementById("cfgYearTheme").value = cfg.themeYear || "";
            document.getElementById("cfgDayTheme").value = cfg.themeDay || cfg.themeSemester || "";
            document.getElementById("cfgContactEmail").value = cfg.contactEmail || "";
            document.getElementById("cfgFellowshipDay").value = cfg.fellowshipDay || "";
            document.getElementById("cfgFellowshipTime").value = cfg.fellowshipTime || "";
            document.getElementById("cfgFellowshipVenue").value = cfg.fellowshipVenue || "";
        });

        cfgForm.addEventListener("submit", async (e) => {
            e.preventDefault();
            const payload = {
                verseReference: document.getElementById("cfgVerseRef").value.trim(),
                verseText: document.getElementById("cfgVerseText").value.trim(),
                themeYear: document.getElementById("cfgYearTheme").value.trim(),
                themeDay: document.getElementById("cfgDayTheme").value.trim(),
                contactEmail: document.getElementById("cfgContactEmail").value.trim(),
                fellowshipDay: document.getElementById("cfgFellowshipDay").value.trim(),
                fellowshipTime: document.getElementById("cfgFellowshipTime").value.trim(),
                fellowshipVenue: document.getElementById("cfgFellowshipVenue").value.trim(),
                updatedAt: Date.now()
            };
            await setDoc(doc(db, "site_config", "current"), payload, { merge: true });
            setStatus("Verse and themes updated.");
            await logActivity("Updated verse and themes", "theme");
        });
    }

    const photoForm = document.getElementById("photoForm");
    if (photoForm) {
        photoForm.addEventListener("submit", async (e) => {
            e.preventDefault();
            const title = document.getElementById("photoTitle").value.trim();
            const link = document.getElementById("photoDriveLink").value.trim();
            const file = document.getElementById("photoFile").files[0];
            if (!title || !file) {
                setStatus("Photo title and image file are required.", true);
                return;
            }
            try {
                setStatus("Compressing image...");
                const compressedFile = await compressImageTo1MB(file);
                const imageBase64 = await fileToBase64NoPrefix(compressedFile);

                if (imageBase64.length >= 1500000) {
                    setStatus("Image is still too large after compression. Use a smaller image.", true);
                    return;
                }

                const photoRef = push(dbRef(rtdb, "gallery"));
                await set(photoRef, {
                    title,
                    image: imageBase64,
                    link: link || "",
                    createdAt: Date.now()
                });

                photoForm.reset();
                setStatus("Gallery item added successfully.");
                await logActivity(`Added gallery item: ${title}`, "gallery");
            } catch (_) {
                setStatus("Failed to add gallery item. Check the link or image file.", true);
            }
        });
    }

    document.addEventListener("click", async (e) => {
        const activityBtn = e.target.closest("[data-delete-activity]");
        if (activityBtn) {
            const id = activityBtn.getAttribute("data-delete-activity");
            if (!id) return;
            await deleteDoc(doc(db, "activity_logs", id));
            setStatus("Activity item deleted.");
            return;
        }

        const editProgramBtn = e.target.closest("[data-edit-program]");
        if (editProgramBtn) {
            const id = editProgramBtn.getAttribute("data-edit-program");
            const day = prompt("Edit Day", editProgramBtn.getAttribute("data-day") || "");
            if (day === null) return;
            const title = prompt("Edit Program Title", editProgramBtn.getAttribute("data-title") || "");
            if (title === null) return;
            const time = prompt("Edit Time", editProgramBtn.getAttribute("data-time") || "");
            if (time === null) return;
            const venue = prompt("Edit Venue", editProgramBtn.getAttribute("data-venue") || "");
            if (venue === null) return;

            await updateDoc(doc(db, "programs", id), {
                day: day.trim(),
                title: title.trim(),
                time: time.trim(),
                venue: venue.trim(),
                updatedAt: Date.now()
            });
            setStatus("Weekly program updated.");
            await logActivity(`Updated weekly program: ${day.trim()} - ${title.trim()}`, "program");
            return;
        }

        const programBtn = e.target.closest("[data-delete-program]");
        if (programBtn) {
            await deleteDoc(doc(db, "programs", programBtn.getAttribute("data-delete-program")));
            setStatus("Weekly program removed.");
            await logActivity("Deleted a weekly program", "program");
            return;
        }

        const editEventBtn = e.target.closest("[data-edit-event]");
        if (editEventBtn) {
            const id = editEventBtn.getAttribute("data-edit-event");
            const title = prompt("Edit Event Title", editEventBtn.getAttribute("data-title") || "");
            if (title === null) return;
            const date = prompt("Edit Date (YYYY-MM-DD)", editEventBtn.getAttribute("data-date") || "");
            if (date === null) return;
            const time = prompt("Edit Time", editEventBtn.getAttribute("data-time") || "");
            if (time === null) return;
            const location = prompt("Edit Location", editEventBtn.getAttribute("data-location") || "");
            if (location === null) return;
            const category = prompt("Edit Category", editEventBtn.getAttribute("data-category") || "");
            if (category === null) return;
            const description = prompt("Edit Description", editEventBtn.getAttribute("data-description") || "");
            if (description === null) return;

            await updateDoc(doc(db, "events", id), {
                title: title.trim(),
                date: date.trim(),
                time: time.trim(),
                location: location.trim(),
                category: category.trim() || "General",
                description: description.trim(),
                updatedAt: Date.now()
            });
            setStatus("Event updated.");
            await logActivity(`Updated event: ${title.trim()}`, "event");
            return;
        }

        const eventBtn = e.target.closest("[data-delete-event]");
        if (eventBtn) {
            await deleteDoc(doc(db, "events", eventBtn.getAttribute("data-delete-event")));
            setStatus("Event removed.");
            await logActivity("Deleted an event", "event");
            return;
        }

        const editPhotoBtn = e.target.closest("[data-edit-photo]");
        if (editPhotoBtn) {
            const key = editPhotoBtn.getAttribute("data-edit-photo");
            const title = prompt("Edit Photo Title", editPhotoBtn.getAttribute("data-title") || "");
            if (title === null) return;
            const link = prompt("Edit Drive/OneDrive Link (optional)", editPhotoBtn.getAttribute("data-link") || "");
            if (link === null) return;
            const currentSnap = await get(dbRef(rtdb, `gallery/${key}`));
            const current = currentSnap.val();
            if (!current || !current.image) {
                setStatus("Photo record missing image payload.", true);
                return;
            }

            await set(dbRef(rtdb, `gallery/${key}`), {
                title: title.trim(),
                image: current.image,
                link: link.trim(),
                createdAt: current.createdAt || Date.now(),
                updatedAt: Date.now()
            });
            setStatus("Photo updated.");
            await logActivity(`Updated gallery item: ${title.trim()}`, "gallery");
            return;
        }

        const photoBtn = e.target.closest("[data-delete-photo]");
        if (photoBtn) {
            const key = photoBtn.getAttribute("data-delete-photo");
            await remove(dbRef(rtdb, `gallery/${key}`));
            setStatus("Photo removed.");
            await logActivity("Deleted a gallery item", "gallery");
        }
    });
}

document.addEventListener("DOMContentLoaded", () => {
    initOfficeLogin();
    initOfficeDashboard();
});
