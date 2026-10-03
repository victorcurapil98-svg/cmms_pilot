"use strict";

const COLORS = ["#43b797", "#6b94c2", "#e5a765", "#9a8ac3", "#d97f78", "#86a6aa", "#c3a66e"];
const REQUIRED_COLUMNS = ["ot", "tipomantenimiento"];
const FIELD_ALIASES = {
  ot: ["ot", "ordendetrabajo"],
  tipomantenimiento: ["tipomantenimiento", "estrategia", "tipodemantenimiento"],
  unidad: ["unidad", "areaoperativa"],
  equipo: ["equipo", "activo"],
  tipoequipo: ["tipoequipo", "clasedeequipo"],
  criticidad: ["criticidad"],
  modoFalla: ["modofalla", "mododefalla", "fallamodo"],
  downtime: ["downtimeh", "downtime", "horasindisponibilidad"],
  hours: ["horasmanoobra", "horashombre", "hh"],
  cost: ["costototalclp", "costototal", "costodirectoclp", "costo"],
  repair: ["tiemporeparacionh", "tiemporeparacion", "mttrh"],
  state: ["estado", "statususuario", "statussistema"],
  start: ["fechainicio"],
  finish: ["fechafin"]
};
const state = { rows: [], filename: "", headers: new Map(), delimiter: "," };
const $ = (selector) => document.querySelector(selector);

const numberFormat = new Intl.NumberFormat("es-CL", { maximumFractionDigits: 1 });
const integerFormat = new Intl.NumberFormat("es-CL", { maximumFractionDigits: 0 });
const moneyFormat = new Intl.NumberFormat("es-CL", { maximumFractionDigits: 0 });

function normalizeText(value) {
  return String(value ?? "")
    .replace(/^\uFEFF/, "")
    .replace(/^'+/, "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es-CL");
}

function normalizeHeader(value) {
  return normalizeText(value).replace(/[^a-z0-9]/g, "");
}

function cleanCell(value) {
  return String(value ?? "").replace(/^\uFEFF/, "").replace(/^'+/, "").trim();
}

function canonicalMaintenance(value) {
  const cleaned = cleanCell(value).replace(/\s+/g, " ");
  const normalized = normalizeText(cleaned);
  const known = {
    correctivo: "Correctivo",
    preventiva: "Preventivo",
    preventivo: "Preventivo",
    predictivo: "Predictivo"
  };
  return known[normalized] || (cleaned ? cleaned[0].toLocaleUpperCase("es-CL") + cleaned.slice(1) : "");
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
}

function parseCsv(text) {
  const sample = text.slice(0, 8000);
  const firstLine = sample.split(/\r?\n/, 1)[0] || "";
  const candidates = [",", ";", "\t"];
  let delimiter = ",";
  let greatest = -1;
  for (const candidate of candidates) {
    let quoted = false;
    let count = 0;
    for (let index = 0; index < firstLine.length; index += 1) {
      if (firstLine[index] === '"') {
        if (quoted && firstLine[index + 1] === '"') index += 1;
        else quoted = !quoted;
      } else if (!quoted && firstLine[index] === candidate) count += 1;
    }
    if (count > greatest) {
      greatest = count;
      delimiter = candidate;
    }
  }

  const records = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (!quoted && char === delimiter) {
      row.push(field);
      field = "";
    } else if (!quoted && (char === "\n" || char === "\r")) {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field);
      if (row.some((cell) => cell.trim() !== "")) records.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    if (row.some((cell) => cell.trim() !== "")) records.push(row);
  }

  if (records.length < 2) throw new Error("El CSV está vacío o no contiene filas de datos.");
  const headers = records[0].map(cleanCell);
  const rows = records.slice(1).map((values) => {
    const record = {};
    headers.forEach((header, index) => { record[header] = cleanCell(values[index]); });
    return record;
  });
  return { headers, rows, delimiter };
}

function parseNumber(value) {
  let text = cleanCell(value).replace(/\s/g, "").replace(/[^\d,.-]/g, "");
  if (!text || text === "-" || text === ".") return null;
  const comma = text.lastIndexOf(",");
  const dot = text.lastIndexOf(".");
  if (comma >= 0 && dot >= 0) {
    if (comma > dot) text = text.replace(/\./g, "").replace(",", ".");
    else text = text.replace(/,/g, "");
  } else if (comma >= 0) {
    text = /,\d{3}$/.test(text) ? text.replace(/,/g, "") : text.replace(",", ".");
  }
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function fieldValue(row, field) {
  const keys = state.headers.get(field) || [];
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== "") return row[key];
  }
  return "";
}

function fieldNumber(row, field) {
  return parseNumber(fieldValue(row, field));
}

function sum(rows, field) {
  return rows.reduce((total, row) => total + (fieldNumber(row, field) ?? 0), 0);
}

function average(values) {
  const valid = values.filter((value) => Number.isFinite(value));
  return valid.length ? valid.reduce((total, value) => total + value, 0) / valid.length : null;
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function uniqueCount(rows, field = "ot") {
  return new Set(rows.map((row) => fieldValue(row, field)).filter(Boolean)).size;
}

function isCorrective(row) {
  return normalizeText(fieldValue(row, "tipomantenimiento")).includes("correct");
}

function selectedRows() {
  const maintenance = $("#maintenance-filter").value;
  const unit = $("#unit-filter").value;
  return state.rows.filter((row) =>
    (!maintenance || fieldValue(row, "tipomantenimiento") === maintenance) &&
    (!unit || fieldValue(row, "unidad") === unit)
  );
}

function labelFor(row, field, fallback = "Sin dato") {
  return fieldValue(row, field) || fallback;
}

function groupBy(rows, field) {
  const groups = new Map();
  for (const row of rows) {
    const label = labelFor(row, field);
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(row);
  }
  return [...groups.entries()].map(([label, items]) => ({ label, rows: items }));
}

function groupMetric(rows, groupField, metricField, metric = "sum") {
  return groupBy(rows, groupField).map(({ label, rows: items }) => ({
    label,
    value: metric === "count" ? uniqueCount(items) : metric === "mean" ?
      average(items.map((row) => fieldNumber(row, metricField)).filter((value) => value !== null)) :
      sum(items, metricField),
    count: uniqueCount(items),
    rows: items
  })).filter((item) => item.value !== null);
}

function moneyCompact(value) {
  if (value === null || !Number.isFinite(value)) return "—";
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000_000) return `$${numberFormat.format(value / 1_000_000_000)} mil M`;
  if (absolute >= 1_000_000) return `$${numberFormat.format(value / 1_000_000)} M`;
  if (absolute >= 10_000) return `$${numberFormat.format(value / 1_000)} mil`;
  return `$${moneyFormat.format(value)}`;
}

function moneyFull(value) {
  return value === null || !Number.isFinite(value) ? "—" : `$${moneyFormat.format(value)} CLP`;
}

function percent(part, total) {
  return total > 0 ? (part / total) * 100 : 0;
}

function buildHeaderMap(headers) {
  const normalized = new Map(headers.map((header) => [normalizeHeader(header), header]));
  const result = new Map();
  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    result.set(field, aliases.map((alias) => normalized.get(alias)).filter(Boolean));
  }
  const missing = REQUIRED_COLUMNS.filter((field) => !(result.get(field) || []).length);
  if (missing.length) {
    throw new Error(`Faltan columnas obligatorias: ${missing.map((field) => field === "ot" ? "OT" : "Tipo_mantenimiento").join(", ")}.`);
  }
  return result;
}

function loadCsvFile(file) {
  if (!file || !/\.csv$/i.test(file.name)) {
    showNotice("Selecciona un archivo con extensión .csv.", true);
    return;
  }
  const reader = new FileReader();
  reader.onerror = () => showNotice("No se pudo leer el archivo. Intenta seleccionarlo nuevamente.", true);
  reader.onload = () => {
    try {
      const parsed = parseCsv(String(reader.result || ""));
      const headers = buildHeaderMap(parsed.headers);
      const maintenanceColumn = headers.get("tipomantenimiento")[0];
      const normalizedRows = parsed.rows.map((row) => {
        const clean = {};
        for (const [key, value] of Object.entries(row)) clean[key] = cleanCell(value);
        clean[maintenanceColumn] = canonicalMaintenance(clean[maintenanceColumn]);
        return clean;
      });
      if (!normalizedRows.length) throw new Error("El dataset no contiene registros.");
      state.rows = normalizedRows;
      state.filename = file.name;
      state.headers = headers;
      state.delimiter = parsed.delimiter;
      populateFilters();
      $("#welcome-panel").hidden = true;
      $("#dashboard").hidden = false;
      $("#dataset-meta").hidden = false;
      $("#print-report").disabled = false;
      showNotice(`Dataset cargado: ${integerFormat.format(normalizedRows.length)} registros y ${parsed.headers.length} columnas.`, false, true);
      renderDashboard();
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "No se pudo procesar el CSV.", true);
    }
  };
  reader.readAsText(file, "UTF-8");
}

function showNotice(message, error = false, success = false) {
  const notice = $("#notice");
  notice.textContent = message;
  notice.classList.toggle("success", success);
  notice.hidden = false;
  if (success) {
    window.clearTimeout(showNotice.timeout);
    showNotice.timeout = window.setTimeout(() => { notice.hidden = true; }, 5500);
  }
  if (error) notice.scrollIntoView({ behavior: "smooth", block: "center" });
}

function populateFilters() {
  const maintenance = [...new Set(state.rows.map((row) => fieldValue(row, "tipomantenimiento")).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "es"));
  const units = [...new Set(state.rows.map((row) => fieldValue(row, "unidad")).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "es"));
  $("#maintenance-filter").innerHTML = '<option value="">Todos los tipos</option>' +
    maintenance.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("");
  $("#unit-filter").innerHTML = '<option value="">Todas las unidades</option>' +
    units.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("");
}

function renderDashboard() {
  const rows = selectedRows();
  const nOt = uniqueCount(rows);
  const hours = sum(rows, "hours");
  const downtime = sum(rows, "downtime");
  const cost = sum(rows, "cost");
  const corrective = rows.filter(isCorrective);
  const validRepair = corrective
    .map((row) => fieldNumber(row, "repair"))
    .filter((value) => value !== null && value > 0);
  const mttr = average(validRepair);
  const correctionCostShare = percent(sum(corrective, "cost"), cost);
  const correctionOtShare = percent(uniqueCount(corrective), nOt);
  const correctionDowntimeShare = percent(sum(corrective, "downtime"), downtime);
  const correctionHoursShare = percent(sum(corrective, "hours"), hours);

  $("#dataset-name").textContent = state.filename;
  $("#dataset-details").textContent =
    `${integerFormat.format(rows.length)} registros visibles · ${integerFormat.format(state.rows.length)} en total`;
  renderKpis({ nOt, hours, downtime, cost, mttr, validRepairs: validRepair.length });
  $("#insight-banner").innerHTML = `
    <span class="insight-icon" aria-hidden="true">✳</span>
    <div class="insight-copy"><strong>Lectura del filtro actual.</strong>
      El mantenimiento correctivo representa el <strong>${numberFormat.format(correctionOtShare)} %</strong> de las OT,
      el <strong>${numberFormat.format(correctionHoursShare)} %</strong> de las horas-hombre,
      el <strong>${numberFormat.format(correctionDowntimeShare)} %</strong> del downtime y
      el <strong>${numberFormat.format(correctionCostShare)} %</strong> del costo directo.
    </div>`;
  renderMixChart(rows);
  renderBarChart("#chart-cost", groupMetric(rows, "tipomantenimiento", "cost").sort((a, b) => b.value - a.value), {
    format: moneyCompact, color: COLORS[0], empty: "No hay costos para mostrar."
  });
  renderBarChart("#chart-downtime", groupMetric(rows, "equipo", "downtime").sort((a, b) => b.value - a.value).slice(0, 8), {
    format: (value) => `${numberFormat.format(value)} h`, color: COLORS[1], empty: "No hay datos de downtime o equipo."
  });
  renderPareto(rows);
  renderBarChart("#chart-mttr", groupMetric(corrective, "tipoequipo", "repair", "mean")
    .filter((item) => item.value > 0).sort((a, b) => b.value - a.value).slice(0, 8), {
      format: (value) => `${numberFormat.format(value)} h`, color: COLORS[3], empty: "Sin tiempos de reparación correctivos válidos."
    });
  renderJackknife(corrective);
  renderPriorityTable(rows);
}

function renderKpis({ nOt, hours, downtime, cost, mttr, validRepairs }) {
  const cards = [
    { label: "Órdenes de trabajo", value: integerFormat.format(nOt), foot: "OT únicas en el filtro", icon: "▤" },
    { label: "Horas-hombre", value: numberFormat.format(hours), foot: "Esfuerzo acumulado · horas", icon: "◷" },
    { label: "Downtime total", value: numberFormat.format(downtime), foot: "Indisponibilidad · horas", icon: "⌁" },
    { label: "Costo directo", value: moneyCompact(cost), foot: `${moneyFull(cost)} acumulados`, icon: "$" },
    { label: "MTTR correctivo", value: mttr === null ? "—" : `${numberFormat.format(mttr)} h`, foot: `${integerFormat.format(validRepairs)} reparaciones válidas`, icon: "↻" }
  ];
  $("#kpi-grid").innerHTML = cards.map((card) => `
    <article class="kpi-card">
      <div class="kpi-top"><span>${escapeHtml(card.label)}</span><span class="kpi-symbol" aria-hidden="true">${escapeHtml(card.icon)}</span></div>
      <strong class="kpi-value">${escapeHtml(card.value)}</strong>
      <span class="kpi-foot">${escapeHtml(card.foot)}</span>
    </article>`).join("");
}

function renderMixChart(rows) {
  const target = $("#chart-mix");
  const groups = groupBy(rows, "tipomantenimiento").map(({ label, rows: items }) => ({
    label, orders: uniqueCount(items), hours: sum(items, "hours")
  })).sort((a, b) => b.orders - a.orders);
  if (!groups.length) {
    target.innerHTML = '<div class="chart-empty">No hay órdenes para mostrar.</div>';
    return;
  }
  const total = groups.reduce((sumValue, item) => sumValue + item.orders, 0);
  const radius = 57;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  const circles = groups.map((item, index) => {
    const length = total ? (item.orders / total) * circumference : 0;
    const circle = `<circle cx="88" cy="88" r="${radius}" fill="none" stroke="${COLORS[index % COLORS.length]}" stroke-width="20" stroke-dasharray="${length} ${circumference - length}" stroke-dashoffset="${-offset}" transform="rotate(-90 88 88)"><title>${escapeHtml(item.label)}: ${numberFormat.format(percent(item.orders, total))} % de las OT</title></circle>`;
    offset += length;
    return circle;
  }).join("");
  target.innerHTML = `
    <div class="donut-layout">
      <svg class="donut-svg" viewBox="0 0 176 176" role="img" aria-label="Distribución de las órdenes por tipo de mantenimiento">
        <circle cx="88" cy="88" r="${radius}" fill="none" stroke="#edf2f2" stroke-width="20"></circle>
        ${circles}
        <text x="88" y="83" text-anchor="middle" fill="#18384b" font-family="Manrope,sans-serif" font-size="23" font-weight="800">${integerFormat.format(total)}</text>
        <text x="88" y="101" text-anchor="middle" fill="#8a9ba4" font-family="DM Sans,sans-serif" font-size="8">ÓRDENES</text>
      </svg>
      <div class="donut-legend">${groups.map((item, index) => `
        <div class="legend-row">
          <span class="legend-dot" style="background:${COLORS[index % COLORS.length]}"></span>
          <span>${escapeHtml(item.label)}</span>
          <strong>${numberFormat.format(percent(item.orders, total))}%</strong>
        </div>`).join("")}
      </div>
    </div>`;
}

function truncate(value, limit = 22) {
  const text = String(value ?? "");
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function renderBarChart(selector, items, { format, color, empty }) {
  const target = $(selector);
  if (!items.length) {
    target.innerHTML = `<div class="chart-empty">${escapeHtml(empty)}</div>`;
    return;
  }
  const width = 520;
  const rowHeight = 25;
  const height = Math.max(190, items.length * rowHeight + 15);
  const left = 126;
  const right = 71;
  const chartWidth = width - left - right;
  const max = Math.max(...items.map((item) => item.value), 1);
  const bars = items.map((item, index) => {
    const y = 9 + index * rowHeight;
    const barWidth = Math.max(2, (item.value / max) * chartWidth);
    return `
      <text class="chart-label" x="${left - 9}" y="${y + 12}" text-anchor="end">${escapeHtml(truncate(item.label, 21))}<title>${escapeHtml(item.label)}</title></text>
      <rect class="chart-bar" x="${left}" y="${y}" width="${barWidth}" height="13" rx="4" fill="${color}"><title>${escapeHtml(item.label)}: ${escapeHtml(format(item.value))}</title></rect>
      <text class="chart-value" x="${Math.min(width - 5, left + barWidth + 7)}" y="${y + 10}">${escapeHtml(format(item.value))}</text>`;
  }).join("");
  target.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Gráfico de barras: ${escapeHtml(items.map((item) => item.label).join(", "))}">${bars}</svg>`;
}

function renderPareto(rows) {
  const target = $("#chart-pareto");
  const corrective = rows.filter(isCorrective);
  const groups = groupBy(corrective, "modoFalla").filter((item) => item.label !== "Sin dato")
    .map(({ label, rows: items }) => ({ label, count: uniqueCount(items) }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
  if (!groups.length) {
    target.innerHTML = '<div class="chart-empty">No hay modos de falla registrados para órdenes correctivas.</div>';
    return;
  }
  const total = groupBy(corrective.filter((row) => fieldValue(row, "modoFalla")), "modoFalla")
    .reduce((sumValue, item) => sumValue + uniqueCount(item.rows), 0);
  const width = 650;
  const height = 215;
  const left = 34;
  const top = 17;
  const bottom = 47;
  const graphHeight = height - top - bottom;
  const chartWidth = width - left - 30;
  const max = Math.max(...groups.map((item) => item.count), 1);
  let cumulative = 0;
  const step = chartWidth / groups.length;
  const barWidth = Math.min(29, step * .54);
  const bars = groups.map((item, index) => {
    cumulative += item.count;
    const x = left + (index + .5) * step;
    const barHeight = (item.count / max) * graphHeight;
    const lineY = top + graphHeight * (1 - (total ? cumulative / total : 0));
    return `
      <rect class="chart-bar" x="${x - barWidth / 2}" y="${top + graphHeight - barHeight}" width="${barWidth}" height="${barHeight}" rx="3" fill="${COLORS[index % COLORS.length]}"><title>${escapeHtml(item.label)}: ${integerFormat.format(item.count)} eventos</title></rect>
      <text class="chart-axis" x="${x}" y="${height - 27}" text-anchor="middle">${integerFormat.format(item.count)}</text>
      <text class="chart-label" x="${x}" y="${height - 13}" text-anchor="middle">${escapeHtml(truncate(item.label, 11))}<title>${escapeHtml(item.label)}</title></text>
      <circle class="pareto-point" cx="${x}" cy="${lineY}" r="3"><title>Acumulado: ${numberFormat.format(total ? percent(cumulative, total) : 0)}%</title></circle>`;
  }).join("");
  cumulative = 0;
  const points = groups.map((item, index) => {
    cumulative += item.count;
    const x = left + (index + .5) * step;
    const y = top + graphHeight * (1 - (total ? cumulative / total : 0));
    return `${x},${y}`;
  }).join(" ");
  const grid = [0, .5, 1].map((fraction) => {
    const y = top + graphHeight * (1 - fraction);
    return `<line class="chart-gridline" x1="${left}" x2="${width - 20}" y1="${y}" y2="${y}"><title>${Math.round(fraction * 100)}%</title></line>
      <text class="chart-axis" x="${width - 17}" y="${y + 3}">${Math.round(fraction * 100)}%</text>`;
  }).join("");
  target.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Pareto de modos de falla correctivos">${grid}${bars}<polyline class="pareto-line" points="${points}"></polyline><text class="chart-axis" x="${left}" y="10">Eventos</text></svg>`;
}

function renderJackknife(correctiveRows) {
  const target = $("#chart-jackknife");
  const assets = groupBy(correctiveRows, "equipo").map(({ label, rows }) => {
    const repairs = rows.map((row) => fieldNumber(row, "repair")).filter((value) => value !== null && value > 0);
    return {
      label,
      frequency: uniqueCount(rows),
      mttr: average(repairs),
      criticality: fieldValue(rows[0], "criticidad")
    };
  }).filter((item) => item.label !== "Sin dato" && item.frequency > 0 && item.mttr !== null);
  if (!assets.length) {
    target.innerHTML = '<div class="chart-empty">Se requieren OT correctivas, equipo y tiempos de reparación válidos.</div>';
    return;
  }
  const width = 640;
  const height = 235;
  const margin = { left: 48, right: 23, top: 18, bottom: 35 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const maxX = Math.max(...assets.map((item) => item.frequency), 1);
  const maxY = Math.max(...assets.map((item) => item.mttr), 1);
  const middleX = median(assets.map((item) => item.frequency));
  const middleY = median(assets.map((item) => item.mttr));
  const x = (value) => margin.left + (value / maxX) * plotWidth;
  const y = (value) => margin.top + plotHeight - (value / maxY) * plotHeight;
  const grid = [0, .5, 1].map((fraction) => {
    const gy = margin.top + plotHeight * fraction;
    const gx = margin.left + plotWidth * fraction;
    return `<line class="chart-gridline" x1="${margin.left}" x2="${width - margin.right}" y1="${gy}" y2="${gy}"></line>
      <line class="chart-gridline" x1="${gx}" x2="${gx}" y1="${margin.top}" y2="${height - margin.bottom}"></line>`;
  }).join("");
  const quadrants = `
    <text class="jackknife-label" x="${margin.left + 5}" y="${margin.top + 12}">CRÓNICO</text>
    <text class="jackknife-label" x="${x(middleX) + 6}" y="${margin.top + 12}">GRAVE</text>
    <text class="jackknife-label" x="${margin.left + 5}" y="${height - margin.bottom - 7}">BAJO CONTROL</text>
    <text class="jackknife-label" x="${x(middleX) + 6}" y="${height - margin.bottom - 7}">AGUDO</text>`;
  const points = assets.map((item, index) => {
    const fill = item.frequency >= middleX && item.mttr >= middleY ? "#d97f78" :
      item.frequency >= middleX ? "#e5a765" : item.mttr >= middleY ? "#9a8ac3" : "#43b797";
    const radius = Math.min(6, 3 + Math.sqrt(item.frequency) * .45);
    return `<circle class="jackknife-point" cx="${x(item.frequency)}" cy="${y(item.mttr)}" r="${radius}" fill="${fill}"><title>${escapeHtml(item.label)} · ${integerFormat.format(item.frequency)} OT · MTTR ${numberFormat.format(item.mttr)} h · Criticidad ${escapeHtml(item.criticality || "s/d")}</title></circle>`;
  }).join("");
  target.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Diagrama Jack-Knife de equipos correctivos">
    ${grid}${quadrants}
    <line x1="${x(middleX)}" x2="${x(middleX)}" y1="${margin.top}" y2="${height - margin.bottom}" stroke="#acbbc1" stroke-dasharray="4 4"></line>
    <line x1="${margin.left}" x2="${width - margin.right}" y1="${y(middleY)}" y2="${y(middleY)}" stroke="#acbbc1" stroke-dasharray="4 4"></line>
    ${points}
    <text class="chart-axis" x="${margin.left + plotWidth / 2}" y="${height - 6}" text-anchor="middle">Frecuencia de intervención · OT</text>
    <text class="chart-axis" x="12" y="${margin.top + plotHeight / 2}" text-anchor="middle" transform="rotate(-90 12 ${margin.top + plotHeight / 2})">MTTR · horas</text>
  </svg>`;
}

function renderPriorityTable(rows) {
  const items = groupBy(rows, "equipo").map(({ label, rows: items }) => ({
    label,
    type: fieldValue(items[0], "tipoequipo") || "—",
    criticality: fieldValue(items[0], "criticidad") || "—",
    orders: uniqueCount(items),
    downtime: sum(items, "downtime"),
    cost: sum(items, "cost")
  })).filter((item) => item.label !== "Sin dato")
    .sort((a, b) => b.downtime - a.downtime)
    .slice(0, 8);
  $("#priority-table").innerHTML = items.length ? items.map((item, index) => `
    <tr>
      <td>${String(index + 1).padStart(2, "0")}</td>
      <td><strong>${escapeHtml(item.label)}</strong></td>
      <td>${escapeHtml(item.type)}</td>
      <td><span class="criticality ${normalizeText(item.criticality) === "a" ? "critical-a" : ""}">${escapeHtml(item.criticality)}</span></td>
      <td>${integerFormat.format(item.orders)}</td>
      <td>${numberFormat.format(item.downtime)} h</td>
      <td>${moneyFull(item.cost)}</td>
    </tr>`).join("") : '<tr><td colspan="7">No hay equipos para los filtros seleccionados.</td></tr>';
}

function initialize() {
  const fileInput = $("#file-input");
  const openFileDialog = () => fileInput.click();
  $("#open-upload").addEventListener("click", openFileDialog);
  $("#welcome-upload").addEventListener("click", openFileDialog);
  fileInput.addEventListener("change", (event) => {
    loadCsvFile(event.target.files?.[0]);
    event.target.value = "";
  });
  $("#print-report").addEventListener("click", () => window.print());
  $("#maintenance-filter").addEventListener("change", renderDashboard);
  $("#unit-filter").addEventListener("change", renderDashboard);
  $("#reset-filters").addEventListener("click", () => {
    $("#maintenance-filter").value = "";
    $("#unit-filter").value = "";
    renderDashboard();
  });

  let dragDepth = 0;
  window.addEventListener("dragenter", (event) => {
    if (!event.dataTransfer?.types?.includes("Files")) return;
    event.preventDefault();
    dragDepth += 1;
    $("#drop-overlay").setAttribute("aria-hidden", "false");
    $("#drop-overlay").hidden = false;
  });
  window.addEventListener("dragover", (event) => {
    if (event.dataTransfer?.types?.includes("Files")) event.preventDefault();
  });
  window.addEventListener("dragleave", (event) => {
    event.preventDefault();
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) {
      $("#drop-overlay").hidden = true;
      $("#drop-overlay").setAttribute("aria-hidden", "true");
    }
  });
  window.addEventListener("drop", (event) => {
    if (!event.dataTransfer?.files?.length) return;
    event.preventDefault();
    dragDepth = 0;
    $("#drop-overlay").hidden = true;
    $("#drop-overlay").setAttribute("aria-hidden", "true");
    loadCsvFile(event.dataTransfer.files[0]);
  });
  document.querySelectorAll(".side-nav a").forEach((link) => link.addEventListener("click", () => {
    document.querySelectorAll(".side-nav a").forEach((item) => item.classList.remove("active"));
    link.classList.add("active");
  }));
}

initialize();
