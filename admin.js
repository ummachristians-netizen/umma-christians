import { auth, db, rtdb, storage } from "./firebase-config.js";
import {
    addDoc,
    collection,
    deleteDoc,
    doc,
    onSnapshot,
    orderBy,
    query,
    setDoc
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
    ref as dbRef,
    remove,
    set
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-database.js";
import {
    deleteObject,
    getDownloadURL,
    ref as storageRef,
    uploadBytes
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-storage.js";

const MAX_IMAGE_BYTES = 1024 * 1024;

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

function normalizeImageUrl(rawUrl) {
    const url = (rawUrl || "").trim();
    if (!url) return "";

    // Google Drive share links -> direct view links
    const driveFileMatch = url.match(/drive\.google\.com\/file\/d\/([^/]+)/i);
    if (driveFileMatch) {
        return `https://drive.google.com/uc?export=view&id=${driveFileMatch[1]}`;
    }

    const driveOpenMatch = url.match(/[?&]id=([a-zA-Z0-9_-]+)/i);
    if (/drive\.google\.com/i.test(url) && driveOpenMatch) {
        return `https://drive.google.com/uc?export=view&id=${driveOpenMatch[1]}`;
    }

    return url;
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

    onSnapshot(query(collection(db, "programs"), orderBy("createdAt", "desc")), (snap) => {
        if (!programsList) return;
        if (snap.empty) {
            programsList.innerHTML = "<li>No weekly programs yet.</li>";
            return;
        }
        programsList.innerHTML = snap.docs
            .map((d) => {
                const p = d.data();
                return `<li><strong>${p.day || ""}</strong> - ${p.title || ""} (${p.time || ""}, ${p.venue || ""}) <button class="btn btn-danger" data-delete-program="${d.id}" type="button">Delete Program</button></li>`;
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
                return `<li><strong>${e.title || ""}</strong><div class="event-meta"><span>${formatHumanDate(e.date || "")}</span><span>${e.time || ""}</span><span>${e.location || ""}</span><span class="chip">${e.category || "General"}</span></div><p>${e.description || ""}</p><button class="btn btn-danger" data-delete-event="${d.id}" type="button">Delete Event</button></li>`;
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
                (p) => `<li><strong>${p.title || ""}</strong><p>${p.url || ""}</p><button class="btn btn-danger" data-delete-photo="${p.key}" data-storage-path="${p.storagePath || ""}" type="button">Delete Photo</button></li>`
            )
            .join("");
    });

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
        });
    }

    const cfgForm = document.getElementById("siteConfigForm");
    if (cfgForm) {
        onSnapshot(doc(db, "site_config", "current"), (snap) => {
            const cfg = snap.exists() ? snap.data() : {};
            document.getElementById("cfgVerseRef").value = cfg.verseReference || "";
            document.getElementById("cfgVerseText").value = cfg.verseText || "";
            document.getElementById("cfgYearTheme").value = cfg.themeYear || "";
            document.getElementById("cfgSemesterTheme").value = cfg.themeSemester || "";
        });

        cfgForm.addEventListener("submit", async (e) => {
            e.preventDefault();
            const payload = {
                verseReference: document.getElementById("cfgVerseRef").value.trim(),
                verseText: document.getElementById("cfgVerseText").value.trim(),
                themeYear: document.getElementById("cfgYearTheme").value.trim(),
                themeSemester: document.getElementById("cfgSemesterTheme").value.trim(),
                updatedAt: Date.now()
            };
            await setDoc(doc(db, "site_config", "current"), payload, { merge: true });
            setStatus("Verse and themes updated.");
        });
    }

    const photoForm = document.getElementById("photoForm");
    if (photoForm) {
        photoForm.addEventListener("submit", async (e) => {
            e.preventDefault();
            const title = document.getElementById("photoTitle").value.trim();
            const rawUrl = document.getElementById("photoUrl").value.trim();
            const photoUrl = normalizeImageUrl(rawUrl);
            const file = document.getElementById("photoFile").files[0];
            if (!title || (!photoUrl && !file)) {
                setStatus("Photo title and either image link or file are required.", true);
                return;
            }
            try {
                const photoRef = push(dbRef(rtdb, "gallery"));

                if (photoUrl) {
                    await set(photoRef, {
                        title,
                        url: photoUrl,
                        storagePath: "",
                        fileSize: 0,
                        createdAt: Date.now()
                    });
                } else {
                    setStatus("Compressing image...");
                    const compressedFile = await compressImageTo1MB(file);
                    const path = `gallery/${Date.now()}-${compressedFile.name}`;
                    const fileRef = storageRef(storage, path);
                    await uploadBytes(fileRef, compressedFile);
                    const url = await getDownloadURL(fileRef);
                    await set(photoRef, {
                        title,
                        url,
                        storagePath: path,
                        fileSize: compressedFile.size,
                        createdAt: Date.now()
                    });
                }

                photoForm.reset();
                setStatus("Gallery item added successfully.");
            } catch (_) {
                setStatus("Failed to add gallery item. Check the link or image file.", true);
            }
        });
    }

    document.addEventListener("click", async (e) => {
        const programBtn = e.target.closest("[data-delete-program]");
        if (programBtn) {
            await deleteDoc(doc(db, "programs", programBtn.getAttribute("data-delete-program")));
            setStatus("Weekly program removed.");
            return;
        }

        const eventBtn = e.target.closest("[data-delete-event]");
        if (eventBtn) {
            await deleteDoc(doc(db, "events", eventBtn.getAttribute("data-delete-event")));
            setStatus("Event removed.");
            return;
        }

        const photoBtn = e.target.closest("[data-delete-photo]");
        if (photoBtn) {
            const key = photoBtn.getAttribute("data-delete-photo");
            const path = photoBtn.getAttribute("data-storage-path");
            await remove(dbRef(rtdb, `gallery/${key}`));
            if (path) {
                try {
                    await deleteObject(storageRef(storage, path));
                } catch (_) {
                    // Ignore if file already removed.
                }
            }
            setStatus("Photo removed.");
        }
    });
}

document.addEventListener("DOMContentLoaded", () => {
    initOfficeLogin();
    initOfficeDashboard();
});
