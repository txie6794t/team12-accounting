import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getFirestore,
  collection,
  addDoc,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  onSnapshot,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

console.log("accounting-app Firebase final2 version loaded");

const firebaseConfig = {
  apiKey: "AIzaSyCYp5QyVbA6g9aqGe_u0PJSa8Ioc1PEOQk",
  authDomain: "team12-accounting.firebaseapp.com",
  projectId: "team12-accounting",
  storageBucket: "team12-accounting.firebasestorage.app",
  messagingSenderId: "167582256866",
  appId: "1:167582256866:web:7a7994721d848bd83318bb"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const recordsCollection = collection(db, "records");
const usersCollection = collection(db, "users");

const categoryOptions = {
  expense: [
    "吃飯 🍱",
    "交通 🚌",
    "娛樂 🎮",
    "生活用品 🧻",
    "學習 📚",
    "房租 🏠",
    "醫療 🏥",
    "其他 ✨"
  ],
  income: [
    "薪水 💼",
    "獎學金 🎓",
    "打工收入 🧑‍💼",
    "投資收入 📈",
    "補助 💰",
    "禮金 🎁",
    "其他 ✨",
    "生活費 🧾"
  ]
};

let records = [];
let currentUser = localStorage.getItem("accountingCurrentUser") || "";
let currentUserId = localStorage.getItem("accountingCurrentUserId") || "";
let unsubscribeRecords = null;

const loginSection = document.getElementById("loginSection");
const appSection = document.getElementById("appSection");
const userPanel = document.getElementById("userPanel");
const currentUserNameEl = document.getElementById("currentUserName");
const qrImage = document.getElementById("qrImage");
const copyLoginLinkBtn = document.getElementById("copyLoginLinkBtn");

const loginForm = document.getElementById("loginForm");
const authSubmitBtn = document.getElementById("authSubmitBtn");
const authModeInputs = document.querySelectorAll('input[name="authMode"]');
const logoutBtn = document.getElementById("logoutBtn");

const form = document.getElementById("recordForm");
const typeSelect = document.getElementById("type");
const categorySelect = document.getElementById("category");
const recordTable = document.getElementById("recordTable");
const emptyMessage = document.getElementById("emptyMessage");

const exportCsvBtn = document.getElementById("exportCsvBtn");
const importCsvInput = document.getElementById("importCsvInput");
const deleteAllBtn = document.getElementById("deleteAllBtn");

const totalIncomeEl = document.getElementById("totalIncome");
const totalExpenseEl = document.getElementById("totalExpense");
const balanceEl = document.getElementById("balance");
const monthlyIncomeEl = document.getElementById("monthlyIncome");
const monthlyExpenseEl = document.getElementById("monthlyExpense");
const monthlyBalanceEl = document.getElementById("monthlyBalance");

const weeklyChartTitle = document.getElementById("weeklyChartTitle");
const weekRangeSelect = document.getElementById("weekRangeSelect");
const chartCategoryFilters = document.getElementById("chartCategoryFilters");
const weeklyChart = document.getElementById("weeklyChart");
const chartCtx = weeklyChart.getContext("2d");
let selectedChartCategories = new Set(categoryOptions.expense);
let chartFiltersInitialized = false;

document.getElementById("date").valueAsDate = new Date();
typeSelect.addEventListener("change", updateCategoryOptions);
weekRangeSelect.addEventListener("change", render);
authModeInputs.forEach((input) => {
  input.addEventListener("change", updateAuthModeText);
});
updateCategoryOptions();
updateAuthModeText();
renderChartCategoryFilters();
restoreLoginFromUrl();

loginForm.addEventListener("submit", async function (event) {
  event.preventDefault();

  const name = normalizeUserName(document.getElementById("loginName").value);
  const password = document.getElementById("loginPassword").value;
  const authMode = getAuthMode();

  if (!name || !password) {
    alert("請輸入名稱與密碼。");
    return;
  }

  const loginButton = loginForm.querySelector("button[type='submit']");
  loginButton.disabled = true;
  loginButton.textContent = authMode === "register" ? "註冊中" : "登入中";

  try {
    const nameKey = makeNameKey(name);
    const passwordHash = await sha256(`${nameKey}::${password}`);
    const userRef = doc(db, "users", nameKey);
    const userSnap = await getDoc(userRef);

    if (authMode === "register") {
      if (userSnap.exists()) {
        alert("這個使用者名稱已經被註冊，請改用其他名稱或切換成登入。");
        return;
      }

      await setDoc(userRef, {
        displayName: name,
        nameKey,
        passwordHash,
        createdAt: serverTimestamp()
      });
    } else {
      if (!userSnap.exists()) {
        alert("找不到這個使用者名稱，請先註冊。");
        return;
      }

      const userData = userSnap.data();

      if (userData.passwordHash !== passwordHash) {
        alert("密碼錯誤，請重新輸入。");
        return;
      }
    }

    currentUser = name;
    currentUserId = nameKey;
    localStorage.setItem("accountingCurrentUser", currentUser);
    localStorage.setItem("accountingCurrentUserId", currentUserId);
    loginForm.reset();

    updateLoginState();
  } catch (error) {
    console.error(error);
    alert("操作失敗，請確認 Firestore Rules 已允許 users 和 records 讀寫。");
  } finally {
    loginButton.disabled = false;
    updateAuthModeText();
  }
});

logoutBtn.addEventListener("click", function () {
  currentUser = "";
  currentUserId = "";
  records = [];
  localStorage.removeItem("accountingCurrentUser");
  localStorage.removeItem("accountingCurrentUserId");

  if (unsubscribeRecords) {
    unsubscribeRecords();
    unsubscribeRecords = null;
  }

  updateLoginState();
});

copyLoginLinkBtn.addEventListener("click", async function () {
  const url = getDirectLoginUrl();

  try {
    await navigator.clipboard.writeText(url);
    alert("已複製直接登入連結。");
  } catch {
    prompt("請複製這個直接登入連結：", url);
  }
});

form.addEventListener("submit", function (event) {
  event.preventDefault();

  if (!currentUser || !currentUserId) {
    alert("請先登入。");
    return;
  }

  const submitButton = form.querySelector("button[type='submit']");
  submitButton.disabled = true;
  submitButton.textContent = "新增中";

  const restoreButtonTimer = setTimeout(function () {
    submitButton.disabled = false;
    submitButton.textContent = "新增";
  }, 1200);

  const amount = Number(document.getElementById("amount").value);

  if (!Number.isInteger(amount) || amount <= 0) {
    alert("金額請輸入任意正整數。");
    submitButton.disabled = false;
    submitButton.textContent = "新增";
    clearTimeout(restoreButtonTimer);
    return;
  }

  const record = {
    userId: currentUserId,
    userName: currentUser,
    type: typeSelect.value,
    date: document.getElementById("date").value,
    amount,
    category: categorySelect.value,
    note: document.getElementById("note").value.trim(),
    createdAt: serverTimestamp()
  };

  addDoc(recordsCollection, record).catch(function (error) {
    console.error(error);
    alert("新增失敗，請確認 Firestore Database 和 Rules 是否已設定完成。");
  });

  form.reset();
  typeSelect.value = "expense";
  updateCategoryOptions();
  document.getElementById("date").valueAsDate = new Date();

  setTimeout(function () {
    clearTimeout(restoreButtonTimer);
    submitButton.disabled = false;
    submitButton.textContent = "新增";
  }, 500);
});

recordTable.addEventListener("click", async function (event) {
  if (!event.target.classList.contains("delete-record-btn")) {
    return;
  }

  const id = event.target.dataset.id;
  const ok = confirm("確定要刪除這筆紀錄嗎？這個動作不能復原。");

  if (!ok) {
    return;
  }

  event.target.disabled = true;
  event.target.textContent = "刪除中";

  try {
    await deleteDoc(doc(db, "records", id));
  } catch (error) {
    console.error(error);
    alert("刪除單筆紀錄失敗，請稍後再試。");
    event.target.disabled = false;
    event.target.textContent = "刪除";
  }
});

exportCsvBtn.addEventListener("click", exportRecordsToCsv);

importCsvInput.addEventListener("change", async function (event) {
  const file = event.target.files[0];

  if (!file) {
    return;
  }

  try {
    const text = await file.text();
    const importedRecords = parseCsvRecords(text);

    if (importedRecords.length === 0) {
      alert("CSV 沒有可匯入的資料。");
      return;
    }

    const ok = confirm(`確定要匯入 ${importedRecords.length} 筆資料到目前帳號嗎？`);

    if (!ok) {
      return;
    }

    for (const record of importedRecords) {
      await addDoc(recordsCollection, {
        ...record,
        userId: currentUserId,
        userName: currentUser,
        createdAt: serverTimestamp()
      });
    }

    alert("CSV 匯入完成。");
  } catch (error) {
    console.error(error);
    alert("CSV 匯入失敗，請確認檔案格式。");
  } finally {
    importCsvInput.value = "";
  }
});

deleteAllBtn.addEventListener("click", async function () {
  if (records.length === 0) {
    alert("目前沒有資料可以刪除。");
    return;
  }

  const ok = confirm(`確定要刪除目前帳號的 ${records.length} 筆資料嗎？這個動作不能復原。`);

  if (!ok) {
    return;
  }

  deleteAllBtn.disabled = true;
  deleteAllBtn.textContent = "刪除中";

  try {
    for (const record of records) {
      await deleteDoc(doc(db, "records", record.id));
    }

    alert("已刪除所有資料。");
  } catch (error) {
    console.error(error);
    alert("刪除失敗，請稍後再試。");
  } finally {
    deleteAllBtn.disabled = false;
    deleteAllBtn.textContent = "刪除所有資料";
  }
});

function getAuthMode() {
  const checked = document.querySelector('input[name="authMode"]:checked');
  return checked ? checked.value : "login";
}

function updateAuthModeText() {
  if (!authSubmitBtn) {
    return;
  }

  authSubmitBtn.textContent = getAuthMode() === "register" ? "註冊" : "登入";
}

function updateCategoryOptions() {
  const selectedType = typeSelect.value;
  const options = categoryOptions[selectedType] || [];
  const previousValue = categorySelect.value;

  categorySelect.innerHTML = '<option value="">請選擇類別</option>';

  for (const optionText of options) {
    const option = document.createElement("option");
    option.value = optionText;
    option.textContent = optionText;
    categorySelect.appendChild(option);
  }

  if (options.includes(previousValue)) {
    categorySelect.value = previousValue;
  }
}

function getAllExpenseCategories() {
  const categories = new Set(categoryOptions.expense);

  for (const record of records) {
    if (record.type === "expense" && record.category) {
      categories.add(record.category);
    }
  }

  return Array.from(categories);
}

function renderChartCategoryFilters() {
  const categories = getAllExpenseCategories();

  if (!chartFiltersInitialized) {
    selectedChartCategories = new Set(categories);
    chartFiltersInitialized = true;
  }

  chartCategoryFilters.innerHTML = "";

  for (const category of categories) {
    const label = document.createElement("label");
    const checkbox = document.createElement("input");

    checkbox.type = "checkbox";
    checkbox.value = category;
    checkbox.checked = selectedChartCategories.has(category);
    checkbox.addEventListener("change", function () {
      if (checkbox.checked) {
        selectedChartCategories.add(category);
      } else {
        selectedChartCategories.delete(category);
      }

      drawWeeklyChart(records);
    });

    label.appendChild(checkbox);
    label.append(category);
    chartCategoryFilters.appendChild(label);
  }
}

function normalizeUserName(name) {
  return name.trim().replace(/\s+/g, " ");
}

function makeNameKey(name) {
  return normalizeUserName(name).toLowerCase();
}

async function sha256(text) {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function restoreLoginFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const name = params.get("name");
  const userId = params.get("uid");

  if (name && userId) {
    currentUser = normalizeUserName(decodeURIComponent(name));
    currentUserId = userId;
    localStorage.setItem("accountingCurrentUser", currentUser);
    localStorage.setItem("accountingCurrentUserId", currentUserId);
  }
}

function getDirectLoginUrl() {
  const url = new URL(window.location.href);
  url.searchParams.set("name", currentUser);
  url.searchParams.set("uid", currentUserId);
  return url.toString();
}

function drawQrCode() {
  if (!currentUser || !currentUserId) {
    qrImage.removeAttribute("src");
    return;
  }

  const loginUrl = getDirectLoginUrl();
  const qrUrl = "https://api.qrserver.com/v1/create-qr-code/?size=160x160&margin=1&data=" + encodeURIComponent(loginUrl);
  qrImage.src = qrUrl;
}

function listenToCurrentUserRecords() {
  if (unsubscribeRecords) {
    unsubscribeRecords();
    unsubscribeRecords = null;
  }

  if (!currentUserId) {
    records = [];
    render();
    return;
  }

  const userQuery = query(recordsCollection, where("userId", "==", currentUserId));

  unsubscribeRecords = onSnapshot(
    userQuery,
    function (snapshot) {
      records = snapshot.docs.map((document) => ({
        id: document.id,
        ...document.data()
      }));

      records.sort((a, b) => {
        if (a.date === b.date) {
          return Number(a.createdAt?.seconds || 0) - Number(b.createdAt?.seconds || 0);
        }
        return a.date.localeCompare(b.date);
      });

      render();
    },
    function (error) {
      console.error(error);
      alert("讀取資料失敗，請確認 Firebase 設定與 Firestore Rules。");
    }
  );
}

function updateLoginState() {
  if (currentUser && currentUserId) {
    loginSection.classList.add("hidden");
    appSection.classList.remove("hidden");
    userPanel.classList.remove("hidden");
    currentUserNameEl.textContent = currentUser;
    drawQrCode();
    listenToCurrentUserRecords();
  } else {
    loginSection.classList.remove("hidden");
    appSection.classList.add("hidden");
    userPanel.classList.add("hidden");
    currentUserNameEl.textContent = "";
    render();
  }
}

function formatMoney(value) {
  return Math.round(value).toLocaleString("zh-TW");
}

function isCurrentMonth(dateText) {
  const date = new Date(`${dateText}T00:00:00`);
  const now = new Date();

  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth()
  );
}

function getWeekStartFromDate(date) {
  const result = new Date(date);
  const day = result.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  result.setDate(result.getDate() + diff);
  result.setHours(0, 0, 0, 0);
  return result;
}

function getWeekStart(dateText) {
  return getWeekStartFromDate(new Date(`${dateText}T00:00:00`));
}

function formatWeekLabel(date) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${month}/${day}`;
}

function getSelectedWeekCount() {
  return Number(weekRangeSelect.value || 10);
}

function getLastNWeekStarts(weekCount) {
  const currentWeekStart = getWeekStartFromDate(new Date());
  const weeks = [];

  for (let i = weekCount - 1; i >= 0; i--) {
    const week = new Date(currentWeekStart);
    week.setDate(currentWeekStart.getDate() - i * 7);
    weeks.push(week);
  }

  return weeks;
}

function getWeeklyExpenseData(userRecords) {
  const weekCount = getSelectedWeekCount();
  const weeks = getLastNWeekStarts(weekCount);
  const weeklyMap = new Map();

  for (const week of weeks) {
    weeklyMap.set(week.toISOString().slice(0, 10), {
      weekStart: week,
      total: 0
    });
  }

  for (const record of userRecords) {
    if (
      record.type !== "expense" ||
      !selectedChartCategories.has(record.category)
    ) {
      continue;
    }

    const weekStart = getWeekStart(record.date);
    const key = weekStart.toISOString().slice(0, 10);

    if (weeklyMap.has(key)) {
      weeklyMap.get(key).total += Number(record.amount || 0);
    }
  }

  return Array.from(weeklyMap.values()).sort((a, b) => a.weekStart - b.weekStart);
}

function drawWeeklyChart(userRecords) {
  const width = weeklyChart.width;
  const height = weeklyChart.height;
  const padding = {
    top: 28,
    right: 28,
    bottom: 52,
    left: 74
  };

  chartCtx.clearRect(0, 0, width, height);
  chartCtx.fillStyle = "#ffffff";
  chartCtx.fillRect(0, 0, width, height);

  const data = getWeeklyExpenseData(userRecords);
  weeklyChartTitle.textContent = "支出折線圖";
  const maxValue = Math.max(...data.map((item) => item.total), 1);
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  chartCtx.strokeStyle = "#d8dee6";
  chartCtx.lineWidth = 1;
  chartCtx.beginPath();
  chartCtx.moveTo(padding.left, padding.top);
  chartCtx.lineTo(padding.left, padding.top + chartHeight);
  chartCtx.lineTo(padding.left + chartWidth, padding.top + chartHeight);
  chartCtx.stroke();

  const gridCount = 4;
  chartCtx.font = "13px Arial";
  chartCtx.fillStyle = "#687482";

  for (let i = 0; i <= gridCount; i++) {
    const value = Math.round((maxValue / gridCount) * i);
    const y = padding.top + chartHeight - (chartHeight / gridCount) * i;

    chartCtx.strokeStyle = "#edf1f5";
    chartCtx.beginPath();
    chartCtx.moveTo(padding.left, y);
    chartCtx.lineTo(padding.left + chartWidth, y);
    chartCtx.stroke();

    chartCtx.fillStyle = "#687482";
    chartCtx.fillText(formatMoney(value), 12, y + 4);
  }

  const points = data.map((item, index) => {
    const x = padding.left + (chartWidth / (data.length - 1)) * index;
    const y = padding.top + chartHeight - (item.total / maxValue) * chartHeight;

    return {
      x,
      y,
      label: formatWeekLabel(item.weekStart),
      total: item.total
    };
  });

  chartCtx.strokeStyle = "#1f6feb";
  chartCtx.lineWidth = 3;
  chartCtx.beginPath();

  points.forEach((point, index) => {
    if (index === 0) {
      chartCtx.moveTo(point.x, point.y);
    } else {
      chartCtx.lineTo(point.x, point.y);
    }
  });

  chartCtx.stroke();

  points.forEach((point) => {
    chartCtx.fillStyle = "#1f6feb";
    chartCtx.beginPath();
    chartCtx.arc(point.x, point.y, 4, 0, Math.PI * 2);
    chartCtx.fill();

    chartCtx.fillStyle = "#17202a";
    chartCtx.font = "12px Arial";
    chartCtx.textAlign = "center";
    chartCtx.fillText(point.label, point.x, padding.top + chartHeight + 24);

    if (point.total > 0) {
      chartCtx.fillText(formatMoney(point.total), point.x, point.y - 10);
    }
  });

  chartCtx.textAlign = "left";
}

function render() {
  recordTable.innerHTML = "";

  let totalIncome = 0;
  let totalExpense = 0;
  let monthlyIncome = 0;
  let monthlyExpense = 0;

  for (const record of records) {
    const amount = Number(record.amount || 0);

    if (record.type === "income") {
      totalIncome += amount;

      if (isCurrentMonth(record.date)) {
        monthlyIncome += amount;
      }
    } else {
      totalExpense += amount;

      if (isCurrentMonth(record.date)) {
        monthlyExpense += amount;
      }
    }

    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${record.date}</td>
      <td>${record.type === "income" ? "收入" : "支出"}</td>
      <td>${formatMoney(amount)}</td>
      <td>${record.category}</td>
      <td>${record.note || "-"}</td>
      <td>
        <button type="button" class="delete-record-btn" data-id="${record.id}">刪除</button>
      </td>
    `;
    recordTable.appendChild(row);
  }

  totalIncomeEl.textContent = formatMoney(totalIncome);
  totalExpenseEl.textContent = formatMoney(totalExpense);
  balanceEl.textContent = formatMoney(totalIncome - totalExpense);
  monthlyIncomeEl.textContent = formatMoney(monthlyIncome);
  monthlyExpenseEl.textContent = formatMoney(monthlyExpense);
  monthlyBalanceEl.textContent = formatMoney(monthlyIncome - monthlyExpense);

  emptyMessage.classList.toggle("hidden", records.length > 0);
  renderChartCategoryFilters();
  drawWeeklyChart(records);
}

function exportRecordsToCsv() {
  if (records.length === 0) {
    alert("目前沒有資料可以匯出。");
    return;
  }

  const headers = ["日期", "類型", "金額", "類別", "備註"];
  const rows = records.map((record) => [
    record.date,
    record.type === "income" ? "收入" : "支出",
    record.amount,
    record.category,
    record.note || ""
  ]);

  const csv = [headers, ...rows]
    .map((row) => row.map(escapeCsvCell).join(","))
    .join("\n");

  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const date = new Date().toISOString().slice(0, 10);

  link.href = url;
  link.download = `accounting-records-${currentUser}-${date}.csv`;
  link.click();

  URL.revokeObjectURL(url);
}

function escapeCsvCell(value) {
  const text = String(value ?? "");
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function parseCsvRecords(text) {
  const rows = parseCsvRows(text).filter((row) => row.some((cell) => cell.trim() !== ""));

  if (rows.length <= 1) {
    return [];
  }

  const header = rows[0].map((cell) => cell.trim());
  const getIndex = (...names) => names.map((name) => header.indexOf(name)).find((index) => index !== -1);

  const dateIndex = getIndex("日期", "date");
  const typeIndex = getIndex("類型", "type");
  const amountIndex = getIndex("金額", "amount");
  const categoryIndex = getIndex("類別", "category");
  const noteIndex = getIndex("備註", "note");

  if (dateIndex === undefined || typeIndex === undefined || amountIndex === undefined || categoryIndex === undefined) {
    throw new Error("CSV 缺少必要欄位");
  }

  return rows.slice(1).map((row) => {
    const typeText = (row[typeIndex] || "").trim();
    const type = typeText === "收入" || typeText === "income" ? "income" : "expense";

    return {
      date: (row[dateIndex] || "").trim(),
      type,
      amount: Number(row[amountIndex] || 0),
      category: (row[categoryIndex] || "").trim(),
      note: noteIndex !== undefined ? (row[noteIndex] || "").trim() : ""
    };
  }).filter((record) =>
    record.date &&
    record.category &&
    Number.isInteger(record.amount) &&
    record.amount > 0
  );
}

function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"' && inQuotes && next === '"') {
      cell += '"';
      i++;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        i++;
      }
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  row.push(cell);
  rows.push(row);
  return rows;
}

updateLoginState();
