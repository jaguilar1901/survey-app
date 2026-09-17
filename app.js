const SUPABASE_URL = "https://evczlmoklauimtvkbcpm.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_54la18DFNTeBPbuYtSF4eQ_wEPzmjlI";
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

const SURVEY_TABLE = "Survey2026_Consoldado";
const HIDDEN_COMMENTS_TABLE = "Tabla_Encuesta_hidden_comments";

let rawData2025 = [];
let rawData2026 = [];

// Instancias de Gráficos
let charts = {};
let selectedDept = 'ALL';
let selectedYear = 'ALL';
let vocFilter = 'ALL';
let vocSentimentFilter = 'ALL';
let vocSentimentMap = new Map(); // comment_key -> "positive" | "negative" | "neutral"
let sentimentEnsureStarted = false;

// Comentarios ocultados manualmente desde el Panel Administrativo (tabla
// hidden_comments en Supabase). Es un Set de "comment_key" para consulta
// O(1). Se carga una vez al iniciar y se actualiza en memoria + Supabase
// cada vez que se oculta/restaura un comentario desde el panel.
let hiddenCommentKeys = new Set();
let adminSearch = "";
let adminCategoryFilter = "ALL";
let adminShowOnlyHidden = false;

// Sesión actual (rol/equipos) — se llena tras un login exitoso y una fila
// encontrada en app_users. currentUser === null significa "sin sesión" o
// "sin rol asignado".
let currentUser = null;

document.addEventListener("DOMContentLoaded", () => {
  if (window.lucide) lucide.createIcons();
  initAuth();
});

// AUTENTICACIÓN — correo + contraseña, restringido a @uassistme.com por un
// trigger en la base de datos. Tener cuenta NO da acceso por sí solo: además
// debe existir una fila en app_users (agregada por un admin desde "Gestión
// de Accesos") que determina el rol. "Crear cuenta" usa signUp() para que
// cada persona defina su propia contraseña (nadie más la conoce); requiere
// que "Confirm email" esté desactivado en Supabase Auth para no depender del
// envío de correos.
function showScreen(name) {
  document.getElementById("login-screen").classList.toggle("hidden", name !== "login");
  document.getElementById("denied-screen").classList.toggle("hidden", name !== "denied");
  document.getElementById("app-root").classList.toggle("hidden", name !== "app");
}

async function initAuth() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (session) {
    await loadCurrentUserAndBoot();
  } else {
    showScreen("login");
  }
  wireAuthEventListeners();
}

function wireAuthEventListeners() {
  document.getElementById("btn-login").addEventListener("click", handleLogin);
  document.getElementById("btn-signup").addEventListener("click", handleSignup);
  document.getElementById("btn-logout").addEventListener("click", logout);
  document.getElementById("btn-logout-denied").addEventListener("click", logout);
  document.getElementById("login-password").addEventListener("keydown", (e) => {
    if (e.key === "Enter") handleLogin();
  });
}

function setLoginError(msg) {
  const el = document.getElementById("login-error");
  el.textContent = msg;
  el.classList.toggle("hidden", !msg);
}

function readLoginForm() {
  const email = document.getElementById("login-email").value.trim().toLowerCase();
  const password = document.getElementById("login-password").value;
  if (!/^[a-z0-9._%+-]+@uassistme\.com$/.test(email)) {
    setLoginError("Usa tu correo @uassistme.com");
    return null;
  }
  if (password.length < 6) {
    setLoginError("La contraseña debe tener al menos 6 caracteres.");
    return null;
  }
  return { email, password };
}

async function handleLogin() {
  setLoginError("");
  const form = readLoginForm();
  if (!form) return;

  const btn = document.getElementById("btn-login");
  btn.disabled = true;
  const { error } = await supabaseClient.auth.signInWithPassword(form);
  btn.disabled = false;
  if (error) {
    setLoginError(error.message === "Invalid login credentials" ? "Correo o contraseña incorrectos." : error.message);
    return;
  }
  await loadCurrentUserAndBoot();
}

async function handleSignup() {
  setLoginError("");
  const form = readLoginForm();
  if (!form) return;

  const btn = document.getElementById("btn-signup");
  btn.disabled = true;
  const { data, error } = await supabaseClient.auth.signUp(form);
  btn.disabled = false;
  if (error) {
    setLoginError(error.message || "No se pudo crear la cuenta.");
    return;
  }
  if (!data.session) {
    setLoginError("Cuenta creada, pero falta confirmar el correo. Pide a un administrador que desactive \"Confirm email\" en Supabase.");
    return;
  }
  await loadCurrentUserAndBoot();
}

async function logout() {
  await supabaseClient.auth.signOut();
  currentUser = null;
  document.getElementById("login-email").value = "";
  document.getElementById("login-password").value = "";
  showScreen("login");
}

async function loadCurrentUserAndBoot() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) {
    showScreen("login");
    return;
  }
  const email = session.user.email;
  const { data: userRow, error } = await supabaseClient.from("app_users").select("*").eq("email", email).maybeSingle();

  if (error || !userRow) {
    document.getElementById("denied-email").textContent = email;
    showScreen("denied");
    return;
  }

  let teams = [];
  if (userRow.role === "supervisor") {
    const { data: teamRows } = await supabaseClient.from("supervisor_teams").select("team_name").eq("email", email);
    teams = (teamRows || []).map(r => r.team_name);
  }
  currentUser = { email, fullName: userRow.full_name, role: userRow.role, teams };

  document.getElementById("user-card-name").textContent = currentUser.fullName;
  document.getElementById("user-card-role").textContent = currentUser.role === "admin" ? "Administrador" : `Supervisor · ${teams.join(", ") || "sin equipo"}`;
  document.getElementById("nav-access").classList.toggle("hidden", currentUser.role !== "admin");

  showScreen("app");
  initDashboard();
}

async function initDashboard() {
  try {
    const [res2025, res2026, resHidden, resSentiment] = await Promise.all([
      supabaseClient.from(SURVEY_TABLE).select("*").eq("survey_year", 2025),
      supabaseClient.from(SURVEY_TABLE).select("*").eq("survey_year", 2026),
      supabaseClient.from(HIDDEN_COMMENTS_TABLE).select("comment_key"),
      supabaseClient.from("voc_sentiment").select("comment_key, sentiment")
    ]);

    if (res2025.error) throw res2025.error;
    if (res2026.error) throw res2026.error;
    if (resHidden.error) throw resHidden.error;

    rawData2025 = res2025.data || [];
    rawData2026 = res2026.data || [];
    hiddenCommentKeys = new Set((resHidden.data || []).map(r => r.comment_key));
    vocSentimentMap = new Map((resSentiment.data || []).map(r => [r.comment_key, r.sentiment]));

    setConnectionStatus("connected", "check-circle-2", "Supabase DB Conectada");
    document.querySelectorAll(".kpi-value.loading").forEach(el => el.classList.remove("loading"));

    setupEventListeners();
    renderAll();
  } catch (err) {
    console.error("Error conectando a Supabase:", err);
    setConnectionStatus("error", "alert-circle", "Error de Conexión");
  }
}

function setConnectionStatus(state, icon, text) {
  const cardEl = document.getElementById("status-card");
  if (!cardEl) return;
  cardEl.className = `status-card ${state}`;
  cardEl.innerHTML = `<i data-lucide="${icon}" id="status-icon"></i> <span id="status-text">${escapeHtml(text)}</span>`;
  if (window.lucide) lucide.createIcons();
}

let eventListenersWired = false;

function setupEventListeners() {
  if (eventListenersWired) return;
  eventListenersWired = true;

  const deptSelector = document.getElementById("target-dept-selector");
  if (deptSelector) {
    deptSelector.addEventListener("change", (e) => {
      selectedDept = e.target.value;
      renderAll();
    });
  }

  const yearSelector = document.getElementById("target-year-selector");
  if (yearSelector) {
    yearSelector.addEventListener("change", (e) => {
      selectedYear = e.target.value;
      renderAll();
    });
  }

  const exportBtn = document.getElementById("btn-export-pdf");
  if (exportBtn) {
    exportBtn.addEventListener("click", () => window.print());
  }

  const adminSearchInput = document.getElementById("admin-search");
  if (adminSearchInput) {
    adminSearchInput.addEventListener("input", (e) => setAdminSearch(e.target.value));
  }

  const adminCategorySelect = document.getElementById("admin-category-filter");
  if (adminCategorySelect) {
    adminCategorySelect.addEventListener("change", (e) => setAdminCategoryFilter(e.target.value));
  }

  const adminHiddenCheckbox = document.getElementById("admin-only-hidden");
  if (adminHiddenCheckbox) {
    adminHiddenCheckbox.addEventListener("change", (e) => setAdminShowOnlyHidden(e.target.checked));
  }

  const accessRoleSelect = document.getElementById("access-role");
  if (accessRoleSelect) {
    accessRoleSelect.addEventListener("change", (e) => {
      document.getElementById("access-teams-group").classList.toggle("hidden", e.target.value !== "supervisor");
    });
  }

  const accessForm = document.getElementById("access-form");
  if (accessForm) {
    accessForm.addEventListener("submit", handleAddAccessUser);
  }
}

// GESTIÓN DE ACCESOS (solo admins) — alta/baja de administradores y
// supervisores, y asignación de qué equipo(s) de "choose_your_team" puede
// ver cada supervisor. La base de datos (RLS) es la que realmente aplica
// estas reglas; esta pantalla solo es la interfaz para administrarlas.
let accessTeamsLoaded = false;

async function loadAccessTab() {
  if (!accessTeamsLoaded) {
    const { data, error } = await supabaseClient.from(SURVEY_TABLE).select("choose_your_team");
    if (!error && data) {
      const teams = [...new Set(data.map(r => r.choose_your_team).filter(Boolean))].sort();
      const select = document.getElementById("access-teams");
      select.innerHTML = teams.map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join("");
      accessTeamsLoaded = true;
    }
  }
  await renderAccessUsersList();
}

async function renderAccessUsersList() {
  const tbody = document.getElementById("access-users-list");
  if (!tbody) return;

  const [{ data: users, error: usersError }, { data: teamRows }] = await Promise.all([
    supabaseClient.from("app_users").select("*").order("created_at"),
    supabaseClient.from("supervisor_teams").select("email, team_name"),
  ]);

  if (usersError) {
    tbody.innerHTML = `<tr><td colspan="5">Error cargando usuarios: ${escapeHtml(usersError.message)}</td></tr>`;
    return;
  }

  const teamsByEmail = {};
  (teamRows || []).forEach(r => {
    (teamsByEmail[r.email] = teamsByEmail[r.email] || []).push(r.team_name);
  });

  tbody.innerHTML = (users || []).map(u => `
    <tr>
      <td>${escapeHtml(u.full_name)}</td>
      <td>${escapeHtml(u.email)}</td>
      <td><span class="role-badge ${u.role}">${u.role === "admin" ? "Admin" : "Supervisor"}</span></td>
      <td>${(teamsByEmail[u.email] || []).map(escapeHtml).join(", ") || "—"}</td>
      <td><button class="btn-toggle-hidden" onclick="deleteAccessUser('${escapeHtml(u.email).replace(/'/g, "\\'")}')"><i data-lucide="trash-2"></i></button></td>
    </tr>
  `).join("") || `<tr><td colspan="5">Sin usuarios registrados.</td></tr>`;
  if (window.lucide) lucide.createIcons();
}

async function handleAddAccessUser(e) {
  e.preventDefault();
  const errorEl = document.getElementById("access-error");
  errorEl.classList.add("hidden");

  const fullName = document.getElementById("access-name").value.trim();
  const email = document.getElementById("access-email").value.trim().toLowerCase();
  const role = document.getElementById("access-role").value;
  const teamOptions = [...document.getElementById("access-teams").selectedOptions].map(o => o.value);

  if (!/^[a-z0-9._%+-]+@uassistme\.com$/.test(email)) {
    errorEl.textContent = "El correo debe ser @uassistme.com";
    errorEl.classList.remove("hidden");
    return;
  }
  if (role === "supervisor" && teamOptions.length === 0) {
    errorEl.textContent = "Selecciona al menos un equipo para el supervisor.";
    errorEl.classList.remove("hidden");
    return;
  }

  const { error: insertError } = await supabaseClient.from("app_users").upsert({
    email, full_name: fullName, role, created_by: currentUser.email,
  }, { onConflict: "email" });

  if (insertError) {
    errorEl.textContent = insertError.message;
    errorEl.classList.remove("hidden");
    return;
  }

  await supabaseClient.from("supervisor_teams").delete().eq("email", email);
  if (role === "supervisor" && teamOptions.length > 0) {
    const { error: teamsError } = await supabaseClient.from("supervisor_teams")
      .insert(teamOptions.map(team_name => ({ email, team_name })));
    if (teamsError) {
      errorEl.textContent = teamsError.message;
      errorEl.classList.remove("hidden");
      return;
    }
  }

  document.getElementById("access-form").reset();
  document.getElementById("access-teams-group").classList.add("hidden");
  await renderAccessUsersList();
}

async function deleteAccessUser(email) {
  if (email === currentUser.email) {
    alert("No puedes eliminar tu propia cuenta de administrador.");
    return;
  }
  if (!confirm(`¿Quitar acceso a ${email}?`)) return;
  const { error } = await supabaseClient.from("app_users").delete().eq("email", email);
  if (error) {
    alert("Error eliminando usuario: " + error.message);
    return;
  }
  await renderAccessUsersList();
}

function switchTab(tabId) {
  document.querySelectorAll(".nav-btn").forEach(btn => {
    btn.classList.toggle("active", btn.getAttribute("data-tab") === tabId);
  });

  document.querySelectorAll(".tab-content").forEach(content => {
    content.classList.toggle("hidden", content.id !== `tab-${tabId}`);
  });

  if (tabId === "feedback") ensureSentimentAnalyzed();
  if (tabId === "access" && currentUser && currentUser.role === "admin") loadAccessTab();

  // Re-renderizar gráficos visibles para corregir tamaños de Canvas
  setTimeout(() => renderCharts(), 50);
}

function renderAll() {
  renderKPIs();
  renderCharts();
  renderInsights();
  renderDeptRanking();
  renderVOC();
  renderAdminPanel();
}

// Animación simple de conteo para los valores numéricos de las tarjetas KPI.
// Puramente presentacional: el valor final siempre es el mismo que calcula
// renderKPIs, esto solo suaviza la transición al cambiar de filtro.
function animateNumber(el, target, formatFn) {
  if (!el) return;
  const start = Number(el.dataset.rawValue);
  if (!Number.isFinite(start) || !Number.isFinite(target)) {
    el.innerText = formatFn(target);
    el.dataset.rawValue = String(target);
    return;
  }
  const duration = 500;
  const t0 = performance.now();
  function tick(now) {
    const progress = Math.min(1, (now - t0) / duration);
    const eased = 1 - Math.pow(1 - progress, 3);
    const current = start + (target - start) * eased;
    el.innerText = formatFn(current);
    if (progress < 1) {
      requestAnimationFrame(tick);
    } else {
      el.dataset.rawValue = String(target);
    }
  }
  requestAnimationFrame(tick);
}

// ---------------------------------------------------------------------------
// MAPEO DE PREGUNTAS Y ESCALA LIKERT
//
// app.py limpia los encabezados originales de Google Forms y trunca los que
// superan 60 caracteres agregando un hash (ver limpiar_nombre_columna), así
// que muchos nombres de columna no dejan claro a qué departamento pertenece
// la pregunta. El mapeo de abajo se reconstruyó a mano siguiendo el orden de
// las preguntas tal como aparecen en cada encuesta (2025 y 2026 tienen
// estructuras de columnas distintas). Si el formulario cambia, este mapeo
// hay que revisarlo.
// ---------------------------------------------------------------------------

const LIKERT_SCORES = {
  "very satisfied": 5,
  "satisfied": 4,
  "neutral": 3,
  "dissatisfied": 2,
  "very dissatisfied": 1,
  "strongly dissatisfied": 1,
};

function likertScore(value) {
  if (typeof value !== "string") return null;
  const score = LIKERT_SCORES[value.trim().toLowerCase()];
  return score === undefined ? null : score;
}

const DEPT_LABELS = {
  IT: "IT",
  Facilities: "Facilities",
  Finance: "Finance",
  Procurement: "Procurement",
  TA: "Talent Acq.",
  PX: "PX (DX)",
  LD: "L&D",
  HRBP: "HRBP",
};
const DEPT_ORDER = ["IT", "Facilities", "Finance", "Procurement", "TA", "PX", "LD", "HRBP"];

// Columnas de la tabla consolidada (Survey2026_Consoldado). Desde la
// migración, 2025 y 2026 comparten el MISMO esquema de columnas (basado en
// el formulario 2026); cada fila solo trae valores en las columnas de su
// año, así que una sola lista sirve para ambos (deptScores() ignora las
// columnas ausentes/null en el año que no aplica).
const DEPT_COLUMNS = {
  TA: [
    "how_satisfied_are_you_with_the_recruitment_process__clea_0d0974", "how_satisfied_are_you_with_the_recruitment_process__step_061872", "how_satisfied_are_you_with_the_recruitment_process__resp_fb42b6", "how_satisfied_are_you_with_the_recruitment_process__cust_c027a5",
    "how_satisfied_are_you_with_the_internal_promotions_proce_7e27b6", "how_satisfied_are_you_with_the_internal_promotions_proce_dc4add", "how_satisfied_are_you_with_the_internal_promotions_proce_9eb6ed", "how_satisfied_are_you_with_the_internal_promotions_proce_7a5d35",
    "how_satisfied_are_you_with_our_astronomers_program_refer_1a862a", "how_satisfied_are_you_with_our_astronomers_program_refer_4721eb", "how_satisfied_are_you_with_our_astronomers_program_refer_b424dc", "how_satisfied_are_you_with_our_astronomers_program_refer_4883c3",
  ],
  IT: [
    "please_share_your_feedback_on_the_new_equipment_you_rece_f95515", "please_share_your_feedback_on_the_new_equipment_you_rece_8571b1", "please_share_your_feedback_on_the_new_equipment_you_rece_5a4bee", "please_share_your_feedback_on_the_new_equipment_you_rece_9247ef",
    "please_assess_the_work_equipment_provided_by_uam__equipm_15bbc8", "please_assess_the_work_equipment_provided_by_uam__tech_s_d21de7", "please_assess_the_work_equipment_provided_by_uam__respon_0c84b1", "please_assess_the_work_equipment_provided_by_uam__custom_2c759d",
    "please_assess_the_systems_and_tools_provided_by_uam__eff_dfc57f", "please_assess_the_systems_and_tools_provided_by_uam__tec_7f0df2", "please_assess_the_systems_and_tools_provided_by_uam__res_438738", "please_assess_the_systems_and_tools_provided_by_uam__cus_50df89", "please_assess_the_systems_and_tools_provided_by_uam__int_8fe56c",
  ],
  PX: [
    "please_evaluate_your_experience_during_your_new_hire_hr__b8cd22", "please_evaluate_your_experience_during_your_new_hire_hr__2c26b0", "please_evaluate_your_experience_during_your_new_hire_hr__9aaf85", "please_evaluate_your_experience_during_your_new_hire_hr__00de32",
    "how_satisfied_are_you_with_the_wellness_activities_we_of_6ad9ee", "how_satisfied_are_you_with_the_wellness_activities_we_of_e650eb", "how_satisfied_are_you_with_the_wellness_activities_we_of_ac32ef", "how_satisfied_are_you_with_the_wellness_activities_we_of_628519",
    "how_satisfied_are_you_with_the_engagement_activities_we__426f5e", "how_satisfied_are_you_with_the_engagement_activities_we__18b058", "how_satisfied_are_you_with_the_engagement_activities_we__bc13ce", "how_satisfied_are_you_with_the_engagement_activities_we__455b8d",
    "how_satisfied_are_you_with_our_recognition_initiatives___6e4565", "how_satisfied_are_you_with_our_recognition_initiatives___b47d6f", "how_satisfied_are_you_with_our_recognition_initiatives___925a26",
    "please_rate_your_experience_if_you_have_used_any_of_our__f7767e", "please_rate_your_experience_if_you_have_used_any_of_our__dda261", "please_rate_your_experience_if_you_have_used_any_of_our__190b3c", "please_rate_your_experience_if_you_have_used_any_of_our__4525b7", "please_rate_your_experience_if_you_have_used_any_of_our__356ce0",
  ],
  LD: [
    "please_provide_feedback_regarding_your_new_hire_training_0d8ea0", "please_provide_feedback_regarding_your_new_hire_training_0d5024", "please_provide_feedback_regarding_your_new_hire_training_94dbc1", "please_provide_feedback_regarding_your_new_hire_training_7db768", "please_provide_feedback_regarding_your_new_hire_training_552b56",
    "please_provide_feedback_if_you_have_been_a_part_of_any_i_aea551", "please_provide_feedback_if_you_have_been_a_part_of_any_i_67b680", "please_provide_feedback_if_you_have_been_a_part_of_any_i_c91185", "please_provide_feedback_if_you_have_been_a_part_of_any_i_2667b0",
    "please_provide_feedback_if_you_have_been_a_part_of_any_i_9af122", "please_provide_feedback_if_you_have_been_a_part_of_any_i_a70b01", "please_provide_feedback_if_you_have_been_a_part_of_any_i_c3f0d8", "please_provide_feedback_if_you_have_been_a_part_of_any_i_13bc11",
  ],
  // Incluye "beanbags".."cleanliness_2" (lounge 2025) y los dos sabores del
  // 5º ítem de parqueo (2025 lo llamó "Customer Service", 2026 "Chat
  // Efficiency"): ninguno tenía columna en la tabla consolidada tras la
  // migración; se agregaron y se recuperaron desde uam_services_survey.
  Facilities: [
    "please_assess_colabora_s_parking_lot__security", "please_assess_colabora_s_parking_lot__quality", "please_assess_colabora_s_parking_lot__quantity", "please_assess_colabora_s_parking_lot__logistics",
    "please_assess_colabora_s_parking_lot__customer_service", "please_assess_colabora_s_parking_lot__chat_efficiency",
    "please_assess_your_working_space__desk", "please_assess_your_working_space__chairs", "please_assess_your_working_space__ac", "please_assess_your_working_space__power_outlets", "please_assess_your_working_space__cleanliness",
    "please_assess_our_restrooms__cleanliness", "please_assess_our_restrooms__quality_toilet_paper", "please_assess_our_restrooms__quality_soap", "please_assess_our_restrooms__quality_paper_towel", "please_assess_our_restrooms__trashcans", "please_assess_our_restrooms__resources_availability",
    "please_assess_our_kitchenette__chairs_table_quality", "please_assess_our_kitchenette__chairs_table_quantity", "please_assess_our_kitchenette__airflow", "please_assess_our_kitchenette__microwaves_and_oven_quality", "please_assess_our_kitchenette__microwaves_and_oven_quantity", "please_assess_our_kitchenette__fridge", "please_assess_our_kitchenette__water_dispenser", "please_assess_our_kitchenette__coffee_machines", "please_assess_our_kitchenette__cleanliness", "please_assess_our_kitchenette__utensils_cupboards",
    "please_assess_our_meeting_rooms__chairs", "please_assess_our_meeting_rooms__table_desks", "please_assess_our_meeting_rooms__ac", "please_assess_our_meeting_rooms__whiteboards_markers", "please_assess_our_meeting_rooms__lighting", "please_assess_our_meeting_rooms__tvs_screen", "please_assess_our_meeting_rooms__audio",
    "please_asses_the_locker_you_have_been_assigned__location", "please_asses_the_locker_you_have_been_assigned__quality", "please_asses_the_locker_you_have_been_assigned__size", "please_asses_the_locker_you_have_been_assigned__assignat_48bf41",
    "beanbags", "counter_stools", "ac_3", "entertainment_tv_books_jenga_board_games", "power_outlets_2", "cleanliness_2",
  ],
  Finance: [
    "how_would_you_evaluate_the_process_followed_by_finance___9fb763", "how_would_you_evaluate_the_process_followed_by_finance___443c99", "how_would_you_evaluate_the_process_followed_by_finance___149654", "how_would_you_evaluate_the_process_followed_by_finance___ce1bad", "how_would_you_evaluate_the_process_followed_by_finance___24f3a7",
  ],
  Procurement: [
    "please_assess_the_service_provided_by_procurement__more__6be7bf", "please_assess_the_service_provided_by_procurement__quali_2b56f6", "please_assess_the_service_provided_by_procurement__respo_714570", "please_assess_the_service_provided_by_procurement__custo_2629e3",
  ],
  HRBP: [
    "please_rate_your_experience_with_hrbp_regarding_certific_9b10e8", "please_rate_your_experience_with_hrbp_regarding_certific_7dbeb3", "please_rate_your_experience_with_hrbp_regarding_certific_8fb31a", "please_rate_your_experience_with_hrbp_regarding_certific_67e80e",
    "please_rate_your_experience_with_hrbp_on_special_permits_e41a71", "please_rate_your_experience_with_hrbp_on_special_permits_eba464", "please_rate_your_experience_with_hrbp_on_special_permits_f9d4d1", "please_rate_your_experience_with_hrbp_on_special_permits_a905f1",
    "how_would_you_rate_your_experience_with_hrbp_regarding_r_2ef8b0", "how_would_you_rate_your_experience_with_hrbp_regarding_r_7f568a", "how_would_you_rate_your_experience_with_hrbp_regarding_r_70790c", "how_would_you_rate_your_experience_with_hrbp_regarding_r_b6198a",
  ],
};

function scoresForColumns(dataset, columns) {
  const scores = [];
  dataset.forEach(row => {
    columns.forEach(col => {
      const s = likertScore(row[col]);
      if (s !== null) scores.push(s);
    });
  });
  return scores;
}

function average(arr) {
  if (!arr.length) return null;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function deptScores(year, dept, dataset) {
  const cols = DEPT_COLUMNS[dept] || [];
  return scoresForColumns(dataset, cols);
}

function allScores(year, dataset) {
  const cols = Object.values(DEPT_COLUMNS).flat();
  return scoresForColumns(dataset, cols);
}

// Filtro de año (2025 / 2026 / ambos), combinado con el filtro de departamento existente
const DATASET_BY_YEAR = { 2025: () => rawData2025, 2026: () => rawData2026 };

function activeYears() {
  return selectedYear === 'ALL' ? [2025, 2026] : [Number(selectedYear)];
}

function yearScores(year) {
  const dataset = DATASET_BY_YEAR[year]();
  return selectedDept === 'ALL' ? allScores(year, dataset) : deptScores(year, selectedDept, dataset);
}

// CÁLCULO DE KPIS BI (a partir de datos reales de Supabase, respetando los filtros de Año y Depto)
function renderKPIs() {
  const years = activeYears();
  const n2025 = rawData2025.length;
  const n2026 = rawData2026.length;
  const totalSample = years.reduce((sum, y) => sum + DATASET_BY_YEAR[y]().length, 0);

  animateNumber(document.getElementById("kpi-total-sample"), totalSample, v => Math.round(v).toLocaleString());
  document.getElementById("kpi-sample-diff").innerText = selectedYear === 'ALL'
    ? `${n2025} en 2025 · ${n2026} en 2026`
    : `${totalSample} registros en base ${selectedYear}`;

  const scores2025 = yearScores(2025);
  const scores2026 = yearScores(2026);
  const activeScores = years.map(y => (y === 2025 ? scores2025 : scores2026)).flat();
  const csatActive = average(activeScores);

  const csatGlobalEl = document.getElementById("kpi-csat-global");
  if (csatActive !== null) {
    animateNumber(csatGlobalEl, csatActive, v => `${v.toFixed(2)} / 5.0`);
  } else {
    csatGlobalEl.innerText = "Sin datos";
    delete csatGlobalEl.dataset.rawValue;
  }

  const yoyEl = document.getElementById("kpi-csat-yoy");
  const csat2025 = average(scores2025);
  const csat2026 = average(scores2026);
  if (selectedYear === 'ALL' && csat2025 !== null && csat2026 !== null) {
    const diff = csat2026 - csat2025;
    const icon = diff >= 0 ? "arrow-up-right" : "arrow-down-right";
    const sign = diff >= 0 ? "+" : "";
    yoyEl.innerHTML = `<i data-lucide="${icon}"></i> ${sign}${diff.toFixed(2)} pts vs 2025`;
  } else if (selectedYear !== 'ALL') {
    yoyEl.innerText = `Mostrando solo ${selectedYear}`;
  } else {
    yoyEl.innerText = "Sin datos comparables";
  }

  // No existe una pregunta de "probabilidad de recomendar" (0-10) en la
  // encuesta, así que no se puede calcular un NPS real. En su lugar se
  // muestra un índice de satisfacción neta: % respuestas satisfechas (4-5)
  // menos % respuestas insatisfechas (1-2), sobre las respuestas Likert del
  // año (o años) seleccionado.
  const npsLabelEl = document.getElementById("kpi-nps-label");
  const npsEl = document.getElementById("kpi-nps");
  if (activeScores.length) {
    const promoterPct = activeScores.filter(s => s >= 4).length / activeScores.length;
    const detractorPct = activeScores.filter(s => s <= 2).length / activeScores.length;
    const netSat = Math.round((promoterPct - detractorPct) * 100);
    animateNumber(npsEl, netSat, v => `${v >= 0 ? "+" : ""}${Math.round(v)}`);
    if (npsLabelEl) npsLabelEl.innerText = "Índice de satisfacción neta (proxy, no hay pregunta NPS 0-10)";
  } else {
    npsEl.innerText = "N/D";
    delete npsEl.dataset.rawValue;
    if (npsLabelEl) npsLabelEl.innerText = "Sin datos suficientes";
  }

  const vocCount = years.reduce((sum, y) => sum + extractComments(DATASET_BY_YEAR[y](), selectedDept, y).length, 0);
  animateNumber(document.getElementById("kpi-voc-count"), vocCount, v => `${Math.round(v)}`);

  if (window.lucide) lucide.createIcons();
}

// RENDERIZADO DE GRÁFICOS
function renderCharts() {
  renderDeptPerformance();
  renderDistribution();
  renderYoYVariance();
  renderRadar();
  renderPareto();
}

function destroyChart(id) {
  if (charts[id]) {
    charts[id].destroy();
  }
}

// 1. Bar Chart: Performance por Depto (promedio real de respuestas Likert 1-5)
const YEAR_STYLE = {
  2025: { label: 'CSAT 2025', color: '#94a3b8' },
  2026: { label: 'CSAT 2026', color: '#2563eb' },
};

function deptAveragesForYear(year) {
  const dataset = DATASET_BY_YEAR[year]();
  return DEPT_ORDER.map(d => {
    const avg = average(deptScores(year, d, dataset));
    return avg !== null ? Number(avg.toFixed(2)) : null;
  });
}

function renderDeptPerformance() {
  destroyChart('deptPerf');
  const ctx = document.getElementById("deptPerformanceChart");
  if (!ctx) return;

  const labels = DEPT_ORDER.map(d => DEPT_LABELS[d]);
  const datasets = activeYears().map(year => ({
    label: YEAR_STYLE[year].label,
    data: deptAveragesForYear(year),
    backgroundColor: YEAR_STYLE[year].color,
    borderRadius: 4,
  }));

  charts['deptPerf'] = new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: { y: { min: 1, max: 5 } }
    }
  });
}

// 2. Doughnut Chart: Distribución real de respuestas (top-box / neutral / bottom-box)
function renderDistribution() {
  destroyChart('dist');
  const ctx = document.getElementById("distributionChart");
  if (!ctx) return;

  const scores = activeYears().map(y => yearScores(y)).flat();

  const satisfied = scores.filter(s => s >= 4).length;
  const neutral = scores.filter(s => s === 3).length;
  const insatisfied = scores.filter(s => s <= 2).length;

  charts['dist'] = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['Satisfechos (4-5)', 'Neutrales (3)', 'Insatisfechos (1-2)'],
      datasets: [{
        data: [satisfied, neutral, insatisfied],
        backgroundColor: ['#10b981', '#f59e0b', '#ef4444']
      }]
    },
    options: { responsive: true, maintainAspectRatio: false }
  });
}

// 3. Line Chart: Variación interanual real por departamento (requiere ambos años)
function renderYoYVariance() {
  destroyChart('yoyVar');
  const ctx = document.getElementById("yoyVarianceChart");
  const emptyMsg = document.getElementById("yoyVarianceEmpty");
  if (!ctx) return;

  if (selectedYear !== 'ALL') {
    ctx.classList.add("hidden");
    if (emptyMsg) emptyMsg.classList.remove("hidden");
    return;
  }
  ctx.classList.remove("hidden");
  if (emptyMsg) emptyMsg.classList.add("hidden");

  const labels = DEPT_ORDER.map(d => DEPT_LABELS[d]);
  const data = DEPT_ORDER.map(d => {
    const a2025 = average(deptScores(2025, d, rawData2025));
    const a2026 = average(deptScores(2026, d, rawData2026));
    if (a2025 === null || a2026 === null || a2025 === 0) return null;
    return Number((((a2026 - a2025) / a2025) * 100).toFixed(1));
  });

  charts['yoyVar'] = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        label: '% Variación CSAT YoY',
        data: data,
        borderColor: '#10b981',
        backgroundColor: 'rgba(16, 185, 129, 0.1)',
        fill: true,
        tension: 0.3,
        pointRadius: 6
      }]
    },
    options: { responsive: true, maintainAspectRatio: false }
  });
}

// 4. Radar Chart: Competencias transversales de servicio (promedio real por
// familia de preguntas, dentro del departamento seleccionado o de todos)
// Columnas por competencia, precalculadas a partir del texto original de la
// pregunta (no del nombre de columna hasheado, que tras la migración ya no
// conserva palabras clave legibles como "clear_communication").
const COMPETENCY_COLUMNS = {
  "Tiempo de Respuesta": ["how_satisfied_are_you_with_the_recruitment_process__resp_fb42b6", "please_share_your_feedback_on_the_new_equipment_you_rece_5a4bee", "please_assess_the_service_provided_by_procurement__respo_714570", "how_satisfied_are_you_with_the_internal_promotions_proce_9eb6ed", "how_satisfied_are_you_with_our_astronomers_program_refer_b424dc", "please_assess_the_work_equipment_provided_by_uam__respon_0c84b1", "please_assess_the_systems_and_tools_provided_by_uam__res_438738"],
  "Efectividad de Solución": ["please_share_your_feedback_on_the_new_equipment_you_rece_f95515", "please_assess_the_systems_and_tools_provided_by_uam__eff_dfc57f"],
  "Atención al Cliente": ["how_satisfied_are_you_with_the_recruitment_process__cust_c027a5", "please_share_your_feedback_on_the_new_equipment_you_rece_9247ef", "please_evaluate_your_experience_during_your_new_hire_hr__00de32", "please_provide_feedback_regarding_your_new_hire_training_552b56", "please_assess_the_service_provided_by_procurement__custo_2629e3", "how_satisfied_are_you_with_the_internal_promotions_proce_7a5d35", "how_satisfied_are_you_with_our_astronomers_program_refer_4883c3", "please_assess_the_work_equipment_provided_by_uam__custom_2c759d", "please_assess_the_systems_and_tools_provided_by_uam__cus_50df89", "how_satisfied_are_you_with_the_wellness_activities_we_of_628519", "how_satisfied_are_you_with_the_engagement_activities_we__455b8d", "how_satisfied_are_you_with_our_recognition_initiatives___925a26", "please_rate_your_experience_if_you_have_used_any_of_our__4525b7", "please_provide_feedback_if_you_have_been_a_part_of_any_i_2667b0", "please_provide_feedback_if_you_have_been_a_part_of_any_i_13bc11", "please_rate_your_experience_with_hrbp_regarding_certific_9b10e8", "please_rate_your_experience_with_hrbp_on_special_permits_e41a71", "how_would_you_rate_your_experience_with_hrbp_regarding_r_2ef8b0"],
  "Comunicación Clara": ["how_satisfied_are_you_with_the_recruitment_process__clea_0d0974", "please_evaluate_your_experience_during_your_new_hire_hr__2c26b0", "how_satisfied_are_you_with_the_internal_promotions_proce_7e27b6", "how_satisfied_are_you_with_our_astronomers_program_refer_1a862a", "how_satisfied_are_you_with_the_wellness_activities_we_of_6ad9ee", "how_satisfied_are_you_with_the_engagement_activities_we__426f5e", "how_satisfied_are_you_with_our_recognition_initiatives___6e4565", "please_provide_feedback_if_you_have_been_a_part_of_any_i_aea551", "please_provide_feedback_if_you_have_been_a_part_of_any_i_9af122", "please_rate_your_experience_with_hrbp_regarding_certific_7dbeb3", "please_rate_your_experience_with_hrbp_on_special_permits_eba464", "how_would_you_rate_your_experience_with_hrbp_regarding_r_7f568a"],
  "Facilidad del Proceso": ["how_satisfied_are_you_with_the_recruitment_process__step_061872", "how_satisfied_are_you_with_the_internal_promotions_proce_dc4add", "how_satisfied_are_you_with_our_astronomers_program_refer_4721eb", "please_rate_your_experience_if_you_have_used_any_of_our__190b3c", "please_provide_feedback_if_you_have_been_a_part_of_any_i_c91185", "please_rate_your_experience_with_hrbp_regarding_certific_8fb31a", "please_rate_your_experience_with_hrbp_on_special_permits_f9d4d1", "how_would_you_rate_your_experience_with_hrbp_regarding_r_70790c"],
};
const COMPETENCIES = Object.keys(COMPETENCY_COLUMNS).map(label => ({ label }));

function competencyScores(year, dataset) {
  const deptCols = selectedDept === 'ALL'
    ? Object.values(DEPT_COLUMNS).flat()
    : (DEPT_COLUMNS[selectedDept] || []);
  const deptColSet = new Set(deptCols);

  return Object.entries(COMPETENCY_COLUMNS).map(([, compCols]) => {
    const matching = compCols.filter(c => deptColSet.has(c));
    const avg = average(scoresForColumns(dataset, matching));
    return avg !== null ? Number(avg.toFixed(2)) : null;
  });
}

const RADAR_YEAR_STYLE = {
  2025: { label: '2025', borderColor: '#94a3b8', backgroundColor: 'rgba(148, 163, 184, 0.2)' },
  2026: { label: '2026', borderColor: '#8b5cf6', backgroundColor: 'rgba(139, 92, 246, 0.2)' },
};

function renderRadar() {
  destroyChart('radar');
  const ctx = document.getElementById("radarChart");
  if (!ctx) return;

  const datasets = activeYears().map(year => ({
    ...RADAR_YEAR_STYLE[year],
    data: competencyScores(year, DATASET_BY_YEAR[year]()),
  }));

  charts['radar'] = new Chart(ctx, {
    type: 'radar',
    data: { labels: COMPETENCIES.map(c => c.label), datasets },
    options: { responsive: true, maintainAspectRatio: false, scales: { r: { min: 0, max: 5 } } }
  });
}

// 5. Pareto Chart: Temas de fricción reales, extraídos de los comentarios
// clasificados como "Punto Crítico" (stop) mediante coincidencia de palabras clave
const FRICTION_THEMES = [
  { label: "Demora en Respuestas", match: t => /demora|tardan|lento|slow|delay|espera|wait/.test(t) },
  { label: "Falta de Seguimiento", match: t => /seguimiento|follow[ -]?up|sin respuesta|no responden/.test(t) },
  { label: "Procesos Manuales", match: t => /manual|papeleo|tr[aá]mite|burocracia|paperwork/.test(t) },
  { label: "Falta de Capacidad", match: t => /personal|staff|capacidad|understaffed|overwhelmed|sobrecarg/.test(t) },
  { label: "Infraestructura", match: t => /internet|wifi|equipo|equipment|aire acondicionado|\bac\b|infraestructura|infrastructure/.test(t) },
];

function classifyFriction(comments) {
  const counts = FRICTION_THEMES.map(() => 0);
  let other = 0;
  comments.forEach(text => {
    const lower = text.toLowerCase();
    const idx = FRICTION_THEMES.findIndex(theme => theme.match(lower));
    if (idx >= 0) counts[idx]++; else other++;
  });
  return { counts, other };
}

function renderPareto() {
  destroyChart('pareto');
  const ctx = document.getElementById("paretoChart");
  if (!ctx) return;

  const stopComments = activeYears()
    .flatMap(y => extractVisibleComments(DATASET_BY_YEAR[y](), selectedDept, y))
    .filter(c => classifyComment(c.text).category === "stop")
    .map(c => c.text);

  const { counts, other } = classifyFriction(stopComments);
  const labels = FRICTION_THEMES.map(t => t.label);
  const freq = counts;
  if (other > 0) {
    labels.push("Otros");
    freq.push(other);
  }

  const combined = labels
    .map((l, i) => ({ l, f: freq[i] }))
    .sort((a, b) => b.f - a.f);
  const total = combined.reduce((s, c) => s + c.f, 0) || 1;
  let cum = 0;
  const cumPct = combined.map(c => {
    cum += c.f;
    return Number(((cum / total) * 100).toFixed(1));
  });

  charts['pareto'] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: combined.map(c => c.l),
      datasets: [
        {
          type: 'bar',
          label: 'Frecuencia de Quejas',
          data: combined.map(c => c.f),
          backgroundColor: '#ef4444'
        },
        {
          type: 'line',
          label: '% Acumulado',
          data: cumPct,
          borderColor: '#f59e0b',
          yAxisID: 'percentage'
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: { position: 'left' },
        percentage: { position: 'right', max: 100, grid: { drawOnChartArea: false } }
      }
    }
  });
}

// PANEL DE INSIGHTS AUTOMÁTICOS (Overview) — se recalcula con los mismos
// filtros de Año/Depto que el resto del reporte, no agrega filtros nuevos.
function renderInsights() {
  const container = document.getElementById("insights-grid");
  if (!container) return;

  const years = activeYears();
  const deptAvg = (dept) => average(years.flatMap(y => deptScores(y, dept, DATASET_BY_YEAR[y]())));
  const ranked = DEPT_ORDER
    .map(d => ({ dept: d, label: DEPT_LABELS[d], avg: deptAvg(d) }))
    .filter(r => r.avg !== null)
    .sort((a, b) => b.avg - a.avg);

  const cards = [];

  if (ranked.length) {
    const best = ranked[0];
    cards.push({
      icon: "trophy", tone: "pos", label: "Mejor Desempeño",
      value: best.label, detail: `CSAT ${best.avg.toFixed(2)} / 5.0`,
    });
    const worst = ranked[ranked.length - 1];
    cards.push({
      icon: "alert-triangle", tone: worst.avg < 3.5 ? "neg" : "neutral", label: "Requiere Atención",
      value: worst.label, detail: `CSAT ${worst.avg.toFixed(2)} / 5.0`,
    });
  }

  if (selectedYear === 'ALL') {
    const movers = DEPT_ORDER.map(d => {
      const a2025 = average(deptScores(2025, d, rawData2025));
      const a2026 = average(deptScores(2026, d, rawData2026));
      if (a2025 === null || a2026 === null || a2025 === 0) return null;
      return { dept: d, label: DEPT_LABELS[d], deltaPct: ((a2026 - a2025) / a2025) * 100 };
    }).filter(Boolean);
    if (movers.length) {
      const biggest = movers.reduce((a, b) => (Math.abs(b.deltaPct) > Math.abs(a.deltaPct) ? b : a));
      const sign = biggest.deltaPct >= 0 ? "+" : "";
      cards.push({
        icon: "rocket", tone: biggest.deltaPct >= 0 ? "pos" : "neg", label: "Mayor Movimiento YoY",
        value: biggest.label, detail: `${sign}${biggest.deltaPct.toFixed(1)}% vs 2025`,
      });
    }
  } else {
    cards.push({
      icon: "calendar", tone: "info", label: "Mayor Movimiento YoY",
      value: "No disponible", detail: `Selecciona "2025 vs 2026" para comparar`,
    });
  }

  const stopComments = years.flatMap(y => extractVisibleComments(DATASET_BY_YEAR[y](), selectedDept, y))
    .filter(c => classifyComment(c.text).category === "stop")
    .map(c => c.text);
  const { counts } = classifyFriction(stopComments);
  const maxCount = Math.max(...counts, 0);
  if (maxCount > 0) {
    const idx = counts.indexOf(maxCount);
    cards.push({
      icon: "flame", tone: "neutral", label: "Principal Tema de Fricción",
      value: FRICTION_THEMES[idx].label, detail: `${maxCount} comentario${maxCount === 1 ? "" : "s"} relacionado${maxCount === 1 ? "" : "s"}`,
    });
  }

  container.innerHTML = cards.map(c => `
    <div class="insight-card">
      <span class="insight-icon ${c.tone}"><i data-lucide="${c.icon}"></i></span>
      <div>
        <div class="insight-label">${c.label}</div>
        <div class="insight-value">${escapeHtml(c.value)}</div>
        <div class="insight-detail">${escapeHtml(c.detail)}</div>
      </div>
    </div>
  `).join("");

  if (window.lucide) lucide.createIcons();
}

// TABLA DE RANKING DE DEPARTAMENTOS (Overview) — mismo cálculo que el
// gráfico de barras, solo que en formato tabla con variación YoY.
function renderDeptRanking() {
  const container = document.getElementById("dept-ranking-table");
  const tagEl = document.getElementById("dept-ranking-tag");
  if (!container) return;

  const years = activeYears();
  const rows = DEPT_ORDER.map(d => {
    const avg2025 = average(deptScores(2025, d, rawData2025));
    const avg2026 = average(deptScores(2026, d, rawData2026));
    const activeAvg = average(years.flatMap(y => deptScores(y, d, DATASET_BY_YEAR[y]())));
    let deltaPct = null;
    if (avg2025 !== null && avg2026 !== null && avg2025 !== 0) {
      deltaPct = ((avg2026 - avg2025) / avg2025) * 100;
    }
    return { dept: d, label: DEPT_LABELS[d], avg2025, avg2026, activeAvg, deltaPct };
  }).filter(r => r.activeAvg !== null)
    .sort((a, b) => b.activeAvg - a.activeAvg);

  if (tagEl) tagEl.innerText = selectedYear === 'ALL' ? "Ordenado por CSAT (2025-2026)" : `Ordenado por CSAT ${selectedYear}`;

  if (!rows.length) {
    container.innerHTML = `<p class="chart-empty-msg" style="position:static;"><i data-lucide="inbox"></i> Sin datos suficientes para este filtro.</p>`;
    if (window.lucide) lucide.createIcons();
    return;
  }

  const showBothYears = selectedYear === 'ALL';

  const head = showBothYears
    ? `<tr><th>#</th><th>Departamento</th><th>CSAT 2025</th><th>CSAT 2026</th><th>Δ YoY</th><th>Nivel</th></tr>`
    : `<tr><th>#</th><th>Departamento</th><th>CSAT ${selectedYear}</th><th>Nivel</th></tr>`;

  const body = rows.map((r, i) => {
    const barPct = Math.max(0, Math.min(100, (r.activeAvg / 5) * 100));
    const rankBadge = `<span class="rank-badge ${i === 0 ? "top1" : ""}">${i + 1}</span>`;
    const barCell = `<td class="rank-bar-cell"><div class="rank-bar-track"><div class="rank-bar-fill" style="--target:${barPct}%"></div></div></td>`;

    if (showBothYears) {
      let deltaCell = `<span class="rank-delta flat">—</span>`;
      if (r.deltaPct !== null) {
        const cls = r.deltaPct > 0.05 ? "up" : r.deltaPct < -0.05 ? "down" : "flat";
        const icon = cls === "up" ? "arrow-up-right" : cls === "down" ? "arrow-down-right" : "minus";
        const sign = r.deltaPct >= 0 ? "+" : "";
        deltaCell = `<span class="rank-delta ${cls}"><i data-lucide="${icon}"></i>${sign}${r.deltaPct.toFixed(1)}%</span>`;
      }
      return `<tr>
        <td>${rankBadge}</td>
        <td class="rank-dept">${r.label}</td>
        <td class="rank-score">${r.avg2025 !== null ? r.avg2025.toFixed(2) : "—"}</td>
        <td class="rank-score">${r.avg2026 !== null ? r.avg2026.toFixed(2) : "—"}</td>
        <td>${deltaCell}</td>
        ${barCell}
      </tr>`;
    }

    return `<tr>
      <td>${rankBadge}</td>
      <td class="rank-dept">${r.label}</td>
      <td class="rank-score">${r.activeAvg.toFixed(2)}</td>
      ${barCell}
    </tr>`;
  }).join("");

  container.innerHTML = `<table class="ranking-table"><thead>${head}</thead><tbody>${body}</tbody></table>`;
  if (window.lucide) lucide.createIcons();
}

// RESUMEN DE SENTIMIENTO VOC (Feedback) — distribución real Start/Stop/Continue
function renderVocSentimentSummary() {
  const container = document.getElementById("voc-sentiment-summary");
  if (!container) return;

  const all = activeYears().flatMap(y => extractVisibleComments(DATASET_BY_YEAR[y](), selectedDept, y));
  const counts = { start: 0, stop: 0, continue: 0 };
  all.forEach(c => counts[classifyComment(c.text).category]++);
  const total = all.length || 1;
  const pct = (n) => ((n / total) * 100).toFixed(1);

  container.innerHTML = `
    <div class="voc-sentiment-bar">
      <span class="seg-continue" style="width:${pct(counts.continue)}%"></span>
      <span class="seg-start" style="width:${pct(counts.start)}%"></span>
      <span class="seg-stop" style="width:${pct(counts.stop)}%"></span>
    </div>
    <div class="voc-sentiment-legend">
      <span class="legend-item"><span class="dot seg-continue"></span>Mantener Práctica · ${counts.continue} (${pct(counts.continue)}%)</span>
      <span class="legend-item"><span class="dot seg-start"></span>Idea de Mejora · ${counts.start} (${pct(counts.start)}%)</span>
      <span class="legend-item"><span class="dot seg-stop"></span>Punto Crítico · ${counts.stop} (${pct(counts.stop)}%)</span>
    </div>
  `;
}

// EXTRACCIÓN Y FILTRADO DE COMENTARIOS (VOC)
//
// Cada columna de comentario libre pertenece a un único departamento (son
// las preguntas "Please comment on ideas you think X should start, stop or
// continue doing" y, para Facilities, las variantes de "Do you have any
// other ideas for this space?"). Ambos años comparten la misma tabla y las
// mismas columnas, así que un solo mapeo sirve para los dos.
const DEPT_VOC_COLUMNS = {
  IT: ["please_comment_on_ideas_you_think_it_should_start_stop_o_0830be"],
  Facilities: [
    "do_you_have_any_other_ideas_for_this_space",
    "please_comment_on_ideas_you_think_facilities_should_star_d6bf3b",
  ],
  Finance: ["please_comment_on_ideas_you_think_finance_should_start_s_b04676"],
  Procurement: ["please_comment_on_ideas_you_think_procurement_should_sta_649b03"],
  TA: ["please_comment_on_ideas_you_think_talent_acquisition_sho_c4083d"],
  PX: ["please_comment_on_ideas_you_think_people_experience_shou_91e260"],
  LD: ["please_comment_on_ideas_you_think_learning_and_developme_bd0a42"],
  HRBP: ["please_comment_on_ideas_you_think_hrbp_should_start_stop_b9341d"],
};

function vocColumnsForDept(dept) {
  return dept === 'ALL' ? Object.values(DEPT_VOC_COLUMNS).flat() : (DEPT_VOC_COLUMNS[dept] || []);
}

// Mapa inverso columna -> departamento, para etiquetar cada comentario con
// su depto de origen incluso cuando se extraen todos los deptos a la vez.
const VOC_COLUMN_TO_DEPT = Object.fromEntries(
  Object.entries(DEPT_VOC_COLUMNS).flatMap(([dept, cols]) => cols.map(col => [col, dept]))
);

// "comment_key" estable e independiente del orden de los datos, usado para
// identificar cada comentario individual (fila + columna + año) en la
// tabla hidden_comments del Panel Administrativo.
function commentKey(year, rowId, col) {
  return `${year}:${rowId}:${col}`;
}

// Devuelve objetos {key, text, dept, col, year, rowId} en vez de strings
// planos, para poder ubicar y ocultar/restaurar un comentario puntual
// desde el Panel Administrativo.
function extractComments(dataset, dept = selectedDept, year = null) {
  if (!dataset || dataset.length === 0) return [];
  const cols = vocColumnsForDept(dept);

  let list = [];
  dataset.forEach(row => {
    cols.forEach(col => {
      const val = row[col];
      if (val && typeof val === "string" && val.trim().length > 4 && val.trim().toLowerCase() !== "no") {
        list.push({
          key: commentKey(year, row.id, col),
          text: val.trim(),
          dept: VOC_COLUMN_TO_DEPT[col] || dept,
          col,
          year,
          rowId: row.id,
        });
      }
    });
  });
  return list;
}

// FILTRO DE COMENTARIOS "RUIDOSOS" (no accionables) — solo afecta la vista
// (tarjetas, barra de sentimiento, Pareto, insights). El conteo KPI de VOC
// (kpi-voc-count) sigue usando extractComments() sin filtrar, como muestra
// bruta de respuestas recibidas. Es el equivalente en JS de
// es_comentario_accionable()/NOISY_PATTERNS en app.py.
const NOISY_COMMENT_PATTERN = /^\s*([.,\-_\s*\/#+]+|n\/?a|na|no\s+aplica|no\s+aplicable|none|null|no|nada|ninguno|ninguna|sin\s+comentarios|no\s+comment(s)?|todo\s+bien|todo\s+excelente|excelente|all\s+good|all\s+great|all\s+ok|everything\s+is?\s+(good|fine|ok|great)|so\s+far\s+so\s+good|so\s+far,?\s+i\s+have\s+generally\s+had\s+a\s+good\s+experience.*|i'?m\s+okay|i'?m\s+good|nothing|nothing\s+else|nothing\s+to\s+add|not?\s+at\s+the\s+moment|no\s+ideas(\s+to\s+give)?|no\s+ideas\s+at\s+the\s+moment|no\s+recommendations(\s+at\s+this\s+moment)?|no\s+tengo\s+(sugerencias?|comentarios?|ideas?|quejas?|observaciones?)(s)?(\s+al\s+respecto)?|no\s+(ideas?|recommendations?|suggestions?|complaints?|issues?)|i\s+have\s+no\s+(ideas?|suggestions?|complaints?|comments?)|i\s+don'?t\s+have\s+(any\s+)?(ideas?|suggestions?|complaints?|comments?)|no,\s+i\s+do\s+not|i\s+haven'?t\s+used\s+it.*|no\s+(uso|utilizo|visito).+|(haven'?t|don'?t)\s+use.+|i\s+don'?t\s+know|idk|i'?m\s+not\s+sure|neutral|enough|it'?s?\s+enough)\s*[.!?]*$/i;

// Frases de "relleno" que no aportan señal real (ej. "I'm satisfied with it",
// "Not sure", "I think is fine so far", "no further ideas"). A diferencia de
// NOISY_COMMENT_PATTERN (que exige que el comentario ENTERO sea ruido), esto
// también descarta comentarios cortos (<=8 palabras) que consisten sobre
// todo en una de estas frases. Se ignoran si el comentario tiene una
// conjunción de contraste ("but", "pero", etc.), porque eso suele indicar
// que después de la frase de relleno viene una queja real — ej. "No ideas,
// but the organization its messy" se conserva porque sí aporta señal.
const FILLER_PHRASES = [
  /\bno\s+comments?\b/i, /\bn\/a\b/i, /\bsin\s+comentarios\b/i, /\bnothing\s+to\s+add\b/i, /\bnothing\s+else\b/i,
  /\ball\s+good\b/i, /\ball\s+great\b/i, /\ball\s+ok\b/i, /\btodo\s+bien\b/i, /\btodo\s+excelente\b/i,
  /\bi'?m\s+satisfied\b/i, /\bsatisfied\s+with\s+it\b/i, /\bi'?m\s+okay\b/i, /\bi'?m\s+good\b/i, /\bi\s+am\s+good\b/i,
  /\bi\s+don'?t\s+know\b/i, /\bnot\s+sure\b/i, /\bno\s+lo\s+se\b/i, /\bno\s+se\b/i, /\bidk\b/i,
  /\bi\s+think\s+(is|it'?s)\s+fine\b/i, /\bfine\s+so\s+far\b/i, /\bso\s+far\s*,?\s+so\s+good\b/i,
  /\bno\s+ideas\b/i, /\bno\s+further\s+ideas\b/i, /\bno\s+further\s+details\b/i, /\bno\s+recommendations\b/i,
  /\bno\s+complaints\b/i, /\beverything\s+is\s+(good|fine|great)\b/i, /\bno\s+issues\b/i, /\bnothing\s+to\s+say\b/i,
  /\bno\s+tengo\s+(comentarios|sugerencias|ideas|quejas)\b/i,
];
const CONTRAST_PATTERN = /\b(but|however|except|pero|aunque|sino|although)\b/i;

function isFillerComment(clean, wordCount) {
  if (CONTRAST_PATTERN.test(clean)) return false;
  if (wordCount > 8) return false;
  return FILLER_PHRASES.some(rx => rx.test(clean));
}

function isActionableComment(text) {
  if (typeof text !== "string") return false;
  const clean = text.trim();
  if (!clean) return false;
  if (NOISY_COMMENT_PATTERN.test(clean)) return false;

  const allWords = clean.match(/\b\w+\b/g) || [];
  const words = allWords.filter(w => w.length > 1);
  if (words.length < 2 && !["orden", "airflow"].includes(clean.toLowerCase())) return false;

  if (isFillerComment(clean, allWords.length)) return false;

  return true;
}

function extractActionableComments(dataset, dept = selectedDept, year = null) {
  return extractComments(dataset, dept, year).filter(c => isActionableComment(c.text));
}

// Igual que extractActionableComments, pero además excluye los comentarios
// marcados como "no aplica" desde el Panel Administrativo. Es lo que
// alimenta la vista pública de VOC (tarjetas, barra de sentimiento, Pareto,
// insights). El panel administrativo en cambio usa extractActionableComments
// directamente, para poder ver y restaurar lo que ya está oculto.
function extractVisibleComments(dataset, dept = selectedDept, year = null) {
  return extractActionableComments(dataset, dept, year).filter(c => !hiddenCommentKeys.has(c.key));
}

// Palabras/frases distintivas (no sustrings genéricos como "no " o "mal",
// que antes disparaban falsos positivos en cualquier comentario que
// contuviera esas letras) usadas para puntuar el sentimiento de cada
// comentario. Se cuenta cuántas señales de cada lado aparecen y gana la
// categoría con más señales; en empate gana "stop" (se prefiere no ocultar
// una posible queja) y si no hay ninguna señal cae en "start" (sugerencia).
const SENTIMENT_KEYWORDS = {
  stop: [
    "stop", "problema", "problem", "issue", "queja", "complain", "malo", "mala", "peor", "worst",
    "terrible", "awful", "poor service", "pésimo", "pesimo", "lento", "lenta", "slow", "demora",
    "demoran", "tardan", "tarda", "delay", "inaceptable", "unacceptable", "frustrant", "frustrad",
    "decepcion", "decepción", "disappoint", "no funciona", "no responden", "no sirve", "grosero",
    "grosera", "rude", "falta de", "lack of", "mal servicio", "bad service", "deficient", "deficien",
  ],
  continue: [
    "excelente", "excellent", "great", "genial", "buen servicio", "buena atenc", "amazing",
    "love it", "encanta", "satisf", "happy", "content", "keep up", "well done", "buen trabajo",
    "great job", "perfect", "perfecto", "awesome", "fantastic", "fantástico", "fantastico",
    "sigan asi", "sigan así", "muy bien", "very good", "outstanding", "continue doing",
  ],
};

function countKeywordHits(lower, keywords) {
  return keywords.reduce((count, kw) => (lower.includes(kw) ? count + 1 : count), 0);
}

function classifyComment(text) {
  const lower = text.toLowerCase();
  const stopHits = countKeywordHits(lower, SENTIMENT_KEYWORDS.stop);
  const continueHits = countKeywordHits(lower, SENTIMENT_KEYWORDS.continue);

  if (stopHits > 0 && stopHits >= continueHits) {
    return { category: "stop", label: "Punto Crítico" };
  }
  if (continueHits > 0) {
    return { category: "continue", label: "Mantener Práctica" };
  }
  return { category: "start", label: "Idea de Mejora" };
}

function filterVOC(type, btnEl) {
  vocFilter = type;
  btnEl.parentElement.querySelectorAll(".filter-btn").forEach(btn => btn.classList.remove("active"));
  btnEl.classList.add("active");
  renderVOC();
}

function filterVOCSentiment(type, btnEl) {
  vocSentimentFilter = type;
  btnEl.parentElement.querySelectorAll(".filter-btn").forEach(btn => btn.classList.remove("active"));
  btnEl.classList.add("active");
  renderVOC();
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

const SENTIMENT_LABELS = {
  positive: "😊 Positivo",
  negative: "☹️ Negativo",
  neutral: "😐 Neutral",
};

function renderVOC() {
  renderVocSentimentSummary();
  renderVocAiSentimentSummary();

  const container = document.getElementById("dx-comments-grid");
  if (!container) return;
  container.innerHTML = "";

  const all = activeYears().flatMap(y => extractVisibleComments(DATASET_BY_YEAR[y](), selectedDept, y));

  let shown = 0;
  all.forEach(item => {
    const { category, label: catLabel } = classifyComment(item.text);
    const sentiment = vocSentimentMap.get(item.key);

    if (vocFilter !== 'ALL' && category !== vocFilter) return;
    if (vocSentimentFilter !== 'ALL' && sentiment !== vocSentimentFilter) return;

    const sentimentTag = sentiment
      ? `<span class="tag sentiment-${sentiment}">${SENTIMENT_LABELS[sentiment]}</span>`
      : `<span class="tag sentiment-pending">⏳ Analizando...</span>`;

    const card = document.createElement("div");
    card.className = "comment-card";
    card.style.setProperty("--i", Math.min(shown, 12));
    card.innerHTML = `
      <div class="card-top">
        <span class="tag ${category}">${catLabel}</span>
        <span class="year-badge">${item.year}</span>
      </div>
      <p class="comment-body">"${escapeHtml(item.text)}"</p>
      <div class="card-top">${sentimentTag}</div>
    `;
    container.appendChild(card);
    shown++;
  });

  if (shown === 0) {
    container.innerHTML = `<div class="voc-empty"><i data-lucide="inbox"></i>Sin comentarios para este filtro.</div>`;
  }
  if (window.lucide) lucide.createIcons();
}

// SENTIMIENTO IA (Positivo/Negativo/Neutral) — clasificado con Claude vía un
// Edge Function de Supabase (voc-sentiment), que guarda el resultado en la
// tabla voc_sentiment (comment_key -> sentiment) para no reprocesar el mismo
// comentario dos veces. Se dispara la primera vez que se abre la pestaña VOC.
function renderVocAiSentimentSummary() {
  const container = document.getElementById("voc-ai-sentiment-summary");
  if (!container) return;

  const all = activeYears().flatMap(y => extractVisibleComments(DATASET_BY_YEAR[y](), selectedDept, y));
  const counts = { positive: 0, negative: 0, neutral: 0 };
  let pending = 0;
  all.forEach(c => {
    const s = vocSentimentMap.get(c.key);
    if (s) counts[s]++; else pending++;
  });
  const total = all.length || 1;
  const pct = (n) => ((n / total) * 100).toFixed(1);

  container.innerHTML = `
    <div class="voc-sentiment-bar">
      <span class="seg-continue" style="width:${pct(counts.positive)}%"></span>
      <span class="seg-start" style="width:${pct(counts.neutral)}%"></span>
      <span class="seg-stop" style="width:${pct(counts.negative)}%"></span>
    </div>
    <div class="voc-sentiment-legend">
      <span class="legend-item"><span class="dot seg-continue"></span>Positivo · ${counts.positive} (${pct(counts.positive)}%)</span>
      <span class="legend-item"><span class="dot seg-start"></span>Neutral · ${counts.neutral} (${pct(counts.neutral)}%)</span>
      <span class="legend-item"><span class="dot seg-stop"></span>Negativo · ${counts.negative} (${pct(counts.negative)}%)</span>
    </div>
  `;

  const statusEl = document.getElementById("voc-ai-status");
  if (statusEl) {
    statusEl.textContent = pending > 0
      ? `Analizando comentarios... (${total - pending}/${total})`
      : `${total} comentarios analizados por IA.`;
  }
}

async function ensureSentimentAnalyzed() {
  if (sentimentEnsureStarted) return;
  sentimentEnsureStarted = true;

  const all = [2025, 2026].flatMap(y => extractVisibleComments(DATASET_BY_YEAR[y](), 'ALL', y));
  const pending = all.filter(c => !vocSentimentMap.has(c.key));
  if (pending.length === 0) return;

  const BATCH_SIZE = 25;
  for (let i = 0; i < pending.length; i += BATCH_SIZE) {
    const batch = pending.slice(i, i + BATCH_SIZE);
    try {
      const { data, error } = await supabaseClient.functions.invoke("voc-sentiment", {
        body: { comments: batch.map(c => ({ key: c.key, text: c.text })) },
      });
      if (error || !data || !data.results) {
        console.error("Error analizando sentimiento:", error || data);
        continue;
      }
      const rows = data.results.map(r => ({ comment_key: r.key, sentiment: r.sentiment }));
      const { error: upsertError } = await supabaseClient.from("voc_sentiment").upsert(rows, { onConflict: "comment_key" });
      if (upsertError) console.error("Error guardando sentimiento:", upsertError);
      rows.forEach(r => vocSentimentMap.set(r.comment_key, r.sentiment));
      renderVOC();
    } catch (err) {
      console.error("Error llamando voc-sentiment:", err);
    }
  }
}

// PANEL ADMINISTRATIVO — moderación manual de comentarios VOC
//
// Muestra la misma lista "accionable" que alimenta VOC (ya pasó por
// NOISY_COMMENT_PATTERN + isFillerComment), sin importar si ya está oculta,
// para poder marcar/desmarcar. Ocultar un comentario aquí lo saca de VOC
// (tarjetas, barra de sentimiento, Pareto, insights) para TODOS los que
// abran el dashboard, porque hiddenCommentKeys se guarda en Supabase
// (tabla hidden_comments), no en el navegador de quien lo marca.
async function hideComment(item) {
  hiddenCommentKeys.add(item.key);
  renderAdminPanel();
  renderVOC();
  renderCharts();
  renderInsights();

  const { error } = await supabaseClient.from(HIDDEN_COMMENTS_TABLE).insert({
    comment_key: item.key,
    year: item.year,
    dept: item.dept,
    column_name: item.col,
    comment_text: item.text,
  });
  if (error) {
    console.error("Error ocultando comentario:", error);
    hiddenCommentKeys.delete(item.key);
    renderAdminPanel();
    renderVOC();
    renderCharts();
    renderInsights();
  }
}

async function restoreComment(item) {
  hiddenCommentKeys.delete(item.key);
  renderAdminPanel();
  renderVOC();
  renderCharts();
  renderInsights();

  const { error } = await supabaseClient.from(HIDDEN_COMMENTS_TABLE).delete().eq("comment_key", item.key);
  if (error) {
    console.error("Error restaurando comentario:", error);
    hiddenCommentKeys.add(item.key);
    renderAdminPanel();
    renderVOC();
    renderCharts();
    renderInsights();
  }
}

// Los comentarios no tienen id propio expuesto en el HTML por seguridad de
// inyección; se guarda el índice dentro de la lista renderizada y se
// resuelve el objeto completo desde adminRenderedItems al hacer clic.
let adminRenderedItems = [];

function toggleHiddenComment(index) {
  const item = adminRenderedItems[index];
  if (!item) return;
  if (hiddenCommentKeys.has(item.key)) {
    restoreComment(item);
  } else {
    hideComment(item);
  }
}

function setAdminSearch(value) {
  adminSearch = value;
  renderAdminPanel();
}

function setAdminCategoryFilter(value) {
  adminCategoryFilter = value;
  renderAdminPanel();
}

function setAdminShowOnlyHidden(checked) {
  adminShowOnlyHidden = checked;
  renderAdminPanel();
}

function renderAdminPanel() {
  const container = document.getElementById("admin-comments-list");
  const countEl = document.getElementById("admin-comments-count");
  if (!container) return;

  const all = activeYears().flatMap(y => extractActionableComments(DATASET_BY_YEAR[y](), selectedDept, y));

  const search = adminSearch.trim().toLowerCase();
  const filtered = all.filter(item => {
    const { category } = classifyComment(item.text);
    if (adminCategoryFilter !== 'ALL' && category !== adminCategoryFilter) return false;
    const isHidden = hiddenCommentKeys.has(item.key);
    if (adminShowOnlyHidden && !isHidden) return false;
    if (search && !item.text.toLowerCase().includes(search)) return false;
    return true;
  });

  adminRenderedItems = filtered;

  if (countEl) {
    const hiddenTotal = all.filter(item => hiddenCommentKeys.has(item.key)).length;
    countEl.innerText = `${filtered.length} comentario${filtered.length === 1 ? "" : "s"} · ${hiddenTotal} oculto${hiddenTotal === 1 ? "" : "s"}`;
  }

  if (!filtered.length) {
    container.innerHTML = `
      <tr><td colspan="5">
        <p class="chart-empty-msg" style="position:static; padding: 40px 0;"><i data-lucide="inbox"></i> Sin comentarios para este filtro.</p>
      </td></tr>
    `;
    if (window.lucide) lucide.createIcons();
    return;
  }

  container.innerHTML = filtered.map((item, index) => {
    const { category, label: catLabel } = classifyComment(item.text);
    const isHidden = hiddenCommentKeys.has(item.key);
    return `
      <tr class="${isHidden ? "is-hidden" : ""}">
        <td><span class="tag ${category}">${catLabel}</span></td>
        <td class="admin-comment-cell">“${escapeHtml(item.text)}”</td>
        <td class="admin-dept-cell">${escapeHtml(DEPT_LABELS[item.dept] || item.dept)}</td>
        <td class="admin-year-cell">${item.year}</td>
        <td class="admin-action-cell">
          <button class="btn-toggle-hidden ${isHidden ? "restore" : "hide"}" onclick="toggleHiddenComment(${index})">
            <i data-lucide="${isHidden ? "eye" : "eye-off"}"></i> ${isHidden ? "Restaurar" : "No aplica"}
          </button>
        </td>
      </tr>
    `;
  }).join("");

  if (window.lucide) lucide.createIcons();
}
