const STORAGE_KEY = "adaptive_week_planner_v1";
const INBOX_FOLDER_ID = "folder_inbox";

/**
 * @typedef {Object} Folder
 * @property {string} id
 * @property {string} title
 * @property {boolean} isSystem
 * @property {string} createdAt
 * @property {string} updatedAt
 */

/**
 * @typedef {Object} Task
 * @property {string} id
 * @property {string} folderId
 * @property {string} title
 * @property {string} createdAt
 * @property {string} updatedAt
 * @property {boolean} completed
 * @property {string=} scheduledDate
 */

/**
 * @typedef {Object} Settings
 * @property {string} createdAt
 * @property {string} updatedAt
 */

let plannerDatabase = null;
let currentWeekStart = getStartOfWeek(new Date());
let draggedTaskId = null;
let planningTaskId = null;
let detailsTaskId = null;
let carryOverTimerId = null;
const expandedFolderIds = new Set([INBOX_FOLDER_ID]);
let shouldHighlightUnscheduledTasks = false;

document.addEventListener("DOMContentLoaded", () => {
  const result = initializeDatabase();

  plannerDatabase = result.database;
  checkAndCarryOverTasks({ shouldRender: false });
  updateStorageStatus(result);
  renderFolders(plannerDatabase.folders);
  renderSidebarTasks();
  bindTaskForm();
  bindFolderCreation();
  bindSidebarStateControls();
  bindMobileTabs();
  bindPlanningModal();
  bindTaskDetailsModal();
  bindCarryOverTriggers();
  initializeWeekPlanner();

  if (result.wasRecovered) {
    showStorageErrorNotification();
  }
});

function initializeDatabase() {
  try {
    const rawData = localStorage.getItem(STORAGE_KEY);

    if (!rawData) {
      const database = createDefaultDatabase();
      saveDatabase(database);

      return {
        database,
        status: "created",
        wasRecovered: false,
      };
    }

    const parsedData = normalizeDatabase(JSON.parse(rawData));

    if (!isValidDatabase(parsedData)) {
      throw new Error("Stored planner data does not match the expected schema.");
    }

    saveDatabase(parsedData);

    return {
      database: parsedData,
      status: "ready",
      wasRecovered: false,
    };
  } catch (error) {
    console.error("Не удалось прочитать данные планировщика:", error);

    const database = createDefaultDatabase();
    saveDatabase(database);

    return {
      database,
      status: "recovered",
      wasRecovered: true,
    };
  }
}

function normalizeDatabase(database) {
  if (!database || typeof database !== "object" || Array.isArray(database)) {
    return database;
  }

  if (!Array.isArray(database.folders)) {
    database.folders = [];
  }

  ensureInboxFolder(database);

  if (!Array.isArray(database.tasks)) {
    return database;
  }

  if (!database.settings || typeof database.settings !== "object") {
    const now = new Date().toISOString();
    database.settings = {
      createdAt: now,
      updatedAt: now,
    };
  }

  if (!database.settings.weekFocus || typeof database.settings.weekFocus !== "object" || Array.isArray(database.settings.weekFocus)) {
    database.settings.weekFocus = {};
  }

  const validFolderIds = new Set(database.folders.map((folder) => folder.id));

  database.tasks = database.tasks.map((task) => {
    const normalizedTask = { ...task };

    if (!validFolderIds.has(normalizedTask.folderId)) {
      normalizedTask.folderId = INBOX_FOLDER_ID;
    }

    if (!normalizedTask.importance) {
      normalizedTask.importance = "important";
    }

    if (!normalizedTask.status) {
      normalizedTask.status = normalizedTask.completed === true ? "done" : "active";
    }

    normalizedTask.completed = normalizedTask.status === "done";

    if (!Array.isArray(normalizedTask.checklist)) {
      normalizedTask.checklist = [];
    }

    if (typeof normalizedTask.carriedOver !== "boolean") {
      normalizedTask.carriedOver = false;
    }

    return normalizedTask;
  });

  return database;
}

function ensureInboxFolder(database) {
  const existingInbox = database.folders.find((folder) => folder.id === INBOX_FOLDER_ID);

  if (existingInbox) {
    existingInbox.title = "Входящие мысли";
    existingInbox.isSystem = true;
    return;
  }

  const now = new Date().toISOString();
  database.folders.unshift({
    id: INBOX_FOLDER_ID,
    title: "Входящие мысли",
    isSystem: true,
    createdAt: now,
    updatedAt: now,
  });
}

function createDefaultDatabase() {
  const now = new Date().toISOString();

  return {
    version: 1,
    folders: [
      {
        id: INBOX_FOLDER_ID,
        title: "Входящие мысли",
        isSystem: true,
        createdAt: now,
        updatedAt: now,
      },
    ],
    tasks: [],
    settings: {
      createdAt: now,
      updatedAt: now,
      weekFocus: {},
    },
  };
}

function saveDatabase(database) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(database));
}

function isValidDatabase(database) {
  if (!database || typeof database !== "object" || Array.isArray(database)) {
    return false;
  }

  return (
    database.version === 1 &&
    Array.isArray(database.folders) &&
    Array.isArray(database.tasks) &&
    isValidSettings(database.settings) &&
    database.folders.every(isValidFolder) &&
    database.tasks.every(isValidTask) &&
    hasSystemInboxFolder(database.folders)
  );
}

function isValidFolder(folder) {
  return (
    folder &&
    typeof folder === "object" &&
    typeof folder.id === "string" &&
    typeof folder.title === "string" &&
    typeof folder.isSystem === "boolean" &&
    isIsoDateString(folder.createdAt) &&
    isIsoDateString(folder.updatedAt)
  );
}

function isValidTask(task) {
  return (
    task &&
    typeof task === "object" &&
    typeof task.id === "string" &&
    typeof task.folderId === "string" &&
    typeof task.title === "string" &&
    typeof task.completed === "boolean" &&
    isIsoDateString(task.createdAt) &&
    isIsoDateString(task.updatedAt) &&
    isValidImportance(task.importance) &&
    isValidOptionalDateKey(task.scheduledDate) &&
    isValidTaskStatus(task.status) &&
    Array.isArray(task.checklist) &&
    task.checklist.every(isValidChecklistItem) &&
    typeof task.carriedOver === "boolean"
  );
}

function isValidTaskStatus(status) {
  return status === undefined || status === "active" || status === "done";
}

function isValidChecklistItem(item) {
  return (
    item &&
    typeof item === "object" &&
    typeof item.id === "string" &&
    typeof item.text === "string" &&
    typeof item.isDone === "boolean"
  );
}

function isValidImportance(importance) {
  return (
    importance === undefined ||
    importance === "urgent_important" ||
    importance === "important" ||
    importance === "not_important"
  );
}

function isValidOptionalDateKey(dateKey) {
  return dateKey === undefined || /^\d{4}-\d{2}-\d{2}$/.test(dateKey);
}

function isValidSettings(settings) {
  return (
    settings &&
    typeof settings === "object" &&
    isIsoDateString(settings.createdAt) &&
    isIsoDateString(settings.updatedAt) &&
    isValidWeekFocusStore(settings.weekFocus)
  );
}

function isValidWeekFocusStore(weekFocus) {
  if (weekFocus === undefined) {
    return true;
  }

  if (!weekFocus || typeof weekFocus !== "object" || Array.isArray(weekFocus)) {
    return false;
  }

  return Object.entries(weekFocus).every(([weekKey, value]) => {
    return /^\d{4}-\d{2}-\d{2}$/.test(weekKey) && typeof value === "string";
  });
}

function isIsoDateString(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function hasSystemInboxFolder(folders) {
  return folders.some((folder) => {
    return (
      folder.id === INBOX_FOLDER_ID &&
      folder.title === "Входящие мысли" &&
      folder.isSystem === true
    );
  });
}

function renderFolders(folders) {
  const folderList = document.querySelector("#folder-list");

  if (!folderList) {
    return;
  }

  folderList.innerHTML = "";

  folders.forEach((folder) => {
    const folderNode = document.createElement("div");
    folderNode.className = "folder-node";
    folderNode.dataset.folderId = folder.id;

    const isExpanded = expandedFolderIds.has(folder.id);
    const folderButton = document.createElement("button");
    folderButton.className = "folder-item";
    folderButton.classList.toggle("is-expanded", isExpanded);
    folderButton.type = "button";
    folderButton.dataset.folderId = folder.id;
    folderButton.setAttribute("aria-expanded", String(isExpanded));

    const token = document.createElement("span");
    token.className = "folder-token";
    token.textContent = getFolderToken(folder.title);
    token.setAttribute("aria-hidden", "true");

    const copy = document.createElement("span");
    copy.className = "sidebar-text";

    const title = document.createElement("span");
    title.className = "folder-title";
    title.textContent = folder.title;

    const meta = document.createElement("span");
    meta.className = "folder-meta";
    meta.textContent = `${getActiveTaskCountForFolder(folder.id)} активных`;

    const chevron = document.createElement("span");
    chevron.className = "folder-chevron";
    chevron.textContent = isExpanded ? "−" : "+";
    chevron.setAttribute("aria-hidden", "true");

    folderButton.addEventListener("click", () => {
      if (expandedFolderIds.has(folder.id)) {
        expandedFolderIds.delete(folder.id);
      } else {
        expandedFolderIds.add(folder.id);
      }

      renderFolders(plannerDatabase.folders);
    });

    copy.append(title, meta);
    folderButton.append(token, copy, chevron);

    const taskList = document.createElement("div");
    taskList.className = "folder-task-list";
    taskList.hidden = !isExpanded;
    renderFolderTasks(folder.id, taskList);

    folderNode.append(folderButton, taskList);
    folderList.append(folderNode);
  });
}

function renderFolderTasks(folderId, container) {
  const tasks = plannerDatabase.tasks.filter((task) => {
    return task.folderId === folderId && !isTaskDone(task);
  });

  container.innerHTML = "";

  if (tasks.length === 0) {
    const emptyMessage = document.createElement("p");
    emptyMessage.className = "folder-empty-message sidebar-text";
    emptyMessage.textContent = "В этой папке пока нет активных задач";
    container.append(emptyMessage);
    return;
  }

  tasks.forEach((task) => {
    container.append(createTaskCard(task, "sidebar"));
  });
}

function getFolderToken(title) {
  return title
    .trim()
    .split(/\s+/)
    .map((word) => word[0] || "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function bindFolderCreation() {
  const createFolderButton = document.querySelector("#create-folder-button");

  if (!createFolderButton) {
    return;
  }

  createFolderButton.addEventListener("click", () => {
    const title = prompt("Название папки");

    if (!title || !title.trim()) {
      return;
    }

    const now = new Date().toISOString();
    const folder = {
      id: createFolderId(),
      title: title.trim(),
      isSystem: false,
      createdAt: now,
      updatedAt: now,
    };

    plannerDatabase.folders.push(folder);
    expandedFolderIds.add(folder.id);
    saveDatabase(plannerDatabase);
    renderFolders(plannerDatabase.folders);
    renderWeek();
  });
}

function createFolderId() {
  return `folder_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function createOption(value, label) {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label;

  return option;
}

function bindTaskForm() {
  const addTaskButton = document.querySelector("#add-task-button");

  if (!addTaskButton) {
    return;
  }

  addTaskButton.addEventListener("click", () => {
    openTaskCreationModal();
  });
}

function createTask({ title, folderId, importance = "important", scheduledDate }) {
  const now = new Date().toISOString();
  const task = {
    id: createTaskId(),
    folderId: getValidFolderId(folderId),
    title,
    importance,
    status: "active",
    completed: false,
    checklist: [],
    carriedOver: false,
    createdAt: now,
    updatedAt: now,
  };

  if (scheduledDate) {
    task.scheduledDate = scheduledDate;
  }

  plannerDatabase.tasks.push(task);
  saveDatabase(plannerDatabase);
  renderFolders(plannerDatabase.folders);
  renderSidebarTasks();
  renderWeek();

  return task;
}

function createTaskId() {
  return `task_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function renderSidebarTasks() {
  if (!plannerDatabase) {
    return;
  }

  renderFolders(plannerDatabase.folders);
}

function createTaskCard(task, context) {
  const card = document.createElement("article");
  card.className = "task-card";
  card.dataset.taskId = task.id;
  card.draggable = !isTaskDone(task);
  card.tabIndex = 0;
  card.setAttribute("role", "button");
  card.setAttribute("aria-label", `Открыть задачу: ${task.title}`);

  if (isTaskDone(task)) {
    card.classList.add("done");
  }

  if (task.carriedOver === true && !isTaskDone(task)) {
    card.classList.add("carried-over");
  }

  if (!isTaskDone(task) && !task.scheduledDate) {
    card.classList.add("is-unscheduled");

    if (shouldHighlightUnscheduledTasks) {
      card.classList.add("is-unscheduled-highlight");
    }
  }

  const main = document.createElement("div");
  main.className = "task-card-main";

  const checkbox = document.createElement("input");
  checkbox.className = "task-complete-checkbox";
  checkbox.type = "checkbox";
  checkbox.checked = isTaskDone(task);
  checkbox.setAttribute("aria-label", isTaskDone(task) ? "Вернуть задачу в активные" : "Отметить задачу выполненной");
  checkbox.addEventListener("click", (event) => {
    event.stopPropagation();
  });
  checkbox.addEventListener("change", () => {
    setTaskCompletion(task.id, checkbox.checked);
  });

  const marker = document.createElement("span");
  marker.className = "importance-marker";
  marker.dataset.importance = task.importance || "important";
  marker.setAttribute("aria-label", getImportanceLabel(task.importance));

  const copy = document.createElement("div");
  copy.className = "task-card-copy";

  const title = document.createElement("p");
  title.className = "task-card-title";
  title.textContent = task.title;

  const meta = document.createElement("p");
  meta.className = "task-card-meta";
  meta.textContent = getTaskMetaText(task, context);

  const badges = document.createElement("div");
  badges.className = "task-card-badges";
  renderTaskBadges(task, badges);

  card.addEventListener("dragstart", (event) => {
    draggedTaskId = task.id;
    card.classList.add("is-dragging");
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", task.id);
  });

  card.addEventListener("dragend", () => {
    draggedTaskId = null;
    card.classList.remove("is-dragging");
  });

  card.addEventListener("click", () => {
    openTaskDetailsModal(task.id);
  });

  card.addEventListener("keydown", (event) => {
    if (event.target.closest("input, button, select, textarea")) {
      return;
    }

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openTaskDetailsModal(task.id);
    }
  });

  copy.append(title);

  if (meta.textContent) {
    copy.append(meta);
  }

  main.append(checkbox, marker, copy);
  card.append(main);

  if (badges.children.length > 0) {
    card.append(badges);
  }

  return card;
}

function getImportanceLabel(importance) {
  const labels = {
    urgent_important: "Срочно/важно",
    important: "Важно",
    not_important: "Не важно",
  };

  return labels[importance] || labels.important;
}

function getTaskMetaText(task, context) {
  if (context === "day") {
    return getFolderTitle(task.folderId);
  }

  return task.scheduledDate ? formatShortDateKey(task.scheduledDate) : "";
}

function getFolderTitle(folderId) {
  const folder = plannerDatabase?.folders?.find((candidate) => candidate.id === folderId);

  return folder?.title || "Входящие мысли";
}

function renderTaskBadges(task, container) {
  container.innerHTML = "";

  if (Array.isArray(task.checklist) && task.checklist.length > 0) {
    const doneCount = task.checklist.filter((item) => item.isDone).length;
    const checklistBadge = document.createElement("span");
    checklistBadge.className = "task-mini-badge checklist-badge";
    checklistBadge.textContent = `${doneCount}/${task.checklist.length}`;
    container.append(checklistBadge);
  }

  if (task.carriedOver === true && !isTaskDone(task)) {
    const carriedBadge = document.createElement("span");
    carriedBadge.className = "task-mini-badge carried-badge";
    carriedBadge.textContent = "перенесено";
    container.append(carriedBadge);
  }

  if (isTaskDone(task)) {
    const doneBadge = document.createElement("span");
    doneBadge.className = "task-mini-badge done-badge";
    doneBadge.textContent = "выполнено";
    container.append(doneBadge);
  }
}

function isTaskDone(task) {
  return task.status === "done" || task.completed === true;
}

function setTaskCompletion(taskId, shouldBeDone) {
  const task = findTaskById(taskId);

  if (!task) {
    return;
  }

  task.status = shouldBeDone ? "done" : "active";
  task.completed = shouldBeDone;
  task.updatedAt = new Date().toISOString();

  if (shouldBeDone) {
    task.completedAt = new Date().toISOString();
  } else {
    delete task.completedAt;
  }

  persistAndRender();

  if (detailsTaskId === task.id) {
    updateDetailsStatusButton(task);
    renderChecklistEditor(task);
  }
}

function bindSidebarStateControls() {
  const sidebar = document.querySelector("#task-sidebar");
  const openSidebarButton = document.querySelector("#open-sidebar-button");
  const stateButtons = document.querySelectorAll("[data-sidebar-state]");

  if (!sidebar) {
    return;
  }

  stateButtons.forEach((button) => {
    button.addEventListener("click", () => {
      setSidebarState(button.dataset.sidebarState || "full");
    });
  });

  if (openSidebarButton) {
    openSidebarButton.addEventListener("click", () => {
      setSidebarState("full");
    });
  }

  function setSidebarState(state) {
    sidebar.classList.toggle("sidebar--narrow", state === "narrow");
    sidebar.classList.toggle("sidebar--hidden", state === "hidden");

    if (openSidebarButton) {
      openSidebarButton.hidden = state !== "hidden";
    }

    stateButtons.forEach((button) => {
      button.classList.toggle("is-active", button.dataset.sidebarState === state);
    });
  }
}

function bindMobileTabs() {
  const app = document.querySelector("#app");
  const tabButtons = document.querySelectorAll("[data-mobile-tab]");

  if (!app) {
    return;
  }

  tabButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const tab = button.dataset.mobileTab || "week";

      app.classList.toggle("mobile-view-tasks", tab === "tasks");
      app.classList.toggle("mobile-view-week", tab === "week");

      tabButtons.forEach((tabButton) => {
        tabButton.classList.toggle("is-active", tabButton.dataset.mobileTab === tab);
      });
    });
  });
}

function initializeWeekPlanner() {
  const previousButton = document.querySelector("#prev-week-button");
  const nextButton = document.querySelector("#next-week-button");
  const todayButton = document.querySelector("#today-week-button");

  if (previousButton) {
    previousButton.addEventListener("click", () => {
      currentWeekStart = addDays(currentWeekStart, -7);
      renderWeek();
    });
  }

  if (nextButton) {
    nextButton.addEventListener("click", () => {
      currentWeekStart = addDays(currentWeekStart, 7);
      renderWeek();
    });
  }

  if (todayButton) {
    todayButton.addEventListener("click", () => {
      currentWeekStart = getStartOfWeek(new Date());
      renderWeek();
    });
  }

  renderWeek();
}

function renderWeek() {
  const weekRange = document.querySelector("#week-range");
  const weekGrid = document.querySelector("#week-grid");

  if (!weekGrid) {
    return;
  }

  const todayKey = getDateKey(new Date());
  const weekEnd = addDays(currentWeekStart, 6);

  if (weekRange) {
    weekRange.textContent = `${formatFullDate(currentWeekStart)} - ${formatFullDate(weekEnd)}`;
  }

  weekGrid.innerHTML = "";

  for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
    const dayDate = addDays(currentWeekStart, dayIndex);
    const dayKey = getDateKey(dayDate);
    const activeTaskCount = getActiveTaskCountForDate(dayKey);
    const isPastDay = dayKey < todayKey;
    const isToday = dayKey === todayKey;

    const card = document.createElement("article");
    card.className = "day-card";
    card.dataset.date = dayKey;

    if (isPastDay) {
      card.classList.add("past");
    }

    if (isToday) {
      card.classList.add("today");
    }

    const header = document.createElement("header");
    header.className = "day-card-header";

    const title = document.createElement("h3");
    title.className = "day-title";
    title.textContent = formatDayTitle(dayDate);

    const badge = document.createElement("span");
    badge.className = "task-count-badge";
    badge.textContent = String(activeTaskCount);
    badge.setAttribute("aria-label", `Активных задач: ${activeTaskCount}`);

    const taskList = document.createElement("div");
    taskList.className = "day-task-list";
    renderDayTasks(taskList, dayKey);

    card.addEventListener("dragover", (event) => {
      event.preventDefault();

      if (card.classList.contains("past")) {
        event.dataTransfer.dropEffect = "none";
        return false;
      }

      event.dataTransfer.dropEffect = "move";
      card.classList.add("is-drop-target");
      return true;
    });

    card.addEventListener("dragleave", () => {
      card.classList.remove("is-drop-target");
    });

    card.addEventListener("drop", (event) => {
      event.preventDefault();
      card.classList.remove("is-drop-target");

      if (card.classList.contains("past")) {
        return false;
      }

      const taskId = event.dataTransfer.getData("text/plain") || draggedTaskId;
      updateTaskScheduledDate(taskId, dayKey);
      return true;
    });

    header.append(title, badge);
    card.append(header, taskList);
    weekGrid.append(card);
  }

  weekGrid.append(createWeekFocusCard(currentWeekStart));
}

function renderDayTasks(container, dateKey) {
  const tasks = getTasksForDate(dateKey);

  container.innerHTML = "";

  if (tasks.length === 0) {
    return;
  }

  tasks.forEach((task) => {
    container.append(createTaskCard(task, "day"));
  });
}

function getTasksForDate(dateKey) {
  if (!plannerDatabase || !Array.isArray(plannerDatabase.tasks)) {
    return [];
  }

  return plannerDatabase.tasks.filter((task) => {
    return task.scheduledDate === dateKey;
  });
}

function createWeekFocusCard(weekStart) {
  const weekKey = getDateKey(weekStart);
  const weekStats = getWeekStats(weekStart);
  const focusCard = document.createElement("article");
  focusCard.className = "week-focus-card";

  const header = document.createElement("header");
  header.className = "week-focus-header";

  const title = document.createElement("h3");
  title.textContent = "Фокус недели";

  const range = document.createElement("p");
  range.className = "week-focus-range";
  range.textContent = `${formatDayMonth(weekStart)} - ${formatDayMonth(addDays(weekStart, 6))}`;

  const label = document.createElement("label");
  label.className = "week-focus-field";

  const labelText = document.createElement("span");
  labelText.textContent = "Главное на неделю";

  const input = document.createElement("input");
  input.type = "text";
  input.maxLength = 120;
  input.placeholder = "Закрыть отчётность и разобрать входящие задачи";
  input.value = getWeekFocusText(weekKey);
  input.addEventListener("change", () => {
    saveWeekFocusText(weekKey, input.value);
  });

  const metrics = document.createElement("div");
  metrics.className = "week-focus-metrics";

  metrics.append(
    createWeekFocusMetric("Прогресс", `${weekStats.doneCount}/${weekStats.totalCount}`),
    createWeekFocusMetric("Хвосты", weekStats.carriedOverCount > 0 ? String(weekStats.carriedOverCount) : "Хвостов нет")
  );

  const unscheduledButton = document.createElement("button");
  unscheduledButton.className = "week-focus-unscheduled";
  unscheduledButton.type = "button";
  unscheduledButton.textContent = `Без даты: ${weekStats.unscheduledActiveCount}`;
  unscheduledButton.addEventListener("click", showUnscheduledTasksInSidebar);

  header.append(title, range);
  label.append(labelText, input);
  focusCard.append(header, label, metrics, unscheduledButton);

  return focusCard;
}

function createWeekFocusMetric(label, value) {
  const item = document.createElement("div");
  item.className = "week-focus-metric";

  const labelElement = document.createElement("span");
  labelElement.className = "week-focus-metric-label";
  labelElement.textContent = label;

  const valueElement = document.createElement("strong");
  valueElement.textContent = value;

  item.append(labelElement, valueElement);

  return item;
}

function getWeekStats(weekStart) {
  const weekTasks = getTasksForWeek(weekStart);
  const unscheduledActiveCount = getUnscheduledActiveTasks().length;

  return {
    totalCount: weekTasks.length,
    doneCount: weekTasks.filter(isTaskDone).length,
    carriedOverCount: weekTasks.filter((task) => task.carriedOver === true).length,
    unscheduledActiveCount,
  };
}

function getTasksForWeek(weekStart) {
  const weekStartKey = getDateKey(weekStart);
  const weekEndKey = getDateKey(addDays(weekStart, 6));

  if (!plannerDatabase || !Array.isArray(plannerDatabase.tasks)) {
    return [];
  }

  return plannerDatabase.tasks.filter((task) => {
    return task.scheduledDate >= weekStartKey && task.scheduledDate <= weekEndKey;
  });
}

function getUnscheduledActiveTasks() {
  if (!plannerDatabase || !Array.isArray(plannerDatabase.tasks)) {
    return [];
  }

  return plannerDatabase.tasks.filter((task) => {
    return !isTaskDone(task) && !task.scheduledDate;
  });
}

function getWeekFocusText(weekKey) {
  return plannerDatabase?.settings?.weekFocus?.[weekKey] || "";
}

function saveWeekFocusText(weekKey, value) {
  if (!plannerDatabase.settings.weekFocus) {
    plannerDatabase.settings.weekFocus = {};
  }

  plannerDatabase.settings.weekFocus[weekKey] = value.trim();
  plannerDatabase.settings.updatedAt = new Date().toISOString();
  saveDatabase(plannerDatabase);
}

function showUnscheduledTasksInSidebar() {
  const unscheduledTasks = getUnscheduledActiveTasks();
  const app = document.querySelector("#app");
  const sidebar = document.querySelector("#task-sidebar");
  const openSidebarButton = document.querySelector("#open-sidebar-button");

  shouldHighlightUnscheduledTasks = true;

  unscheduledTasks.forEach((task) => {
    expandedFolderIds.add(getValidFolderId(task.folderId));
  });

  if (sidebar) {
    sidebar.classList.remove("sidebar--hidden", "sidebar--narrow");
  }

  if (openSidebarButton) {
    openSidebarButton.hidden = true;
  }

  document.querySelectorAll("[data-sidebar-state]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.sidebarState === "full");
  });

  if (app) {
    app.classList.add("mobile-view-tasks");
    app.classList.remove("mobile-view-week");
  }

  document.querySelectorAll("[data-mobile-tab]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.mobileTab === "tasks");
  });

  renderFolders(plannerDatabase.folders);

  const firstUnscheduledTask = document.querySelector(".task-card.is-unscheduled");

  if (firstUnscheduledTask) {
    firstUnscheduledTask.scrollIntoView({ block: "center", behavior: "smooth" });
  }
}

function updateTaskScheduledDate(taskId, dateKey, options = {}) {
  const task = plannerDatabase.tasks.find((candidate) => candidate.id === taskId);

  if (!task) {
    return false;
  }

  task.scheduledDate = dateKey;
  task.carriedOver = options.carriedOver === true;
  task.updatedAt = new Date().toISOString();
  saveDatabase(plannerDatabase);
  renderFolders(plannerDatabase.folders);
  renderSidebarTasks();
  renderWeek();

  return true;
}

function getStartOfWeek(date) {
  const normalizedDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dayOfWeek = normalizedDate.getDay();
  const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;

  normalizedDate.setDate(normalizedDate.getDate() - daysFromMonday);

  return normalizedDate;
}

function addDays(date, days) {
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  result.setDate(result.getDate() + days);

  return result;
}

function getDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function bindPlanningModal() {
  const modal = document.querySelector("#planning-modal");
  const closeButton = document.querySelector("#planning-modal-close");

  if (!modal) {
    return;
  }

  if (closeButton) {
    closeButton.addEventListener("click", closePlanningModal);
  }

  modal.addEventListener("click", (event) => {
    if (event.target === modal) {
      closePlanningModal();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !modal.hidden) {
      closePlanningModal();
    }

    const detailsModal = document.querySelector("#task-details-modal");

    if (event.key === "Escape" && detailsModal && !detailsModal.hidden) {
      closeTaskDetailsModal();
    }
  });
}

function openPlanningModal(taskId) {
  const modal = document.querySelector("#planning-modal");
  const modalTitle = document.querySelector("#planning-modal-title");
  const taskTitle = document.querySelector("#planning-task-title");
  const taskOptions = document.querySelector("#planning-task-options");
  const options = document.querySelector("#planning-date-options");
  const task = plannerDatabase.tasks.find((candidate) => candidate.id === taskId);

  if (!modal || !options || !taskOptions || !task) {
    return;
  }

  planningTaskId = taskId;
  taskOptions.innerHTML = "";
  options.innerHTML = "";

  if (modalTitle) {
    modalTitle.textContent = "Перенести задачу";
  }

  if (taskTitle) {
    taskTitle.textContent = task.title;
  }

  getPlanningDateOptions().forEach((date) => {
    const dateKey = getDateKey(date);
    const button = document.createElement("button");
    button.className = "planning-date-button";
    button.type = "button";
    button.textContent = formatPlanningDate(date);
    button.disabled = dateKey < getDateKey(new Date());

    button.addEventListener("click", () => {
      if (button.disabled) {
        return;
      }

      updateTaskScheduledDate(planningTaskId, dateKey);
      closePlanningModal();
    });

    options.append(button);
  });

  modal.hidden = false;
}

function openTaskCreationModal() {
  const modal = document.querySelector("#planning-modal");
  const modalTitle = document.querySelector("#planning-modal-title");
  const taskTitle = document.querySelector("#planning-task-title");
  const taskOptions = document.querySelector("#planning-task-options");
  const dateOptions = document.querySelector("#planning-date-options");

  if (!modal || !taskOptions || !dateOptions) {
    return;
  }

  planningTaskId = null;
  taskOptions.innerHTML = "";
  dateOptions.innerHTML = "";

  if (modalTitle) {
    modalTitle.textContent = "Новая задача";
  }

  if (taskTitle) {
    taskTitle.textContent = "";
  }

  taskOptions.append(createQuickTaskForm());
  modal.hidden = false;

  const titleInput = taskOptions.querySelector("input[type='text']");

  if (titleInput) {
    titleInput.focus();
  }
}

function openQuickTaskModalForDate(dateKey) {
  const modal = document.querySelector("#planning-modal");
  const modalTitle = document.querySelector("#planning-modal-title");
  const taskTitle = document.querySelector("#planning-task-title");
  const taskOptions = document.querySelector("#planning-task-options");
  const dateOptions = document.querySelector("#planning-date-options");

  if (!modal || !taskOptions || !dateOptions) {
    return;
  }

  planningTaskId = null;
  taskOptions.innerHTML = "";
  dateOptions.innerHTML = "";

  if (modalTitle) {
    modalTitle.textContent = "Новая задача на день";
  }

  if (taskTitle) {
    taskTitle.textContent = formatPlanningDateLabel(dateKey);
  }

  taskOptions.append(createQuickTaskForm(dateKey));

  modal.hidden = false;
}

function createQuickTaskForm(dateKey) {
  const form = document.createElement("form");
  form.className = "quick-task-form";

  const titleLabel = document.createElement("label");
  titleLabel.className = "task-field";

  const titleText = document.createElement("span");
  titleText.textContent = "Название задачи";

  const titleInput = document.createElement("input");
  titleInput.type = "text";
  titleInput.placeholder = "Новая задача";
  titleInput.required = true;

  const folderLabel = document.createElement("label");
  folderLabel.className = "task-field";

  const folderText = document.createElement("span");
  folderText.textContent = "Папка";

  const folderSelect = document.createElement("select");
  renderFolderOptions(folderSelect, INBOX_FOLDER_ID);

  const dateLabel = document.createElement("label");
  dateLabel.className = "task-field";

  const dateText = document.createElement("span");
  dateText.textContent = "Дата планирования";

  const dateInput = document.createElement("input");
  dateInput.type = "date";
  dateInput.value = dateKey || "";

  const importanceLabel = document.createElement("label");
  importanceLabel.className = "task-field";

  const importanceText = document.createElement("span");
  importanceText.textContent = "Важность";

  const importanceSelect = document.createElement("select");
  importanceSelect.append(
    createOption("urgent_important", "Срочно/важно"),
    createOption("important", "Важно"),
    createOption("not_important", "Не важно")
  );
  importanceSelect.value = "important";

  const submitButton = document.createElement("button");
  submitButton.className = "button-primary";
  submitButton.type = "submit";
  submitButton.textContent = "Создать";

  titleLabel.append(titleText, titleInput);
  folderLabel.append(folderText, folderSelect);
  dateLabel.append(dateText, dateInput);
  importanceLabel.append(importanceText, importanceSelect);
  form.append(titleLabel, folderLabel, dateLabel, importanceLabel, submitButton);

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const title = titleInput.value.trim();

    if (!title) {
      return;
    }

    createTask({
      title,
      folderId: folderSelect.value,
      importance: importanceSelect.value,
      scheduledDate: dateInput.value || undefined,
    });
    expandedFolderIds.add(folderSelect.value);
    closePlanningModal();
  });

  return form;
}

function closePlanningModal() {
  const modal = document.querySelector("#planning-modal");

  planningTaskId = null;

  if (modal) {
    modal.hidden = true;
  }
}

function bindTaskDetailsModal() {
  const modal = document.querySelector("#task-details-modal");
  const closeButton = document.querySelector("#task-details-close");
  const form = document.querySelector("#task-details-form");
  const deleteButton = document.querySelector("#task-delete-button");
  const statusButton = document.querySelector("#task-status-toggle-button");
  const addButton = document.querySelector("#checklist-add-button");
  const newItemInput = document.querySelector("#checklist-new-item-input");

  if (!modal || !form) {
    return;
  }

  if (closeButton) {
    closeButton.addEventListener("click", closeTaskDetailsModal);
  }

  modal.addEventListener("click", (event) => {
    if (event.target === modal) {
      closeTaskDetailsModal();
    }
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    saveTaskDetails();
  });

  if (deleteButton) {
    deleteButton.addEventListener("click", deleteCurrentTask);
  }

  if (statusButton) {
    statusButton.addEventListener("click", () => {
      const task = findTaskById(detailsTaskId);

      if (task) {
        setTaskCompletion(task.id, !isTaskDone(task));
      }
    });
  }

  if (addButton && newItemInput) {
    addButton.addEventListener("click", () => {
      addChecklistItem(newItemInput.value);
      newItemInput.value = "";
    });

    newItemInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        addChecklistItem(newItemInput.value);
        newItemInput.value = "";
      }
    });
  }
}

function openTaskDetailsModal(taskId) {
  const modal = document.querySelector("#task-details-modal");
  const titleInput = document.querySelector("#task-details-title-input");
  const folderInput = document.querySelector("#task-details-folder-input");
  const dateInput = document.querySelector("#task-details-date-input");
  const importanceInput = document.querySelector("#task-details-importance-input");
  const task = findTaskById(taskId);

  if (!modal || !titleInput || !folderInput || !dateInput || !importanceInput || !task) {
    return;
  }

  detailsTaskId = taskId;
  titleInput.value = task.title;
  dateInput.value = task.scheduledDate || "";
  importanceInput.value = task.importance || "important";
  renderFolderOptions(folderInput, task.folderId);
  renderChecklistEditor(task);
  updateDetailsStatusButton(task);
  modal.hidden = false;
  titleInput.focus();
}

function closeTaskDetailsModal() {
  const modal = document.querySelector("#task-details-modal");

  detailsTaskId = null;

  if (modal) {
    modal.hidden = true;
  }
}

function renderFolderOptions(select, selectedFolderId) {
  select.innerHTML = "";

  plannerDatabase.folders.forEach((folder) => {
    const option = document.createElement("option");
    option.value = folder.id;
    option.textContent = folder.title;
    option.selected = folder.id === selectedFolderId;
    select.append(option);
  });
}

function saveTaskDetails() {
  const task = findTaskById(detailsTaskId);
  const titleInput = document.querySelector("#task-details-title-input");
  const folderInput = document.querySelector("#task-details-folder-input");
  const dateInput = document.querySelector("#task-details-date-input");
  const importanceInput = document.querySelector("#task-details-importance-input");

  if (!task || !titleInput || !folderInput || !dateInput || !importanceInput) {
    return;
  }

  const title = titleInput.value.trim();

  if (!title) {
    return;
  }

  task.title = title;
  task.folderId = folderInput.value;
  task.importance = importanceInput.value;

  if (dateInput.value) {
    task.scheduledDate = dateInput.value;
    task.carriedOver = false;
  } else {
    delete task.scheduledDate;
    task.carriedOver = false;
  }

  task.updatedAt = new Date().toISOString();
  persistAndRender();
  closeTaskDetailsModal();
}

function updateDetailsStatusButton(task) {
  const statusButton = document.querySelector("#task-status-toggle-button");

  if (!statusButton || !task) {
    return;
  }

  statusButton.textContent = isTaskDone(task) ? "Вернуть в активные" : "Отметить выполненной";
}

function deleteCurrentTask() {
  const task = findTaskById(detailsTaskId);

  if (!task) {
    return;
  }

  if (!confirm(`Удалить задачу "${task.title}"?`)) {
    return;
  }

  plannerDatabase.tasks = plannerDatabase.tasks.filter((candidate) => candidate.id !== task.id);
  persistAndRender();
  closeTaskDetailsModal();
}

function renderChecklistEditor(task) {
  const container = document.querySelector("#checklist-items");
  const counter = document.querySelector("#checklist-counter");

  if (!container || !counter) {
    return;
  }

  container.innerHTML = "";
  const checklist = Array.isArray(task.checklist) ? task.checklist : [];
  const doneCount = checklist.filter((item) => item.isDone).length;
  counter.textContent = `${doneCount}/${checklist.length}`;

  if (checklist.length === 0) {
    const emptyMessage = document.createElement("p");
    emptyMessage.className = "empty-day-message";
    emptyMessage.textContent = "Пунктов пока нет";
    container.append(emptyMessage);
    return;
  }

  checklist.forEach((item) => {
    const row = document.createElement("div");
    row.className = "checklist-item";
    row.classList.toggle("is-done", item.isDone);

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = item.isDone;
    checkbox.addEventListener("change", () => {
      toggleChecklistItem(item.id, checkbox.checked);
    });

    const textInput = document.createElement("input");
    textInput.type = "text";
    textInput.value = item.text;
    textInput.addEventListener("change", () => {
      updateChecklistItemText(item.id, textInput.value);
    });

    const deleteButton = document.createElement("button");
    deleteButton.className = "checklist-delete-button";
    deleteButton.type = "button";
    deleteButton.textContent = "Удалить";
    deleteButton.addEventListener("click", () => {
      deleteChecklistItem(item.id);
    });

    row.append(checkbox, textInput, deleteButton);
    container.append(row);
  });
}

function addChecklistItem(text) {
  const task = findTaskById(detailsTaskId);
  const cleanText = text.trim();

  if (!task || !cleanText) {
    return;
  }

  task.checklist.push({
    id: createChecklistItemId(),
    text: cleanText,
    isDone: false,
  });
  task.updatedAt = new Date().toISOString();
  persistAndRender();
  renderChecklistEditor(task);
}

function updateChecklistItemText(itemId, text) {
  const task = findTaskById(detailsTaskId);
  const item = task?.checklist.find((candidate) => candidate.id === itemId);
  const cleanText = text.trim();

  if (!task || !item || !cleanText) {
    renderChecklistEditor(task);
    return;
  }

  item.text = cleanText;
  task.updatedAt = new Date().toISOString();
  persistAndRender();
  renderChecklistEditor(task);
}

function toggleChecklistItem(itemId, isDone) {
  const task = findTaskById(detailsTaskId);
  const item = task?.checklist.find((candidate) => candidate.id === itemId);

  if (!task || !item) {
    return;
  }

  item.isDone = isDone;
  task.updatedAt = new Date().toISOString();

  const checklist = task.checklist;

  if (checklist.length > 0 && checklist.every(item => item.isDone)) {
    task.status = "done";
    task.completed = true;
    task.completedAt = new Date().toISOString();
  } else if (task.status === "done") {
    task.status = "active";
    task.completed = false;
    delete task.completedAt;
  }

  persistAndRender();
  renderChecklistEditor(task);
}

function deleteChecklistItem(itemId) {
  const task = findTaskById(detailsTaskId);

  if (!task) {
    return;
  }

  task.checklist = task.checklist.filter((item) => item.id !== itemId);
  task.updatedAt = new Date().toISOString();
  persistAndRender();
  renderChecklistEditor(task);
}

function createChecklistItemId() {
  return `check_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function findTaskById(taskId) {
  if (!taskId || !plannerDatabase || !Array.isArray(plannerDatabase.tasks)) {
    return null;
  }

  return plannerDatabase.tasks.find((task) => task.id === taskId) || null;
}

function persistAndRender() {
  saveDatabase(plannerDatabase);
  renderFolders(plannerDatabase.folders);
  renderSidebarTasks();
  renderWeek();
}

function getPlanningDateOptions() {
  const firstDate = addDays(currentWeekStart, -7);
  const dates = [];

  for (let index = 0; index < 21; index += 1) {
    dates.push(addDays(firstDate, index));
  }

  return dates;
}

function formatFullDate(date) {
  const monthNames = [
    "января",
    "февраля",
    "марта",
    "апреля",
    "мая",
    "июня",
    "июля",
    "августа",
    "сентября",
    "октября",
    "ноября",
    "декабря",
  ];
  const day = String(date.getDate()).padStart(2, "0");
  const month = monthNames[date.getMonth()];
  const year = date.getFullYear();

  return `${day} ${month} ${year}`;
}

function formatShortDateKey(dateKey) {
  const [year, month, day] = dateKey.split("-");

  return `${day}.${month}.${year}`;
}

function formatPlanningDateLabel(dateKey) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(year, month - 1, day);

  return `Дата: ${formatPlanningDate(date)}`;
}

function formatDayTitle(date) {
  const weekday = new Intl.DateTimeFormat("ru-RU", {
    weekday: "long",
  }).format(date);
  const dayMonth = new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
  }).format(date);
  const capitalizedWeekday = weekday.charAt(0).toUpperCase() + weekday.slice(1);

  return `${capitalizedWeekday}, ${dayMonth}`;
}

function formatPlanningDate(date) {
  const weekday = new Intl.DateTimeFormat("ru-RU", {
    weekday: "short",
  }).format(date);

  return `${weekday}, ${formatDayMonth(date)}`;
}

function formatDayMonth(date) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
  }).format(date);
}

function getActiveTaskCountForDate(dateKey) {
  if (!plannerDatabase || !Array.isArray(plannerDatabase.tasks)) {
    return 0;
  }

  return plannerDatabase.tasks.filter((task) => {
    const plannedDate = task.scheduledDate || task.plannedDate || task.date;

    return plannedDate === dateKey && !isTaskDone(task);
  }).length;
}

function getValidFolderId(folderId) {
  if (!plannerDatabase || !Array.isArray(plannerDatabase.folders)) {
    return INBOX_FOLDER_ID;
  }

  return plannerDatabase.folders.some((folder) => folder.id === folderId) ? folderId : INBOX_FOLDER_ID;
}

function getActiveTaskCountForFolder(folderId) {
  if (!plannerDatabase || !Array.isArray(plannerDatabase.tasks)) {
    return 0;
  }

  return plannerDatabase.tasks.filter((task) => {
    return task.folderId === folderId && !isTaskDone(task);
  }).length;
}

function bindCarryOverTriggers() {
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      checkAndCarryOverTasks();
    }
  });

  if (carryOverTimerId) {
    clearInterval(carryOverTimerId);
  }

  carryOverTimerId = setInterval(() => {
    checkAndCarryOverTasks();
  }, 60000);
}

function checkAndCarryOverTasks(options = {}) {
  if (!plannerDatabase || !Array.isArray(plannerDatabase.tasks)) {
    return false;
  }

  const shouldRender = options.shouldRender !== false;
  const todayKey = getDateKey(new Date());
  let hasChanges = false;

  plannerDatabase.tasks.forEach((task) => {
    if (task.scheduledDate < todayKey && task.status === "active") {
      task.scheduledDate = todayKey;
      task.carriedOver = true;
      task.updatedAt = new Date().toISOString();
      hasChanges = true;
    }
  });

  if (!hasChanges) {
    return false;
  }

  saveDatabase(plannerDatabase);

  if (shouldRender) {
    renderFolders(plannerDatabase.folders);
    renderSidebarTasks();
    renderWeek();
  }

  return true;
}

function updateStorageStatus(result) {
  const statusElement = document.querySelector("#storage-status");

  if (!statusElement) {
    return;
  }

  const messages = {
    created: "Создана база данных и системная папка \"Входящие мысли\".",
    ready: "Данные найдены и успешно проверены.",
    recovered: "Данные были повреждены, поэтому создана новая безопасная структура.",
  };

  statusElement.textContent = messages[result.status] || messages.ready;
}

function showStorageErrorNotification() {
  const notificationRoot = document.querySelector("#notification-root");

  if (!notificationRoot) {
    return;
  }

  notificationRoot.innerHTML = "";

  const notification = document.createElement("div");
  notification.className = "notification";
  notification.setAttribute("role", "alert");

  const title = document.createElement("h2");
  title.textContent = "Данные были восстановлены";

  const message = document.createElement("p");
  message.textContent =
    "Локальное хранилище было повреждено. Приложение создало новую базовую структуру.";

  const resetButton = document.createElement("button");
  resetButton.type = "button";
  resetButton.textContent = "Сбросить данные";
  resetButton.addEventListener("click", resetDatabase);

  notification.append(title, message, resetButton);
  notificationRoot.append(notification);
}

function resetDatabase() {
  const database = createDefaultDatabase();
  saveDatabase(database);
  plannerDatabase = database;
  expandedFolderIds.clear();
  expandedFolderIds.add(INBOX_FOLDER_ID);
  renderFolders(plannerDatabase.folders);
  renderSidebarTasks();
  renderWeek();

  updateStorageStatus({
    database,
    status: "created",
    wasRecovered: false,
  });

  const notificationRoot = document.querySelector("#notification-root");

  if (notificationRoot) {
    notificationRoot.innerHTML = "";
  }
}
