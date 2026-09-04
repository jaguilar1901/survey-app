const SUPABASE_URL = "https://ncllovhiiofrdkudzlpj.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_WCEacN3aB3j5dDqFRRd5oQ_1UkWXnpM";
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

let rawData2025 = [];
let rawData2026 = [];

// Instancias de Gráficos
let charts = {};
let selectedDept = 'ALL';
let selectedYear = 'ALL';
let vocFilter = 'ALL';

document.addEventListener("DOMContentLoaded", () => {
  if (window.lucide) lucide.createIcons();
  initDashboard();
});

async function initDashboard() {
  try {
    const [res2025, res2026] = await Promise.all([
      supabaseClient.from("Survey_2025").select("*"),
      supabaseClient.from("Survey_2026").select("*")
    ]);

    if (res2025.error) throw res2025.error;
    if (res2026.error) throw res2026.error;

    rawData2025 = res2025.data || [];
    rawData2026 = res2026.data || [];

    const statusEl = document.getElementById("status-text");
    if (statusEl) statusEl.innerText = "Supabase DB Conectada";

    setupEventListeners();
    renderAll();
  } catch (err) {
    console.error("Error conectando a Supabase:", err);
    const statusEl = document.getElementById("status-text");
    if (statusEl) statusEl.innerText = "Error de Conexión";
  }
}

function setupEventListeners() {
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
}

function switchTab(tabId) {
  document.querySelectorAll(".nav-btn").forEach(btn => {
    btn.classList.toggle("active", btn.getAttribute("data-tab") === tabId);
  });

  document.querySelectorAll(".tab-content").forEach(content => {
    content.classList.toggle("hidden", content.id !== `tab-${tabId}`);
  });

  // Re-renderizar gráficos visibles para corregir tamaños de Canvas
  setTimeout(() => renderCharts(), 50);
}

function renderAll() {
  renderKPIs();
  renderCharts();
  renderInsights();
  renderDeptRanking();
  renderVOC();
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

const DEPT_COLUMNS = {
  2025: {
    TA: [
      "clear_communication", "steps_of_the_process", "response_time", "customer_service_provided_by_ta",
      "clear_communication2", "steps_of_the_process2", "response_time2", "customer_service_provided4",
      "clear_communication3", "steps_of_the_process3", "response_time3", "customer_service_provided5",
    ],
    IT: [
      "effectiveness", "tech_support_provided_if_applicable", "response_or_resolution_time", "customer_service_provided_by_it",
      "equipment_quality", "tech_support_provided_if_applicable2", "respond_or_resolution_time", "customer_service_provided",
      "effectiveness2", "tech_support_provided_if_applicable3", "respond_or_resolution_time2", "customer_service_provided2",
      "internet_connection",
    ],
    PX: [
      "important_and_helpful_topics", "effective_communication_emailsverbal", "complete_tour_of_our_facilities", "customer_service_provided_by_people_experience",
      "effective_communication", "registratonenrollment_process", "satisfaction_with_providers", "customer_service_received_from_pe",
      "effective_communication2", "registratonenrollment_process2", "satisfaction_with_providers2", "customer_service_received_from_pe2",
      "effective_communication3", "overall_satisfaction", "customer_service_received_from_pe3",
      "discounts_are_appealing_and_relevant", "brands_quality", "easy_process", "customer_service_from_providers", "discounts_are_communicated_effectively",
    ],
    LD: [
      "access_to_training_materials", "quality_of_training_content", "training_clarity", "training_had_the_proper_length", "customer_service_provided_by_ld",
      "effective_communication_of_available_courses", "quality_of_the_external_courses_offered", "easy_enrollment_process", "customer_service_received_from_ld",
      "effective_communication_of_available_courses2", "quality_of_internal_courses_offered", "user_friendly_platforms", "customer_service_received_from_ld2",
    ],
    Facilities: [
      "security", "quality", "quantity", "logistics", "customer_service",
      "chairs", "tabledesks", "ac", "whiteboardsmarkers", "lighting", "tvsscreen", "audio",
      "cleanliness", "quality_toilet_paper", "quality_soap", "quality_paper_towel", "trashcans", "resources_availability",
      "chairstable_quality", "chairstable_quantity", "airflow", "microwaves_and_oven_quality", "microwaves_and_oven_quantity", "fridge", "water_dispenser", "coffee_machines", "cleanliness_1", "utensils_cupboards",
      "location", "quality_1", "size", "assignation_process",
      "desk", "chairs_1", "ac_2", "power_outlets", "cleanliness_2",
      "beanbags", "counter_stools", "ac_3", "entertainment_tv_books_jenga_board_games", "power_outlets_2", "cleanliness2",
    ],
    Finance: [
      "informacin_clara_y_eficaz_sobre_la_carta_de_renta",
      "informacin_clara_en_relacin_con_los_descuentos",
      "informacin_precisa_y_completa_acerca_del_reclculo_anu_41cb77",
      "servicio_al_cliente",
      "pago_de_la_planilla_conforme_al_calendario",
    ],
    Procurement: [
      "more_than_one_supplier_option", "quality_suppliers", "response_or_resolution_time_1", "customer_service_provided3",
    ],
    HRBP: [
      "customer_service2", "effective_communication4", "steps_of_the_processes", "process_automation_selfservice",
      "customer_service3", "effective_communication5", "steps_of_the_processes2", "process_automation_selfservice2",
      "customer_service4", "effective_communication6", "steps_of_the_processes3", "process_automation_selfservice3",
    ],
  },
  2026: {
    TA: [
      "how_satisfied_are_you_with_the_recruitment_processcle_1ba9b1", "how_satisfied_are_you_with_the_recruitment_processste_fa88aa", "how_satisfied_are_you_with_the_recruitment_processres_b64c21", "how_satisfied_are_you_with_the_recruitment_processcus_3c6399",
      "how_satisfied_are_you_with_the_internal_promotions_pr_a7c1f0", "how_satisfied_are_you_with_the_internal_promotions_pr_d48f0f", "how_satisfied_are_you_with_the_internal_promotions_pr_23c66d", "how_satisfied_are_you_with_the_internal_promotions_pr_0bad0d",
      "how_satisfied_are_you_with_our_astronomers_program_re_0936eb", "how_satisfied_are_you_with_our_astronomers_program_re_96d923", "how_satisfied_are_you_with_our_astronomers_program_re_43b2a6", "how_satisfied_are_you_with_our_astronomers_program_re_b8f513",
    ],
    IT: [
      "please_share_your_feedback_on_the_new_equipment_you_r_1a9df9", "please_share_your_feedback_on_the_new_equipment_you_r_7ea9b3", "please_share_your_feedback_on_the_new_equipment_you_r_325257", "please_share_your_feedback_on_the_new_equipment_you_r_f7d3a1",
      "please_assess_the_work_equipment_provided_by_uam_equi_f96e67", "please_assess_the_work_equipment_provided_by_uamtech__ffbdf3", "please_assess_the_work_equipment_provided_by_uamrespo_f61e8d", "please_assess_the_work_equipment_provided_by_uamcusto_46a9ba",
      "please_assess_the_systems_and_tools_provided_by_uamef_fed5f8", "please_assess_the_systems_and_tools_provided_by_uamte_3d8f1d", "please_assess_the_systems_and_tools_provided_by_uamre_999d9f", "please_assess_the_systems_and_tools_provided_by_uamcu_18329e", "please_assess_the_systems_and_tools_provided_by_uamin_ad95d5",
    ],
    PX: [
      "please_evaluate_your_experience_during_your_new_hire__8c2f53", "please_evaluate_your_experience_during_your_new_hire__6b1b4c", "please_evaluate_your_experience_during_your_new_hire__cd579d", "please_evaluate_your_experience_during_your_new_hire__e39e8a",
      "how_satisfied_are_you_with_the_wellness_activities_we_fc4c0f", "how_satisfied_are_you_with_the_wellness_activities_we_6deba0", "how_satisfied_are_you_with_the_wellness_activities_we_c475c2", "how_satisfied_are_you_with_the_wellness_activities_we_e1b850",
      "how_satisfied_are_you_with_the_engagement_activities__9a747f", "how_satisfied_are_you_with_the_engagement_activities__b824ce", "how_satisfied_are_you_with_the_engagement_activities__64ff98", "how_satisfied_are_you_with_the_engagement_activities__8db335",
      "how_satisfied_are_you_with_our_recognition_initiative_227829", "how_satisfied_are_you_with_our_recognition_initiative_1d830b", "how_satisfied_are_you_with_our_recognition_initiative_0a45d6",
      "please_rate_your_experience_if_you_have_used_any_of_o_bb412e", "please_rate_your_experience_if_you_have_used_any_of_o_b61f51", "please_rate_your_experience_if_you_have_used_any_of_o_21d2e0", "please_rate_your_experience_if_you_have_used_any_of_o_005154", "please_rate_your_experience_if_you_have_used_any_of_o_ea234f",
    ],
    LD: [
      "please_provide_feedback_regarding_your_new_hire_train_e2e131", "please_provide_feedback_regarding_your_new_hire_train_5c1096", "please_provide_feedback_regarding_your_new_hire_train_689444", "please_provide_feedback_regarding_your_new_hire_train_8e10e8", "please_provide_feedback_regarding_your_new_hire_train_571886",
      "please_provide_feedback_if_you_have_been_a_part_of_an_4881c6", "please_provide_feedback_if_you_have_been_a_part_of_an_762d98", "please_provide_feedback_if_you_have_been_a_part_of_an_9f51d7", "please_provide_feedback_if_you_have_been_a_part_of_an_8e93c2",
      "please_provide_feedback_if_you_have_been_a_part_of_an_840de4", "please_provide_feedback_if_you_have_been_a_part_of_an_3a029e", "please_provide_feedback_if_you_have_been_a_part_of_an_efa94b", "please_provide_feedback_if_you_have_been_a_part_of_an_f8ef80",
    ],
    Facilities: [
      "please_assess_colaboras_parking_lotsecurity", "please_assess_colaboras_parking_lotquality", "please_assess_colaboras_parking_lotquantity", "please_assess_colaboras_parking_lotlogistics", "please_assess_colaboras_parking_lotchat_efficiency",
      "please_assess_your_working_spacedesk", "please_assess_your_working_spacechairs", "please_assess_your_working_spaceac", "please_assess_your_working_spacepower_outlets", "please_assess_your_working_spacecleanliness",
      "please_assess_our_restroomscleanliness", "please_assess_our_restroomsquality_toilet_paper", "please_assess_our_restroomsquality_soap", "please_assess_our_restroomsquality_paper_towel", "please_assess_our_restroomstrashcans", "please_assess_our_restroomsresources_availability",
      "please_assess_our_kitchenettechairstable_quality", "please_assess_our_kitchenettechairstable_quantity", "please_assess_our_kitchenetteairflow", "please_assess_our_kitchenettemicrowaves_and_oven_quality", "please_assess_our_kitchenettemicrowaves_and_oven_quantity", "please_assess_our_kitchenettefridge", "please_assess_our_kitchenettewater_dispenser", "please_assess_our_kitchenettecoffee_machines", "please_assess_our_kitchenettecleanliness", "please_assess_our_kitchenetteutensils_cupboards",
      "please_assess_our_meeting_roomschairs", "please_assess_our_meeting_roomstabledesks", "please_assess_our_meeting_roomsac", "please_assess_our_meeting_roomswhiteboardsmarkers", "please_assess_our_meeting_roomslighting", "please_assess_our_meeting_roomstvsscreen", "please_assess_our_meeting_roomsaudio",
      "please_asses_the_locker_you_have_been_assignedlocation", "please_asses_the_locker_you_have_been_assignedquality", "please_asses_the_locker_you_have_been_assignedsize", "please_asses_the_locker_you_have_been_assignedassigna_7617a8",
    ],
    Finance: [
      "how_would_you_evaluate_the_process_followed_by_financ_126c55", "how_would_you_evaluate_the_process_followed_by_financ_17dd54", "how_would_you_evaluate_the_process_followed_by_financ_94c668", "how_would_you_evaluate_the_process_followed_by_financ_720d56", "how_would_you_evaluate_the_process_followed_by_financ_109f1b",
    ],
    Procurement: [
      "please_assess_the_service_provided_by_procurementmore_4d359b", "please_assess_the_service_provided_by_procurementqual_d629fe", "please_assess_the_service_provided_by_procurementresp_d65c27", "please_assess_the_service_provided_by_procurementcust_89811b",
    ],
    HRBP: [
      "please_rate_your_experience_with_hrbp_regarding_certi_a6cb40", "please_rate_your_experience_with_hrbp_regarding_certi_f8d148", "please_rate_your_experience_with_hrbp_regarding_certi_b70c54", "please_rate_your_experience_with_hrbp_regarding_certi_5a74d2",
      "please_rate_your_experience_with_hrbp_on_special_perm_879cd1", "please_rate_your_experience_with_hrbp_on_special_perm_b9f33f", "please_rate_your_experience_with_hrbp_on_special_perm_0a67cd", "please_rate_your_experience_with_hrbp_on_special_perm_2a8884",
      "how_would_you_rate_your_experience_with_hrbp_regardin_17c5c7", "how_would_you_rate_your_experience_with_hrbp_regardin_45c267", "how_would_you_rate_your_experience_with_hrbp_regardin_5f35bf", "how_would_you_rate_your_experience_with_hrbp_regardin_506200",
    ],
  },
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
  const cols = (DEPT_COLUMNS[year] && DEPT_COLUMNS[year][dept]) || [];
  return scoresForColumns(dataset, cols);
}

function allScores(year, dataset) {
  const cols = Object.values(DEPT_COLUMNS[year]).flat();
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

  const vocCount = years.reduce((sum, y) => sum + extractComments(DATASET_BY_YEAR[y]()).length, 0);
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
const COMPETENCIES = [
  { label: "Tiempo de Respuesta", match: c => c.includes("response_time") || c.includes("resolution_time") || c.includes("respond_or_resolution") },
  { label: "Efectividad de Solución", match: c => c.includes("effectiveness") },
  { label: "Atención al Cliente", match: c => c.includes("customer_service") },
  { label: "Comunicación Clara", match: c => c.includes("clear_communication") || c.includes("effective_communication") },
  { label: "Facilidad del Proceso", match: c => c.includes("steps_of_the_process") || c.includes("easy_enrollment_process") || c.includes("easy_process") },
];

function competencyScores(year, dataset) {
  const cols = selectedDept === 'ALL'
    ? Object.values(DEPT_COLUMNS[year]).flat()
    : (DEPT_COLUMNS[year][selectedDept] || []);

  return COMPETENCIES.map(comp => {
    const matching = cols.filter(comp.match);
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
    .flatMap(y => extractComments(DATASET_BY_YEAR[y]()))
    .filter(text => classifyComment(text).category === "stop");

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

  const stopComments = years.flatMap(y => extractComments(DATASET_BY_YEAR[y]())).filter(t => classifyComment(t).category === "stop");
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
    container.innerHTML = `<p class="chart-empty-msg" style="position:static;">Sin datos suficientes para este filtro.</p>`;
    return;
  }

  const showBothYears = selectedYear === 'ALL';

  const head = showBothYears
    ? `<tr><th>#</th><th>Departamento</th><th>CSAT 2025</th><th>CSAT 2026</th><th>Δ YoY</th><th>Nivel</th></tr>`
    : `<tr><th>#</th><th>Departamento</th><th>CSAT ${selectedYear}</th><th>Nivel</th></tr>`;

  const body = rows.map((r, i) => {
    const barPct = Math.max(0, Math.min(100, (r.activeAvg / 5) * 100));
    const rankBadge = `<span class="rank-badge ${i === 0 ? "top1" : ""}">${i + 1}</span>`;
    const barCell = `<td class="rank-bar-cell"><div class="rank-bar-track"><div class="rank-bar-fill" style="width:${barPct}%"></div></div></td>`;

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

  const all = activeYears().flatMap(y => extractComments(DATASET_BY_YEAR[y]()));
  const counts = { start: 0, stop: 0, continue: 0 };
  all.forEach(t => counts[classifyComment(t).category]++);
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
// Solo las columnas de texto libre "please_comment_on_ideas_you_think_..."
// y "do_you_have_any_other_ideas_for_this_space" son comentarios reales.
// (El filtro anterior buscaba "please" en el nombre de columna, lo cual
// también capturaba preguntas de calificación Likert como
// "please_assess_..." o "please_rate_...", inflando el conteo de VOC con
// respuestas tipo "Satisfied"/"Very Satisfied" que no son comentarios.)
function isVocColumn(col) {
  return col.includes("please_comment_on_ideas_you_think") || col.includes("do_you_have_any_other_ideas_for_this_space");
}

function extractComments(dataset) {
  if (!dataset || dataset.length === 0) return [];
  const sample = dataset[0];
  const keys = Object.keys(sample).filter(isVocColumn);

  let list = [];
  dataset.forEach(row => {
    keys.forEach(k => {
      const val = row[k];
      if (val && typeof val === "string" && val.trim().length > 4 && val.trim().toLowerCase() !== "no") {
        list.push(val.trim());
      }
    });
  });
  return list;
}

function classifyComment(text) {
  const lower = text.toLowerCase();
  if (lower.includes("stop") || lower.includes("mal") || lower.includes("tardan") || lower.includes("no ")) {
    return { category: "stop", label: "Punto Crítico" };
  }
  if (lower.includes("keep") || lower.includes("excelente") || lower.includes("buen") || lower.includes("continue")) {
    return { category: "continue", label: "Mantener Práctica" };
  }
  return { category: "start", label: "Idea de Mejora" };
}

function filterVOC(type, btnEl) {
  vocFilter = type;
  document.querySelectorAll(".filter-btn").forEach(btn => btn.classList.remove("active"));
  btnEl.classList.add("active");
  renderVOC();
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function renderVOC() {
  renderVocSentimentSummary();

  const container = document.getElementById("dx-comments-grid");
  if (!container) return;
  container.innerHTML = "";

  const all = activeYears().flatMap(y =>
    extractComments(DATASET_BY_YEAR[y]()).map(c => ({ text: c, year: String(y) }))
  );

  all.forEach(item => {
    const { category, label: catLabel } = classifyComment(item.text);

    if (vocFilter !== 'ALL' && category !== vocFilter) return;

    const card = document.createElement("div");
    card.className = "comment-card";
    card.innerHTML = `
      <div class="card-top">
        <span class="tag ${category}">${catLabel}</span>
        <span class="year-badge">${item.year}</span>
      </div>
      <p class="comment-body">"${escapeHtml(item.text)}"</p>
    `;
    container.appendChild(card);
  });
}
