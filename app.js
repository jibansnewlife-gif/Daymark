(() => {
  "use strict";

  const TASKS_KEY = "daymark-tasks-v3";
  const LEGACY_TASKS_KEY = "daymark-tasks-v2";
  const FOCUS_KEY = "daymark-focus-v1";
  const PROFILE_KEY = "daymark-profile-v1";
  const MAX_TASKS = 50;
  const MAX_TITLE_LENGTH = 100;
  const FOCUS_SECONDS = 25 * 60;
  const CATEGORIES = ["Work", "Personal", "Wellbeing"];
  const $ = (selector, root = document) => root.querySelector(selector);
  const today = localDateString(new Date());
  const page = document.body.dataset.page || "today";
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const defaultTaskDate = page === "upcoming" ? localDateString(tomorrow) : today;
  let filter = "all";
  let tasks = loadTasks();
  let focus = loadFocus();
  let timerInterval = null;

  function localDateString(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function isDate(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00`);
    return Number.isFinite(parsed.getTime()) && localDateString(parsed) === value;
  }

  function isTime(value) {
    return value === "" || (typeof value === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value));
  }

  function validTask(task) {
    return task !== null &&
      typeof task === "object" &&
      !Array.isArray(task) &&
      typeof task.id === "string" &&
      task.id.length > 0 &&
      task.id.length <= 128 &&
      typeof task.title === "string" &&
      task.title.trim().length > 0 &&
      task.title.length <= MAX_TITLE_LENGTH &&
      isDate(task.date) &&
      isTime(task.time) &&
      CATEGORIES.includes(task.category) &&
      typeof task.done === "boolean";
  }

  function validTaskList(value) {
    return Array.isArray(value) &&
      value.length <= MAX_TASKS &&
      value.every(validTask) &&
      new Set(value.map((task) => task.id)).size === value.length;
  }

  function normalizeProfileName(value) {
    if (typeof value !== "string") return null;
    const name = value.trim();
    return name.length <= 40 && /^[\p{L}\p{M}\p{N} .'\u2019-]*$/u.test(name)
      ? name
      : null;
  }

  function notify(message) {
    const notice = $("#app-notice");
    if (!notice) return;
    notice.textContent = message;
    notice.hidden = !message;
  }

  function loadTasks() {
    try {
      const stored = localStorage.getItem(TASKS_KEY);
      if (stored !== null) {
        const parsed = JSON.parse(stored);
        if (!validTaskList(parsed)) throw new Error("Saved tasks have an invalid format.");
        return parsed;
      }

      const legacy = localStorage.getItem(LEGACY_TASKS_KEY);
      if (legacy === null) return [];
      const parsedLegacy = JSON.parse(legacy);
      if (!Array.isArray(parsedLegacy) || parsedLegacy.length > MAX_TASKS) {
        throw new Error("Saved tasks have an invalid format.");
      }
      const migrated = parsedLegacy.map((task) => ({
        ...task,
        date: today
      }));
      if (!validTaskList(migrated)) throw new Error("Saved tasks have an invalid format.");
      localStorage.setItem(TASKS_KEY, JSON.stringify(migrated));
      return migrated;
    } catch (error) {
      console.error("Could not load Daymark tasks:", error);
      notify("Saved tasks could not be loaded. Check your browser storage settings.");
      return [];
    }
  }

  function saveTasks() {
    try {
      localStorage.setItem(TASKS_KEY, JSON.stringify(tasks));
      notify("");
      return true;
    } catch (error) {
      console.error("Could not save Daymark tasks:", error);
      notify("Your changes could not be saved. Check your browser storage settings.");
      return false;
    }
  }

  function formatTime(value) {
    if (!value) return "";
    const [hours, minutes] = value.split(":").map(Number);
    return `${hours % 12 || 12}:${String(minutes).padStart(2, "0")} ${hours >= 12 ? "pm" : "am"}`;
  }

  function formatDate(value, options = { weekday: "long", month: "long", day: "numeric" }) {
    return new Intl.DateTimeFormat(undefined, options).format(new Date(`${value}T12:00:00`));
  }

  function makeTaskRow(task) {
    const row = document.createElement("div");
    row.className = `task${task.done ? " done" : ""}`;

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "check";
    checkbox.checked = task.done;
    checkbox.dataset.taskId = task.id;
    checkbox.setAttribute("aria-label", `${task.done ? "Mark incomplete" : "Complete"}: ${task.title}`);
    checkbox.addEventListener("change", () => {
      task.done = checkbox.checked;
      saveTasks();
      renderPage();
      focusTaskControl(task.id);
    });

    const details = document.createElement("div");
    const title = document.createElement("div");
    title.className = "task-title";
    title.textContent = task.title;
    const meta = document.createElement("div");
    meta.className = "task-meta";
    if (task.time) {
      const time = document.createElement("span");
      time.className = "task-time";
      time.textContent = formatTime(task.time);
      meta.append(time);
    }
    const category = document.createElement("span");
    category.className = `tag ${task.category.toLowerCase()}`;
    category.textContent = task.category;
    meta.append(category);
    details.append(title, meta);

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "task-delete";
    remove.textContent = "×";
    remove.setAttribute("aria-label", `Delete ${task.title}`);
    remove.addEventListener("click", () => {
      tasks = tasks.filter((item) => item.id !== task.id);
      saveTasks();
      renderPage();
    });

    row.append(checkbox, details, remove);
    return row;
  }

  function renderEmpty(list, message) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.tabIndex = -1;
    const icon = document.createElement("div");
    icon.className = "empty-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = "☼";
    const text = document.createElement("div");
    text.textContent = message;
    empty.append(icon, text);
    list.replaceChildren(empty);
  }

  function focusTaskControl(taskId) {
    const checkboxes = Array.from(document.querySelectorAll(".check"));
    const target = checkboxes.find((checkbox) => checkbox.dataset.taskId === taskId) || checkboxes[0];
    (target || $(".empty"))?.focus();
  }

  function renderProgress() {
    const number = $("#progress-number");
    if (!number) return;
    const todaysTasks = tasks.filter((task) => task.date === today);
    const completed = todaysTasks.filter((task) => task.done).length;
    const percent = todaysTasks.length ? Math.round(completed / todaysTasks.length * 100) : 0;
    number.textContent = `${percent}%`;
    $("#progress-fill").style.width = `${percent}%`;
    $("#progress-bar").setAttribute("aria-valuenow", percent);
    $("#progress-caption").textContent = todaysTasks.length
      ? `${completed} of ${todaysTasks.length} ${todaysTasks.length === 1 ? "thing" : "things"} taken care of.`
      : "Every small step counts.";
  }

  function renderToday() {
    const list = $("#task-list");
    if (!list) return;
    let todaysTasks = tasks.filter((task) => task.date === today);
    if (filter === "open") todaysTasks = todaysTasks.filter((task) => !task.done);
    if (filter === "done") todaysTasks = todaysTasks.filter((task) => task.done);
    todaysTasks.sort((a, b) => (a.time || "99:99").localeCompare(b.time || "99:99"));

    $("#task-count").textContent = `${tasks.filter((task) => task.date === today && !task.done).length} left`;
    if (todaysTasks.length === 0) {
      renderEmpty(list, filter === "done"
        ? "No completed tasks yet."
        : filter === "open"
          ? "You’re all caught up. Enjoy the breathing room."
          : "Your page is clear. What matters to you today?");
    } else {
      list.replaceChildren(...todaysTasks.map((task) => makeTaskRow(task)));
    }
  }

  function renderUpcoming() {
    const list = $("#upcoming-list");
    if (!list) return;
    const upcoming = tasks
      .filter((task) => task.date !== today)
      .sort((a, b) => a.date.localeCompare(b.date) || (a.time || "99:99").localeCompare(b.time || "99:99"));
    const count = $("#upcoming-count");
    if (count) count.textContent = `${upcoming.length} planned`;
    if (upcoming.length === 0) {
      renderEmpty(list, "Nothing on the horizon yet. Add a task for another day.");
      return;
    }

    const groups = [];
    for (const task of upcoming) {
      let group = groups[groups.length - 1];
      if (!group || group.date !== task.date) {
        group = { date: task.date, tasks: [] };
        groups.push(group);
      }
      group.tasks.push(task);
    }
    list.replaceChildren(...groups.map((group) => {
      const section = document.createElement("section");
      section.className = "day-group";
      const heading = document.createElement("div");
      heading.className = "day-heading";
      const title = document.createElement("h2");
      title.textContent = group.date < today
        ? `Overdue · ${formatDate(group.date)}`
        : formatDate(group.date);
      const total = document.createElement("span");
      total.className = "task-count";
      total.textContent = `${group.tasks.length} ${group.tasks.length === 1 ? "task" : "tasks"}`;
      heading.append(title, total);
      section.append(heading, ...group.tasks.map((task) => makeTaskRow(task)));
      return section;
    }));
  }

  function renderFocusTasks() {
    const list = $("#focus-task-list");
    if (!list) return;
    const active = tasks.filter((task) => task.date === today && !task.done)
      .sort((a, b) => (a.time || "99:99").localeCompare(b.time || "99:99"));
    if (active.length === 0) {
      renderEmpty(list, "You’re clear for now. Choose one thing to work on.");
      return;
    }
    list.replaceChildren(...active.map((task) => makeTaskRow(task)));
  }

  function loadFocus() {
    try {
      const stored = localStorage.getItem(FOCUS_KEY);
      if (stored === null) return defaultFocus();
      const parsed = JSON.parse(stored);
      if (!parsed ||
        !Number.isInteger(parsed.remainingSeconds) ||
        parsed.remainingSeconds < 0 ||
        parsed.remainingSeconds > FOCUS_SECONDS ||
        typeof parsed.running !== "boolean" ||
        !(parsed.endsAt === null || (Number.isFinite(parsed.endsAt) && parsed.endsAt > 0)) ||
        (parsed.running ? parsed.endsAt === null : parsed.endsAt !== null)) {
        throw new Error("Saved focus timer has an invalid format.");
      }
      if (parsed.running) {
        parsed.remainingSeconds = Math.max(0, Math.ceil((parsed.endsAt - Date.now()) / 1000));
        if (parsed.remainingSeconds === 0) {
          parsed.running = false;
          parsed.endsAt = null;
          localStorage.setItem(FOCUS_KEY, JSON.stringify(parsed));
        }
      }
      return parsed;
    } catch (error) {
      console.error("Could not load the Daymark focus timer:", error);
      notify("The saved focus timer could not be loaded. It has been reset.");
      return defaultFocus();
    }
  }

  function defaultFocus() {
    return { remainingSeconds: FOCUS_SECONDS, running: false, endsAt: null };
  }

  function saveFocus() {
    try {
      localStorage.setItem(FOCUS_KEY, JSON.stringify(focus));
      return true;
    } catch (error) {
      console.error("Could not save the Daymark focus timer:", error);
      notify("The focus timer could not be saved. Check your browser storage settings.");
      return false;
    }
  }

  function renderTimer() {
    if (!$("#timer")) return;
    const seconds = focus.remainingSeconds;
    $("#timer").textContent = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
    $("#timer-toggle").textContent = focus.running
      ? "Pause"
      : seconds === 0
        ? "Start again"
        : seconds < FOCUS_SECONDS
          ? "Resume focus"
          : "Start focus";
    $("#timer-sub").textContent = focus.running
      ? "One thing at a time."
      : seconds === 0
        ? "Lovely work. Take a little break."
        : seconds < FOCUS_SECONDS
          ? "Paused. Take your time."
          : "A little space for one thing.";
  }

  function syncTimer() {
    if (!focus.running) return;
    focus.remainingSeconds = Math.max(0, Math.ceil((focus.endsAt - Date.now()) / 1000));
    if (focus.remainingSeconds === 0) {
      focus.running = false;
      focus.endsAt = null;
      clearInterval(timerInterval);
      timerInterval = null;
      saveFocus();
    }
    renderTimer();
  }

  function renderPage() {
    if (page === "today") renderToday();
    if (page === "upcoming") renderUpcoming();
    if (page === "focus") renderFocusTasks();
    renderProgress();
  }

  function initHeader() {
    const dateLabel = $("#header-date");
    if (dateLabel) {
      dateLabel.textContent = new Intl.DateTimeFormat(undefined, {
        weekday: "short", month: "short", day: "numeric", year: "numeric"
      }).format(new Date()).toUpperCase();
    }
    const greeting = $("#greeting");
    if (greeting) {
      let name = "";
      try {
        const profile = JSON.parse(localStorage.getItem(PROFILE_KEY) || "{}");
        const storedName = normalizeProfileName(profile.name);
        if (storedName) name = storedName;
      } catch (error) {
        console.error("Could not load the Daymark profile:", error);
      }
      const hour = new Date().getHours();
      const salutation = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
      greeting.textContent = name ? `${salutation}, ${name}.` : `${salutation}.`;
    }
  }

  function initActiveNav() {
    const currentPage = window.location.pathname.split("/").pop() || "index.html";
    document.querySelectorAll(".main-nav .nav-link").forEach((link) => {
      if (link.pathname.split("/").pop() === currentPage) {
        link.setAttribute("aria-current", "page");
      } else {
        link.removeAttribute("aria-current");
      }
    });
  }

  function initTaskDialog() {
    const dialog = $("#task-dialog");
    const form = $("#task-form");
    if (!dialog || !form) return;

    const dateInput = $("#task-date");
    if (dateInput) dateInput.value = defaultTaskDate;
    $("#open-dialog")?.addEventListener("click", () => {
      $("#form-error").hidden = true;
      dateInput.value = defaultTaskDate;
      dialog.showModal();
      $("#task-input").focus();
    });
    $("#close-dialog")?.addEventListener("click", () => dialog.close());
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.close();
    });
    $("#task-input").addEventListener("input", () => {
      $("#form-error").hidden = true;
    });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const values = new FormData(form);
      const title = String(values.get("title") || "").trim();
      const date = String(values.get("date") || "");
      const time = String(values.get("time") || "");
      const category = String(values.get("category") || "");
      const error = $("#form-error");

      if (!title || title.length > MAX_TITLE_LENGTH) {
        error.textContent = `Enter a task title between 1 and ${MAX_TITLE_LENGTH} characters.`;
      } else if (!isDate(date)) {
        error.textContent = "Choose a valid date for your task.";
      } else if (!isTime(time)) {
        error.textContent = "Enter a valid time or leave the time blank.";
      } else if (!CATEGORIES.includes(category)) {
        error.textContent = "Choose one of the available categories.";
      } else if (tasks.length >= MAX_TASKS) {
        error.textContent = `You can keep up to ${MAX_TASKS} tasks. Complete or remove one before adding another.`;
      } else {
        tasks.push({
          id: globalThis.crypto && typeof globalThis.crypto.randomUUID === "function"
            ? globalThis.crypto.randomUUID()
            : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
          title,
          date,
          time,
          category,
          done: false
        });
        saveTasks();
        filter = "all";
        document.querySelectorAll(".filter").forEach((item) =>
          item.classList.toggle("active", item.dataset.filter === "all")
        );
        renderPage();
        form.reset();
        if (dateInput) dateInput.value = defaultTaskDate;
        $("#task-time").value = "10:00";
        error.hidden = true;
        dialog.close();
        return;
      }
      error.hidden = false;
    });
  }

  function initTimer() {
    const toggle = $("#timer-toggle");
    if (!toggle) return;
    toggle.addEventListener("click", () => {
      if (focus.running) {
        syncTimer();
        if (!focus.running) return;
        focus.running = false;
        focus.endsAt = null;
        clearInterval(timerInterval);
        timerInterval = null;
      } else {
        if (focus.remainingSeconds === 0) focus.remainingSeconds = FOCUS_SECONDS;
        focus.running = true;
        focus.endsAt = Date.now() + focus.remainingSeconds * 1000;
        timerInterval = setInterval(syncTimer, 250);
      }
      saveFocus();
      renderTimer();
    });
    $("#timer-reset")?.addEventListener("click", () => {
      clearInterval(timerInterval);
      timerInterval = null;
      focus = defaultFocus();
      saveFocus();
      renderTimer();
    });
  }

  function initSettings() {
    const nameInput = $("#profile-name");
    if (!nameInput) return;
    try {
      const profile = JSON.parse(localStorage.getItem(PROFILE_KEY) || "{}");
      const storedName = normalizeProfileName(profile.name);
      if (storedName !== null) nameInput.value = storedName;
    } catch (error) {
      console.error("Could not read the Daymark profile:", error);
    }

    $("#profile-form").addEventListener("submit", (event) => {
      event.preventDefault();
      const name = normalizeProfileName(nameInput.value);
      if (name === null) {
        $("#settings-message").textContent = "Use up to 40 letters, numbers, spaces, apostrophes, periods, or hyphens.";
        return;
      }
      try {
        localStorage.setItem(PROFILE_KEY, JSON.stringify({ name }));
        $("#settings-message").textContent = "Your preferences are saved on this device.";
        initHeader();
      } catch (error) {
        console.error("Could not save the Daymark profile:", error);
        $("#settings-message").textContent = "Your preferences could not be saved. Check browser storage settings.";
      }
    });

    $("#export-data")?.addEventListener("click", () => {
      const data = {
        version: 1,
        exportedAt: new Date().toISOString(),
        profile: readProfile(),
        tasks,
        focus
      };
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `daymark-backup-${today}.json`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
      $("#settings-message").textContent = "Your backup has been downloaded.";
    });

    $("#restore-data")?.addEventListener("click", () => $("#import-file").click());
    $("#import-file")?.addEventListener("change", async (event) => {
      const file = event.currentTarget.files[0];
      event.currentTarget.value = "";
      if (!file) return;
      if (file.size > 1_000_000) {
        $("#settings-message").textContent = "The backup file is too large to import.";
        return;
      }
      try {
        const data = JSON.parse(await file.text());
        if (!data || data.version !== 1 || !validTaskList(data.tasks) ||
          !data.profile || normalizeProfileName(data.profile.name) === null ||
          !data.focus || !Number.isInteger(data.focus.remainingSeconds) ||
          data.focus.remainingSeconds < 0 || data.focus.remainingSeconds > FOCUS_SECONDS ||
          typeof data.focus.running !== "boolean" ||
          !(data.focus.endsAt === null || (Number.isFinite(data.focus.endsAt) && data.focus.endsAt > 0)) ||
          (data.focus.running ? data.focus.endsAt === null : data.focus.endsAt !== null)) {
          throw new Error("The backup file does not match the Daymark format.");
        }
        if (!confirm("Importing this backup will replace the tasks and preferences saved on this device. Continue?")) return;
        const profile = { name: normalizeProfileName(data.profile.name) };
        localStorage.setItem(TASKS_KEY, JSON.stringify(data.tasks));
        localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
        localStorage.setItem(FOCUS_KEY, JSON.stringify(data.focus));
        tasks = data.tasks;
        focus = data.focus;
        initHeader();
        nameInput.value = profile.name;
        renderPage();
        renderTimer();
        $("#settings-message").textContent = "Backup imported successfully.";
      } catch (error) {
        console.error("Could not import the Daymark backup:", error);
        $("#settings-message").textContent = "That backup could not be imported. Choose a valid Daymark JSON backup.";
      }
    });

    $("#clear-data")?.addEventListener("click", () => {
      if (!confirm("Delete all tasks and preferences saved in this browser? This cannot be undone.")) return;
      try {
        localStorage.removeItem(TASKS_KEY);
        localStorage.removeItem(LEGACY_TASKS_KEY);
        localStorage.removeItem(PROFILE_KEY);
        localStorage.removeItem(FOCUS_KEY);
        tasks = [];
        focus = defaultFocus();
        initHeader();
        nameInput.value = "";
        renderPage();
        renderTimer();
        $("#settings-message").textContent = "Your local Daymark data has been cleared.";
      } catch (error) {
        console.error("Could not clear Daymark data:", error);
        $("#settings-message").textContent = "Your data could not be cleared. Check browser storage settings.";
      }
    });
  }

  function readProfile() {
    try {
      const profile = JSON.parse(localStorage.getItem(PROFILE_KEY) || "{}");
      const name = normalizeProfileName(profile.name);
      return { name: name === null ? "" : name };
    } catch (error) {
      console.error("Could not read the Daymark profile:", error);
      return { name: "" };
    }
  }

  function init() {
    initActiveNav();
    initHeader();
    document.querySelectorAll(".filter").forEach((button) => {
      button.addEventListener("click", () => {
        filter = button.dataset.filter;
        document.querySelectorAll(".filter").forEach((item) =>
          item.classList.toggle("active", item === button)
        );
        renderToday();
      });
    });
    initTaskDialog();
    initTimer();
    initSettings();
    renderPage();
    renderTimer();
    if (focus.running && $("#timer")) timerInterval = setInterval(syncTimer, 250);
  }

  init();
})();
